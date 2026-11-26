import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { passwordResponse } from './auth.ts';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { selectCodecs } from './control.ts';
import { decodeMessage, decodeRendezvous, encodeAddrMangle, encodeMessage, encodeRendezvous } from './protos.ts';
import { connectViaId } from './rustdeskClient.ts';
import { parseRuntimeConfig, setRuntimeConfig } from './config.ts';

test('production connects directly to a dynamic peer port advertised by hbbs', { timeout: 10_000 }, async (t) => {
  const peerId = '123456789';
  const password = 'routing-test-password';
  const salt = 'routing-salt';
  const challenge = 'routing-challenge';
  const sockets = new Set<net.Socket>();
  const connection = new AbortController();
  let resolvePeer!: () => void;
  let rejectPeer!: (reason: unknown) => void;
  const peerHandled = new Promise<void>((resolve, reject) => {
    resolvePeer = resolve;
    rejectPeer = reject;
  });
  let resolveHbbs!: () => void;
  let rejectHbbs!: (reason: unknown) => void;
  const hbbsHandled = new Promise<void>((resolve, reject) => {
    resolveHbbs = resolve;
    rejectHbbs = reject;
  });
  let hbbsConnections = 0;

  const peer = net.createServer((socket) => {
    sockets.add(socket);
    const stream = new EncryptedFramedStream(socket);
    void (async () => {
      await stream.sendRaw(encodeMessage({ hash: { salt, challenge } }));
      const raw = await stream.next(2_000);
      assert.ok(raw);
      const login = decodeMessage(raw).login_request;
      assert.equal(login.username, peerId);
      assert.deepEqual(Buffer.from(login.password), passwordResponse(password, salt, challenge));
      await stream.sendRaw(encodeMessage({ login_response: { peer_info: { hostname: 'dynamic-port-peer' } } }));
    })().then(resolvePeer, rejectPeer);
  });
  const hbbs = net.createServer((socket) => {
    sockets.add(socket);
    hbbsConnections++;
    const stream = new EncryptedFramedStream(socket);
    void (async () => {
      const raw = await stream.next(2_000);
      assert.ok(raw);
      const request = decodeRendezvous(raw);
      assert.equal(request.punch_hole_request?.id, peerId);
      const peerPort = (peer.address() as net.AddressInfo).port;
      await stream.sendRaw(encodeRendezvous({ punch_hole_response: {
        socket_addr: encodeAddrMangle('127.0.0.1', peerPort),
      } }));
    })().then(resolveHbbs, (err) => {
      rejectHbbs(err);
      socket.destroy();
    });
  });
  t.after(async () => {
    connection.abort();
    for (const socket of sockets) socket.destroy();
    await Promise.all([peer, hbbs].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });
  peer.listen(0, '127.0.0.1');
  await once(peer, 'listening');
  hbbs.listen(0, '127.0.0.1');
  await once(hbbs, 'listening');
  const hbbsPort = (hbbs.address() as net.AddressInfo).port;
  const peerPort = (peer.address() as net.AddressInfo).port;
  assert.ok(peerPort < 21114 || peerPort > 21119);
  // Both protocol fixtures listen on loopback. Only hbbs receives a server-port exemption.
  t.after(setRuntimeConfig(parseRuntimeConfig({
    NODE_ENV: 'production', RUSTDESK_GATEWAY_TOKEN: 'routing-test-token',
    RUSTDESK_ALLOW_PRIVATE_TARGETS: 'true', RUSTDESK_ALLOWED_TARGET_PORTS: String(hbbsPort),
  })));

  const [connected] = await Promise.all([
    connectViaId({
      peerId, password, idServer: `127.0.0.1:${hbbsPort}`, relayServer: '', key: '', forceRelay: false,
    }, selectCodecs({ vp8: true, reported: true }), connection.signal),
    peerHandled,
    hbbsHandled,
  ]);
  assert.equal(connected.route, 'direct');
  assert.equal(connected.username, peerId);
  assert.equal(connected.peerInfo.hostname, 'dynamic-port-peer');
  assert.equal(hbbsConnections, 1);
  connected.stream.close();
});
