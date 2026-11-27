import assert from 'node:assert/strict';
import test from 'node:test';
import { CursorPublisher, type CursorData } from '../shared/cursor.ts';
import {
  buildQualityControlMessage,
  buildResolutionControlMessage,
  dispatchCommonHostMessage,
  handleAudioControl,
  publishResolutions,
  sendPrivacyControl,
  sendRestartControl,
  type HostSessionConnection,
  type HostSessionState,
} from '../shared/hostSession.ts';
import { HostPermission, PrivacyState } from '../shared/peer.ts';
import { decodeMessage } from '../shared/protos.ts';

function createState(overrides: Partial<HostSessionState> = {}): HostSessionState {
  return {
    resolutionDisplay: 0,
    sizes: [{ width: 1920, height: 1080 }],
    sessionCodecs: { vp8: true, vp9: false, h264: true, h265: false, av1: false, reported: true },
    preferredCodec: 'vp8',
    privacyImpl: '',
    audioRequested: false,
    audioAllowed: true,
    audioFormat: null,
    currentSize: { width: 1920, height: 1080 },
    ...overrides,
  };
}

function createConn(overrides: Partial<HostSessionConnection> = {}, sentRaw: Uint8Array[] = []): HostSessionConnection {
  return {
    peerInfo: {
      version: '1.3.0',
      platform: 'Linux',
      features: { privacy_mode: true },
      displays: [{ width: 1920, height: 1080 }],
    },
    encrypted: true,
    route: 'direct',
    privacyAllowed: true,
    clipboardAllowed: true,
    restartAllowed: true,
    audioAllowed: true,
    stream: {
      sendRaw: async (raw: Uint8Array) => {
        sentRaw.push(raw);
      },
      sendQueueBytes: 0,
    },
    ...overrides,
  };
}

function createFakeCursorPublisher() {
  const shapes = {
    decode: (_data: CursorData) => ({ width: 1, height: 1, hotX: 0, hotY: 0, rgba: 'AAAA' }),
    get: () => null,
  };
  return new CursorPublisher(shapes as unknown as ConstructorParameters<typeof CursorPublisher>[0], true);
}

test('publishResolutions updates state and emits resolutions message', () => {
  const state = createState({ sizes: [] });
  const emitted: Record<string, unknown>[] = [];
  publishResolutions(
    state,
    1,
    { resolutions: [{ width: 1280, height: 720 }, { width: 0, height: 100 }] },
    (payload) => emitted.push(payload),
  );
  assert.equal(state.resolutionDisplay, 1);
  assert.deepEqual(state.sizes, [{ width: 1280, height: 720 }]);
  assert.deepEqual(emitted, [{ type: 'resolutions', display: 1, sizes: [{ width: 1280, height: 720 }] }]);
});

test('dispatchCommonHostMessage handles switch_display, peer_info, and close_reason', () => {
  const state = createState();
  const conn = createConn();
  const emitted: Record<string, unknown>[] = [];
  const closedReasons: string[] = [];

  const closed1 = dispatchCommonHostMessage(
    {
      misc: {
        follow_current_display: 2,
        switch_display: {
          display: 1,
          width: 2560,
          height: 1440,
          x: 1920,
          y: 0,
          cursor_embedded: true,
          resolutions: { resolutions: [{ width: 2560, height: 1440 }] },
        },
      },
    },
    conn,
    state,
    {
      sendJson: (p) => emitted.push(p),
      cursorPublisher: createFakeCursorPublisher(),
      onAudioFrame: () => {},
      onCloseReason: (r) => closedReasons.push(r),
    },
  );
  assert.equal(closed1, false);
  assert.deepEqual(state.currentSize, { width: 2560, height: 1440 });
  assert.equal(emitted[0]?.type, 'focusedDisplay');
  assert.equal(emitted[1]?.type, 'display');
  assert.equal(emitted[1]?.width, 2560);
  assert.equal(emitted[2]?.type, 'resolutions');

  const closed2 = dispatchCommonHostMessage(
    { misc: { close_reason: 'peer_closed' } },
    conn,
    state,
    {
      sendJson: (p) => emitted.push(p),
      cursorPublisher: createFakeCursorPublisher(),
      onAudioFrame: () => {},
      onCloseReason: (r) => closedReasons.push(r),
    },
  );
  assert.equal(closed2, true);
  assert.deepEqual(closedReasons, ['peer_closed']);
});

