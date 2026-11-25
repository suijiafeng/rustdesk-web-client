// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlKeyValues, KeyboardModeValues } from '@rustdesk-web/protocol';
import { toHostMessage } from './index.ts';

test('text and Escape become legacy key events', () => {
  const text = toHostMessage({ type: 'text', text: '你好' });
  const textEvent = text?.key_event as { mode: number; down: boolean; press: boolean; seq: string };
  assert.equal(textEvent.mode, KeyboardModeValues.Legacy);
  assert.equal(textEvent.down, true);
  assert.equal(textEvent.press, true);
  assert.equal(textEvent.seq, '你好');

  const escape = toHostMessage({ type: 'key', action: 'down', control: 'Escape' });
  const escapeEvent = escape?.key_event as { control_key: number; down: boolean };
  assert.equal(escapeEvent.control_key, ControlKeyValues.Escape);
  assert.equal(escapeEvent.down, true);

  const released = toHostMessage({ type: 'key', action: 'up', control: 'Escape' });
  const releasedEvent = released?.key_event as { down: boolean };
  assert.equal(releasedEvent.down, false);
});

test('Ctrl, Alt, and Meta modifiers use the RustDesk control key values', () => {
  const chord = toHostMessage({ type: 'key', action: 'down', chr: 'c', modifiers: ['Control', 'Alt', 'Meta'] });
  const event = chord?.key_event as { chr: number; modifiers: number[] };
  assert.equal(event.chr, 'c'.codePointAt(0));
  assert.deepEqual(event.modifiers, [ControlKeyValues.Control, ControlKeyValues.Alt, ControlKeyValues.Meta]);

  const meta = toHostMessage({ type: 'key', action: 'down', control: 'Meta' });
  const metaEvent = meta?.key_event as { control_key: number };
  assert.equal(metaEvent.control_key, ControlKeyValues.Meta);
  const arrow = toHostMessage({ type: 'key', action: 'down', control: 'ArrowLeft' });
  const arrowEvent = arrow?.key_event as { control_key: number };
  assert.equal(arrowEvent.control_key, ControlKeyValues.LeftArrow);
});
