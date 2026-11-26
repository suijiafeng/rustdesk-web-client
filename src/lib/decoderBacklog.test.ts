import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { MAX_DECODE_QUEUE_SIZE, RemoteDecoder } from './decoder.ts';
import type { VideoPacket } from './protocol.ts';

class SlowDecoder {
  static instances: SlowDecoder[] = [];
  state: CodecState = 'unconfigured';
  decodeQueueSize = 0;
  closeCalls = 0;
  chunks: EncodedVideoChunk[] = [];
  constructor(readonly callbacks: VideoDecoderInit) { SlowDecoder.instances.push(this); }
  configure() { this.state = 'configured'; }
  decode(chunk: EncodedVideoChunk) { this.chunks.push(chunk); this.decodeQueueSize++; }
  close() { this.closeCalls++; this.state = 'closed'; this.decodeQueueSize = 0; }
  output(id: number) {
    const frame = { id, displayWidth: 640, displayHeight: 480, closeCalls: 0,
      close() { this.closeCalls++; } };
    this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
    this.callbacks.output(frame as unknown as VideoFrame);
    return frame;
  }
}

function fixture(t: TestContext) {
  SlowDecoder.instances = [];
  const frames = new Map<number, FrameRequestCallback>();
  const cancelled: FrameRequestCallback[] = [];
  let sequence = 0;
  const globals = {
    VideoDecoder: SlowDecoder,
    EncodedVideoChunk: class { constructor(options: EncodedVideoChunkInit) { Object.assign(this, options); } },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id: number) => { const callback = frames.get(id); if (callback) cancelled.push(callback); frames.delete(id); },
  };
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
  }
  const painted: number[] = [];
  const errors: string[] = [];
  const outputs: number[] = [];
  let refreshes = 0;
  const canvas = { width: 640, height: 480, getContext: () => ({ drawImage: (frame: { id: number }) => painted.push(frame.id) }) } as unknown as HTMLCanvasElement;
  const remote = new RemoteDecoder({ onOutput: (_width, _height, count) => outputs.push(count),
    onError: message => errors.push(message), onNeedRefresh: () => { refreshes++; } });
  t.after(() => remote.close());
  const push = (key: boolean, id = 1) => remote.push({
    codec: 1, codecName: 'vp8', key, display: 0, width: 640, height: 480,
    pts: id * 33, gatewayUnixMs: 0, data: Uint8Array.of(id),
  } satisfies VideoPacket, canvas);
  const paint = () => { const queued = [...frames.values()]; frames.clear(); for (const callback of queued) callback(0); };
  return { remote, push, paint, painted, outputs, errors, frames, cancelled, refreshes: () => refreshes,
    latest: () => SlowDecoder.instances.at(-1)! };
}

test('after thirteen queued frames the newest keyframe replaces old work and pending paint', t => {
  const f = fixture(t);
  f.push(true); const old = f.latest();
  old.output(1); f.paint();
  assert.deepEqual(f.outputs, [1]);
  for (let index = 0; index <= MAX_DECODE_QUEUE_SIZE; index++) f.push(false);
  assert.equal(old.decodeQueueSize, MAX_DECODE_QUEUE_SIZE + 1);
  f.push(false); // Overload drops this dependent frame, without repeatedly restarting.
  assert.equal(f.remote.getMetrics().waitingForKey, true);
  assert.equal(SlowDecoder.instances.length, 1);
  const stale = old.output(2); // Its scheduled paint must also be discarded on recovery.
  f.push(true, 99);
  const fresh = f.latest();
  assert.notEqual(fresh, old);
  assert.equal(old.closeCalls, 1);
  assert.equal(stale.closeCalls, 1);
  assert.equal(f.frames.size, 0);
  assert.equal(fresh.decodeQueueSize, 1);
  assert.equal(f.remote.getMetrics().renderedCount, 1, 'recovery preserves cumulative statistics');
  fresh.output(99); f.paint();
  assert.deepEqual(f.painted, [1, 99]);
  assert.deepEqual(f.outputs, [1, 2]);
  assert.equal(f.remote.getMetrics().waitingForKey, false);
});

test('one hundred consecutive keyframes cannot grow the decode queue without limit', t => {
  const f = fixture(t);
  for (let index = 0; index < 100; index++) {
    f.push(true, index);
    assert.ok(f.latest().decodeQueueSize <= MAX_DECODE_QUEUE_SIZE + 1);
  }
  assert.ok(SlowDecoder.instances.length > 1);
  assert.equal(SlowDecoder.instances.slice(0, -1).every(decoder => decoder.closeCalls === 1), true);
  assert.ok(f.remote.getMetrics().droppedCount > 0);
  f.latest().output(99); f.paint();
  assert.deepEqual(f.painted, [99]);
});

test('late output, errors and animation callbacks from the old generation cannot affect recovery', t => {
  const f = fixture(t);
  f.push(true); const old = f.latest();
  old.output(0); // A pending rAF belongs to the old generation.
  for (let index = 0; index <= MAX_DECODE_QUEUE_SIZE; index++) f.push(false);
  f.push(true, 42); const fresh = f.latest();
  fresh.output(42);
  const late = old.output(7);
  old.callbacks.error(new DOMException('late decoder failure'));
  for (const callback of f.cancelled) callback(0);
  assert.equal(late.closeCalls, 1);
  assert.equal(f.frames.size, 1, 'a cancelled old rAF must not consume the fresh pending frame');
  f.paint();
  assert.deepEqual(f.painted, [42]);
  assert.deepEqual(f.errors, []);
  assert.equal(fresh.state, 'configured');
});

test('closing releases decoder, pending frame and rAF and rejects all stale callbacks', t => {
  const f = fixture(t);
  f.push(true); const decoder = f.latest();
  const pending = decoder.output(1);
  f.remote.close();
  assert.equal(decoder.closeCalls, 1);
  assert.equal(pending.closeCalls, 1);
  assert.equal(f.frames.size, 0);
  const late = decoder.output(2);
  decoder.callbacks.error(new DOMException('late close error'));
  for (const callback of f.cancelled) callback(0);
  assert.equal(late.closeCalls, 1);
  assert.deepEqual(f.painted, []);
  assert.deepEqual(f.errors, []);
  assert.equal(f.remote.getMetrics().renderedCount, 0);
});

test('normally draining video keeps its decoder and does not lose the first keyframe', t => {
  const f = fixture(t);
  for (let index = 0; index < 50; index++) {
    f.push(index % 10 === 0, index);
    f.latest().output(index); f.paint();
  }
  assert.equal(SlowDecoder.instances.length, 1);
  assert.equal(f.latest().closeCalls, 0);
  assert.equal(f.remote.getMetrics().droppedCount, 0);
  assert.equal(f.remote.getMetrics().renderedCount, 50);
  assert.equal(f.refreshes(), 0);
});
