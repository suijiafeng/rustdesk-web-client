import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { RemoteAudio, type AudioFailureStage } from './remoteAudio';

class FakeContext {
  static latest: FakeContext;
  state = 'suspended';
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  closeCalls = 0;
  resumeCalls = 0;
  load: () => Promise<void> = async () => {};
  audioWorklet = { addModule: () => this.load() };
  constructor() { FakeContext.latest = this; }
  async resume() { this.resumeCalls++; this.state = 'running'; }
  async close() { this.closeCalls++; this.state = 'closed'; }
}
class FakeNode {
  static all: FakeNode[] = [];
  onprocessorerror: (() => void) | null = null;
  disconnected = false;
  messages: any[] = [];
  transferCounts: number[] = [];
  port = {
    onmessage: null as ((event: { data: any }) => void) | null,
    closed: false,
    postMessage: (value: any, transfer: ArrayBuffer[] = []) => {
      this.transferCounts.push(transfer.length);
      this.messages.push(structuredClone(value, { transfer }));
    },
    close: () => { this.port.closed = true; },
  };
  constructor() { FakeNode.all.push(this); }
  connect() {}
  disconnect() { this.disconnected = true; }
  ack(message: any) { this.port.onmessage?.({ data: { type: 'consumed', generation: message.generation, id: message.id } }); }
  pcm() { return this.messages.filter(message => message.type === 'pcm'); }
}
class FakeDecoder {
  static latest: FakeDecoder;
  state = 'unconfigured';
  decodeQueueSize = 0;
  closeCalls = 0;
  chunks: EncodedAudioChunk[] = [];
  config: AudioDecoderConfig | undefined;
  constructor(readonly callbacks: AudioDecoderInit) { FakeDecoder.latest = this; }
  configure(config: AudioDecoderConfig) { this.config = config; this.state = 'configured'; }
  decode(chunk: EncodedAudioChunk) { this.chunks.push(chunk); }
  close() { this.closeCalls++; this.state = 'closed'; }
  output(value = 0.5, frames = 480, channels = this.config?.numberOfChannels ?? 2, timestamp = FakeContext.latest.currentTime * 1_000_000) {
    const frame = {
      numberOfFrames: frames, numberOfChannels: channels, sampleRate: 48000, timestamp, closeCalls: 0,
      copyTo(destination: Float32Array, options: { planeIndex: number }) { destination.fill(options.planeIndex ? -value : value); },
      close() { this.closeCalls++; },
    };
    this.callbacks.output(frame as unknown as AudioData);
    return frame;
  }
}

function fixture(t: TestContext) {
  FakeNode.all = [];
  const globals = { AudioContext: FakeContext, AudioWorkletNode: FakeNode, AudioDecoder: FakeDecoder,
    EncodedAudioChunk: class { constructor(options: object) { Object.assign(this, options); } } };
  for (const [name, value] of Object.entries(globals)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else Reflect.deleteProperty(globalThis, name); });
  }
  // The browser regression exercises Vite's real URL and processor. Unit tests
  // replace only asset loading so lifecycle races run without a DOM or bundler.
  t.mock.method(RemoteAudio.prototype as any, 'loadWorklet', function (this: any) {
    return this.context.audioWorklet.addModule('audio-worklet.js');
  });
  let errors = 0;
  const failures: { stage: AudioFailureStage; error: unknown }[] = [];
  const player = new RemoteAudio((stage, error) => { errors++; failures.push({ stage, error }); });
  t.after(() => player.close());
  return { player, failures, context: FakeContext.latest, errors: () => errors, node: () => FakeNode.all.at(-1)! };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('normal five-packet bursts stay ordered while worklet acknowledgement is delayed', async t => {
  const f = fixture(t);
  await f.player.resume();
  f.player.configure(48000, 2);
  const decoder = FakeDecoder.latest;
  for (let i = 0; i < 5; i++) assert.equal(decoder.output(i / 10).closeCalls, 1);
  assert.equal(f.node().pcm().length, 1);
  f.node().ack(f.node().pcm()[0]);
  assert.equal(f.node().pcm().length, 2);
  assert.deepEqual(f.node().pcm().map(message => message.blocks.length), [1, 4]);
  const samples = f.node().pcm().flatMap(message => message.blocks.map((block: any) => Math.round(block.planes[0][0] * 10)));
  assert.deepEqual(samples, [0, 1, 2, 3, 4]);
  assert.equal(f.node().transferCounts.at(-1), 8);
  assert.equal(f.errors(), 0);
});

test('PCM received during module loading is pumped after worklet initialization', async t => {
  const f = fixture(t);
  const module = deferred();
  f.context.load = () => module.promise;
  const ready = f.player.resume();
  f.player.configure(48000, 2);
  for (let i = 0; i < 5; i++) FakeDecoder.latest.output();
  assert.equal(FakeNode.all.length, 0);
  module.resolve();
  await ready;
  assert.equal(f.node().messages[0].type, 'reset');
  assert.equal(f.node().pcm()[0].blocks.length, 5);
});

