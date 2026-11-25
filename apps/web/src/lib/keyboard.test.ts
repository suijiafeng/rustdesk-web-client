// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chordMessages,
  noteKeyDown,
  noteKeyUp,
  quickKeyMessages,
  releaseTrackedKeys,
  textMessages,
} from './keyboard.ts';

const plain = {
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
};

test('view-only blocks key, text, and shortcut sends', () => {
  const down = noteKeyDown([], { code: 'KeyA', key: 'a', ...plain }, true);
  assert.deepEqual(down.messages, []);
  assert.deepEqual(textMessages('hello', true), []);
  assert.deepEqual(quickKeyMessages('Ctrl+C', true), []);
  assert.deepEqual(chordMessages([{ control: 'Control' }, { chr: 'c' }], true), []);
});

test('blur releases every key that is still down', () => {
  const down = noteKeyDown([], { code: 'KeyA', key: 'A', ...plain, shiftKey: true }, false);
  assert.equal(down.tracked.length, 1);
  const released = releaseTrackedKeys(down.tracked);
  assert.equal(released.tracked.length, 0);
  const message = released.messages[0];
  assert.equal(message?.type === 'key' ? message.action : '', 'up');
  assert.equal(message?.type === 'key' ? message.chr : '', 'A');
});

test('key up uses the character tracked at key down, and a second press is not a third event', () => {
  const down = noteKeyDown([], { code: 'KeyA', key: 'A', ...plain, shiftKey: true }, false);
  const up = noteKeyUp(down.tracked, { code: 'KeyA', key: 'a', ...plain }, false);
  const message = up.messages[0];
  assert.equal(message?.type === 'key' ? message.chr : '', 'A');
  assert.equal(up.tracked.length, 0);
  const again = noteKeyDown([], { code: 'KeyA', key: 'a', ...plain }, false);
  assert.equal(again.messages.length, 1);
});

test('text entry sends ASCII as a key tap and keeps CJK in 64-character chunks', () => {
  assert.deepEqual(textMessages('Z', false).map((message) => message.type === 'key' ? message.action : message.type), ['down', 'up']);
  const cjk = '你'.repeat(65);
  const chunks = textMessages(cjk, false);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.type === 'text' ? Array.from(chunks[0].text ?? '').length : 0, 64);
  assert.equal(chunks[1]?.type === 'text' ? chunks[1].text : '', '你');
});

test('shortcut tool presses modifiers before the key and releases them afterwards', () => {
  const chord = quickKeyMessages('Ctrl+C', false);
  assert.deepEqual(
    chord.map((message) => message.type === 'key' ? `${message.action}:${message.control ?? message.chr}` : ''),
    ['down:Control', 'down:c', 'up:c', 'up:Control'],
  );
  assert.deepEqual(
    quickKeyMessages('Ctrl+Alt+Del', false).map((message) => message.type === 'key' ? message.control : ''),
    ['CtrlAltDel', 'CtrlAltDel'],
  );
});
