import { asAppError } from './errors.ts';
import { Buffer } from 'buffer';
import type { HostMessage, OptionMessage, ProtoInput, rustdesk } from './protoTypes.ts';
import {
  BoolOptionValues,
  ChromaValues,
  ControlKeyValues,
  ImageQualityValues,
  KeyboardModeValues,
  PreferCodecValues,
  PunchFailureValues,
} from './protos.ts';

export const MOUSE_TYPE_MOVE = 0;
export const MOUSE_TYPE_DOWN = 1;
export const MOUSE_TYPE_UP = 2;
export const MOUSE_TYPE_WHEEL = 3;

export const MOUSE_BUTTON_LEFT = 0x01;
export const MOUSE_BUTTON_RIGHT = 0x02;
export const MOUSE_BUTTON_WHEEL = 0x04;

export interface CodecCaps {
  vp8: boolean;
  vp9: boolean;
  h264: boolean;
  h265: boolean;
  av1: boolean;
  reported: boolean;
}

export type ClientMessage =
  | { type: 'cursorRequest'; id: string }
  | { type: 'resolution'; display: number; width: number; height: number }
  | {
      type: 'connect';
      mode?: string;
      host?: string;
      port?: number;
      password?: string;
      peerId?: string;
      idServer?: string;
      relayServer?: string;
      key?: string;
      forceRelay?: boolean;
      token?: string;
      codecs?: Partial<CodecCaps>;
      quality?: string;
      customQuality?: number;
      fps?: number;
      codec?: string;
      lockAfterSessionEnd?: boolean;
      media?: { cursorIds?: boolean; audioBinary?: boolean };
    }
  | {
      type: 'mouse';
      action?: string;
      button?: string;
      x?: number;
      y?: number;
    }
  | {
      type: 'key';
      action?: string;
      control?: string;
      chr?: string;
      text?: string;
      modifiers?: string[];
    }
  | {
      type: 'text';
      text?: string;
    }
  | {
      type: 'clipboard';
      text?: string;
    }
  | { type: 'privacy'; enabled: boolean }
  | { type: 'restart' }
  | { type: 'audio'; enabled: boolean }
  | { type: 'followWindow'; enabled: boolean }
  | { type: 'lockAfterSessionEnd'; enabled: boolean }
  | {
      type: 'switchDisplay';
      display?: number;
    }
  | {
      type: 'refresh';
    }
  | {
      type: 'quality';
      quality?: string;
      customQuality?: number;
      fps?: number;
      codec?: string;
    }
  | {
      type: 'ping';
      seq?: number;
      clientTs?: number;
    }
  | {
      type: 'disconnect';
    };

export function selectCodecs(raw?: Partial<CodecCaps>): CodecCaps {
  if (!raw || !raw.reported) {
    return {
      vp8: true,
      vp9: true,
      h264: false,
      h265: false,
      av1: false,
      reported: false,
    };
  }
  return {
    vp8: Boolean(raw.vp8),
    vp9: Boolean(raw.vp9),
    h264: Boolean(raw.h264),
    h265: Boolean(raw.h265),
    av1: Boolean(raw.av1),
    reported: true,
  };
}

export function hasAnyCodec(caps: CodecCaps): boolean {
  return caps.vp8 || caps.vp9 || caps.h264 || caps.h265 || caps.av1;
}

export function packMouseMask(action?: string, button?: string): number {
  let kind = MOUSE_TYPE_MOVE;
  if (action === 'down') kind = MOUSE_TYPE_DOWN;
  else if (action === 'up') kind = MOUSE_TYPE_UP;
  else if (action === 'wheel') kind = MOUSE_TYPE_WHEEL;

  let btn = 0;
  if (kind !== MOUSE_TYPE_MOVE && kind !== MOUSE_TYPE_WHEEL) {
    if (button === 'right') btn = MOUSE_BUTTON_RIGHT;
    else if (button === 'middle') btn = MOUSE_BUTTON_WHEEL;
    else btn = MOUSE_BUTTON_LEFT;
  }
  return (btn << 3) | kind;
}

