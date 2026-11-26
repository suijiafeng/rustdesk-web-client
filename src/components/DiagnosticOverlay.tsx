import { useRef } from 'react';
import { Signal, SignalLow, SignalMedium, SignalZero, X } from 'lucide-react';
import { classifyLinkHealth, type DiagnosticsSummary } from '../lib/diagnostics';
import { t, type Locale } from '../lib/i18n';
import { formatBitrate, type GatewayVideoStats } from '../lib/protocol';
import { useSessionStats, type SessionStatsStore } from '../lib/sessionStats';

interface DiagnosticOverlayProps {
  statsStore: SessionStatsStore;
  locale: Locale;
  summary: DiagnosticsSummary;
  routeLabel: string;
  browserDirect?: boolean;
  gatewayVideo?: GatewayVideoStats;
  onClose: () => void;
}

const finite = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value : null;

export function DiagnosticOverlay({
  locale, statsStore, summary, routeLabel, browserDirect, gatewayVideo, onClose,
}: DiagnosticOverlayProps) {
  const stats = useSessionStats(statsStore);
  const firstSequence = useRef(summary.totalSent);
  // The session already publishes ping/pong updates. Do not add a chart timer or
  // present the previous successful probe as the result of a pending/lost probe.
  const probe = summary.history.at(-1);
  const rtt = probe && !probe.lost && probe.seq === summary.totalSent && probe.seq > firstSequence.current
    ? finite(probe.rttMs) : null;
  const jitter = finite(summary.jitterMs);
  const fps = stats.streamState === 'waiting' ? null : finite(stats.renderFps);
  const bitrate = stats.streamState === 'waiting' ? null : finite(stats.bitrate);
  const recovering = ((stats.inFlightFrames ?? 0) > 0 && (stats.oldestFrameAgeMs ?? 0) >= 200) || gatewayVideo?.recovering;
  const decodeLatency = stats.streamState === 'waiting' ? null : finite(stats.decodeLatencyMs ?? null);
  const networkHealth = classifyLinkHealth(finite(summary.avgRttMs), summary.packetLossPct, jitter);
  let state: 'recovering' | 'waiting' | 'good' | 'fair' | 'poor' = networkHealth;
  if (decodeLatency !== null && decodeLatency >= 100) state = 'poor';
  else if (decodeLatency !== null && decodeLatency >= 50 && state !== 'poor') state = 'fair';
  if (stats.streamState === 'waiting') state = 'waiting';
  if (recovering) state = 'recovering';
  const statusLabels = {
    waiting: 'diagQualityWaiting', good: 'diagQualityGood', fair: 'diagQualityFair',
    poor: 'diagQualityPoor', recovering: 'diagRecovering',
  } as const;
  const activity = t(locale, statusLabels[state]);
  const statusIcons = {
    waiting: SignalZero, good: Signal, fair: SignalMedium, poor: SignalLow, recovering: SignalLow,
  };
  const StatusIcon = statusIcons[state];

  return (
    <aside className="diag-overlay" data-testid="diagnostic-overlay" aria-label={t(locale, 'diagTitle')}>
      <div className="diag-header">
        <span className="diag-status" data-testid="diag-picture-state" data-state={state}
          role="img" aria-label={activity} title={activity} tabIndex={0} data-session-notice
          onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
          <StatusIcon size={16} aria-hidden="true" />
        </span>
        <span className="diag-route">{routeLabel}</span>
        <button type="button" className="diag-close" data-testid="diag-close" data-session-notice
          aria-label={t(locale, 'diagClose')}
          onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onClose(); }}><X size={15} /></button>
      </div>
      <dl className="diag-metrics">
        <div>
          <dt>{t(locale, 'diagCodec')}</dt>
          <dd data-testid="diag-codec">{stats.codec || '—'}</dd>
        </div>
        <div>
          <dt>{t(locale, 'diagFrameRate')}</dt>
          <dd data-testid="diag-value-fps">{fps === null ? '—' : `${Math.round(fps)} ${t(locale, 'diagFramesPerSecond')}`}</dd>
        </div>
        <div>
          <dt>{t(locale, 'diagBandwidth')}</dt>
          <dd data-testid="diag-value-bitrate">{bitrate === null ? '—' : formatBitrate(bitrate)}</dd>
        </div>
        <div data-testid="diag-rtt">
          <dt>{t(locale, browserDirect ? 'diagRemoteRoundTrip' : 'diagGatewayRoundTrip')}</dt>
          <dd data-testid="diag-value-rtt">{rtt === null ? '—' : `${Math.round(rtt)} ms`}</dd>
        </div>
        <div>
          <dt>{t(locale, 'diagJitter')}</dt>
          <dd data-testid="diag-value-jitter">{jitter === null ? '—' : `${Math.round(jitter * 10) / 10} ms`}</dd>
        </div>
        <div>
          <dt>{t(locale, 'diagDecodeLatency')}</dt>
          <dd data-testid="diag-value-decode">{decodeLatency === null ? '—' : `${Math.round(decodeLatency)} ms`}</dd>
        </div>
      </dl>
    </aside>
  );
}
