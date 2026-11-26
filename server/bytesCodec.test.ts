import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { BytesFrameDecoder, EncryptedFramedStream, MAX_FRAME_LENGTH, MAX_QUEUED_FRAMES, MAX_RECEIVE_BYTES, encodeBytesFrame } from './bytesCodec.ts';

test('BytesFrameDecoder handles every prefix width split into individual bytes', () => {
  for (const size of [7, 64, 16_384, 4_194_304]) {
    const payload = Buffer.alloc(size, size & 0xff);
    const encoded = encodeBytesFrame(payload);
    const headerLength = (encoded[0] & 3) + 1;
    const decoder = new BytesFrameDecoder();
    for (let index = 0; index < headerLength; index++) {
      assert.deepEqual(decoder.push(encoded.subarray(index, index + 1)), []);
    }
    assert.deepEqual(decoder.push(encoded.subarray(headerLength)), [payload]);
  }
});

test('BytesFrameDecoder preserves multiple frames and incomplete trailing headers or payloads', () => {
  const decoder = new BytesFrameDecoder();
  const first = Buffer.from('first');
  const second = Buffer.alloc(64, 0x52);
  const third = Buffer.alloc(256, 0x37);
  const secondEncoded = encodeBytesFrame(second);
  const thirdEncoded = encodeBytesFrame(third);

  assert.deepEqual(decoder.push(Buffer.alloc(0)), []);
  assert.deepEqual(decoder.push(Buffer.concat([
    encodeBytesFrame(first),
    encodeBytesFrame(Buffer.alloc(0)),
    secondEncoded.subarray(0, 1),
  ])), [first, Buffer.alloc(0)]);
  assert.deepEqual(decoder.push(Buffer.alloc(0)), []);
  assert.deepEqual(decoder.push(Buffer.concat([
    secondEncoded.subarray(1),
    thirdEncoded.subarray(0, 11),
  ])), [second]);
  assert.deepEqual(decoder.push(thirdEncoded.subarray(11)), [third]);
  assert.deepEqual(decoder.push(encodeBytesFrame(Buffer.from('next'))), [Buffer.from('next')]);
});

test('BytesFrameDecoder outputs own their bytes independently of input and other frames', () => {
  const decoder = new BytesFrameDecoder();
  const input = Buffer.concat([
    encodeBytesFrame(Buffer.from('first')),
    encodeBytesFrame(Buffer.from('second')),
  ]);
  const frames = decoder.push(input);
  input.fill(0);
  assert.deepEqual(frames, [Buffer.from('first'), Buffer.from('second')]);
  frames[0].fill(1);
  decoder.push(encodeBytesFrame(Buffer.from('later')));
  assert.deepEqual(frames[1], Buffer.from('second'));
});

test('BytesFrameDecoder copies a fragmented 2 MiB keyframe once without concatenation', (t) => {
  const payload = Buffer.alloc(2 * 1024 * 1024);
  for (let index = 0; index < payload.length; index++) payload[index] = index & 0xff;
  const encoded = encodeBytesFrame(payload);
  const decoder = new BytesFrameDecoder();
  const originalConcat = Buffer.concat;
  const originalCopy = Buffer.prototype.copy;
  let concatCalls = 0;
  let copiedBytes = 0;
  t.mock.method(Buffer, 'concat', (...args: Parameters<typeof Buffer.concat>) => {
    concatCalls++;
    return originalConcat(...args);
  });
  t.mock.method(Buffer.prototype, 'copy', function (this: Buffer, ...args: Parameters<Buffer['copy']>) {
    const copied = originalCopy.apply(this, args);
    copiedBytes += copied;
    return copied;
  });

  const frames: Buffer[] = [];
  for (let offset = 0; offset < encoded.length; offset += 16_384) {
    frames.push(...decoder.push(encoded.subarray(offset, offset + 16_384)));
    if (offset + 16_384 < encoded.length) assert.equal(copiedBytes, 0);
  }

  assert.deepEqual(frames, [payload]);
  assert.equal(concatCalls, 0);
  assert.equal(copiedBytes, payload.length);
});

