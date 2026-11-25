// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { decodeClipboardText } from './clipboard.ts';

test('clipboard accepts UTF-8 text from both plain and Zstd messages', () => {
  const text = '剪贴板\nText';
  const content = Buffer.from(text);
  assert.equal(decodeClipboardText({ content }), text);
  assert.equal(decodeClipboardText({ content: zstdCompressSync(content), compress: true }), text);
});

test('clipboard rejects invalid data and bounds decompressed output', () => {
  assert.equal(decodeClipboardText({ format: 1, content: Buffer.from('x') }), null);
  assert.equal(decodeClipboardText({ content: Buffer.from([255]) }), null);
  assert.equal(decodeClipboardText({ content: Buffer.from('invalid'), compress: true }), null);
  assert.equal(decodeClipboardText({ content: zstdCompressSync(Buffer.alloc(256 * 1024 + 1, 65)), compress: true }), null);
});
