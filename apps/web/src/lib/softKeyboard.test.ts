// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { softControlMessages, softTextEdit, toggleLatched } from './softKeyboard.ts';

test('modifiers latch and a following key is one chord', () => {
  const latched = toggleLatched(toggleLatched([], 'Control'), 'Alt');
  assert.deepEqual(latched, ['Control', 'Alt']);
  const chord = softControlMessages(latched, 'Escape', false);
  assert.deepEqual(chord.latched, []);
  assert.deepEqual(
    chord.messages.map((message) => message.type === 'key' ? `${message.action}:${message.control ?? message.chr}` : ''),
    ['down:Control', 'down:Alt', 'down:Escape', 'up:Escape', 'up:Alt', 'up:Control'],
  );
  assert.deepEqual(softControlMessages(['Control'], 'F5', true).messages, []);
});

test('text edits send backspaces and inserted text, and a latched letter is a chord', () => {
  const typed = softTextEdit([], '', 'ab', false);
  assert.equal(typed.draft, 'ab');
  assert.equal(typed.messages.some((message) => message.type === 'text' && message.text === 'ab'), true);
  const letter = softTextEdit([], '', 'Z', false);
  assert.equal(letter.messages.some((message) => message.type === 'key' && message.chr === 'Z'), true);
  const removed = softTextEdit([], 'ab', 'a', false);
  assert.equal(removed.messages.filter((message) => message.type === 'key' && message.control === 'Backspace').length, 2);
  const shortcut = softTextEdit(['Control'], 'hi', 'hic', false);
  assert.equal(shortcut.draft, 'hi');
  assert.equal(shortcut.latched.length, 0);
  assert.equal(shortcut.messages.some((message) => message.type === 'key' && message.chr === 'c'), true);
  assert.deepEqual(softTextEdit(['Shift'], '', 'A', true).messages, []);
});
