import type { WebSocket } from 'ws';
import { createClientMessageHandler } from './clientMessages.ts';
import { startHostPump } from './hostMessages.ts';
import type { GatewayConfig, SessionContext, SessionState } from './sessionState.ts';
import { GatewayVideoBuffer } from './videoBuffer.ts';
import { createVideoFrameHandler } from './videoFrames.ts';

export type { GatewayConfig } from './sessionState.ts';

export function serveSocket(ws: WebSocket, config: GatewayConfig): () => void {
  const state: SessionState = {
    phase: 'awaiting-connect',
    resolutionDisplay: 0,
    sizes: [],
    hostConn: null,
    sessionCodecs: undefined,
    preferredCodec: undefined,
    privacyImpl: '',
    audioRequested: false,
    audioAllowed: true,
    audioFormat: null,
    currentSize: { width: 0, height: 0 },
  };
  const connection = new AbortController();
  const connectDeadline = setTimeout(() => {
    cleanup(false);
    ws.terminate();
  }, 15_000);
  connectDeadline.unref();
  const videoBuffer = new GatewayVideoBuffer();

  let isAlive = true;

  const sendJson = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const sendBinary = (buf: Uint8Array) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(buf, { binary: true });
    }
  };

  // WebSocket protocol-level heartbeat keeps Cloud Run / Nginx / Cloudflare proxies from dropping idle sessions
  const heartbeat = setInterval(() => {
    if (state.phase === 'closed' || ws.readyState !== ws.OPEN) {
      clearInterval(heartbeat);
      return;
    }
    if (!isAlive) {
      cleanup(false);
      ws.terminate();
      return;
    }
    isAlive = false;
    try {
      ws.ping();
    } catch {
      cleanup(false);
      ws.terminate();
    }
  }, 25_000);
  heartbeat.unref?.();

  ws.on('pong', () => {
    isAlive = true;
  });

  const cleanup = (sendClosedStatus: boolean) => {
    if (state.phase === 'closed') return;
    state.phase = 'closed';
    state.cursorPublisher?.clear();
    state.cursorPublisher = undefined;
    clearTimeout(connectDeadline);
    connection.abort();
    clearInterval(heartbeat);
    video.dispose();
    if (state.hostConn) {
      state.hostConn.stream.close();
      state.hostConn = null;
    }
    if (sendClosedStatus) {
      sendJson({ type: 'status', state: 'closed', detail: 'disconnected' });
    }
    if (ws.readyState === ws.OPEN) ws.close(1000);
  };

  const context: SessionContext = { state, ws, videoBuffer, sendJson, sendBinary, cleanup };
  const video = createVideoFrameHandler(context);

  // Initial hello message per spec §4.3
  sendJson({ type: 'hello', service: 'rustdesk-web-gateway' });

  ws.on('message', createClientMessageHandler({
    ...context,
    config,
    connectionSignal: connection.signal,
    clearConnectDeadline: () => clearTimeout(connectDeadline),
    startHostPump: conn => startHostPump(conn, context, video.handleFrame),
  }));

  ws.on('close', () => {
    cleanup(false);
  });

  ws.on('error', () => {
    cleanup(false);
  });
  return () => cleanup(false);
}
