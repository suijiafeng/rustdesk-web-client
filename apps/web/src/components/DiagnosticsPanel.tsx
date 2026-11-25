// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { PeerMessage } from '@rustdesk-web/shared';
import { X } from 'lucide-react';
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
  frameWidth: number;
  frameHeight: number;
  codec: string;
  onClose: () => void;
  onCopy: (text: string) => void;
}

export function DiagnosticsPanel({
  locale, open, snapshot, linkQuality, route, encrypted, frameWidth, frameHeight, codec, onClose, onCopy,
}: DiagnosticsPanelProps) {
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
  const formatMs = (value: number | null) => value === null ? '—' : `${Math.round(value)} ms`;
  const bitrate = report.bitrateBps ?? 0;
  const readableBitrate = bitrate >= 1e6 ? `${(bitrate / 1e6).toFixed(1)} Mb/s`
    : bitrate >= 1e3 ? `${Math.round(bitrate / 1e3)} kb/s`
    : `${Math.round(bitrate)} b/s`;
  const rows = [
    ['statSize', frameWidth && frameHeight ? `${frameWidth} × ${frameHeight}` : '—'],
    ['statCodec', codec || '—'],
    ['statFps', `${report.samplingFps ?? report.framesPerSecond} FPS`],
    ['statBitrate', readableBitrate],
    [route?.startsWith('webrtc') ? 'browserPeer' : 'browserGateway', formatMs(report.browserRttMs)],
    ['reportedRtt', formatMs(snapshot.rttMs)],
  ] as const;
  return (
    <aside className="diag-overlay" data-testid="diagnostic-overlay" aria-label={t(locale, 'diagTitle')}
      onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}>
      <header className="diag-header">
        <span>{t(locale, 'diagTitle')}</span>
        <button type="button" className="diag-icon-btn" data-testid="diag-close" aria-label={t(locale, 'diagClose')} onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <p className="diag-route">{t(locale, routeLabel)} · {t(locale, encrypted ? 'linkEncrypted' : 'linkPlain')}</p>
      <dl className="diag-values">
        {rows.map(([label, value]) => <div key={label}><dt>{t(locale, label)}</dt><dd className="font-mono-tabular">{value}</dd></div>)}
      </dl>
      <button type="button" className="mt-2 text-xs" onClick={() => onCopy(text)}>
        {t(locale, 'diagCopy')}
      </button>
    </aside>
  );
}
