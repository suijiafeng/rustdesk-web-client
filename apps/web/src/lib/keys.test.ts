// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSoftKeyChord,
  controlFromKeyOrCode,
  diffTextInput,
  isImeEvent,
  mapPhysicalKeyDown,
  mapPhysicalKeyUp,
} from './keys.ts';

const plain = {
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
};

test('physical keyboard forwards Space and Ctrl+C chord with modifiers', () => {
  const space = mapPhysicalKeyDown({ code: 'Space', key: ' ', ...plain });
  assert.deepEqual(space, { type: 'key', action: 'down', control: 'Space', modifiers: undefined });

  const ctrlC = mapPhysicalKeyDown({ code: 'KeyC', key: 'c', ...plain, ctrlKey: true });
  assert.deepEqual(ctrlC, { type: 'key', action: 'down', chr: 'c', modifiers: ['Control'] });

  const ctrlCUp = mapPhysicalKeyUp({ code: 'KeyC', key: 'c', ...plain, ctrlKey: true });
  assert.deepEqual(ctrlCUp, { type: 'key', action: 'up', chr: 'c', modifiers: ['Control'] });
});

test('buildSoftKeyChord combines latched modifiers with target key or character', () => {
  assert.deepEqual(buildSoftKeyChord(['Control'], { chr: 'c' }), [{ control: 'Control' }, { chr: 'c' }]);
  assert.deepEqual(buildSoftKeyChord(['Control', 'Shift', 'Invalid'], { control: 'Tab' }), [
    { control: 'Control' },
    { control: 'Shift' },
    { control: 'Tab' },
  ]);
  assert.deepEqual(buildSoftKeyChord([], { control: 'Escape' }), [{ control: 'Escape' }]);
});

test('physical keyboard sends native chr down/up for ASCII and ignores IME composition events', () => {
  const downA = mapPhysicalKeyDown({ code: 'KeyA', key: 'a', ...plain });
  assert.deepEqual(downA, { type: 'key', action: 'down', chr: 'a', modifiers: undefined });

  const repeatA = mapPhysicalKeyDown({ code: 'KeyA', key: 'a', ...plain, repeat: true });
  assert.deepEqual(repeatA, { type: 'key', action: 'down', chr: 'a', modifiers: undefined });

  const shifted = mapPhysicalKeyDown({ code: 'KeyA', key: 'A', ...plain, shiftKey: true });
  assert.deepEqual(shifted, { type: 'key', action: 'down', chr: 'A', modifiers: ['Shift'] });

  const altA = mapPhysicalKeyDown({ code: 'KeyA', key: 'a', ...plain, altKey: true });
  assert.deepEqual(altA, { type: 'key', action: 'down', chr: 'a', modifiers: ['Alt'] });

  const metaA = mapPhysicalKeyDown({ code: 'KeyA', key: 'a', ...plain, metaKey: true });
  assert.deepEqual(metaA, { type: 'key', action: 'down', chr: 'a', modifiers: ['Meta'] });

  const upTracked = mapPhysicalKeyUp({ code: 'KeyA', key: 'a', ...plain }, 'A');
  assert.deepEqual(upTracked, { type: 'key', action: 'up', chr: 'A', modifiers: undefined });

  assert.equal(isImeEvent({ isComposing: true, key: 'n' }), true);
  assert.equal(isImeEvent({ key: 'Process', keyCode: 229 }), true);
  assert.equal(
    mapPhysicalKeyDown({
      code: 'KeyN',
      key: 'Process',
      ...plain,
      isComposing: true,
      keyCode: 229,
    }),
    null,
  );

  assert.equal(controlFromKeyOrCode('', 'Backspace'), 'Backspace');
  assert.equal(controlFromKeyOrCode('Unidentified', 'Enter'), 'Enter');
  assert.deepEqual(mapPhysicalKeyDown({ code: 'ArrowLeft', key: 'ArrowLeft', ...plain })?.type === 'key'
    ? mapPhysicalKeyDown({ code: 'ArrowLeft', key: 'ArrowLeft', ...plain })
    : null, { type: 'key', action: 'down', control: 'ArrowLeft', modifiers: undefined });
});

test('diffTextInput computes minimal Backspace + Unicode insertion deltas without splitting CJK or emoji', () => {
  assert.deepEqual(diffTextInput('', 'hello'), { backspaces: 0, insert: 'hello' });
  assert.deepEqual(diffTextInput('hello', 'hello'), { backspaces: 0, insert: '' });
  assert.deepEqual(diffTextInput('hello', 'hell'), { backspaces: 1, insert: '' });
  assert.deepEqual(diffTextInput('你好', '你好世界'), { backspaces: 0, insert: '世界' });
  assert.deepEqual(diffTextInput('你好世界', '你好中国'), { backspaces: 2, insert: '中国' });
  assert.deepEqual(diffTextInput('hi😀', 'hi'), { backspaces: 1, insert: '' });
});
