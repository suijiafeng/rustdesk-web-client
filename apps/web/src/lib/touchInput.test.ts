// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTouchEffects, isNarrowViewport } from './touchInput.ts';

const map = (x: number, y: number) => ({ x: Math.floor(x), y: Math.floor(y) });

test('a narrow viewport is the mobile layout and a tap becomes one click', () => {
  assert.equal(isNarrowViewport(390), true);
  assert.equal(isNarrowViewport(1280), false);
  const tap = applyTouchEffects(
    [{ type: 'tap-click', x: 12.4, y: 8.2 }],
    { x: 0, y: 0 },
    map,
    false,
    1,
    false,
  );
  assert.deepEqual(
    tap.messages.map((message) => message.type === 'mouse' ? message.action : ''),
    ['move', 'down', 'up'],
  );
});

test('long-press is a right click, drag releases on cancel, and view-only blocks new input', () => {
  const press = applyTouchEffects([{ type: 'long-press', x: 4, y: 5 }], { x: 0, y: 0 }, map, false, 1, false);
  const right = press.messages.find((message) => message.type === 'mouse' && message.action === 'down');
  assert.equal(right?.type === 'mouse' ? right.button : '', 'right');

  const blocked = applyTouchEffects(
    [{ type: 'tap-click', x: 1, y: 1 }, { type: 'three-finger-scroll', ticks: 2 }],
    { x: 0, y: 0 },
    map,
    true,
    1,
    false,
  );
  assert.deepEqual(blocked.messages, []);

  const released = applyTouchEffects([{ type: 'release-stuck-drag', x: 3, y: 4 }], { x: 1, y: 1 }, map, true, 1, false);
  assert.equal(released.messages[0]?.type === 'mouse' ? released.messages[0].action : '', 'up');
});

test('pinch and pan stay local view changes', () => {
  const pinch = {
    type: 'pinch' as const,
    prevMidX: 1, prevMidY: 2, prevDist: 10, nextMidX: 3, nextMidY: 4, nextDist: 20,
  };
  const outcome = applyTouchEffects([pinch, { type: 'pan', dx: 5, dy: -2 }], { x: 0, y: 0 }, map, false, 1, false);
  assert.equal(outcome.messages.length, 0);
  assert.deepEqual(outcome.pan, { dx: 5, dy: -2 });
  assert.equal(outcome.pinch?.nextDist, 20);
});
