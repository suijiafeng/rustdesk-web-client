// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { CursorShape } from '@rustdesk-web/shared';
import type { Point } from './mapping.ts';

export function decodeCursorPixels({ width, height, rgba }: CursorShape): Uint8ClampedArray | null {
  try {
    const bytes = Uint8ClampedArray.from(atob(rgba), (character) => character.charCodeAt(0));
    return bytes.length === width * height * 4 && bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export function isTextCursorTap(point: Point, cursor: Point, shape: CursorShape): boolean {
  if (Math.hypot(point.x - cursor.x, point.y - cursor.y) > 8) return false;

  const pixels = decodeCursorPixels(shape);
  if (!pixels) return false;

  // Ignore transparent padding and check for the narrow stem and wide caps of an I-beam.
  const rows: number[] = [];
  let left = shape.width;
  let right = -1;
  for (let y = 0; y < shape.height; y += 1) {
    let first = shape.width;
    let last = -1;
    for (let x = 0; x < shape.width; x += 1) {
      if (pixels[(y * shape.width + x) * 4 + 3] < 96) continue;
      first = Math.min(first, x);
      last = x;
    }
    rows.push(Math.max(0, last - first + 1));
    left = Math.min(left, first);
    right = Math.max(right, last);
  }

  const top = rows.findIndex((width) => width > 0);
  if (top < 0) return false;
  let bottom = rows.length - 1;
  while (rows[bottom] === 0) bottom -= 1;
  const height = bottom - top + 1;
  const width = right - left + 1;
  if (height < 8 || height < width * 1.4) return false;
  if (Math.abs(shape.hotX - (left + right) / 2) > Math.max(1, width / 4)
    || Math.abs(shape.hotY - (top + bottom) / 2) > height / 3) return false;

  const cap = Math.floor(height / 4);
  return rows.slice(top + cap, bottom - cap + 1).every((row) => row > 0 && row <= width * 0.7)
    && Math.max(...rows.slice(top, top + cap)) >= width * 0.8
    && Math.max(...rows.slice(bottom - cap + 1, bottom + 1)) >= width * 0.8;
}
