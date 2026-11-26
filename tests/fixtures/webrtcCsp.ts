import { Buffer } from 'buffer';
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodeMessage, encodeMessage, IdPkProto } from '../../server/protos';
import { selectCodecs } from '../../server/control';
import { loginWebRtc, verifiedPeerKey } from '../../src/lib/webrtc/handshake';
import { DataChannelStream } from '../../src/lib/webrtc/stream';
import { sdpFingerprint } from '../../shared/webrtc';

// This module runs as a normal page script, never through DevTools evaluation.
// It exercises both protocol directions over real local RTC data channels.
const result = { status: 'running', error: '', violations: [] as { directive: string; blockedURI: string }[], verified: false, loggedIn: false };
Object.assign(window, { cspResult: result });
document.addEventListener('securitypolicyviolation', event => result.violations.push({
  directive: event.violatedDirective, blockedURI: event.blockedURI,
}));

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function waitForOpen(channel: RTCDataChannel) {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    channel.addEventListener('open', () => resolve(), { once: true });
    channel.addEventListener('error', () => reject(new Error('Test data channel failed')), { once: true });
  });
}

async function run() {
  const browser = new RTCPeerConnection({ iceServers: [] });
  const host = new RTCPeerConnection({ iceServers: [] });
  const pendingBrowser: RTCIceCandidateInit[] = [];
  const pendingHost: RTCIceCandidateInit[] = [];
  const relay = (peer: RTCPeerConnection, pending: RTCIceCandidateInit[]) => (event: RTCPeerConnectionIceEvent) => {
    if (!event.candidate) return;
    if (peer.remoteDescription) void peer.addIceCandidate(event.candidate).catch(error => { result.error = String(error); });
    else pending.push(event.candidate.toJSON());
  };
  browser.onicecandidate = relay(host, pendingHost);
  host.onicecandidate = relay(browser, pendingBrowser);
  const channel = browser.createDataChannel('bootstrap', { ordered: true });
  const clientStream = new DataChannelStream(channel);
  let hostStream: DataChannelStream | undefined;
  const hostChannel = new Promise<RTCDataChannel>(resolve => {
    host.ondatachannel = event => {
      hostStream = new DataChannelStream(event.channel);
      resolve(event.channel);
    };
  });
  const timeout = setTimeout(() => {
    result.error ||= 'Local WebRTC handshake timed out';
    clientStream.close();
    hostStream?.close();
    browser.close();
    host.close();
  }, 10_000);
  try {
    await browser.setLocalDescription(await browser.createOffer());
    await host.setRemoteDescription(browser.localDescription!);
    for (const candidate of pendingHost.splice(0)) await host.addIceCandidate(candidate);
    await host.setLocalDescription(await host.createAnswer());
    await browser.setRemoteDescription(host.localDescription!);
    for (const candidate of pendingBrowser.splice(0)) await browser.addIceCandidate(candidate);
    await Promise.all([waitForOpen(channel), hostChannel.then(waitForOpen)]);

    const peerId = '123456789';
    const serverIdentity = nacl.sign.keyPair();
    const peerIdentity = nacl.sign.keyPair();
    const encryption = nacl.box.keyPair();
    const fingerprint = sdpFingerprint(host.localDescription!.sdp);
    const signed = (key: Uint8Array, signer: Uint8Array, dtls_fingerprint = '') => nacl.sign(
      IdPkProto.encode(IdPkProto.create({ id: peerId, pk: key, dtls_fingerprint })).finish(), signer,
    );
    const serverKey = Buffer.from(serverIdentity.publicKey).toString('base64');
    const signedPeer = Buffer.from(signed(peerIdentity.publicKey, serverIdentity.secretKey)).toString('base64');
    const peerKey = verifiedPeerKey(signedPeer, serverKey, peerId);
    let rejectedIdentity = false;
    try { verifiedPeerKey(signedPeer, serverKey, '987654321'); } catch { rejectedIdentity = true; }
    check(rejectedIdentity, 'Identity validation must remain active under CSP');

    const password = 'local-test-only';
    const salt = 'fixture-salt';
    const challenge = 'fixture-challenge';
    const serveHost = async () => {
      await hostStream!.sendRaw(encodeMessage({ signed_id: {
        id: signed(encryption.publicKey, peerIdentity.secretKey, fingerprint),
      } }));
      const publicKey = decodeMessage((await hostStream!.next(3000))!).public_key;
      check(publicKey?.asymmetric_value?.length === 32, 'Missing client key exchange');
      const opened = nacl.box.open(publicKey.symmetric_value, new Uint8Array(24), publicKey.asymmetric_value, encryption.secretKey);
      check(opened?.length === 32, 'Invalid encrypted session key');
      await hostStream!.sendRaw(encodeMessage({ hash: { salt, challenge } }));
      const login = decodeMessage((await hostStream!.next(3000))!).login_request;
      const expected = sha256(Buffer.concat([sha256(Buffer.from(password + salt)), Buffer.from(challenge)]));
      check(login?.username === peerId && Buffer.from(login.password).equals(Buffer.from(expected)), 'Invalid login payload');
      await hostStream!.sendRaw(encodeMessage({ login_response: {
        peer_info: { hostname: 'CSP fixture', platform: 'Linux', displays: [] },
      } }));
      for (let index = 0; index < 2; index++) {
        check(decodeMessage((await hostStream!.next(3000))!).misc, 'Missing post-login options');
      }
    };
    const login = loginWebRtc(clientStream, { type: 'connect', peerId, password }, selectCodecs({ vp9: true }),
      peerKey, fingerprint, () => { result.verified = true; });
    const [connection] = await Promise.all([login, serveHost()]);
    check(connection.peerInfo.hostname === 'CSP fixture', 'Missing authenticated peer');
    result.loggedIn = true;
    // long.js probes optional Wasm acceleration and safely falls back to JavaScript.
    // Keep Wasm blocked as in production; dynamic JavaScript must never be needed.
    check(result.violations.every(event => event.blockedURI === 'wasm-eval'), 'JavaScript CSP violation during WebRTC handshake');
    check(!result.error, result.error);
    result.status = 'passed';
  } finally {
    clearTimeout(timeout);
    clientStream.close();
    hostStream?.close();
    browser.close();
    host.close();
  }
}

void run().catch(error => { result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error); });
