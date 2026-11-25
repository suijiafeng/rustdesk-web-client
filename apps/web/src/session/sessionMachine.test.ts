// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodecSupport, PeerMessage } from '@rustdesk-web/shared';
import {
  canSendSessionMessage,
  CONNECT_TIMEOUT_MS,
  RESTART_GAP_MS,
  restartReconnectDue,
  buildConnectMessage,
  initialSession,
  isCurrentGeneration,
  nextPrivacyState,
  reduceSession,
  wsUrl,
  type SessionSnapshot,
} from './sessionMachine.ts';

const codecs: CodecSupport = {
  vp8: true,
  vp9: false,
  h264: false,
  h265: false,
  av1: false,
  reported: true,
};

const peer: PeerMessage = {
  type: 'peer',
  hostname: 'office',
  platform: 'Windows',
  username: 'ada',
  version: '1.5.3',
  currentDisplay: 0,
  displays: [],
  encrypted: true,
};

test('wsUrl follows the page protocol and host', () => {
  assert.equal(wsUrl({ protocol: 'http:', host: '127.0.0.1:5173' }), 'ws://127.0.0.1:5173/ws');
  assert.equal(wsUrl({ protocol: 'https:', host: 'desk.example' }), 'wss://desk.example/ws');
});

test('buildConnectMessage matches the gateway connect fields', () => {
  const idMessage = buildConnectMessage({
    mode: 'id',
    peerId: '123456789',
    idServer: 'id.example:21116',
    relayServer: '',
    serverKey: '',
    forceRelay: false,
    host: '',
    port: 21118,
    password: 'secret',
    token: 'gateway',
    codecs,
    quality: 'balanced',
    fps: 30,
    codec: 'auto',
  });
  assert.equal(idMessage.type, 'connect');
  if (idMessage.type !== 'connect') return;
  assert.equal(idMessage.mode, 'id');
  assert.equal(idMessage.peerId, '123456789');
  assert.equal(idMessage.token, 'gateway');
  assert.equal(idMessage.codecs?.vp8, true);

  const direct = buildConnectMessage({
    mode: 'direct',
    peerId: '',
    idServer: '',
    relayServer: '',
    serverKey: '',
    forceRelay: false,
    host: '127.0.0.1',
    port: 21118,
    password: '',
    token: '',
    codecs,
    quality: 'low',
    fps: 15,
    codec: 'vp8',
  });
  if (direct.type !== 'connect') return;
  assert.equal(direct.host, '127.0.0.1');
  assert.equal(direct.port, 21118);
});

test('a new connect drops the previous peer and its permissions', () => {
  const live: SessionSnapshot = { ...initialSession, phase: 'live', peer, authRequired: true };
  const next = reduceSession(live, { type: 'connect-started' });
  assert.equal(next.phase, 'connecting');
  assert.equal(next.peer, null);
  assert.equal(next.authRequired, true);
  assert.equal(next.clearPassword, false);
});

test('status messages move connecting, live, auth failure, and close', () => {
  let state = reduceSession(initialSession, { type: 'connect-started' });
  state = reduceSession(state, { type: 'server', message: { type: 'status', state: 'connecting', detail: 'dialing the host' } });
  assert.equal(state.phase, 'connecting');
  assert.equal(state.detail, 'dialing the host');

  state = reduceSession(state, { type: 'server', message: peer });
  assert.equal(state.peer?.hostname, 'office');
  state = reduceSession(state, { type: 'server', message: { type: 'status', state: 'live', detail: 'encrypted' } });
  assert.equal(state.phase, 'live');
  assert.equal(state.detail, 'encrypted');

  state = reduceSession(state, {
    type: 'server',
    message: { type: 'permissions', privacyAllowed: false, clipboardAllowed: true },
  });
  assert.equal(state.peer?.privacyAllowed, false);
  assert.equal(state.peer?.clipboardAllowed, true);

  const rejected = reduceSession(state, {
    type: 'server',
    message: { type: 'status', state: 'error', detail: 'Wrong password' },
  });
  assert.equal(rejected.phase, 'error');
  assert.equal(rejected.clearPassword, true);
  assert.equal(rejected.peer, null);

  const token = reduceSession(state, {
    type: 'server',
    message: { type: 'status', state: 'error', detail: 'gateway access token is missing' },
  });
  assert.equal(token.authRequired, true);
  assert.equal(token.clearPassword, false);
});

test('timeout and socket loss do not leave a connecting session hanging', () => {
  const connecting = reduceSession(initialSession, { type: 'connect-started' });
  const timedOut = reduceSession(connecting, { type: 'timeout' });
  assert.equal(timedOut.phase, 'error');
  assert.match(timedOut.errorMessage, /timed out/i);
  assert.equal(CONNECT_TIMEOUT_MS, 45_000);

  const closed = reduceSession(connecting, { type: 'socket-close' });
  assert.equal(closed.phase, 'error');
  assert.match(closed.errorMessage, /closed/i);

  const live = reduceSession(connecting, { type: 'server', message: { type: 'status', state: 'live', detail: 'direct' } });
  const dropped = reduceSession(live, { type: 'socket-close' });
  assert.equal(dropped.phase, 'idle');
  assert.equal(dropped.peer, null);
});

