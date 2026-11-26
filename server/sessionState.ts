import type { WebSocket } from 'ws';
import type { GatewayAdmission } from './admission.ts';
import type { CodecCaps } from './control.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { GatewayVideoBuffer } from './videoBuffer.ts';

export interface GatewayConfig {
  token: string;
  admission?: GatewayAdmission;
}

export interface SessionState {
  phase: 'awaiting-connect' | 'connecting' | 'live' | 'closed';
  resolutionDisplay: number;
  sizes: { width: number; height: number }[];
  hostConn: ConnectedHost | null;
  sessionCodecs: CodecCaps | undefined;
  preferredCodec: string | undefined;
  privacyImpl: string;
  audioRequested: boolean;
  audioAllowed: boolean;
  audioFormat: { sampleRate: number; channels: number } | null;
  currentSize: { width: number; height: number };
}

export interface SessionContext {
  state: SessionState;
  ws: WebSocket;
  videoBuffer: GatewayVideoBuffer;
  sendJson: (payload: Record<string, unknown>) => void;
  sendBinary: (buf: Buffer) => void;
  cleanup: (sendClosedStatus: boolean) => void;
}

export function permissions(conn: ConnectedHost) {
  return {
    privacyAllowed: conn.privacyAllowed && conn.peerInfo.features?.privacy_mode === true,
    clipboardAllowed: conn.clipboardAllowed,
  };
}

export function canRestart(conn: ConnectedHost): boolean {
  return conn.restartAllowed && ['windows', 'mac os', 'macos', 'linux'].includes(String(conn.peerInfo.platform).toLowerCase());
}

