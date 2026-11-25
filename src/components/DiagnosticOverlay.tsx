import { X } from 'lucide-react';
import type { DiagnosticsSummary } from '../lib/diagnostics';
import { t, type Locale } from '../lib/i18n';
import { formatBitrate } from '../lib/protocol';
import type { SessionStats } from './SessionMenu';

interface DiagnosticOverlayProps {
  stats: SessionStats;
  locale: Locale;
  summary: DiagnosticsSummary;
  routeLabel: string;
  browserDirect?: boolean;
  encryptionLabel: string;
  hostRttMs: number;
  onClose: () => void;
}

function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} ms`;
}

export function DiagnosticOverlay({
  locale, stats, summary, routeLabel, browserDirect, encryptionLabel, hostRttMs, onClose,
}: DiagnosticOverlayProps) {
  const rows = [
    ['statSize', stats.width && stats.height ? `${stats.width} × ${stats.height}` : '—'],
    ['statCodec', stats.codec],
    ['statFps', `${stats.fps} FPS`],
    ['statBitrate', formatBitrate(stats.bitrate)],
    [browserDirect ? 'browserPeer' : 'browserGateway', formatMs(summary.currentRttMs)],
    ['reportedRtt', formatMs(hostRttMs > 0 ? hostRttMs : null)],
  ] as const;

  return (
    <aside
      className="diag-overlay"
      data-testid="diagnostic-overlay"
      aria-label={t(locale, 'diagTitle')}
      onPointerDown={e => e.stopPropagation()}
      onPointerMove={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
    >
      <div className="diag-header">
        <span>{t(locale, 'diagTitle')}</span>
        <button type="button" className="diag-icon-btn" data-testid="diag-close"
          aria-label={t(locale, 'diagClose')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <p className="diag-route">{routeLabel} · {encryptionLabel}</p>
      <dl className="diag-values">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{t(locale, label)}</dt>
            <dd className="font-mono-tabular">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
