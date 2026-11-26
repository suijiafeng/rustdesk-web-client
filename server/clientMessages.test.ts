import { CursorPublisher, CursorShapes } from '../shared/cursor.ts';
import { zstdCompressSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { WebSocket } from 'ws';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { createClientMessageHandler } from './clientMessages.ts';
import { selectCodecs } from '../shared/control.ts';
import { BoolOptionValues, decodeMessage } from '../shared/protos.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { SessionState } from './sessionState.ts';
import { GatewayVideoBuffer } from './videoBuffer.ts';

function fixture(t: TestContext, phase: SessionState['phase'] = 'live') {
  const stream = new EncryptedFramedStream(new Socket());
  t.after(() => stream.close());
  const replies: Record<string, unknown>[] = [];
  const writes: ReturnType<typeof decodeMessage>[] = [];
  const effects: string[] = [];
  const sendRaw = t.mock.method(stream, 'sendRaw', async (data: Uint8Array) => {
    writes.push(decodeMessage(data));
    effects.push('host');
  });
  const conn: ConnectedHost = {
    stream, route: 'direct', privacyAllowed: true, clipboardAllowed: true, restartAllowed: true,
    peerInfo: { platform: 'Linux', version: '1.5.3', features: { privacy_mode: true } },
    username: 'test', encrypted: true,
  };
  const state: SessionState = {
    phase, hostConn: phase === 'live' ? conn : null, resolutionDisplay: 0,
    sizes: [{ width: 1280, height: 720 }], sessionCodecs: selectCodecs(), preferredCodec: 'vp8',
    privacyImpl: 'test-impl', audioRequested: false, audioAllowed: true,
    audioFormat: { sampleRate: 48000, channels: 2 }, currentSize: { width: 1280, height: 720 },
  };
  const closed: boolean[] = [];
  let deadlineCleared = 0;
  const handler = createClientMessageHandler({
    state, ws: { bufferedAmount: 0 } as WebSocket, videoBuffer: new GatewayVideoBuffer(),
    sendJson: reply => { replies.push(reply); effects.push(String(reply.type)); },
    sendBinary: () => { throw new Error('Client messages must not send binary browser frames'); },
    cleanup: notify => { closed.push(notify); state.phase = 'closed'; },
    config: { token: 'test-token' }, connectionSignal: new AbortController().signal,
    clearConnectDeadline: () => { deadlineCleared++; },
    startHostPump: async () => { throw new Error('This fixture must not start a host connection'); },
  });
  return {
    state, conn, replies, writes, effects, sendRaw, closed,
    deadlineCleared: () => deadlineCleared,
    send: (message: unknown, binary = false) => handler(Buffer.from(JSON.stringify(message)), binary),
  };
}

test('dispatch preserves pre-auth messages, connecting gates and duplicate-connect errors', async t => {
  const f = fixture(t, 'awaiting-connect');
  await f.send({ type: 'ping', seq: 3 });
  assert.equal(f.replies.at(-1)?.type, 'pong');
  assert.equal(f.replies.at(-1)?.gatewayVideo, undefined);
  await f.send({ type: 'mouse', x: 1 });
  assert.equal(f.replies.at(-1)?.message, 'send a connect message first');
  f.state.phase = 'connecting';
  const count = f.replies.length;
  await f.send({ type: 'audio', enabled: true });
  assert.equal(f.replies.length, count);
  assert.equal(f.state.audioRequested, false);
  await f.send({ type: 'connect' });
  assert.equal(f.replies.at(-1)?.message, 'already connected');
  await f.send({ type: 'disconnect' });
  assert.deepEqual(f.closed, [true]);
  await f.send({ type: 'ping' });
  assert.equal(f.replies.at(-1)?.message, 'already connected');
  assert.equal(f.writes.length, 0);
});

test('connect still validates the gateway token before dialing', async t => {
  const f = fixture(t, 'awaiting-connect');
  await f.send({ type: 'connect', token: 'wrong-token' });
  assert.equal(f.deadlineCleared(), 1);
  assert.match(String(f.replies.at(-1)?.detail), /token is missing or incorrect/);
  assert.deepEqual(f.closed, [false]);
  assert.equal(f.writes.length, 0);
});

test('unknown and prototype message types cannot dispatch handlers', async t => {
  const f = fixture(t);
  for (const type of ['unknown', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) await f.send({ type });
  await f.send({ type: 'disconnect' }, true);
  assert.deepEqual(f.effects, []);
  assert.deepEqual(f.closed, []);
  await f.send({ type: 'text', text: 'hello' });
  assert.equal(f.writes[0].key_event?.seq, 'hello');
});

test('audio retains permission checks, format-before-control ordering and nonblocking forwarding', { timeout: 2000 }, async t => {
  const f = fixture(t);
  f.state.audioAllowed = false;
  await f.send({ type: 'audio', enabled: true });
  assert.deepEqual(f.effects, ['audioDenied']);
  assert.equal(f.state.audioRequested, false);
  f.state.audioAllowed = true;
  f.effects.length = 0;
  await f.send({ type: 'audio', enabled: true });
  assert.deepEqual(f.effects, ['audioFormat', 'host']);
  assert.equal(f.writes[0].misc?.option?.disable_audio, BoolOptionValues.No);
  f.sendRaw.mock.mockImplementation(() => new Promise<void>(() => {}));
  await f.send({ type: 'audio', enabled: false });
  assert.equal(f.state.audioRequested, false);
});

test('clipboard and privacy keep their permission checks and restart waits for its send result', async t => {
  const f = fixture(t);
  f.conn.clipboardAllowed = false;
  await f.send({ type: 'clipboard', text: 'secret' });
  f.conn.privacyAllowed = false;
  await f.send({ type: 'privacy', enabled: true });
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.replies.at(-1), { type: 'privacyResult', failed: true });
  f.conn.privacyAllowed = true;
  await f.send({ type: 'privacy', enabled: true });
  assert.equal(f.writes[0].misc?.toggle_privacy_mode?.impl_key, 'test-impl');

  let finish!: () => void;
  f.sendRaw.mock.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = f.send({ type: 'restart' });
  assert.equal(f.replies.some(reply => reply.type === 'restartResult'), false);
  finish();
  await pending;
  assert.deepEqual(f.replies.at(-1), { type: 'restartResult', sent: true });
});

test('resolution validates offered sizes and keeps legacy versus modern wire messages', async t => {
  const f = fixture(t);
  await f.send({ type: 'resolution', display: 1, width: 1280, height: 720 });
  assert.equal(f.writes.length, 0);
  assert.match(String(f.replies.at(-1)?.message), /does not offer/);
  await f.send({ type: 'resolution', display: 0, width: 1280, height: 720 });
  assert.equal(f.writes[0].misc?.change_display_resolution?.resolution?.width, 1280);
  f.conn.peerInfo.version = '1.2.3';
  await f.send({ type: 'resolution', display: 0, width: 1280, height: 720 });
  assert.equal(f.writes[1].misc?.change_resolution?.width, 1280);
});

test('quality sends decoder changes before refresh and forwarding failures close the session', async t => {
  const f = fixture(t);
  await f.send({ type: 'quality', codec: 'vp8', quality: 'balanced' });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].misc?.option?.supported_decoding, undefined);
  await f.send({ type: 'quality', codec: 'vp9', quality: 'best' });
  assert.equal(f.writes.length, 3);
  assert.ok(f.writes[1].misc?.option?.supported_decoding);
  assert.equal(f.writes[2].misc?.refresh_video, true);
  assert.equal(f.state.preferredCodec, 'vp9');
  f.sendRaw.mock.mockImplementation(async () => { throw new Error('write failed'); });
  await f.send({ type: 'text', text: 'hello' });
  assert.equal(f.replies.at(-1)?.state, 'error');
  assert.deepEqual(f.closed, [false]);
});

