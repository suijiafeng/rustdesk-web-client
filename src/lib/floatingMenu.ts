/**
 * Clamps the desktop top-edge toolbar/handle horizontal center ratio
 * so the collapsed tab never gets pushed into screen corners.
 */
export function clampToolbarX(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.88, Math.max(0.12, ratio));
}

/**
 * Computes a safe left-center pixel coordinate for an expanded floating toolbar
 * of width `barWidth` inside a viewport of width `viewportWidth`.
 */
export function clampToolbarPixelX(
  centerRatio: number,
  barWidth: number,
  viewportWidth: number,
  margin = 12,
): number {
  if (viewportWidth <= 0) return 0;
  const half = barWidth / 2;
  const minCenter = Math.min(viewportWidth / 2, half + margin);
  const maxCenter = Math.max(viewportWidth / 2, viewportWidth - half - margin);
  const desired = clampToolbarX(centerRatio) * viewportWidth;
  return Math.min(maxCenter, Math.max(minCenter, desired));
}
