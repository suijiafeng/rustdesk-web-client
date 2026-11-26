import { zstdCompressSync } from 'node:zlib';
import { CursorShapes } from '../../shared/cursor.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { FragmentReader, FRAGMENT_PAYLOAD, decodeEndpoint, encodeEndpoint, sdpFingerprint } from '../../shared/webrtc.ts';
import { IdPkProto, decodeRendezvous, encodeRendezvous } from '../../shared/protos.ts';
import { readWebRtcRoute } from './webrtc/connect.ts';
import { verifiedPeerKey, verifyFingerprint } from './webrtc/handshake.ts';

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
  assert.equal(decodeRendezvous(Uint8Array.from([0xea, 1, 3, 0x22, 1, 0x78])).ice_candidate?.candidate, 'x');
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
    IdPkProto.encode(IdPkProto.create({ id, pk, dtls_fingerprint })).finish();
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

test('WebRTC prefers the selected candidate pair and recognizes TURN on either side', async () => {
  for (const [local, remote, expected] of [
    ['host', 'srflx', 'webrtc-direct'],
    ['relay', 'host', 'webrtc-relay'],
    ['host', 'relay', 'webrtc-relay'],
    ['host', undefined, 'webrtc'],
  ]) {
    const reports = new Map<string, unknown>([
      ['transport', { type: 'transport', selectedCandidatePairId: 'selected' }],
      ['selected', { type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
      ['other', { type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'turn' }],
      ['local', { candidateType: local }],
      ['remote', { candidateType: remote }],
      ['turn', { candidateType: 'relay' }],
    ]);
    assert.equal(await readWebRtcRoute({ getStats: async () => reports as unknown as RTCStatsReport }), expected);
  }
});

test('WebRTC accepts a nominated pair when transport selection is absent', async () => {
  const reports = new Map<string, unknown>([
    ['pair', { type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { candidateType: 'host' }],
    ['remote', { candidateType: 'prflx' }],
  ]);
  assert.equal(await readWebRtcRoute({ getStats: async () => reports as unknown as RTCStatsReport }), 'webrtc-direct');
});

test('unavailable WebRTC statistics leave the authenticated route unknown', async () => {
  assert.equal(await readWebRtcRoute({ getStats: async () => { throw new Error('unavailable'); } }), 'webrtc');
  assert.equal(await readWebRtcRoute({ getStats: () => new Promise(() => {}) }, 5), 'webrtc');
});
