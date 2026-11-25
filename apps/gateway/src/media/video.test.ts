// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_VIDEO_BUFFERED_BYTES, shouldSendVideoFrame, vp8KeyframeSize } from './video.ts';

test('vp8KeyframeSize reads an uncompressed keyframe and rejects interframes', () => {
  const keyframe = new Uint8Array([0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x00, 0x05, 0xd0, 0x02]);
  assert.deepEqual(vp8KeyframeSize(keyframe), { width: 1280, height: 720 });
  const interframe = new Uint8Array([0x11, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x00, 0x05, 0xd0, 0x02]);
  assert.equal(vp8KeyframeSize(interframe), null);
});

test('delta frames are dropped once the browser socket is backed up, keyframes are kept', () => {
  assert.equal(shouldSendVideoFrame(0, false), true);
  assert.equal(shouldSendVideoFrame(MAX_VIDEO_BUFFERED_BYTES - 1, false), true);
  assert.equal(shouldSendVideoFrame(MAX_VIDEO_BUFFERED_BYTES, false), false);
  assert.equal(shouldSendVideoFrame(MAX_VIDEO_BUFFERED_BYTES * 4, true), true);
});
