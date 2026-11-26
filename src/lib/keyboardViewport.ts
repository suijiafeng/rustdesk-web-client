import { clampPan, DEFAULT_EDGE_PADDING, fitScale, type Point, type ViewMode, type ViewTransform } from './mapping';

export function keyboardView(
  width: number, height: number, remoteW: number, remoteH: number,
  mode: ViewMode, previous: ViewTransform, anchor: Point,
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
  return { scale: previous.scale, ...clampPan(width, height, remoteW, remoteH, previous.scale, panX, panY,
    { allowEdgePan: true, edgePadding: DEFAULT_EDGE_PADDING }) };
}

export function virtualKeyboardHeight(viewportHeight: number, landscape: boolean, systemHeight?: number): number {
  const fallback = Math.round(viewportHeight * (landscape ? 0.44 : 0.34));
  const preferred = systemHeight ?? Math.min(320, fallback);
  return Math.min(Math.max(0, viewportHeight - 88), preferred);
}

export function keyboardSpaceToReserve(fullHeight: number, visibleHeight: number, keyboardHeight: number): number {
  return Math.max(0, keyboardHeight - Math.max(0, fullHeight - visibleHeight));
}
