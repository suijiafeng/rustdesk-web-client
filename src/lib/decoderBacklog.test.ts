import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KEYFRAME_WAIT_REFRESH_MS, MAX_DECODE_QUEUE_SIZE, REFRESH_COOLDOWN_MS, RemoteDecoder } from './decoder.ts';
import type { VideoPacket } from './protocol.ts';

class SlowDecoder {
  static instances: SlowDecoder[] = [];
  static acceptsImmediately = false;
  state: CodecState = 'unconfigured';
  decodeQueueSize = 0;
  closeCalls = 0;
  chunks: EncodedVideoChunk[] = [];
  constructor(readonly callbacks: VideoDecoderInit) { SlowDecoder.instances.push(this); }
  configure() { this.state = 'configured'; }
  decode(chunk: EncodedVideoChunk) {
    this.chunks.push(chunk);
    if (!SlowDecoder.acceptsImmediately) this.decodeQueueSize++;
  }
  close() { this.closeCalls++; this.state = 'closed'; this.decodeQueueSize = 0; this.chunks = []; }
  output(id: number) {
    return this.outputTimestamp(id, this.chunks.shift()?.timestamp ?? 0);
  }
  outputTimestamp(id: number, timestamp: number) {
    const frame = { id, timestamp, displayWidth: 640, displayHeight: 480, closeCalls: 0,
      close() { this.closeCalls++; } };
    this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
    this.callbacks.output(frame as unknown as VideoFrame);
    return frame;
  }
}

