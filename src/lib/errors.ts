import { asAppError, type ErrorCode, type ErrorPayload } from '../../shared/errors';
import { t, type I18nKey, type Locale } from './i18n';

export type ErrorKind = 'auth' | 'network' | 'codec' | 'generic';
export interface FormattedError { kind: ErrorKind; title: string; message: string }

const DISPLAY: Record<ErrorCode, [ErrorKind, I18nKey, I18nKey]> = {
  GATEWAY_TOKEN_INVALID: ['auth', 'errTitleGatewayToken', 'errMsgGatewayToken'],
  RATE_LIMITED: ['generic', 'errTitleRateLimited', 'errMsgRateLimited'],
  PASSWORD_INVALID: ['auth', 'errTitleWrongPassword', 'errMsgWrongPassword'],
  PASSWORD_REQUIRED: ['auth', 'errTitlePasswordRequired', 'errMsgPasswordRequired'],
  TWO_FACTOR_REQUIRED: ['generic', 'errTitleTwoFactorUnsupported', 'errMsgTwoFactorUnsupported'],
  PEER_NOT_FOUND: ['network', 'errTitleIdNotFound', 'errMsgIdNotFound'],
  PEER_OFFLINE: ['network', 'errTitleOffline', 'errMsgOffline'],
  IDENTITY_INVALID: ['network', 'errTitleServerKey', 'errMsgServerKey'],
  TARGET_ADDRESS_BLOCKED: ['network', 'errTitleTargetPolicy', 'errMsgTargetAddressPolicy'],
  TARGET_PORT_BLOCKED: ['network', 'errTitleTargetPolicy', 'errMsgTargetPortPolicy'],
  DNS_FAILED: ['network', 'errTitleDns', 'errMsgDns'],
  UNREACHABLE: ['network', 'errTitleUnreachable', 'errMsgUnreachable'],
  TIMEOUT: ['network', 'errTitleTimeout', 'errMsgTimeout'],
  CONNECTION_CLOSED: ['network', 'errTitleDisconnected', 'errMsgDisconnected'],
  SESSION_INTERRUPTED: ['network', 'errTitleDisconnected', 'errMsgDisconnected'],
  PROTOCOL_INVALID: ['network', 'errTitleNotRustDesk', 'errMsgNotRustDeskProto'],
  PROTOCOL_HTTP: ['network', 'errTitleNotRustDesk', 'errMsgNotRustDeskHttp'],
  WEBRTC_UNAVAILABLE: ['network', 'errTitleGateway', 'errMsgGateway'],
  WEBRTC_FAILED: ['network', 'errTitleUnreachable', 'errMsgUnreachable'],
  WEBRTC_CSP: ['network', 'errTitleGeneric', 'errMsgUnexpected'],
  CODEC_UNSUPPORTED: ['codec', 'errTitleCodec', 'detailNoCodecs'],
  CODEC_FAILED: ['codec', 'errTitleCodec', 'errMsgWebCodecsUnsupported'],
  INSECURE_CONTEXT: ['codec', 'errTitleCodec', 'errMsgInsecureContext'],
  GATEWAY_UNAVAILABLE: ['network', 'errTitleGateway', 'errMsgGateway'],
  INVALID_REQUEST: ['generic', 'errTitleGeneric', 'errMsgUnexpected'],
  UNKNOWN: ['generic', 'errTitleGeneric', 'errMsgUnexpected'],
};

/** Localize stable codes; string support is only for old gateways and native decoder messages. */
export function formatConnectionError(locale: Locale, error: string | ErrorPayload): FormattedError {
  const { code, detail } = asAppError(error);
  const [kind, titleKey, messageKey] = DISPLAY[code];
  let message = t(locale, messageKey);
  if (code === 'DNS_FAILED') {
    const domain = detail.match(/DNS lookup (?:failed|timed out) for "([^"]+)"/i)?.[1];
    if (domain) message = locale === 'zh'
      ? `无法解析域名「${domain}」，请检查域名拼写、去掉 http:// 前缀并确认 DNS 记录正常。`
      : `Could not resolve domain "${domain}". Check the spelling, remove any http:// prefix, and verify DNS records.`;
  }
  return { kind, title: t(locale, titleKey), message };
}
