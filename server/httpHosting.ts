import express, { type Express } from 'express';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import type { WebSocket, WebSocketServer } from 'ws';

// Keep API misses out of both the production SPA and Vite's development fallback.
export function installApiNotFound(app: Express): void {
  app.use('/api', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'API endpoint not found' });
  });
}

export function serveProductionFiles(app: Express, distDir: string): void {
  app.use(express.static(distDir, {
    setHeaders: (res, filename) => {
      const relative = path.relative(distDir, filename);
      const versionedAsset = relative.startsWith(`assets${path.sep}`)
        && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(path.basename(filename));
      res.setHeader('Cache-Control', versionedAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  // A stale asset URL must not receive index.html with a successful status.
  app.use('/assets', (_req, res) => res.sendStatus(404));
  app.get('*', (_req, res, next) => {
    res.sendFile(path.join(distDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }, error => {
      if (error) next(error);
    });
  });
}

interface ShutdownOptions {
  timeoutMs?: number;
  closeFrontend?: () => Promise<void>;
  onError: (error: unknown) => void;
}

export function createGatewayShutdown(httpServer: Server, wss: WebSocketServer, options: ShutdownOptions) {
  const sockets = new Set<Socket>();
  const sessions = new Map<WebSocket, () => void>();
  let stopping = false;
  let shutdown: Promise<void> | undefined;
  httpServer.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (stopping) socket.destroy();
  });

  const closeSession = (ws: WebSocket, cleanup: () => void) => {
    // Start the close handshake with a service-restart reason before the session
    // cleanup would otherwise use a normal-disconnect code.
    try {
      if (ws.readyState === ws.OPEN) ws.close(1001, 'Gateway shutting down');
    } catch (error) {
      options.onError(error);
      ws.terminate();
    } finally {
      try { cleanup(); } catch (error) { options.onError(error); }
    }
  };

  return {
    get stopping() { return stopping; },
    track(ws: WebSocket, cleanup: () => void): void {
      if (stopping) {
        closeSession(ws, cleanup);
        return;
      }
      sessions.set(ws, cleanup);
      ws.once('close', () => sessions.delete(ws));
    },
    close(): Promise<void> {
      if (shutdown) return shutdown;
      stopping = true;
      shutdown = new Promise<void>(resolve => {
        const deadline = setTimeout(() => {
          for (const ws of wss.clients) ws.terminate();
          for (const socket of sockets) socket.destroy();
          resolve();
        }, options.timeoutMs ?? 3_000);
        const httpClosed = new Promise<void>(done => httpServer.close(error => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') options.onError(error);
          done();
        }));
        const wsClosed = new Promise<void>(done => wss.close(() => done()));
        for (const [ws, cleanup] of sessions) closeSession(ws, cleanup);
        sessions.clear();
        // Also cover an upgraded connection not yet registered as a session.
        for (const ws of wss.clients) {
          if (ws.readyState === ws.OPEN) closeSession(ws, () => {});
        }
        const frontendClosed = Promise.resolve().then(() => options.closeFrontend?.()).catch(options.onError);
        void Promise.all([httpClosed, wsClosed, frontendClosed]).then(() => {
          clearTimeout(deadline);
          resolve();
        });
      });
      return shutdown;
    },
  };
}
