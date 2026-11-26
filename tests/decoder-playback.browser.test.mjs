import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('real WebCodecs playback survives close and fresh-keyframe recovery without stale frames', async t => {
  const result = await runBrowserFixture('tests/fixtures/decoderPlayback.ts', { resultName: 'decoderPlaybackResult' });
  t.diagnostic(result.checks.join('; '));
});
