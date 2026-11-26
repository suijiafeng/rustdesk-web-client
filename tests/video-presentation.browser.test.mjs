import test from 'node:test';
import { runBrowserFixture } from './browserHarness.mjs';

test('video telemetry stays outside the desktop render tree and transformed canvases preserve coordinates', async () => {
  await runBrowserFixture('tests/fixtures/videoPresentation.tsx', { resultName: 'presentationResult' });
});
