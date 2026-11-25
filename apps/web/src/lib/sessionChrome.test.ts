// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionToolbarVisible } from './sessionChrome.ts';

test('mobile session toolbar collapses while the soft keyboard is open', () => {
  assert.equal(sessionToolbarVisible(true, true, false), false);
  assert.equal(sessionToolbarVisible(true, true, true), true);
  assert.equal(sessionToolbarVisible(true, false, false), true);
  assert.equal(sessionToolbarVisible(false, true, false), true);
});
