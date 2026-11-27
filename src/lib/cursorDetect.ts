export interface CursorShape {
  pixels: ImageData;
  hotX: number;
  hotY: number;
}

/**
 * Detects whether a remote cursor bitmap looks like a vertical text I-beam cursor
 * (narrow middle stem with wider top/bottom caps and centered hotspot).
 */
export function isTextBeamCursor(cursorShape: CursorShape | null): boolean {
  if (!cursorShape) return false;
  const { pixels, hotX, hotY } = cursorShape;
  // Ignore transparent padding. An I-beam has narrow middle rows and wider caps.
  const widths: number[] = [];
  let left = pixels.width;
  let right = -1;

  for (let y = 0; y < pixels.height; y++) {
    let first = pixels.width;
    let last = -1;
    for (let x = 0; x < pixels.width; x++) {
      if (pixels.data[(y * pixels.width + x) * 4 + 3] < 96) continue;
      first = Math.min(first, x);
      last = x;
    }
    widths.push(Math.max(0, last - first + 1));
    left = Math.min(left, first);
    right = Math.max(right, last);
  }

  const top = widths.findIndex((w) => w > 0);
  if (top < 0) return false;

  let bottom = widths.length - 1;
  while (!widths[bottom]) bottom--;

  const height = bottom - top + 1;
  const width = right - left + 1;
  const cap = Math.max(1, Math.floor(height / 4));
  const stem = widths.slice(top + cap, bottom - cap + 1);

  return (
    height >= 8 &&
    height >= width * 1.4 &&
    Math.abs(hotX - (left + right) / 2) <= Math.max(1, width / 4) &&
    Math.abs(hotY - (top + bottom) / 2) <= height / 3 &&
    stem.every((w) => w > 0 && w <= width * 0.7) &&
    Math.max(...widths.slice(top, top + cap)) >= width * 0.8 &&
    Math.max(...widths.slice(bottom - cap + 1, bottom + 1)) >= width * 0.8
  );
}