const CONTROL_KEY_MAP: Record<string, number> = {
  Alt: ControlKeyValues.Alt,
  Backspace: ControlKeyValues.Backspace,
  ArrowLeft: ControlKeyValues.LeftArrow,
  Left: ControlKeyValues.LeftArrow,
  CapsLock: ControlKeyValues.CapsLock,
  Meta: ControlKeyValues.Meta,
  Super: ControlKeyValues.Meta,
  Win: ControlKeyValues.Meta,
  Control: ControlKeyValues.Control,
  Ctrl: ControlKeyValues.Control,
  PageDown: ControlKeyValues.PageDown,
  Delete: ControlKeyValues.Delete,
  PageUp: ControlKeyValues.PageUp,
  ArrowDown: ControlKeyValues.DownArrow,
  Down: ControlKeyValues.DownArrow,
  Enter: ControlKeyValues.Return,
  Return: ControlKeyValues.Return,
  End: ControlKeyValues.End,
  ArrowRight: ControlKeyValues.RightArrow,
  Right: ControlKeyValues.RightArrow,
  Escape: ControlKeyValues.Escape,
  Esc: ControlKeyValues.Escape,
  Shift: ControlKeyValues.Shift,
  F1: ControlKeyValues.F1,
  F2: ControlKeyValues.F2,
  F3: ControlKeyValues.F3,
  F4: ControlKeyValues.F4,
  F5: ControlKeyValues.F5,
  F6: ControlKeyValues.F6,
  F7: ControlKeyValues.F7,
  F8: ControlKeyValues.F8,
  F9: ControlKeyValues.F9,
  F10: ControlKeyValues.F10,
  F11: ControlKeyValues.F11,
  F12: ControlKeyValues.F12,
  Space: ControlKeyValues.Space,
  Tab: ControlKeyValues.Tab,
  ArrowUp: ControlKeyValues.UpArrow,
  Up: ControlKeyValues.UpArrow,
  Home: ControlKeyValues.Home,
  CtrlAltDel: ControlKeyValues.CtrlAltDel,
  LockScreen: ControlKeyValues.LockScreen,
};

export function controlKeyEnum(name: string): number | undefined {
  return CONTROL_KEY_MAP[name];
}

export function resolvePreferCodecEnum(
  codecs: CodecCaps,
  preferCodec?: string,
): number {
  const pref = (typeof preferCodec === 'string' ? preferCodec.toLowerCase() : 'auto');
  if (pref === 'h264' && codecs.h264) return PreferCodecValues.H264;
  if (pref === 'h265' && codecs.h265) return PreferCodecValues.H265;
  if (pref === 'vp8' && codecs.vp8) return PreferCodecValues.VP8;
  if (pref === 'vp9' && codecs.vp9) return PreferCodecValues.VP9;
  if (pref === 'av1' && codecs.av1) return PreferCodecValues.AV1;

  // In 'auto' mode, prefer hardware-accelerated H.264 or ultra-fast VP8 instead of RustDesk Auto,
  // because RustDesk Auto prioritizes CPU-bound software AV1 (3-7 fps on typical hosts).
  if (codecs.h264) return PreferCodecValues.H264;
  if (codecs.vp8) return PreferCodecValues.VP8;
  if (codecs.vp9) return PreferCodecValues.VP9;
  if (codecs.h265) return PreferCodecValues.H265;
  return PreferCodecValues.Auto;
}

export function buildSupportedDecoding(
  codecs: CodecCaps,
  preferCodec?: string,
): ProtoInput<rustdesk.ISupportedDecoding> {
  const pref = (typeof preferCodec === 'string' ? preferCodec.toLowerCase() : 'auto');
  const explicitAv1 = pref === 'av1' && codecs.av1;

  return {
    ability_vp8: codecs.vp8 ? 1 : 0,
    ability_vp9: codecs.vp9 ? 1 : 0,
    // Never advertise AV1 in auto mode so hosts without GPU AV1 do not fall back to 3-7fps software AV1
    ability_av1: explicitAv1 ? 1 : 0,
    ability_h264: codecs.h264 ? 1 : 0,
    ability_h265: codecs.h265 ? 1 : 0,
    prefer: resolvePreferCodecEnum(codecs, pref),
    prefer_chroma: ChromaValues.I420,
  };
}

