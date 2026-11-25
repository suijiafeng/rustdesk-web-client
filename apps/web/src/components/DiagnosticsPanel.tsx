// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { exportDiagnostics, type DiagnosticSnapshot } from '../lib/diagnostics.ts';

interface LinkQuality {
  fps: number;
  bitrate: number;
  streamState: string;
  browserRttMs: number | null;
  lossPct: number;
  linkHealth: string;
}

interface DiagnosticsPanelProps {
  open: boolean;
  snapshot: DiagnosticSnapshot;
  linkQuality: LinkQuality | null;
  onCopy: (text: string) => void;
}

export function DiagnosticsPanel({ open, snapshot, linkQuality, onCopy }: DiagnosticsPanelProps) {
  if (!open) return null;
  const base = exportDiagnostics({ ...snapshot, now: Date.now() });
  const report = {
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
      <div>Duration {report.durationMs} ms</div>
      <div>Frames/s {report.samplingFps ?? report.framesPerSecond}</div>
      <div>Bitrate {report.bitrateBps ?? 0} bit/s</div>
      <div>Stream {report.streamState ?? 'waiting'}</div>
      <div>Received {report.received}</div>
      <div>Browser RTT {report.browserRttMs ?? 'n/a'} ms ({report.linkHealth}, loss {report.packetLossPct}%)</div>
      <div>Host RTT {report.rttMs ?? 'n/a'} ms</div>
      <div>Decode {report.decode || 'ok'}</div>
      <button type="button" onClick={() => onCopy(text)} style={{ cursor: 'pointer', marginTop: 8 }}>
        Copy redacted report
      </button>
    </aside>
  );
}
