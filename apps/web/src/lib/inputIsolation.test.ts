// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isBrowserNavOrAuxButton,
  shouldIsolateKeyboardEvent,
  shouldPreventStageTouch,
  shouldPreventWindowWheel,
} from './inputIsolation.ts';

test('isolates keyboard events only during a live session outside chrome', () => {
  assert.equal(shouldIsolateKeyboardEvent({ phase: 'live', chromeOpen: false, insideChromeInput: false }), true);
  assert.equal(shouldIsolateKeyboardEvent({ phase: 'live', chromeOpen: true, insideChromeInput: false }), false);
  assert.equal(shouldIsolateKeyboardEvent({ phase: 'live', chromeOpen: false, insideChromeInput: true }), false);
  assert.equal(shouldIsolateKeyboardEvent({ phase: 'idle', chromeOpen: false, insideChromeInput: false }), false);
  assert.equal(shouldIsolateKeyboardEvent({ phase: 'connecting', chromeOpen: false, insideChromeInput: false }), false);
});

test('flags middle and browser back or forward buttons', () => {
  assert.equal(isBrowserNavOrAuxButton(0), false);
  assert.equal(isBrowserNavOrAuxButton(1), true);
  assert.equal(isBrowserNavOrAuxButton(3), true);
  assert.equal(isBrowserNavOrAuxButton(4), true);
});

test('blocks page wheel and stage touch only while remote input is active', () => {
  assert.equal(shouldPreventWindowWheel(true, false), true);
  assert.equal(shouldPreventWindowWheel(true, true), false);
  assert.equal(shouldPreventWindowWheel(false, false), false);
  assert.equal(shouldPreventStageTouch(true, true), true);
  assert.equal(shouldPreventStageTouch(true, false), false);
});