export function decodingPreferenceChanged(
  codecs: CodecCaps,
  previous: string | undefined,
  next: string | undefined,
): boolean {
  if (typeof next !== 'string' || !next) return false;
  const before = buildSupportedDecoding(codecs, previous);
  const after = buildSupportedDecoding(codecs, next);
  return before.prefer !== after.prefer || before.ability_av1 !== after.ability_av1;
}

function buildQualityOptions(quality: string | undefined, customQuality: number | undefined, fallback: number): OptionMessage {
  if (quality === 'custom') {
    if (typeof customQuality !== 'number' || !Number.isInteger(customQuality) ||
        customQuality < 20 || customQuality > 200 || customQuality % 2 !== 0) {
      throw new Error('Custom quality must be an even percentage from 20 to 200.');
    }
    // Native RustDesk decodes ((value >> 8) * 2) / 100 as its quality ratio.
    return { image_quality: ImageQualityValues.NotSet, custom_image_quality: (customQuality / 2) * 256 };
  }
  return { image_quality: quality === 'low' ? ImageQualityValues.Low
    : quality === 'balanced' ? ImageQualityValues.Balanced
    : quality === 'best' ? ImageQualityValues.Best : fallback };
}

export function buildLoginOptions(
  codecs: CodecCaps,
  quality?: string,
  fps?: number,
  preferCodec?: string,
  customQuality?: number,
  lockAfterSessionEnd = false,
): OptionMessage {
  const customFps =
    typeof fps === 'number' && Number.isFinite(fps) && fps >= 5 && fps <= 120
      ? Math.round(fps)
      : 30;

  return {
    supported_decoding: buildSupportedDecoding(codecs, preferCodec),
    custom_fps: customFps,
    ...buildQualityOptions(quality, customQuality, ImageQualityValues.Balanced),
    lock_after_session_end: lockAfterSessionEnd === true ? BoolOptionValues.Yes : BoolOptionValues.No,
    disable_audio: BoolOptionValues.Yes,
    show_remote_cursor: BoolOptionValues.Yes,
  };
}

export function buildVideoReceivedMessage(): HostMessage {
  return {
    misc: {
      video_received: true,
    },
  };
}

export function buildRefreshVideoMessage(): HostMessage {
  return {
    misc: {
      refresh_video: true,
    },
  };
}

/**
 * Converts a browser JSON control message into a RustDesk protobuf Message object.
 * Returns null if the message produces no host protobuf packet.
 */
export function toHostMessage(
  msg: ClientMessage,
  sessionCodecs?: CodecCaps,
): HostMessage | null {
  switch (msg.type) {
    case 'mouse': {
      return {
        mouse_event: {
          mask: packMouseMask(msg.action, msg.button),
          x: Math.trunc(Number(msg.x ?? 0)),
          y: Math.trunc(Number(msg.y ?? 0)),
        },
      };
    }

    case 'key': {
      const action = msg.action ?? 'down';
      const down = action !== 'up';
      const press = action === 'press';
      const modifiers: number[] = [];
      if (Array.isArray(msg.modifiers)) {
        for (const mod of msg.modifiers) {
          const val = controlKeyEnum(mod);
          if (val !== undefined) modifiers.push(val);
        }
      }
      const ev: ProtoInput<rustdesk.IKeyEvent> = {
        mode: KeyboardModeValues.Legacy,
        down,
        press,
        modifiers,
      };
      if (msg.control && msg.control.length > 0) {
        ev.control_key = controlKeyEnum(msg.control) ?? ControlKeyValues.Unknown;
      } else if (msg.chr && msg.chr.length > 0) {
        const cp = msg.chr.codePointAt(0);
        if (cp === undefined) return null;
        ev.chr = cp;
      } else if (msg.text && msg.text.length > 0) {
        ev.press = true;
        ev.seq = msg.text;
      } else {
        return null;
      }
      return { key_event: ev };
    }

    case 'text': {
      const text = msg.text ?? '';
      if (!text) return null;
      return {
        key_event: {
          mode: KeyboardModeValues.Legacy,
          down: true,
          press: true,
          seq: text,
        },
      };
    }

    case 'clipboard': {
      const text = msg.text ?? '';
      const bytes = Buffer.from(text, 'utf8');
      if (bytes.byteLength > 256 * 1024) return null;
      return {
        clipboard: {
          compress: false,
          content: bytes,
        },
      };
    }

    case 'audio':
      if (typeof msg.enabled !== 'boolean') return null;
      return { misc: { option: { disable_audio: msg.enabled ? BoolOptionValues.No : BoolOptionValues.Yes } } };

    case 'followWindow':
      if (typeof msg.enabled !== 'boolean') return null;
      return { misc: { option: { follow_remote_window: msg.enabled ? BoolOptionValues.Yes : BoolOptionValues.No } } };

    case 'switchDisplay': {
      return {
        misc: {
          switch_display: {
            display: Math.trunc(Number(msg.display ?? 0)),
          },
        },
      };
    }

    case 'refresh': {
      return buildRefreshVideoMessage();
    }

    case 'lockAfterSessionEnd': {
      if (typeof msg.enabled !== 'boolean') return null;
      return { misc: { option: { lock_after_session_end: msg.enabled ? BoolOptionValues.Yes : BoolOptionValues.No } } };
    }

    case 'quality': {
      const option = buildQualityOptions(msg.quality, msg.customQuality, ImageQualityValues.NotSet);
      const fps = Math.trunc(Number(msg.fps ?? 0));
      if (fps >= 5 && fps <= 120) {
        option.custom_fps = fps;
      }
      if (msg.codec && sessionCodecs) {
        option.supported_decoding = buildSupportedDecoding(sessionCodecs, msg.codec);
      }
      return {
        misc: { option },
      };
    }

    default:
      return null;
  }
}

