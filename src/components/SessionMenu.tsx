import { ConfirmDialog, RestartAction } from './RestartAction';
import { ScrollDirectionSelect } from './ScrollDirectionSelect';
import { MobileSessionPanel, type MobileSessionPanelProps } from './MobileSessionPanel';
import { SessionDisplayControls } from './SessionDisplayControls';
import React, { useState } from 'react';
import {
  ArrowDownUp,
  Clipboard, LockKeyhole, Volume2, Hand, MousePointer2,
  Power,
  Sliders,
  Monitor,
  X,
} from 'lucide-react';
import { formatConnectionError } from '../lib/errors';
import { statusLabel, t, type Locale } from '../lib/i18n';
import { type CodecSupport, type PeerMessage, type QualityLevel } from '../lib/protocol';
import type { ConnectionPhase } from './RustDeskShell';

import { type PreferredCodec } from '../lib/displayPrefs';
import { useSessionStats, type SessionStats, type SessionStatsStore } from '../lib/sessionStats';
export type { SessionStats } from '../lib/sessionStats';

type MenuTab = 'control' | 'display';

export interface SessionMenuProps {
  clipboardSync: boolean;
  clipboardAllowed: boolean;
  onToggleClipboardSync: () => void;
  onNotify: (text: string, error?: boolean) => void;
  locale: Locale;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  mobileLayout: boolean;
  followWindow: boolean;
  onToggleFollowWindow: () => void;
  phase: ConnectionPhase;
  peer: PeerMessage | null;
  decoderError: string;
  display: number;
  touchMode: boolean;
  viewOnly: boolean;
  sizes: { width: number; height: number }[];
  onResolution: (width: number, height: number) => void;
  diagnosticsOpen: boolean;
  stats: SessionStats;
  rtt: number;
  quality: QualityLevel;
  customQuality: number;
  targetFps: number;
  preferredCodec: PreferredCodec;
  codecSupport?: CodecSupport | null;
  privacyEnabled: boolean;
  privacyPending: boolean;
  onTogglePrivacy: () => void;
  onClose: () => void;
  onOpenConnection: () => void;
  onRestart: () => void;
  onDisconnect: () => void;
  onToggleDiagnostics: () => void;
  onToggleTouchMode: () => void;
  reverseScroll: boolean;
  onReverseScrollChange: (reverse: boolean) => void;
  onSwitchDisplay: (index: number) => void;
  onQuickKey: (name: 'Esc' | 'Tab' | 'Ctrl+C' | 'Ctrl+V' | 'Ctrl+Alt+Del' | 'Lock') => void;
  onChangeQuality: (quality: QualityLevel, fps: number, codec?: PreferredCodec, customQuality?: number) => void;
}

export function SessionMenu({ statsStore, ...props }: Omit<MobileSessionPanelProps, 'stats'> & { statsStore: SessionStatsStore }) {
  const stats = useSessionStats(statsStore);
  if (props.mobileLayout) return <MobileSessionPanel key={props.mobilePanel} {...props} stats={stats} />;
  return <DesktopSessionMenu {...props} stats={stats} />;
}

