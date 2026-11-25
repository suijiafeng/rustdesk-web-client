// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export interface KeyboardIsolationContext {
  phase: 'idle' | 'connecting' | 'live' | 'error';
  chromeOpen: boolean;
  insideChromeInput: boolean;
}

/** Capture keyboard events only while a live session is focused, not while chrome is open. */
export function shouldIsolateKeyboardEvent(ctx: KeyboardIsolationContext): boolean {
  if (ctx.phase !== 'live') return false;
  if (ctx.chromeOpen || ctx.insideChromeInput) return false;
  return true;
}

export function isBrowserNavOrAuxButton(button: number): boolean {
  return button === 1 || button === 3 || button === 4;
}

export function shouldPreventWindowWheel(remoteInputActive: boolean, insideScrollableChrome: boolean): boolean {
  if (!remoteInputActive) return false;
  return !insideScrollableChrome;
}

export function shouldPreventStageTouch(remoteInputActive: boolean, isStageSurfaceTarget: boolean): boolean {
  return remoteInputActive && isStageSurfaceTarget;
}