test('continuous quality updates preserve FPS, switch back to presets and reject invalid values without closing', async t => {
  const f = fixture(t);
  await f.send({ type: 'quality', quality: 'custom', customQuality: 100, fps: 25 });
  assert.equal(f.writes[0].misc?.option?.image_quality ?? 0, 0);
  assert.equal(f.writes[0].misc?.option?.custom_image_quality, 50 * 256);
  assert.equal(f.writes[0].misc?.option?.custom_fps, 25);
  await f.send({ type: 'quality', quality: 'best', customQuality: 100, fps: 25 });
  assert.equal(f.writes[1].misc?.option?.image_quality, 4);
  assert.equal(f.writes[1].misc?.option?.custom_image_quality, undefined);
  await f.send({ type: 'quality', quality: 'custom', customQuality: 201, codec: 'vp9' });
  assert.equal(f.writes.length, 2);
  assert.equal(f.state.preferredCodec, 'vp8');
  assert.match(String(f.replies.at(-1)?.message), /even percentage/);
  assert.deepEqual(f.closed, []);
});


test('session-end lock settings reach the host before disconnect and reject non-boolean values', async t => {
  const f = fixture(t);
  await f.send({ type: 'lockAfterSessionEnd', enabled: true });
  assert.equal(f.writes[0].misc?.option?.lock_after_session_end, BoolOptionValues.Yes);
  await f.send({ type: 'lockAfterSessionEnd', enabled: false });
  assert.equal(f.writes[1].misc?.option?.lock_after_session_end, BoolOptionValues.No);
  await f.send({ type: 'lockAfterSessionEnd', enabled: 'true' });
  assert.equal(f.writes.length, 2);
  await f.send({ type: 'disconnect' });
  assert.deepEqual(f.closed, [true]);
  assert.equal(f.writes.length, 2, 'disconnect does not race a final synthetic LockScreen key');
});


test('cursor recovery only sends cached bitmaps to clients that negotiated IDs', async t => {
  const f = fixture(t);
  f.state.cursorPublisher = new CursorPublisher(new CursorShapes(), true);
  f.state.cursorPublisher.update({ id: '7', width: 1, height: 1, colors: zstdCompressSync(Buffer.alloc(4)) });
  await f.send({ type: 'cursorRequest', id: '7' });
  assert.equal(f.replies.length, 0);
  f.state.cursorIds = true;
  await f.send({ type: 'cursorRequest', id: '7' });
  assert.equal(f.replies.at(-1)?.type, 'cursorShape');
  assert.equal(f.replies.at(-1)?.id, '7');
  assert.ok(f.replies.at(-1)?.shape);
  await f.send({ type: 'cursorRequest', id: 'unknown' });
  assert.equal(f.replies.at(-1)?.shape, null);
  await f.send({ type: 'cursorRequest', id: 'x'.repeat(129) });
  assert.equal(f.replies.length, 2);
});
