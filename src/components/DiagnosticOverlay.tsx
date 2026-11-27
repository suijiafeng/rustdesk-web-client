import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, Lock, Signal, SignalLow, SignalMedium, X } from 'lucide-react';
import { classifyLinkHealth, type DiagnosticsSummary } from '../lib/diagnostics';
import { formatCodecLabel, normalizeCodecName, type PreferredCodec } from '../lib/displayPrefs';
import { t, type Locale } from '../lib/i18n';
import { formatBitrate, type GatewayVideoStats } from '../lib/protocol';
import { useSessionStats, useTelemetry, type SessionStatsStore, type TelemetryStore } from '../lib/sessionStats';

interface DiagnosticOverlayProps {
  statsStore: SessionStatsStore;
  telemetryStore?: TelemetryStore;
  locale: Locale;
  summary?: DiagnosticsSummary;
  routeLabel: string;
  browserDirect?: boolean;
  encrypted?: boolean;
  preferredCodec?: PreferredCodec;
  gatewayVideo?: GatewayVideoStats;
  onClose: () => void;
}

const finite = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value : null;

export function DiagnosticOverlay({
  locale, statsStore, telemetryStore, summary: propSummary, routeLabel, browserDirect, encrypted, preferredCodec, gatewayVideo: propGatewayVideo, onClose,
}: DiagnosticOverlayProps) {
  const stats = useSessionStats(statsStore);
  const telemetry = useTelemetry(telemetryStore);
  const summary = telemetry?.diagSummary ?? propSummary!;
  const gatewayVideo = telemetry ? telemetry.gatewayVideo : propGatewayVideo;
  const firstSequence = useRef(summary.totalSent);
  const overlayRef = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);

  const clampPos = (left: number, top: number) => {
    const el = overlayRef.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 240;
    const maxLeft = Math.max(8, window.innerWidth - w - 8);
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    return {
      left: Math.min(maxLeft, Math.max(8, left)),
      top: Math.min(maxTop, Math.max(8, top)),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    event.stopPropagation();
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) >= 3 || pos !== null) {
      setPos(clampPos(drag.originLeft + dx, drag.originTop + dy));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    event.stopPropagation();
    dragRef.current = null;
  };

  // The session already publishes ping/pong updates. Do not add a chart timer or
  // present the previous successful probe as the result of a pending/lost probe.
  const probe = summary.history.at(-1);
  const rtt = probe && !probe.lost && probe.seq === summary.totalSent && probe.seq > firstSequence.current
    ? finite(probe.rttMs) : null;
  const jitter = finite(summary.jitterMs);
  const resolution = stats.streamState !== 'waiting' && stats.width > 0 && stats.height > 0
    ? `${stats.width}×${stats.height}` : null;
  const fps = stats.streamState === 'waiting' ? null : finite(stats.renderFps);
  const bitrate = stats.streamState === 'waiting' ? null : finite(stats.bitrate);
  const packetLoss = summary.windowSent > 0 ? `${Math.round(summary.packetLossPct * 10) / 10}%` : null;
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
    waiting: Activity, good: Signal, fair: SignalMedium, poor: SignalLow, recovering: SignalLow,
  };
  const StatusIcon = statusIcons[state];

  const actualCodec = stats.codec && stats.codec !== '—' ? stats.codec : null;
  const requestedCodec = preferredCodec && preferredCodec !== 'auto' ? preferredCodec : null;
  const actualCodecNorm = actualCodec ? normalizeCodecName(actualCodec) : null;
  const codecText = !actualCodec
    ? (requestedCodec ? `${formatCodecLabel(requestedCodec, '')}…` : '—')
    : (requestedCodec && actualCodecNorm && actualCodecNorm !== requestedCodec
      ? `${actualCodec} (${t(locale, 'diagCodecReq')} ${formatCodecLabel(requestedCodec, '')})`
      : actualCodec);

  return (
    <aside
      ref={overlayRef}
      className="diag-overlay"
      data-testid="diagnostic-overlay"
      aria-label={t(locale, 'diagTitle')}
      style={pos ? { left: `${pos.left}px`, top: `${pos.top}px`, right: 'auto' } : undefined}
    >
      <div
        className="diag-header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <span className="diag-status" data-testid="diag-picture-state" data-state={state}
          role="img" aria-label={activity} title={activity} tabIndex={0} data-session-notice>
          <StatusIcon size={16} aria-hidden="true" />
        </span>
        <span className="diag-route">{routeLabel}</span>
        {encrypted && (
          <span className="diag-encrypted" title={t(locale, 'diagEncrypted')} aria-label={t(locale, 'diagEncrypted')}>
            <Lock size={12} aria-hidden="true" />
          </span>
        )}
        <button type="button" className="diag-close" data-testid="diag-close" data-session-notice
          aria-label={t(locale, 'diagClose')}
          onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onClose(); }}><X size={15} /></button>
      </div>
      <dl className="diag-metrics">
        <div>
          <dt>{t(locale, 'diagResolution')}</dt>
          <dd data-testid="diag-value-resolution">{resolution ?? '—'}</dd>
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
          <dt>{t(locale, 'diagPacketLoss')}</dt>
          <dd data-testid="diag-value-loss">{packetLoss ?? '—'}</dd>
        </div>
        <div>
          <dt>{t(locale, 'diagJitter')}</dt>
          <dd data-testid="diag-value-jitter">{jitter === null ? '—' : `${Math.round(jitter * 10) / 10} ms`}</dd>
        </div>
        <div>
          <dt>{t(locale, 'diagCodec')}</dt>
          <dd data-testid="diag-codec">{codecText}</dd>
        </div>
        <div>
          <dt>{t(locale, 'diagDecodeLatency')}</dt>
          <dd data-testid="diag-value-decode">{decodeLatency === null ? '—' : `${Math.round(decodeLatency)} ms`}</dd>
        </div>
      </dl>
    </aside>
  );
}
