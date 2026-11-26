import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import nacl from 'tweetnacl';
import { IdPkProto, encodeMessage } from '../../server/protos.ts';
import { encodeEndpoint } from '../../shared/webrtc.ts';
import { connectWebRtc } from './webrtc/connect.ts';

const peerId = '123456789';
const rootKey = nacl.sign.keyPair();
const peerKey = nacl.sign.keyPair();
const boxKey = nacl.box.keyPair();
const fingerprint = 'sha-256 ' + Array(32).fill('A1').join(':');
const sdp = `v=0\r\na=fingerprint:${fingerprint}\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n`;
const signedPk = Buffer.from(nacl.sign(IdPkProto.encode(IdPkProto.create({ id: peerId, pk: peerKey.publicKey })).finish(), rootKey.secretKey)).toString('base64');
const request = {
  type: 'connect' as const, mode: 'id', peerId, idServer: 'id.example.test',
  key: Buffer.from(rootKey.publicKey).toString('base64'), token: 'test-secret-token', password: 'test-secret-password',
};
const candidate = (address: string) => JSON.stringify({ candidate: `candidate:1 1 UDP 2122260223 ${address} 12345 typ host`, sdpMid: '0' });

class FakeChannel {
  readyState: RTCDataChannelState = 'connecting';
  binaryType = 'arraybuffer';
  bufferedAmount = 0;
  closeCalls = 0;
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  open() { this.readyState = 'open'; this.onopen?.(); }
  send(bytes: Uint8Array) { this.sent.push(bytes); }
  receive(bytes: Uint8Array) {
    const frame = new Uint8Array(bytes.length + 1);
    frame.set(bytes, 1);
    this.onmessage?.({ data: frame.buffer });
  }
  close() {
    if (this.readyState === 'closed') return;
    this.closeCalls++;
    this.readyState = 'closed';
    this.onclose?.();
  }
}

