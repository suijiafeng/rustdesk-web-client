// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useState } from 'react';
import type { DisplayInfo } from '@rustdesk-web/shared';
import {
  Activity, Camera, Clipboard, Eye, Focus, Hand, LockKeyhole, Maximize2, MessageSquare,
  Monitor, MousePointer2, Power, RotateCcw, Shield, Sliders, Volume2, X, type LucideIcon,
} from 'lucide-react';
import { t, type I18nKey } from '../lib/i18n.ts';
import { ResolutionSelect } from './ResolutionSelect.tsx';
import { SessionDisplayControls, type SessionDisplayControlsProps } from './SessionDisplayControls.tsx';
import { useToast } from './ToastProvider.tsx';

interface DesktopSessionMenuProps extends Omit<SessionDisplayControlsProps, 'rows' | 'onRequestSent'> {
  hostTitle: string;
  remotePlatform: string;
  encrypted: boolean;
  rttMs: number | null;
  displays: readonly DisplayInfo[];
  currentDisplay: number;
  frameWidth: number;
  frameHeight: number;
  resolutions: readonly { width: number; height: number }[];
  decoderError: string;
  touchMode: boolean;
  viewOnly: boolean;
  audioEnabled: boolean;
  volume: number;
  clipboardSync: boolean;
  clipboardAllowed: boolean;
  privacyAllowed: boolean;
  privacyEnabled: boolean;
  privacyPending: boolean;
  restartAllowed: boolean;
  restartPending: boolean;
  lockAllowed: boolean;
  followWindow: boolean;
  diagnosticsOpen: boolean;
  onSwitchDisplay: (display: number) => boolean;
  onResolution: (width: number, height: number) => boolean;
  onToggleTouchMode: () => void;
  onToggleAudio: () => void;
  onVolume: (volume: number) => void;
  onToggleClipboardSync: () => void;
  onTogglePrivacy: () => void;
  onRestart: () => void;
  onLock: () => void;
  onDisconnect: () => void;
  onToggleViewOnly: () => void;
  onFullscreen: () => void;
  onScreenshot: () => void;
  onOpenChat: () => void;
  onOpenClipboard: () => void;
  onToggleFollowWindow: () => void;
  onOpenDiagnostics: () => void;
  onOpenConnection: () => void;
  onClose: () => void;
}

