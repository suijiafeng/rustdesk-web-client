import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardView } from './keyboardViewport.ts';

test('fit view leaves the entire desktop above the keyboard and function bar', () => {
  const view = keyboardView(390, 160, 1920, 1080, 'fit', { scale: 0.203125, panX: 0, panY: 300 }, { x: 1000, y: 1000 });
  assert.ok(view.panX >= 0 && view.panY >= 0);
  assert.ok(view.panX + 1920 * view.scale <= 390);
  assert.ok(view.panY + 1080 * view.scale <= 160);
});

test('a zoomed input hidden by the keyboard is revealed without changing text size', () => {
  const view = keyboardView(390, 454, 1280, 720, 'custom', { scale: 1, panX: -500, panY: 20 }, { x: 600, y: 650 });
  assert.equal(view.scale, 1);
  assert.equal(view.panX, -500);
  const inputY = 650 + view.panY;
  assert.ok(inputY >= 48 && inputY <= 454 - 48);
});

test('an already-visible zoomed input does not move when the keyboard appears', () => {
  const before = { scale: 1, panX: -500, panY: -200 };
  assert.deepEqual(keyboardView(390, 454, 1280, 720, 'custom', before, { x: 600, y: 400 }), before);
});
