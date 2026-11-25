// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { DisplayInfo } from '@rustdesk-web/shared';
import {
  chooseDisplay,
  offsetPointerMessages,
  qualityCommand,
  remotePrivacyAllowed,
  sessionEndLock,
  shouldFollowFocusedDisplay,
} from './displays.ts';

const left: DisplayInfo = { index: 0, name: 'left', x: -1920, y: -32, width: 1920, height: 1080, online: true };
const right: DisplayInfo = { index: 1, name: 'right', x: 0, y: 0, width: 1280, height: 720, online: true };

test('display selection keeps negative origins and falls back when a monitor is unplugged', () => {
  assert.deepEqual(chooseDisplay([left, right], 0).origin, { x: -1920, y: -32 });
  assert.equal(chooseDisplay([left, right], 1).display?.name, 'right');
  assert.equal(chooseDisplay([right], 1).index, 0);
  assert.equal(chooseDisplay([], 3).display, null);
});

test('pointer coordinates include the display origin and wheel ticks do not', () => {
  const moved = offsetPointerMessages(
    [
      { type: 'mouse', action: 'move', x: 10, y: 4 },
      { type: 'mouse', action: 'wheel', x: 1, y: -2 },
    ],
    { x: -1920, y: -32 },
  );
  assert.equal(moved[0]?.type === 'mouse' ? moved[0].x : 0, -1910);
  assert.equal(moved[0]?.type === 'mouse' ? moved[0].y : 0, -28);
  assert.equal(moved[1]?.type === 'mouse' ? moved[1].y : 0, -2);
});

test('session lock is sent only for a live explicit disconnect, and quality stays on supported levels', () => {
  assert.equal(sessionEndLock(true, false).length, 0);
  assert.equal(sessionEndLock(false, true).length, 0);
  const lock = sessionEndLock(true, true);
  assert.equal(lock[0]?.type === 'key' ? lock[0].control : '', 'LockScreen');
  assert.equal(lock[1]?.type === 'key' ? lock[1].action : '', 'up');
  assert.deepEqual(qualityCommand('balanced', 30), { type: 'quality', quality: 'balanced', fps: 30 });
});

test('follow-window ignores offline displays, and revoked privacy is not treated as allowed', () => {
  assert.equal(shouldFollowFocusedDisplay(true, 1, 0, [left, right]), true);
  assert.equal(shouldFollowFocusedDisplay(true, 1, 1, [left, right]), false);
  assert.equal(shouldFollowFocusedDisplay(false, 1, 0, [left, right]), false);
  assert.equal(shouldFollowFocusedDisplay(true, 1, 0, [left, { ...right, online: false }]), false);
  assert.equal(remotePrivacyAllowed({ privacyAllowed: false }), false);
  assert.equal(remotePrivacyAllowed({ privacyAllowed: true }), true);
  assert.equal(remotePrivacyAllowed(null), false);
});
