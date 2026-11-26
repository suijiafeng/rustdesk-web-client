import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test, { type TestContext } from 'node:test';
import { passwordResponse } from './auth.ts';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { selectCodecs } from './control.ts';
import { decodeMessage, decodeRendezvous, encodeAddrMangle, encodeMessage, encodeRendezvous } from './protos.ts';
import { connectDirect, connectViaId } from './rustdeskClient.ts';
import { parseRuntimeConfig, setRuntimeConfig } from './config.ts';

type Route = 'direct' | 'relay';
type Behavior = 'ready' | 'stall' | 'close';

function completion() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function routingFixture(t: TestContext, options: {
  direct?: Behavior; relay?: Behavior; loginError?: string; defaultForceRelay?: boolean; directIp?: boolean;
} = {}) {
  t.after(setRuntimeConfig(parseRuntimeConfig({
    NODE_ENV: 'test', RUSTDESK_ALLOW_PRIVATE_TARGETS: 'true',
    RUSTDESK_DEFAULT_FORCE_RELAY: String(options.defaultForceRelay ?? false),
  })));
  const sockets = new Set<net.Socket>();
  const tasks: Promise<void>[] = [];
  const errors: unknown[] = [];
  const streams: Partial<Record<Route, EncryptedFramedStream>> = {};
  const routeSockets: Partial<Record<Route, net.Socket>> = {};
  const loginCounts = { direct: 0, relay: 0 };
  const loginOptions: Partial<Record<Route, Record<string, number>>> = {};
  const connected = { direct: completion(), relay: completion() };
  const closed = { direct: completion(), relay: completion() };
  const controller = new AbortController();
  const peerId = '123456789';
  const password = 'race-test-password';
  const hash = { salt: 'race-salt', challenge: 'race-challenge' };
  let relayRequests = 0;
  let requestedForceRelay = false;
  let tearingDown = false;

  function handle(socket: net.Socket, work: () => Promise<void>) {
    sockets.add(socket);
    socket.on('error', () => {});
    tasks.push(work().catch((err) => { if (!tearingDown) errors.push(err); }));
  }

  async function host(stream: EncryptedFramedStream, socket: net.Socket, route: Route) {
    streams[route] = stream;
    routeSockets[route] = socket;
    socket.once('close', () => closed[route].resolve());
    connected[route].resolve();
    const behavior = options[route] ?? 'ready';
    if (behavior === 'close') {
      stream.close();
      return;
    }
    if (behavior === 'ready') await stream.sendRaw(encodeMessage({ hash }));
    const raw = await stream.next(4_000).catch((err: NodeJS.ErrnoException) => {
      // Cancelling a route with unread Hash bytes may reset TCP instead of sending FIN.
      if (err.code === 'ECONNRESET') return null;
      throw err;
    });
    if (!raw) return;
    const login = decodeMessage(raw).login_request;
    assert.ok(login, 'only the winner sends a login request');
    loginCounts[route]++;
    loginOptions[route] = login.option;
    assert.equal(login.username, options.directIp ? `127.0.0.1:${(direct.address() as net.AddressInfo).port}` : peerId);
    assert.deepEqual(Buffer.from(login.password), passwordResponse(password, hash.salt, hash.challenge));
    await stream.sendRaw(encodeMessage({ login_response: options.loginError
      ? { error: options.loginError }
      : { peer_info: { hostname: `${route}-peer` } },
    }));
  }

  const direct = net.createServer((socket) => handle(socket, async () => {
    await host(new EncryptedFramedStream(socket), socket, 'direct');
  }));
  const relay = net.createServer((socket) => handle(socket, async () => {
    const stream = new EncryptedFramedStream(socket);
    const raw = await stream.next(4_000);
    if (!raw) return;
    assert.equal(decodeRendezvous(raw).request_relay?.id, peerId);
    await host(stream, socket, 'relay');
  }));
  const hbbs = net.createServer((socket) => handle(socket, async () => {
    const stream = new EncryptedFramedStream(socket);
    const raw = await stream.next(4_000);
    if (!raw) return;
    const message = decodeRendezvous(raw);
    const relayServer = `127.0.0.1:${(relay.address() as net.AddressInfo).port}`;
    if (message.punch_hole_request) {
      requestedForceRelay = message.punch_hole_request.force_relay === true;
      await stream.sendRaw(encodeRendezvous({ punch_hole_response: {
        socket_addr: encodeAddrMangle('127.0.0.1', (direct.address() as net.AddressInfo).port),
        relay_server: relayServer,
      } }));
    } else {
      assert.ok(message.request_relay);
      relayRequests++;
      await stream.sendRaw(encodeRendezvous({ relay_response: {
        uuid: message.request_relay.uuid, relay_server: relayServer,
      } }));
    }
  }));
  const servers = [direct, relay, hbbs];
  t.after(async () => {
    tearingDown = true;
    controller.abort();
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(tasks);
    assert.deepEqual(errors, [], 'protocol fixture handlers completed without errors');
  });
  for (const server of servers) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  return {
    controller, connected, closed, loginCounts, loginOptions,
    get relayRequests() { return relayRequests; },
    get requestedForceRelay() { return requestedForceRelay; },
    get directSocket() { return routeSockets.direct; },
    connect(forceRelay = false, quality: { quality?: string; customQuality?: number; fps?: number; lockAfterSessionEnd?: boolean } = {}) {
      if (options.directIp) return connectDirect({
        host: '127.0.0.1', port: (direct.address() as net.AddressInfo).port, password, ...quality,
      }, selectCodecs({ vp8: true, reported: true }), controller.signal);
      return connectViaId({
        peerId, password, idServer: `127.0.0.1:${(hbbs.address() as net.AddressInfo).port}`,
        relayServer: '', key: '', forceRelay, ...quality,
      }, selectCodecs({ vp8: true, reported: true }), controller.signal);
    },
    sendHash(route: Route) { return streams[route]!.sendRaw(encodeMessage({ hash })); },
  };
}

