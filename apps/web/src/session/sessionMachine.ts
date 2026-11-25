// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type {
  ClientMessage,
  CodecSupport,
  CursorShape,
  PeerMessage,
  QualityLevel,
  ServerMessage,
} from '@rustdesk-web/shared';
import { chooseDisplay } from '../lib/displays.ts';
import { validateClipboardText } from '../lib/platform.ts';

export const CONNECT_TIMEOUT_MS = 45_000;
export const RESTART_OFFLINE_MS = 45_000;
export const RESTART_RETRY_MS = 180_000;
export const RESTART_GAP_MS = 5_000;

export function restartReconnectDue(now: number, deadline: number, phase: SessionPhase): boolean {
  return (phase === 'idle' || phase === 'error') && now < deadline;
}

export type SessionPhase = 'idle' | 'connecting' | 'live' | 'error';

export function canSendSessionMessage(phase: SessionPhase, type: ClientMessage['type']): boolean {
  if (type === 'auth2fa') return phase === 'connecting';
  if (phase !== 'live') return false;
  switch (type) {
    case 'mouse': case 'key': case 'text': case 'switchDisplay': case 'quality':
    case 'followWindow': case 'audio': case 'ping': case 'resolution': case 'privacy':
    case 'restart': case 'chat':
      return true;
    default:
      return false;
  }
}


export interface SessionSnapshot {
  phase: SessionPhase;
  detail: string;
  errorMessage: string;
  authRequired: boolean;
  peer: PeerMessage | null;
  clearPassword: boolean;
  cursor: { x: number; y: number } | null;
  cursorShape: CursorShape | null;
  cursorEmbedded: boolean;
  displayOrigin: { x: number; y: number };
  currentDisplay: number;
  focusedDisplay: number | null;
  resolutions: { display: number; sizes: { width: number; height: number }[] } | null;
  clipboardText: string | null;
  clipboardSeq: number;
}

export const initialSession: SessionSnapshot = {
  phase: 'idle',
  detail: '',
  errorMessage: '',
  authRequired: false,
  peer: null,
  clearPassword: false,
  cursor: null,
  cursorShape: null,
  cursorEmbedded: false,
  displayOrigin: { x: 0, y: 0 },
  currentDisplay: 0,
  focusedDisplay: null,
  resolutions: null,
  clipboardText: null,
  clipboardSeq: 0,
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

export function nextPrivacyState(
  current: { enabled: boolean },
  result: { enabled?: boolean; failed: boolean },
): { enabled: boolean; pending: boolean; failed: boolean } {
  if (result.failed) return { enabled: current.enabled, pending: false, failed: true };
  return { enabled: result.enabled === true, pending: false, failed: false };
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
    case 'peer': {
      const choice = chooseDisplay(message.displays, message.currentDisplay);
      return {
        ...state,
        peer: { ...message, currentDisplay: choice.index },
        currentDisplay: choice.index,
        displayOrigin: choice.origin,
        cursorEmbedded: Boolean(choice.display?.cursorEmbedded),
      };
    }
    case 'display': {
      const displays = (state.peer?.displays ?? []).map((item, index) => index === message.display
        ? {
            ...item,
            x: message.x ?? item.x,
            y: message.y ?? item.y,
            width: message.width > 0 ? message.width : item.width,
            height: message.height > 0 ? message.height : item.height,
            name: message.name || item.name,
            cursorEmbedded: Boolean(message.cursorEmbedded),
          }
        : item);
      return {
        ...state,
        currentDisplay: message.display,
        displayOrigin: { x: message.x ?? 0, y: message.y ?? 0 },
        cursorEmbedded: Boolean(message.cursorEmbedded),
        peer: state.peer ? { ...state.peer, currentDisplay: message.display, displays } : state.peer,
      };
    }
    case 'resolutions':
      return { ...state, resolutions: { display: message.display, sizes: message.sizes } };
    case 'clipboard': {
      const text = message.text ?? '';
      if (validateClipboardText(text, false, true) !== 'ok') return state;
      return { ...state, clipboardText: text, clipboardSeq: state.clipboardSeq + 1 };
    }
    case 'focusedDisplay':
      return { ...state, focusedDisplay: message.display };
    case 'cursor': {
      const x = message.x - state.displayOrigin.x;
      const y = message.y - state.displayOrigin.y;
      const display = state.peer?.displays[state.peer.currentDisplay] ?? state.peer?.displays[0];
      const outside = Boolean(
        display && display.width > 0 && display.height > 0 &&
        (x < 0 || y < 0 || x >= display.width || y >= display.height),
      );
      return { ...state, cursor: outside ? null : { x, y } };
    }
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
    case 'cursorShape':
      return { ...state, cursorShape: message.shape };
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
