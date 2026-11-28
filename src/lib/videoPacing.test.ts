import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceVideoPacing, createVideoPacing, type VideoPacingSample } from './videoPacing.ts';

function fixture(targetFps = 30) {
  let state = createVideoPacing(targetFps);
  const changes: { at: number; fps: number }[] = [];
  return {
    get state() { return state; },
    changes,
    sample(nowMs: number, overrides: Partial<VideoPacingSample> = {}) {
      const result = advanceVideoPacing(state, {
        nowMs, visible: true, decodedCount: Math.floor(nowMs / 250) + 1,
        inFlightFrames: 0, oldestFrameAgeMs: 0, decodeLatencyMs: 10,
        backlogRecoveryCount: 0,
        ...overrides,
      });
      state = result.state;
      if (result.fps !== undefined) changes.push({ at: nowMs, fps: result.fps });
      return result.fps;
    },
  };
}

const loaded = { inFlightFrames: 5, oldestFrameAgeMs: 300, decodeLatencyMs: 140 };

test('persistent native decode work reduces the cap even when the public decoder queue is empty', () => {
  const f = fixture();
  for (let now = 0; now <= 2750; now += 250) f.sample(now, loaded);
  assert.deepEqual(f.changes, [{ at: 750, fps: 22 }, { at: 2750, fps: 16 }]);
  assert.equal(f.state.targetFps, 30, 'automatic feedback never changes the user preference');
});

test('one decode spike and an old latency value cannot keep reducing an idle desktop', () => {
  const f = fixture();
  f.sample(0);
  f.sample(250, loaded);
  for (let now = 500; now <= 15000; now += 250) {
    f.sample(now, { decodedCount: 2, decodeLatencyMs: 600 });
  }
  assert.deepEqual(f.changes, []);
});

test('cold initialization has a grace period but a decoder that never outputs still triggers feedback', () => {
  const f = fixture();
  for (let now = 0; now < 2750; now += 250) f.sample(now, { ...loaded, decodedCount: 0 });
  assert.deepEqual(f.changes, []);
  f.sample(2750, { ...loaded, decodedCount: 0 });
  assert.deepEqual(f.changes, [{ at: 2750, fps: 22 }]);
});

test('background samples and suspended timers do not count toward a congestion or recovery window', () => {
  const f = fixture();
  f.sample(0, loaded);
  f.sample(250, loaded);
  f.sample(500, { ...loaded, visible: false });
  f.sample(6000, loaded);
  f.sample(6250, loaded);
  f.sample(6500, loaded);
  assert.deepEqual(f.changes, []);
  f.sample(6750, loaded);
  f.sample(7000, loaded);
  assert.deepEqual(f.changes, [{ at: 7000, fps: 22 }]);
});

test('sustained healthy low-rate output recovers gradually without requiring an output each sample', () => {
  const f = fixture();
  for (let now = 0; now <= 750; now += 250) f.sample(now, loaded);
  // A new output every 500ms is activity; no single 250ms sample is required to contain a frame.
  for (let now = 1000; now <= 17000; now += 250) {
    f.sample(now, { decodedCount: 4 + Math.floor((now - 1000) / 500) });
  }
  assert.deepEqual(f.changes, [{ at: 750, fps: 22 }, { at: 9000, fps: 24 }, { at: 17000, fps: 26 }]);
});

test('a static desktop does not raise a reduced cap and recovery never exceeds the user limit', () => {
  const f = fixture(10);
  for (let now = 0; now <= 750; now += 250) f.sample(now, loaded);
  for (let now = 1000; now <= 12000; now += 250) f.sample(now, { decodedCount: 4 });
  assert.deepEqual(f.changes, [{ at: 750, fps: 7 }]);
  for (let now = 12250; now <= 40000; now += 250) f.sample(now);
  assert.deepEqual(f.changes.map(change => change.fps), [7, 9, 10]);
});

test('continued overload bottoms out without duplicate commands and manual settings start a fresh cap', () => {
  const f = fixture(10);
  for (let now = 0; now <= 20000; now += 250) f.sample(now, loaded);
  assert.deepEqual(f.changes.map(change => change.fps), [7, 5]);
  assert.equal(createVideoPacing(24).effectiveFps, 24);
  assert.equal(createVideoPacing(15).pressureSince, null);
});

