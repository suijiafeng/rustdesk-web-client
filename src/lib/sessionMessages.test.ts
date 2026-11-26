import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dispatch, SetStateAction } from 'react';
import type { SessionStats } from '../components/SessionMenu';
import { createDiagnosticsState, recordPingSent } from './diagnostics';
import { normalizeDisplayPrefs } from './displayPrefs';
import type { PeerMessage, ServerMessage } from './protocol';
import { createSessionMessageHandler, type SessionMessageContext } from './sessionMessages';

function cell<T>(initial: T) {
  let value = initial;
  const set: Dispatch<SetStateAction<T>> = next => { value = typeof next === 'function' ? (next as (previous: T) => T)(value) : next; };
  return { get value() { return value; }, set };
}
const initialStats: SessionStats = {
  codec: '—', width: 0, height: 0, fps: 0, rxFps: 0, renderFps: 0, decodeQueueSize: 0,
  delayMs: 0, bitrate: 0, decoded: 0, dropped: 0, streamState: 'waiting',
};
const peer: PeerMessage = {
  type: 'peer', hostname: 'Example', platform: 'Linux', username: 'user', version: '1.5.3',
  currentDisplay: 0, encrypted: true,
  displays: [
    { index: 0, name: 'first', x: 100, y: 200, width: 800, height: 600, online: true },
    { index: 1, name: 'second', x: 900, y: 200, width: 640, height: 480, online: true },
    { index: 2, name: 'offline', x: 0, y: 0, width: 1, height: 1, online: false },
  ],
};
function fixture() {
  const events: Array<[string, ...unknown[]]> = [];
  const effect = (name: string) => (...args: unknown[]) => { events.push([name, ...args]); };
  const phase = cell<'idle' | 'connecting' | 'live' | 'error'>('connecting');
  const remotePeer = cell<PeerMessage | null>(null);
  const stats = cell(initialStats);
  const devices = cell<import('./devices').SavedDevice[]>([]);
  const cursorShape = cell<{ pixels: ImageData; hotX: number; hotY: number } | null>(null);
  const context: SessionMessageContext = {
    locale: 'en', peerId: '123 456 789', idServer: ' id.example ', relayServer: '', serverKey: '', forceRelay: false,
    host: ' host.example ', port: '', reconnectRequest: { current: null }, phaseRef: { current: 'connecting' },
    sizeRef: { current: { width: 1280, height: 720 } }, displayPrefsRef: { current: normalizeDisplayPrefs({ followWindow: true }) },
    cursorElRef: { current: { style: { visibility: '' } } as HTMLDivElement }, audioRef: { current: {
      configure: effect('audioFormat'), push: effect('audioFrame'),
    } }, diagStateRef: { current: createDiagnosticsState() },
    setWebRtcFallbackReason: effect('fallback'), setRestartState: effect('restart'), setGatewayTokenRejected: effect('tokenRejected'),
    setTemporaryGatewayToken: effect('token'), setPhase: phase.set, setConnectDialog: effect('dialog'), setMenuOpen: effect('menu'),
    setAuthRequired: effect('authRequired'), setPeer: remotePeer.set, setDisplay: effect('display'),
    setCursorEmbedded: effect('embedded'), setStats: stats.set, setDevices: devices.set,
    setPrivacyPending: effect('privacyPending'), setPrivacyEnabled: effect('privacy'), setDecoderError: effect('decoderError'),
    setMobilePanel: effect('mobilePanel'), setViewMode: effect('viewMode'), setZoom: effect('zoom'), setPan: effect('pan'),
    setResolutionOptions: effect('resolutions'), setCursorShape: cursorShape.set, setRtt: effect('rtt'),
    setGatewayVideo: effect('gatewayVideo'), setDiagSummary: effect('diagnostics'), setStatusDetail: effect('detail'),
    rememberDevicePassword: effect('remember'), handleClearSavedPassword: effect('clearPassword'), focusDesktopCapture: effect('focus'),
    placeCursor: effect('cursor'), showSessionTip: effect('tip'), stopAudio: effect('stopAudio'), send: effect('send'),
    clipboard: { receive: effect('clipboard') }, onTerminalError: effect('terminal'),
    connection: {
      activeMode: 'id', targetPeerId: '123456789', targetIdServer: 'id.example', targetRelayServer: '', targetServerKey: '',
      targetForceRelay: false, targetHost: '', targetPortStr: '21118', targetPassword: 'test-password',
      shouldRemember: true, targetGatewayToken: 'test-token', targetDeviceKey: 'id:123456789', req: { gatewayToken: 'test-token' },
    },
  };
  return { context, events, phase, remotePeer, stats, devices, cursorShape, handle: createSessionMessageHandler(context) };
}

test('live status retains reconnect credentials, saves requested password and clears gateway rejection', () => {
  const f = fixture();
  f.handle({ type: 'status', state: 'live', detail: 'encrypted' });
  assert.equal(f.phase.value, 'live');
  assert.equal(f.context.phaseRef.current, 'live');
  assert.equal(f.context.reconnectRequest.current?.peerId, '123456789');
  assert.equal(f.context.reconnectRequest.current?.gatewayToken, 'test-token');
  assert.ok(f.events.some(event => event[0] === 'remember' && event[1] === 'id:123456789'));
  assert.ok(f.events.some(event => event[0] === 'tokenRejected' && event[1] === false));
  assert.ok(f.events.some(event => event[0] === 'detail' && event[1] === 'detailEncryptedSession'));
});

