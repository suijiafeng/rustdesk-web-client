import assert from 'node:assert/strict';
import test from 'node:test';
import { remoteKeyboardProfile } from './keys';

test('remote macOS uses Command for shortcuts and offers Option instead of Alt', () => {
  for (const platform of ['Mac OS', 'macOS', ' Mac OS X ', 'Darwin']) {
    assert.deepEqual(remoteKeyboardProfile(platform), {
      altLabel: 'Option',
      metaLabel: 'Command',
      shortcutModifier: 'Meta',
      showCtrlAltDel: false,
    });
  }
});

test('remote Windows uses Control for shortcuts and offers Ctrl+Alt+Del', () => {
  assert.deepEqual(remoteKeyboardProfile('Windows'), {
    altLabel: 'Alt',
    metaLabel: 'Win',
    shortcutModifier: 'Control',
    showCtrlAltDel: true,
  });
  assert.equal(remoteKeyboardProfile().showCtrlAltDel, false);
  assert.equal(remoteKeyboardProfile('Linux').metaLabel, 'Super');
});
