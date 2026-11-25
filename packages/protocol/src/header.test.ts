// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAME_HEADER_LENGTH, hasRoomForHeader } from './index.ts';

test('a buffer can hold a frame header only when it is long enough', () => {
  assert.equal(FRAME_HEADER_LENGTH, 32);
  assert.equal(hasRoomForHeader(32), true);
  assert.equal(hasRoomForHeader(33), true);
  assert.equal(hasRoomForHeader(31), false);
  assert.equal(hasRoomForHeader(0), false);
  assert.equal(hasRoomForHeader(-1), false);
  assert.equal(hasRoomForHeader(1.5), false);
  assert.equal(hasRoomForHeader(Number.NaN), false);
});
