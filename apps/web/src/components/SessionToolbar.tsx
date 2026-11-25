// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { DisplayInfo, QualityLevel } from '@rustdesk-web/shared';
import { Eye, LogOut, Maximize2, Monitor, SlidersHorizontal, Volume2 } from 'lucide-react';
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
  onFullscreen: () => void;
  onDisconnect: () => void;
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
  onFullscreen,
  onDisconnect,
}: SessionToolbarProps) {
  return (
    <div
      className="rd-session-toolbar"
      data-testid="session-toolbar"
      role="toolbar"
      aria-label={t(locale, 'session')}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {displays.map((display, index) => (
        <button
          key={`${display.name}-${index}`}
          type="button"
          className="rd-session-btn"
          disabled={!display.online}
          aria-pressed={index === currentDisplay}
          onClick={() => onSwitchDisplay(index)}
        >
          <Monitor size={15} />
          {display.name || `${t(locale, 'displayFallback')} ${index + 1}`}
        </button>
      ))}
      <span className="rd-session-sep" aria-hidden="true" />
      <label className="rd-session-field">
        <SlidersHorizontal size={15} />
        <span>{t(locale, 'sessionQuality')}</span>
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
      <button type="button" className="rd-session-btn" aria-pressed={viewOnly} onClick={onToggleViewOnly}>
        <Eye size={15} />
        {viewOnly ? t(locale, 'viewOnlyLabel') : t(locale, 'sessionControl')}
      </button>
      <button type="button" className="rd-session-btn" aria-pressed={audioEnabled} onClick={onToggleAudio}>
        <Volume2 size={15} />
        {audioEnabled ? t(locale, 'audioOn') : t(locale, 'audioOff')}
      </button>
      <label className="rd-session-field">
        <span>{t(locale, 'sessionVolume')}</span>
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
      <span className="rd-session-sep" aria-hidden="true" />
      <button type="button" className="rd-session-btn" onClick={onFullscreen}>
        <Maximize2 size={15} />
        {t(locale, 'sessionFullscreen')}
      </button>
      <button type="button" className="rd-session-btn danger" onClick={onDisconnect}>
        <LogOut size={15} />
        {t(locale, 'disconnect')}
      </button>
      {audioIssue ? <span className="rd-session-note" data-testid="audio-issue">{translateAudioIssue(locale, audioIssue)}</span> : null}
      {!privacyAllowed ? <span className="rd-session-note" data-testid="privacy-revoked">{t(locale, 'privacyUnavailable')}</span> : null}
    </div>
  );
}
