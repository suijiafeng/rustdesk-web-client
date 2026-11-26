/// <reference types="vite/client" />
import type { DiagnosticsSummary } from './lib/diagnostics';

export interface RdRuntimeState {
  state: 'idle' | 'connecting' | 'live' | 'error';
  codec: string;
  width: number;
  height: number;
  fps: number;
  delayMs: number;
  bitrate: number;
  decoded: number;
  rxFps?: number;
  renderFps?: number;
  inFlightFrames?: number;
  oldestFrameAgeMs?: number;
  decodeLatencyMs?: number;
  effectiveFps?: number;
  cursorX: number;
  cursorY: number;
  touchMode: boolean;
  gesturePhase?: string;
  activePointers?: number;
}

export interface RdViewState {
  scale: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
}

declare global {
  const __APP_VERSION__: string;
  interface Window {
    __rd?: RdRuntimeState;
    __rdView?: RdViewState;
    __rdDiag?: DiagnosticsSummary;
  }
}
