import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DISPLAY_PREFS,
  applyMouseButtonSwap,
  applyWheelDirection,
  filterCodecSupport,
  normalizeDisplayPrefs,
} from './displayPrefs';

test('normalizeDisplayPrefs restores safe defaults and clamps bounds', () => {
  const empty = normalizeDisplayPrefs(null);
  assert.deepEqual(empty, DEFAULT_DISPLAY_PREFS);

  const normalized = normalizeDisplayPrefs({
    viewStyle: 'original',
    scrollStyle: 'scrollbar',
    qualityPreset: 'custom',
    customBitrate: 999,
    customFps: 3,
    codec: 'vp9',
    viewOnly: true,
    showRemoteCursor: false,
    disableClipboard: true,
    lockAfterSessionEnd: true,
    reverseMouseWheel: true,
    swapMouseButtons: true,
  });

  assert.equal(normalized.viewStyle, 'original');
  assert.equal(normalized.scrollStyle, 'scrollbar');
  assert.equal(normalized.qualityPreset, 'custom');
  assert.equal(normalized.customBitrate, 200);
  assert.equal(normalized.targetFps, 10);
  assert.equal(normalized.codec, 'vp9');
  assert.equal(normalized.viewOnly, true);
  assert.equal(normalized.showRemoteCursor, false);
  assert.equal(normalized.disableClipboard, true);
  assert.equal(normalized.lockAfterSessionEnd, true);
  assert.equal(normalized.reverseMouseWheel, true);
  assert.equal(normalized.swapMouseButtons, true);
});

test('legacy quality preferences migrate their effective FPS and retain a continuous quality ratio', () => {
  assert.equal(normalizeDisplayPrefs({ qualityPreset: 'best', customFps: 30 }).targetFps, 60);
  assert.equal(normalizeDisplayPrefs({ qualityPreset: 'low', customFps: 30 }).targetFps, 15);
  assert.equal(normalizeDisplayPrefs({ qualityPreset: 'custom', customFps: 45 }).targetFps, 45);
  const custom = normalizeDisplayPrefs({ qualityPreset: 'custom', customBitrate: 75, customFps: 45 });
  assert.equal(custom.qualityPreset, 'custom');
  assert.equal(custom.customBitrate, 76);
  assert.equal(normalizeDisplayPrefs({ customBitrate: 10 }).customBitrate, 20);
  assert.equal(normalizeDisplayPrefs({ customBitrate: 100 }).customBitrate, 100);
});

test('new FPS preferences remain independent of quality presets after persistence', () => {
  for (const qualityPreset of ['low', 'balanced', 'best', 'custom']) {
    const prefs = normalizeDisplayPrefs({ qualityPreset, targetFps: 25, customFps: 60 });
    assert.equal(prefs.targetFps, 25);
    assert.equal(normalizeDisplayPrefs(JSON.parse(JSON.stringify(prefs))).targetFps, 25);
  }
  assert.equal(normalizeDisplayPrefs({ targetFps: 999 }).targetFps, 60);
  assert.equal(normalizeDisplayPrefs({ targetFps: 0 }).targetFps, 10);
});

test('filterCodecSupport disables AV1 in auto mode when faster codecs exist, isolates explicit codecs, and falls back gracefully', () => {
  const support = {
    vp8: true,
    vp9: true,
    h264: true,
    h265: false,
    av1: true,
    reported: true,
  };

  assert.deepEqual(filterCodecSupport(support, 'auto'), {
    vp8: true,
    vp9: true,
    h264: true,
    h265: false,
    av1: false,
    reported: true,
  });
  assert.deepEqual(filterCodecSupport(support, 'av1'), {
    vp8: false,
    vp9: false,
    h264: false,
    h265: false,
    av1: true,
    reported: true,
  });
  assert.deepEqual(filterCodecSupport(support, 'vp9'), {
    vp8: false,
    vp9: true,
    h264: false,
    h265: false,
    av1: false,
    reported: true,
  });
  // Unsupported preferred codec falls back to auto (AV1 disabled when faster codecs exist)
  assert.deepEqual(filterCodecSupport(support, 'h265'), {
    vp8: true,
    vp9: true,
    h264: true,
    h265: false,
    av1: false,
    reported: true,
  });
});

test('mouse button swap and wheel inversion behave deterministically', () => {
  assert.equal(applyMouseButtonSwap('left', false), 'left');
  assert.equal(applyMouseButtonSwap('left', true), 'right');
  assert.equal(applyMouseButtonSwap('right', true), 'left');
  assert.equal(applyMouseButtonSwap('middle', true), 'middle');

  assert.equal(applyWheelDirection(1, false), 1);
  assert.equal(applyWheelDirection(1, true), -1);
  assert.equal(applyWheelDirection(-1, true), 1);
  assert.equal(applyWheelDirection(0, true), 0);
});
