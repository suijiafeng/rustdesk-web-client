// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { exportDiagnostics, type DiagnosticSnapshot } from '../lib/diagnostics.ts';

interface DiagnosticsPanelProps {
  open: boolean;
  snapshot: DiagnosticSnapshot;
  onCopy: (text: string) => void;
}

export function DiagnosticsPanel({ open, snapshot, onCopy }: DiagnosticsPanelProps) {
  if (!open) return null;
  const report = exportDiagnostics({ ...snapshot, now: Date.now() });
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
      <div>Frames/s {report.framesPerSecond}</div>
      <div>Received {report.received}</div>
      <div>Host RTT {report.rttMs ?? 'n/a'} ms</div>
      <div>Decode {report.decode || 'ok'}</div>
      <button type="button" onClick={() => onCopy(text)} style={{ cursor: 'pointer', marginTop: 8 }}>
        Copy redacted report
      </button>
    </aside>
  );
}
