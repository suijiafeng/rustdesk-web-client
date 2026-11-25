// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { CodecId, FRAME_HEADER_LENGTH, decodeRdv1Frame, encodeRdv1Frame } from './rdv1.ts';

test('RDV1 header roundtrip preserves metadata, negative pts, and payload', () => {
  assert.equal(FRAME_HEADER_LENGTH, 32);
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const encoded = encodeRdv1Frame({
    codec: CodecId.VP8,
    key: true,
    display: 1,
    width: 1280,
    height: 720,
    pts: -42n,
    gatewayUnixMs: 1700000000123n,
    data: payload,
  });
  assert.equal(encoded.byteLength, FRAME_HEADER_LENGTH + payload.byteLength);

  const decoded = decodeRdv1Frame(encoded);
  assert.ok(decoded);
  assert.equal(decoded.codec, CodecId.VP8);
  assert.equal(decoded.key, true);
  assert.equal(decoded.display, 1);
  assert.equal(decoded.width, 1280);
  assert.equal(decoded.height, 720);
  assert.equal(decoded.pts, -42n);
  assert.equal(decoded.gatewayUnixMs, 1700000000123n);
  assert.deepEqual(decoded.data, payload);
});

test('RDV1 rejects short or foreign magic frames', () => {
  assert.equal(decodeRdv1Frame(new Uint8Array(10)), null);
  const bad = new Uint8Array(40);
  bad.set([0x58, 0x58, 0x58, 0x58], 0);
  assert.equal(decodeRdv1Frame(bad), null);
});
