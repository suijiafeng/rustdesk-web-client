// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { ClientMessage } from '@rustdesk-web/shared';
import type { TouchGestureEffect } from './gestures.ts';
import { pointerDownMessages, pointerMoveMessage, pointerUpMessages } from './mouseInput.ts';
import { applyWheelDirection } from './displayPrefs.ts';

export interface TouchCursor {
  x: number;
  y: number;
}

export interface TouchOutcome {
  messages: ClientMessage[];
  cursor: TouchCursor;
  pan: { dx: number; dy: number } | null;
  pinch: Extract<TouchGestureEffect, { type: 'pinch' }> | null;
  armLongPress: boolean;
  cancelLongPress: boolean;
}

export function isNarrowViewport(width: number): boolean {
  return width > 0 && width <= 768;
}

export function applyTouchEffects(
  effects: readonly TouchGestureEffect[],
  cursor: TouchCursor,
  mapPoint: (x: number, y: number, clamp: boolean) => TouchCursor | null,
  viewOnly: boolean,
  scale: number,
  reverseWheel: boolean,
): TouchOutcome {
  const messages: ClientMessage[] = [];
  let next = cursor;
  let panX = 0;
  let panY = 0;
  let sawPan = false;
  let pinch: TouchOutcome['pinch'] = null;
  let armLongPress = false;
  let cancelLongPress = false;
  const safeScale = Math.max(0.01, scale);

  const click = (button: 'left' | 'right', point: TouchCursor | null) => {
    if (viewOnly || !point) return;
    messages.push(
      ...pointerDownMessages(button, point, false),
      { type: 'mouse', action: 'up', button, x: point.x, y: point.y },
    );
  };

  for (const effect of effects) {
    switch (effect.type) {
      case 'cancel-long-press':
        cancelLongPress = true;
        break;
      case 'arm-long-press':
        armLongPress = true;
        break;
      case 'pan':
        sawPan = true;
        panX += effect.dx;
        panY += effect.dy;
        break;
      case 'pinch':
        pinch = effect;
        break;
      case 'cursor-move':
        next = { x: next.x + effect.dx / safeScale, y: next.y + effect.dy / safeScale };
        if (!viewOnly) {
          const move = pointerMoveMessage(next, false);
          if (move) messages.push(move);
        }
        break;
      case 'tap-click':
        click('left', mapPoint(effect.x, effect.y, false) ?? next);
        break;
      case 'two-finger-tap':
      case 'long-press':
        click('right', mapPoint(effect.x, effect.y, false) ?? next);
        break;
      case 'start-drag-lock':
        if (!viewOnly) messages.push(...pointerDownMessages('left', next, false));
        break;
      case 'start-touch-drag': {
        const point = mapPoint(effect.x, effect.y, true);
        if (point) {
          next = point;
          if (!viewOnly) messages.push(...pointerDownMessages('left', point, false));
        }
        break;
      }
      case 'move-touch-drag': {
        const point = mapPoint(effect.x, effect.y, true);
        if (point) {
          next = point;
          if (!viewOnly) {
            const move = pointerMoveMessage(point, false);
            if (move) messages.push(move);
          }
        }
        break;
      }
      case 'end-drag':
      case 'release-stuck-drag': {
        const point = mapPoint(effect.x, effect.y, true) ?? next;
        next = point;
        const release = pointerUpMessages('left', point, false).find((message) => message.type === 'mouse' && message.action === 'up');
        if (release) messages.push(release);
        break;
      }
      case 'three-finger-scroll': {
        const dir = applyWheelDirection(effect.ticks, reverseWheel);
        if (!viewOnly && dir !== 0) messages.push({ type: 'mouse', action: 'wheel', x: 0, y: dir });
        break;
      }
      default:
        break;
    }
  }

  return {
    messages,
    cursor: next,
    pan: sawPan ? { dx: panX, dy: panY } : null,
    pinch,
    armLongPress,
    cancelLongPress,
  };
}
