import assert from 'node:assert/strict';
import test from 'node:test';
import { isTextBeamCursor, type CursorShape } from './cursorDetect.ts';

function makeBitmap(rows: string[]): ImageData {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y][x] === '#') {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

test('isTextBeamCursor recognizes a vertical I-beam cursor', () => {
  const ibeam: CursorShape = {
    pixels: makeBitmap([
      '#######',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '#######',
    ]),
    hotX: 3,
    hotY: 5,
  };
  assert.equal(isTextBeamCursor(ibeam), true);
});

test('isTextBeamCursor rejects solid blocks, empty bitmaps, and off-center hotspots', () => {
  assert.equal(isTextBeamCursor(null), false);

  const solidBlock: CursorShape = {
    pixels: makeBitmap([
      '######',
      '######',
      '######',
      '######',
      '######',
      '######',
      '######',
      '######',
      '######',
    ]),
    hotX: 3,
    hotY: 4,
  };
  assert.equal(isTextBeamCursor(solidBlock), false);

  const offCenterHotspot: CursorShape = {
    pixels: makeBitmap([
      '#######',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '...#...',
      '#######',
    ]),
    hotX: 0,
    hotY: 0,
  };
  assert.equal(isTextBeamCursor(offCenterHotspot), false);
});
