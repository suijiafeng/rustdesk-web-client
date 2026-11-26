import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, LockKeyhole, X } from 'lucide-react';
import type { DiagnosticsSummary } from '../lib/diagnostics';
import { t, type Locale } from '../lib/i18n';
import { formatBitrate, type GatewayVideoStats } from '../lib/protocol';
import type { SessionStats } from './SessionMenu';

interface DiagnosticOverlayProps {
  stats: SessionStats;
  locale: Locale;
  summary: DiagnosticsSummary;
  routeLabel: string;
  browserDirect?: boolean;
  encryptionLabel: string;
  gatewayVideo?: GatewayVideoStats;
  onClose: () => void;
}

const HISTORY_MS = 30_000;
const SAMPLE_MS = 1000;
interface TrendSample {
  at: number;
  fps: number | null;
  bitrate: number | null;
  rtt: number | null;
}
type Metric = 'fps' | 'bitrate' | 'rtt';
const finite = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value : null;

function TrendChart({ samples, metric, floor, label }: {
  samples: TrendSample[]; metric: Metric; floor: number; label: string;
}) {
  const end = samples.at(-1)?.at ?? 0;
  const max = Math.max(floor, ...samples.map(sample => sample[metric] ?? 0));
  // Time-based X coordinates preserve gaps after backgrounding or missing probes.
  // Each chart starts at zero; its upper scale stays visible for honest comparisons.
  const points = samples.map(sample => ({
    x: 2 + Math.max(0, 1 - (end - sample.at) / HISTORY_MS) * 296,
    y: sample[metric] === null ? null : 34 - (sample[metric]! / max) * 30,
    at: sample.at,
  }));
  let drawing = false;
  let previousAt = -Infinity;
  const path = points.map(point => {
    if (point.y === null) { drawing = false; return ''; }
    const command = drawing && point.at - previousAt <= SAMPLE_MS * 1.5 ? 'L' : 'M';
    drawing = true;
    previousAt = point.at;
    return `${command}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');
  const last = points.at(-1);
  const scale = metric === 'bitrate' ? formatBitrate(max) : `${Math.round(max)} ${metric === 'rtt' ? 'ms' : 'FPS'}`;
  return (
    <div className="diag-trend" data-testid={`diag-chart-${metric}`} data-samples={samples.length}>
      <svg viewBox="0 0 300 38" preserveAspectRatio="none" role="img" aria-label={label}>
        <path className="diag-chart-grid" d="M2,4 H298 M2,34 H298" />
        <path className="diag-chart-line" d={path} />
        {last?.y !== null && last?.y !== undefined && <circle cx={last.x} cy={last.y} r="2" />}
      </svg>
      <span className="diag-chart-scale" aria-hidden="true">{scale}</span>
    </div>
  );
}

export function DiagnosticOverlay({
  locale, stats, summary, routeLabel, browserDirect, encryptionLabel, gatewayVideo, onClose,
}: DiagnosticOverlayProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [samples, setSamples] = useState<TrendSample[]>([]);
  const latest = useRef({ stats, summary });
  latest.current = { stats, summary };
  // A reopened overlay starts a new window; old probe results are not fresh data.
  const firstSequence = useRef(summary.totalSent);
  const lastSequence = useRef(firstSequence.current);
  const [rtt, setRtt] = useState<number | null>(null);

  useEffect(() => {
    const sample = () => {
      if (document.hidden) return;
      const { stats: current, summary: diagnostics } = latest.current;
      const probe = diagnostics.history.at(-1);
      const freshProbe = probe && probe.seq > lastSequence.current;
      const measuredRtt = freshProbe && !probe.lost ? finite(probe.rttMs) : null;
      if (freshProbe) lastSequence.current = probe.seq;
      setRtt(measuredRtt);
      const point: TrendSample = {
        at: performance.now(),
        fps: current.streamState === 'waiting' ? null : finite(current.renderFps),
        bitrate: current.streamState === 'waiting' ? null : finite(current.bitrate),
        rtt: measuredRtt,
      };
      setSamples(previous => [...previous.filter(item => point.at - item.at < HISTORY_MS), point].slice(-31));
    };
    sample();
    const timer = window.setInterval(sample, SAMPLE_MS);
    document.addEventListener('visibilitychange', sample);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sample);
    };
  }, []);

  const fps = stats.streamState === 'waiting' ? null : finite(stats.renderFps);
  const bitrate = stats.streamState === 'waiting' ? null : finite(stats.bitrate);
  const metrics = [
    { id: 'fps' as const, label: t(locale, 'diagRenderFps'), value: fps === null ? '—' : `${Math.round(fps)} FPS`, floor: 60 },
    { id: 'bitrate' as const, label: t(locale, 'diagVideoBitrate'), value: bitrate === null ? '—' : formatBitrate(bitrate), floor: 1_000_000 },
    { id: 'rtt' as const, label: t(locale, browserDirect ? 'browserPeer' : 'browserGateway'), value: rtt === null ? '—' : `${Math.round(rtt)} ms`, floor: 100 },
  ];
  const activity = gatewayVideo?.recovering ? t(locale, 'diagWaitingForKey')
    : stats.streamState === 'idle' ? t(locale, 'diagStaticScreen')
    : stats.streamState === 'waiting' ? t(locale, 'diagWaitingForVideo') : '';

  return (
    <aside className="diag-overlay" data-testid="diagnostic-overlay" data-collapsed={collapsed}
      aria-label={t(locale, 'diagTitle')}>
      <div className="diag-header">
        <div className="diag-context">
          <span className="diag-route">{routeLabel}</span>
          <span className="diag-format">
            {stats.width > 0 && stats.height > 0 ? `${stats.width} × ${stats.height}` : '—'}
            <span aria-hidden="true"> · </span>{stats.codec.toUpperCase()}
          </span>
          <span className="diag-security" aria-label={encryptionLabel} title={encryptionLabel}>
            <LockKeyhole size={11} aria-hidden="true" />{encryptionLabel}
          </span>
          <span className="diag-window">{activity || t(locale, 'diagRecentHistory')}</span>
        </div>
        <div className="diag-actions" data-session-notice
          onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
          <button type="button" className="diag-icon-btn" data-testid="diag-collapse"
            aria-expanded={!collapsed} aria-label={t(locale, collapsed ? 'diagExpand' : 'diagCollapse')}
            onClick={() => setCollapsed(value => !value)}>
            {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
          <button type="button" className="diag-icon-btn" data-testid="diag-close"
            aria-label={t(locale, 'diagClose')} onClick={onClose}><X size={15} /></button>
        </div>
      </div>
      <div className="diag-metrics">
        {metrics.map(metric => <div key={metric.id} className={`diag-metric diag-metric-${metric.id}`}>
          <div className="diag-metric-heading">
            <span className="diag-metric-label">{metric.label}</span>
            <strong className="font-mono-tabular" data-testid={`diag-value-${metric.id}`}>{metric.value}</strong>
          </div>
          {!collapsed && <TrendChart samples={samples} metric={metric.id} floor={metric.floor}
            label={`${metric.label} · ${t(locale, 'diagRecentHistory')}`} />}
        </div>)}
      </div>
    </aside>
  );
}
