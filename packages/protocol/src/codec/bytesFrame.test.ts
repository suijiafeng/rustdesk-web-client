// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtocolError } from '../errors.ts';
import { BytesFrameDecoder, MAX_FRAME_PAYLOAD, encodeBytesFrame } from './bytesFrame.ts';

test('BytesCodec round-trips 1-byte, 2-byte, and 3-byte headers across 7-byte chunks', () => {
  const decoder = new BytesFrameDecoder();
  const small = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  const medium = new Uint8Array(300).fill(0xab);
  const large = new Uint8Array(20_000).fill(0xcd);
  const combined = concat([encodeBytesFrame(small), encodeBytesFrame(medium), encodeBytesFrame(large)]);

  const out: Uint8Array[] = [];
  for (let offset = 0; offset < combined.length; offset += 7) {
    out.push(...decoder.push(combined.subarray(offset, offset + 7)));
  }

  assert.equal(out.length, 3);
  assert.deepEqual(out[0], small);
  assert.deepEqual(out[1], medium);
  assert.deepEqual(out[2], large);
  assert.equal(decoder.bufferedBytes, 0);
});

test('one push returns back-to-back frames and an empty payload', () => {
  const decoder = new BytesFrameDecoder();
  const frames = decoder.push(
    concat([
      encodeBytesFrame(new Uint8Array()),
      encodeBytesFrame(new Uint8Array([1])),
      encodeBytesFrame(new Uint8Array([2, 3])),
    ]),
  );
  assert.equal(frames.length, 3);
  assert.deepEqual(frames[0], new Uint8Array());
  assert.deepEqual(frames[1], new Uint8Array([1]));
  assert.deepEqual(frames[2], new Uint8Array([2, 3]));
});

test('a truncated header or payload waits without throwing', () => {
  const decoder = new BytesFrameDecoder();
  const encoded = encodeBytesFrame(new Uint8Array([9, 8, 7, 6]));
  assert.deepEqual(decoder.push(encoded.subarray(0, 1)), []);
  assert.ok(decoder.bufferedBytes > 0);
  assert.deepEqual(decoder.push(encoded.subarray(1)), [new Uint8Array([9, 8, 7, 6])]);
  assert.equal(decoder.bufferedBytes, 0);
});

test('a declared length above the cap is rejected before the body is stored', () => {
  const decoder = new BytesFrameDecoder();
  const header = declaredHeader(MAX_FRAME_PAYLOAD + 1);
  assert.throws(
    () => decoder.push(header),
    (error: unknown) => error instanceof ProtocolError && error.code === 'frame-too-large',
  );
  assert.equal(decoder.bufferedBytes, 0);
  assert.deepEqual(decoder.push(encodeBytesFrame(new Uint8Array([4]))), [new Uint8Array([4])]);
});

test('encodeBytesFrame refuses a payload larger than the cap', () => {
  assert.throws(
    () => encodeBytesFrame(new Uint8Array(MAX_FRAME_PAYLOAD + 1)),
    (error: unknown) => error instanceof ProtocolError && error.code === 'frame-too-large',
  );
});

test('a 4-byte length header round-trips', () => {
  const payload = new Uint8Array(0x40_0000);
  payload[0] = 0x11;
  payload[payload.length - 1] = 0x22;
  const encoded = encodeBytesFrame(payload);
  assert.equal(encoded[0]! & 0x03, 3);
  const decoded = new BytesFrameDecoder().push(encoded);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0]!.length, payload.length);
  assert.equal(decoded[0]![0], 0x11);
  assert.equal(decoded[0]![payload.length - 1], 0x22);
});

function declaredHeader(length: number): Uint8Array {
  let value = length * 4 + 3;
  const header = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    header[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return header;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
