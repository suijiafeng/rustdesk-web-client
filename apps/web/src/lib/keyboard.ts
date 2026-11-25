// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { ClientMessage } from '@rustdesk-web/shared';
import {
  isImeEvent,
  isModifier,
  isPrintableAscii,
  mapPhysicalKeyDown,
  mapPhysicalKeyUp,
  type KeyboardEventLike,
} from './keys.ts';

export interface TrackedKey {
  id: string;
  chr?: string;
  release: ClientMessage;
}

export type QuickKeyName = 'Esc' | 'Tab' | 'Ctrl+C' | 'Ctrl+V' | 'Ctrl+Alt+Del' | 'Lock';

const TEXT_CHUNK = 64;

function keyId(ev: KeyboardEventLike): string {
  return ev.code || ev.key || 'unknown';
}

export function noteKeyDown(
  tracked: readonly TrackedKey[],
  ev: KeyboardEventLike,
  viewOnly: boolean,
): { messages: ClientMessage[]; tracked: TrackedKey[] } {
  if (isImeEvent(ev) || viewOnly) return { messages: [], tracked: [...tracked] };
  const mapped = mapPhysicalKeyDown(ev);
  if (!mapped) return { messages: [], tracked: [...tracked] };
  const id = keyId(ev);
  const without = tracked.filter((item) => item.id !== id);
  if (mapped.type === 'text') return { messages: [mapped], tracked: without };
  const chr = mapped.chr;
  return {
    messages: [mapped],
    tracked: [...without, { id, chr, release: { ...mapped, action: 'up' } }],
  };
}

export function noteKeyUp(
  tracked: readonly TrackedKey[],
  ev: KeyboardEventLike,
  viewOnly: boolean,
): { messages: ClientMessage[]; tracked: TrackedKey[] } {
  if (isImeEvent(ev)) return { messages: [], tracked: [...tracked] };
  const id = keyId(ev);
  const existing = tracked.find((item) => item.id === id);
  const next = tracked.filter((item) => item.id !== id);
  if (viewOnly) {
    return { messages: existing ? [existing.release] : [], tracked: next };
  }
  const mapped = mapPhysicalKeyUp(ev, existing?.chr);
  if (!mapped || mapped.type !== 'key') return { messages: [], tracked: next };
  return { messages: [mapped], tracked: next };
}

export function releaseTrackedKeys(tracked: readonly TrackedKey[]): { messages: ClientMessage[]; tracked: TrackedKey[] } {
  return { messages: tracked.map((item) => item.release), tracked: [] };
}

export function textMessages(text: string, viewOnly: boolean): ClientMessage[] {
  if (viewOnly || !text) return [];
  if (text === ' ') {
    return [
      { type: 'key', action: 'down', control: 'Space' },
      { type: 'key', action: 'up', control: 'Space' },
    ];
  }
  if (isPrintableAscii(text)) {
    return [
      { type: 'key', action: 'down', chr: text },
      { type: 'key', action: 'up', chr: text },
    ];
  }
  const chars = Array.from(text);
  const messages: ClientMessage[] = [];
  for (let index = 0; index < chars.length; index += TEXT_CHUNK) {
    messages.push({ type: 'text', text: chars.slice(index, index + TEXT_CHUNK).join('') });
  }
  return messages;
}

function tapControl(control: string): ClientMessage[] {
  return [
    { type: 'key', action: 'down', control },
    { type: 'key', action: 'up', control },
  ];
}

export function chordMessages(
  parts: ReadonlyArray<{ control?: string; chr?: string }>,
  viewOnly: boolean,
): ClientMessage[] {
  if (viewOnly) return [];
  const modifiers = parts
    .map((part) => part.control)
    .filter((control): control is string => Boolean(control && isModifier(control)));
  const messages: ClientMessage[] = [];
  for (const part of parts) {
    if (part.control) messages.push({ type: 'key', action: 'down', control: part.control, modifiers });
    else if (part.chr) messages.push({ type: 'key', action: 'down', chr: part.chr, modifiers });
  }
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part) continue;
    if (part.chr) messages.push({ type: 'key', action: 'up', chr: part.chr, modifiers });
    else if (part.control) messages.push({ type: 'key', action: 'up', control: part.control, modifiers });
  }
  return messages;
}

export function quickKeyMessages(name: QuickKeyName, viewOnly: boolean): ClientMessage[] {
  if (viewOnly) return [];
  if (name === 'Esc') return tapControl('Escape');
  if (name === 'Tab') return tapControl('Tab');
  if (name === 'Ctrl+C') return chordMessages([{ control: 'Control' }, { chr: 'c' }], false);
  if (name === 'Ctrl+V') return chordMessages([{ control: 'Control' }, { chr: 'v' }], false);
  if (name === 'Ctrl+Alt+Del') return tapControl('CtrlAltDel');
  return tapControl('LockScreen');
}
