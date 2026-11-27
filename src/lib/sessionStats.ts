import { useSyncExternalStore } from 'react';
import type { DiagnosticsSummary } from './diagnostics';
import type { GatewayVideoStats } from './protocol';
import type { StreamActivityState } from './stats';

export interface SessionStats {
  codec: string;
  width: number;
  height: number;
  fps: number;
  rxFps: number;
  renderFps: number;
  decodeQueueSize: number;
  inFlightFrames?: number;
  oldestFrameAgeMs?: number;
  decodeLatencyMs?: number;
  effectiveFps?: number;
  delayMs: number;
  bitrate: number;
  decoded: number;
  dropped: number;
  streamState: StreamActivityState;
}

export const EMPTY_STATS: SessionStats = {
  codec: '—', width: 0, height: 0, fps: 0, rxFps: 0, renderFps: 0,
  decodeQueueSize: 0, delayMs: 0, bitrate: 0, decoded: 0, dropped: 0, streamState: 'waiting',
  inFlightFrames: 0, oldestFrameAgeMs: 0, decodeLatencyMs: 0, effectiveFps: 0,
};
export type VideoLayout = Pick<SessionStats, 'width' | 'height' | 'codec'>;

export function createSessionStatsStore() {
  let stats = EMPTY_STATS;
  let layout: VideoLayout = { width: stats.width, height: stats.height, codec: stats.codec };
  const subscribers = new Set<() => void>();
  const layoutSubscribers = new Set<() => void>();
  const subscribeTo = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  return {
    getSnapshot: () => stats,
    getLayoutSnapshot: () => layout,
    subscribe: subscribeTo(subscribers),
    subscribeLayout: subscribeTo(layoutSubscribers),
    setStats(update: SessionStats | ((previous: SessionStats) => SessionStats)): void {
      const next = typeof update === 'function' ? update(stats) : update;
      if ((Object.keys(EMPTY_STATS) as Array<keyof SessionStats>).every(key => next[key] === stats[key])) return;
      stats = next;
      if (layout.width !== next.width || layout.height !== next.height || layout.codec !== next.codec) {
        layout = { width: next.width, height: next.height, codec: next.codec };
        layoutSubscribers.forEach(notify => notify());
      }
      subscribers.forEach(notify => notify());
    },
  };
}

export type SessionStatsStore = ReturnType<typeof createSessionStatsStore>;

export function useSessionStats(store: SessionStatsStore): SessionStats {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export interface TelemetrySnapshot {
  rtt: number;
  gatewayVideo?: GatewayVideoStats;
  diagSummary: DiagnosticsSummary;
}

export function createTelemetryStore(initialDiagSummary: DiagnosticsSummary) {
  let snapshot: TelemetrySnapshot = {
    rtt: 0,
    gatewayVideo: undefined,
    diagSummary: initialDiagSummary,
  };
  const subscribers = new Set<() => void>();
  const rttSubscribers = new Set<() => void>();
  const subscribeTo = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const notifyAll = () => { subscribers.forEach(notify => notify()); };
  const notifyRtt = () => { rttSubscribers.forEach(notify => notify()); };
  return {
    getSnapshot: () => snapshot,
    getRttSnapshot: () => snapshot.rtt,
    subscribe: subscribeTo(subscribers),
    subscribeRtt: subscribeTo(rttSubscribers),
    setRtt(update: number | ((previous: number) => number)): void {
      const next = typeof update === 'function' ? update(snapshot.rtt) : update;
      if (Object.is(next, snapshot.rtt)) return;
      snapshot = { ...snapshot, rtt: next };
      notifyRtt();
      notifyAll();
    },
    setGatewayVideo(
      update: GatewayVideoStats | undefined | ((previous: GatewayVideoStats | undefined) => GatewayVideoStats | undefined),
    ): void {
      const next = typeof update === 'function' ? update(snapshot.gatewayVideo) : update;
      if (next === snapshot.gatewayVideo) return;
      snapshot = { ...snapshot, gatewayVideo: next };
      notifyAll();
    },
    setDiagSummary(update: DiagnosticsSummary | ((previous: DiagnosticsSummary) => DiagnosticsSummary)): void {
      const next = typeof update === 'function' ? update(snapshot.diagSummary) : update;
      if (next === snapshot.diagSummary) return;
      snapshot = { ...snapshot, diagSummary: next };
      notifyAll();
    },
  };
}

export type TelemetryStore = ReturnType<typeof createTelemetryStore>;

const NOOP_SUBSCRIBE = () => () => {};
const EMPTY_TELEMETRY = () => null;
const EMPTY_RTT = () => undefined;

export function useTelemetry(store?: TelemetryStore): TelemetrySnapshot | null {
  return useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    store ? store.getSnapshot : EMPTY_TELEMETRY,
    store ? store.getSnapshot : EMPTY_TELEMETRY,
  );
}

export function useTelemetryRtt(store?: TelemetryStore): number | undefined {
  return useSyncExternalStore(
    store ? store.subscribeRtt : NOOP_SUBSCRIBE,
    store ? store.getRttSnapshot : EMPTY_RTT,
    store ? store.getRttSnapshot : EMPTY_RTT,
  );
}
