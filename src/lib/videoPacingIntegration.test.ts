import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_DECODE_QUEUE_SIZE, RemoteDecoder } from './decoder.ts';
import { advanceVideoPacing, createVideoPacing } from './videoPacing.ts';

/** Exercise the real bounded decoder and pacer together, with a controllably slow native codec. */
function replay({ includeRecoveries = true, decodeMs = 300, paintEveryMs = 1 } = {}) {
  let nowMs = 10_000;
  let nextFrameAt = nowMs;
  let nextKeyAt = nowMs;
  let requestedKeyAt = Infinity;
  let nextSampleAt = nowMs + 100;
  let nextPaintAt = nowMs;
  let frameRequest = 0;
  let maxInFlight = 0;
  let pacing = createVideoPacing(30);
  const changes: number[] = [];
  const errors: string[] = [];
  const paints = new Map<number, FrameRequestCallback>();
  const instances: NativeDecoder[] = [];

  class NativeDecoder {
    state: CodecState = 'unconfigured';
    // Native admission is fast; the browser queue alone does not show the work below.
    decodeQueueSize = 0;
    private first = true;
    private availableAt = nowMs;
    private chunks: { chunk: EncodedVideoChunk; dueAt: number }[] = [];
    constructor(private callbacks: VideoDecoderInit) { instances.push(this); }
    configure() { this.state = 'configured'; }
    close() { this.state = 'closed'; this.chunks = []; }
    decode(chunk: EncodedVideoChunk) {
      this.availableAt = Math.max(nowMs, this.availableAt) + (this.first ? 20 : decodeMs);
      this.first = false;
      this.chunks.push({ chunk, dueAt: this.availableAt });
    }
    tick() {
      while (this.state === 'configured' && this.chunks[0]?.dueAt <= nowMs) {
        const { chunk } = this.chunks.shift()!;
        this.callbacks.output({ timestamp: chunk.timestamp, displayWidth: 640, displayHeight: 480,
          close() {} } as VideoFrame);
      }
    }
  }

  const globals = {
    performance: { now: () => nowMs }, VideoDecoder: NativeDecoder,
    EncodedVideoChunk: class { constructor(options: EncodedVideoChunkInit) { Object.assign(this, options); } },
    requestAnimationFrame: (callback: FrameRequestCallback) => { paints.set(++frameRequest, callback); return frameRequest; },
    cancelAnimationFrame: (id: number) => { paints.delete(id); },
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const canvas = { width: 640, height: 480, getContext: () => ({ drawImage() {} }) } as unknown as HTMLCanvasElement;
  const remote = new RemoteDecoder({ onOutput() {}, onError: message => errors.push(message),
    onNeedRefresh: () => { requestedKeyAt = nowMs + 5; } });

  try {
    for (; nowMs <= 25_000; nowMs++) {
      instances.at(-1)?.tick();
      if (nowMs >= nextFrameAt || nowMs >= requestedKeyAt) {
        const key = nowMs >= nextKeyAt || nowMs >= requestedKeyAt;
        if (key) { nextKeyAt = nowMs + 350; requestedKeyAt = Infinity; }
        remote.push({ codec: 1, codecName: 'vp8', key, display: 0, width: 640, height: 480,
          pts: nowMs, gatewayUnixMs: 0, data: Uint8Array.of(1) }, canvas);
        nextFrameAt = nowMs + 1000 / pacing.effectiveFps;
        maxInFlight = Math.max(maxInFlight, remote.getMetrics().inFlightFrames);
      }
      if (nowMs >= nextSampleAt) {
        remote.checkStall();
        const metrics = remote.getMetrics();
        const result = advanceVideoPacing(pacing, { ...metrics, nowMs, visible: true,
          backlogRecoveryCount: includeRecoveries ? metrics.backlogRecoveryCount : 0 });
        pacing = result.state;
        if (result.fps !== undefined) changes.push(result.fps);
        nextSampleAt += 250;
      }
      if (nowMs >= nextPaintAt) {
        const ready = [...paints.values()]; paints.clear();
        for (const paint of ready) paint(nowMs);
        nextPaintAt = nowMs + paintEveryMs;
      }
    }
    return { changes, errors, maxInFlight, metrics: remote.getMetrics(), effectiveFps: pacing.effectiveFps };
  } finally {
    remote.close();
    assert.equal(remote.getMetrics().backlogRecoveryCount, 0, 'closing starts a fresh recovery history');
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('repeated fast keyframe recovery cannot hide decode overload from the 250ms FPS sampler', t => {
  const withoutRecoverySignal = replay({ includeRecoveries: false });
  assert.ok(withoutRecoverySignal.metrics.backlogRecoveryCount >= 20);
  assert.deepEqual(withoutRecoverySignal.changes, [], 'cleared pending age repeatedly interrupts the old continuous-pressure rule');
  const corrected = replay();
  assert.ok(corrected.changes.length >= 2);
  assert.equal(corrected.changes[0], 22);
  assert.ok(corrected.effectiveFps <= 12);
  assert.ok(corrected.metrics.backlogRecoveryCount < withoutRecoverySignal.metrics.backlogRecoveryCount);
  assert.ok(corrected.maxInFlight <= MAX_DECODE_QUEUE_SIZE + 1);
  assert.ok(corrected.metrics.renderedCount > 0);
  assert.deepEqual(corrected.errors, []);
  t.diagnostic(`15s replay: recoveries ${withoutRecoverySignal.metrics.backlogRecoveryCount} → ${corrected.metrics.backlogRecoveryCount}; FPS feedback ${corrected.changes.join(' → ')}`);
});

test('ordinary latest-frame presentation drops do not count as backlog recoveries or reduce FPS', () => {
  const healthy = replay({ decodeMs: 5, paintEveryMs: 100 });
  assert.ok(healthy.metrics.droppedCount > 100, 'the slower display coalesces decoded frames');
  assert.equal(healthy.metrics.backlogRecoveryCount, 0);
  assert.deepEqual(healthy.changes, []);
  assert.equal(healthy.effectiveFps, 30);
});
