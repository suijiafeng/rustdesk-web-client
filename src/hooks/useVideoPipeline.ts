import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionStats } from '../components/SessionMenu';
import type { ConnectionPhase } from '../types';
import { RemoteDecoder, webCodecsStatus } from '../lib/decoder';
import type { ClientMessage } from '../lib/protocol';
import {
  computeFrameRates, createFrameStats, recordRenderedFrame, recordRxFrame,
  type FrameStatsState,
} from '../lib/stats';

export const EMPTY_STATS: SessionStats = {
  codec: '—',
  width: 0,
  height: 0,
  fps: 0,
  rxFps: 0,
  renderFps: 0,
  decodeQueueSize: 0,
  delayMs: 0,
  bitrate: 0,
  decoded: 0,
  dropped: 0,
  streamState: 'waiting',
};

interface Options {
  phase: ConnectionPhase;
  send: (message: ClientMessage) => void;
}

export function useVideoPipeline({ phase, send }: Options) {
  const initialWebCodecs = webCodecsStatus();
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const [decoderError, setDecoderError] = useState(initialWebCodecs.ok ? '' : initialWebCodecs.reason);
  const decoderRef = useRef<RemoteDecoder | null>(null);
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
      publishStatsSnapshot(performance.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, publishStatsSnapshot]);

  return {
    stats, setStats, decoderError, setDecoderError,
    decoderRef, sizeRef, frameStatsRef, statAccRef,
    ensureDecoder, noteFrame,
  };
}
