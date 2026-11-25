// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSystemLocale,
  nextLocale,
  resolveEffectiveLocale,
  resolveInitialLocale,
  resolveLocalePreference,
  missingLocaleKeys,
  resolveStartupLocale,
  statusLabel,
  t,
  translateAudioIssue,
} from './i18n';

test('resolveInitialLocale defaults to en and restores saved zh/en values', () => {
  assert.equal(resolveInitialLocale(null), 'en');
  assert.equal(resolveInitialLocale(''), 'en');
  assert.equal(resolveInitialLocale('fr'), 'en');
  assert.equal(resolveInitialLocale('zh'), 'zh');
  assert.equal(resolveInitialLocale('en'), 'en');
});

test('resolveLocalePreference defaults to default and resolves system language accurately', () => {
  assert.equal(resolveLocalePreference(null), 'default');
  assert.equal(resolveLocalePreference(''), 'default');
  assert.equal(resolveLocalePreference('default'), 'default');
  assert.equal(resolveLocalePreference('zh'), 'zh');
  assert.equal(resolveLocalePreference('en'), 'en');

  assert.equal(detectSystemLocale('zh-CN'), 'zh');
  assert.equal(detectSystemLocale('zh-TW'), 'zh');
  assert.equal(detectSystemLocale('en-US'), 'en');
  assert.equal(detectSystemLocale(null), 'en');

  assert.equal(resolveEffectiveLocale('default', 'zh-CN'), 'zh');
  assert.equal(resolveEffectiveLocale('default', 'en-GB'), 'en');
  assert.equal(resolveEffectiveLocale('en', 'zh-CN'), 'en');
  assert.equal(resolveEffectiveLocale('zh', 'en-US'), 'zh');
});

test('startup locale uses the saved setting, otherwise the browser language list', () => {
  assert.deepEqual(resolveStartupLocale('zh', ['en-US']), { preference: 'zh', locale: 'zh' });
  assert.deepEqual(resolveStartupLocale('en', ['zh-CN']), { preference: 'en', locale: 'en' });
  assert.deepEqual(resolveStartupLocale(null, ['zh-CN', 'en-US']), { preference: 'default', locale: 'zh' });
  assert.deepEqual(resolveStartupLocale('default', ['en-US', 'zh-CN']), { preference: 'default', locale: 'en' });
  assert.deepEqual(resolveStartupLocale(null, null), { preference: 'default', locale: 'en' });
});

test('session controls have both English and Chinese labels', () => {
  const keys = [
    'displayFallback',
    'sessionQuality',
    'qualityLow',
    'qualityBalanced',
    'qualityBest',
    'sessionVolume',
    'sessionFullscreen',
    'disconnect',
    'menuLabel',
    'viewOnlyLabel',
    'sessionControl',
    'audioOn',
    'audioOff',
    'audioGesture',
    'privacyUnavailable',
    'keyboard',
    'lockScreen',
    'ctrlAltDel',
    'touch',
    'mouse',
    'screens',
    'dockGuide',
    'moreActions',
    'dockHideControls',
    'openSessionMenu',
    'touchModeGestures',
    'mouseModeGestures',
    'renameDevice',
    'removeDevice',
    'arrowLeft',
    'pageUp',
    'keyHome',
    'diagCopy',
    'diagDuration',
  ] as const;
  assert.deepEqual(missingLocaleKeys(), []);
  for (const key of keys) {
    assert.ok(t('en', key).trim().length > 0, key);
    assert.ok(t('zh', key).trim().length > 0, key);
    assert.notEqual(t('en', key), t('zh', key), key);
  }
  assert.equal(translateAudioIssue('zh', 'The host refused audio.'), t('zh', 'audioDenied'));
  assert.equal(translateAudioIssue('en', 'custom'), 'custom');
});

test('nextLocale toggles cleanly between en and zh and translates core labels', () => {
  assert.equal(nextLocale('en'), 'zh');
  assert.equal(nextLocale('zh'), 'en');
  assert.equal(t('en', 'displays'), 'Displays');
  assert.equal(t('zh', 'displays'), '显示器');
  assert.equal(t('en', 'languageDefault'), 'Default');
  assert.equal(t('zh', 'languageDefault'), '默认');
  assert.equal(statusLabel('en', 'live'), 'live');
  assert.equal(statusLabel('zh', 'live'), '已连接');
});
