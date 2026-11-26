import {
  formatCodecLabel,
  PREFERRED_CODEC_OPTIONS,
  type DisplayPrefs,
  type ImageQualityPreset,
  type PreferredCodec,
} from '../../lib/displayPrefs';
import { t, type Locale } from '../../lib/i18n';
import type { CodecSupport } from '../../lib/protocol';
import { AdaptiveSelect } from '../AdaptiveSelect';
import { ScrollDirectionSelect } from '../ScrollDirectionSelect';

const QUALITY_OPTIONS: ReadonlyArray<{
  id: ImageQualityPreset;
  key: 'qualityGoodImage' | 'qualityBalanced' | 'qualityOptimizeReaction' | 'qualityCustom';
}> = [
  { id: 'best', key: 'qualityGoodImage' },
  { id: 'balanced', key: 'qualityBalanced' },
  { id: 'low', key: 'qualityOptimizeReaction' },
  { id: 'custom', key: 'qualityCustom' },
];

export function DisplaySettings({
  locale,
  displayPrefs,
  touchMode,
  diagnosticsOpen,
  codecSupport,
  onUpdateDisplayPrefs,
  onToggleTouchMode,
  onToggleDiagnostics,
}: {
  locale: Locale;
  displayPrefs: DisplayPrefs;
  touchMode: boolean;
  diagnosticsOpen: boolean;
  codecSupport?: CodecSupport | null;
  onUpdateDisplayPrefs: (patch: Partial<DisplayPrefs>) => void;
  onToggleTouchMode: () => void;
  onToggleDiagnostics: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <section className="rd-settings-card">
        <h3 className="rd-settings-card-title">{t(locale, 'displayVideoSectionTitle')}</h3>
        <label className="settings-option-row">
          <span>{t(locale, 'defaultViewStyle')}</span>
          <AdaptiveSelect
            label={t(locale, 'defaultViewStyle')}
            testId="settings-view"
            value={displayPrefs.viewStyle}
            options={[
              { value: 'original', label: t(locale, 'viewStyleOriginal') },
              { value: 'fit', label: t(locale, 'viewStyleFit') },
            ]}
            onChange={(value) => onUpdateDisplayPrefs({ viewStyle: value as DisplayPrefs['viewStyle'] })}
          />
        </label>

        <label className="settings-option-row">
          <span>{t(locale, 'defaultImageQuality')}</span>
          <AdaptiveSelect
            label={t(locale, 'defaultImageQuality')}
            testId="settings-quality"
            value={displayPrefs.qualityPreset}
            options={QUALITY_OPTIONS.map((opt) => ({ value: opt.id, label: t(locale, opt.key) }))}
            onChange={(value) => onUpdateDisplayPrefs({ qualityPreset: value as ImageQualityPreset })}
          />
        </label>

        {displayPrefs.qualityPreset === 'custom' && (
          <div className="rd-slider-group" data-testid="settings-custom-quality-controls">
            <label className="rd-slider-row">
              <span className="rd-slider-label">{t(locale, 'qualityRatioLabel')}</span>
              <input
                type="range"
                className="rd-range"
                min={20}
                max={200}
                step={2}
                data-testid="settings-custom-bitrate"
                aria-label={t(locale, 'qualityRatioLabel')}
                value={displayPrefs.customBitrate}
                onChange={(e) => onUpdateDisplayPrefs({ customBitrate: Number(e.target.value) })}
              />
              <span className="rd-slider-val font-mono-tabular">{displayPrefs.customBitrate}%</span>
            </label>
            <p className="text-xs text-[var(--ink-soft)] m-0">{t(locale, 'qualityRatioHint')}</p>
          </div>
        )}

        <div className="rd-slider-group rd-slider-divider">
          <label className="rd-slider-row">
            <span className="rd-slider-label">{t(locale, 'targetFps')}</span>
            <input
              type="range"
              className="rd-range"
              min={10}
              max={60}
              step={5}
              data-testid="settings-custom-fps"
              aria-label={t(locale, 'fpsLabel')}
              value={displayPrefs.targetFps}
              onChange={(e) => onUpdateDisplayPrefs({ targetFps: Number(e.target.value) })}
            />
            <span className="rd-slider-val font-mono-tabular">
              {displayPrefs.targetFps} {t(locale, 'fpsLabel')}
            </span>
          </label>
        </div>

        <label className="settings-option-row">
          <span>{t(locale, 'defaultCodec')}</span>
          <AdaptiveSelect
            label={t(locale, 'defaultCodec')}
            testId="settings-codec"
            value={displayPrefs.codec}
            options={PREFERRED_CODEC_OPTIONS.map((value) => ({
              value,
              label: formatCodecLabel(value, t(locale, 'codecAuto')),
              disabled:
                value !== 'auto' &&
                value !== displayPrefs.codec &&
                codecSupport?.[value] === false,
            }))}
            onChange={(value) => onUpdateDisplayPrefs({ codec: value as PreferredCodec })}
          />
        </label>
      </section>

      <section className="rd-settings-card">
        <h3 className="rd-settings-card-title">{t(locale, 'displayInputSectionTitle')}</h3>
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
      </section>

      <section className="rd-settings-card">
        <h3 className="rd-settings-card-title">{t(locale, 'displaySessionSectionTitle')}</h3>
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
            data-testid="settings-opt-quality-monitor"
            checked={diagnosticsOpen}
            onChange={onToggleDiagnostics}
          />
          <span>{t(locale, 'optShowQualityMonitor')}</span>
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


