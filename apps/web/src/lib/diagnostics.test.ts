// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptRtt,
  exportDiagnostics,
  formatByteSize,
  framesPerSecond,
  redactDiagnosticText,
  sessionDurationMs,
} from './diagnostics.ts';
import { missingLocaleKeys } from './i18n.ts';

test('session duration, frame rate, and byte size use the measured values', () => {
  assert.equal(sessionDurationMs(1_000, 4_000), 3_000);
  assert.equal(sessionDurationMs(0, 4_000), 0);
  assert.equal(framesPerSecond(30, 1_000), 30);
  assert.equal(framesPerSecond(0, 1_000), 0);
  assert.equal(formatByteSize(512), '512 B');
  assert.equal(formatByteSize(1536), '1.5 KiB');
  assert.equal(acceptRtt(12.4), 12);
  assert.equal(acceptRtt(-1), null);
});

test('an exported diagnostic report removes credentials and both locales have the same keys', () => {
  const report = exportDiagnostics({
    startedAt: 1_000,
    now: 3_000,
    frames: 60,
    bytes: 2048,
    rttMs: 20,
    decodeError: 'password=hunter2 token: abc',
  });
  assert.equal(report.framesPerSecond, 30);
  assert.equal(report.received, '2.0 KiB');
  assert.equal(report.decode, 'password=[redacted] token: [redacted]');
  assert.equal(redactDiagnosticText('token=abc'), 'token=[redacted]');
  assert.deepEqual(missingLocaleKeys(), []);
});