function DesktopSessionMenu({
  clipboardSync, clipboardAllowed, onToggleClipboardSync,
  privacyEnabled, privacyPending, onTogglePrivacy, onNotify,
  locale,
  audioEnabled,
  onToggleAudio,
  followWindow,
  onToggleFollowWindow,
  phase,
  peer,
  decoderError,
  display,
  touchMode,
  viewOnly,
  sizes, onResolution,
  diagnosticsOpen,
  stats,
  rtt,
  quality,
  customQuality,
  targetFps,
  preferredCodec,
  codecSupport,
  onClose,
  onOpenConnection,
  onRestart,
  onDisconnect,
  onToggleDiagnostics,
  onToggleTouchMode,
  reverseScroll, onReverseScrollChange,
  onSwitchDisplay,
  onQuickKey,
  onChangeQuality,
}: SessionMenuProps) {
  const [activeTab, setActiveTab] = useState<MenuTab>('control');
  const [pendingConfirm, setPendingConfirm] = useState<'lock' | 'disconnect' | null>(null);

  const displays = peer?.displays ?? [];
  const hasMultipleDisplays = displays.length > 1;
  const resolutionIndex = sizes.findIndex(s => s.width === stats.width && s.height === stats.height);
  const hostTitle = peer?.hostname || peer?.username || 'Host';
  const platformLabel = peer?.platform || 'remote';
  const linkLabel = peer?.encrypted ? t(locale, 'linkEncrypted') : t(locale, 'linkPlain');
  const displayRtt = rtt || stats.delayMs;

  const tabs: Array<{ id: MenuTab; label: string; icon: React.ReactNode }> = [
    { id: 'control', label: t(locale, 'menuTabControl'), icon: <Sliders size={14} /> },
    { id: 'display', label: t(locale, 'menuTabDisplay'), icon: <Monitor size={14} /> },
  ];

  return (
    <div
      className="scrim"
      data-testid="session-backdrop"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="sheet sheet-menu"
        data-testid="session-menu"
        role="dialog"
        aria-label={t(locale, 'session')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="sm:hidden w-10 h-1 rounded-full bg-[var(--line)] mx-auto mb-2.5"
          aria-hidden="true"
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--rd-divider)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--ink)] m-0 truncate">
                {hostTitle}
              </h2>
              <span className={`rd-status ${phase}`} data-testid="status">
                {statusLabel(locale, phase)}
              </span>
            </div>
            <p className="text-xs text-[var(--ink-soft)] m-0 mt-0.5 truncate" data-testid="detail">
              {platformLabel} · {linkLabel}
              {displayRtt > 0 ? ` · ${displayRtt} ms` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              className="rd-btn"
              style={{ minWidth: 36, minHeight: 36, padding: 6 }}
              data-testid="session-close"
              aria-label={t(locale, 'close')}
              data-tooltip={t(locale, 'close')}
              data-tooltip-pos="bottom-end"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Session tabs */}
        <div
          className="rd-session-tabs"
          role="tablist"
          aria-label={t(locale, 'session')}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              data-testid={`menu-tab-${tab.id}`}
              className={`rd-session-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="session-menu-body" key={activeTab}>
          {activeTab === 'control' && (
            <div role="tabpanel">
              <div className="session-group session-mode-switch" role="group" aria-label={t(locale, 'input')}>
                <button type="button" aria-pressed={touchMode} onClick={() => {
                  if (!touchMode) { onToggleTouchMode(); onNotify(t(locale, 'touch')); }
                }}><Hand size={18} />{t(locale, 'touch')}</button>
                <button type="button" aria-pressed={!touchMode} onClick={() => {
                  if (touchMode) { onToggleTouchMode(); onNotify(t(locale, 'mouse')); }
                }}><MousePointer2 size={18} />{t(locale, 'mouse')}</button>
              </div>
              <div className="session-group">
                <label className="session-setting-row"><ArrowDownUp /><span>{t(locale, 'scrollDirection')}</span>
                  <ScrollDirectionSelect locale={locale} tone="remote" testId="session-reverse-scroll"
                  reverse={reverseScroll} onChange={onReverseScrollChange} />
                </label>
                <label className="session-setting-row"><Volume2 /><span>{t(locale, 'remoteAudio')}</span>
                  <input className="ui-switch" type="checkbox" role="switch" checked={audioEnabled} onChange={onToggleAudio} />
                </label>
                <label className="session-setting-row"><Clipboard /><span>{t(locale, 'clipSync')}</span>
                  <input className="ui-switch" type="checkbox" role="switch" checked={clipboardSync} disabled={!clipboardAllowed} onChange={onToggleClipboardSync} />
                </label>
              </div>
              <div className="session-group">
                {peer?.restartAllowed && <RestartAction locale={locale} className="session-setting-row" onConfirm={onRestart} />}
                <button type="button" className="session-setting-row" onClick={() => setPendingConfirm('lock')}><LockKeyhole /><span>{t(locale, 'lockScreen')}</span></button>
                <button type="button" className="session-setting-row destructive" data-testid="disconnect" onClick={() => setPendingConfirm('disconnect')}><Power /><span>{t(locale, 'disconnectRemote')}</span></button>
              </div>
              <ConfirmDialog
                open={pendingConfirm !== null}
                locale={locale}
                title={t(locale, pendingConfirm === 'lock' ? 'lockScreen' : 'disconnectRemote')}
                description={t(locale, pendingConfirm === 'lock' ? 'confirmLock' : 'confirmDisconnect')}
                confirmLabel={t(locale, pendingConfirm === 'lock' ? 'lockScreen' : 'disconnectRemote')}
                onClose={() => setPendingConfirm(null)}
                onConfirm={() => {
                  if (pendingConfirm === 'lock') onQuickKey('Lock');
                  else if (pendingConfirm === 'disconnect') onDisconnect();
                }}
              />
            </div>
          )}
          {activeTab === 'display' && (
            <div role="tabpanel">
              <SessionDisplayControls
                variant="desktop"
                locale={locale}
                peer={peer}
                display={display}
                viewOnly={viewOnly}
                stats={stats}
                sizes={sizes}
                quality={quality}
                customQuality={customQuality}
                targetFps={targetFps}
                preferredCodec={preferredCodec}
                codecSupport={codecSupport}
                privacyEnabled={privacyEnabled}
                privacyPending={privacyPending}
                followWindow={followWindow}
                onSwitchDisplay={onSwitchDisplay}
                onTogglePrivacy={onTogglePrivacy}
                onResolution={onResolution}
                onChangeQuality={onChangeQuality}
                onToggleFollowWindow={onToggleFollowWindow}
                onNotify={onNotify}
              />
            </div>
          )}

          {decoderError && (
            <div
              className="mt-3 rounded-lg border border-[var(--rd-err-border)] bg-[var(--bad-bg)] px-3 py-2 text-xs text-[var(--bad)] leading-relaxed"
              data-testid="decoder-error"
              role="alert"
            >
              {formatConnectionError(locale, decoderError).message}
            </div>
          )}

        </div>
        <div className="session-menu-footer">
          <button type="button" className="session-setting-row" onClick={onOpenConnection}>
            <Monitor /><span>{t(locale, 'connectionManage')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
