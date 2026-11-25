// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { fitContain } from './frameFit.ts';

test('fitContain letterboxes a wide frame and pillarboxes a tall one', () => {
  const wide = fitContain(800, 400, 1920, 1080);
  assert.ok(Math.abs(wide.width / wide.height - 1920 / 1080) < 0.001);
  assert.ok(wide.width <= 800);
  assert.ok(wide.height <= 400);

  const tall = fitContain(400, 800, 1080, 1920);
  assert.ok(Math.abs(tall.width / tall.height - 1080 / 1920) < 0.001);
  assert.equal(fitContain(0, 100, 100, 100).width, 0);
});
