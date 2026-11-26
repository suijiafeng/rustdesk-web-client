import { Buffer } from 'buffer';
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
import { IdPkProto, decodeMessage, encodeMessage } from '../../../server/protos';
import { buildLoginOptions, type CodecCaps, type ClientMessage } from '../../../server/control';
import { MAX_MESSAGE_BYTES } from '../../../shared/webrtc';
import type { DataChannelStream } from './stream';
import type { NativeConnection } from './session';

export type ConnectRequest = Extract<ClientMessage, { type: 'connect' }>;
export class LoginError extends Error { name = 'WebRtcLoginError'; }
const PUBLIC_SERVER_KEY = 'OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw=';

function openIdentity(signed: Uint8Array, key: Uint8Array, expectedId: string) {
  if (key.length !== 32) throw new Error('Invalid identity server key');
  const opened = nacl.sign.open(signed, key);
  if (!opened) throw new Error('WebRTC peer signature verification failed');
  let identity: ReturnType<typeof IdPkProto.toObject>;
  try {
    identity = IdPkProto.toObject(IdPkProto.decode(opened), { bytes: Uint8Array, defaults: true });
  } catch {
    throw new Error('WebRTC peer identity is malformed');
  }
  if (identity.id !== expectedId || identity.pk.length !== 32) throw new Error('WebRTC peer identity mismatch');
  return identity;
}

export function verifiedPeerKey(signedPk: string, serverKey: string, peerId: string): Uint8Array {
  const root = Buffer.from(serverKey.trim() || PUBLIC_SERVER_KEY, 'base64');
  return openIdentity(Buffer.from(signedPk, 'base64'), root, peerId).pk;
}

export function verifyFingerprint(signedId: Uint8Array, peerKey: Uint8Array, peerId: string, fingerprint: string): Uint8Array {
  const identity = openIdentity(signedId, peerKey, peerId);
  if (!identity.dtls_fingerprint || identity.dtls_fingerprint.trim().toLowerCase() !== fingerprint.trim().toLowerCase()) {
    throw new Error('WebRTC certificate does not match the signed peer identity');
  }
  return identity.pk;
}

export async function loginWebRtc(
  stream: DataChannelStream, request: ConnectRequest, codecs: CodecCaps,
  peerKey: Uint8Array, fingerprint: string, onVerified: () => void,
): Promise<NativeConnection> {
  const peerId = request.peerId!.replace(/\s/g, '');
  const first = await stream.next(5000);
  if (!first) throw new Error('WebRTC peer closed during identity verification');
  const identity = decodeMessage(first);
  if (!identity.signed_id?.id) throw new Error('WebRTC peer did not provide its signed identity');
  const publicKey = verifyFingerprint(identity.signed_id.id, peerKey, peerId, fingerprint);
  const pair = nacl.box.keyPair();
  const key = nacl.randomBytes(32);
  await stream.sendRaw(encodeMessage({ public_key: {
    asymmetric_value: pair.publicKey,
    symmetric_value: nacl.box(key, new Uint8Array(24), publicKey, pair.secretKey),
    kx_version: 0,
  } }));
  onVerified();
  const connection: NativeConnection = {
    stream, route: 'webrtc', encrypted: true, peerInfo: {}, username: peerId,
    privacyAllowed: true, clipboardAllowed: true, restartAllowed: true,
  };
  const option = buildLoginOptions(codecs, request.quality, request.fps, request.codec, request.customQuality, request.lockAfterSessionEnd);
  const deadline = Date.now() + 20_000;
  let submitted = false;
  try {
    while (Date.now() < deadline) {
      const raw = await stream.next(Math.max(1, deadline - Date.now()));
      if (!raw) throw new Error('WebRTC peer closed before login');
      const message = decodeMessage(raw);
      const permission = message.misc?.permission_info;
      if (permission?.permission === 8) connection.privacyAllowed = permission.enabled === true;
      if (permission?.permission === 2) connection.clipboardAllowed = permission.enabled === true;
      if (permission?.permission === 5) connection.restartAllowed = permission.enabled === true;
      if (message.hash && !submitted) {
        submitted = true;
        const { salt = '', challenge = '' } = message.hash;
        const hash = sha256(Buffer.from((request.password ?? '') + salt));
        const password = sha256(Buffer.concat([hash, Buffer.from(challenge)]));
        await stream.sendRaw(encodeMessage({ login_request: {
          username: peerId, password, my_id: 'web-client', my_name: 'Web Client',
          my_platform: 'Web', version: '1.5.3', option,
        } }));
      }
      if (message.login_response?.union === 'error') throw new LoginError(message.login_response.error || 'The host rejected the login');
      if (message.auth_2fa) throw new LoginError('The host requires two-factor authentication, which this web client does not support yet.');
      if (message.misc?.close_reason || message.message_box?.text) {
        throw new LoginError(message.misc?.close_reason || message.message_box.text);
      }
      const peer = message.login_response?.peer_info ?? message.peer_info;
      if (peer && submitted) {
        connection.peerInfo = peer;
        stream.reader.limit = MAX_MESSAGE_BYTES;
        await stream.sendRaw(encodeMessage({ misc: { option } }));
        await stream.sendRaw(encodeMessage({ misc: { refresh_video: true } }));
        return connection;
      }
    }
    throw new Error('WebRTC login timed out');
  } catch (error) {
    // Do not retry a password on a second transport after submitting it to the peer.
    if (submitted) throw new LoginError(error instanceof Error ? error.message : 'WebRTC login failed');
    throw error;
  }
}
