// Run: node --test --test-timeout=60000 tests/webrtc-csp.browser.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('WebRTC verifies identity and completes login under the production script policy', async () => {
  const result = await runBrowserFixture('tests/fixtures/webrtcCsp.ts');
  assert.equal(result.verified, true);
  assert.equal(result.loggedIn, true);
  assert.deepEqual(result.violations.filter(event => event.blockedURI !== 'wasm-eval'), []);
});
