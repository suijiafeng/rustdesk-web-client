import { RestartAction } from './RestartAction';
import { AdaptiveSelect } from './AdaptiveSelect';
import { ScrollDirectionSelect } from './ScrollDirectionSelect';
import { MobileSessionPanel, type MobileSessionPanelProps } from './MobileSessionPanel';
import React, { useState } from 'react';
import {
  Activity, ArrowDownUp,
  Clipboard, Shield, LockKeyhole, Volume2, Gauge, Film, Focus, Hand, MousePointer2,
  Power,
  Sliders,
  Monitor,
  X,
} from 'lucide-react';
import { formatConnectionError } from '../lib/errors';
import { statusLabel, t, type Locale } from '../lib/i18n';
import { type CodecSupport, type PeerMessage, type QualityLevel } from '../lib/protocol';
import type { ConnectionPhase } from './RustDeskShell';

import { formatCodecLabel, PREFERRED_CODEC_OPTIONS, type PreferredCodec } from '../lib/displayPrefs';
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
                <button type="button" className="session-setting-row" onClick={() => onQuickKey('Lock')}><LockKeyhole /><span>{t(locale, 'lockScreen')}</span></button>
                <button type="button" className="session-setting-row destructive" data-testid="disconnect" onClick={onDisconnect}><Power /><span>{t(locale, 'disconnectRemote')}</span></button>
              </div>
            </div>
          )}
          {activeTab === 'display' && (
            <div role="tabpanel">
              {hasMultipleDisplays && <div className="session-group session-mode-switch" role="group" aria-label={t(locale, 'displays')}>
                {displays.map(d => <button key={d.index} type="button" aria-pressed={d.index === display} disabled={d.online === false}
                  onClick={() => { onSwitchDisplay(d.index); onNotify(t(locale, 'requestSent')+' · '+(d.name || t(locale, 'screens')+' '+(d.index+1))); }}>
                  <Monitor size={18} />{d.name || t(locale, 'screens')+' '+(d.index+1)}</button>)}
              </div>}
              <div className="session-group">
                <button type="button" className={`session-setting-row${diagnosticsOpen ? ' active' : ''}`}
                  data-testid="screen-connection-details" onClick={onToggleDiagnostics}>
                  <Activity size={16} /><span>{t(locale, 'diagTitle')}</span>
                </button>
                {peer?.privacyAllowed && <label className="session-setting-row"><Shield /><span>{t(locale, 'privacyMode')}</span>
                  <input className="ui-switch" type="checkbox" role="switch" checked={privacyEnabled} disabled={privacyPending || viewOnly} onChange={onTogglePrivacy} />
                </label>}
                {sizes.length > 0 && <label className="session-setting-row"><Monitor /><span>{t(locale, 'remoteResolution')}</span>
                  <AdaptiveSelect label={t(locale, 'remoteResolution')} testId="resolution-select" disabled={viewOnly} value={String(resolutionIndex)}
                    options={[...(resolutionIndex < 0 ? [{ value: '-1', label: `${stats.width} × ${stats.height}`, disabled: true }] : []), ...sizes.map((s,i) => ({ value: String(i), label: `${s.width} × ${s.height}` }))]}
                    onChange={value => { const size = sizes[Number(value)]; if (size) { onResolution(size.width, size.height); onNotify(t(locale, 'requestSent')+' · '+size.width+' × '+size.height); } }} />
                </label>}
                <label className="session-setting-row"><Sliders /><span>{t(locale, 'qualityAndFps')}</span>
                  <AdaptiveSelect label={t(locale, 'qualityAndFps')} testId="quality-select" value={quality}
                    options={[{ value: 'low', label: t(locale, 'qualityLow') }, { value: 'balanced', label: t(locale, 'qualityBalanced') }, { value: 'best', label: t(locale, 'qualityBest') }, { value: 'custom', label: t(locale, 'qualityCustom') }]}
                    onChange={value => { onChangeQuality(value as QualityLevel, targetFps); onNotify(t(locale, 'requestSent')+' · '+t(locale, value === 'low' ? 'qualityLow' : value === 'best' ? 'qualityBest' : value === 'custom' ? 'qualityCustom' : 'qualityBalanced')); }} />
                </label>
                {quality === 'custom' && <div className="rd-slider-group">
                  <label className="rd-slider-row">
                    <input type="range" className="rd-range" min={20} max={200} step={2}
                      value={customQuality} aria-label={t(locale, 'qualityRatioLabel')} data-testid="session-custom-quality"
                      onChange={event => onChangeQuality('custom', targetFps, preferredCodec, Number(event.target.value))} />
                    <span className="rd-slider-val font-mono-tabular">{customQuality}%</span>
                    <span className="rd-slider-label">{t(locale, 'qualityRatioLabel')}</span>
                  </label>
                  <p className="text-xs text-[var(--ink-soft)]">{t(locale, 'qualityRatioHint')}</p>
                </div>}
                <label className="session-setting-row"><Gauge /><span>{t(locale, 'targetFps')}</span>
                  <AdaptiveSelect label={t(locale, 'targetFps')} testId="fps-select" value={String(targetFps)}
                    options={[...new Set([15,30,60,targetFps])].sort((a,b) => a-b).map(n => ({ value: String(n), label: `${n} FPS` }))}
                    onChange={value => { onChangeQuality(quality, Number(value), preferredCodec); onNotify(t(locale, 'requestSent')+' · '+value+' FPS'); }} />
                </label>
                <label className="session-setting-row"><Film /><span>{t(locale, 'sessionCodecLabel')}</span>
                  <AdaptiveSelect label={t(locale, 'sessionCodecLabel')} testId="codec-select" value={preferredCodec}
                    options={PREFERRED_CODEC_OPTIONS.map(value => ({
                      value,
                      label: formatCodecLabel(value, t(locale, 'codecAuto')),
                      disabled: value !== 'auto' && value !== preferredCodec && codecSupport?.[value] === false,
                    }))}
                    onChange={value => {
                      const codec = value as PreferredCodec;
                      onChangeQuality(quality, targetFps, codec);
                      onNotify(t(locale, 'requestSent') + ' · ' + formatCodecLabel(codec, t(locale, 'codecAuto')));
                    }} />
                </label>
              </div>
              {hasMultipleDisplays && <div className="session-group">
                <label className="session-setting-row"><Focus /><span>{t(locale, 'followWindow')}</span>
                  <input className="ui-switch" type="checkbox" role="switch" checked={followWindow} onChange={() => { onToggleFollowWindow(); onNotify(t(locale, 'followWindow')+' · '+t(locale, followWindow ? 'optionOff' : 'optionOn')); }} />
                </label>
              </div>}
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
