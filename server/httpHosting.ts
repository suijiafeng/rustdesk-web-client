import express, { type Express } from 'express';
import { readdirSync } from 'node:fs';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import type { WebSocket, WebSocketServer } from 'ws';

function indexPrecompressedFiles(distDir: string): Set<string> {
  const index = new Set<string>();
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.br') || entry.name.endsWith('.gz'))) {
        index.add(fullPath);
      }
    }
  };
  walk(path.resolve(distDir));
  return index;
}

// Keep API misses out of both the production SPA and Vite's development fallback.
export function installApiNotFound(app: Express): void {
  app.use('/api', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'API endpoint not found' });
  });
}

export function serveProductionFiles(app: Express, distDir: string): void {
  const resolvedDistDir = path.resolve(distDir);
  const distPrefix = resolvedDistDir + path.sep;
  const precompressed = indexPrecompressedFiles(resolvedDistDir);
  const cacheControl = (filename: string) => {
    const relative = path.relative(resolvedDistDir, filename);
    const versionedAsset = relative.startsWith(`assets${path.sep}`)
      && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(path.basename(filename));
    return versionedAsset ? 'public, max-age=31536000, immutable' : 'no-cache';
  };
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let pathname: string;
    try { pathname = decodeURIComponent(req.path); } catch { return next(); }
    if (pathname === '/') pathname = '/index.html';
    if (!/\.(?:js|css|html|svg|json|webmanifest)$/.test(pathname)) return next();
    const filename = path.resolve(resolvedDistDir, `.${pathname}`);
    if (!filename.startsWith(distPrefix)) return next();
    res.vary('Accept-Encoding');
    const weights = new Map<string, number>();
    for (const item of (req.headers['accept-encoding'] ?? '').toLowerCase().split(',')) {
      const [name, ...parameters] = item.trim().split(';');
      const quality = parameters.find(value => value.trim().startsWith('q='))?.trim().slice(2);
      const value = quality === undefined ? 1 : Number(quality);
      weights.set(name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
    }
    const variants = (['br', 'gzip'] as const).map(encoding => ({
      encoding, quality: weights.get(encoding) ?? weights.get('*') ?? 0,
    })).filter(variant => variant.quality > 0 && variant.quality >= (weights.get('identity') ?? 0))
      .sort((a, b) => b.quality - a.quality);
    for (const { encoding } of variants) {
      const compressed = `${filename}.${encoding === 'br' ? 'br' : 'gz'}`;
      if (!precompressed.has(compressed)) continue;
      res.type(path.extname(filename));
      res.setHeader('Content-Encoding', encoding);
      res.sendFile(compressed, { headers: { 'Cache-Control': cacheControl(filename) } }, error => {
        if (error) next(error);
      });
      return;
    }
    next();
  });
  app.use(express.static(distDir, {
    setHeaders: (res, filename) => {
      res.setHeader('Cache-Control', cacheControl(filename));
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
