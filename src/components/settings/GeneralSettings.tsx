import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t, type Locale } from '../../lib/i18n';
import type { ThemePreference } from '../../lib/theme';
import { AdaptiveSelect } from '../AdaptiveSelect';
import { ScrollDirectionSelect } from '../ScrollDirectionSelect';
import type { SettingsViewProps } from './types';

const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; key: 'themeLight' | 'themeDark' | 'themeSystem' }> = [
  { id: 'light', key: 'themeLight' },
  { id: 'dark', key: 'themeDark' },
  { id: 'system', key: 'themeSystem' },
];

type ConfirmKind = 'passwords' | 'defaults' | null;

function formatSavedPasswordSummary(locale: Locale, count: number): string {
  if (count <= 0) return t(locale, 'savedPasswordsEmpty');
  return locale === 'zh'
    ? `已保存 ${count} 台设备的密码`
    : `${count} saved ${count === 1 ? 'password' : 'passwords'}`;
}

export function GeneralSettings({
  locale,
  localePreference,
  theme,
  displayPrefs,
  touchMode = false,
  savedPasswordCount = 0,
  onChangeTheme,
  onChangeLocale,
  onUpdateDisplayPrefs,
  onToggleTouchMode,
  onClearAllSavedPasswords,
  onResetDefaults,
}: Pick<
  SettingsViewProps,
  | 'locale'
  | 'localePreference'
  | 'theme'
  | 'savedPasswordCount'
  | 'onChangeTheme'
  | 'onChangeLocale'
  | 'onClearAllSavedPasswords'
  | 'onResetDefaults'
> & Partial<Pick<
  SettingsViewProps,
  | 'displayPrefs'
  | 'touchMode'
  | 'onUpdateDisplayPrefs'
  | 'onToggleTouchMode'
>>) {
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [clearedNotice, setClearedNotice] = useState(false);
  const [resetNotice, setResetNotice] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const clearBtnRef = useRef<HTMLButtonElement>(null);
  const resetBtnRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  useLayoutEffect(() => {
    if (!confirmKind) return;
    const el = dialogRef.current;
    el?.showModal();
    return () => {
      el?.close();
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [confirmKind]);

  const showLocalDataSection = Boolean(onClearAllSavedPasswords || onResetDefaults);

  return (
    <div className="flex flex-col gap-5">
      <section className="rd-settings-card">
        <h3 className="rd-settings-card-title">{t(locale, 'appearanceSectionTitle')}</h3>
        <label className="settings-option-row">
          <span>{t(locale, 'themeTitle')}</span>
          <AdaptiveSelect
            label={t(locale, 'themeTitle')}
            testId="settings-theme"
            value={theme}
            options={THEME_OPTIONS.map((opt) => ({ value: opt.id, label: t(locale, opt.key) }))}
            onChange={(value) => onChangeTheme(value as ThemePreference)}
          />
        </label>
        <label className="settings-option-row">
          <span>{t(locale, 'languageLabel')}</span>
          <AdaptiveSelect
            label={t(locale, 'languageLabel')}
            testId="settings-language-select"
            value={localePreference}
            options={[
              { value: 'default', label: t(locale, 'languageDefault') },
              { value: 'zh', label: '简体中文' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(value) => onChangeLocale(value === 'zh' || value === 'en' ? value : 'default')}
          />
        </label>
      </section>

      {displayPrefs && onUpdateDisplayPrefs && (
        <>
          <section className="rd-settings-card">
            <h3 className="rd-settings-card-title">{t(locale, 'inputMouseSectionTitle')}</h3>
            {onToggleTouchMode && (
              <label className="settings-option-row">
                <input
                  type="checkbox"
                  role="switch"
                  className="ui-switch"
                  data-testid="settings-toggle-touch-mode"
                  checked={touchMode}
                  onChange={onToggleTouchMode}
                />
                <span>{t(locale, 'touchModeOptionLabel')}</span>
              </label>
            )}

            <label className="settings-option-row">
              <span>{t(locale, 'scrollDirection')}</span>
              <ScrollDirectionSelect
                locale={locale}
                testId="settings-opt-reverse-wheel"
                reverse={displayPrefs.reverseMouseWheel}
                onChange={(reverseMouseWheel) => onUpdateDisplayPrefs({ reverseMouseWheel })}
              />
            </label>

            <label className="settings-option-row">
              <input
                type="checkbox"
                role="switch"
                className="ui-switch"
                data-testid="settings-opt-swap-buttons"
                checked={displayPrefs.swapMouseButtons}
                onChange={(e) => onUpdateDisplayPrefs({ swapMouseButtons: e.target.checked })}
              />
              <span>{t(locale, 'optSwapMouseButtons')}</span>
            </label>

            <label className="settings-option-row">
              <input
                type="checkbox"
                role="switch"
                className="ui-switch"
                data-testid="settings-opt-remote-cursor"
                checked={displayPrefs.showRemoteCursor}
                onChange={(e) => onUpdateDisplayPrefs({ showRemoteCursor: e.target.checked })}
              />
              <span>{t(locale, 'optShowRemoteCursor')}</span>
            </label>

            <label className="settings-option-row">
              <input
                type="checkbox"
                role="switch"
                className="ui-switch"
                data-testid="settings-opt-enlarge-cursor"
                checked={displayPrefs.enlargeCursor}
                onChange={(e) => onUpdateDisplayPrefs({ enlargeCursor: e.target.checked })}
              />
              <span>{t(locale, 'enlargeCursor')}</span>
            </label>

            <label className="settings-option-row">
              <input
                type="checkbox"
                role="switch"
                className="ui-switch"
                data-testid="settings-opt-follow-cursor"
                checked={displayPrefs.followRemoteCursor}
                onChange={(e) => onUpdateDisplayPrefs({ followRemoteCursor: e.target.checked })}
              />
              <span>{t(locale, 'followRemoteCursor')}</span>
            </label>
          </section>

          <section className="rd-settings-card">
            <h3 className="rd-settings-card-title">{t(locale, 'inputKeyboardSectionTitle')}</h3>
            <label className="settings-option-row">
              <input
                type="checkbox"
                role="switch"
                className="ui-switch"
                data-testid="settings-opt-auto-keyboard"
                checked={displayPrefs.autoKeyboard}
                onChange={(e) => onUpdateDisplayPrefs({ autoKeyboard: e.target.checked })}
              />
              <span>{t(locale, 'autoKeyboard')}</span>
            </label>

            <label className="settings-option-row">
              <input
                type="checkbox"
                role="switch"
                className="ui-switch"
                data-testid="settings-opt-view-only"
                checked={displayPrefs.viewOnly}
                onChange={(e) => onUpdateDisplayPrefs({ viewOnly: e.target.checked })}
              />
              <span>{t(locale, 'optViewOnly')}</span>
            </label>

            <label className="settings-option-row">
              <input
                type="checkbox"
                role="switch"
                className="ui-switch"
                data-testid="settings-opt-disable-clipboard"
                checked={displayPrefs.disableClipboard}
                onChange={(e) => onUpdateDisplayPrefs({ disableClipboard: e.target.checked })}
              />
              <span>{t(locale, 'optDisableClipboard')}</span>
            </label>

            <label className="settings-option-row">
              <input
                type="checkbox"
                role="switch"
                className="ui-switch"
                data-testid="settings-opt-lock-after-end"
                checked={displayPrefs.lockAfterSessionEnd}
                onChange={(e) => onUpdateDisplayPrefs({ lockAfterSessionEnd: e.target.checked })}
              />
              <span>{t(locale, 'optLockAfterSessionEnd')}</span>
            </label>
          </section>
        </>
      )}

      {showLocalDataSection && (
        <section className="rd-settings-card">
          <h3 className="rd-settings-card-title">{t(locale, 'localDataSectionTitle')}</h3>

          {onClearAllSavedPasswords && (
            <div className="settings-option-row">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] text-[var(--ink)]">{t(locale, 'savedPasswordsTitle')}</div>
                <div className="text-xs text-[var(--ink-soft)] mt-0.5">
                  {savedPasswordCount === 0 && clearedNotice
                    ? t(locale, 'passwordsClearedNotice')
                    : formatSavedPasswordSummary(locale, savedPasswordCount)}
                </div>
              </div>
              <button
                ref={clearBtnRef}
                type="button"
                className="rd-btn shrink-0"
                data-testid="settings-clear-passwords"
                disabled={savedPasswordCount === 0}
                onClick={() => {
                  returnFocusRef.current = clearBtnRef.current;
                  setConfirmKind('passwords');
                }}
              >
                {t(locale, 'clearAllAction')}
              </button>
            </div>
          )}

          {onResetDefaults && (
            <div className="settings-option-row">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] text-[var(--ink)]">{t(locale, 'resetDefaultsTitle')}</div>
                <div className="text-xs text-[var(--ink-soft)] mt-0.5">
                  {resetNotice ? t(locale, 'defaultsResetNotice') : t(locale, 'resetDefaultsHint')}
                </div>
              </div>
              <button
                ref={resetBtnRef}
                type="button"
                className="rd-btn shrink-0"
                data-testid="settings-reset-prefs"
                onClick={() => {
                  returnFocusRef.current = resetBtnRef.current;
                  setConfirmKind('defaults');
                }}
              >
                {t(locale, 'resetDefaultsAction')}
              </button>
            </div>
          )}
        </section>
      )}

      {confirmKind &&
        createPortal(
          <dialog
            ref={dialogRef}
            className="session-confirm"
            data-session-confirm
            data-testid={`settings-confirm-${confirmKind}`}
            aria-labelledby={`${dialogId}-title`}
            aria-describedby={`${dialogId}-desc`}
            onCancel={(event) => {
              event.preventDefault();
              setConfirmKind(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                setConfirmKind(null);
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) setConfirmKind(null);
            }}
          >
            <div className="session-confirm-content">
              <header>
                <h2 id={`${dialogId}-title`}>
                  {t(
                    locale,
                    confirmKind === 'passwords'
                      ? 'confirmClearPasswordsTitle'
                      : 'confirmResetDefaultsTitle',
                  )}
                </h2>
                <button
                  type="button"
                  className="dialog-close"
                  aria-label={t(locale, 'close')}
                  onClick={() => setConfirmKind(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <p id={`${dialogId}-desc`}>
                {t(
                  locale,
                  confirmKind === 'passwords'
                    ? 'confirmClearPasswordsBody'
                    : 'confirmResetDefaultsBody',
                )}
              </p>
              <footer>
                <button
                  type="button"
                  className="rd-btn"
                  autoFocus
                  onClick={() => setConfirmKind(null)}
                >
                  {t(locale, 'cancel')}
                </button>
                <button
                  type="button"
                  className={`rd-btn ${confirmKind === 'passwords' ? 'danger' : 'primary'}`}
                  data-testid="settings-confirm-accept"
                  onClick={() => {
                    const kind = confirmKind;
                    setConfirmKind(null);
                    if (kind === 'passwords') {
                      onClearAllSavedPasswords?.();
                      setClearedNotice(true);
                    } else {
                      onResetDefaults?.();
                      setResetNotice(true);
                    }
                  }}
                >
                  {t(locale, confirmKind === 'passwords' ? 'clearAllAction' : 'resetDefaultsAction')}
                </button>
              </footer>
            </div>
          </dialog>,
          document.body,
        )}
    </div>
  );
}


