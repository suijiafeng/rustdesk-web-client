// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionChromeMode } from './sessionChrome.ts';

test('a narrow or touch session uses the bottom dock and hides it while the soft keyboard is open', () => {
  assert.equal(sessionChromeMode({ width: 390, coarsePointer: true, keyboardOpen: false, viewportNarrow: true }), 'dock');
  assert.equal(sessionChromeMode({ width: 390, coarsePointer: true, keyboardOpen: true, viewportNarrow: true }), 'keyboard');
  assert.equal(sessionChromeMode({ width: 1200, coarsePointer: true, keyboardOpen: false, viewportNarrow: false }), 'dock');
  assert.equal(sessionChromeMode({ width: 1440, coarsePointer: false, keyboardOpen: true, viewportNarrow: false }), 'desktop');
  assert.equal(sessionChromeMode({ width: 0, coarsePointer: false, keyboardOpen: false, viewportNarrow: true }), 'dock');
  assert.equal(sessionChromeMode({ width: 0, coarsePointer: false, keyboardOpen: false, viewportNarrow: false }), 'desktop');
});