test('custom quality and session-end locking reach login over ID direct, relay and direct-IP routes', { timeout: 5_000 }, async t => {
  for (const mode of ['id-direct', 'id-relay', 'direct-ip']) await t.test(mode, async t => {
    const fixture = await routingFixture(t, { directIp: mode === 'direct-ip' });
    const connected = await fixture.connect(mode === 'id-relay', { quality: 'custom', customQuality: 120, fps: 25, lockAfterSessionEnd: true });
    const options = fixture.loginOptions[connected.route]!;
    assert.equal(options.image_quality ?? 0, 0);
    assert.equal(options.custom_image_quality, 60 * 256);
    assert.equal(options.custom_fps, 25);
    assert.equal(options.lock_after_session_end, 2);
    connected.stream.close();
  });
});

test('a stalled direct handshake does not delay relay by the direct TCP timeout', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { direct: 'stall' });
  const started = performance.now();
  const connected = await fixture.connect();
  assert.equal(connected.route, 'relay');
  assert.ok(performance.now() - started < 2_000, 'relay wins without waiting 3.5 seconds');
  await fixture.closed.direct.promise;
  assert.deepEqual(fixture.loginCounts, { direct: 0, relay: 1 });
  fixture.controller.abort();
  await fixture.closed.relay.promise;
});

test('a direct winner closes an already connected relay without submitting a second login', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { direct: 'stall', relay: 'stall' });
  const connecting = fixture.connect();
  await fixture.connected.relay.promise;
  await fixture.sendHash('direct');
  const connected = await connecting;
  assert.equal(connected.route, 'direct');
  await fixture.closed.relay.promise;
  assert.deepEqual(fixture.loginCounts, { direct: 1, relay: 0 });
  fixture.controller.abort();
  await fixture.closed.direct.promise;
});

