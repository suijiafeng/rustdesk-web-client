// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { DisplayInfo, QualityLevel } from '@rustdesk-web/shared';
import { Clipboard, Eye, LockKeyhole, LogOut, Maximize2, Monitor, RotateCcw, Shield, ShieldAlert, SlidersHorizontal, Volume2 } from 'lucide-react';
import { t, translateAudioIssue, type Locale } from '../lib/i18n.ts';
import { classifyRemoteOs, remoteFeatures } from '../lib/platform.ts';

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
  remotePlatform: string;
  onQuickKey: (name: 'Ctrl+Alt+Del' | 'Lock') => void;
  onOpenClipboard: () => void;
  privacyEnabled: boolean;
  privacyPending: boolean;
  privacyFailed: boolean;
  onTogglePrivacy: () => void;
  resolutions: readonly { width: number; height: number }[];
  frameWidth: number;
  frameHeight: number;
  onResolution: (width: number, height: number) => void;
  restartAllowed: boolean;
  restartNotice: null | 'requested' | 'waiting' | 'failed' | 'ended';
  onRestart: () => void;
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
  remotePlatform,
  onQuickKey,
  onOpenClipboard,
  privacyEnabled,
  privacyPending,
  privacyFailed,
  onTogglePrivacy,
  resolutions,
  frameWidth,
  frameHeight,
  onResolution,
  restartAllowed,
  restartNotice,
  onRestart,
}: SessionToolbarProps) {
  const features = remoteFeatures(classifyRemoteOs(remotePlatform));
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
      {features.resolutionChange && resolutions.length > 0 ? (
        <label className="rd-session-field">
          <span>{t(locale, 'remoteResolution')}</span>
          <select
            aria-label={t(locale, 'remoteResolution')}
            value={`${frameWidth}x${frameHeight}`}
            onChange={(event) => {
              const [width, height] = event.target.value.split('x').map(Number);
              if (width > 0 && height > 0) onResolution(width, height);
            }}
          >
            {resolutions.some((size) => size.width === frameWidth && size.height === frameHeight) ? null : (
              <option value={`${frameWidth}x${frameHeight}`}>{frameWidth} × {frameHeight}</option>
            )}
            {resolutions.map((size) => (
              <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>
                {size.width} × {size.height}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
      {features.ctrlAltDel ? (
        <button type="button" className="rd-session-btn" disabled={viewOnly} onClick={() => onQuickKey('Ctrl+Alt+Del')}>
          <ShieldAlert size={15} />
          {t(locale, 'ctrlAltDel')}
        </button>
      ) : null}
      {features.privacyMode && privacyAllowed ? (
        <button
          type="button"
          className="rd-session-btn"
          aria-pressed={privacyEnabled}
          disabled={viewOnly || privacyPending}
          onClick={onTogglePrivacy}
        >
          <Shield size={15} />
          {t(locale, privacyPending ? 'privacyWaiting' : 'privacyMode')}
        </button>
      ) : null}
      {privacyFailed ? <span className="rd-session-note">{t(locale, 'privacyFailed')}</span> : null}
      {features.lockScreen ? (
        <button type="button" className="rd-session-btn" disabled={viewOnly} onClick={() => onQuickKey('Lock')}>
          <LockKeyhole size={15} />
          {t(locale, 'lockScreen')}
        </button>
      ) : null}
      <span className="rd-session-sep" aria-hidden="true" />
      <button type="button" className="rd-session-btn" onClick={onOpenClipboard}>
        <Clipboard size={15} />
        {t(locale, 'clipboard')}
      </button>
      <button type="button" className="rd-session-btn" onClick={onFullscreen}>
        <Maximize2 size={15} />
        {t(locale, 'sessionFullscreen')}
      </button>
      {features.restart && restartAllowed ? (
        <button type="button" className="rd-session-btn" disabled={restartNotice === 'requested' || restartNotice === 'waiting'} onClick={onRestart}>
          <RotateCcw size={15} />
          {t(locale, 'restartDevice')}
        </button>
      ) : null}
      {restartNotice ? <span className="rd-session-note">{t(locale, restartNotice === 'requested' ? 'restartWaiting' : restartNotice === 'waiting' ? 'retryWaiting' : restartNotice === 'failed' ? 'restartFailed' : 'retryEnded')}</span> : null}
      <button type="button" className="rd-session-btn danger" onClick={onDisconnect}>
        <LogOut size={15} />
        {t(locale, 'disconnect')}
      </button>
      {audioIssue ? <span className="rd-session-note" data-testid="audio-issue">{translateAudioIssue(locale, audioIssue)}</span> : null}
      {!privacyAllowed ? <span className="rd-session-note" data-testid="privacy-revoked">{t(locale, 'privacyUnavailable')}</span> : null}
    </div>
  );
}