function MenuSwitch({ icon: Icon, label, checked, disabled, onChange }: {
  icon: LucideIcon; label: string; checked: boolean; disabled?: boolean; onChange: () => void;
}) {
  return (
    <label className="session-setting-row">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <input className="ui-switch" type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

const tabs = [
  { id: 'control', label: 'menuTabControl', icon: Sliders },
  { id: 'display', label: 'menuTabDisplay', icon: Monitor },
] as const;

export function DesktopSessionMenu({
  locale, hostTitle, remotePlatform, encrypted, rttMs, displays, currentDisplay, frameWidth, frameHeight,
  resolutions, decoderError, touchMode, viewOnly, audioEnabled, volume, clipboardSync, clipboardAllowed,
  privacyAllowed, privacyEnabled, privacyPending, restartAllowed, restartPending, lockAllowed, followWindow,
  diagnosticsOpen, onSwitchDisplay, onResolution, onToggleTouchMode, onToggleAudio, onVolume,
  onToggleClipboardSync, onTogglePrivacy, onRestart, onLock, onDisconnect, onToggleViewOnly, onFullscreen,
  onScreenshot, onOpenChat, onOpenClipboard, onToggleFollowWindow, onOpenDiagnostics, onOpenConnection,
  onClose, ...displayControls
}: DesktopSessionMenuProps) {
  const [activeTab, setActiveTab] = useState<'control' | 'display'>('control');
  const showToast = useToast();
  const label = (key: I18nKey) => t(locale, key);
  const showRequestSent = (option: string) => showToast(`${label('displayRequestSent')} · ${option}`);
  const multipleDisplays = displays.length > 1;

  function selectInputMode(nextTouchMode: boolean) {
    if (touchMode === nextTouchMode) return;
    onToggleTouchMode();
    showToast(label(nextTouchMode ? 'touch' : 'mouse'));
  }

  return (
    <div className="scrim" data-testid="session-backdrop" onPointerDown={(event) => {
      event.stopPropagation();
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="sheet sheet-menu" data-testid="session-menu" role="dialog" aria-label={label('session')}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
        <header className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--rd-divider)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold m-0 truncate">{hostTitle}</h2>
              <span className="rd-status live" data-testid="status">{label('statusLive')}</span>
            </div>
            <p className="text-xs text-[var(--ink-soft)] m-0 mt-0.5 truncate" data-testid="detail">
              {remotePlatform} · {label(encrypted ? 'linkEncrypted' : 'linkPlain')}
              {rttMs ? ` · ${rttMs} ms` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" className={`rd-btn${diagnosticsOpen ? ' active' : ''}`}
              aria-label={label('diagTitle')} onClick={onOpenDiagnostics}><Activity size={16} /></button>
            <button type="button" className="rd-btn" data-testid="session-close"
              autoFocus aria-label={label('close')} onClick={onClose}><X size={16} /></button>
          </div>
        </header>
        <div className="rd-session-tabs" role="tablist" aria-label={label('session')}>
          {tabs.map(({ id, icon: Icon, label: title }) => (
            <button key={id} type="button" role="tab" className={`rd-session-tab${activeTab === id ? ' active' : ''}`}
              aria-selected={activeTab === id} data-testid={`menu-tab-${id}`} onClick={() => setActiveTab(id)}>
              <Icon size={14} /><span>{label(title)}</span>
            </button>
          ))}
        </div>
        <div className="session-menu-body" key={activeTab}>
          {activeTab === 'control' ? (
            <div role="tabpanel">
              <div className="session-group session-mode-switch" role="group" aria-label={label('input')}>
                <button type="button" aria-pressed={touchMode} onClick={() => selectInputMode(true)}><Hand size={18} />{label('touch')}</button>
                <button type="button" aria-pressed={!touchMode} onClick={() => selectInputMode(false)}><MousePointer2 size={18} />{label('mouse')}</button>
              </div>
              <div className="session-group">
                <MenuSwitch icon={Volume2} label={label('remoteAudio')} checked={audioEnabled} onChange={onToggleAudio} />
                <MenuSwitch icon={Clipboard} label={label('clipSync')} checked={clipboardSync} disabled={!clipboardAllowed} onChange={onToggleClipboardSync} />
                {privacyAllowed && <MenuSwitch icon={Shield} label={label('privacyMode')} checked={privacyEnabled}
                  disabled={viewOnly || privacyPending} onChange={onTogglePrivacy} />}
              </div>
              <div className="session-group">
                {restartAllowed && <button type="button" className="session-setting-row" disabled={restartPending} onClick={onRestart}><RotateCcw /><span>{label('restartDevice')}</span></button>}
                <button type="button" className="session-setting-row" disabled={viewOnly || !lockAllowed} onClick={onLock}><LockKeyhole /><span>{label('lockScreen')}</span></button>
                <button type="button" className="session-setting-row destructive" data-testid="disconnect" onClick={onDisconnect}><Power /><span>{label('disconnectRemote')}</span></button>
              </div>
              <details className="session-extra-actions">
                <summary>{label('otherSectionTitle')}</summary>
                <MenuSwitch icon={Eye} label={label('viewOnlyLabel')} checked={viewOnly} onChange={onToggleViewOnly} />
                <label className="session-setting-row"><Volume2 /><span>{label('sessionVolume')}</span>
                  <input aria-label={label('sessionVolume')} type="range" min={0} max={1} step={0.05} value={volume}
                    onChange={(event) => onVolume(Number(event.target.value))} />
                </label>
                <button type="button" className="session-setting-row" onClick={onOpenClipboard}><Clipboard /><span>{label('clipboard')}</span></button>
                <button type="button" className="session-setting-row" onClick={onOpenChat}><MessageSquare /><span>{label('chat')}</span></button>
                <button type="button" className="session-setting-row" onClick={onScreenshot}><Camera /><span>{label('screenshot')}</span></button>
                <button type="button" className="session-setting-row" onClick={onFullscreen}><Maximize2 /><span>{label('sessionFullscreen')}</span></button>
              </details>
            </div>
          ) : (
            <div role="tabpanel">
              {multipleDisplays && (
                <div className="session-group session-mode-switch" role="group" aria-label={label('displays')}>
                  {displays.map((display) => {
                    const name = display.name || `${label('screens')} ${display.index + 1}`;
                    return <button type="button" key={display.index} aria-pressed={display.index === currentDisplay}
                      disabled={display.online === false} onClick={() => { if (onSwitchDisplay(display.index)) showRequestSent(name); }}>
                      <Monitor size={18} />{name}
                    </button>;
                  })}
                </div>
              )}
              <div className="session-group">
                {resolutions.length > 0 && (
                  <div className="session-setting-row">
                    <Monitor /><span>{label('remoteResolution')}</span>
                    <ResolutionSelect label={label('remoteResolution')} tone="settings" resolutions={resolutions}
                      frameWidth={frameWidth} frameHeight={frameHeight} disabled={viewOnly}
                      onSelect={(width, height) => { if (onResolution(width, height)) showRequestSent(`${width} × ${height}`); }} />
                  </div>
                )}
                <SessionDisplayControls locale={locale} {...displayControls} rows="desktop" onRequestSent={showRequestSent} />
              </div>
              {multipleDisplays && <div className="session-group">
                <MenuSwitch icon={Focus} label={label('followWindow')} checked={followWindow} onChange={() => {
                  onToggleFollowWindow();
                  showToast(`${label('followWindow')} · ${label(followWindow ? 'optionOff' : 'optionOn')}`);
                }} />
              </div>}
            </div>
          )}
          {decoderError && <p data-testid="decoder-error" role="alert" className="text-[var(--bad)]">{decoderError}</p>}
        </div>
        <footer className="session-menu-footer">
          <button type="button" className="session-setting-row" onClick={onOpenConnection}><Monitor /><span>{label('connectionManage')}</span></button>
        </footer>
      </section>
    </div>
  );
}
