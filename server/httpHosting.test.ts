import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { createGatewayShutdown, installApiNotFound, serveProductionFiles } from './httpHosting.ts';
import { encodeMessage } from '../shared/protos.ts';
import { encodeEndpoint } from '../shared/webrtc.ts';
import { serveSocket } from './session.ts';
import { serveWebRtcSignal } from './webrtcSignal.ts';

const timeout = () => ({ signal: AbortSignal.timeout(3_000) });
const portOf = (server: http.Server | net.Server) => (server.address() as net.AddressInfo).port;
const closeServer = (server: http.Server | net.Server) => new Promise<void>(resolve => server.close(() => resolve()));

function request(server: http.Server, pathname: string, method = 'GET') {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: portOf(server), path: pathname, method, agent: false }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('API misses stay JSON before either SPA fallback and only fingerprinted assets are immutable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rd-http-'));
  await fs.mkdir(path.join(dir, 'assets'));
  await Promise.all([
    fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>client</title>'),
    fs.writeFile(path.join(dir, 'assets', 'index-ABcd1234.js'), 'export const version = 1;'),
    fs.writeFile(path.join(dir, 'assets', 'logo.svg'), '<svg/>'),
  ]);
  try {
    for (const production of [false, true]) {
      const app = express();
      app.get('/api/health', (_req, res) => res.json({ ok: true }));
      installApiNotFound(app);
      if (production) serveProductionFiles(app, dir);
      else app.use((_req, res) => res.send('development SPA'));
      const server = http.createServer(app).listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        assert.equal((await request(server, '/api/health')).status, 200);
        for (const method of ['GET', 'POST', 'DELETE']) {
          const missed = await request(server, '/api/missing', method);
          assert.equal(missed.status, 404);
          assert.equal(missed.headers['cache-control'], 'no-store');
          assert.match(missed.headers['content-type']!, /^application\/json/);
          assert.deepEqual(JSON.parse(missed.body), { error: 'API endpoint not found' });
        }
        if (!production) continue;
        for (const pathname of ['/', '/index.html', '/settings/network']) {
          const page = await request(server, pathname);
          assert.equal(page.status, 200);
          assert.equal(page.headers['cache-control'], 'no-cache');
          assert.match(page.body, /<!doctype html>/);
        }
        const asset = await request(server, '/assets/index-ABcd1234.js');
        assert.equal(asset.status, 200);
        assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
        assert.equal((await request(server, '/assets/logo.svg')).headers['cache-control'], 'no-cache');
        assert.equal((await request(server, '/assets/missing-ABcd1234.js')).status, 404);
      } finally { await closeServer(server); }
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('shutdown closes live host TCP immediately and bounds unresponsive WebSocket and HTTP clients', async () => {
  const hostSockets = new Set<net.Socket>();
  let resolveHostClosed: () => void;
  const hostClosed = new Promise<void>(resolve => { resolveHostClosed = resolve; });
  const host = net.createServer(socket => {
    hostSockets.add(socket);
    socket.once('close', () => { hostSockets.delete(socket); resolveHostClosed(); });
    const stream = new EncryptedFramedStream(socket);
    void (async () => {
      await stream.sendRaw(encodeMessage({ hash: { salt: 'salt', challenge: 'challenge' } }));
      await stream.next(2_000);
      await stream.sendRaw(encodeMessage({ login_response: { peer_info: {
        hostname: 'shutdown-test', platform: 'Linux', version: '1.5.3', displays: [],
      } } }));
    })().catch(() => stream.close());
  }).listen(0, '127.0.0.1');
  await once(host, 'listening');
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const errors: unknown[] = [];
  let frontendClosed = false;
  const shutdown = createGatewayShutdown(server, wss, {
    timeoutMs: 150, onError: error => errors.push(error),
    closeFrontend: async () => { frontendClosed = true; },
  });
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => shutdown.track(ws, serveSocket(ws, { token: 'test-token' })));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new WebSocket(`ws://127.0.0.1:${portOf(server)}`);
  const live = new Promise<void>(resolve => client.on('message', raw => {
    if (JSON.parse(raw.toString()).state === 'live') resolve();
  }));
  const slowHttp = net.connect(portOf(server), '127.0.0.1');
  try {
    await Promise.all([once(client, 'open', timeout()), once(slowHttp, 'connect', timeout())]);
    slowHttp.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
    client.send(JSON.stringify({ type: 'connect', mode: 'direct', token: 'test-token',
      host: '127.0.0.1', port: portOf(host), password: 'password', codecs: { vp8: true } }));
    await live;
    client.pause();
    const finished = shutdown.close();
    assert.equal(shutdown.close(), finished);
    assert.equal(shutdown.stopping, true);
    await hostClosed;
    assert.equal(client.readyState, WebSocket.OPEN, 'host cleanup must not wait for browser close acknowledgement');
    await finished;
    assert.equal(frontendClosed, true);
    assert.deepEqual(errors, []);
    client.resume();
    await once(client, 'close', timeout());
  } finally {
    client.terminate();
    slowHttp.destroy();
    for (const ws of wss.clients) ws.terminate();
    for (const socket of hostSockets) socket.destroy();
    await shutdown.close();
    await closeServer(host);
  }
});

