// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import { zstdCompressSync } from 'node:zlib';
import test from 'node:test';
import { decodeMessage, encodeMessage } from '@rustdesk-web/protocol';
import { CursorShapes } from './cursor.ts';

test('cursor bitmaps are decoded, cached, and addressed by the host cursor id', () => {
  const pixels = Buffer.from([20, 40, 60, 255, 10, 30, 50, 128]);
  const id = { low: -1, high: -1, unsigned: true };
  const frame = encodeMessage({
    cursor_data: { id, width: 2, height: 1, hotx: 1, colors: zstdCompressSync(pixels) },
  });
  assert.equal(frame[0], 0x62);
  const cursorId = encodeMessage({ cursor_id: id });
  assert.equal(cursorId[0], 0x70);

  const shapes = new CursorShapes();
  const shape = shapes.decode(decodeMessage(frame).cursor_data);
  assert.deepEqual(shape, { width: 2, height: 1, hotX: 1, hotY: 0, rgba: pixels.toString('base64') });
  const decodedId = decodeMessage(cursorId).cursor_id;
  assert.equal(decodedId, '18446744073709551615');
  assert.deepEqual(shapes.get(decodedId), shape);
});

test('a malformed or oversized cursor bitmap is dropped', () => {
  const shapes = new CursorShapes();
  assert.equal(shapes.decode({ width: 1, height: 1, colors: Buffer.from('bad data') }), null);
  assert.equal(shapes.decode({ width: 1, height: 1, colors: zstdCompressSync(Buffer.alloc(8)) }), null);
  assert.equal(shapes.decode({ width: 0, height: 1, colors: zstdCompressSync(Buffer.alloc(4)) }), null);
});
