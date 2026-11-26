import type { DisplayPrefs, ImageQualityPreset, PreferredCodec } from '../../lib/displayPrefs';
import { t, type Locale } from '../../lib/i18n';
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

const CODEC_OPTIONS: ReadonlyArray<{ id: PreferredCodec; label?: string }> = [
  { id: 'auto' },
  { id: 'vp8', label: 'VP8' },
  { id: 'vp9', label: 'VP9' },
  { id: 'h264', label: 'H.264' },
  { id: 'h265', label: 'H.265' },
  { id: 'av1', label: 'AV1' },
];

export function DisplaySettings({
  locale,
  displayPrefs,
  diagnosticsOpen,
  onUpdateDisplayPrefs,
  onToggleDiagnostics,
}: {
  locale: Locale;
  displayPrefs: DisplayPrefs;
  diagnosticsOpen: boolean;
  onUpdateDisplayPrefs: (patch: Partial<DisplayPrefs>) => void;
  onToggleDiagnostics: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rd-settings-card">
        <label className="settings-option-row"><span>{t(locale, 'defaultViewStyle')}</span>
          <AdaptiveSelect label={t(locale, 'defaultViewStyle')} testId="settings-view" value={displayPrefs.viewStyle}
            options={[{ value: 'original', label: t(locale, 'viewStyleOriginal') }, { value: 'fit', label: t(locale, 'viewStyleFit') }]}
            onChange={value => onUpdateDisplayPrefs({ viewStyle: value as DisplayPrefs['viewStyle'] })} />
        </label>
        <label className="settings-option-row"><span>{t(locale, 'defaultScrollStyle')}</span>
          <AdaptiveSelect label={t(locale, 'defaultScrollStyle')} testId="settings-scroll" value={displayPrefs.scrollStyle}
            options={[{ value: 'auto', label: t(locale, 'scrollStyleAuto') }, { value: 'scrollbar', label: t(locale, 'scrollStyleBar') }]}
            onChange={value => onUpdateDisplayPrefs({ scrollStyle: value as DisplayPrefs['scrollStyle'] })} />
        </label>
        <label className="settings-option-row"><span>{t(locale, 'defaultImageQuality')}</span>
          <AdaptiveSelect label={t(locale, 'defaultImageQuality')} testId="settings-quality" value={displayPrefs.qualityPreset}
            options={QUALITY_OPTIONS.map(opt => ({ value: opt.id, label: t(locale, opt.key) }))}
            onChange={value => onUpdateDisplayPrefs({ qualityPreset: value as ImageQualityPreset })} />
        </label>
        {displayPrefs.qualityPreset === 'custom' && (
          <div className="rd-slider-group" data-testid="settings-custom-quality-controls">
            <label className="rd-slider-row">
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
              <span className="rd-slider-label">{t(locale, 'qualityRatioLabel')}</span>
            </label>
            <p className="text-xs text-[var(--ink-soft)]">{t(locale, 'qualityRatioHint')}</p>
          </div>
        )}
        <div className="rd-slider-group">
          <label className="rd-slider-row">
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
            <span className="rd-slider-val font-mono-tabular">{displayPrefs.targetFps}</span>
            <span className="rd-slider-label">{t(locale, 'fpsLabel')}</span>
          </label>
        </div>
      </section>

      <section className="rd-settings-card">
        <label className="settings-option-row"><span>{t(locale, 'defaultCodec')}</span>
          <AdaptiveSelect label={t(locale, 'defaultCodec')} testId="settings-codec" value={displayPrefs.codec}
            options={CODEC_OPTIONS.map(opt => ({ value: opt.id, label: opt.label ?? t(locale, 'codecAuto') }))}
            onChange={value => onUpdateDisplayPrefs({ codec: value as PreferredCodec })} />
        </label>
      </section>

      <section className="rd-settings-card">
        <h2 className="rd-settings-card-title">{t(locale, 'otherDefaultOptions')}</h2>
        <div className="flex flex-col gap-0.5">
          <label className="settings-option-row">
            <input
              type="checkbox" role="switch" className="ui-switch"
              data-testid="settings-opt-view-only"
              checked={displayPrefs.viewOnly}
              onChange={(e) => onUpdateDisplayPrefs({ viewOnly: e.target.checked })}
            />
            <span>{t(locale, 'optViewOnly')}</span>
          </label>

          <label className="settings-option-row">
            <input
              type="checkbox" role="switch" className="ui-switch"
              data-testid="settings-opt-remote-cursor"
              checked={displayPrefs.showRemoteCursor}
              onChange={(e) => onUpdateDisplayPrefs({ showRemoteCursor: e.target.checked })}
            />
            <span>{t(locale, 'optShowRemoteCursor')}</span>
          </label>

          <label className="settings-option-row">
            <input
              type="checkbox" role="switch" className="ui-switch"
              data-testid="settings-opt-quality-monitor"
              checked={diagnosticsOpen}
              onChange={onToggleDiagnostics}
            />
            <span>{t(locale, 'optShowQualityMonitor')}</span>
          </label>

          <label className="settings-option-row">
            <input
              type="checkbox" role="switch" className="ui-switch"
              data-testid="settings-opt-disable-clipboard"
              checked={displayPrefs.disableClipboard}
              onChange={(e) => onUpdateDisplayPrefs({ disableClipboard: e.target.checked })}
            />
            <span>{t(locale, 'optDisableClipboard')}</span>
          </label>

          <label className="settings-option-row">
            <input
              type="checkbox" role="switch" className="ui-switch"
              data-testid="settings-opt-lock-after-end"
              checked={displayPrefs.lockAfterSessionEnd}
              onChange={(e) => onUpdateDisplayPrefs({ lockAfterSessionEnd: e.target.checked })}
            />
            <span>{t(locale, 'optLockAfterSessionEnd')}</span>
          </label>

          <label className="settings-option-row">
            <span>{t(locale, 'scrollDirection')}</span>
            <ScrollDirectionSelect locale={locale} testId="settings-opt-reverse-wheel"
              reverse={displayPrefs.reverseMouseWheel}
              onChange={reverseMouseWheel => onUpdateDisplayPrefs({ reverseMouseWheel })} />
          </label>

          <label className="settings-option-row">
            <input
              type="checkbox" role="switch" className="ui-switch"
              data-testid="settings-opt-swap-buttons"
              checked={displayPrefs.swapMouseButtons}
              onChange={(e) => onUpdateDisplayPrefs({ swapMouseButtons: e.target.checked })}
            />
            <span>{t(locale, 'optSwapMouseButtons')}</span>
          </label>
        </div>
      </section>
    </div>
  );
}