test('BytesFrameDecoder keeps order through many consumed chunks with an incomplete tail', () => {
  const decoder = new BytesFrameDecoder();
  const payload = Buffer.alloc(4096, 0x55);
  const encoded = encodeBytesFrame(payload);
  const tail = encodeBytesFrame(Buffer.from('tail'));
  for (let index = 0; index < encoded.length - 1; index++) {
    assert.deepEqual(decoder.push(encoded.subarray(index, index + 1)), []);
  }
  assert.deepEqual(decoder.push(Buffer.concat([
    encoded.subarray(-1),
    tail.subarray(0, 3),
  ])), [payload]);
  assert.deepEqual(decoder.push(tail.subarray(3)), [Buffer.from('tail')]);
});

test('oversized frame headers fail before a payload arrives and release partial input', () => {
  const decoder = new BytesFrameDecoder();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(((MAX_FRAME_LENGTH + 1) * 4) + 3);
  assert.deepEqual(decoder.push(header.subarray(0, 3)), []);
  assert.throws(() => decoder.push(header.subarray(3)), /frame overflow/);
  assert.equal(decoder.pendingBytes, 0);
  assert.throws(() => encodeBytesFrame(Buffer.alloc(MAX_FRAME_LENGTH + 1)), /exceeds MAX_FRAME_LENGTH/);
});

test('the full 16 MiB frame limit accepts fragmentation and a following frame', () => {
  const payload = Buffer.alloc(MAX_FRAME_LENGTH, 0x7c);
  const decoder = new BytesFrameDecoder();
  const bytes = Buffer.concat([encodeBytesFrame(payload), encodeBytesFrame(Buffer.from('tail'))]);
  const frames: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    frames.push(...decoder.push(bytes.subarray(offset, offset + 1024)));
  }
  assert.deepEqual(frames, [payload, Buffer.from('tail')]);
  assert.equal(decoder.pendingBytes, 0);
});

test('a single batch can stop at a consumer high watermark and resume in order', () => {
  const decoder = new BytesFrameDecoder();
  const frames = Array.from({ length: 700 }, (_, index) => Buffer.from(String(index)));
  const bytes = Buffer.concat(frames.map(encodeBytesFrame));
  const received: Buffer[] = [];
  decoder.push(bytes, frame => { received.push(frame); return received.length % 128 !== 0; });
  assert.equal(received.length, 128);
  assert.ok(decoder.pendingBytes > 0);
  while (decoder.pendingBytes) decoder.push(Buffer.alloc(0), frame => { received.push(frame); return received.length % 128 !== 0; });
  assert.deepEqual(received, frames);
  assert.throws(() => new BytesFrameDecoder().push(Buffer.alloc(MAX_QUEUED_FRAMES + 1)), /batch limit/);
});

test('pathological tiny fragments have a bounded chunk count', () => {
  const decoder = new BytesFrameDecoder();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_FRAME_LENGTH * 4 + 3);
  decoder.push(header);
  assert.throws(() => {
    for (let i = 0; i < 40_000; i++) decoder.push(Buffer.from([0]));
  }, /receive buffer limit/);
  assert.equal(decoder.pendingBytes, 0);
});

