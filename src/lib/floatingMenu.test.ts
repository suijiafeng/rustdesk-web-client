import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampToolbarPixelX,
  clampToolbarX,
} from './floatingMenu';

test('clampToolbarX constrains desktop handle ratio within safe bounds', () => {
  assert.equal(clampToolbarX(0.5), 0.5);
  assert.equal(clampToolbarX(-0.2), 0.12);
  assert.equal(clampToolbarX(1.5), 0.88);
  assert.equal(clampToolbarX(Number.NaN), 0.5);
});

test('clampToolbarPixelX prevents expanded desktop toolbar from clipping off edges', () => {
  // 1440px viewport, 600px bar -> center must stay in [312, 1128]
  assert.equal(clampToolbarPixelX(0.12, 600, 1440, 12), 312);
  assert.equal(clampToolbarPixelX(0.88, 600, 1440, 12), 1128);
  assert.equal(clampToolbarPixelX(0.5, 600, 1440, 12), 720);
});
