// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptKeyMessages,
  classifyBrowser,
  classifyLocalOs,
  classifyRemoteOs,
  clipboardDelivery,
  keyboardLockAvailable,
  mapOutgoingControl,
  primaryShortcutModifier,
  reconnectDelayMs,
  remoteFeatures,
  resolutionAllowed,
  twoFactorStatus,
  validateChatText,
  validateClipboardText,
} from './platform.ts';

const REMOTES = ['windows', 'macos', 'linux', 'android', 'ios', 'other'] as const;

test('remote platform names from PeerInfo select one OS', () => {
  assert.equal(classifyRemoteOs('Windows'), 'windows');
  assert.equal(classifyRemoteOs('Mac OS'), 'macos');
  assert.equal(classifyRemoteOs('macOS'), 'macos');
  assert.equal(classifyRemoteOs('Linux'), 'linux');
  assert.equal(classifyRemoteOs('Ubuntu'), 'linux');
  assert.equal(classifyRemoteOs('Android'), 'android');
  assert.equal(classifyRemoteOs('iOS'), 'ios');
  assert.equal(classifyRemoteOs(''), 'other');
});

test('session features follow the remote operating system', () => {
  const matrix = Object.fromEntries(REMOTES.map((os) => [os, remoteFeatures(os)]));
  assert.equal(matrix.windows.ctrlAltDel, true);
  assert.equal(matrix.macos.ctrlAltDel, false);
  assert.equal(matrix.linux.ctrlAltDel, false);
  assert.equal(matrix.windows.privacyMode, true);
  assert.equal(matrix.windows.blockInput, true);
  assert.equal(matrix.linux.privacyMode, false);
  assert.equal(matrix.macos.lockScreen, true);
  assert.equal(matrix.android.lockScreen, false);
  assert.equal(matrix.ios.restart, false);
  assert.equal(matrix.linux.resolutionChange, true);
  assert.equal(matrix.macos.resolutionChange, false);
  assert.equal(matrix.windows.restart, true);
});

test('local OS and browser detection covers desktop and mobile clients', () => {
  assert.equal(classifyLocalOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel'), 'macos');
  assert.equal(classifyLocalOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32'), 'windows');
  assert.equal(classifyLocalOs('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'), 'linux');
  assert.equal(classifyLocalOs('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l'), 'android');
  assert.equal(classifyLocalOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone'), 'ios');
  assert.equal(classifyBrowser('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36'), 'chromium');
  assert.equal(classifyBrowser('Mozilla/5.0 Edg/120.0.0.0'), 'chromium');
  assert.equal(classifyBrowser('Mozilla/5.0 Firefox/121.0'), 'firefox');
  assert.equal(classifyBrowser('Mozilla/5.0 Version/17.0 Safari/605.1.15'), 'safari');
});

test('Cmd on a Mac becomes Ctrl for Windows and Linux remotes, and Ctrl becomes Cmd for a Mac remote', () => {
  assert.equal(mapOutgoingControl('Meta', 'macos', 'windows'), 'Control');
  assert.equal(mapOutgoingControl('Meta', 'macos', 'linux'), 'Control');
  assert.equal(mapOutgoingControl('Control', 'windows', 'macos'), 'Meta');
  assert.equal(mapOutgoingControl('Meta', 'macos', 'macos'), 'Meta');
  assert.equal(mapOutgoingControl('Shift', 'macos', 'windows'), 'Shift');
  assert.equal(primaryShortcutModifier('macos'), 'Meta');
  assert.equal(primaryShortcutModifier('windows'), 'Control');
  assert.deepEqual(
    adaptKeyMessages([{ type: 'key', action: 'down', control: 'Meta', modifiers: ['Meta'] }], 'macos', 'windows'),
    [{ type: 'key', action: 'down', control: 'Control', modifiers: ['Control'] }],
  );
});

test('clipboard, keyboard lock, reconnect, chat, and 2FA follow browser and size limits', () => {
  assert.equal(validateClipboardText('hi', false, true), 'ok');
  assert.equal(validateClipboardText('hi', true, true), 'disabled');
  assert.equal(validateClipboardText('hi', false, false), 'denied');
  assert.equal(validateClipboardText('', false, true), 'empty');
  assert.equal(validateClipboardText('x'.repeat(256 * 1024 + 1), false, true), 'too-large');
  assert.equal(clipboardDelivery('safari', true, false), 'panel');
  assert.equal(clipboardDelivery('safari', true, true), 'write');
  assert.equal(clipboardDelivery('firefox', false, true), 'unavailable');
  assert.equal(clipboardDelivery('chromium', true, false), 'write');
  assert.equal(keyboardLockAvailable('chromium', true), true);
  assert.equal(keyboardLockAvailable('firefox', true), false);
  assert.equal(keyboardLockAvailable('safari', true), false);
  assert.equal(keyboardLockAvailable('chromium', false), false);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(reconnectDelayMs), [1000, 2000, 4000, 8000, 16000, null]);
  assert.equal(validateChatText('  hello '), 'ok');
  assert.equal(validateChatText('   '), 'empty');
  assert.equal(validateChatText('x'.repeat(4097)), 'too-large');
  assert.equal(twoFactorStatus(0, 0), 'ok');
  assert.equal(twoFactorStatus(3, 0), 'exhausted');
  assert.equal(twoFactorStatus(1, 60_000), 'expired');
  assert.equal(resolutionAllowed('windows', [{ width: 800, height: 600 }], 0, 0), true);
  assert.equal(resolutionAllowed('macos', [{ width: 800, height: 600 }], 0, 0), false);
  assert.equal(resolutionAllowed('linux', [], 0, 0), false);
});
