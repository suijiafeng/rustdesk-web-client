import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { GatewayAdmissionLimiter } from './admission.ts';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { encodeMessage } from '../shared/protos.ts';
import { serveSocket } from './session.ts';

test('a host disconnect sends an error, closes the WebSocket and releases its admission', async () => {
  const hostSockets = new Set<net.Socket>();
  const host = net.createServer(socket => {
    hostSockets.add(socket);
    socket.once('close', () => hostSockets.delete(socket));
    const stream = new EncryptedFramedStream(socket);
    void (async () => {
      await stream.sendRaw(encodeMessage({ hash: { salt: 'salt', challenge: 'challenge' } }));
      await stream.next(2_000);
      await stream.sendRaw(encodeMessage({ login_response: { peer_info: {
        hostname: 'test-host', platform: 'Linux', version: '1.5.3', displays: [],
      } } }));
    })().catch(() => stream.close());
  });
  host.listen(0, '127.0.0.1');
  await once(host, 'listening');

  const limiter = new GatewayAdmissionLimiter();
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const serverClosed = new Promise<void>((resolve, reject) => {
    server.on('connection', ws => {
      const admission = limiter.acquire('test-client');
      assert.ok(admission);
      ws.once('close', admission.release);
      once(ws, 'close', { signal: AbortSignal.timeout(3_000) }).then(() => resolve(), reject);
      serveSocket(ws, { token: 'gateway-token', admission });
    });
  });
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  const messages: Array<Record<string, unknown>> = [];
  const live = new Promise<void>(resolve => {
    client.on('message', raw => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      if (message.state === 'live') resolve();
    });
  });
  try {
    await once(client, 'open', { signal: AbortSignal.timeout(3_000) });
    client.send(JSON.stringify({ type: 'connect', mode: 'direct', token: 'gateway-token',
      host: '127.0.0.1', port: (host.address() as net.AddressInfo).port,
      password: 'password', codecs: { vp8: true } }));
    await Promise.race([live, serverClosed.then(() => { throw new Error('Session closed before login'); })]);
    const clientClosed = once(client, 'close', { signal: AbortSignal.timeout(3_000) });
    for (const socket of hostSockets) socket.destroy();
    await Promise.all([clientClosed, serverClosed]);
    assert.ok(messages.some(message => message.state === 'error' && message.detail === 'host closed the connection'));
    assert.equal(client.readyState, WebSocket.CLOSED);
    for (let index = 0; index < 4; index++) assert.ok(limiter.acquire('test-client'));
    assert.equal(limiter.acquire('test-client'), null);
  } finally {
    client.terminate();
    for (const ws of server.clients) ws.terminate();
    for (const socket of hostSockets) socket.destroy();
    await Promise.all([
      new Promise<void>(resolve => server.close(() => resolve())),
      new Promise<void>(resolve => host.close(() => resolve())),
    ]);
  }
});
