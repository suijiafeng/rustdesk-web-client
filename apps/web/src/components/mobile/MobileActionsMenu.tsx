// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { Activity, Clipboard, LockKeyhole, LogOut, RotateCcw, Shield, Volume2 } from 'lucide-react';
import { t, translateAudioIssue, type Locale } from '../../lib/i18n.ts';
import { MobileMenuSwitch } from './MobileMenuSwitch.tsx';

const restartStatusLabels = {
  requested: 'restartWaiting',
  waiting: 'retryWaiting',
  failed: 'restartFailed',
  ended: 'retryEnded',
} as const;

export interface MobileActionsMenuProps {
  locale: Locale;
  viewOnly: boolean;
  audioEnabled: boolean;
  audioIssue: string;
  onToggleAudio: () => void;
  clipboardSync: boolean;
  clipboardPermitted: boolean;
  onToggleClipboardSync: () => void;
  privacyAllowed: boolean;
  privacyEnabled: boolean;
  privacyPending: boolean;
  privacyFailed: boolean;
  onTogglePrivacy: () => void;
  diagnosticsOpen: boolean;
  onToggleDiagnostics: () => void;
  restartAllowed: boolean;
  restartNotice: keyof typeof restartStatusLabels | null;
  onRestart: () => void;
  onDisconnect: () => void;
}

export function MobileActionsMenu({
  locale,
  viewOnly,
  audioEnabled,
  audioIssue,
  onToggleAudio,
  clipboardSync,
  clipboardPermitted,
  onToggleClipboardSync,
  privacyAllowed,
  privacyEnabled,
  privacyPending,
  privacyFailed,
  onTogglePrivacy,
  diagnosticsOpen,
  onToggleDiagnostics,
  restartAllowed,
  restartNotice,
  onRestart,
  onDisconnect,
  canLockScreen,
  onLockScreen,
}: MobileActionsMenuProps & {
  canLockScreen: boolean;
  onLockScreen: () => void;
}) {
  const restartPending = restartNotice === 'requested' || restartNotice === 'waiting';

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
        {audioIssue ? <p role="alert">{translateAudioIssue(locale, audioIssue)}</p> : null}
        {privacyFailed ? <p role="alert">{t(locale, 'privacyFailed')}</p> : null}
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
        {restartNotice ? <p role="status">{t(locale, restartStatusLabels[restartNotice])}</p> : null}
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
