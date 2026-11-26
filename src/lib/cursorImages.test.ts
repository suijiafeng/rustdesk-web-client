import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { CursorPublisher, CursorShapes, type CursorMessage } from '../../shared/cursor.ts';
import { CursorImages } from './cursorImages.ts';

function imageDataFixture(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
  class FakeImageData {
    constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
  }
  Object.defineProperty(globalThis, 'ImageData', { value: FakeImageData, configurable: true });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'ImageData', original); else Reflect.deleteProperty(globalThis, 'ImageData'); });
}

const bitmap = (id: string, value = 7, side = 32) => ({
  id, width: side, height: side, hotx: 1, hoty: 2,
  colors: zstdCompressSync(Buffer.alloc(side * side * 4, value)),
});

test('cursor IDs reuse ImageData and publish a bitmap only for a new shape', t => {
  imageDataFixture(t);
  const requested: string[] = [];
  const client = new CursorImages(id => requested.push(id));
  const host = new CursorPublisher(new CursorShapes(), true);
  const first = host.update(bitmap('1'));
  assert.equal(first.type, 'cursorShape');
  if (first.type !== 'cursorShape') throw new Error('missing shape');
  const image = client.receive(first);
  assert.ok(image);
  for (let index = 0; index < 10; index++) {
    const next = host.select('1');
    assert.deepEqual(next, { type: 'cursorId', id: '1' });
    assert.strictEqual(client.select('1'), image);
    assert.ok(JSON.stringify(next).length < JSON.stringify(first).length / 100);
  }
  assert.deepEqual(requested, []);
  const replacement = host.update(bitmap('1', 9));
  assert.equal(replacement.type, 'cursorShape');
  if (replacement.type !== 'cursorShape') throw new Error('missing replacement');
  const replaced = client.receive(replacement);
  assert.equal(replaced?.pixels.data[0], 9);
  assert.notStrictEqual(replaced, image);
});

test('cursor eviction, missing shape recovery and a fresh session cannot use stale bitmaps', t => {
  imageDataFixture(t);
  const requested: string[] = [];
  const client = new CursorImages(id => requested.push(id));
  const host = new CursorPublisher(new CursorShapes(), true);
  const deliver = (message: CursorMessage) => message.type === 'cursorShape' ? client.receive(message) : client.select(message.id);
  for (let index = 0; index < 17; index++) deliver(host.update(bitmap(String(index))));
  assert.deepEqual(host.select('0'), { type: 'cursorShape', id: '0', shape: null });
  assert.equal(deliver(host.select('0')), null);
  assert.ok(client.select('16'));
  client.clear();
  assert.equal(client.select('16'), null);
  assert.equal(client.select('16'), null);
  assert.deepEqual(requested, ['16'], 'only one repair request while a bitmap is missing');
  assert.ok(deliver(host.select(requested[0], true)));
  assert.ok(client.select('16'));
  host.clear(); client.clear();
  assert.equal(deliver(host.select('16')), null);
});

test('large cursor caches enforce the byte budget and legacy transport keeps complete shapes', t => {
  imageDataFixture(t);
  const requests: string[] = [];
  const client = new CursorImages(id => requests.push(id));
  const host = new CursorPublisher(new CursorShapes(), true);
  for (let index = 0; index < 4; index++) {
    const message = host.update(bitmap(String(index), index, 512));
    assert.equal(message.type, 'cursorShape');
    if (message.type === 'cursorShape') client.receive(message);
  }
  assert.equal(client.select('0'), null);
  assert.ok(client.select('3'));
  assert.deepEqual(host.select('0'), { type: 'cursorShape', id: '0', shape: null });
  const legacy = new CursorPublisher(new CursorShapes());
  const shape = legacy.update(bitmap('1'));
  assert.deepEqual(legacy.select('1'), shape);
  assert.equal('id' in shape, false);
  if (shape.type === 'cursorShape') assert.ok(client.receive(shape));
});
