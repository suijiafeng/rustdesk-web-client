// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { FRAME_HEADER_LENGTH, hasRoomForHeader } from '@rustdesk-web/protocol';
import { GATEWAY_SERVICE, HEALTH_PATH, type HealthResponse } from '@rustdesk-web/shared';
import express from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function createApp() {
  if (!hasRoomForHeader(FRAME_HEADER_LENGTH)) {
    throw new Error('protocol frame header length is invalid');
  }
  const app = express();
  app.disable('x-powered-by');
  app.get(HEALTH_PATH, (_req, res) => {
    const body: HealthResponse = { ok: true, service: GATEWAY_SERVICE };
    res.json(body);
  });
  return app;
}

export function listen(port: number, host = '127.0.0.1') {
  return createApp().listen(port, host);
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
