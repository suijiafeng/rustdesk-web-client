import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { serveWebRtcSignal } from './server/webrtcSignal.ts';
import { originAllowed, productionTokenProblem, redactLog } from './server/security.ts';
import { serveSocket } from './server/session.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeGatewayToken(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!trimmed || /^(MY_GATEWAY_TOKEN|YOUR_GATEWAY_TOKEN|CHANGE_ME|PLACEHOLDER)$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const gatewayToken = normalizeGatewayToken(process.env.RUSTDESK_GATEWAY_TOKEN);
  const tokenProblem = productionTokenProblem(process.env.NODE_ENV, gatewayToken);
  if (tokenProblem) {
    throw new Error(tokenProblem);
  }

  const webRtcEnabled = process.env.RUSTDESK_ENABLE_WEBRTC?.trim().toLowerCase() === 'true';

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

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

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
    let pathname = '';
    try {
      const reqUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      pathname = reqUrl.pathname;
    } catch {
      socket.destroy();
      return;
    }

    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
    const allowlist = process.env.RUSTDESK_ALLOWED_ORIGINS ?? '';
    if (!originAllowed(origin, request.headers.host ?? '', allowlist)) {
      socket.destroy();
      return;
    }

    if (pathname === '/ws/webrtc') {
      if (!webRtcEnabled) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        serveWebRtcSignal(ws, gatewayToken);
      });
    } else if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        serveSocket(ws, { token: gatewayToken });
      });
    } else {
      socket.destroy();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const host = process.env.HOST || '127.0.0.1';
  httpServer.listen(port, host, () => {
    console.log(redactLog(`RustDesk Web Gateway listening on http://${host}:${port}`));
  });
}

startServer().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(redactLog(`Failed to start server: ${message}`));
  process.exit(1);
});
