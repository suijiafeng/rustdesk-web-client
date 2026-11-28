import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createSessionStatsStore } from '../lib/sessionStats';
import { advanceVideoPacing, createVideoPacing, type VideoPacingState } from '../lib/videoPacing';
import type { ConnectionPhase } from '../types';
import { RemoteDecoder, webCodecsStatus } from '../lib/decoder';
import type { ClientMessage, QualityLevel } from '../lib/protocol';
import {
  computeFrameRates, createFrameStats, recordRenderedFrame, recordRxFrame,
  type FrameStatsState,
} from '../lib/stats';

export { EMPTY_STATS } from '../lib/sessionStats';

interface Options {
  phase: ConnectionPhase;
  send: (message: ClientMessage) => void;
  targetFps?: number;
  quality?: QualityLevel;
  customBitrate?: number;
  /** Explicit quality/codec changes also restore the host's user-selected FPS cap. */
  settingsKey?: string;
}

export function useVideoPipeline({ phase, send, targetFps, quality, customBitrate, settingsKey }: Options) {
  const initialWebCodecs = webCodecsStatus();
  const [statsStore] = useState(createSessionStatsStore);
  const { setStats } = statsStore;
  const videoLayout = useSyncExternalStore(statsStore.subscribeLayout, statsStore.getLayoutSnapshot, statsStore.getLayoutSnapshot);
  const [decoderError, setDecoderError] = useState(initialWebCodecs.ok ? '' : initialWebCodecs.reason);
  const decoderRef = useRef<RemoteDecoder | null>(null);
  const pacingRef = useRef<VideoPacingState | null>(null);
  const sizeRef = useRef({ width: 1280, height: 720 });

  // Frame sampling-rate telemetry refs (avoiding 60Hz React setState per frame)
  const frameStatsRef = useRef<FrameStatsState>(createFrameStats());
  const statAccRef = useRef({
    width: 0,
    height: 0,
    decoded: 0,
    dropped: 0,
    lastDelayMs: 0,
    lastCodec: '—',
  });

  const publishStatsSnapshot = useCallback((nowMs: number) => {
    const rates = computeFrameRates(frameStatsRef.current, nowMs);
    const decMetrics = decoderRef.current?.getMetrics();
    const acc = statAccRef.current;
    const decoded = decMetrics ? decMetrics.renderedCount : acc.decoded;
    const dropped = decMetrics ? decMetrics.droppedCount : acc.dropped;
    const decodeQueueSize = decMetrics?.decodeQueueSize ?? 0;
    const inFlightFrames = decMetrics?.inFlightFrames ?? 0;
    const oldestFrameAgeMs = Math.round(decMetrics?.oldestFrameAgeMs ?? 0);
    const decodeLatencyMs = Math.round(decMetrics?.decodeLatencyMs ?? 0);
    const effectiveFps = pacingRef.current?.effectiveFps;
    setStats((prev) => {
      const nextWidth = acc.width > 0 ? acc.width : prev.width;
      const nextHeight = acc.height > 0 ? acc.height : prev.height;
      const nextCodec = acc.lastCodec !== '—' ? acc.lastCodec : prev.codec;
      if (
        prev.codec === nextCodec &&
        prev.width === nextWidth &&
        prev.height === nextHeight &&
        prev.fps === rates.fps &&
        prev.rxFps === rates.rxFps &&
        prev.renderFps === rates.renderFps &&
        prev.decodeQueueSize === decodeQueueSize &&
        prev.inFlightFrames === inFlightFrames &&
        prev.oldestFrameAgeMs === oldestFrameAgeMs &&
        prev.decodeLatencyMs === decodeLatencyMs &&
        prev.effectiveFps === effectiveFps &&
        prev.bitrate === rates.bitrate &&
        prev.delayMs === acc.lastDelayMs &&
        prev.decoded === decoded &&
        prev.dropped === dropped &&
        prev.streamState === rates.streamState
      ) {
        return prev;
      }
      return {
        codec: nextCodec,
        width: nextWidth,
        height: nextHeight,
        fps: rates.fps,
        rxFps: rates.rxFps,
        renderFps: rates.renderFps,
        decodeQueueSize,
        inFlightFrames,
        oldestFrameAgeMs,
        decodeLatencyMs,
        effectiveFps,
        delayMs: acc.lastDelayMs,
        bitrate: rates.bitrate,
        decoded,
        dropped,
        streamState: rates.streamState,
      };
    });
  }, []);

  const ensureDecoder = useCallback(() => {
    if (!decoderRef.current) {
      decoderRef.current = new RemoteDecoder({
        onOutput: (w, h, renderedCount, nowMs) => {
          const sizeChanged = sizeRef.current.width !== w || sizeRef.current.height !== h;
          sizeRef.current = { width: w, height: h };
          statAccRef.current.width = w;
          statAccRef.current.height = h;
          statAccRef.current.decoded = renderedCount;
          recordRenderedFrame(frameStatsRef.current, nowMs);
          if (renderedCount === 1 || sizeChanged) {
            publishStatsSnapshot(nowMs);
          }
        },
        onError: (msg) => {
          setDecoderError(msg);
        },
        onNeedRefresh: () => {
          send({ type: 'refresh' });
        },
      });
    }
    return decoderRef.current;
  }, [publishStatsSnapshot, send]);

  const noteFrame = useCallback(
    (codecName: string, w: number, h: number, byteLen: number, delayMs: number) => {
      const now = performance.now();
      const firstOrCodecChange =
        frameStatsRef.current.totalRx === 0 ||
        statAccRef.current.lastCodec !== codecName ||
        (w > 0 && statAccRef.current.width !== w) ||
        (h > 0 && statAccRef.current.height !== h);

      recordRxFrame(frameStatsRef.current, now, byteLen);
      statAccRef.current.lastCodec = codecName;
      statAccRef.current.lastDelayMs = Math.max(0, Math.round(delayMs));
      if (w > 0) statAccRef.current.width = w;
      if (h > 0) statAccRef.current.height = h;

      if (firstOrCodecChange) {
        publishStatsSnapshot(now);
      }
    },
    [publishStatsSnapshot],
  );

  // Publish real-time sampling FPS, bitrate, and idle-screen decay at a steady 4Hz cadence
  useEffect(() => {
    if (phase !== 'live') return;
    const timer = window.setInterval(() => {
      const nowMs = performance.now();
      const visible = document.visibilityState !== 'hidden';
      if (visible) decoderRef.current?.checkStall();
      const metrics = decoderRef.current?.getMetrics();
      if (metrics && pacingRef.current) {
        const next = advanceVideoPacing(pacingRef.current, { ...metrics, nowMs, visible });
        pacingRef.current = next.state;
        // Dynamic quality/FPS adjustments omit codec so the host adjusts bitrate/rate without a keyframe stall.
        if (next.fps !== undefined) {
          send({
            type: 'quality',
            fps: next.fps,
            ...(next.quality !== undefined && { quality: next.quality }),
            ...(next.customQuality !== undefined && { customQuality: next.customQuality }),
          });
        }
      }
      publishStatsSnapshot(nowMs);
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, publishStatsSnapshot, send]);

  useEffect(() => {
    pacingRef.current =
      phase === 'live' && targetFps !== undefined
        ? createVideoPacing(targetFps, quality, customBitrate)
        : null;
  }, [phase, targetFps, quality, customBitrate, settingsKey]);

  return {
    statsStore, videoLayout, setStats, decoderError, setDecoderError,
    decoderRef, sizeRef, frameStatsRef, statAccRef,
    ensureDecoder, noteFrame,
  };
}
