import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSystemLocale,
  resolveEffectiveLocale,
  resolveLocalePreference,
  statusLabel,
  t,
} from './i18n';

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

test('translates core labels and connection status in en and zh', () => {
  assert.equal(t('en', 'displays'), 'Displays');
  assert.equal(t('zh', 'displays'), '显示器');
  assert.equal(t('en', 'languageDefault'), 'Default');
  assert.equal(t('zh', 'languageDefault'), '默认');
  assert.equal(statusLabel('en', 'live'), 'live');
  assert.equal(statusLabel('zh', 'live'), '已连接');
});
