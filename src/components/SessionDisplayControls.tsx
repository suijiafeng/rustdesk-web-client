import { Film, Focus, Gauge, Monitor, Shield, SlidersHorizontal } from 'lucide-react';
import { filterCommonResolutions, formatCodecLabel, normalizeCodecName, PREFERRED_CODEC_OPTIONS, type PreferredCodec } from '../lib/displayPrefs';
import { t, type Locale } from '../lib/i18n';
import type { CodecSupport, PeerMessage, QualityLevel } from '../lib/protocol';
import { AdaptiveSelect } from './AdaptiveSelect';

const qualityNames = {
  low: 'qualityLow',
  balanced: 'qualityBalanced',
  best: 'qualityBest',
  custom: 'qualityCustom',
} as const;

export interface SessionDisplayControlsProps {
  variant: 'desktop' | 'mobile';
  locale: Locale;
  peer: PeerMessage | null;
  display: number;
  viewOnly: boolean;
  stats: { width: number; height: number; codec?: string };
  sizes: Array<{ width: number; height: number }>;
  quality: QualityLevel;
  customQuality: number;
  targetFps: number;
  preferredCodec: PreferredCodec;
  codecSupport?: CodecSupport | null;
  privacyEnabled: boolean;
  privacyPending: boolean;
  followWindow: boolean;
  onSwitchDisplay: (index: number) => void;
  onTogglePrivacy: () => void;
  onResolution: (width: number, height: number) => void;
  onChangeQuality: (quality: QualityLevel, fps: number, codec?: PreferredCodec, customQuality?: number) => void;
  onToggleFollowWindow: () => void;
  onNotify: (text: string) => void;
}

