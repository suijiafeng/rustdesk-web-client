// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export const GATEWAY_SERVICE = 'rustdesk-web-gateway';
export const HEALTH_PATH = '/api/health';

export interface HealthResponse {
  ok: true;
  service: typeof GATEWAY_SERVICE;
  webRtcEnabled?: boolean;
}

export { messageType } from './messages.ts';
export type {
  ClientMessage,
  CodecSupport,
  CursorShape,
  DisplayInfo,
  PeerEncodingInfo,
  PeerMessage,
  QualityLevel,
  ServerMessage,
} from './messages.ts';
