// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { Activity, Clipboard, LockKeyhole, LogOut, RotateCcw, Shield, Volume2 } from 'lucide-react';
import { t, type Locale } from '../../lib/i18n.ts';
import { MobileMenuSwitch } from './MobileMenuSwitch.tsx';

export interface MobileActionsMenuProps {
  locale: Locale;
  viewOnly: boolean;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  clipboardSync: boolean;
  clipboardPermitted: boolean;
  onToggleClipboardSync: () => void;
  privacyAllowed: boolean;
  privacyEnabled: boolean;
  privacyPending: boolean;
  onTogglePrivacy: () => void;
  diagnosticsOpen: boolean;
  onToggleDiagnostics: () => void;
  restartAllowed: boolean;
  restartPending: boolean;
  onRestart: () => void;
  onDisconnect: () => void;
}

export function MobileActionsMenu({
  locale,
  viewOnly,
  audioEnabled,
  onToggleAudio,
  clipboardSync,
  clipboardPermitted,
  onToggleClipboardSync,
  privacyAllowed,
  privacyEnabled,
  privacyPending,
  onTogglePrivacy,
  diagnosticsOpen,
  onToggleDiagnostics,
  restartAllowed,
  restartPending,
  onRestart,
  onDisconnect,
  canLockScreen,
  onLockScreen,
}: MobileActionsMenuProps & {
  canLockScreen: boolean;
  onLockScreen: () => void;
}) {
  return (
    <>
      <div className="tool-group">
        <MobileMenuSwitch icon={Volume2} label={t(locale, 'remoteAudio')} checked={audioEnabled} onChange={onToggleAudio} />
        <MobileMenuSwitch icon={Clipboard} label={t(locale, 'clipSync')} checked={clipboardSync}
          disabled={!clipboardPermitted} onChange={onToggleClipboardSync} />
        {privacyAllowed ? (
          <MobileMenuSwitch icon={Shield} label={t(locale, 'privacyMode')} checked={privacyEnabled}
            disabled={viewOnly || privacyPending} onChange={onTogglePrivacy} />
        ) : null}
      </div>
      <div className="tool-group">
        <button type="button" className="tool-row" aria-pressed={diagnosticsOpen} onClick={onToggleDiagnostics}>
          <Activity size={18} aria-hidden="true" />
          {t(locale, 'diagTitle')}
        </button>
      </div>
      <div className="tool-group">
        {restartAllowed ? (
          <button type="button" className="tool-row" disabled={restartPending} onClick={onRestart}>
            <RotateCcw size={18} aria-hidden="true" />
            {t(locale, 'restartDevice')}
          </button>
        ) : null}
        <button type="button" className="tool-row" disabled={!canLockScreen || viewOnly} onClick={onLockScreen}>
          <LockKeyhole size={18} aria-hidden="true" />
          {t(locale, 'lockScreen')}
        </button>
        <button type="button" className="tool-row destructive" onClick={onDisconnect}>
          <LogOut size={18} aria-hidden="true" />
          {t(locale, 'disconnectRemote')}
        </button>
      </div>
    </>
  );
}
