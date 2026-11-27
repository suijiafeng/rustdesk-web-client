import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ConnectionPhase, ConnectRequest } from '../types';

export interface AutoReconnectState {
  attempt: number;
  maxAttempts: number;
  secondsLeft: number;
}

const AUTO_RECONNECT_DELAYS_SEC = [2, 4, 8] as const;

interface UseAutoReconnectOptions {
  phase: ConnectionPhase;
  restartState: 'requested' | 'waiting' | null;
  reconnectRequest: RefObject<ConnectRequest | null>;
  onRetry: (req: ConnectRequest) => void;
}

/** Manages exponential-backoff auto-reconnect after unexpected live session drops. */
export function useAutoReconnect({
  phase,
  restartState,
  reconnectRequest,
  onRetry,
}: UseAutoReconnectOptions) {
  const [autoReconnect, setAutoReconnect] = useState<AutoReconnectState | null>(null);
  const attemptRef = useRef(0);
  const restartStateRef = useRef(restartState);
  restartStateRef.current = restartState;

  const cancelAutoReconnect = useCallback(() => {
    attemptRef.current = 0;
    setAutoReconnect(null);
  }, []);

  const scheduleAutoReconnect = useCallback((wasLive: boolean) => {
    if (restartStateRef.current || !reconnectRequest.current) return;
    const nextAttempt = wasLive ? 1 : attemptRef.current + 1;
    if (!wasLive && attemptRef.current === 0) return;
    if (nextAttempt > AUTO_RECONNECT_DELAYS_SEC.length) {
      attemptRef.current = 0;
      setAutoReconnect(null);
      reconnectRequest.current = null;
      return;
    }
    attemptRef.current = nextAttempt;
    setAutoReconnect({
      attempt: nextAttempt,
      maxAttempts: AUTO_RECONNECT_DELAYS_SEC.length,
      secondsLeft: AUTO_RECONNECT_DELAYS_SEC[nextAttempt - 1],
    });
  }, [reconnectRequest]);

  // Clear auto-reconnect once session recovers to live
  useEffect(() => {
    if (phase === 'live' && attemptRef.current > 0) {
      cancelAutoReconnect();
    }
  }, [phase, cancelAutoReconnect]);

  // Countdown timer & browser online fast-retry
  useEffect(() => {
    if (!autoReconnect || phase !== 'error') return;
    const triggerRetry = () => {
      const req = reconnectRequest.current;
      setAutoReconnect(null);
      if (req) onRetry(req);
    };
    if (autoReconnect.secondsLeft <= 0) {
      triggerRetry();
      return;
    }
    const timer = window.setTimeout(() => {
      setAutoReconnect((prev) =>
        prev ? { ...prev, secondsLeft: Math.max(0, prev.secondsLeft - 1) } : null,
      );
    }, 1000);
    window.addEventListener('online', triggerRetry, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', triggerRetry);
    };
  }, [autoReconnect, phase, onRetry, reconnectRequest]);

  return {
    autoReconnect,
    autoReconnectAttemptRef: attemptRef,
    scheduleAutoReconnect,
    cancelAutoReconnect,
  };
}
