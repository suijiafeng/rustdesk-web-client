// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

interface Rect { left: number; top: number; right: number; bottom: number }

export function dropdownPosition(anchor: Rect, bounds: Rect, width: number, height: number) {
  const gap = 6;
  const below = Math.max(0, bounds.bottom - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - bounds.top - gap);
  const side = height <= below || below >= above ? 'bottom' : 'top';
  const maxHeight = Math.min(height, side === 'bottom' ? below : above, Math.max(0, bounds.bottom - bounds.top));
  const fittedWidth = Math.min(width, Math.max(0, bounds.right - bounds.left));
  return {
    side,
    left: Math.max(bounds.left, Math.min(anchor.right - fittedWidth, bounds.right - fittedWidth)),
    top: Math.max(bounds.top, Math.min(side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - maxHeight, bounds.bottom - maxHeight)),
    width: fittedWidth,
    maxHeight,
  };
}
