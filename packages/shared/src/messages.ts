// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export interface DisplayInfo {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  online: boolean;
  cursorEmbedded?: boolean;
}

export interface PeerEncodingInfo {
  vp8: boolean;
  h264: boolean;
  h265: boolean;
  av1: boolean;
}

export interface CodecSupport {
  vp8: boolean;
  vp9: boolean;
  h264: boolean;
  h265: boolean;
  av1: boolean;
  reported: boolean;
}

export type QualityLevel = 'low' | 'balanced' | 'best';

export interface CursorShape {
  width: number;
  height: number;
  hotX: number;
  hotY: number;
  rgba: string;
}

export interface PeerMessage {
  type: 'peer';
  route?: 'direct' | 'relay' | 'webrtc-direct' | 'webrtc-relay' | 'webrtc';
  privacyAllowed?: boolean;
  clipboardAllowed?: boolean;
  restartAllowed?: boolean;
  hostname: string;
  platform: string;
  username: string;
  version: string;
  currentDisplay: number;
  displays: DisplayInfo[];
  encoding?: PeerEncodingInfo | null;
  encrypted: boolean;
}

export type ServerMessage =
  | { type: 'permissions'; privacyAllowed: boolean; clipboardAllowed: boolean }
  | { type: 'privacyResult'; enabled?: boolean; failed: boolean }
  | { type: 'restartPermission'; allowed: boolean }
  | { type: 'restartResult'; sent: boolean }
  | { type: 'audioDenied' }
  | { type: 'audioFormat'; sampleRate: number; channels: number }
  | { type: 'audioFrame'; packet: string }
  | { type: 'focusedDisplay'; display: number }
  | { type: 'resolutions'; display: number; sizes: { width: number; height: number }[] }
  | { type: 'hello'; service: string }
  | { type: 'status'; state: string; detail?: string; username?: string }
  | PeerMessage
  | {
      type: 'display';
      display: number;
      width: number;
      height: number;
      x?: number;
      y?: number;
      cursorEmbedded?: boolean;
      name?: string;
    }
  | { type: 'clipboard'; text: string }
  | { type: 'chat'; text: string }
  | { type: 'twoFactorRequired' }
  | { type: 'cursor'; x: number; y: number }
  | { type: 'cursorShape'; shape: CursorShape | null }
  | { type: 'error'; message: string }
  | { type: 'rtt'; ms: number }
  | { type: 'pong'; seq: number; clientTs: number; serverTs: number };

export type ClientMessage =
  | { type: 'privacy'; enabled: boolean }
  | { type: 'restart' }
  | { type: 'audio'; enabled: boolean }
  | { type: 'resolution'; display: number; width: number; height: number }
  | {
      type: 'connect';
      mode?: 'direct' | 'id';
      host?: string;
      port?: number;
      password?: string;
      peerId?: string;
      idServer?: string;
      relayServer?: string;
      key?: string;
      forceRelay?: boolean;
      token?: string;
      codecs?: CodecSupport;
      quality?: QualityLevel;
      fps?: number;
      codec?: string;
    }
  | {
      type: 'mouse';
      action?: 'move' | 'down' | 'up' | 'wheel';
      button?: 'left' | 'right' | 'middle';
      x?: number;
      y?: number;
    }
  | {
      type: 'key';
      action?: 'down' | 'up' | 'press';
      control?: string;
      chr?: string;
      text?: string;
      modifiers?: string[];
    }
  | { type: 'text'; text?: string }
  | { type: 'clipboard'; text?: string }
  | { type: 'chat'; text?: string }
  | { type: 'auth2fa'; code?: string }
  | { type: 'followWindow'; enabled: boolean }
  | { type: 'switchDisplay'; display?: number }
  | { type: 'refresh' }
  | { type: 'quality'; quality?: QualityLevel; fps?: number; codec?: string }
  | { type: 'ping'; seq?: number; clientTs?: number }
  | { type: 'disconnect' };

export function messageType(message: ClientMessage | ServerMessage): string {
  return message.type;
}
