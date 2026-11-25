// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { BoolOptionValues } from '@rustdesk-web/protocol';
import { toHostMessage } from './index.ts';

test('audio enable and disable map to the host disable_audio option', () => {
  const enabled = toHostMessage({ type: 'audio', enabled: true });
  const on = enabled?.misc as { option: { disable_audio: number } };
  assert.equal(on.option.disable_audio, BoolOptionValues.No);
  const disabled = toHostMessage({ type: 'audio', enabled: false });
  const off = disabled?.misc as { option: { disable_audio: number } };
  assert.equal(off.option.disable_audio, BoolOptionValues.Yes);
  assert.equal(toHostMessage({ type: 'audio', enabled: undefined as unknown as boolean }), null);
});
