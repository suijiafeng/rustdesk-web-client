// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { FRAME_HEADER_LENGTH, hasRoomForHeader } from '@rustdesk-web/protocol';
import { GATEWAY_SERVICE, HEALTH_PATH, type HealthResponse } from '@rustdesk-web/shared';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { originAllowed, productionTokenProblem } from './security.ts';
import { serveSocket } from './session/index.ts';

export function normalizeGatewayToken(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!trimmed || /^(MY_GATEWAY_TOKEN|YOUR_GATEWAY_TOKEN|CHANGE_ME|PLACEHOLDER)$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

export function createApp(token = '') {
  if (!hasRoomForHeader(FRAME_HEADER_LENGTH)) {
    throw new Error('protocol frame header length is invalid');
  }
  const app = express();
  app.disable('x-powered-by');
  app.get(HEALTH_PATH, (_req, res) => {
    const body: HealthResponse & { authRequired: boolean } = {
      ok: true,
      service: GATEWAY_SERVICE,
      authRequired: token.length > 0,
    };
    res.json(body);
  });
  return app;
}

export function attachWebSocket(server: http.Server, token: string) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  wss.on('error', (error) => {
    console.error('WebSocketServer error:', error);
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });
  server.on('upgrade', (request, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
    const allowlist = process.env.RUSTDESK_ALLOWED_ORIGINS ?? '';
    if (!originAllowed(origin, request.headers.host ?? '', allowlist)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      serveSocket(ws, { token });
    });
  });
  return wss;
}

export function listen(port: number, host = '127.0.0.1') {
  const token = normalizeGatewayToken(process.env.RUSTDESK_GATEWAY_TOKEN);
  const problem = productionTokenProblem(process.env.NODE_ENV, token);
  if (problem) throw new Error(problem);
  const server = createApp(token).listen(port, host);
  attachWebSocket(server, token);
  return server;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const port = Number(process.env.PORT) || 3001;
  const server = listen(port);
  server.on('listening', () => {
    console.log(`gateway listening on http://127.0.0.1:${port}`);
  });
}
