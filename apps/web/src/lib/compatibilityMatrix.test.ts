// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPATIBILITY_MATRIX, untestedRows } from './compatibilityMatrix.ts';

test('the compatibility matrix keeps every real-device pair untested until evidence exists', () => {
  assert.equal(COMPATIBILITY_MATRIX.length, 8);
  assert.deepEqual(untestedRows(COMPATIBILITY_MATRIX), []);
  for (const row of COMPATIBILITY_MATRIX) {
    assert.equal(row.status, 'untested');
    assert.equal(row.evidence, '');
    assert.ok(row.controller.length > 0);
    assert.ok(row.controlled.length > 0);
  }
});
