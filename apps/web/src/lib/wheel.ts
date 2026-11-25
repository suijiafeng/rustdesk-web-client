// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export const WHEEL_PIXELS_PER_TICK = 36;
export const MAX_WHEEL_TICKS_PER_EVENT = 6;

/** Converts a browser wheel delta into RustDesk ticks. Positive Y scrolls up, opposite of DOM deltaY. */
export function accumulateWheelTicks(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  accumX: number,
  accumY: number,
  reverseVertical: boolean,
): { tx: number; ty: number; nextAccumX: number; nextAccumY: number } {
  const clampTicks = (n: number) =>
    Math.max(-MAX_WHEEL_TICKS_PER_EVENT, Math.min(MAX_WHEEL_TICKS_PER_EVENT, n));

  let rawTx = 0;
  let rawTy = 0;
  let nextAccumX = accumX;
  let nextAccumY = accumY;

  if (deltaMode === 1) {
    rawTx = deltaX !== 0 ? Math.trunc(deltaX) || Math.sign(deltaX) : 0;
    rawTy = deltaY !== 0 ? Math.trunc(deltaY) || Math.sign(deltaY) : 0;
    nextAccumX = 0;
    nextAccumY = 0;
  } else if (deltaMode === 2) {
    rawTx = Math.sign(deltaX) * 6;
    rawTy = Math.sign(deltaY) * 6;
    nextAccumX = 0;
    nextAccumY = 0;
  } else {
    if (deltaX !== 0 && nextAccumX !== 0 && Math.sign(deltaX) !== Math.sign(nextAccumX)) nextAccumX = 0;
    if (deltaY !== 0 && nextAccumY !== 0 && Math.sign(deltaY) !== Math.sign(nextAccumY)) nextAccumY = 0;
    nextAccumX += deltaX;
    nextAccumY += deltaY;

    if (Math.abs(nextAccumX) >= WHEEL_PIXELS_PER_TICK) {
      rawTx = Math.trunc(nextAccumX / WHEEL_PIXELS_PER_TICK);
      nextAccumX -= rawTx * WHEEL_PIXELS_PER_TICK;
    } else if (Math.abs(deltaX) >= 8 && Math.abs(nextAccumX) >= 16) {
      rawTx = Math.sign(nextAccumX);
      nextAccumX = 0;
    }

    if (Math.abs(nextAccumY) >= WHEEL_PIXELS_PER_TICK) {
      rawTy = Math.trunc(nextAccumY / WHEEL_PIXELS_PER_TICK);
      nextAccumY -= rawTy * WHEEL_PIXELS_PER_TICK;
    } else if (Math.abs(deltaY) >= 8 && Math.abs(nextAccumY) >= 16) {
      rawTy = Math.sign(nextAccumY);
      nextAccumY = 0;
    }
  }

  const rawClampedX = clampTicks(rawTx);
  const verticalDir = -rawTy;
  const rawClampedY = clampTicks(reverseVertical ? -verticalDir : verticalDir);
  return {
    tx: rawClampedX === 0 ? 0 : rawClampedX,
    ty: rawClampedY === 0 ? 0 : rawClampedY,
    nextAccumX,
    nextAccumY,
  };
}
