// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { ClientMessage, CodecSupport, PeerMessage, QualityLevel, ServerMessage } from '@rustdesk-web/shared';

export const CONNECT_TIMEOUT_MS = 45_000;

export type SessionPhase = 'idle' | 'connecting' | 'live' | 'error';

export interface SessionSnapshot {
  phase: SessionPhase;
  detail: string;
  errorMessage: string;
  authRequired: boolean;
  peer: PeerMessage | null;
  clearPassword: boolean;
}

export const initialSession: SessionSnapshot = {
  phase: 'idle',
  detail: '',
  errorMessage: '',
  authRequired: false,
  peer: null,
  clearPassword: false,
};

export interface ConnectFields {
  mode: 'id' | 'direct';
  peerId: string;
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
  host: string;
  port: number;
  password: string;
  token: string;
  codecs: CodecSupport;
  quality: QualityLevel;
  fps: number;
  codec: string;
}

export type SessionEvent =
  | { type: 'connect-started' }
  | { type: 'server'; message: ServerMessage }
  | { type: 'socket-error' }
  | { type: 'socket-close' }
  | { type: 'timeout' }
  | { type: 'disconnect' };

export function wsUrl(location: { protocol: string; host: string }): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
}

export function buildConnectMessage(fields: ConnectFields): ClientMessage {
  if (fields.mode === 'id') {
    return {
      type: 'connect',
      mode: 'id',
      peerId: fields.peerId,
      idServer: fields.idServer,
      relayServer: fields.relayServer,
      key: fields.serverKey,
      forceRelay: fields.forceRelay,
      password: fields.password,
      token: fields.token,
      codecs: fields.codecs,
      quality: fields.quality,
      fps: fields.fps,
      codec: fields.codec,
    };
  }
  return {
    type: 'connect',
    mode: 'direct',
    host: fields.host,
    port: fields.port,
    password: fields.password,
    token: fields.token,
    codecs: fields.codecs,
    quality: fields.quality,
    fps: fields.fps,
    codec: fields.codec,
  };
}

export function isCurrentGeneration(active: number, eventGeneration: number): boolean {
  return active === eventGeneration;
}

export function reduceSession(state: SessionSnapshot, event: SessionEvent): SessionSnapshot {
  const next: SessionSnapshot = { ...state, clearPassword: false };
  switch (event.type) {
    case 'connect-started':
      return {
        ...initialSession,
        phase: 'connecting',
        detail: 'opening the gateway socket',
        authRequired: state.authRequired,
      };
    case 'server':
      return applyServerMessage(next, event.message);
    case 'timeout':
      if (state.phase !== 'connecting') return next;
      return {
        ...next,
        phase: 'error',
        detail: '',
        errorMessage: 'The connection timed out before the host answered.',
      };
    case 'socket-error':
      if (state.phase === 'error') return next;
      return {
        ...next,
        phase: 'error',
        detail: '',
        errorMessage: 'The gateway connection failed.',
      };
    case 'socket-close':
      if (state.phase === 'error') return next;
      if (state.phase === 'connecting') {
        return {
          ...next,
          phase: 'error',
          detail: '',
          errorMessage: 'The gateway closed the connection.',
        };
      }
      return { ...initialSession, authRequired: state.authRequired };
    case 'disconnect':
      return { ...initialSession, authRequired: state.authRequired };
    default:
      return next;
  }
}

function applyServerMessage(state: SessionSnapshot, message: ServerMessage): SessionSnapshot {
  switch (message.type) {
    case 'status':
      if (message.state === 'live') {
        return {
          ...state,
          phase: 'live',
          detail: message.detail === 'encrypted' ? 'encrypted' : 'connected',
          errorMessage: '',
        };
      }
      if (message.state === 'connecting') {
        return { ...state, phase: 'connecting', detail: message.detail || 'connecting' };
      }
      if (message.state === 'error') {
        const detail = message.detail ?? '';
        const passwordRejected = /password/i.test(detail);
        const tokenRejected = /token/i.test(detail);
        return {
          ...state,
          phase: 'error',
          detail: '',
          errorMessage: detail || 'The host rejected the connection.',
          authRequired: tokenRejected || state.authRequired,
          clearPassword: passwordRejected,
          peer: null,
        };
      }
      if (message.state === 'closed') {
        return { ...initialSession, authRequired: state.authRequired };
      }
      return state;
    case 'peer':
      return { ...state, peer: message };
    case 'permissions':
      if (!state.peer) return state;
      return {
        ...state,
        peer: {
          ...state.peer,
          privacyAllowed: message.privacyAllowed,
          clipboardAllowed: message.clipboardAllowed,
        },
      };
    case 'error':
      if (state.phase !== 'connecting') return { ...state, errorMessage: message.message };
      return {
        ...state,
        phase: 'error',
        detail: '',
        errorMessage: message.message,
        clearPassword: /password/i.test(message.message),
        authRequired: /token/i.test(message.message) || state.authRequired,
        peer: null,
      };
    default:
      return state;
  }
}