test('a slower decoder recovers from the minimum only when the next FPS step leaves processing headroom', () => {
  const f = fixture(10);
  for (let now = 0; now <= 3000; now += 250) f.sample(now, loaded);
  assert.equal(f.state.effectiveFps, 5);
  for (let now = 3250; now <= 25000; now += 250) f.sample(now, { decodeLatencyMs: 90 });
  assert.deepEqual(f.changes.map(change => change.fps), [7, 5, 7]);
  assert.equal(f.state.effectiveFps, 7, '90ms fits 7FPS with headroom, but not the next 9FPS step');
});

test('two recent recoveries reduce FPS once and consumed events cannot penalize later samples again', () => {
  const f = fixture();
  f.sample(0);
  f.sample(250, { backlogRecoveryCount: 1 });
  assert.deepEqual(f.changes, []);
  f.sample(500, { backlogRecoveryCount: 2 });
  for (let now = 750; now <= 2500; now += 250) f.sample(now, { backlogRecoveryCount: 2 });
  assert.deepEqual(f.changes, [{ at: 500, fps: 22 }]);
  f.sample(2750, { backlogRecoveryCount: 3 });
  f.sample(3000, { backlogRecoveryCount: 4 });
  assert.deepEqual(f.changes, [{ at: 500, fps: 22 }, { at: 3000, fps: 16 }]);
});

test('background and expired recoveries do not combine with a later isolated recovery', () => {
  const f = fixture();
  f.sample(0);
  f.sample(250, { visible: false, backlogRecoveryCount: 3 });
  f.sample(500, { backlogRecoveryCount: 3 });
  f.sample(750, { backlogRecoveryCount: 4 });
  for (let now = 1000; now <= 5000; now += 250) f.sample(now, { backlogRecoveryCount: 4 });
  f.sample(5250, { backlogRecoveryCount: 5 });
  assert.deepEqual(f.changes, []);
  f.sample(5500, { backlogRecoveryCount: 6 });
  assert.deepEqual(f.changes, [{ at: 5500, fps: 22 }]);
});

test('overload sacrifices preset quality before FPS and recovers FPS before restoring quality', () => {
  let state = createVideoPacing(30, 'best');
  const events: Array<{ at: number; fps?: number; quality?: string }> = [];
  const step = (nowMs: number, overrides: Partial<VideoPacingSample> = {}) => {
    const res = advanceVideoPacing(state, {
      nowMs, visible: true, decodedCount: Math.floor(nowMs / 250) + 1,
      inFlightFrames: 0, oldestFrameAgeMs: 0, decodeLatencyMs: 10,
      backlogRecoveryCount: 0, ...overrides,
    });
    state = res.state;
    if (res.fps !== undefined || res.quality !== undefined) {
      events.push({ at: nowMs, ...(res.fps !== undefined && { fps: res.fps }), ...(res.quality !== undefined && { quality: res.quality }) });
    }
  };
  for (let now = 0; now <= 5500; now += 250) step(now, loaded);
  assert.deepEqual(events, [
    { at: 750, fps: 30, quality: 'balanced' },
    { at: 2750, fps: 30, quality: 'low' },
    { at: 4750, fps: 22 },
  ]);
  events.length = 0;
  for (let now = 5750; now <= 60000; now += 250) step(now);
  assert.equal(state.effectiveFps, 30);
  assert.equal(state.effectiveQuality, 'best');
  const firstQualityRestore = events.findIndex(e => e.quality === 'balanced');
  const lastFpsRestore = events.reduce((last, e, idx) => (e.quality === undefined ? idx : last), -1);
  assert.ok(lastFpsRestore >= 0 && firstQualityRestore > lastFpsRestore, 'FPS should recover before quality restores');
});

test('overload steps down custom quality ratio before reducing FPS', () => {
  let state = createVideoPacing(30, 'custom', 60);
  const events: Array<{ quality?: string; customQuality?: number; fps?: number }> = [];
  for (let now = 0; now <= 9000; now += 250) {
    const res = advanceVideoPacing(state, {
      nowMs: now, visible: true, decodedCount: Math.floor(now / 250) + 1,
      ...loaded, backlogRecoveryCount: 0,
    });
    state = res.state;
    if (res.fps !== undefined || res.quality !== undefined || res.customQuality !== undefined) {
      events.push({ quality: res.quality, customQuality: res.customQuality, fps: res.fps });
    }
  }
  assert.equal(events[0]?.quality, 'custom');
  assert.equal(events[0]?.customQuality, 44);
  assert.equal(events[0]?.fps, 30);
  assert.ok(events.some(e => e.customQuality === 20 && e.fps === 30));
  assert.ok(events.some(e => e.quality === undefined && e.fps === 22));
});