export function punchHoleFailureMessage(response: { failure?: number; other_failure?: string }): string {
  const other = String(response.other_failure ?? '').trim();
  if (other) return other;
  // Proto3 omits the zero-valued ID_NOT_EXIST enum from the wire.
  switch (response.failure ?? PunchFailureValues.ID_NOT_EXIST) {
    case PunchFailureValues.ID_NOT_EXIST: return 'ID does not exist';
    case PunchFailureValues.OFFLINE: return 'remote desktop is offline';
    case PunchFailureValues.LICENSE_MISMATCH: return 'key mismatch';
    case PunchFailureValues.LICENSE_OVERUSE: return 'key overuse';
    default: return 'punch hole failed';
  }
}

/**
 * Converts low-level network/auth errors into clear plain-language guidance matching spec §4.12.
 */
export function humanizeError(err: unknown): string {
  const { code, detail } = asAppError(err);
  switch (code) {
    case 'PASSWORD_INVALID': return 'The host rejected the password. Check the permanent password and connect again.';
    case 'PASSWORD_REQUIRED': return 'The host requires a password. Enter the permanent password set on the desktop and connect again.';
    case 'DNS_FAILED': {
      const domain = detail.match(/DNS lookup (?:failed|timed out) for "([^"]+)"/i)?.[1];
      return domain ? `DNS lookup failed for "${domain}". Check the domain spelling, remove any http:// prefix, and verify DNS records.`
        : 'DNS lookup failed. Check the server domain spelling and network DNS settings.';
    }
    case 'PEER_NOT_FOUND': return 'ID does not exist. Check the device ID and that both devices use the same ID server.';
    case 'PEER_OFFLINE': return 'The remote desktop is offline. Check that it is powered on, connected to the network, and running RustDesk.';
    case 'UNREACHABLE': return 'Cannot reach the server or host. Check the address, port, and firewall settings.';
    case 'TIMEOUT': return 'The host did not answer in time. It may be offline, or a firewall is blocking the port.';
    case 'PROTOCOL_HTTP': return 'Not a RustDesk ID server: the target returned an HTTP/HTTPS response. Check the server address and port (default 21116 / direct 21118).';
    case 'PROTOCOL_INVALID': return 'Not a RustDesk server: the target returned invalid protocol data. Check the server address and port (default 21116 / direct 21118).';
    case 'GATEWAY_TOKEN_INVALID': return 'The gateway access token is missing or incorrect.';
    default: return detail || 'The session ended unexpectedly.';
  }
}