test('shutdown closes signaling sessions cleanly, cancels a pending dial and reports frontend errors', async () => {
  let resolveAccepted: () => void;
  const accepted = new Promise<void>(resolve => { resolveAccepted = resolve; });
  let resolveClosed: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const upstreamSockets = new Set<net.Socket>();
  const upstream = net.createServer(socket => {
    upstreamSockets.add(socket);
    socket.on('data', () => {});
    socket.once('close', () => { upstreamSockets.delete(socket); resolveClosed(); });
    resolveAccepted();
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const errors: unknown[] = [];
  const expected = new Error('frontend close failed');
  const shutdown = createGatewayShutdown(server, wss, {
    onError: error => errors.push(error), closeFrontend: async () => { throw expected; },
  });
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => shutdown.track(ws, serveWebRtcSignal(ws, 'test-token')));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new WebSocket(`ws://127.0.0.1:${portOf(server)}`);
  try {
    await once(client, 'open', timeout());
    const offer = encodeEndpoint({ type: 'offer',
      sdp: `v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ${Array(32).fill('AA').join(':')}\r\n` });
    client.send(JSON.stringify({ type: 'offer', token: 'test-token', peerId: '123456789',
      idServer: `127.0.0.1:${portOf(upstream)}`, key: '', offer }));
    await accepted;
    const clientClosed = once(client, 'close', timeout());
    await shutdown.close();
    const [code] = await clientClosed;
    assert.equal(code, 1001);
    await closed;
    assert.deepEqual(errors, [expected]);
  } finally {
    client.terminate();
    for (const socket of upstreamSockets) socket.destroy();
    await shutdown.close();
    await closeServer(upstream);
  }
});

test('server entry point enforces proxy-aware and Render origins and exits on both termination signals', { timeout: 15_000 }, async () => {
  for (const { signal, trusted, render } of [
    { signal: 'SIGTERM', trusted: false, render: false },
    { signal: 'SIGINT', trusted: true, render: false },
    { signal: 'SIGTERM', trusted: false, render: true },
  ] as const) {
    const reservation = net.createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = portOf(reservation);
    await closeServer(reservation);
    const publicOrigin = 'https://rustdesk-web-client.onrender.com';
    const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), RENDER: String(render),
        RENDER_EXTERNAL_URL: render ? publicOrigin : '',
        RUSTDESK_GATEWAY_TOKEN: 'test-shutdown-token', RUSTDESK_ENABLE_WEBRTC: 'true',
        RUSTDESK_ALLOWED_ORIGINS: '', RUSTDESK_REQUIRE_ORIGIN: 'true',
        RUSTDESK_TRUSTED_PROXIES: trusted ? '127.0.0.1' : '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const exited = once(child, 'exit', timeout());
    const clients: WebSocket[] = [];
    const connect = (origin: string, headers: Record<string, string> = {}, route = '/ws') => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { origin, headers: { Host: `LOCALHOST:${port}`, ...headers } });
      clients.push(ws);
      return ws;
    };
    try {
      const listening = new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error(`Gateway did not start: ${output}`)), 3_000);
        child.stdout.on('data', () => {
          if (output.includes('Gateway listening')) { clearTimeout(deadline); resolve(); }
        });
        child.once('exit', () => { clearTimeout(deadline); reject(new Error(`Gateway exited before startup: ${output}`)); });
      });
      await listening;
      for (const [origin, headers] of [
        [`http://localhost:${port + 1}`, {}],
        [`https://localhost:${port}`, {}],
        [`https://localhost:${port}`, { 'X-Forwarded-Proto': 'https,http' }],
        ...(!trusted ? [[`https://localhost:${port}`, { 'X-Forwarded-Proto': 'https' }]] : []),
        ...(render ? [
          ['http://rustdesk-web-client.onrender.com', {}],
          ['https://attacker.onrender.com', { Host: 'attacker.onrender.com', 'X-Forwarded-Proto': 'https' }],
        ] : []),
      ] as Array<[string, Record<string, string>]>) {
        const ws = connect(origin, headers);
        await assert.rejects(once(ws, 'open', timeout()), /socket hang up/);
      }
      const desktop = connect(render ? publicOrigin : `http://localhost:${port}`);
      const signaling = connect(render ? publicOrigin : `${trusted ? 'https' : 'http'}://localhost:${port}`,
        trusted ? { 'X-Forwarded-Proto': 'https' } : {}, '/ws/webrtc');
      await Promise.all([once(desktop, 'open', timeout()), once(signaling, 'open', timeout())]);
      const closed = [once(desktop, 'close', timeout()), once(signaling, 'close', timeout())];
      child.kill(signal);
      for (const [code] of await Promise.all(closed)) assert.equal(code, 1001);
      const [code, exitSignal] = await exited;
      assert.equal(code, 0, output);
      assert.equal(exitSignal, null, output);
    } finally {
      for (const client of clients) client.terminate();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  }
});
