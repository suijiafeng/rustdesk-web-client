// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { clampPan, DEFAULT_EDGE_PADDING, fitScale, type Point, type ViewMode, type ViewTransform } from './mapping.ts';

/** A real on-screen keyboard is taller than the iOS URL-bar collapse (about 70–80px). */
export const KEYBOARD_APPEAR_PX = 120;
export const KEYBOARD_HIDE_PX = 48;
export const KEYBOARD_PENDING_MS = 1500;
export const ROTATE_WIDTH_PX = 80;

export interface HeightBaseline {
  portrait: number;
  landscape: number;
}

export const EMPTY_HEIGHT_BASELINE: HeightBaseline = { portrait: 0, landscape: 0 };

export function viewportOrientation(width: number, height: number): 'portrait' | 'landscape' {
  return width > height ? 'landscape' : 'portrait';
}

/** Remember the tallest visible height for each orientation. A later URL-bar change can only raise it. */
export function noteViewportHeight(baseline: HeightBaseline, width: number, height: number): HeightBaseline {
  if (!(height > 0)) return baseline;
  const key = viewportOrientation(width, height);
  if (height <= baseline[key]) return baseline;
  return { ...baseline, [key]: height };
}

export function keyboardOcclusion(baseline: HeightBaseline, width: number, height: number): number {
  const base = baseline[viewportOrientation(width, height)];
  if (base <= 0) return 0;
  return Math.max(0, base - height);
}

export function keyboardIsOpen(occlusion: number, alreadyShown: boolean): boolean {
  return occlusion > (alreadyShown ? KEYBOARD_HIDE_PX : KEYBOARD_APPEAR_PX);
}

/** Pending must not freeze stage sizing when the OS keyboard never opens. */
export function pendingKeyboardExpired(startedAt: number, now: number, keyboardVisible: boolean): boolean {
  if (keyboardVisible) return false;
  return now - startedAt >= KEYBOARD_PENDING_MS;
}

export function keyboardView(
  width: number,
  height: number,
  remoteW: number,
  remoteH: number,
  mode: ViewMode,
  previous: ViewTransform,
  anchor: Point,
): ViewTransform {
  if (mode === 'fit') {
    const scale = fitScale(width, height, remoteW, remoteH);
    return { scale, panX: (width - remoteW * scale) / 2, panY: (height - remoteH * scale) / 2 };
  }
  const x = previous.panX + anchor.x * previous.scale;
  const y = previous.panY + anchor.y * previous.scale;
  const margin = Math.min(48, height / 4);
  const panX = x < 16 || x > width - 16 ? width / 2 - anchor.x * previous.scale : previous.panX;
  const panY = y < margin || y > height - margin ? height * 0.6 - anchor.y * previous.scale : previous.panY;
  return {
    scale: previous.scale,
    ...clampPan(width, height, remoteW, remoteH, previous.scale, panX, panY, {
      allowEdgePan: true,
      edgePadding: DEFAULT_EDGE_PADDING,
    }),
  };
}