test('remote cursor position is relative to the current display and hidden outside it', () => {
  const withDisplay = reduceSession(initialSession, {
    type: 'server',
    message: {
      ...peer,
      displays: [{ index: 0, name: 'right', x: 1920, y: 0, width: 1280, height: 720, online: true }],
    },
  });
  assert.deepEqual(withDisplay.displayOrigin, { x: 1920, y: 0 });
  const moved = reduceSession(withDisplay, { type: 'server', message: { type: 'cursor', x: 1930, y: 15 } });
  assert.deepEqual(moved.cursor, { x: 10, y: 15 });
  const outside = reduceSession(withDisplay, { type: 'server', message: { type: 'cursor', x: 10, y: 15 } });
  assert.equal(outside.cursor, null);
  const shaped = reduceSession(moved, {
    type: 'server',
    message: { type: 'cursorShape', shape: { width: 2, height: 1, hotX: 1, hotY: 0, rgba: 'AQID' } },
  });
  assert.equal(shaped.cursorShape?.hotX, 1);
});

test('hot-plug and display switch keep a valid monitor, including a negative origin', () => {
  const peerWithTwo = reduceSession(initialSession, {
    type: 'server',
    message: {
      ...peer,
      currentDisplay: 1,
      displays: [
        { index: 0, name: 'left', x: -1920, y: 0, width: 1920, height: 1080, online: true },
        { index: 1, name: 'right', x: 0, y: 0, width: 1280, height: 720, online: true },
      ],
    },
  });
  assert.equal(peerWithTwo.currentDisplay, 1);
  assert.deepEqual(peerWithTwo.displayOrigin, { x: 0, y: 0 });
  const switched = reduceSession(peerWithTwo, {
    type: 'server',
    message: { type: 'display', display: 0, width: 1920, height: 1080, x: -1920, y: -8 },
  });
  assert.equal(switched.currentDisplay, 0);
  assert.deepEqual(switched.displayOrigin, { x: -1920, y: -8 });
  const unplugged = reduceSession(switched, {
    type: 'server',
    message: {
      ...peer,
      currentDisplay: 1,
      displays: [{ index: 0, name: 'only', x: 0, y: 0, width: 800, height: 600, online: true }],
    },
  });
  assert.equal(unplugged.currentDisplay, 0);
  const focused = reduceSession(unplugged, { type: 'server', message: { type: 'focusedDisplay', display: 0 } });
  assert.equal(focused.focusedDisplay, 0);
  const sizes = reduceSession(focused, {
    type: 'server',
    message: { type: 'resolutions', display: 0, sizes: [{ width: 800, height: 600 }] },
  });
  assert.equal(sizes.resolutions?.sizes.length, 1);
  const copied = reduceSession(sizes, { type: 'server', message: { type: 'clipboard', text: 'from-host' } });
  assert.equal(copied.clipboardText, 'from-host');
  assert.equal(copied.clipboardSeq, 1);
  const huge = reduceSession(copied, { type: 'server', message: { type: 'clipboard', text: 'x'.repeat(256 * 1024 + 1) } });
  assert.equal(huge.clipboardSeq, 1);
});

test('restart reconnect waits until the host drops and stops at the deadline', () => {
  assert.equal(restartReconnectDue(1_000, 2_000, 'live'), false);
  assert.equal(restartReconnectDue(1_000, 2_000, 'idle'), true);
  assert.equal(restartReconnectDue(2_000, 2_000, 'error'), false);
  assert.equal(RESTART_GAP_MS, 5_000);
});

test('privacy results keep the previous state when the host rejects the change', () => {
  assert.deepEqual(nextPrivacyState({ enabled: false }, { enabled: true, failed: false }), { enabled: true, pending: false, failed: false });
  assert.deepEqual(nextPrivacyState({ enabled: false }, { failed: true }), { enabled: false, pending: false, failed: true });
});

test('disconnect clears the session and a stale generation is ignored', () => {
  const live = reduceSession(
    reduceSession(initialSession, { type: 'connect-started' }),
    { type: 'server', message: { type: 'status', state: 'live', detail: 'direct' } },
  );
  const idle = reduceSession(live, { type: 'disconnect' });
  assert.equal(idle.phase, 'idle');
  assert.equal(idle.peer, null);
  assert.equal(isCurrentGeneration(2, 2), true);
  assert.equal(isCurrentGeneration(3, 2), false);
});


test('remote operations and authentication use their appropriate session phases', () => {
  assert.equal(canSendSessionMessage('connecting', 'auth2fa'), true);
  assert.equal(canSendSessionMessage('live', 'auth2fa'), false);
  assert.equal(canSendSessionMessage('idle', 'auth2fa'), false);
  for (const type of ['chat', 'privacy', 'resolution', 'restart'] as const) {
    assert.equal(canSendSessionMessage('live', type), true);
    assert.equal(canSendSessionMessage('connecting', type), false);
  }
  assert.equal(canSendSessionMessage('live', 'connect'), false);
});
