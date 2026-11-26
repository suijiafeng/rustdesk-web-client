import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { decodeClipboard, MAX_CLIPBOARD_BYTES } from '../shared/clipboard.ts';

test('clipboard preserves Unicode, line breaks, whitespace and empty text', () => {
  for (const text of ['', '  中文\nsecond line\t🙂  ']) {
    assert.equal(decodeClipboard({ content: Buffer.from(text) }), text);
    assert.equal(decodeClipboard({ content: zstdCompressSync(Buffer.from(text)), compress: true }), text);
  }
});

test('clipboard accepts a compressed RustDesk-sized long text', () => {
  const text = 'long text 中文\n'.repeat(8000);
  assert.equal(decodeClipboard({ content: zstdCompressSync(Buffer.from(text)), compress: true }), text);
});

test('clipboard rejects images, oversized text, corrupt frames and concatenated frames', () => {
  const frame = zstdCompressSync(Buffer.from('hello'));
  assert.equal(decodeClipboard({ format: 1, content: Buffer.from('image') }), null);
  assert.equal(decodeClipboard({ content: Buffer.alloc(MAX_CLIPBOARD_BYTES + 1) }), null);
  assert.equal(decodeClipboard({ content: zstdCompressSync(Buffer.alloc(MAX_CLIPBOARD_BYTES + 1)), compress: true }), null);
  assert.equal(decodeClipboard({ content: frame.subarray(0, frame.length - 1), compress: true }), null);
  assert.equal(decodeClipboard({ content: Buffer.concat([frame, frame]), compress: true }), null);
});
