// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export interface DiagnosticSnapshot {
  startedAt: number;
  now: number;
  frames: number;
  bytes: number;
  rttMs: number | null;
  decodeError: string;
}

const SECRET = /((?:password|token|authorization|secret|serverkey)\s*[:=]\s*)(\S+)/gi;

export function sessionDurationMs(startedAt: number, now: number): number {
  if (!startedAt || now < startedAt) return 0;
  return now - startedAt;
}

export function framesPerSecond(frames: number, elapsedMs: number): number {
  if (frames <= 0 || elapsedMs <= 0) return 0;
  return Math.round((frames * 1000) / elapsedMs);
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function acceptRtt(ms: number): number | null {
  if (!Number.isFinite(ms) || ms < 0 || ms > 60_000) return null;
  return Math.round(ms);
}

export function redactDiagnosticText(value: string): string {
  return value.replace(SECRET, '$1[redacted]');
}

export function exportDiagnostics(snapshot: DiagnosticSnapshot): Record<string, string | number | null> {
  const elapsed = sessionDurationMs(snapshot.startedAt, snapshot.now);
  return {
    durationMs: elapsed,
    framesPerSecond: framesPerSecond(snapshot.frames, elapsed),
    received: formatByteSize(snapshot.bytes),
    rttMs: snapshot.rttMs,
    decode: redactDiagnosticText(snapshot.decodeError),
  };
}
