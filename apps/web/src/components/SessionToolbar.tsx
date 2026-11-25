// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { DisplayInfo, QualityLevel } from '@rustdesk-web/shared';
import { Camera, Clipboard, Eye, LockKeyhole, LogOut, Maximize2, MessageSquare, Monitor, RotateCcw, Shield, ShieldAlert, Volume2 } from 'lucide-react';
import { t, type Locale } from '../lib/i18n.ts';
import { classifyRemoteOs, remoteFeatures } from '../lib/platform.ts';
import { ResolutionSelect } from './ResolutionSelect.tsx';
import { SessionDisplayControls, type SessionDisplayControlsProps } from './SessionDisplayControls.tsx';

interface SessionToolbarProps extends Pick<SessionDisplayControlsProps, 'targetFps' | 'codec' | 'codecSupport' | 'onFps' | 'onCodec'> {
  locale: Locale;
  displays: readonly DisplayInfo[];
  currentDisplay: number;
  quality: QualityLevel;
  viewOnly: boolean;
  privacyAllowed: boolean;
  onSwitchDisplay: (display: number) => void;
  onQuality: SessionDisplayControlsProps['onQuality'];
  onToggleViewOnly: () => void;
  audioEnabled: boolean;
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
  onTogglePrivacy: () => void;
  resolutions: readonly { width: number; height: number }[];
  frameWidth: number;
  frameHeight: number;
  onResolution: (width: number, height: number) => void;
  restartAllowed: boolean;
  restartPending: boolean;
  onRestart: () => void;
  onScreenshot: () => void;
  onOpenChat: () => void;
}

export function SessionToolbar({
  locale,
  displays,
  currentDisplay,
  quality,
  targetFps,
  codec,
  codecSupport,
  onFps,
  onCodec,
  viewOnly,
  privacyAllowed,
  onSwitchDisplay,
  onQuality,
  onToggleViewOnly,
  audioEnabled,
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
  onTogglePrivacy,
  resolutions,
  frameWidth,
  frameHeight,
  onResolution,
  restartAllowed,
  restartPending,
  onRestart,
  onScreenshot,
  onOpenChat,
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
        <div className="rd-session-field">
          <span>{t(locale, 'remoteResolution')}</span>
          <ResolutionSelect
            label={t(locale, 'remoteResolution')}
            resolutions={resolutions}
            frameWidth={frameWidth}
            frameHeight={frameHeight}
            disabled={viewOnly}
            onSelect={onResolution}
          />
        </div>
      ) : null}
      <span className="rd-session-sep" aria-hidden="true" />
      <SessionDisplayControls locale={locale} quality={quality} targetFps={targetFps} codec={codec}
        codecSupport={codecSupport} onQuality={onQuality} onFps={onFps} onCodec={onCodec} />
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
      {features.lockScreen ? (
        <button type="button" className="rd-session-btn" disabled={viewOnly} onClick={() => onQuickKey('Lock')}>
          <LockKeyhole size={15} />
          {t(locale, 'lockScreen')}
        </button>
      ) : null}
      <span className="rd-session-sep" aria-hidden="true" />
      <button type="button" className="rd-session-btn" onClick={onOpenChat}>
        <MessageSquare size={15} />
        {t(locale, 'chat')}
      </button>
      <button type="button" className="rd-session-btn" onClick={onOpenClipboard}>
        <Clipboard size={15} />
        {t(locale, 'clipboard')}
      </button>
      <button type="button" className="rd-session-btn" onClick={onScreenshot}>
        <Camera size={15} />
        {t(locale, 'screenshot')}
      </button>
      <button type="button" className="rd-session-btn" onClick={onFullscreen}>
        <Maximize2 size={15} />
        {t(locale, 'sessionFullscreen')}
      </button>
      {features.restart && restartAllowed ? (
        <button type="button" className="rd-session-btn" disabled={restartPending} onClick={onRestart}>
          <RotateCcw size={15} />
          {t(locale, 'restartDevice')}
        </button>
      ) : null}
      <button type="button" className="rd-session-btn danger" onClick={onDisconnect}>
        <LogOut size={15} />
        {t(locale, 'disconnect')}
      </button>
    </div>
  );
}
