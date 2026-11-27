import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ConnectionPhase } from '../types';
import {
  computeDiagnosticsSummary,
  createDiagnosticsState,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  recordPingSent,
  sweepTimeouts,
  type DiagnosticsState,
} from '../lib/diagnostics';
import type { RemoteSocket } from '../lib/remoteSocket';
import { createTelemetryStore } from '../lib/sessionStats';

interface UseDiagnosticsPingOptions {
  phase: ConnectionPhase;
  wsRef: MutableRefObject<WebSocket | RemoteSocket | null>;
}

function readInitialDiagnosticsOpen(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('diag') === '1';
  } catch {
    return false;
  }
}

/**
 * Manages the diagnostic overlay visibility and raw WebSocket ping-pong RTT probing
 * while a remote session is live.
 */
export function useDiagnosticsPing({ phase, wsRef }: UseDiagnosticsPingOptions) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState<boolean>(readInitialDiagnosticsOpen);
  const diagStateRef = useRef<DiagnosticsState>(createDiagnosticsState());
  const diagSeqRef = useRef(0);
  const [telemetryStore] = useState(() =>
    createTelemetryStore(computeDiagnosticsSummary(diagStateRef.current, performance.now())),
  );

  const resetDiagnostics = useCallback(() => {
    diagStateRef.current = createDiagnosticsState();
    diagSeqRef.current = 0;
    telemetryStore.setDiagSummary(computeDiagnosticsSummary(diagStateRef.current, performance.now()));
  }, [telemetryStore]);

  useEffect(() => {
    if (!diagnosticsOpen || phase !== 'live') {
      return;
    }

    const sendProbe = () => {
      const sock = wsRef.current;
      const now = performance.now();
      diagStateRef.current = sweepTimeouts(diagStateRef.current, now, PING_TIMEOUT_MS);
      if (sock && sock.readyState === WebSocket.OPEN) {
        const seq = diagSeqRef.current + 1;
        diagSeqRef.current = seq;
        diagStateRef.current = recordPingSent(diagStateRef.current, seq, now);
        sock.send(JSON.stringify({ type: 'ping', seq, clientTs: now }));
      }
      telemetryStore.setDiagSummary(computeDiagnosticsSummary(diagStateRef.current, now, PING_TIMEOUT_MS));
    };

    sendProbe();
    const timer = window.setInterval(sendProbe, PING_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [diagnosticsOpen, phase, wsRef, telemetryStore]);

  return {
    diagnosticsOpen,
    setDiagnosticsOpen,
    diagStateRef,
    telemetryStore,
    resetDiagnostics,
  };
}
