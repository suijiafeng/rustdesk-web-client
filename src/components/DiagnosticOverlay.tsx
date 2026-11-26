import { useRef } from 'react';
import { Signal, X } from 'lucide-react';
import type { DiagnosticsSummary } from '../lib/diagnostics';
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
  const fps = stats.streamState === 'waiting' ? null : finite(stats.renderFps);
  const bitrate = stats.streamState === 'waiting' ? null : finite(stats.bitrate);
  const recovering = ((stats.inFlightFrames ?? 0) > 0 && (stats.oldestFrameAgeMs ?? 0) >= 200) || gatewayVideo?.recovering;
  const state = recovering ? 'recovering' : stats.streamState === 'waiting' ? 'waiting' : 'active';
  const activity = t(locale, state === 'recovering' ? 'diagRecovering' : state === 'waiting' ? 'diagWaitingForVideo'
    : stats.streamState === 'idle' ? 'diagNoPictureUpdates' : 'diagPictureUpdating');
  const resolution = stats.width > 0 && stats.height > 0 ? `${stats.width} × ${stats.height}` : '—';

  return (
    <aside className="diag-overlay" data-testid="diagnostic-overlay" aria-label={t(locale, 'diagTitle')}>
      <div className="diag-text">
        <span className="diag-route">{routeLabel}</span>
        <span className="diag-status" data-testid="diag-picture-state" data-state={state}
          role="img" aria-label={activity} title={activity} tabIndex={0} data-session-notice
          onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
          <Signal size={16} aria-hidden="true" />
        </span>
        <span className="diag-value" data-testid="diag-resolution">{resolution}</span>
        <span className="diag-value" data-testid="diag-value-fps">{fps === null ? '—' : `${Math.round(fps)} ${t(locale, 'diagFramesPerSecond')}`}</span>
        <span>{t(locale, 'diagBandwidth')} <span className="diag-value" data-testid="diag-value-bitrate">{bitrate === null ? '—' : formatBitrate(bitrate)}</span></span>
        <span data-testid="diag-rtt">{t(locale, browserDirect ? 'diagRemoteRoundTrip' : 'diagGatewayRoundTrip')} <span className="diag-value" data-testid="diag-value-rtt">{rtt === null ? '—' : `${Math.round(rtt)} ms`}</span></span>
      </div>
      <button type="button" className="diag-close" data-testid="diag-close" data-session-notice
        aria-label={t(locale, 'diagClose')}
        onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
        onPointerUp={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onClose(); }}><X size={15} /></button>
    </aside>
  );
}
