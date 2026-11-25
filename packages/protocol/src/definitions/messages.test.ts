// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAddrMangle, encodeAddrMangle } from '../codec/addrMangle.ts';
import { ProtocolError } from '../errors.ts';
import { PROTOCOL_COMPATIBILITY } from './compatibility.ts';
import {
  ControlKey,
  KeyboardMode,
  decodeMessage,
  decodeRendezvous,
  encodeIdPk,
  encodeMessage,
} from './messages.ts';

test('protobuf wire tags match RustDesk message.proto and rendezvous.proto', () => {
  const key = encodeMessage({
    key_event: { down: true, control_key: ControlKey.Escape, mode: KeyboardMode.Legacy },
  });
  assert.equal(key[0], (15 << 3) | 2);

  const clipboard = encodeMessage({ clipboard: { content: Uint8Array.from([104, 105]) } });
  assert.equal(clipboard[0], 0x82);
  assert.equal(clipboard[1], 0x01);

  const ack = encodeMessage({ misc: { video_received: true } });
  assert.equal(ack[0], 0x9a);
  assert.equal(ack[1], 0x01);
  assert.equal(ack[3], (12 << 3) | 0);

  const cursor = encodeMessage({ cursor_position: { x: 10, y: 20 } });
  assert.equal(cursor[0], (13 << 3) | 2);

  const idPk = encodeIdPk('123', new Uint8Array(32).fill(7), 1);
  assert.ok(includesBytes(idPk, [0x20, 0x01]));

  const login = encodeMessage({
    login_request: { username: '127.0.0.1:21118', version: '1.5.3' },
  });
  assert.ok(includesBytes(login, [0x5a, 0x05]));
});

test('hash messages round-trip', () => {
  const decoded = decodeMessage(encodeMessage({ hash: { salt: 's1', challenge: 'c1' } }));
  const hash = decoded.hash as { salt: string; challenge: string };
  assert.deepEqual(hash, { salt: 's1', challenge: 'c1' });
});

test('HTTP bytes are reported as not RustDesk instead of a raw protobuf error', () => {
  const http = new TextEncoder().encode('TTP/1.1 400 Bad Re');
  assert.throws(
    () => decodeMessage(http),
    (error: unknown) => error instanceof ProtocolError && /Not a RustDesk server/i.test(error.message),
  );
  assert.throws(
    () => decodeRendezvous(http),
    (error: unknown) => error instanceof ProtocolError && /Not a RustDesk ID server/i.test(error.message),
  );
});

test('AddrMangle round-trips IPv4, trimmed zeros, and IPv6', () => {
  const v4 = encodeAddrMangle('203.0.113.42', 21118, 0x12345678);
  assert.ok(v4.length > 0 && v4.length <= 16);
  assert.deepEqual(decodeAddrMangle(v4), { host: '203.0.113.42', port: 21118 });

  assert.deepEqual(decodeAddrMangle(encodeAddrMangle('127.0.0.1', 54321, 1)), {
    host: '127.0.0.1',
    port: 54321,
  });

  const v6 = encodeAddrMangle('2001:db8::1', 21118);
  assert.equal(v6.length, 18);
  assert.equal(v6[16]! | (v6[17]! << 8), 21118);
  assert.deepEqual(decodeAddrMangle(v6), { host: '2001:db8:0:0:0:0:0:1', port: 21118 });
  assert.equal(decodeAddrMangle(new Uint8Array()), null);
  assert.equal(decodeAddrMangle(new Uint8Array(17)), null);
});

test('the compatibility record names RustDesk 1.5.3', () => {
  assert.equal(PROTOCOL_COMPATIBILITY.upstreamVersion, '1.5.3');
  assert.equal(PROTOCOL_COMPATIBILITY.sourceCommit, 'f784848f26b33453b0a6ff98f7b20748ecf32518');
});

function includesBytes(bytes: Uint8Array, needle: number[]): boolean {
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    if (needle.every((value, offset) => bytes[index + offset] === value)) return true;
  }
  return false;
}
