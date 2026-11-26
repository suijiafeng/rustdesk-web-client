import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('corrupt device credentials and failed legacy migrations do not hide usable passwords', async () => {
  const result = await runBrowserFixture('tests/fixtures/credentialRestore.tsx', { resultName: 'credentialRestoreResult' });
  assert.ok(result.checks >= 25);
});