class FakePeer {
  static latest: FakePeer;
  channel = new FakeChannel();
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  closeCalls = 0;
  remoteDescriptions = 0;
  applied: RTCIceCandidateInit[] = [];
  offerError: Error | null = null;
  addCandidateError: Error | DOMException | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((event: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null = null;
  constructor() { FakePeer.latest = this; }
  createDataChannel() { return this.channel; }
  async createOffer() {
    if (this.offerError) throw this.offerError;
    return { type: 'offer', sdp };
  }
  async setLocalDescription() { this.iceGatheringState = 'gathering'; }
  async setRemoteDescription() { this.remoteDescriptions++; }
  async addIceCandidate(value: RTCIceCandidateInit) {
    if (this.addCandidateError) throw this.addCandidateError;
    this.applied.push(value);
  }
  async getStats() { return new Map(); }
  gather(address: string) { this.onicecandidate?.({ candidate: { toJSON: () => JSON.parse(candidate(address)) } }); }
  close() { this.closeCalls++; this.connectionState = 'closed'; }
}

class FakeSignal {
  static OPEN = 1;
  static latest: FakeSignal;
  readyState = 0;
  closeCalls = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() { FakeSignal.latest = this; }
  open() { this.readyState = 1; this.onopen?.(); }
  send(value: string) { this.sent.push(value); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.closeCalls++;
    this.readyState = 3;
    this.onclose?.({ code, reason: 'test-secret-token 192.0.2.5' });
  }
}

async function flush() { for (let index = 0; index < 16; index++) await Promise.resolve(); }

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const descriptors = new Map(['RTCPeerConnection', 'WebSocket'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'RTCPeerConnection', { value: FakePeer, configurable: true });
  Object.defineProperty(globalThis, 'WebSocket', { value: FakeSignal, configurable: true });
  const abort = new AbortController();
  const removeAbort = t.mock.method(abort.signal, 'removeEventListener');
  let failure: unknown;
  let connected: Awaited<ReturnType<typeof connectWebRtc>> | undefined;
  const outcome = connectWebRtc('wss://gateway.example.test/ws', request, abort.signal).then(
    value => { connected = value; }, error => { failure = error; },
  );
  const pc = FakePeer.latest;
  const signal = FakeSignal.latest;
  t.after(() => {
    abort.abort();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return {
    pc, signal, abort, outcome, removeAbort,
    failure: () => failure, connected: () => connected,
    async openSignal() { signal.open(); await flush(); },
    async answer() { signal.message({ type: 'answer', answer: encodeEndpoint({ type: 'answer', sdp }), signedPk }); await flush(); },
    identity() {
      const identity = IdPkProto.encode(IdPkProto.create({ id: peerId, pk: boxKey.publicKey, dtls_fingerprint: fingerprint })).finish();
      pc.channel.receive(encodeMessage({ signed_id: { id: nacl.sign(identity, peerKey.secretKey) } }));
    },
  };
}

function errorText(f: ReturnType<typeof fixture>) {
  const error = f.failure();
  assert.ok(error instanceof Error);
  for (const secret of [sdp, fingerprint, signedPk, request.key, request.token, request.password, '192.0.2.5', '203.0.113.9']) {
    assert.ok(!error.message.includes(secret), `diagnostic must not include ${secret.slice(0, 12)}`);
  }
  return error.message;
}

test('timeout distinguishes opening signaling from waiting for an answer', async t => {
  const f = fixture(t);
  t.mock.timers.tick(11_999);
  await flush();
  assert.equal(f.failure(), undefined);
  t.mock.timers.tick(1);
  await f.outcome;
  assert.match(errorText(f), /connection timed out \[stage=opening signaling;/);
  assert.equal(f.pc.closeCalls, 1);
  assert.equal(f.pc.channel.closeCalls, 1);
  assert.equal(f.signal.closeCalls, 1);
});

test('waiting-answer timeout reports gathered versus sent and buffered remote candidates', async t => {
  const f = fixture(t);
  await f.openSignal();
  f.pc.gather('192.0.2.5');
  f.pc.gather('192.0.2.5');
  f.signal.message({ type: 'candidate', candidate: candidate('203.0.113.9') });
  await flush();
  t.mock.timers.tick(12_000);
  await f.outcome;
  const reason = errorText(f);
  assert.match(reason, /stage=waiting answer;/);
  assert.match(reason, /local candidates gathered\/sent=2\/0/);
  assert.match(reason, /remote candidates received\/applied=1\/0/);
});

test('ICE timeout keeps post-answer signaling failures and candidate counts without their raw text', async t => {
  const f = fixture(t);
  await f.openSignal();
  f.pc.gather('192.0.2.5');
  f.signal.message({ type: 'ready' });
  f.signal.message({ type: 'candidate', candidate: candidate('203.0.113.9') });
  await f.answer();
  f.pc.iceConnectionState = 'checking';
  f.pc.connectionState = 'connecting';
  f.pc.iceGatheringState = 'complete';
  f.signal.message({ type: 'error', message: `${request.token} ${request.key} ${sdp}` });
  await flush();
  f.signal.onerror?.();
  f.signal.close(1006);
  assert.equal(f.failure(), undefined);
  assert.equal(f.pc.closeCalls, 0);
  t.mock.timers.tick(12_000);
  await f.outcome;
  const reason = errorText(f);
  assert.match(reason, /stage=ICE;/);
  assert.match(reason, /gathered\/sent=1\/1/);
  assert.match(reason, /received\/applied=1\/1/);
  assert.match(reason, /ICE=checking; gathering=complete; PC=connecting/);
  assert.match(reason, /signaling server error received; signaling transport error; signaling close code=1006/);
});

test('a connected ICE pair with no open channel reports the data channel stage', async t => {
  const f = fixture(t);
  await f.openSignal();
  await f.answer();
  f.pc.iceConnectionState = 'completed';
  t.mock.timers.tick(12_000);
  await f.outcome;
  assert.match(errorText(f), /stage=data channel;/);
});

test('candidate application errors retain safe ICE context and received/applied divergence', async t => {
  const f = fixture(t);
  await f.openSignal();
  await f.answer();
  f.pc.addCandidateError = new DOMException(`Cannot apply ${candidate('203.0.113.9')} ${request.token}`, 'OperationError');
  f.signal.message({ type: 'candidate', candidate: candidate('203.0.113.9') });
  await f.outcome;
  const reason = errorText(f);
  assert.match(reason, /WebRTC ICE failed \[stage=ICE;/);
  assert.match(reason, /received\/applied=1\/0/);
  assert.match(reason, /error class=OperationError/);
});

test('unsafe-eval CSP failures keep an explicit safe diagnosis and the offer phase', async t => {
  const f = fixture(t);
  f.pc.offerError = new EvalError(`Refused to evaluate a string because unsafe-eval violates Content Security Policy: ${request.token} ${sdp}`);
  await f.openSignal();
  await f.outcome;
  const reason = errorText(f);
  assert.match(reason, /^WebRTC blocked by Content Security Policy \(unsafe-eval\) \[stage=creating offer;/);
  assert.match(reason, /error class=EvalError/);
  assert.equal(f.pc.closeCalls, 1);
});

for (const reason of ['WebRTC signaling timed out', 'That target address is not allowed.', 'key mismatch: rendezvous server key signature is invalid']) {
  test(`signaling retains the fixed reason: ${reason}`, async t => {
    const f = fixture(t);
    await f.openSignal();
    f.signal.message({ type: 'error', message: reason });
    await f.outcome;
    const text = errorText(f);
    assert.ok(text.startsWith(`${reason} [stage=waiting answer;`));
    assert.match(text, /signaling server error received/);
  });
}

test('peer identity timeout retains its phase and the original five-second deadline', async t => {
  const f = fixture(t);
  await f.openSignal();
  await f.answer();
  f.pc.channel.open();
  t.mock.timers.tick(5000);
  await f.outcome;
  assert.match(errorText(f), /WebRTC peer response timed out \[stage=peer identity;/);
});

test('cancellation keeps AbortError, closes all resources once and removes its listener', async t => {
  const f = fixture(t);
  await f.openSignal();
  f.abort.abort();
  await f.outcome;
  const error = f.failure();
  assert.ok(error instanceof DOMException);
  assert.equal(error.name, 'AbortError');
  assert.equal(error.message, 'Connection cancelled');
  assert.equal(f.pc.closeCalls, 1);
  assert.equal(f.pc.channel.closeCalls, 1);
  assert.equal(f.signal.closeCalls, 1);
  assert.equal(f.removeAbort.mock.callCount(), 1);
  f.signal.message({ type: 'answer', answer: encodeEndpoint({ type: 'answer', sdp }), signedPk });
  t.mock.timers.tick(12_000);
  await flush();
  assert.equal(f.pc.remoteDescriptions, 0);
  assert.equal(f.pc.closeCalls, 1);
});

test('signaling may close after the answer while ICE, identity and login still succeed', async t => {
  const f = fixture(t);
  await f.openSignal();
  await f.answer();
  f.signal.close();
  f.pc.channel.open();
  f.identity();
  f.pc.channel.receive(encodeMessage({ hash: { salt: 'salt', challenge: 'challenge' } }));
  f.pc.channel.receive(encodeMessage({ login_response: { peer_info: { hostname: 'test-peer' } } }));
  await f.outcome;
  assert.equal(f.failure(), undefined);
  const connected = f.connected();
  assert.ok(connected);
  assert.equal(connected.peerInfo.hostname, 'test-peer');
  t.mock.timers.tick(12_000);
  assert.equal(f.pc.closeCalls, 0);
  connected.stream.close();
  assert.equal(f.pc.closeCalls, 1);
  assert.equal(f.pc.channel.closeCalls, 1);
});

test('a rejected password keeps WebRtcLoginError so gateway fallback cannot submit it again', async t => {
  const f = fixture(t);
  await f.openSignal();
  await f.answer();
  f.pc.channel.open();
  f.identity();
  f.pc.channel.receive(encodeMessage({ hash: { salt: 'salt', challenge: 'challenge' } }));
  f.pc.channel.receive(encodeMessage({ login_response: { error: 'Wrong Password' } }));
  await f.outcome;
  const error = f.failure();
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'WebRtcLoginError');
  assert.equal(error.message, 'Wrong Password');
  assert.equal(f.pc.closeCalls, 1);
});
