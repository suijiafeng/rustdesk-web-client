// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { ClientMessage } from '@rustdesk-web/shared';

export type RemoteOs = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'other';
export type LocalOs = 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'other';
export type BrowserKind = 'chromium' | 'safari' | 'firefox' | 'other';

export interface RemoteFeatures {
  ctrlAltDel: boolean;
  lockScreen: boolean;
  privacyMode: boolean;
  blockInput: boolean;
  resolutionChange: boolean;
  restart: boolean;
}

const CLIPBOARD_MAX_BYTES = 256 * 1024;
const CHAT_MAX_CHARS = 4_096;
export const TWO_FACTOR_MAX_ATTEMPTS = 3;
export const TWO_FACTOR_TIMEOUT_MS = 60_000;
export const RECONNECT_MAX_ATTEMPTS = 5;

export function classifyRemoteOs(platform: string | null | undefined): RemoteOs {
  const value = String(platform ?? '').trim().toLowerCase();
  if (!value) return 'other';
  if (value.includes('android')) return 'android';
  if (value.includes('ios') || value.includes('iphone') || value.includes('ipad')) return 'ios';
  if (value.includes('mac') || value.includes('darwin') || value.includes('osx')) return 'macos';
  if (value.includes('win')) return 'windows';
  if (value.includes('linux') || value.includes('ubuntu') || value.includes('debian') || value.includes('fedora')) return 'linux';
  return 'other';
}

export function classifyLocalOs(userAgent: string, platform = ''): LocalOs {
  const hint = `${platform} ${userAgent}`.toLowerCase();
  if (hint.includes('android')) return 'android';
  if (hint.includes('iphone') || hint.includes('ipad') || hint.includes('ios')) return 'ios';
  if (hint.includes('mac')) return 'macos';
  if (hint.includes('win')) return 'windows';
  if (hint.includes('linux') || hint.includes('x11') || hint.includes('cros')) return 'linux';
  return 'other';
}

export function classifyBrowser(userAgent: string): BrowserKind {
  const ua = userAgent.toLowerCase();
  if (ua.includes('firefox') || ua.includes('fxios')) return 'firefox';
  if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium') && !ua.includes('edg/')) return 'safari';
  if (ua.includes('chrome') || ua.includes('chromium') || ua.includes('edg/')) return 'chromium';
  return 'other';
}

export function remoteFeatures(os: RemoteOs): RemoteFeatures {
  const desktop = os === 'windows' || os === 'macos' || os === 'linux';
  return {
    ctrlAltDel: os === 'windows',
    lockScreen: desktop,
    privacyMode: os === 'windows',
    blockInput: os === 'windows',
    resolutionChange: os === 'windows' || os === 'linux',
    restart: desktop,
  };
}

/** Map a local modifier onto the key the remote OS treats as the primary shortcut modifier. */
export function mapOutgoingControl(control: string, local: LocalOs, remote: RemoteOs): string {
  if (control !== 'Control' && control !== 'Meta') return control;
  if (remote === 'macos') {
    if (local === 'macos' && control === 'Meta') return 'Meta';
    if (local !== 'macos' && control === 'Control') return 'Meta';
    return control;
  }
  if (local === 'macos' && control === 'Meta') return 'Control';
  return control;
}

export function primaryShortcutModifier(remote: RemoteOs): 'Meta' | 'Control' {
  return remote === 'macos' ? 'Meta' : 'Control';
}

export function adaptKeyMessages(messages: readonly ClientMessage[], local: LocalOs, remote: RemoteOs): ClientMessage[] {
  return messages.map((message) => {
    if (message.type !== 'key') return message;
    return {
      ...message,
      control: message.control ? mapOutgoingControl(message.control, local, remote) : message.control,
      modifiers: message.modifiers?.map((modifier) => mapOutgoingControl(modifier, local, remote)),
    };
  });
}

export function clipboardByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function validateClipboardText(text: string, disabled: boolean, permitted: boolean): 'ok' | 'disabled' | 'denied' | 'empty' | 'too-large' {
  if (disabled) return 'disabled';
  if (!permitted) return 'denied';
  if (!text) return 'empty';
  if (clipboardByteLength(text) > CLIPBOARD_MAX_BYTES) return 'too-large';
  return 'ok';
}

export type ClipboardDelivery = 'write' | 'panel' | 'unavailable';

/** Safari can write the clipboard only inside a user gesture, so an incoming host copy uses a panel. */
export function clipboardDelivery(browser: BrowserKind, secureContext: boolean, fromUserGesture: boolean): ClipboardDelivery {
  if (!secureContext) return 'unavailable';
  if (browser === 'safari' && !fromUserGesture) return 'panel';
  if (browser === 'other') return 'panel';
  return 'write';
}

export function keyboardLockAvailable(browser: BrowserKind, secureContext: boolean): boolean {
  return secureContext && browser === 'chromium';
}

export function reconnectDelayMs(attempt: number): number | null {
  if (attempt < 1 || attempt > RECONNECT_MAX_ATTEMPTS) return null;
  return Math.min(30_000, 1000 * 2 ** (attempt - 1));
}

export function twoFactorStatus(attemptsUsed: number, elapsedMs: number): 'ok' | 'exhausted' | 'expired' {
  if (elapsedMs >= TWO_FACTOR_TIMEOUT_MS) return 'expired';
  if (attemptsUsed >= TWO_FACTOR_MAX_ATTEMPTS) return 'exhausted';
  return 'ok';
}

export function validateChatText(text: string): 'ok' | 'empty' | 'too-large' {
  const trimmed = text.trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > CHAT_MAX_CHARS) return 'too-large';
  if (trimmed.includes('\0')) return 'empty';
  return 'ok';
}

export function resolutionAllowed(
  os: RemoteOs,
  sizes: readonly { width: number; height: number }[],
  display: number,
  activeDisplay: number,
): boolean {
  return remoteFeatures(os).resolutionChange && display === activeDisplay && sizes.length > 0;
}
