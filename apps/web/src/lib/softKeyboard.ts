// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { ClientMessage } from '@rustdesk-web/shared';
import { chordMessages, textMessages } from './keyboard.ts';
import { buildSoftKeyChord, diffTextInput } from './keys.ts';

export function toggleLatched(latched: readonly string[], control: string): string[] {
  return latched.includes(control) ? latched.filter((item) => item !== control) : [...latched, control];
}

export function softControlMessages(
  latched: readonly string[],
  control: string,
  viewOnly: boolean,
): { messages: ClientMessage[]; latched: string[] } {
  if (viewOnly) return { messages: [], latched: [...latched] };
  if (latched.length > 0) {
    return {
      messages: chordMessages(buildSoftKeyChord(latched, { control }), false),
      latched: [],
    };
  }
  return {
    messages: [
      { type: 'key', action: 'down', control },
      { type: 'key', action: 'up', control },
    ],
    latched: [],
  };
}

export function softTextEdit(
  latched: readonly string[],
  previous: string,
  next: string,
  viewOnly: boolean,
): { messages: ClientMessage[]; latched: string[]; draft: string } {
  if (viewOnly) return { messages: [], latched: [...latched], draft: previous };
  const diff = diffTextInput(previous, next);
  if (latched.length > 0 && diff.insert) {
    const chars = Array.from(diff.insert);
    const first = chars.shift() ?? '';
    const messages = first
      ? chordMessages(buildSoftKeyChord(latched, { chr: first.toLowerCase() }), false)
      : [];
    if (chars.length > 0) messages.push(...textMessages(chars.join(''), false));
    return { messages, latched: [], draft: previous };
  }
  if (diff.backspaces === 0 && !diff.insert) {
    return { messages: [], latched: [...latched], draft: previous };
  }
  const messages: ClientMessage[] = [];
  for (let index = 0; index < diff.backspaces; index += 1) {
    messages.push(
      { type: 'key', action: 'down', control: 'Backspace' },
      { type: 'key', action: 'up', control: 'Backspace' },
    );
  }
  if (diff.insert) messages.push(...textMessages(diff.insert, false));
  return { messages, latched: [...latched], draft: next };
}