async function tcpFixture(t: TestContext) {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const accepted = once(server, 'connection');
  const socket = net.createConnection({ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port });
  const stream = new EncryptedFramedStream(socket);
  const connected = once(socket, 'connect');
  let peer: net.Socket | undefined;
  t.after(async () => {
    stream.close();
    peer?.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  [peer] = await accepted as [net.Socket];
  peer.on('error', () => {});
  await connected;
  const state = stream as unknown as { queue: Buffer[]; queuedBytes: number; decoder: BytesFrameDecoder };
  return { stream, socket, peer, state };
}

async function waitUntil(predicate: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for receive flow control');
}

test('TCP frame floods pause at the count watermark and drain without losing a batch tail', { timeout: 10_000 }, async t => {
  const f = await tcpFixture(t);
  const payloads = Array.from({ length: 3000 }, (_, i) => Buffer.from(String(i)));
  f.peer.write(Buffer.concat(payloads.map(encodeBytesFrame)));
  await waitUntil(() => f.socket.isPaused());
  assert.equal(f.state.queue.length, MAX_QUEUED_FRAMES / 2);
  assert.ok(f.state.queuedBytes + f.state.decoder.pendingBytes <= MAX_RECEIVE_BYTES);
  for (const payload of payloads) assert.deepEqual(await f.stream.next(1000), payload);
  assert.equal(f.socket.isPaused(), false);
  assert.equal(f.state.queue.length, 0);
  f.peer.write(encodeBytesFrame(Buffer.from('after-resume')));
  assert.deepEqual(await f.stream.next(1000), Buffer.from('after-resume'));
});

test('TCP large keyframes pause by bytes, resume after consumption and remain ordered', { timeout: 10_000 }, async t => {
  const f = await tcpFixture(t);
  const payloads = [Buffer.alloc(MAX_FRAME_LENGTH, 1), Buffer.alloc(4096, 2)];
  f.peer.write(Buffer.concat(payloads.map(encodeBytesFrame)));
  await waitUntil(() => f.socket.isPaused());
  assert.equal(f.state.queuedBytes, MAX_FRAME_LENGTH);
  assert.ok(f.state.queuedBytes + f.state.decoder.pendingBytes <= MAX_RECEIVE_BYTES);
  assert.deepEqual(await f.stream.next(1000), payloads[0]);
  assert.deepEqual(await f.stream.next(1000), payloads[1]);
  assert.equal(f.socket.isPaused(), false);
});

test('TCP oversized header terminates the stream and rejects all waiting readers', { timeout: 5000 }, async t => {
  const f = await tcpFixture(t);
  const header = Buffer.alloc(4);
  header.writeUInt32LE((MAX_FRAME_LENGTH + 1) * 4 + 3);
  const readers = [f.stream.next(1000), f.stream.next(1000)];
  const rejected = Promise.all(readers.map(reader => assert.rejects(reader, /frame overflow/)));
  f.peer.write(header.subarray(0, 2));
  f.peer.write(header.subarray(2));
  await rejected;
  assert.equal(f.socket.destroyed, true);
  assert.equal(f.state.decoder.pendingBytes, 0);
  await assert.rejects(f.stream.next(), /frame overflow/);
});

test('corrupted encrypted TCP input rejects the active waiter and releases queued data', { timeout: 5000 }, async t => {
  const f = await tcpFixture(t);
  f.stream.setNegotiatedKey(new Uint8Array(32).fill(7), true, {
    initiatorPk: new Uint8Array(32), responderPk: new Uint8Array(32), advertised: 0, picked: 0,
  });
  const rejected = assert.rejects(f.stream.next(1000), /decryption failed/);
  f.peer.write(encodeBytesFrame(Buffer.alloc(32, 1)));
  await rejected;
  assert.equal(f.socket.destroyed, true);
  assert.equal(f.state.queue.length, 0);
  assert.equal(f.state.decoder.pendingBytes, 0);
});

test('closing a paused TCP stream clears complete frames and its unparsed tail', { timeout: 5000 }, async t => {
  const f = await tcpFixture(t);
  f.peer.write(Buffer.alloc(3000)); // 3000 empty frames also count against the queue budget.
  await waitUntil(() => f.socket.isPaused());
  assert.equal(f.state.queue.length, MAX_QUEUED_FRAMES / 2);
  assert.ok(f.state.decoder.pendingBytes > 0);
  f.stream.close();
  assert.equal(f.state.queue.length, 0);
  assert.equal(f.state.queuedBytes, 0);
  assert.equal(f.state.decoder.pendingBytes, 0);
  assert.equal(await f.stream.next(), null);
});

test('local close settles a pending TCP reader immediately', async t => {
  const f = await tcpFixture(t);
  const pending = f.stream.next(1000);
  f.stream.close();
  assert.equal(await pending, null);
});

test('a protocol failure clears earlier queued frames instead of delivering them after failure', async t => {
  const f = await tcpFixture(t);
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32LE((MAX_FRAME_LENGTH + 1) * 4 + 3);
  f.peer.write(Buffer.concat([encodeBytesFrame(Buffer.from('queued-before-failure')), oversized]));
  await waitUntil(() => f.socket.destroyed);
  assert.equal(f.state.queue.length, 0);
  assert.equal(f.state.queuedBytes, 0);
  assert.equal(f.state.decoder.pendingBytes, 0);
  await assert.rejects(f.stream.next(), /frame overflow/);
});

test('remote EOF preserves complete frames while a paused batch is drained', { timeout: 5000 }, async t => {
  const f = await tcpFixture(t);
  const frames = Array.from({ length: 400 }, (_, i) => Buffer.from(String(i)));
  f.peer.end(Buffer.concat(frames.map(encodeBytesFrame)));
  await waitUntil(() => f.socket.isPaused());
  for (const frame of frames) assert.deepEqual(await f.stream.next(1000), frame);
  assert.equal(await f.stream.next(1000), null);
  assert.equal(f.state.decoder.pendingBytes, 0);
  assert.equal(f.state.queuedBytes, 0);
});
