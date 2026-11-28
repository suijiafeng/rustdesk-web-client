import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { GatewayAdmissionLimiter } from './server/admission.ts';
import { getRuntimeConfig } from './server/config.ts';
import { createGatewayShutdown, installApiNotFound, serveProductionFiles } from './server/httpHosting.ts';
import { serveWebRtcSignal } from './server/webrtcSignal.ts';
import { originAllowed, redactLog } from './server/security.ts';
import { serveSocket } from './server/session.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function rejectUpgrade(socket: Duplex, status: string): void {
  const deadline = setTimeout(() => socket.destroy(), 1_000);
  deadline.unref();
  socket.once('error', () => socket.destroy());
  socket.once('close', () => clearTimeout(deadline));
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
}

async function startServer() {
  const config = getRuntimeConfig();
  const { host, port, gatewayToken, webRtcEnabled, requireOrigin, clientAddress, requestProtocol } = config;
  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const admissionLimiter = new GatewayAdmissionLimiter();
  let closeFrontend: (() => Promise<void>) | undefined;
  const shutdown = createGatewayShutdown(httpServer, wss, {
    closeFrontend: () => closeFrontend?.() ?? Promise.resolve(),
    onError: error => console.error(redactLog(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`)),
  });

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'self'",
    );
    if (shutdown.stopping) {
      res.setHeader('Connection', 'close');
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'Gateway shutting down' });
      return;
    }
    next();
  });

  const faviconSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b6bcb"/><rect x="6" y="8" width="20" height="13" rx="2.5" fill="none" stroke="#ffffff" stroke-width="2.2"/><path d="M12 24h8M16 21v3" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/></svg>';

  app.get(['/favicon.ico', '/favicon.svg'], (_req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(faviconSvg);
  });

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      service: 'rustdesk-web-gateway',
      authRequired: gatewayToken.length > 0,
      webRtcEnabled,
    });
  });

  wss.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(redactLog(`WebSocketServer error: ${message}`));
  });

  httpServer.on('clientError', (_err, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } else {
      socket.destroy();
    }
  });

  httpServer.on('upgrade', (request, socket, head) => {
    if (shutdown.stopping) {
      rejectUpgrade(socket, '503 Service Unavailable');
      return;
    }
    let pathname = '';
    try {
      const reqUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      pathname = reqUrl.pathname;
    } catch {
      socket.destroy();
      return;
    }

    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
    if (!originAllowed(origin, request.headers.host ?? '', config.allowedOrigins, requireOrigin, {
      protocol: requestProtocol(request.socket.remoteAddress, request.headers),
      allowLoopback: !config.production,
    })) {
      socket.destroy();
      return;
    }

    if (pathname !== '/ws' && pathname !== '/ws/webrtc') {
      socket.destroy();
      return;
    }
    if (pathname === '/ws/webrtc' && !webRtcEnabled) {
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }

    const admission = admissionLimiter.acquire(clientAddress(request.socket.remoteAddress, request.headers));
    if (!admission) {
      rejectUpgrade(socket, '429 Too Many Requests');
      return;
    }
    socket.once('close', admission.release);
    wss.handleUpgrade(request, socket, head, (ws) => {
      const cleanup = pathname === '/ws/webrtc' ? serveWebRtcSignal(ws, gatewayToken, admission)
        : serveSocket(ws, { token: gatewayToken, admission });
      shutdown.track(ws, cleanup);
    });
  });

  installApiNotFound(app);
  if (!config.production) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    closeFrontend = () => vite.close();
    app.use(vite.middlewares);
  } else {
    const distDir = path.basename(__dirname) === 'dist'
      ? path.resolve(__dirname, 'client')
      : path.resolve(__dirname, 'dist/client');
    serveProductionFiles(app, distDir);
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(redactLog(`HTTP error: ${message}`));
    if (res.headersSent) return;
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'Internal server error' });
  });

  const stop = () => {
    void shutdown.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  httpServer.listen(port, host, () => {
    console.log(redactLog(`RustDesk Web Gateway listening on http://${host}:${port}`));
  });
}

startServer().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(redactLog(`Failed to start server: ${message}`));
  process.exit(1);
});
