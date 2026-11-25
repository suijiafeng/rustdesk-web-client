// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodeBase64, decodeIdPk, decodeMessage, encodeMessage } from '@rustdesk-web/protocol';
import { buildLoginOptions, type CodecCaps, type ClientMessage } from '@rustdesk-web/protocol';
import { MAX_MESSAGE_BYTES } from '@rustdesk-web/protocol';
import type { DataChannelStream } from './stream.ts';
import type { NativeConnection } from './session.ts';

export type ConnectRequest = Extract<ClientMessage, { type: 'connect' }>;
export class LoginError extends Error { name = 'WebRtcLoginError'; }
const PUBLIC_SERVER_KEY = 'OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw=';

function openIdentity(signed: Uint8Array, key: Uint8Array, expectedId: string) {
  if (key.length !== 32) throw new Error('Invalid identity server key');
  const opened = nacl.sign.open(signed, key);
  if (!opened) throw new Error('WebRTC peer signature verification failed');
  const identity = decodeIdPk(opened);
  if (identity.id !== expectedId || identity.pk.length !== 32) throw new Error('WebRTC peer identity mismatch');
  return identity;
}

export function verifiedPeerKey(signedPk: string, serverKey: string, peerId: string): Uint8Array {
  const root = decodeBase64(serverKey.trim() || PUBLIC_SERVER_KEY);
  return openIdentity(decodeBase64(signedPk), root, peerId).pk;
}

export function verifyFingerprint(signedId: Uint8Array, peerKey: Uint8Array, peerId: string, fingerprint: string): Uint8Array {
  const identity = openIdentity(signedId, peerKey, peerId);
  if (!identity.dtlsFingerprint || identity.dtlsFingerprint.trim().toLowerCase() !== fingerprint.trim().toLowerCase()) {
    throw new Error('WebRTC certificate does not match the signed peer identity');
  }
  return identity.pk;
}

export async function loginWebRtc(
  stream: DataChannelStream, request: ConnectRequest, codecs: CodecCaps,
  peerKey: Uint8Array, fingerprint: string, onVerified: () => void,
  askTwoFactor: () => Promise<string | null>,
): Promise<NativeConnection> {
  const peerId = request.peerId!.replace(/\s/g, '');
  const first = await stream.next(5000);
  if (!first) throw new Error('WebRTC peer closed during identity verification');
  const identity = decodeMessage(first);
  if (!identity.signed_id?.id) throw new Error('WebRTC peer did not provide its signed identity');
  const publicKey = verifyFingerprint(Uint8Array.from(identity.signed_id.id), peerKey, peerId, fingerprint);
  const pair = nacl.box.keyPair();
  const key = nacl.randomBytes(32);
  await stream.sendRaw(encodeMessage({ public_key: {
    asymmetric_value: pair.publicKey,
    symmetric_value: nacl.box(key, new Uint8Array(24), publicKey, pair.secretKey),
    kx_version: 0,
  } }));
  onVerified();
  const connection: NativeConnection = {
    stream, route: 'webrtc-direct', encrypted: true, peerInfo: {}, username: peerId,
    privacyAllowed: true, clipboardAllowed: true, restartAllowed: true,
  };
  const option = buildLoginOptions(codecs, request.quality, request.fps, request.codec);
  let deadline = Date.now() + 20_000;
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
        const encoder = new TextEncoder();
        const hash = sha256(encoder.encode((request.password ?? '') + salt));
        const challengeBytes = encoder.encode(challenge);
        const challenged = new Uint8Array(hash.length + challengeBytes.length);
        challenged.set(hash);
        challenged.set(challengeBytes, hash.length);
        const password = sha256(challenged);
        await stream.sendRaw(encodeMessage({ login_request: {
          username: peerId, password, my_id: 'web-client', my_name: 'Web Client',
          my_platform: 'Web', version: '1.5.3', option,
        } }));
      }
      if (message.login_response?.union === 'error') throw new LoginError(message.login_response.error || 'The host rejected the login');
      if (message.auth_2fa) {
        const started = Date.now();
        const code = await askTwoFactor();
        if (!code) throw new LoginError('Two-factor authentication expired');
        deadline += Date.now() - started;
        await stream.sendRaw(encodeMessage({
          auth_2fa: { code, trust_this_device: false, ...(message.auth_2fa.hwid ? { hwid: message.auth_2fa.hwid } : {}) },
        }));
        continue;
      }
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
