import type { DisplayPrefs } from '../../lib/displayPrefs';
import { t, type Locale } from '../../lib/i18n';
import { ScrollDirectionSelect } from '../ScrollDirectionSelect';

interface InputSettingsProps {
  locale: Locale;
  displayPrefs: DisplayPrefs;
  touchMode: boolean;
  onUpdateDisplayPrefs: (patch: Partial<DisplayPrefs>) => void;
  onToggleTouchMode: () => void;
}

export function InputSettings({
  locale,
  displayPrefs,
  touchMode,
  onUpdateDisplayPrefs,
  onToggleTouchMode,
}: InputSettingsProps) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rd-settings-card">
        <h3 className="rd-settings-card-title">{t(locale, 'inputMouseSectionTitle')}</h3>
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
      </section>

      <section className="rd-settings-card">
        <h3 className="rd-settings-card-title">{t(locale, 'inputKeyboardSectionTitle')}</h3>
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
    </div>
  );
}
