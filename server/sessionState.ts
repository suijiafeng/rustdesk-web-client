import type { CursorPublisher } from '../shared/cursor.ts';
import type { WebSocket } from 'ws';
import type { GatewayAdmission } from './admission.ts';
import type { CodecCaps } from '../shared/control.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { GatewayVideoBuffer } from './videoBuffer.ts';

export interface GatewayConfig {
  token: string;
  admission?: GatewayAdmission;
}

export interface SessionState {
  cursorIds?: boolean;
  cursorPublisher?: CursorPublisher;
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

