import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { zstdCompressSync } from 'node:zlib';
import test from 'node:test';
import type { WebSocket } from 'ws';
import { decodeAudioFrame } from '../shared/audio.ts';
import { encodeMessage } from '../shared/protos.ts';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { startHostPump } from './hostMessages.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { SessionState } from './sessionState.ts';
import { AUDIO_QUEUE_LIMIT_BYTES, GatewayVideoBuffer, VIDEO_QUEUE_LIMIT_BYTES } from './videoBuffer.ts';

for (const negotiated of [false, true]) {
  for (const congested of [false, true]) {
    test(`gateway media keeps format ordering, bounded audio and cursor compatibility: optimized=${negotiated}, congested=${congested}`, async t => {
      const stream = new EncryptedFramedStream(new Socket());
      t.after(() => stream.close());
      const state: SessionState = {
        phase: 'live', hostConn: null, resolutionDisplay: 0, sizes: [], sessionCodecs: undefined,
        preferredCodec: undefined, privacyImpl: '', audioRequested: true, audioAllowed: true,
        audioFormat: null, currentSize: { width: 0, height: 0 }, cursorIds: negotiated, audioBinary: negotiated,
      };
      const conn: ConnectedHost = { stream, route: 'direct', privacyAllowed: true, clipboardAllowed: true,
        restartAllowed: true, audioAllowed: true, peerInfo: { hostname: 'media-peer' }, username: 'test', encrypted: true };
      state.hostConn = conn;
      const packet = Uint8Array.from([0, 1, 255]);
      const packets = [
        encodeMessage({ misc: { audio_format: { sample_rate: 48000, channels: 2 } } }),
        encodeMessage({ audio_frame: { data: packet } }),
        encodeMessage({ audio_frame: { data: new Uint8Array(8193) } }),
        encodeMessage({ cursor_data: { id: 7, width: 1, height: 1, colors: zstdCompressSync(Buffer.alloc(4)) } }),
        encodeMessage({ cursor_id: 7 }),
        encodeMessage({ misc: { permission_info: { permission: 3, enabled: false } } }),
        encodeMessage({ audio_frame: { data: packet } }),
      ];
      t.mock.method(stream, 'next', async () => {
        if (!packets.length) { state.phase = 'closed'; return null; }
        return packets.shift()!;
      });
      const json: Array<Record<string, unknown>> = [];
      const binary: Uint8Array[] = [];
      const order: string[] = [];
      await startHostPump(conn, {
        state, ws: { bufferedAmount: congested ? AUDIO_QUEUE_LIMIT_BYTES : 0 } as WebSocket, videoBuffer: new GatewayVideoBuffer(),
        sendJson: message => { json.push(message); order.push(String(message.type)); },
        sendBinary: frame => { binary.push(frame); order.push('binary'); },
        cleanup: () => { state.phase = 'closed'; },
      }, () => { throw new Error('This audio/cursor test must not produce video'); });
      assert.equal(binary.length, negotiated && !congested ? 1 : 0);
      assert.equal(json.filter(message => message.type === 'audioFrame').length, !negotiated && !congested ? 1 : 0);
      if (!congested) {
        assert.ok(order.indexOf('audioFormat') < order.indexOf(negotiated ? 'binary' : 'audioFrame'));
        if (negotiated) assert.deepEqual(decodeAudioFrame(binary[0]), packet);
        else assert.equal(json.find(message => message.type === 'audioFrame')?.packet, Buffer.from(packet).toString('base64'));
      }
      assert.equal(json.filter(message => message.type === 'cursorShape').length, negotiated ? 1 : 2);
      assert.equal(json.some(message => message.type === 'cursorId' && message.id === '7'), negotiated);
      assert.ok(json.some(message => message.type === 'audioDenied'));
    });
  }
}

test('audio continues flowing above the video cutoff and delayEcho bounces bounded TestDelay probes', async t => {
  const stream = new EncryptedFramedStream(new Socket());
  t.after(() => stream.close());
  const hostWrites: Uint8Array[] = [];
  t.mock.method(stream, 'sendRaw', async (data: Uint8Array) => { hostWrites.push(data); });
  const state: SessionState = {
    phase: 'live', hostConn: null, resolutionDisplay: 0, sizes: [], sessionCodecs: undefined,
    preferredCodec: undefined, privacyImpl: '', audioRequested: true, audioAllowed: true,
    audioFormat: null, currentSize: { width: 0, height: 0 }, audioBinary: true, delayEcho: true,
  };
  const conn: ConnectedHost = { stream, route: 'direct', privacyAllowed: true, clipboardAllowed: true,
    restartAllowed: true, audioAllowed: true, peerInfo: { hostname: 'qos-peer' }, username: 'test', encrypted: true };
  state.hostConn = conn;
  const audioPacket = Uint8Array.from([1, 2, 3]);
  const packets = [
    encodeMessage({ audio_frame: { data: audioPacket } }),
    ...Array.from({ length: 10 }, (_, index) => encodeMessage({ test_delay: { time: index + 1, from_client: false, last_delay: 42 } })),
  ];
  t.mock.method(stream, 'next', async () => {
    if (!packets.length) { state.phase = 'closed'; return null; }
    return packets.shift()!;
  });
  const json: Array<Record<string, unknown>> = [];
  const binary: Uint8Array[] = [];
  await startHostPump(conn, {
    // Above video cutoff (512 KiB) so video sheds, but below audio limit (768 KiB).
    state, ws: { bufferedAmount: VIDEO_QUEUE_LIMIT_BYTES + 64 * 1024 } as WebSocket, videoBuffer: new GatewayVideoBuffer(),
    sendJson: message => json.push(message),
    sendBinary: frame => binary.push(frame),
    cleanup: () => { state.phase = 'closed'; },
  }, () => {});
  assert.equal(binary.length, 1);
  assert.deepEqual(decodeAudioFrame(binary[0]), audioPacket);
  // With delayEcho negotiated, gateway must NOT immediately echo TestDelay to host.
  assert.equal(hostWrites.length, 0);
  const probes = json.filter(message => message.type === 'delayProbe');
  assert.equal(probes.length, 10);
  assert.equal(state.pendingDelayProbes?.size, 8);
  assert.equal(state.pendingDelayProbes?.has(1), false);
  assert.equal(state.pendingDelayProbes?.has(2), false);
  assert.equal(state.pendingDelayProbes?.has(10), true);
});
