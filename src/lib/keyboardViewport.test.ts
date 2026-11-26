import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardSpaceToReserve, keyboardView, virtualKeyboardHeight } from './keyboardViewport.ts';

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

test('virtual keyboard reuses the native height and fills only the space that has been released', () => {
  const fullHeight = 740;
  const keyboardHeight = virtualKeyboardHeight(fullHeight, false, 274);
  assert.equal(keyboardHeight, 274);
  for (const visibleHeight of [466, 510, 650, 740]) {
    const reserved = keyboardSpaceToReserve(fullHeight, visibleHeight, keyboardHeight);
    assert.equal(visibleHeight - reserved, 466);
  }
});

test('keyboard height falls back to the current orientation and leaves room for the remote view', () => {
  assert.equal(virtualKeyboardHeight(740, false), 252);
  assert.equal(virtualKeyboardHeight(390, true), 172);
  assert.equal(virtualKeyboardHeight(140, true, 126), 12);
  assert.equal(keyboardSpaceToReserve(740, 410, 274), 0);
});
