// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_AUDIO_QUEUE,
  clampVolume,
  decodeAudioPacket,
  shouldEnqueueAudio,
  webAudioStatus,
} from './remoteAudio.ts';

test('Opus playback requires WebAudio and a bounded decode queue', () => {
  const status = webAudioStatus();
  assert.equal(typeof status.ok, 'boolean');
  if (!status.ok) assert.match(status.reason, /Opus/);
  assert.equal(shouldEnqueueAudio(0), true);
  assert.equal(shouldEnqueueAudio(MAX_AUDIO_QUEUE), true);
  assert.equal(shouldEnqueueAudio(MAX_AUDIO_QUEUE + 1), false);
});

test('volume stays inside 0..1 and audio packets are raw base64', () => {
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(Number.NaN), 1);
  assert.deepEqual(decodeAudioPacket(btoa('opus')), Uint8Array.from([111, 112, 117, 115]));
  assert.equal(decodeAudioPacket('@@@'), null);
  assert.equal(decodeAudioPacket(''), null);
});
