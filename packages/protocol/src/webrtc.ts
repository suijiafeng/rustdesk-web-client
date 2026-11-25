// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export const MAX_ENDPOINT_LENGTH = 32 * 1024;
export const MAX_CANDIDATES = 128;
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
export const FRAGMENT_PAYLOAD = 60_000;

// The fingerprint is also RustDesk's ICE routing session key; preserve its spelling.
export function sdpFingerprint(sdp: string): string {
  const values = [...sdp.matchAll(/^a=fingerprint:([^\r\n]+)/gm)].map(match => match[1].trim());
  if (!values.length || values.some(value => value !== values[0]) ||
      !/^sha-256 (?:[\da-f]{2}:){31}[\da-f]{2}$/i.test(values[0])) {
    throw new Error('Invalid WebRTC certificate fingerprint');
  }
  return values[0];
}

export function encodeEndpoint(description: { type: string; sdp: string }): string {
  const sdp = description.sdp.split(/\r?\n/)
    .filter(line => line && !line.startsWith('a=candidate:') && line !== 'a=end-of-candidates')
    .join('\r\n') + '\r\n';
  sdpFingerprint(sdp);
  const endpoint = 'webrtc://' + encodeBase64(new TextEncoder().encode(JSON.stringify({ type: description.type, sdp, ice_policy: 'all' })));
  if (endpoint.length > MAX_ENDPOINT_LENGTH) throw new Error('WebRTC endpoint is too large');
  return endpoint;
}

export function decodeEndpoint(endpoint: string, type: 'offer' | 'answer'): { type: 'offer' | 'answer'; sdp: string } {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH || !endpoint.startsWith('webrtc://')) {
    throw new Error('Invalid WebRTC endpoint');
  }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(endpoint.slice(9))));
  if (!value || value.type !== type || typeof value.sdp !== 'string' || !value.sdp.includes('m=application ')) {
    throw new Error('Invalid WebRTC session description');
  }
  sdpFingerprint(value.sdp);
  return { type, sdp: value.sdp };
}

export function validateCandidate(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid ICE candidate');
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed.candidate !== 'string' || parsed.candidate.length > 4096 ||
      (parsed.sdpMid != null && typeof parsed.sdpMid !== 'string') ||
      (parsed.sdpMLineIndex != null && (!Number.isInteger(parsed.sdpMLineIndex) || parsed.sdpMLineIndex < 0))) {
    throw new Error('Invalid ICE candidate');
  }
  return value;
}

// RustDesk frames each SCTP message with one byte: 1 = continuation, 0 = final.
export class FragmentReader {
  limit = 1024 * 1024;
  private parts: Uint8Array[] = [];
  private bytes = 0;
  push(fragment: Uint8Array): Uint8Array | null {
    if (fragment.length < 1 || fragment.length > FRAGMENT_PAYLOAD + 1 || fragment[0] > 1) {
      throw new Error('Invalid WebRTC fragment');
    }
    const payload = fragment.subarray(1);
    this.bytes += payload.length;
    if (this.bytes > this.limit || this.parts.length >= 2048) throw new Error('WebRTC message is too large');
    if (!this.parts.length && fragment[0] === 0) { this.bytes = 0; return payload; }
    this.parts.push(payload);
    if (fragment[0] === 1) return null;
    const result = new Uint8Array(this.bytes);
    let offset = 0;
    for (const part of this.parts) { result.set(part, offset); offset += part.length; }
    this.parts = [];
    this.bytes = 0;
    return result;
  }
}
