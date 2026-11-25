// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { DisplayInfo, QualityLevel } from '@rustdesk-web/shared';
import { t, translateAudioIssue, type Locale } from '../lib/i18n.ts';

interface SessionToolbarProps {
  locale: Locale;
  displays: readonly DisplayInfo[];
  currentDisplay: number;
  quality: QualityLevel;
  viewOnly: boolean;
  privacyAllowed: boolean;
  onSwitchDisplay: (display: number) => void;
  onQuality: (quality: QualityLevel) => void;
  onToggleViewOnly: () => void;
  audioEnabled: boolean;
  audioIssue: string;
  volume: number;
  onToggleAudio: () => void;
  onVolume: (volume: number) => void;
}

const QUALITIES: QualityLevel[] = ['low', 'balanced', 'best'];

export function SessionToolbar({
  locale,
  displays,
  currentDisplay,
  quality,
  viewOnly,
  privacyAllowed,
  onSwitchDisplay,
  onQuality,
  onToggleViewOnly,
  audioEnabled,
  audioIssue,
  volume,
  onToggleAudio,
  onVolume,
}: SessionToolbarProps) {
  return (
    <div
      data-testid="session-toolbar"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        zIndex: 3,
        maxWidth: 'calc(100% - 220px)',
      }}
    >
      {displays.map((display, index) => (
        <button
          key={`${display.name}-${index}`}
          type="button"
          disabled={!display.online}
          aria-pressed={index === currentDisplay}
          onClick={() => onSwitchDisplay(index)}
          style={{ cursor: 'pointer' }}
        >
          {display.name || `${t(locale, 'displayFallback')} ${index + 1}`}
        </button>
      ))}
      <label>
        {t(locale, 'sessionQuality')}{' '}
        <select
          aria-label={t(locale, 'sessionQuality')}
          value={quality}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'low' || next === 'balanced' || next === 'best') onQuality(next);
          }}
        >
          {QUALITIES.map((level) => (
            <option key={level} value={level}>{t(locale, level === 'low' ? 'qualityLow' : level === 'best' ? 'qualityBest' : 'qualityBalanced')}</option>
          ))}
        </select>
      </label>
      <button type="button" aria-pressed={viewOnly} onClick={onToggleViewOnly} style={{ cursor: 'pointer' }}>
        {viewOnly ? t(locale, 'viewOnlyLabel') : t(locale, 'sessionControl')}
      </button>
      <button type="button" aria-pressed={audioEnabled} onClick={onToggleAudio} style={{ cursor: 'pointer' }}>
        {audioEnabled ? t(locale, 'audioOn') : t(locale, 'audioOff')}
      </button>
      <label>
        {t(locale, 'sessionVolume')}{' '}
        <input
          aria-label={t(locale, 'sessionVolume')}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
        />
      </label>
      {audioIssue ? <span data-testid="audio-issue">{translateAudioIssue(locale, audioIssue)}</span> : null}
      {!privacyAllowed ? <span data-testid="privacy-revoked">{t(locale, 'privacyUnavailable')}</span> : null}
    </div>
  );
}
