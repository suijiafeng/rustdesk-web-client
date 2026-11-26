// Run: node --test --test-timeout=60000 tests/audio-playback.browser.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('real Opus decoding and AudioWorklet stereo playback survive reconfiguration under strict CSP', async t => {
  const result = await runBrowserFixture('tests/fixtures/audioPlayback.ts', {
    resultName: 'audioResult', timeoutMs: 30000,
    chromeArgs: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  assert.equal(result.outputRate, 44100);
  assert.ok(result.stereoSamples >= 5, JSON.stringify(result));
  assert.ok(result.resumedSamples >= 5, JSON.stringify(result));
  assert.ok(result.monoSamples >= 5, JSON.stringify(result));
  assert.equal(result.workletNodes, 1);
  assert.equal(result.errors, 0);
  assert.equal(result.closed, true);
  assert.deepEqual(result.violations, []);
  t.diagnostic(`44.1kHz output: ${result.stereoSamples} stereo, ${result.resumedSamples} resumed and ${result.monoSamples} mono measurements; one persistent worklet; zero CSP violations`);
});
