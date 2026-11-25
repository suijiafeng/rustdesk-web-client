import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropdownPosition } from './dropdownPosition';

test('bottom controls open upwards without covering the trigger', () => {
  const anchor = { left: 290, right: 374, top: 720, bottom: 760 };
  const result = dropdownPosition(anchor, { left: 8, right: 382, top: 8, bottom: 836 }, 180, 230);
  assert.equal(result.side, 'top');
  assert.ok(result.top + result.maxHeight < anchor.top);
  assert.ok(result.left + result.width <= 382);
});

test('uses available space below and keeps a left-edge trigger inside the screen', () => {
  const result = dropdownPosition({ left: 10, right: 90, top: 20, bottom: 60 }, { left: 8, right: 382, top: 8, bottom: 836 }, 180, 140);
  assert.equal(result.side, 'bottom');
  assert.equal(result.left, 8);
  assert.ok(result.top > 60);
});

test('landscape / keyboard viewport limits a long list to scrollable bounds', () => {
  const bounds = { left: 30, right: 310, top: 48, bottom: 260 };
  const result = dropdownPosition({ left: 240, right: 325, top: 170, bottom: 210 }, bounds, 360, 900);
  assert.equal(result.side, 'top');
  assert.ok(result.maxHeight < 900);
  assert.ok(result.left >= bounds.left && result.left + result.width <= bounds.right);
  assert.ok(result.top >= bounds.top && result.top + result.maxHeight <= bounds.bottom);
});
