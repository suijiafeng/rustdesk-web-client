// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

/** Scale a remote frame into a container without changing its aspect ratio. */
export function fitContain(
  containerWidth: number,
  containerHeight: number,
  frameWidth: number,
  frameHeight: number,
): { width: number; height: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(containerWidth / frameWidth, containerHeight / frameHeight);
  return { width: frameWidth * scale, height: frameHeight * scale };
}