export function SessionDisplayControls({
  variant,
  locale,
  peer,
  display,
  viewOnly,
  stats,
  sizes,
  quality,
  customQuality,
  targetFps,
  preferredCodec,
  codecSupport,
  privacyEnabled,
  privacyPending,
  followWindow,
  onSwitchDisplay,
  onTogglePrivacy,
  onResolution,
  onChangeQuality,
  onToggleFollowWindow,
  onNotify,
}: SessionDisplayControlsProps) {
  const monitors = peer?.displays ?? [];
  const hasMultipleDisplays = monitors.length > 1;
  const visibleSizes = filterCommonResolutions(sizes, stats.width, stats.height);
  const resolutionIndex = visibleSizes.findIndex((s) => s.width === stats.width && s.height === stats.height);
  const isMobile = variant === 'mobile';
  const groupClass = isMobile ? 'tool-group' : 'session-group';
  const rowClass = isMobile ? 'tool-row' : 'session-setting-row';
  const selectTone = isMobile ? 'remote' : undefined;

  const showCodecActualHint = Boolean(
    stats.codec && stats.codec !== '—' && preferredCodec !== 'auto' && normalizeCodecName(stats.codec) !== preferredCodec,
  );

  const qualityAndFpsControls = (
    <>
      <label className={rowClass}>
        <SlidersHorizontal size={isMobile ? undefined : 18} />
        <span>{t(locale, 'qualityAndFps')}</span>
        <AdaptiveSelect
          tone={selectTone}
          label={t(locale, 'qualityAndFps')}
          testId="quality-select"
          value={quality}
          options={(['low', 'balanced', 'best', 'custom'] as const).map((level) => ({
            value: level,
            label: t(locale, qualityNames[level]),
          }))}
          onChange={(value) => {
            const level = value as QualityLevel;
            onChangeQuality(level, targetFps, preferredCodec);
            onNotify(t(locale, 'requestSent') + ' · ' + t(locale, qualityNames[level]));
          }}
        />
      </label>

      {quality === 'custom' && (
        <div className="rd-slider-group">
          <label className="rd-slider-row">
            <input
              type="range"
              className="rd-range"
              min={20}
              max={200}
              step={2}
              value={customQuality}
              aria-label={t(locale, 'qualityRatioLabel')}
              data-testid="session-custom-quality"
              onChange={(event) =>
                onChangeQuality('custom', targetFps, preferredCodec, Number(event.target.value))
              }
            />
            <span className="rd-slider-val font-mono-tabular">{customQuality}%</span>
            <span className="rd-slider-label">{t(locale, 'qualityRatioLabel')}</span>
          </label>
          <p className="text-xs text-[var(--ink-soft)]">{t(locale, 'qualityRatioHint')}</p>
        </div>
      )}

      <label className={rowClass}>
        <Gauge size={isMobile ? undefined : 18} />
        <span>{t(locale, 'targetFps')}</span>
        <AdaptiveSelect
          tone={selectTone}
          label={t(locale, 'targetFps')}
          testId="fps-select"
          value={String(targetFps)}
          options={[...new Set([15, 30, 60, targetFps])].sort((a, b) => a - b).map((n) => ({
            value: String(n),
            label: `${n} FPS`,
          }))}
          onChange={(value) => {
            onChangeQuality(quality, Number(value), preferredCodec);
            onNotify(t(locale, 'requestSent') + ' · ' + value + ' FPS');
          }}
        />
      </label>

      <label className={rowClass}>
        <Film size={isMobile ? undefined : 18} />
        <span>{t(locale, 'sessionCodecLabel')}</span>
        <AdaptiveSelect
          tone={selectTone}
          label={t(locale, 'sessionCodecLabel')}
          testId="codec-select"
          value={preferredCodec}
          options={PREFERRED_CODEC_OPTIONS.map((value) => ({
            value,
            label: formatCodecLabel(value, t(locale, 'codecAuto')),
            disabled: value !== 'auto' && value !== preferredCodec && codecSupport?.[value] === false,
          }))}
          onChange={(value) => {
            const codec = value as PreferredCodec;
            onChangeQuality(quality, targetFps, codec);
            onNotify(t(locale, 'requestSent') + ' · ' + formatCodecLabel(codec, t(locale, 'codecAuto')));
          }}
        />
      </label>
      {showCodecActualHint && (
        <p className="m-0 pb-1 text-xs text-[var(--ink-soft)]" data-testid="codec-actual-hint">
          {t(locale, 'codecActualPrefix')}: {stats.codec}
        </p>
      )}
    </>
  );

  return (
    <>
      {hasMultipleDisplays && (
        <div
          className={isMobile ? 'tool-group tool-options' : 'session-group session-mode-switch'}
          role={isMobile ? undefined : 'group'}
          aria-label={isMobile ? undefined : t(locale, 'displays')}
        >
          {monitors.map((d) => (
            <button
              key={d.index}
              type="button"
              aria-pressed={d.index === display}
              disabled={d.online === false}
              onClick={() => {
                onSwitchDisplay(d.index);
                onNotify(t(locale, 'requestSent') + ' · ' + (d.name || t(locale, 'screens') + ' ' + (d.index + 1)));
              }}
            >
              <Monitor size={isMobile ? undefined : 18} />
              {d.name || t(locale, 'screens') + ' ' + (d.index + 1)}
            </button>
          ))}
        </div>
      )}

      <div className={groupClass}>
        {peer?.privacyAllowed && (
          <label className={rowClass}>
            <Shield />
            <span>{t(locale, 'privacyMode')}</span>
            <input
              className="ui-switch"
              type="checkbox"
              role="switch"
              checked={privacyEnabled}
              disabled={privacyPending || viewOnly}
              onChange={onTogglePrivacy}
            />
          </label>
        )}

        {visibleSizes.length > 0 && (
          <label className={rowClass}>
            <Monitor />
            <span>{t(locale, 'remoteResolution')}</span>
            <AdaptiveSelect
              tone={selectTone}
              label={t(locale, 'remoteResolution')}
              testId="resolution-select"
              disabled={viewOnly}
              value={String(resolutionIndex)}
              options={[
                ...(resolutionIndex < 0
                  ? [{ value: '-1', label: `${stats.width} × ${stats.height}`, disabled: true }]
                  : []),
                ...visibleSizes.map((s, i) => ({ value: String(i), label: `${s.width} × ${s.height}` })),
              ]}
              onChange={(value) => {
                const size = visibleSizes[Number(value)];
                if (size) {
                  onResolution(size.width, size.height);
                  onNotify(t(locale, 'requestSent') + ' · ' + size.width + ' × ' + size.height);
                }
              }}
            />
          </label>
        )}

        {isMobile ? <div data-testid="mobile-quality">{qualityAndFpsControls}</div> : qualityAndFpsControls}
      </div>

      {hasMultipleDisplays && (
        <div className={groupClass}>
          <label className={rowClass}>
            <Focus />
            <span>{t(locale, 'followWindow')}</span>
            <input
              className="ui-switch"
              type="checkbox"
              role="switch"
              checked={followWindow}
              onChange={() => {
                onToggleFollowWindow();
                onNotify(t(locale, 'followWindow') + ' · ' + t(locale, followWindow ? 'optionOff' : 'optionOn'));
              }}
            />
          </label>
        </div>
      )}
    </>
  );
}
