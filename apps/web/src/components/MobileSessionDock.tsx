// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useState } from 'react';
import type { DisplayInfo, QualityLevel } from '@rustdesk-web/shared';
import {
  Activity,
  Focus,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Keyboard,
  LockKeyhole,
  Layers2,
  LogOut,
  Shield,
  Monitor,
  MousePointer2,
  Pointer,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import { t, translateAudioIssue, type I18nKey, type Locale } from '../lib/i18n.ts';
import { classifyRemoteOs, remoteFeatures } from '../lib/platform.ts';
import { ResolutionSelect } from './ResolutionSelect.tsx';
import { SessionDisplayControls, type SessionDisplayControlsProps } from './SessionDisplayControls.tsx';

type DockPanel = 'toolbar' | 'display' | 'gestures' | 'actions';

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

interface MobileSessionDockProps extends Pick<SessionDisplayControlsProps, 'targetFps' | 'codec' | 'codecSupport' | 'onFps' | 'onCodec'> {
  locale: Locale;
  touchMode: boolean;
  displays: readonly DisplayInfo[];
  currentDisplay: number;
  quality: QualityLevel;
  audioEnabled: boolean;
  audioIssue: string;
  viewOnly: boolean;
  privacyAllowed: boolean;
  followWindow: boolean;
  clipboardSync: boolean;
  clipboardPermitted: boolean;
  onToggleFollowWindow: () => void;
  onToggleClipboardSync: () => void;
  diagnosticsOpen: boolean;
  onToggleKeyboard: () => void;
  onToggleTouchMode: () => void;
  onSwitchDisplay: (display: number) => void;
  onQuality: (quality: QualityLevel) => void;
  onToggleAudio: () => void;
  onDisconnect: () => void;
  onToggleDiagnostics: () => void;
  remotePlatform: string;
  onQuickKey: (name: 'Ctrl+Alt+Del' | 'Lock') => void;
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

export function MobileSessionDock({
  locale,
  touchMode,
  displays,
  currentDisplay,
  quality,
  targetFps,
  codec,
  codecSupport,
  onFps,
  onCodec,
  audioEnabled,
  audioIssue,
  viewOnly,
  privacyAllowed,
  followWindow,
  clipboardSync,
  clipboardPermitted,
  onToggleFollowWindow,
  onToggleClipboardSync,
  diagnosticsOpen,
  onToggleKeyboard,
  onToggleTouchMode,
  onSwitchDisplay,
  onQuality,
  onToggleAudio,
  onDisconnect,
  onToggleDiagnostics,
  remotePlatform,
  onQuickKey,
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
}: MobileSessionDockProps) {
  const features = remoteFeatures(classifyRemoteOs(remotePlatform));
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<DockPanel>('toolbar');
  const active = menuOpen ? panel : null;
  const label = (key: I18nKey) => t(locale, key);
  const openPanel = (next: Exclude<DockPanel, 'toolbar'>) => {
    setPanel(next);
    setMenuOpen(true);
  };

  const toggle = (Icon: typeof Monitor, key: I18nKey, checked: boolean, onChange: () => void, disabled = false) => (
    <label className="tool-row">
      <Icon size={18} aria-hidden="true" />
      <span>{label(key)}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );

  const sheet = active ? (
    <div
      className="remote-menu-backdrop"
      data-testid="session-backdrop"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) setMenuOpen(false);
      }}
    >
      {active !== 'toolbar' ? (
        <section className="remote-menu-panel" role="dialog" aria-label={label(active === 'display' ? 'screens' : active === 'gestures' ? 'dockGuide' : 'moreActions')} data-testid="session-menu">
          {active === 'display' ? (
            <>
              {displays.length > 1 ? (
                <div className="tool-group tool-options">
                  {displays.map((display, index) => (
                    <button key={`${display.name}-${index}`} type="button" aria-pressed={index === currentDisplay}
                      disabled={display.online === false} onClick={() => onSwitchDisplay(index)}>
                      <Monitor size={18} aria-hidden="true" />
                      {display.name || `${label('screens')} ${index + 1}`}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="tool-group">
                {features.resolutionChange && resolutions.length > 0 ? (
                  <div className="tool-row">
                    <Monitor size={18} aria-hidden="true" />
                    <span>{label('remoteResolution')}</span>
                    <ResolutionSelect label={label('remoteResolution')} resolutions={resolutions}
                      frameWidth={frameWidth} frameHeight={frameHeight} disabled={viewOnly} onSelect={onResolution} />
                  </div>
                ) : null}
                <SessionDisplayControls locale={locale} quality={quality} targetFps={targetFps} codec={codec}
                  codecSupport={codecSupport} onQuality={onQuality} onFps={onFps} onCodec={onCodec} rows />
              </div>
              {displays.length > 1 ? (
                <div className="tool-group">{toggle(Focus, 'followWindow', followWindow, onToggleFollowWindow)}</div>
              ) : null}
            </>
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
                {toggle(Volume2, 'remoteAudio', audioEnabled, onToggleAudio)}
                {toggle(Clipboard, 'clipSync', clipboardSync, onToggleClipboardSync, !clipboardPermitted)}
                {features.privacyMode && privacyAllowed
                  ? toggle(Shield, 'privacyMode', privacyEnabled, onTogglePrivacy, viewOnly || privacyPending)
                  : null}
                {audioIssue ? <p role="alert">{translateAudioIssue(locale, audioIssue)}</p> : null}
                {privacyFailed ? <p role="alert">{label('privacyFailed')}</p> : null}
              </div>
              <div className="tool-group">
                <button type="button" className="tool-row" aria-pressed={diagnosticsOpen} onClick={onToggleDiagnostics}>
                  <Activity size={18} aria-hidden="true" />
                  {label('diagTitle')}
                </button>
              </div>
              <div className="tool-group">
                {features.restart && restartAllowed ? (
                  <button type="button" className="tool-row" disabled={restartNotice === 'requested' || restartNotice === 'waiting'} onClick={onRestart}>
                    <RotateCcw size={18} aria-hidden="true" />
                    {label('restartDevice')}
                  </button>
                ) : null}
                {restartNotice ? <p role="status">{label(restartNotice === 'requested' ? 'restartWaiting' : restartNotice === 'waiting' ? 'retryWaiting' : restartNotice === 'failed' ? 'restartFailed' : 'retryEnded')}</p> : null}
                <button type="button" className="tool-row" disabled={!features.lockScreen || viewOnly} onClick={() => onQuickKey('Lock')}>
                  <LockKeyhole size={18} aria-hidden="true" />
                  {label('lockScreen')}
                </button>
                <button type="button" className="tool-row destructive" onClick={onDisconnect}>
                  <LogOut size={18} aria-hidden="true" />
                  {label('disconnectRemote')}
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
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
          aria-pressed={!touchMode}
          className={!touchMode ? 'selected' : undefined}
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