test('dispatchCommonHostMessage handles permissions, privacy, audio, clipboard, and cursor', () => {
  const state = createState({ audioRequested: true, audioAllowed: true });
  const conn = createConn();
  const emitted: Record<string, unknown>[] = [];
  const binaryFrames: Uint8Array[] = [];

  dispatchCommonHostMessage(
    {
      misc: {
        permission_info: { permission: HostPermission.Audio, enabled: false },
        back_notification: { privacy_mode_state: PrivacyState.Enabled, impl_key: 'win_mag' },
      },
    },
    conn,
    state,
    {
      sendJson: (p) => emitted.push(p),
      cursorPublisher: createFakeCursorPublisher(),
      onAudioFrame: (pkt) => binaryFrames.push(pkt),
      onCloseReason: () => {},
    },
  );
  assert.equal(state.audioAllowed, false);
  assert.equal(state.audioRequested, false);
  assert.equal(state.privacyImpl, 'win_mag');
  assert.ok(emitted.some((m) => m.type === 'audioDenied'));
  assert.ok(emitted.some((m) => m.type === 'privacyResult' && m.enabled === true && m.failed === false));

  // Enable audio, set format, send audio frame, clipboard, and cursor position
  state.audioAllowed = true;
  state.audioRequested = true;
  emitted.length = 0;

  dispatchCommonHostMessage(
    {
      misc: { audio_format: { sample_rate: 48000, channels: 2 } },
      audio_frame: { data: new Uint8Array([1, 2, 3, 4]) },
      clipboard: { content: new TextEncoder().encode('hello'), compress: false },
      cursor_position: { x: 120, y: 340 },
    },
    conn,
    state,
    {
      sendJson: (p) => emitted.push(p),
      cursorPublisher: createFakeCursorPublisher(),
      onAudioFrame: (pkt) => binaryFrames.push(pkt),
      onCloseReason: () => {},
    },
  );
  assert.equal(binaryFrames.length, 1);
  assert.ok(emitted.some((m) => m.type === 'audioFormat' && m.sampleRate === 48000));
  assert.ok(emitted.some((m) => m.type === 'clipboard' && m.text === 'hello'));
  assert.ok(emitted.some((m) => m.type === 'cursor' && m.x === 120 && m.y === 340));
});

test('shared control helpers validate and encode privacy, restart, audio, resolution, and quality', async () => {
  const sentRaw: Uint8Array[] = [];
  const conn = createConn({}, sentRaw);
  const state = createState({ privacyImpl: 'impl1' });
  const emitted: Record<string, unknown>[] = [];

  await sendPrivacyControl(conn, state, true, (p) => emitted.push(p));
  assert.equal(sentRaw.length, 1);
  assert.equal(decodeMessage(sentRaw[0]).misc?.toggle_privacy_mode?.on, true);

  await sendRestartControl(conn, (p) => emitted.push(p));
  assert.equal(sentRaw.length, 2);
  assert.deepEqual(emitted.at(-1), { type: 'restartResult', sent: true });

  state.audioAllowed = false;
  assert.equal(handleAudioControl(state, true, (p) => emitted.push(p)), false);
  assert.deepEqual(emitted.at(-1), { type: 'audioDenied' });

  state.audioAllowed = true;
  state.audioFormat = { sampleRate: 48000, channels: 2 };
  assert.equal(handleAudioControl(state, true, (p) => emitted.push(p)), true);
  assert.deepEqual(emitted.at(-1), { type: 'audioFormat', sampleRate: 48000, channels: 2 });

  const badRes = buildResolutionControlMessage(conn, state, 0, 800, 600, (p) => emitted.push(p));
  assert.equal(badRes, null);
  assert.equal(emitted.at(-1)?.type, 'error');

  const goodRes = buildResolutionControlMessage(conn, state, 0, 1920, 1080, (p) => emitted.push(p));
  assert.deepEqual(goodRes, {
    misc: { change_display_resolution: { display: 0, resolution: { width: 1920, height: 1080 } } },
  });

  const qualityBuilt = buildQualityControlMessage(
    state,
    { type: 'quality', quality: 'high', fps: 60, codec: 'h264' },
    (p) => emitted.push(p),
  );
  assert.ok(qualityBuilt);
  assert.equal(qualityBuilt.refreshVideo, true);
  assert.equal(state.preferredCodec, 'h264');
});
