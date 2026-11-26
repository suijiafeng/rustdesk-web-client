import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import test from 'node:test';
import type { WebSocket } from 'ws';
import { decodingPreferenceChanged } from '../shared/control.ts';
import { decodeMessage } from '../shared/protos.ts';
import { EncryptedFramedStream } from './bytesCodec.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { SessionState } from './sessionState.ts';
import {
  AUDIO_QUEUE_LIMIT_BYTES,
  GatewayVideoBuffer,
  VIDEO_QUEUE_LIMIT_BYTES,
  VIDEO_RESUME_BYTES,
} from './videoBuffer.ts';
import { createVideoFrameHandler } from './videoFrames.ts';

const KiB = 1024;

test('gateway skips congested frames and resumes the affected display at a keyframe', () => {
  const buffer = new GatewayVideoBuffer();
  assert.ok(AUDIO_QUEUE_LIMIT_BYTES > VIDEO_QUEUE_LIMIT_BYTES);
  assert.equal(buffer.shouldForward(0, false, 64 * KiB, VIDEO_QUEUE_LIMIT_BYTES - 32 * KiB), false);
  assert.equal(buffer.shouldForward(0, false, 64 * KiB, 0), false);
  assert.equal(buffer.shouldForward(1, false, 64 * KiB, 0), true);
  assert.equal(buffer.shouldForward(0, true, 64 * KiB, VIDEO_RESUME_BYTES + 32 * KiB), false);
  assert.equal(buffer.droppedFrames, 3);
  assert.equal(buffer.shouldForward(0, true, 64 * KiB, 64 * KiB), true);
  assert.equal(buffer.shouldForward(0, false, 64 * KiB, 64 * KiB), true);
  assert.equal(buffer.recovering, false);
  assert.equal(buffer.shouldRequestRefresh(0, 0), false);
});

test('gateway permits one oversized keyframe and limits automatic refreshes', () => {
  const buffer = new GatewayVideoBuffer();
  assert.equal(buffer.shouldForward(0, true, 2048 * KiB, 32 * KiB), false);
  assert.equal(buffer.shouldRequestRefresh(VIDEO_RESUME_BYTES + 32 * KiB, 0), false);
  assert.equal(buffer.shouldRequestRefresh(0, 0), true);
  assert.equal(buffer.shouldRequestRefresh(0, 1500), false);
  assert.equal(buffer.shouldForward(0, false, 32 * KiB, 0), false);
  assert.equal(buffer.shouldRequestRefresh(0, 500), false);
  assert.equal(buffer.shouldRequestRefresh(0, 1000), true);
  assert.equal(buffer.shouldForward(0, true, 2048 * KiB, 0), true);
  assert.equal(buffer.needsRefresh, false);
});

test('video_received ACK is sent when healthy and suppressed when congested or dropping frames', t => {
  const stream = new EncryptedFramedStream(new Socket());
  t.after(() => stream.close());
  const acks: ReturnType<typeof decodeMessage>[] = [];
  t.mock.method(stream, 'sendRaw', async (data: Uint8Array) => { acks.push(decodeMessage(data)); });
  const conn: ConnectedHost = {
    stream, route: 'direct', privacyAllowed: true, clipboardAllowed: true, restartAllowed: true, audioAllowed: true,
    peerInfo: { hostname: 'video-peer' }, username: 'test', encrypted: true,
  };
  const state: SessionState = {
    phase: 'live', hostConn: conn, resolutionDisplay: 0, sizes: [], sessionCodecs: undefined,
    preferredCodec: undefined, privacyImpl: '', audioRequested: false, audioAllowed: true,
    audioFormat: null, currentSize: { width: 1280, height: 720 },
  };
  const ws = { bufferedAmount: 0 };
  const videoBuffer = new GatewayVideoBuffer();
  const binaries: Uint8Array[] = [];
  const handler = createVideoFrameHandler({
    state, ws: ws as WebSocket, videoBuffer,
    sendJson: () => {},
    sendBinary: buf => { binaries.push(buf); ws.bufferedAmount += buf.byteLength; },
    cleanup: () => {},
  });
  t.after(() => handler.dispose());

  // Healthy empty downlink: large keyframe forwards and sends one video_received ACK.
  handler.handleFrame(conn, { display: 0, h264s: { frames: [{ key: true, data: new Uint8Array(200 * KiB) }] } });
  assert.equal(binaries.length, 1);
  assert.equal(acks.length, 1);
  assert.equal(acks[0].misc?.video_received, true);

  // Backed-up downlink (> VIDEO_RESUME_BYTES): frame still forwards under limit, but ACK is suppressed.
  ws.bufferedAmount = VIDEO_RESUME_BYTES + 16 * KiB;
  handler.handleFrame(conn, { display: 0, h264s: { frames: [{ key: false, data: new Uint8Array(16 * KiB) }] } });
  assert.equal(binaries.length, 2);
  assert.equal(acks.length, 1);

  // Congested downlink (> VIDEO_QUEUE_LIMIT_BYTES): frame is dropped and ACK is suppressed.
  ws.bufferedAmount = VIDEO_QUEUE_LIMIT_BYTES;
  handler.handleFrame(conn, { display: 0, h264s: { frames: [{ key: false, data: new Uint8Array(16 * KiB) }] } });
  assert.equal(binaries.length, 2);
  assert.equal(acks.length, 1);
});

test('quality updates only require a refresh when decoder negotiation changes', () => {
  const codecs = { h264: true, h265: false, vp8: true, vp9: true, av1: true, reported: true };
  assert.equal(decodingPreferenceChanged(codecs, 'auto', undefined), false);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'auto'), false);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'h264'), false);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'h265'), false);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'vp9'), true);
  assert.equal(decodingPreferenceChanged(codecs, 'auto', 'av1'), true);
  assert.equal(decodingPreferenceChanged(codecs, 'av1', 'auto'), true);
});
