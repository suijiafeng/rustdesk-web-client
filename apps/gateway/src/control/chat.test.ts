// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChatText } from './index.ts';

test('chat text is trimmed, capped, and rejects empty or nul bytes', () => {
  assert.equal(normalizeChatText('  hello '), 'hello');
  assert.equal(normalizeChatText('   '), null);
  assert.equal(normalizeChatText('bad\0text'), null);
  assert.equal(normalizeChatText('x'.repeat(4097)), null);
  assert.equal(normalizeChatText(12), null);
});
