// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { ClientMessage, DisplayInfo, QualityLevel } from '@rustdesk-web/shared';

export interface DisplayChoice {
  index: number;
  display: DisplayInfo | null;
  origin: { x: number; y: number };
}

/** Picks a display by array position and falls back when a hot-plug removes the current one. */
export function chooseDisplay(displays: readonly DisplayInfo[], requested: number): DisplayChoice {
  const index = displays[requested] ? requested : 0;
  const display = displays[index] ?? null;
  return {
    index: display ? index : 0,
    display,
    origin: { x: display?.x ?? 0, y: display?.y ?? 0 },
  };
}

/** Adds the display origin to pointer motion. Wheel ticks stay relative. */
export function offsetPointerMessages(
  messages: readonly ClientMessage[],
  origin: { x: number; y: number },
): ClientMessage[] {
  return messages.map((message) => {
    if (message.type !== 'mouse' || message.action === 'wheel') return message;
    return {
      ...message,
      x: Math.trunc((message.x ?? 0) + origin.x),
      y: Math.trunc((message.y ?? 0) + origin.y),
    };
  });
}

export function sessionEndLock(enabled: boolean, live: boolean): ClientMessage[] {
  if (!enabled || !live) return [];
  return [
    { type: 'key', action: 'down', control: 'LockScreen' },
    { type: 'key', action: 'up', control: 'LockScreen' },
  ];
}

export function qualityCommand(level: QualityLevel, fps: number): ClientMessage {
  return { type: 'quality', quality: level, fps };
}

export function shouldFollowFocusedDisplay(
  follow: boolean,
  focused: number | null,
  current: number,
  displays: readonly DisplayInfo[],
): boolean {
  if (!follow || focused === null || focused === current) return false;
  const display = displays[focused];
  return Boolean(display && display.online !== false);
}

export function remotePrivacyAllowed(peer: { privacyAllowed?: boolean } | null): boolean {
  return peer?.privacyAllowed === true;
}
