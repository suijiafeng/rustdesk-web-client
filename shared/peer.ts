import type { PeerInfo } from './protoTypes.ts';
export type { PeerInfo } from './protoTypes.ts';

export interface SessionPeer {
  peerInfo: PeerInfo;
  encrypted: boolean;
  route: string;
  privacyAllowed: boolean;
  clipboardAllowed: boolean;
  restartAllowed: boolean;
}

export const HostPermission = { Keyboard: 0, Clipboard: 2, Audio: 3, File: 4, Restart: 5, Recording: 6, BlockInput: 7, PrivacyMode: 8 } as const;
export const PrivacyState = { Unsupported: 3, Enabled: 4, Disabled: 8, DisabledByPeer: 9 } as const;

export function privacyResult(code: number): { enabled: boolean | undefined; failed: boolean } {
  return {
    enabled: code === PrivacyState.Enabled ? true : [3, 5, 6, 7, 8, 9, 11].includes(code) ? false : undefined,
    failed: ![PrivacyState.Enabled, PrivacyState.Disabled, PrivacyState.DisabledByPeer].includes(code as 4 | 8 | 9),
  };
}

/** Display-specific resolution and explicit privacy controls arrived in 1.2.4. */
export function supportsModernDisplayControls(version: unknown): boolean {
  const [major, minor, patch] = String(version ?? '').split('.').map(Number);
  return major > 1 || (major === 1 && (minor > 2 || (minor === 2 && patch >= 4)));
}

export function permissions(conn: SessionPeer) {
  return {
    privacyAllowed: conn.privacyAllowed && conn.peerInfo.features?.privacy_mode === true,
    clipboardAllowed: conn.clipboardAllowed,
  };
}

export function canRestart(conn: SessionPeer): boolean {
  return conn.restartAllowed && ['windows', 'mac os', 'macos', 'linux'].includes(String(conn.peerInfo.platform).toLowerCase());
}

export function supportedResolutions(supported: PeerInfo['resolutions']): { width: number; height: number }[] {
  return (supported?.resolutions ?? []).filter((size): size is { width: number; height: number } =>
    typeof size.width === 'number' && typeof size.height === 'number' &&
    Number.isInteger(size.width) && Number.isInteger(size.height) && size.width > 0 && size.height > 0);
}

export function peerToJson(peer: PeerInfo, conn: SessionPeer): Record<string, unknown> {
  const displays = Array.isArray(peer.displays)
    ? peer.displays.map((d, index: number) => ({
        index,
        name: String(d.name ?? ''),
        x: Number(d.x ?? 0),
        y: Number(d.y ?? 0),
        width: Number(d.width ?? 0),
        height: Number(d.height ?? 0),
        online: Boolean(d.online ?? true),
        cursorEmbedded: Boolean(d.cursor_embedded),
      }))
    : [];

  const encoding = peer.encoding
    ? {
        vp8: Boolean(peer.encoding.vp8),
        h264: Boolean(peer.encoding.h264),
        h265: Boolean(peer.encoding.h265),
        av1: Boolean(peer.encoding.av1),
      }
    : null;

  return {
    type: 'peer',
    hostname: String(peer.hostname ?? ''),
    platform: String(peer.platform ?? ''),
    username: String(peer.username ?? ''),
    version: String(peer.version ?? ''),
    currentDisplay: Number(peer.current_display ?? 0),
    displays,
    encoding,
    encrypted: conn.encrypted,
    route: conn.route,
    ...permissions(conn),
    restartAllowed: canRestart(conn),
  };
}

export function initialDisplaySize(peer: PeerInfo): { width: number; height: number } {
  const displays = Array.isArray(peer.displays) ? peer.displays : [];
  const idx = Number(peer.current_display ?? 0);
  const chosen = displays[idx] ?? displays[0];
  if (!chosen) return { width: 0, height: 0 };
  return {
    width: Math.max(0, Number(chosen.width ?? 0)),
    height: Math.max(0, Number(chosen.height ?? 0)),
  };
}