function fixture(t: TestContext, acceptsImmediately = false) {
  SlowDecoder.instances = [];
  SlowDecoder.acceptsImmediately = acceptsImmediately;
  let nowMs = 10_000;
  const frames = new Map<number, FrameRequestCallback>();
  const cancelled: FrameRequestCallback[] = [];
  let sequence = 0;
  const globals = {
    performance: { now: () => nowMs },
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
    advance: (ms: number) => { nowMs += ms; },
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

test('one hundred consecutive keyframes remain bounded and give the first output a chance', t => {
  const f = fixture(t);
  for (let index = 0; index < 100; index++) {
    f.push(true, index);
    assert.ok(f.latest().decodeQueueSize <= MAX_DECODE_QUEUE_SIZE + 1);
  }
  assert.equal(SlowDecoder.instances.length, 1, 'burst admission must not repeatedly abort codec startup');
  assert.ok(f.remote.getMetrics().droppedCount > 0);
  f.latest().output(0); f.paint();
  f.push(true, 100);
  assert.equal(SlowDecoder.instances.length, 2, 'a new key can replace the old work after first output');
  f.latest().output(100); f.paint();
  assert.deepEqual(f.painted, [0, 100]);
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
  assert.equal(f.remote.getMetrics().inFlightFrames, 0);
  assert.equal(f.remote.getMetrics().oldestFrameAgeMs, 0);
  assert.equal(f.remote.getMetrics().decodeLatencyMs, 0);
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

test('codec-admitted frames stay bounded even when decodeQueueSize is always zero', t => {
  const f = fixture(t, true);
  f.push(true); const old = f.latest();
  old.output(0); f.paint();
  for (let index = 0; index < 90; index++) {
    f.advance(1000 / 30);
    f.push(false, index);
    assert.equal(f.latest().decodeQueueSize, 0);
    assert.ok(f.remote.getMetrics().inFlightFrames <= MAX_DECODE_QUEUE_SIZE + 1);
  }
  assert.equal(old.chunks.length, MAX_DECODE_QUEUE_SIZE + 1);
  assert.ok(f.remote.getMetrics().oldestFrameAgeMs > 2_900);
  assert.equal(f.remote.getMetrics().waitingForKey, true);
  assert.ok(f.refreshes() > 0);
  f.push(true, 99);
  assert.notEqual(f.latest(), old);
  assert.equal(old.closeCalls, 1);
  assert.equal(f.remote.getMetrics().inFlightFrames, 1);
  assert.equal(f.remote.getMetrics().oldestFrameAgeMs, 0);
  f.advance(25);
  f.latest().output(99); f.paint();
  assert.equal(f.remote.getMetrics().inFlightFrames, 0);
  assert.equal(f.remote.getMetrics().decodeLatencyMs, 25);
  assert.deepEqual(f.painted, [0, 99]);
});

test('age detects a stalled codec below the frame-count limit and requests a fresh key', t => {
  const f = fixture(t, true);
  f.push(true); const old = f.latest();
  old.output(0); f.paint();
  f.push(false);
  f.advance(KEYFRAME_WAIT_REFRESH_MS - 1);
  assert.equal(f.remote.getMetrics().oldestFrameAgeMs, KEYFRAME_WAIT_REFRESH_MS - 1);
  assert.equal(f.remote.getMetrics().inFlightFrames, 1);
  f.advance(1); f.push(false);
  assert.equal(f.remote.getMetrics().waitingForKey, true);
  assert.equal(f.remote.getMetrics().inFlightFrames, 1, 'stale work must stop further admission');
  assert.equal(f.refreshes(), 1);
  f.push(true, 77);
  assert.notEqual(f.latest(), old);
  f.latest().output(77); f.paint();
  assert.deepEqual(f.painted, [0, 77]);
});

test('polling recovers the last static-screen frame without another push or a reset loop', t => {
  const f = fixture(t, true);
  f.push(true); const decoder = f.latest();
  f.advance(KEYFRAME_WAIT_REFRESH_MS - 1); f.remote.checkStall();
  assert.equal(f.refreshes(), 0);
  f.advance(1); f.remote.checkStall();
  assert.equal(f.refreshes(), 1);
  assert.equal(f.remote.getMetrics().waitingForKey, true);
  for (let index = 0; index < 7; index++) {
    f.advance(250); f.remote.checkStall();
  }
  assert.equal(f.refreshes(), 1, 'polling shares the keyframe request cooldown');
  assert.equal(decoder.closeCalls, 0, 'polling must preserve the current codec first-output opportunity');
  f.advance(250); f.remote.checkStall();
  assert.equal(f.refreshes(), 2);
  f.push(true, 88);
  f.latest().output(88); f.paint();
  assert.deepEqual(f.painted, [88]);
  f.advance(10_000); f.remote.checkStall();
  assert.equal(f.refreshes(), 2, 'a completed static frame does not cause refresh loops');
  f.remote.close(); f.remote.checkStall();
  assert.equal(f.refreshes(), 2);
});

test('a codec taking 700ms for first output is not starved by frequent keyframes', t => {
  const f = fixture(t, true);
  f.push(true, 0); const first = f.latest();
  for (let index = 1; index <= 21; index++) {
    f.advance(1000 / 30); f.push(true, index);
  }
  assert.equal(SlowDecoder.instances.length, 1);
  assert.equal(first.closeCalls, 0);
  assert.equal(first.chunks.length, MAX_DECODE_QUEUE_SIZE + 1);
  first.output(0); f.paint();
  assert.deepEqual(f.painted, [0]);
  assert.ok(Math.abs(f.remote.getMetrics().decodeLatencyMs - 700) < 0.001);
  f.push(true, 22);
  f.latest().output(22); f.paint();
  assert.deepEqual(f.painted, [0, 22]);
});

test('a first-output stall can recover after the startup grace without looping on every key', t => {
  const f = fixture(t, true);
  f.push(true); const old = f.latest();
  for (let index = 0; index < 100; index++) f.push(true);
  f.advance(REFRESH_COOLDOWN_MS - 1); f.push(true);
  assert.equal(f.latest(), old);
  f.advance(1); f.push(true, 42);
  assert.notEqual(f.latest(), old);
  assert.equal(SlowDecoder.instances.length, 2);
  for (let index = 0; index < 100; index++) f.push(true);
  assert.equal(SlowDecoder.instances.length, 2);
  f.latest().output(42); f.paint();
  assert.deepEqual(f.painted, [42]);
});

test('newer output retires non-displayed inputs and late output cannot move the picture backwards', t => {
  const f = fixture(t, true);
  f.push(true); f.advance(5); f.push(false); f.advance(5); f.push(false);
  const decoder = f.latest();
  const timestamps = decoder.chunks.map(chunk => chunk.timestamp);
  f.advance(10);
  decoder.outputTimestamp(3, timestamps[2]); f.paint();
  assert.equal(f.remote.getMetrics().inFlightFrames, 0);
  assert.equal(f.remote.getMetrics().oldestFrameAgeMs, 0);
  assert.equal(f.remote.getMetrics().decodeLatencyMs, 10);
  const late = decoder.outputTimestamp(1, timestamps[0]);
  f.paint();
  assert.equal(late.closeCalls, 1);
  assert.deepEqual(f.painted, [3]);
});
