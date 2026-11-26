import { t } from '../../lib/i18n';
import type { ThemePreference } from '../../lib/theme';
import { AdaptiveSelect } from '../AdaptiveSelect';
import type { SettingsViewProps } from './types';

const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; key: 'themeLight' | 'themeDark' | 'themeSystem' }> = [
  { id: 'light', key: 'themeLight' },
  { id: 'dark', key: 'themeDark' },
  { id: 'system', key: 'themeSystem' },
];

export function GeneralSettings({
  locale,
  localePreference,
  theme,
  diagnosticsOpen,
  touchMode,
  onChangeTheme,
  onChangeLocale,
  onToggleDiagnostics,
  onToggleTouchMode,
}: Pick<
  SettingsViewProps,
  | 'locale'
  | 'localePreference'
  | 'theme'
  | 'diagnosticsOpen'
  | 'touchMode'
  | 'onChangeTheme'
  | 'onChangeLocale'
  | 'onToggleDiagnostics'
  | 'onToggleTouchMode'
>) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rd-settings-card">
        <label className="settings-option-row"><span>{t(locale, 'themeTitle')}</span>
          <AdaptiveSelect label={t(locale, 'themeTitle')} testId="settings-theme" value={theme}
            options={THEME_OPTIONS.map(opt => ({ value: opt.id, label: t(locale, opt.key) }))}
            onChange={value => onChangeTheme(value as ThemePreference)} />
        </label>
        <label className="settings-option-row"><span>{t(locale, 'languageLabel')}</span>
          <AdaptiveSelect label={t(locale, 'languageLabel')} testId="settings-language-select" value={localePreference}
            options={[{ value: 'default', label: t(locale, 'languageDefault') }, { value: 'zh', label: '简体中文' }, { value: 'en', label: 'English' }]}
            onChange={value => onChangeLocale(value === 'zh' || value === 'en' ? value : 'default')} />
        </label>
      </section>

      <section className="rd-settings-card">
        <h2 className="rd-settings-card-title">{t(locale, 'otherSectionTitle')}</h2>
        <div className="flex flex-col gap-1">
          <label className="settings-option-row">
            <input
              type="checkbox" role="switch" className="ui-switch"
              data-testid="settings-toggle-diagnostics"
              checked={diagnosticsOpen}
              onChange={onToggleDiagnostics}
            />
            <span>{t(locale, 'diagnosticsOverlayLabel')}</span>
          </label>

          <label className="settings-option-row">
            <input
              type="checkbox" role="switch" className="ui-switch"
              data-testid="settings-toggle-touch-mode"
              checked={touchMode}
              onChange={onToggleTouchMode}
            />
            <span>{t(locale, 'touchModeOptionLabel')}</span>
          </label>
        </div>
      </section>
    </div>
  );
}

