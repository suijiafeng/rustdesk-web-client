// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeviceStore, renameDevice, type SavedDevice } from './devices.ts';
import { connectionSettingsError, DEFAULT_CONNECTION_SETTINGS, validateServerKey } from './serverSettings.ts';

const device: SavedDevice = {
  key: 'id:1',
  mode: 'id',
  peerId: '1',
  hostname: 'office',
  platform: 'Linux',
  favorite: false,
  lastConnectedAt: 1,
};

test('device storage migrates an unversioned list and drops passwords and tokens', () => {
  const legacy = parseDeviceStore([{ ...device, password: 'secret', token: 'tok' }]);
  assert.equal(legacy.length, 1);
  assert.equal('password' in legacy[0], false);
  assert.equal('token' in legacy[0], false);
  const versioned = parseDeviceStore({ version: 1, devices: [device] });
  assert.equal(versioned[0]?.hostname, 'office');
  assert.deepEqual(parseDeviceStore({ version: 2, devices: [device] }), []);
});

test('renaming a device updates its note and server addresses reject credentials', () => {
  const renamed = renameDevice([device], 'id:1', '  Front desk  ');
  assert.equal(renamed[0]?.hostname, 'Front desk');
  assert.equal(connectionSettingsError({ ...DEFAULT_CONNECTION_SETTINGS, idServer: 'https://user:pass@id.example' }), 'Do not put credentials in the server address.');
  assert.equal(connectionSettingsError({ ...DEFAULT_CONNECTION_SETTINGS, relayServer: 'relay.example:21117' }), null);
  assert.equal(validateServerKey('abc'), 'The server public key must be base64.');
  assert.equal(validateServerKey('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='), null);
});
