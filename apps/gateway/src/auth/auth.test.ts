// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DIRECT_PORT,
  RELAY_PORT,
  RENDEZVOUS_PORT,
  checkPort,
  directUsername,
  isValidRelayUuid,
  passwordResponse,
  sanitizeHostInput,
  tokenMatches,
} from './index.ts';

test('passwordResponse matches the RustDesk host formula test vector', () => {
  const actual = passwordResponse('pw', 'salt', 'b').toString('hex');
  assert.equal(actual, '803235e4d1ed7843e834f5e27655ea12b7ab5c194226dd10e6aebcc9d3dc5ec1');
});

test('directUsername keeps IPv4 with port and formats bare IPv4 and IPv6', async () => {
  assert.equal(await directUsername('127.0.0.1:21118', 21118), '127.0.0.1:21118');
  assert.equal(await directUsername('127.0.0.1', 21118), '127.0.0.1:21118');
  assert.equal(await directUsername('::1', 21118), '[::1]:21118');
});

test('direct port constants match the RustDesk host listener', () => {
  assert.equal(DEFAULT_DIRECT_PORT, 21118);
  assert.equal(DEFAULT_DIRECT_PORT, RELAY_PORT + 1);
  assert.equal(DEFAULT_DIRECT_PORT, RENDEZVOUS_PORT + 2);
});

test('sanitizeHostInput and checkPort normalize pasted URLs and fullwidth colons', () => {
  assert.equal(sanitizeHostInput('  https://rs.example.com:21116/path?a=1  '), 'rs.example.com:21116');
  assert.equal(sanitizeHostInput('http://hbbs.example.com/'), 'hbbs.example.com');
  assert.equal(sanitizeHostInput('rs.example.com：31116'), 'rs.example.com:31116');
  assert.deepEqual(checkPort('https://rs.example.com/', 21116), { host: 'rs.example.com', port: 21116 });
  assert.deepEqual(checkPort('rs.example.com：31116', 21116), { host: 'rs.example.com', port: 31116 });
  assert.deepEqual(checkPort('[2001:db8::1]:21117', 21116), { host: '2001:db8::1', port: 21117 });
});

test('gateway token check is optional and constant-time exact', () => {
  assert.equal(tokenMatches('', ''), true);
  assert.equal(tokenMatches('   ', 'anything'), true);
  assert.equal(tokenMatches('secret-token', 'secret-token'), true);
  assert.equal(tokenMatches(' secret-token ', 'secret-token '), true);
  assert.equal(tokenMatches('secret-token', 'wrong-token'), false);
  assert.equal(tokenMatches('secret-token', ''), false);
});

test('relay UUID validator enforces the allowed charset and max length', () => {
  assert.equal(isValidRelayUuid('abc_123-XYZ'), true);
  assert.equal(isValidRelayUuid(''), false);
  assert.equal(isValidRelayUuid('bad/uuid'), false);
  assert.equal(isValidRelayUuid('a'.repeat(129)), false);
});