test('direct handshake failure starts relay immediately', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { direct: 'close' });
  const started = performance.now();
  const connected = await fixture.connect();
  assert.equal(connected.route, 'relay');
  assert.ok(performance.now() - started < 300, 'no remaining head-start delay after a direct failure');
  assert.deepEqual(fixture.loginCounts, { direct: 0, relay: 1 });
});

test('two ready handshakes still produce one login and close the losing socket', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { direct: 'stall', relay: 'stall' });
  const connecting = fixture.connect();
  await fixture.connected.relay.promise;
  await Promise.all([fixture.sendHash('direct'), fixture.sendHash('relay')]);
  const connected = await connecting;
  const loser = connected.route === 'direct' ? 'relay' : 'direct';
  await fixture.closed[loser].promise;
  assert.equal(fixture.loginCounts[connected.route], 1);
  assert.equal(fixture.loginCounts[loser], 0);
  fixture.controller.abort();
  await fixture.closed[connected.route].promise;
});

test('both failed handshakes retain direct and relay causes', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { direct: 'close', relay: 'close' });
  await assert.rejects(fixture.connect(), (err: unknown) => {
    assert.ok(err instanceof AggregateError);
    assert.equal(err.errors.length, 2);
    assert.match(err.message, /Direct connection failed: .*relay connection failed:/);
    return true;
  });
  await Promise.all([fixture.closed.direct.promise, fixture.closed.relay.promise]);
  assert.deepEqual(fixture.loginCounts, { direct: 0, relay: 0 });
});

test('cancellation closes both pending handshakes', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { direct: 'stall', relay: 'stall' });
  const connecting = fixture.connect();
  const rejected = assert.rejects(connecting, { name: 'AbortError' });
  await fixture.connected.relay.promise;
  fixture.controller.abort();
  await rejected;
  await Promise.all([fixture.closed.direct.promise, fixture.closed.relay.promise]);
  assert.deepEqual(fixture.loginCounts, { direct: 0, relay: 0 });
});

test('cancelling during the direct head start prevents a relay request', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { direct: 'stall' });
  const connecting = fixture.connect();
  const rejected = assert.rejects(connecting, { name: 'AbortError' });
  await fixture.connected.direct.promise;
  fixture.controller.abort();
  await rejected;
  await fixture.closed.direct.promise;
  assert.equal(fixture.relayRequests, 0);
});

test('cancellation as the host sends Hash closes both routes', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { direct: 'stall', relay: 'stall' });
  const connecting = fixture.connect();
  const rejected = assert.rejects(connecting, { name: 'AbortError' });
  await fixture.connected.relay.promise;
  await fixture.sendHash('direct');
  fixture.controller.abort();
  await rejected;
  await Promise.all([fixture.closed.direct.promise, fixture.closed.relay.promise]);
  assert.deepEqual(fixture.loginCounts, { direct: 0, relay: 0 });
});

test('a rejected login is not retried on the other route', { timeout: 5_000 }, async (t) => {
  const fixture = await routingFixture(t, { loginError: 'Wrong Password' });
  await assert.rejects(fixture.connect(), /Wrong Password/);
  await fixture.closed.direct.promise;
  assert.deepEqual(fixture.loginCounts, { direct: 1, relay: 0 });
  assert.equal(fixture.relayRequests, 0);
});

for (const defaultForceRelay of [false, true]) {
  test(`${defaultForceRelay ? 'gateway default' : 'request'} force relay skips direct`, { timeout: 5_000 }, async (t) => {
    const fixture = await routingFixture(t, { defaultForceRelay });
    const connected = await fixture.connect(!defaultForceRelay);
    assert.equal(connected.route, 'relay');
    assert.equal(fixture.requestedForceRelay, true);
    assert.equal(fixture.directSocket, undefined);
    assert.deepEqual(fixture.loginCounts, { direct: 0, relay: 1 });
  });
}
