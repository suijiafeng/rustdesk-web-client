import assert from 'node:assert/strict';
import test from 'node:test';
import { decodingPreferenceChanged } from './control.ts';
import { GatewayVideoBuffer } from './videoBuffer.ts';

const KiB = 1024;

test('gateway skips congested frames and resumes the affected display at a keyframe', () => {
  const buffer = new GatewayVideoBuffer();
  assert.equal(buffer.shouldForward(0, false, 64 * KiB, 1000 * KiB), false);
  assert.equal(buffer.shouldForward(0, false, 64 * KiB, 0), false);
  assert.equal(buffer.shouldForward(1, false, 64 * KiB, 0), true);
  assert.equal(buffer.shouldForward(0, true, 64 * KiB, 300 * KiB), false);
  assert.equal(buffer.droppedFrames, 3);
  assert.equal(buffer.shouldForward(0, true, 64 * KiB, 100 * KiB), true);
  assert.equal(buffer.shouldForward(0, false, 64 * KiB, 100 * KiB), true);
  assert.equal(buffer.recovering, false);
  assert.equal(buffer.shouldRequestRefresh(0, 0), false);
});

test('gateway permits one oversized keyframe and limits automatic refreshes', () => {
  const buffer = new GatewayVideoBuffer();
  assert.equal(buffer.shouldForward(0, true, 2048 * KiB, 32 * KiB), false);
  assert.equal(buffer.shouldRequestRefresh(300 * KiB, 0), false);
  assert.equal(buffer.shouldRequestRefresh(0, 0), true);
  assert.equal(buffer.shouldRequestRefresh(0, 1500), false);
  assert.equal(buffer.shouldForward(0, false, 32 * KiB, 0), false);
  assert.equal(buffer.shouldRequestRefresh(0, 500), false);
  assert.equal(buffer.shouldRequestRefresh(0, 1000), true);
  assert.equal(buffer.shouldForward(0, true, 2048 * KiB, 0), true);
  assert.equal(buffer.needsRefresh, false);
});

test('quality updates only require a refresh when decoder negotiation changes', () => {
  const codecs = { h264: true, h265: false, vp8: true, vp9: true, av1: true, reported: true };
  assert.equal(decodingPreferenceChanged(codecs, 'auto', undefined), false);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'auto'), false);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'h264'), false);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'h265'), false);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'vp9'), true);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'av1'), true);
  assert.equal(decodingPreferenceChanged(codecs, 'av1', 'auto'), true);
});
