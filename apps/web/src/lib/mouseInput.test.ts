// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coalesceMove,
  desktopPointerButton,
  pointerDownMessages,
  pointerUpMessages,
  releaseHeldButton,
  remotePoint,
  repeatedClickMessages,
  wheelMessages,
} from './mouseInput.ts';

test('desktop buttons map to left, right, and middle, and can be swapped', () => {
  assert.equal(desktopPointerButton(0, false), 'left');
  assert.equal(desktopPointerButton(2, false), 'right');
  assert.equal(desktopPointerButton(1, false), 'middle');
  assert.equal(desktopPointerButton(0, true), 'right');
  assert.equal(desktopPointerButton(5, false), null);
});

test('press, release, and double-click stay paired, and view-only sends nothing', () => {
  const point = { x: 10, y: 20 };
  assert.deepEqual(pointerDownMessages('left', point, true), []);
  const down = pointerDownMessages('right', point, false);
  assert.deepEqual(down.map((message) => message.type === 'mouse' && message.action), ['move', 'down']);
  const up = pointerUpMessages('right', point, false);
  const last = up.at(-1);
  assert.equal(last?.type === 'mouse' ? last.action : '', 'up');
  const doubleClick = repeatedClickMessages('left', point, 2);
  assert.equal(doubleClick.length, 6);
  assert.deepEqual(
    doubleClick.map((message) => (message.type === 'mouse' ? message.action : '')),
    ['move', 'down', 'up', 'move', 'down', 'up'],
  );
});

test('blur releases the held button and move throttling keeps only the latest point', () => {
  assert.deepEqual(releaseHeldButton(null, { x: 1, y: 2 }), []);
  const released = releaseHeldButton('left', { x: 4, y: 5 });
  const release = released[0];
  assert.equal(release?.type === 'mouse' ? release.action : '', 'up');
  assert.deepEqual(coalesceMove({ x: 1, y: 1 }, { x: 9, y: 8 }), { x: 9, y: 8 });
  assert.deepEqual(coalesceMove({ x: 1, y: 1 }, null), { x: 1, y: 1 });
});

test('clicks outside the picture are ignored and drags stay inside the remote desktop', () => {
  const transform = { scale: 0.5, panX: 100, panY: 50 };
  assert.equal(remotePoint(0, 0, 1280, 720, transform, false), null);
  assert.deepEqual(remotePoint(0, 0, 1280, 720, transform, true), { x: 0, y: 0 });
  assert.deepEqual(remotePoint(2000, 2000, 1280, 720, transform, true), { x: 1279, y: 719 });
});

test('vertical wheel is opposite the DOM delta and horizontal wheel is kept', () => {
  const vertical = wheelMessages(0, 120, 0, 0, 0, false, false);
  const verticalMessage = vertical.messages[0];
  assert.equal(verticalMessage?.type === 'mouse' ? verticalMessage.y : 0, -3);
  const horizontal = wheelMessages(120, 0, 0, 0, 0, false, false);
  const horizontalMessage = horizontal.messages[0];
  assert.equal(horizontalMessage?.type === 'mouse' ? horizontalMessage.x : 0, 3);
  assert.deepEqual(wheelMessages(0, 120, 0, 0, 0, false, true).messages, []);
});
