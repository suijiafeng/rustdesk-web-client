// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { BoolOptionValues } from '@rustdesk-web/protocol';
import {
  MOUSE_BUTTON_LEFT,
  MOUSE_TYPE_DOWN,
  MOUSE_TYPE_WHEEL,
  buildLoginOptions,
  packMouseMask,
  toHostMessage,
} from './index.ts';

test('mouse mask packing matches the RustDesk bit layout', () => {
  assert.equal(packMouseMask('down', 'left'), (MOUSE_BUTTON_LEFT << 3) | MOUSE_TYPE_DOWN);
  assert.equal(packMouseMask('up', 'right'), (0x02 << 3) | 2);
  assert.equal(packMouseMask('down', 'middle'), (0x04 << 3) | MOUSE_TYPE_DOWN);
  assert.equal(packMouseMask('wheel', 'right'), MOUSE_TYPE_WHEEL);
  assert.equal(packMouseMask('move'), 0);

  const wheel = toHostMessage({ type: 'mouse', action: 'wheel', x: 2, y: -1 });
  const event = wheel?.mouse_event as { mask: number; x: number; y: number };
  assert.equal(event.mask, MOUSE_TYPE_WHEEL);
  assert.equal(event.x, 2);
  assert.equal(event.y, -1);
});

test('login asks the host to send remote cursor updates', () => {
  const options = buildLoginOptions({
    vp8: true,
    vp9: false,
    h264: false,
    h265: false,
    av1: false,
    reported: true,
  });
  assert.equal(options.show_remote_cursor, BoolOptionValues.Yes);
});
