import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('history connects immediately with matching saved credentials and prompts only when required', async () => {
  const result = await runBrowserFixture('tests/fixtures/historyConnection.tsx', { resultName: 'historyConnectionResult' });
  assert.ok(result.checks >= 23);
});
