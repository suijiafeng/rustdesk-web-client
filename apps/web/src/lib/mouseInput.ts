// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { ClientMessage } from '@rustdesk-web/shared';
import { applyMouseButtonSwap } from './displayPrefs.ts';
import { mapToRemote, mapToRemoteClamped, type Point, type ViewTransform } from './mapping.ts';
import { accumulateWheelTicks } from './wheel.ts';

export type MouseButton = 'left' | 'right' | 'middle';

export function desktopPointerButton(button: number, swap: boolean): MouseButton | null {
  const raw: MouseButton | null = button === 2 ? 'right' : button === 1 ? 'middle' : button === 0 ? 'left' : null;
  if (!raw) return null;
  return applyMouseButtonSwap(raw, swap);
}

export function remotePoint(
  localX: number,
  localY: number,
  remoteWidth: number,
  remoteHeight: number,
  transform: ViewTransform,
  clamp: boolean,
): Point | null {
  return clamp
    ? mapToRemoteClamped(localX, localY, remoteWidth, remoteHeight, transform)
    : mapToRemote(localX, localY, remoteWidth, remoteHeight, transform);
}

export function pointerDownMessages(
  button: MouseButton,
  point: Point,
  viewOnly: boolean,
): ClientMessage[] {
  if (viewOnly) return [];
  return [
    { type: 'mouse', action: 'move', x: point.x, y: point.y },
    { type: 'mouse', action: 'down', button, x: point.x, y: point.y },
  ];
}

export function pointerMoveMessage(point: Point, viewOnly: boolean): ClientMessage | null {
  if (viewOnly) return null;
  return { type: 'mouse', action: 'move', x: point.x, y: point.y };
}

export function pointerUpMessages(button: MouseButton, point: Point, viewOnly: boolean): ClientMessage[] {
  if (viewOnly) return [];
  return [
    { type: 'mouse', action: 'move', x: point.x, y: point.y },
    { type: 'mouse', action: 'up', button, x: point.x, y: point.y },
  ];
}

/** A double-click is two complete press/release pairs, not an extra synthetic event. */
export function repeatedClickMessages(button: MouseButton, point: Point, presses: number): ClientMessage[] {
  const messages: ClientMessage[] = [];
  for (let index = 0; index < presses; index += 1) {
    messages.push(
      { type: 'mouse', action: 'move', x: point.x, y: point.y },
      { type: 'mouse', action: 'down', button, x: point.x, y: point.y },
      { type: 'mouse', action: 'up', button, x: point.x, y: point.y },
    );
  }
  return messages;
}

export function releaseHeldButton(button: MouseButton | null, point: Point): ClientMessage[] {
  if (!button) return [];
  return [{ type: 'mouse', action: 'up', button, x: point.x, y: point.y }];
}

/** A move burst keeps the newest point and drops the ones still waiting to be sent. */
export function coalesceMove<T>(pending: T | null, next: T | null): T | null {
  return next ?? pending;
}

export function wheelMessages(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  accumX: number,
  accumY: number,
  reverseVertical: boolean,
  viewOnly: boolean,
): { messages: ClientMessage[]; nextAccumX: number; nextAccumY: number } {
  const wheel = accumulateWheelTicks(deltaX, deltaY, deltaMode, accumX, accumY, reverseVertical);
  if (viewOnly || (wheel.tx === 0 && wheel.ty === 0)) {
    return { messages: [], nextAccumX: wheel.nextAccumX, nextAccumY: wheel.nextAccumY };
  }
  return {
    messages: [{ type: 'mouse', action: 'wheel', x: wheel.tx, y: wheel.ty }],
    nextAccumX: wheel.nextAccumX,
    nextAccumY: wheel.nextAccumY,
  };
}
