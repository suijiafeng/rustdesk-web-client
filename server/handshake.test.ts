import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test, { type TestContext } from 'node:test';
import nacl from 'tweetnacl';
import { BytesFrameDecoder, EncryptedFramedStream, encodeBytesFrame } from './bytesCodec.ts';
import { peerSignKey, readUntilHash } from './handshake.ts';
import { decodeMessage, encodeIdPk, encodeMessage } from './protos.ts';

const peerId = '123456789';
const hash = { salt: 'test-salt', challenge: 'test-challenge' };

async function hostFixture(t: TestContext, first: Record<string, unknown>) {
  const frames: Buffer[] = [];
  let host: net.Socket | undefined;
  const server = net.createServer(socket => {
    host = socket;
    socket.on('error', () => {});
    const decoder = new BytesFrameDecoder();
    socket.on('data', chunk => frames.push(...decoder.push(Buffer.from(chunk))));
    // A malicious peer can pipeline a plaintext Hash after its bogus identity.
    socket.write(Buffer.concat([encodeBytesFrame(encodeMessage(first)), encodeBytesFrame(encodeMessage({ hash }))]));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = net.createConnection({ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port });
  const stream = new EncryptedFramedStream(socket);
  await once(socket, 'connect');
  t.after(async () => {
    stream.close();
    host?.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { stream, frames };
}

test('trusted host identities cannot downgrade to a plaintext challenge', async t => {
  const signing = nacl.sign.keyPair();
  const box = nacl.box.keyPair();
  const signed = (id: string, pk: Uint8Array) => nacl.sign(encodeIdPk(id, pk, 1), signing.secretKey);
  const corrupted = signed(peerId, box.publicKey);
  corrupted[0] ^= 0xff;
  const cases = [
    { name: 'bad signature', first: { signed_id: { id: corrupted } }, reason: /signature verification failed/ },
    { name: 'wrong device', first: { signed_id: { id: signed('987654321', box.publicKey) } }, reason: /does not match/ },
    { name: 'invalid exchange key', first: { signed_id: { id: signed(peerId, new Uint8Array(31)) } }, reason: /key length/ },
    { name: 'stripped identity', first: { hash }, reason: /signature is required/ },
  ];
  for (const item of cases) {
    await t.test(item.name, async context => {
      const f = await hostFixture(context, item.first);
      await assert.rejects(readUntilHash(f.stream, signing.publicKey, peerId), item.reason);
      assert.equal(f.frames.length, 0, 'A rejected identity must not receive an empty PublicKey or login');
    });
  }
});

test('a configured trust root rejects missing signed peer keys', () => {
  const root = nacl.sign.keyPair();
  const key = Buffer.from(root.publicKey).toString('base64');
  for (const signed of [undefined, new Uint8Array()]) {
    assert.throws(() => peerSignKey(key, signed, peerId), /did not provide a signed peer public key/);
  }
  assert.equal(peerSignKey('', undefined, peerId), null);
});

test('legacy direct connections with no trusted key still accept a plaintext Hash', async t => {
  const f = await hostFixture(t, { hash });
  assert.deepEqual(await readUntilHash(f.stream, null, ''), { hash, encrypted: false });
  assert.equal(f.frames.length, 0);
});

test('legacy unsigned direct negotiation remains explicit when no trusted peer key exists', async t => {
  const f = await hostFixture(t, { signed_id: { id: Buffer.from('untrusted legacy identity') } });
  assert.deepEqual(await readUntilHash(f.stream, null, ''), { hash, encrypted: false });
  // sendRaw resolves after handing bytes to TCP; wait for their receipt.
  for (let i = 0; !f.frames.length && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(decodeMessage(f.frames[0]).public_key);
  assert.equal(f.stream.isSecured(), false);
});
