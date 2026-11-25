// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { constants, zstdCompressSync } from 'node:zlib';
import { decodeClipboard, MAX_CLIPBOARD_BYTES } from './webrtc/clipboard.ts';
import { CursorShapes } from './webrtc/cursor.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { FragmentReader, FRAGMENT_PAYLOAD, decodeEndpoint, encodeEndpoint, sdpFingerprint } from '@rustdesk-web/protocol';
import { encodeIdPk, decodeMessage, decodeRendezvous, encodeMessage, encodeRendezvous, selectCodecs } from '@rustdesk-web/protocol';
import { LoginError, loginWebRtc, verifiedPeerKey, verifyFingerprint } from './webrtc/handshake.ts';
import type { DataChannelStream } from './webrtc/stream.ts';

const fingerprint = 'sha-256 ' + Array(32).fill('A1').join(':');
const sdp = `v=0\r\na=fingerprint:${fingerprint}\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=candidate:private-address\r\n`;

test('native WebRTC endpoints and field numbers survive signaling without leaking candidates into the offer', () => {
  const offer = encodeEndpoint({ type: 'offer', sdp });
  const decoded = decodeEndpoint(offer, 'offer');
  assert.equal(sdpFingerprint(decoded.sdp), fingerprint);
  assert.ok(!decoded.sdp.includes('candidate:'));
  assert.throws(() => decodeEndpoint(offer, 'answer'));
  const wire = encodeRendezvous({ punch_hole_request: { webrtc_sdp_offer: 'x' } });
  // RendezvousMessage.punch_hole_request = 8; PunchHoleRequest.webrtc_sdp_offer = 12.
  assert.deepEqual([...wire], [0x42, 3, 0x62, 1, 0x78]);
  assert.equal(decodeRendezvous(Uint8Array.from([0xea, 1, 3, 0x22, 1, 0x78])).ice_candidate.candidate, 'x');
});

test('large native video messages reassemble, while malformed or oversized fragments are rejected', () => {
  const reader = new FragmentReader();
  const fragment = new Uint8Array(FRAGMENT_PAYLOAD + 1).fill(7);
  fragment[0] = 1;
  assert.equal(reader.push(fragment), null);
  const result = reader.push(Uint8Array.from([0, 8, 9]));
  assert.equal(result?.length, FRAGMENT_PAYLOAD + 2);
  assert.deepEqual([...result!.slice(-2)], [8, 9]);
  assert.deepEqual([...reader.push(Uint8Array.from([0, 3]))!], [3]);
  assert.throws(() => reader.push(Uint8Array.from([2, 3])));
  const bounded = new FragmentReader();
  bounded.limit = 2;
  assert.throws(() => bounded.push(Uint8Array.from([0, 1, 2, 3])));
});

test('a signed identity must bind both the requested device and the DTLS certificate before login', () => {
  const root = nacl.sign.keyPair();
  const peer = nacl.sign.keyPair();
  const encryption = nacl.box.keyPair();
  const encode = (id: string, pk: Uint8Array, dtls_fingerprint = '') =>
    encodeIdPk(id, pk, 0, dtls_fingerprint);
  const signed = nacl.sign(encode('123456789', peer.publicKey), root.secretKey);
  const trusted = verifiedPeerKey(Buffer.from(signed).toString('base64'), Buffer.from(root.publicKey).toString('base64'), '123456789');
  const identity = nacl.sign(encode('123456789', encryption.publicKey, fingerprint), peer.secretKey);
  assert.deepEqual(verifyFingerprint(identity, trusted, '123456789', fingerprint), encryption.publicKey);
  assert.throws(() => verifyFingerprint(identity, trusted, '987654321', fingerprint));
  assert.throws(() => verifyFingerprint(identity, trusted, '123456789', fingerprint.replace(/A1/g, 'B2')));
  identity[0] ^= 1;
  assert.throws(() => verifyFingerprint(identity, trusted, '123456789', fingerprint));
});

test('browser cursor decoding preserves native Zstandard RGBA pixels', () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]);
  const shape = new CursorShapes().decode({ id: '1', width: 2, height: 1, hotx: 1, colors: zstdCompressSync(pixels) });
  assert.equal(shape?.rgba, pixels.toString('base64'));
  assert.equal(shape?.hotX, 1);
});

test('native clipboard accepts streaming Zstandard and bounds the decoded text', () => {
  const params = { [constants.ZSTD_c_contentSizeFlag]: 0 };
  const clip = (input: Buffer) => ({ content: zstdCompressSync(input, { params }), compress: true });
  const compressed = clip(Buffer.from('移动端剪贴板'));
  assert.equal(decodeClipboard(compressed), '移动端剪贴板');
  assert.equal(decodeClipboard(clip(Buffer.alloc(MAX_CLIPBOARD_BYTES + 1, 'x'))), null);
  assert.equal(decodeClipboard({ ...compressed, content: Buffer.concat([compressed.content, compressed.content]) }), null);
});

test('native login sends a password challenge response only after verifying the host', async () => {
  const peer = nacl.sign.keyPair();
  const encryption = nacl.box.keyPair();
  const peerId = '123456789';
  const signed = nacl.sign(encodeIdPk(peerId, encryption.publicKey, 0, fingerprint), peer.secretKey);
  const run = (certificate: string) => {
    const messages = [
      encodeMessage({ signed_id: { id: signed } }),
      encodeMessage({ hash: { salt: 'salt', challenge: 'nonce' } }),
      encodeMessage({ login_response: { error: 'Wrong password' } }),
    ];
    const events: string[] = [];
    const stream = {
      next: async () => messages.shift() ?? null,
      sendRaw: async (payload: Uint8Array) => { events.push(decodeMessage(payload).union); },
    } as unknown as DataChannelStream;
    const login = loginWebRtc(stream, { type: 'connect', mode: 'id', peerId, password: 'example' },
      selectCodecs(undefined), peer.publicKey, certificate, () => events.push('verified'), async () => null);
    return { login, events };
  };
  const mismatched = run(fingerprint.replace(/A1/g, 'B2'));
  await assert.rejects(mismatched.login, /does not match/);
  assert.deepEqual(mismatched.events, []);
  const valid = run(fingerprint);
  await assert.rejects(valid.login, LoginError);
  assert.deepEqual(valid.events, ['public_key', 'verified', 'login_request']);
});
