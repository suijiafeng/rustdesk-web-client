import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { humanizeError, selectCodecs } from './control.ts';
import { decodeRendezvous, encodeRendezvous, PunchFailureValues } from './protos.ts';
import { connectViaId } from './rustdeskClient.ts';
import { formatConnectionError } from '../src/lib/errors.ts';

const cases = [
  { name: 'omitted proto3 ID_NOT_EXIST default', response: {}, message: 'ID does not exist', title: 'Device ID Not Found' },
  { name: 'explicit ID_NOT_EXIST', response: { failure: PunchFailureValues.ID_NOT_EXIST }, message: 'ID does not exist', title: 'Device ID Not Found' },
  { name: 'offline device', response: { failure: PunchFailureValues.OFFLINE }, message: 'remote desktop is offline', title: 'Device Offline' },
  { name: 'custom server failure', response: { other_failure: 'Server policy rejected this connection' }, message: 'Server policy rejected this connection', title: 'Connection Failed' },
  { name: 'unknown failure code', response: { failure: 99 }, message: 'punch hole failed', title: 'Connection Failed' },
];

for (const scenario of cases) {
  test(`ID routing preserves ${scenario.name}`, { timeout: 5_000 }, async t => {
    const names = ['NODE_ENV', 'RUSTDESK_ALLOW_PRIVATE_TARGETS'] as const;
    const saved = names.map(name => [name, process.env[name]] as const);
    process.env.NODE_ENV = 'test';
    process.env.RUSTDESK_ALLOW_PRIVATE_TARGETS = 'true';
    const sockets = new Set<net.Socket>();
    const tasks: Promise<void>[] = [];
    const errors: unknown[] = [];
    const hbbs = net.createServer(socket => {
      sockets.add(socket);
      socket.on('error', () => {});
      const stream = new EncryptedFramedStream(socket);
      tasks.push((async () => {
        const request = await stream.next(2_000);
        assert.ok(request);
        assert.equal(decodeRendezvous(request).punch_hole_request?.id, '123456789');
        const response = encodeRendezvous({ punch_hole_response: scenario.response });
        if (scenario.name.startsWith('omitted')) {
          assert.equal(decodeRendezvous(response).punch_hole_response.failure, undefined);
        }
        await stream.sendRaw(response);
      })().catch(error => { errors.push(error); socket.destroy(); }));
    });
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => hbbs.close(() => resolve()));
      await Promise.all(tasks);
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      assert.deepEqual(errors, []);
    });
    hbbs.listen(0, '127.0.0.1');
    await once(hbbs, 'listening');
    const port = (hbbs.address() as net.AddressInfo).port;
    await assert.rejects(connectViaId({
      peerId: '123456789', password: '', idServer: `127.0.0.1:${port}`,
      relayServer: '', key: '', forceRelay: false,
    }, selectCodecs({ vp8: true, reported: true })), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, scenario.message);
      const formatted = formatConnectionError('en', humanizeError(error));
      assert.equal(formatted.title, scenario.title);
      if (scenario.title === 'Device ID Not Found') assert.match(formatted.message, /same ID server/);
      if (scenario.title === 'Device Offline') assert.match(formatted.message, /powered on/);
      return true;
    });
  });
}
