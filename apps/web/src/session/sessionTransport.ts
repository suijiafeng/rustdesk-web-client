// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { HEALTH_PATH, type HealthResponse } from '@rustdesk-web/shared';
import type { ConnectRequest } from '../lib/webrtc/handshake.ts';
import { TWO_FACTOR_TIMEOUT_MS, validateTwoFactorCode } from '../lib/platform.ts';

export type SessionSocket = Pick<WebSocket, 'readyState' | 'binaryType' | 'send' | 'close' | 'onopen' | 'onclose' | 'onmessage' | 'onerror'>;

export async function gatewayEnablesWebRtc(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_PATH, {
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(1_500)]),
    });
    if (!response.ok) return false;
    const health = await response.json() as Partial<HealthResponse> | null;
    return health?.ok === true && health.webRtcEnabled === true;
  } catch {
    return false;
  }
}

export function createSessionSocket(
  url: string,
  request: ConnectRequest,
  webRtcEnabled: boolean,
): SessionSocket {
  if (!webRtcEnabled || request.mode !== 'id' || request.forceRelay || !request.peerId || !request.idServer
    || !window.isSecureContext || typeof RTCPeerConnection !== 'function') return new WebSocket(url);

  const abort = new AbortController();
  let gateway: WebSocket | null = null;
  let native: ReturnType<typeof import('../lib/webrtc/session.ts').createNativeSession> | null = null;
  let state: 0 | 1 | 2 | 3 = WebSocket.CONNECTING;
  let finishFactor: ((code: string | null) => void) | null = null;
  let factorAttempts = 0;
  let factorStarted = 0;

  const emit = (data: string | ArrayBuffer) => {
    socket.onmessage?.call(socket as WebSocket, new MessageEvent('message', { data }));
  };

  const close = () => {
    if (state === WebSocket.CLOSED) return;
    state = WebSocket.CLOSED;
    finishFactor?.(null);
    abort.abort();
    native?.close();
    gateway?.close();
    socket.onclose?.call(socket as WebSocket, new CloseEvent('close'));
  };

  const socket: SessionSocket = {
    binaryType: 'arraybuffer',
    get readyState() { return state === WebSocket.CLOSED ? state : gateway?.readyState ?? state; },
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    close,
    send(data) {
      if (gateway) {
        gateway.send(data);
        return;
      }
      if (typeof data !== 'string') throw new TypeError('Invalid session command');
      const message = JSON.parse(data);
      if (message.type === 'disconnect') {
        close();
        return;
      }
      if (message.type === 'auth2fa') {
        if (finishFactor && typeof message.code === 'string' && validateTwoFactorCode(message.code)) {
          factorAttempts += 1;
          finishFactor(message.code);
        }
        return;
      }
      if (!native || state !== WebSocket.OPEN) throw new Error('WebRTC session is not ready');
      native.send(message);
    },
  };

  function askTwoFactor(): Promise<string | null> {
    if (!factorStarted) factorStarted = Date.now();
    const remaining = TWO_FACTOR_TIMEOUT_MS - (Date.now() - factorStarted);
    if (remaining <= 0 || factorAttempts >= 3 || state === WebSocket.CLOSED) return Promise.resolve(null);
    state = WebSocket.OPEN;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => finishFactor?.(null), remaining);
      finishFactor = (code) => {
        window.clearTimeout(timer);
        finishFactor = null;
        resolve(code);
      };
      emit(JSON.stringify({ type: 'twoFactorRequired' }));
    });
  }

  function openGateway() {
    if (abort.signal.aborted) return;
    gateway = new WebSocket(url);
    gateway.binaryType = socket.binaryType;
    gateway.onopen = (event) => socket.onopen?.call(socket as WebSocket, event);
    gateway.onmessage = (event) => emit(event.data);
    gateway.onerror = (event) => socket.onerror?.call(socket as WebSocket, event);
    gateway.onclose = (event) => {
      if (state === WebSocket.CLOSED) return;
      state = WebSocket.CLOSED;
      abort.abort();
      socket.onclose?.call(socket as WebSocket, event);
    };
  }

  async function start() {
    if (abort.signal.aborted) return;
    const modules = await Promise.all([
      import('../lib/webrtc/connect.ts'),
      import('../lib/webrtc/handshake.ts'),
      import('../lib/webrtc/session.ts'),
    ]).catch(() => null);
    if (abort.signal.aborted) return;
    if (!modules) {
      openGateway();
      return;
    }
    const [{ connectWebRtc }, { LoginError }, { createNativeSession }] = modules;
    let connected = false;
    try {
      const connection = await connectWebRtc(url, request, abort.signal, askTwoFactor);
      connected = true;
      if (abort.signal.aborted) {
        connection.stream.close();
        return;
      }
      native = createNativeSession(connection, request.codecs, emit, close);
      state = WebSocket.OPEN;
      native.start();
    } catch (error) {
      if (abort.signal.aborted) return;
      if (connected || error instanceof LoginError) {
        const detail = error instanceof Error ? error.message : 'WebRTC session failed';
        emit(JSON.stringify({ type: 'status', state: 'error', detail }));
        close();
      } else {
        openGateway();
      }
    }
  }

  queueMicrotask(() => {
    void start().catch(() => {
      if (abort.signal.aborted) return;
      socket.onerror?.call(socket as WebSocket, new Event('error'));
      close();
    });
  });
  return socket;
}
