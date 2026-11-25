// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useState } from 'react';
import type { DisplayInfo, QualityLevel } from '@rustdesk-web/shared';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Eye,
  Clipboard,
  Keyboard,
  LockKeyhole,
  Layers2,
  LogOut,
  Maximize2,
  Shield,
  ShieldAlert,
  Monitor,
  MousePointer2,
  Pointer,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react';
import { t, translateAudioIssue, type I18nKey, type Locale } from '../lib/i18n.ts';
import { classifyRemoteOs, remoteFeatures } from '../lib/platform.ts';

type DockPanel = 'toolbar' | 'display' | 'gestures' | 'actions';

const QUALITIES = ['low', 'balanced', 'best'] as const;
const qualityKey = { low: 'qualityLow', balanced: 'qualityBalanced', best: 'qualityBest' } as const;

const gestureRows = {
  touch: [
    ['gTouchTapTitle', 'gTouchTapDesc'],
    ['gDoubleTapTitle', 'gTouchDoubleTapDesc'],
    ['gTouchRightTitle', 'gTouchRightDesc'],
    ['gTouchDragTitle', 'gTouchDragDesc'],
    ['gTouchPinchTitle', 'gTouchPinchDesc'],
    ['gTouchScrollTitle', 'gTouchScrollDesc'],
  ],
  mouse: [
    ['gMouseSlideTitle', 'gMouseSlideDesc'],
    ['gMouseTapTitle', 'gMouseTapDesc'],
    ['gDoubleTapTitle', 'gMouseDoubleTapDesc'],
    ['gMouseDragTitle', 'gMouseDragDesc'],
    ['gMouseRightTitle', 'gMouseRightDesc'],
    ['gMousePinchTitle', 'gMousePinchDesc'],
    ['gTouchScrollTitle', 'gTouchScrollDesc'],
  ],
} as const satisfies Record<string, readonly (readonly [I18nKey, I18nKey])[]>;

interface MobileSessionDockProps {
  locale: Locale;
  touchMode: boolean;
  displays: readonly DisplayInfo[];
  currentDisplay: number;
  quality: QualityLevel;
  audioEnabled: boolean;
  audioIssue: string;
  volume: number;
  viewOnly: boolean;
  privacyAllowed: boolean;
  diagnosticsOpen: boolean;
  onToggleKeyboard: () => void;
  onToggleTouchMode: () => void;
  onSwitchDisplay: (display: number) => void;
  onQuality: (quality: QualityLevel) => void;
  onToggleAudio: () => void;
  onVolume: (volume: number) => void;
  onToggleViewOnly: () => void;
  onFullscreen: () => void;
  onDisconnect: () => void;
  onToggleDiagnostics: () => void;
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
  onScreenshot: () => void;
}

