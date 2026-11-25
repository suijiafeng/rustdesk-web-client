// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { dropdownPosition } from './dropdownPosition.ts';

test('dropdown opens above a bottom anchor and constrains long lists to the visible area', () => {
  const bounds = { left: 8, top: 16, right: 350, bottom: 250 };
  const anchor = { left: 260, top: 204, right: 365, bottom: 233 };
  const result = dropdownPosition(anchor, bounds, 180, 360);
  assert.deepEqual(result, { side: 'top', left: 170, top: 16, width: 180, maxHeight: 182 });
});

test('dropdown stays inside a narrow viewport and opens below when space is available', () => {
  const bounds = { left: 8, top: 8, right: 140, bottom: 250 };
  const anchor = { left: 10, top: 20, right: 120, bottom: 44 };
  assert.deepEqual(dropdownPosition(anchor, bounds, 180, 120),
    { side: 'bottom', left: 8, top: 50, width: 132, maxHeight: 120 });
});
