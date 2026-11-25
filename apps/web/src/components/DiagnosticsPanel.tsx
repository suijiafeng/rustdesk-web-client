// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { PeerMessage } from '@rustdesk-web/shared';
import { exportDiagnostics, type DiagnosticSnapshot } from '../lib/diagnostics.ts';
import { t, type Locale } from '../lib/i18n.ts';

interface LinkQuality {
  fps: number;
  bitrate: number;
  streamState: string;
  browserRttMs: number | null;
  lossPct: number;
  linkHealth: string;
}

interface DiagnosticsPanelProps {
  locale: Locale;
  open: boolean;
  snapshot: DiagnosticSnapshot;
  linkQuality: LinkQuality | null;
  route?: PeerMessage['route'];
  encrypted: boolean;
  onCopy: (text: string) => void;
}

export function DiagnosticsPanel({ locale, open, snapshot, linkQuality, route, encrypted, onCopy }: DiagnosticsPanelProps) {
  if (!open) return null;
  const base = exportDiagnostics({ ...snapshot, now: Date.now() });
  const report = {
    route: route ?? null,
    encrypted,
    durationMs: base.durationMs,
    framesPerSecond: base.framesPerSecond,
    received: base.received,
    rttMs: base.rttMs,
    decode: base.decode,
    samplingFps: linkQuality?.fps ?? null,
    bitrateBps: linkQuality?.bitrate ?? null,
    streamState: linkQuality?.streamState ?? null,
    browserRttMs: linkQuality?.browserRttMs ?? null,
    packetLossPct: linkQuality?.lossPct ?? null,
    linkHealth: linkQuality?.linkHealth ?? null,
  };
  const text = JSON.stringify(report);
  const routeLabel = route === 'webrtc-direct' ? 'routeWebRtcDirect'
    : route === 'webrtc-relay' ? 'routeWebRtcRelay'
    : route === 'webrtc' ? 'routeWebRtcUnknown'
    : route === 'direct' ? 'routeDirect'
    : route === 'relay' ? 'routeRelay' : 'routeUnknown';
  return (
    <aside
      data-testid="diagnostics"
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        zIndex: 4,
        background: 'rgba(16, 20, 24, 0.92)',
        color: '#fff',
        padding: 12,
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <div>{t(locale, routeLabel)} · {t(locale, encrypted ? 'linkEncrypted' : 'linkPlain')}</div>
      <div>{t(locale, 'diagDuration')} {report.durationMs} ms</div>
      <div>{t(locale, 'diagFrames')} {report.samplingFps ?? report.framesPerSecond}</div>
      <div>{t(locale, 'diagBitrate')} {report.bitrateBps ?? 0} bit/s</div>
      <div>{t(locale, 'diagStream')} {report.streamState ?? t(locale, 'diagWaiting')}</div>
      <div>{t(locale, 'diagReceived')} {report.received}</div>
      <div>{t(locale, 'diagBrowserRtt')} {report.browserRttMs ?? t(locale, 'diagUnavailable')} ms ({report.linkHealth}, {t(locale, 'diagLoss')} {report.packetLossPct}%)</div>
      <div>{t(locale, 'diagHostRtt')} {report.rttMs ?? t(locale, 'diagUnavailable')} ms</div>
      <div>{t(locale, 'diagDecode')} {report.decode || t(locale, 'diagOk')}</div>
      <button type="button" onClick={() => onCopy(text)} style={{ cursor: 'pointer', marginTop: 8 }}>
        {t(locale, 'diagCopy')}
      </button>
    </aside>
  );
}
