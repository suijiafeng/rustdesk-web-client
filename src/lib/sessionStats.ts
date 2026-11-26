import { useSyncExternalStore } from 'react';
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
