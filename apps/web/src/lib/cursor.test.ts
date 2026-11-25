// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCursorPixels, isTextCursorTap } from './cursor.ts';

const cursor = { x: 100, y: 100 };

function shape(fill: (x: number, y: number) => boolean) {
  const width = 12;
  const height = 16;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (fill(x, y)) pixels[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, hotX: 5, hotY: 7, rgba: pixels.toString('base64') };
}

test('only taps near a centered text cursor trigger the keyboard', () => {
  const textCursor = shape((x, y) => y >= 2 && y <= 13
    && (y === 2 || y === 13 ? x >= 3 && x <= 7 : x === 5));
  assert.equal(isTextCursorTap({ x: 104, y: 104 }, cursor, textCursor), true);
  assert.equal(isTextCursorTap({ x: 109, y: 100 }, cursor, textCursor), false);
  assert.equal(isTextCursorTap(cursor, cursor, { ...textCursor, hotX: 0 }), false);
  assert.equal(isTextCursorTap(cursor, cursor, shape((x, y) => x === 5 && y >= 2 && y <= 13)), false);
  assert.equal(isTextCursorTap(cursor, cursor, shape((x, y) => x <= Math.floor(y / 2))), false);
});

test('invalid cursor bitmaps do not trigger the keyboard', () => {
  const transparent = shape(() => false);
  assert.equal(isTextCursorTap(cursor, cursor, transparent), false);
  assert.equal(decodeCursorPixels({ ...transparent, rgba: '!' }), null);
  assert.equal(decodeCursorPixels({ ...transparent, rgba: 'AAAA' }), null);
});