test('format changes flush pending PCM and reject old decoder outputs and acknowledgements', async t => {
  const f = fixture(t);
  await f.player.resume();
  f.player.configure(48000, 2);
  const oldDecoder = FakeDecoder.latest;
  oldDecoder.output(0.1);
  oldDecoder.output(0.2);
  const oldMessage = f.node().pcm()[0];
  f.player.configure(48000, 1);
  assert.equal(oldDecoder.closeCalls, 1);
  assert.equal(oldDecoder.output(0.3).closeCalls, 1);
  oldDecoder.callbacks.error(new DOMException('late old format error'));
  FakeDecoder.latest.output(0.4);
  FakeDecoder.latest.output(0.5);
  f.node().ack(oldMessage);
  assert.equal(f.node().pcm().length, 2);
  const current = f.node().pcm()[1];
  assert.notEqual(current.generation, oldMessage.generation);
  assert.equal(current.blocks[0].planes.length, 1);
  f.node().ack(current);
  assert.equal(f.node().pcm().length, 3);
  assert.equal(f.errors(), 0);
});

test('pending duration is bounded and expires before delivery', async t => {
  const f = fixture(t);
  await f.player.resume();
  f.player.configure(48000, 2);
  for (let i = 0; i < 30; i++) FakeDecoder.latest.output(i / 100);
  f.node().ack(f.node().pcm()[0]);
  const batch = f.node().pcm()[1];
  assert.equal(batch.blocks.length, 20);
  assert.ok(Math.abs(batch.blocks[0].planes[0][0] - 0.1) < 1e-6);
  FakeDecoder.latest.output();
  f.context.currentTime = 0.3;
  f.node().ack(batch);
  assert.equal(f.node().pcm().length, 2);
});

test('close during asynchronous loading cannot create a late node or report an error', async t => {
  const f = fixture(t);
  const module = deferred();
  f.context.load = () => module.promise;
  const ready = f.player.resume();
  f.player.close();
  f.player.close();
  module.reject(new Error('load ended after close'));
  await ready;
  assert.equal(FakeNode.all.length, 0);
  assert.equal(f.context.closeCalls, 1);
  assert.equal(f.errors(), 0);
});

test('loading failures and processor failures notify once and release all resources', async t => {
  const f = fixture(t);
  f.context.load = async () => { throw new Error('module failed'); };
  await Promise.all([f.player.resume(), f.player.resume()]);
  f.player.configure(48000, 2);
  await f.player.resume();
  assert.equal(f.errors(), 1);
  assert.equal(f.context.closeCalls, 1);
  assert.equal(f.context.resumeCalls, 1);
  assert.equal(f.failures[0].stage, 'module');
  assert.equal((f.failures[0].error as Error).message, 'module failed');
});

test('resume rejection and an unavailable worklet fail through the same bounded lifecycle', async t => {
  const f = fixture(t);
  t.mock.method(f.context, 'resume', async () => { throw new Error('resume denied'); });
  await f.player.resume();
  assert.equal(f.errors(), 1);
  assert.equal(f.context.closeCalls, 1);
  assert.equal(f.failures[0].stage, 'start');
  assert.equal((f.failures[0].error as Error).message, 'resume denied');
  if (FakeNode.all.length) assert.equal(f.node().disconnected, true);
});

test('missing AudioWorklet support is reported gracefully without constructing a node', async t => {
  const f = fixture(t);
  Object.defineProperty(f.context, 'audioWorklet', { value: undefined });
  await f.player.resume();
  assert.equal(f.errors(), 1);
  assert.equal(FakeNode.all.length, 0);
});

test('processor failure closes node and stale error callbacks do not notify twice', async t => {
  const f = fixture(t);
  await f.player.resume();
  f.player.configure(48000, 2);
  const onError = f.node().onprocessorerror!;
  onError();
  onError();
  FakeDecoder.latest.callbacks.error(new DOMException('late'));
  assert.equal(f.errors(), 1);
  assert.equal(f.failures[0].stage, 'playback');
  assert.equal(f.node().disconnected, true);
  assert.equal(f.node().port.closed, true);
});

test('suspension resume flushes stale audio, and excessive decoder backlog keeps the newest packet', async t => {
  const f = fixture(t);
  await f.player.resume();
  f.player.configure(48000, 2);
  const first = FakeDecoder.latest;
  first.output();
  f.context.state = 'suspended';
  assert.equal(first.output().closeCalls, 1);
  await f.player.resume();
  assert.equal(first.closeCalls, 1);
  const resumed = FakeDecoder.latest;
  resumed.decodeQueueSize = 13;
  f.player.push(btoa('opus'));
  assert.equal(resumed.closeCalls, 1);
  assert.equal(FakeDecoder.latest.chunks.length, 1);
  assert.equal(f.errors(), 0);
});

test('invalid formats fail once; a decoder output after closing still releases AudioData', async t => {
  const f = fixture(t);
  await f.player.resume();
  f.player.configure(48000, 2);
  const decoder = FakeDecoder.latest;
  f.player.configure(48000, 0);
  assert.equal(f.failures[0].stage, 'decode');
  assert.equal(decoder.output().closeCalls, 1);
  f.player.configure(0, 2);
  assert.equal(f.errors(), 1);
});


test('raw Opus bytes and legacy base64 share the bounded decoder path', async t => {
  const f = fixture(t);
  await f.player.resume();
  f.player.configure(48000, 2);
  const packet = Uint8Array.from([1, 0, 255, 128]);
  f.player.push(packet);
  f.player.push(Buffer.from(packet).toString('base64'));
  assert.equal(FakeDecoder.latest.chunks.length, 2);
  const chunks = FakeDecoder.latest.chunks as unknown as { data: Uint8Array }[];
  assert.strictEqual(chunks[0].data, packet, 'binary input should not make a base64 round trip');
  assert.deepEqual(chunks[1].data, packet);
  f.player.push(new Uint8Array(8193));
  assert.equal(f.errors(), 1);
  assert.equal(f.context.closeCalls, 1);
});