test('authentication errors preserve terminal status, clear stale passwords and request tokens', () => {
  for (const detail of ['Wrong Password', 'gateway token required']) {
    const f = fixture();
    f.handle({ type: 'status', state: 'error', detail });
    assert.equal(f.phase.value, 'error');
    assert.equal(f.context.phaseRef.current, 'error');
    assert.ok(f.events.some(event => event[0] === 'terminal'));
    assert.ok(f.events.some(event => event[0] === 'dialog' && event[1] === true));
    assert.ok(f.events.some(event => event[0] === (detail.includes('token') ? 'authRequired' : 'clearPassword')));
  }
});

test('peer and display messages preserve per-session cursor origins, dimensions and device history', () => {
  const f = fixture();
  f.handle(peer);
  assert.deepEqual(f.context.sizeRef.current, { width: 800, height: 600 });
  assert.equal(f.devices.value[0].peerId, '123456789');
  f.events.length = 0;
  f.handle({ type: 'cursor', x: 130, y: 240 });
  assert.deepEqual(f.events, [['cursor', 30, 40]]);
  f.handle({ type: 'display', display: 1, x: 900, y: 200, width: 640, height: 480, cursorEmbedded: true });
  f.handle({ type: 'cursor', x: 940, y: 250 });
  assert.deepEqual(f.events.at(-1), ['cursor', 40, 50]);
  assert.equal(f.stats.value.width, 640);
  assert.ok(f.events.some(event => event[0] === 'viewMode' && event[1] === 'fit'));
  f.handle({ type: 'cursor', x: 10, y: 10 });
  assert.equal(f.context.cursorElRef.current?.style.visibility, 'hidden');
  const other = fixture();
  other.handle({ type: 'cursor', x: 30, y: 40 });
  assert.deepEqual(other.events, [['cursor', 30, 40]]);
});

test('focused display follows only a different online display while enabled', () => {
  const f = fixture(); f.handle(peer); f.events.length = 0;
  for (const display of [0, 2, 99, 1]) f.handle({ type: 'focusedDisplay', display });
  assert.deepEqual(f.events, [['send', { type: 'switchDisplay', display: 1 }]]);
  f.context.displayPrefsRef.current.followWindow = false;
  f.handle({ type: 'focusedDisplay', display: 1 });
  assert.equal(f.events.length, 1);
});

test('permissions, privacy and restart results preserve existing controls and feedback', () => {
  const f = fixture(); f.handle(peer);
  f.handle({ type: 'permissions', privacyAllowed: false, clipboardAllowed: false });
  assert.equal(f.remotePeer.value?.privacyAllowed, false);
  f.handle({ type: 'restartPermission', allowed: false });
  assert.equal(f.remotePeer.value?.restartAllowed, false);
  f.handle({ type: 'privacyResult', enabled: true, failed: false });
  assert.ok(f.events.some(event => event[0] === 'privacy' && event[1] === true));
  f.handle({ type: 'restartResult', sent: false });
  assert.ok(f.events.some(event => event[0] === 'mobilePanel' && event[1] === 'actions'));
  assert.ok(f.events.some(event => event[0] === 'menu' && event[1] === true));
});

test('audio, clipboard and resolution messages reach their effects with existing preference guards', () => {
  const f = fixture();
  f.handle({ type: 'audioFormat', sampleRate: 48000, channels: 2 });
  f.handle({ type: 'audioFrame', packet: 'packet' });
  f.handle({ type: 'audioDenied' });
  assert.deepEqual(f.events.slice(0, 3), [['audioFormat', 48000, 2], ['audioFrame', 'packet'], ['stopAudio']]);
  f.handle({ type: 'clipboard', text: 'first' });
  f.context.displayPrefsRef.current.disableClipboard = true;
  f.handle({ type: 'clipboard', text: 'ignored' });
  assert.deepEqual(f.events.filter(event => event[0] === 'clipboard'), [['clipboard', 'first']]);
  const resolution: ServerMessage = { type: 'resolutions', display: 1, sizes: [{ width: 800, height: 600 }] };
  f.handle(resolution);
  assert.deepEqual(f.events.at(-1), ['resolutions', resolution]);
});

test('pong updates gateway metrics and diagnostic samples, while fallback remains visible', () => {
  const f = fixture();
  f.context.diagStateRef.current = recordPingSent(createDiagnosticsState(), 1, performance.now() - 10);
  const gatewayVideo = { queuedBytes: 42, droppedFrames: 1, recovering: true };
  f.handle({ type: 'pong', seq: 1, clientTs: 0, serverTs: 0, gatewayVideo });
  assert.deepEqual(f.events[0], ['gatewayVideo', gatewayVideo]);
  assert.equal(f.events[1][0], 'diagnostics');
  f.handle({ type: 'rtt', ms: 15 });
  assert.deepEqual(f.events.at(-1), ['rtt', 15]);
  f.handle({ type: 'webrtcFallback', reason: 'signaling timeout' });
  assert.deepEqual(f.events.at(-1), ['fallback', 'signaling timeout']);
});

test('generic errors are terminal while connecting and leave a live session active', () => {
  const f = fixture();
  f.handle({ type: 'error', message: 'Wrong Password' });
  assert.equal(f.phase.value, 'error');
  assert.ok(f.events.some(event => event[0] === 'terminal'));
  const live = fixture(); live.context.phaseRef.current = 'live';
  live.handle({ type: 'error', message: 'temporary problem' });
  assert.equal(live.context.phaseRef.current, 'live');
  assert.equal(live.events.some(event => event[0] === 'terminal'), false);
});

test('invalid cursor shapes clear the cursor and unknown message types are ignored', () => {
  const f = fixture();
  f.handle({ type: 'cursorShape', shape: { width: 1, height: 1, hotX: 0, hotY: 0, rgba: '@@@' } });
  assert.equal(f.cursorShape.value, null);
  for (const type of ['hello', 'unknown', 'constructor', '__proto__']) f.handle({ type } as ServerMessage);
  assert.deepEqual(f.events, []);
});
