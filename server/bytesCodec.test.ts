import test from 'node:test';
import assert from 'node:assert/strict';
import { BytesFrameDecoder, encodeBytesFrame } from './bytesCodec.ts';

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
