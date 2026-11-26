/** Stable error contract shared by the gateway and browser. Native/legacy text is classified only here. */
export const ERROR_CODES = [
  'GATEWAY_TOKEN_INVALID', 'RATE_LIMITED', 'PASSWORD_INVALID', 'PASSWORD_REQUIRED', 'TWO_FACTOR_REQUIRED',
  'PEER_NOT_FOUND', 'PEER_OFFLINE', 'IDENTITY_INVALID', 'TARGET_ADDRESS_BLOCKED', 'TARGET_PORT_BLOCKED',
  'DNS_FAILED', 'UNREACHABLE', 'TIMEOUT', 'CONNECTION_CLOSED', 'SESSION_INTERRUPTED', 'PROTOCOL_INVALID',
  'PROTOCOL_HTTP', 'WEBRTC_UNAVAILABLE', 'WEBRTC_FAILED', 'WEBRTC_CSP', 'CODEC_UNSUPPORTED',
  'CODEC_FAILED', 'INSECURE_CONTEXT', 'GATEWAY_UNAVAILABLE', 'INVALID_REQUEST', 'UNKNOWN',
] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export const ERROR_STAGES = ['admission', 'rendezvous', 'identity', 'login', 'signaling', 'transport', 'session', 'codec', 'input'] as const;
export type ErrorStage = typeof ERROR_STAGES[number];
export interface ErrorPayload { code: ErrorCode; stage: ErrorStage; detail: string }

export class AppError extends Error implements ErrorPayload {
  readonly detail: string;
  constructor(readonly code: ErrorCode, readonly stage: ErrorStage, raw: string) {
    super(raw);
    this.name = 'AppError';
    this.detail = raw;
  }
}

export function readErrorPayload(value: unknown): ErrorPayload | undefined {
  if (!value || typeof value !== 'object') return;
  const payload = value as Partial<ErrorPayload>;
  if (!ERROR_CODES.includes(payload.code as ErrorCode) || !ERROR_STAGES.includes(payload.stage as ErrorStage) ||
      typeof payload.detail !== 'string') return;
  return { code: payload.code!, stage: payload.stage!, detail: payload.detail.slice(0, 4096) };
}

/** Compatibility boundary for RustDesk's text-only errors and older gateway releases. */
export function classifyLegacyError(raw: string): ErrorCode {
  const text = raw.toLowerCase();
  if (/too many failed attempts/.test(text)) return 'RATE_LIMITED';
  if (/two.factor authentication|2fa required|wrong 2fa code/.test(text)) return 'TWO_FACTOR_REQUIRED';
  if (/gateway(?: access)? token|invalid token|token (?:required|missing|incorrect)|令牌/.test(text)) return 'GATEWAY_TOKEN_INVALID';
  if (/wrong password|rejected the password/.test(text)) return 'PASSWORD_INVALID';
  if (/empty password|requires a password|no password access/.test(text)) return 'PASSWORD_REQUIRED';
  if (/target address is not allowed/.test(text)) return 'TARGET_ADDRESS_BLOCKED';
  if (/target port is not allowed/.test(text)) return 'TARGET_PORT_BLOCKED';
  if (/secure context|webcodecs.*https/.test(text)) return 'INSECURE_CONTEXT';
  if (/cannot decode|不支持 vp8/.test(text)) return 'CODEC_UNSUPPORTED';
  if (/webcodecs|videodecoder/.test(text)) return 'CODEC_FAILED';
  if (/session disconnected unexpectedly|远程会话意外断开/.test(text)) return 'SESSION_INTERRUPTED';
  if (/dns lookup|enotfound|eai_again|eai_nodata|eai_noname|eservfail|域名解析/.test(text)) return 'DNS_FAILED';
  if (/signature|public key|server key|key mismatch|key overuse|signed_params|identity|decrypt|certificate|fingerprint/.test(text)) return 'IDENTITY_INVALID';
  if (/unsafe-eval/.test(text)) return 'WEBRTC_CSP';
  if (/timed out|timeout|etimedout|did not answer in time/.test(text)) return 'TIMEOUT';
  if (/id does not exist|peer not found/.test(text)) return 'PEER_NOT_FOUND';
  if (/offline|not match this host/.test(text)) return 'PEER_OFFLINE';
  if (/not a rustdesk|http response|http\/https|tls\/https|ssh service|invalid wire type|index out of range|frame overflow|invalid protocol/.test(text)) {
    return /http|tls/.test(text) ? 'PROTOCOL_HTTP' : 'PROTOCOL_INVALID';
  }
  if (/did not offer webrtc|webrtc signaling unavailable/.test(text)) return 'WEBRTC_UNAVAILABLE';
  if (/host closed|peer closed|signaling closed|closed.*signaling|channel is closed|closed connection/.test(text)) return 'CONNECTION_CLOSED';
  if (/cannot reach|connection refused|econnrefused|failed to connect|os error 111|network is unreachable|enetunreach|ehostunreach/.test(text)) return 'UNREACHABLE';
  if (/invalid id server or peer id|invalid signaling|send a webrtc offer|unexpected ice/.test(text)) return 'INVALID_REQUEST';
  if (/webrtc.*failed|invalid webrtc endpoint|invalid webrtc session description|invalid ice candidate|incompatible id server/.test(text)) return 'WEBRTC_FAILED';
  if (/gateway|网关/.test(text)) return 'GATEWAY_UNAVAILABLE';
  return 'UNKNOWN';
}

export function asAppError(error: unknown, stage: ErrorStage = 'session'): AppError {
  const payload = readErrorPayload(error);
  if (payload) return new AppError(payload.code, payload.stage, payload.detail);
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return new AppError(classifyLegacyError(raw), stage, raw);
}

export function errorPayload(error: unknown, stage: ErrorStage = 'session'): ErrorPayload {
  const value = asAppError(error, stage);
  return { code: value.code, stage: value.stage, detail: value.detail.slice(0, 4096) };
}

/** Only transport/capability failures may try the other route. Unknown server refusals fail closed. */
export function mayFallbackFromWebRtc(error: unknown): boolean {
  const { code, stage } = asAppError(error, 'transport');
  if (stage === 'identity' || stage === 'login' || stage === 'admission') return false;
  return ['TIMEOUT', 'UNREACHABLE', 'CONNECTION_CLOSED', 'WEBRTC_UNAVAILABLE', 'WEBRTC_FAILED', 'WEBRTC_CSP', 'DNS_FAILED'].includes(code);
}
