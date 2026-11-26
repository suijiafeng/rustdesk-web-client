import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidServerPublicKey } from '../../shared/serverKey.ts';

test('accepts a canonical 32-byte public key with surrounding paste whitespace', () => {
  const key = Buffer.alloc(32, 0xfb).toString('base64');
  assert.equal(isValidServerPublicKey(key), true);
  assert.equal(isValidServerPublicKey(` \n${key}\n `), true);
});

test('rejects empty, malformed, noncanonical and incorrectly sized public keys', () => {
  const key = Buffer.alloc(32).toString('base64');
  for (const invalid of [
    '', ' ', 'not a public key', Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'), key.slice(0, -1), `${key}=`,
    `${key.slice(0, 42)}B=`, `${key.slice(0, 20)}\n${key.slice(20)}`,
    Buffer.alloc(32, 0xfb).toString('base64url'),
  ]) assert.equal(isValidServerPublicKey(invalid), false, invalid);
});
