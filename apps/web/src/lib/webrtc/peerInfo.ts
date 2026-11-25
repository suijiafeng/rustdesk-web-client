// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { PeerEncodingInfo, PeerMessage } from '@rustdesk-web/shared';
import type { DataChannelStream } from './stream.ts';

interface HostDisplay {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  online?: boolean;
  cursor_embedded?: boolean;
}

export interface HostPeerInfo {
  username?: string;
  hostname?: string;
  platform?: string;
  version?: string;
  current_display?: number;
  displays?: HostDisplay[];
  encoding?: Partial<PeerEncodingInfo>;
  features?: { privacy_mode?: boolean };
  resolutions?: { resolutions?: { width: number; height: number }[] };
}

export interface NativeConnection {
  stream: DataChannelStream;
  route: 'webrtc-direct' | 'webrtc-relay' | 'webrtc';
  encrypted: boolean;
  peerInfo: HostPeerInfo;
  username: string;
  privacyAllowed: boolean;
  clipboardAllowed: boolean;
  restartAllowed: boolean;
}

export function sessionPermissions(connection: NativeConnection) {
  return {
    privacyAllowed: connection.privacyAllowed && connection.peerInfo.features?.privacy_mode === true,
    clipboardAllowed: connection.clipboardAllowed,
  };
}

export function hostAllowsRestart(connection: NativeConnection): boolean {
  return connection.restartAllowed && ['windows', 'mac os', 'macos', 'linux'].includes(String(connection.peerInfo.platform).toLowerCase());
}

export function usesModernDisplayCommands(peerInfo: HostPeerInfo): boolean {
  const [major, minor, patch] = String(peerInfo.version ?? '').split('.').map(Number);
  return major > 1 || (major === 1 && (minor > 2 || (minor === 2 && patch >= 4)));
}

export function peerInfoMessage(peerInfo: HostPeerInfo, connection: NativeConnection): PeerMessage {
  const displays = Array.isArray(peerInfo.displays)
    ? peerInfo.displays.map((display, index) => ({
        index,
        name: String(display.name ?? ''),
        x: Number(display.x ?? 0),
        y: Number(display.y ?? 0),
        width: Number(display.width ?? 0),
        height: Number(display.height ?? 0),
        online: Boolean(display.online ?? true),
        cursorEmbedded: Boolean(display.cursor_embedded),
      }))
    : [];

  const encoding = peerInfo.encoding
    ? {
        vp8: Boolean(peerInfo.encoding.vp8),
        h264: Boolean(peerInfo.encoding.h264),
        h265: Boolean(peerInfo.encoding.h265),
        av1: Boolean(peerInfo.encoding.av1),
      }
    : null;

  return {
    type: 'peer',
    hostname: String(peerInfo.hostname ?? ''),
    platform: String(peerInfo.platform ?? ''),
    username: String(peerInfo.username ?? ''),
    version: String(peerInfo.version ?? ''),
    currentDisplay: Number(peerInfo.current_display ?? 0),
    displays,
    encoding,
    encrypted: connection.encrypted,
    route: connection.route,
    ...sessionPermissions(connection),
    restartAllowed: hostAllowsRestart(connection),
  };
}

export function activeDisplaySize(peerInfo: HostPeerInfo): { width: number; height: number } {
  const displays = Array.isArray(peerInfo.displays) ? peerInfo.displays : [];
  const activeDisplayIndex = Number(peerInfo.current_display ?? 0);
  const activeDisplay = displays[activeDisplayIndex] ?? displays[0];
  if (!activeDisplay) return { width: 0, height: 0 };
  return {
    width: Math.max(0, Number(activeDisplay.width ?? 0)),
    height: Math.max(0, Number(activeDisplay.height ?? 0)),
  };
}