export function MobileSessionDock({
  locale,
  touchMode,
  displays,
  currentDisplay,
  quality,
  audioEnabled,
  audioIssue,
  volume,
  viewOnly,
  privacyAllowed,
  diagnosticsOpen,
  onToggleKeyboard,
  onToggleTouchMode,
  onSwitchDisplay,
  onQuality,
  onToggleAudio,
  onVolume,
  onToggleViewOnly,
  onFullscreen,
  onDisconnect,
  onToggleDiagnostics,
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
  onScreenshot,
}: MobileSessionDockProps) {
  const features = remoteFeatures(classifyRemoteOs(remotePlatform));
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<DockPanel>('toolbar');
  const active = menuOpen ? panel : null;
  const label = (key: I18nKey) => t(locale, key);
  const openPanel = (next: Exclude<DockPanel, 'toolbar'>) => {
    setPanel(menuOpen && panel === next ? 'toolbar' : next);
    setMenuOpen(true);
  };

  const sheet = active && active !== 'toolbar' ? (
    <div
      className="remote-menu-backdrop"
      data-testid="session-backdrop"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) setMenuOpen(false);
      }}
    >
      <section className="remote-menu-panel" role="dialog" aria-label={label(active === 'display' ? 'screens' : active === 'gestures' ? 'dockGuide' : 'moreActions')} data-testid="session-menu">
        {active === 'display' ? (
          <div className="tool-group tool-options">
            {displays.length === 0 ? (
              <button type="button" aria-pressed disabled>
                <Monitor size={18} />
                {`${label('displayFallback')} 1`}
              </button>
            ) : displays.map((display, index) => (
              <button
                key={`${display.name}-${index}`}
                type="button"
                aria-pressed={index === currentDisplay}
                disabled={display.online === false}
                onClick={() => onSwitchDisplay(index)}
              >
                <Monitor size={18} />
                {display.name || `${label('displayFallback')} ${index + 1}`}
              </button>
            ))}
            {features.resolutionChange && resolutions.length > 0 ? (
              <label className="tool-row">
                <span>{label('remoteResolution')}</span>
                <select
                  aria-label={label('remoteResolution')}
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
          </div>
        ) : null}
        {active === 'gestures' ? (
          <div className="tool-group">
            <h2>{label(touchMode ? 'touchModeGestures' : 'mouseModeGestures')}</h2>
            <dl data-testid="gesture-guide">
              {gestureRows[touchMode ? 'touch' : 'mouse'].map(([name, desc]) => (
                <div key={name}>
                  <dt>{label(name)}</dt>
                  <dd>{label(desc)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        {active === 'actions' ? (
          <>
            <div className="tool-group">
              <div className="tool-row tool-heading"><SlidersHorizontal size={18} /><span>{label('sessionQuality')}</span></div>
              <div className="tool-options mode-options">
                {QUALITIES.map((level) => (
                  <button key={level} type="button" aria-pressed={quality === level} onClick={() => onQuality(level)}>
                    {label(qualityKey[level])}
                  </button>
                ))}
              </div>
              <label className="tool-row">
                <Volume2 size={18} />
                <span>{audioEnabled ? label('audioOn') : label('audioOff')}</span>
                <input type="checkbox" role="switch" checked={audioEnabled} onChange={onToggleAudio} />
              </label>
              {audioIssue ? <p role="alert">{translateAudioIssue(locale, audioIssue)}</p> : null}
              <label className="tool-row">
                <span>{label('sessionVolume')}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  aria-label={label('sessionVolume')}
                  onChange={(event) => onVolume(Number(event.target.value))}
                />
              </label>
              <label className="tool-row">
                <Eye size={18} />
                <span>{label('viewOnlyLabel')}</span>
                <input type="checkbox" role="switch" checked={viewOnly} onChange={onToggleViewOnly} />
              </label>
              {features.privacyMode && privacyAllowed ? (
                <label className="tool-row">
                  <Shield size={18} />
                  <span>{label(privacyPending ? 'privacyWaiting' : 'privacyMode')}</span>
                  <input type="checkbox" role="switch" checked={privacyEnabled} disabled={viewOnly || privacyPending} onChange={onTogglePrivacy} />
                </label>
              ) : null}
              {privacyFailed ? <p role="alert">{label('privacyFailed')}</p> : null}
              {!privacyAllowed ? <p>{label('privacyUnavailable')}</p> : null}
            </div>
            <div className="tool-group">
              <button type="button" className="tool-row" aria-pressed={diagnosticsOpen} onClick={onToggleDiagnostics}>
                <SlidersHorizontal size={18} />
                {label('diagTitle')}
              </button>
              {features.ctrlAltDel ? (
                <button type="button" className="tool-row" disabled={viewOnly} onClick={() => onQuickKey('Ctrl+Alt+Del')}>
                  <ShieldAlert size={18} />
                  {label('ctrlAltDel')}
                </button>
              ) : null}
              {features.lockScreen ? (
                <button type="button" className="tool-row" disabled={viewOnly} onClick={() => onQuickKey('Lock')}>
                  <LockKeyhole size={18} />
                  {label('lockScreen')}
                </button>
              ) : null}
              <button type="button" className="tool-row" onClick={onOpenClipboard}>
                <Clipboard size={18} />
                {label('clipboard')}
              </button>
              <button type="button" className="tool-row" onClick={onScreenshot}>
                <Camera size={18} />
                {label('screenshot')}
              </button>
              <button type="button" className="tool-row" onClick={onFullscreen}>
                <Maximize2 size={18} />
                {label('sessionFullscreen')}
              </button>
              {features.restart && restartAllowed ? (
                <button type="button" className="tool-row" disabled={restartNotice === 'requested' || restartNotice === 'waiting'} onClick={onRestart}>
                  <RotateCcw size={18} />
                  {label('restartDevice')}
                </button>
              ) : null}
              {restartNotice ? <p role="status">{label(restartNotice === 'requested' ? 'restartWaiting' : restartNotice === 'waiting' ? 'retryWaiting' : restartNotice === 'failed' ? 'restartFailed' : 'retryEnded')}</p> : null}
              <button type="button" className="tool-row destructive" onClick={onDisconnect}>
                <LogOut size={18} />
                {label('disconnect')}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  ) : null;

  if (!menuOpen) {
    return (
      <div
        className="remote-capsule"
        data-testid="mobile-capsule"
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button type="button" data-testid="mobile-dock-expand" aria-label={label('openSessionMenu')} onClick={() => { setPanel('toolbar'); setMenuOpen(true); }}>
          <ChevronLeft size={20} />
        </button>
        <button type="button" data-testid="capsule-keyboard" aria-label={label('keyboard')} onClick={onToggleKeyboard}>
          <Keyboard size={20} />
        </button>
      </div>
    );
  }

  const ModeIcon = touchMode ? Pointer : MousePointer2;
  return (
    <>
      {sheet}
      <nav className="remote-tools" data-testid="mobile-dock" aria-label={label('session')} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" data-testid="dock-keyboard" onClick={onToggleKeyboard}>
          <Keyboard size={20} />
          <span>{label('keyboard')}</span>
        </button>
        <button
          type="button"
          data-testid="dock-input-mode"
          aria-label={label('toggleInputMode')}
          aria-pressed={touchMode}
          onClick={onToggleTouchMode}
        >
          <ModeIcon size={20} />
          <span>{label(touchMode ? 'touch' : 'mouse')}</span>
        </button>
        <button type="button" data-testid="dock-display" className={active === 'display' ? 'selected' : ''} onClick={() => openPanel('display')}>
          <Monitor size={20} />
          <span>{label('screens')}</span>
        </button>
        <button type="button" data-testid="dock-gestures" className={active === 'gestures' ? 'selected' : ''} onClick={() => openPanel('gestures')}>
          <CircleHelp size={20} />
          <span>{label('dockGuide')}</span>
        </button>
        <button type="button" data-testid="dock-menu" className={active === 'actions' ? 'selected' : ''} onClick={() => openPanel('actions')}>
          <Layers2 size={20} />
          <span>{label('moreActions')}</span>
        </button>
        <button type="button" data-testid="dock-collapse" aria-label={label('dockHideControls')} onClick={() => setMenuOpen(false)}>
          <ChevronRight size={20} />
        </button>
      </nav>
    </>
  );
}
