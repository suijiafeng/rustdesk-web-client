import type { CodecSupport, QualityLevel } from './protocol';

export type DefaultViewStyle = 'original' | 'fit';
export type ScrollStyle = 'auto' | 'scrollbar';
export type ImageQualityPreset = QualityLevel;
export type PreferredCodec = 'auto' | 'vp8' | 'vp9' | 'h264' | 'h265' | 'av1';

export const PREFERRED_CODEC_OPTIONS: readonly PreferredCodec[] = ['auto', 'h264', 'h265', 'vp8', 'vp9', 'av1'];

export function formatCodecLabel(codec: PreferredCodec, autoLabel: string): string {
  if (codec === 'auto') return autoLabel;
  if (codec === 'h264') return 'H.264';
  if (codec === 'h265') return 'H.265';
  return codec.toUpperCase();
}

export interface DisplayPrefs {
  viewStyle: DefaultViewStyle;
  scrollStyle: ScrollStyle;
  qualityPreset: ImageQualityPreset;
  customBitrate: number;
  targetFps: number;
  codec: PreferredCodec;
  viewOnly: boolean;
  showRemoteCursor: boolean;
  followWindow: boolean;
  enlargeCursor: boolean;
  autoKeyboard: boolean;
  followRemoteCursor: boolean;
  disableClipboard: boolean;
  lockAfterSessionEnd: boolean;
  reverseMouseWheel: boolean;
  swapMouseButtons: boolean;
}

export const DISPLAY_PREFS_STORAGE_KEY = 'rd_web_display_prefs';

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  viewStyle: 'fit',
  scrollStyle: 'auto',
  qualityPreset: 'balanced',
  customBitrate: 50,
  targetFps: 30,
  codec: 'auto',
  viewOnly: false,
  showRemoteCursor: true,
  followWindow: false,
  enlargeCursor: false,
  autoKeyboard: false,
  followRemoteCursor: false,
  disableClipboard: false,
  lockAfterSessionEnd: false,
  reverseMouseWheel: false,
  swapMouseButtons: false,
};

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeDisplayPrefs(raw: unknown, useTouchDefaults = false): DisplayPrefs {
  const defaults = { ...DEFAULT_DISPLAY_PREFS, autoKeyboard: useTouchDefaults };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }
  const obj = raw as Record<string, unknown>;
  const viewStyle: DefaultViewStyle = obj.viewStyle === 'original' ? 'original' : 'fit';
  const scrollStyle: ScrollStyle = obj.scrollStyle === 'scrollbar' ? 'scrollbar' : 'auto';
  const qualityPreset: ImageQualityPreset =
    obj.qualityPreset === 'best' ||
    obj.qualityPreset === 'balanced' ||
    obj.qualityPreset === 'low' ||
    obj.qualityPreset === 'custom'
      ? obj.qualityPreset
      : DEFAULT_DISPLAY_PREFS.qualityPreset;
  const codec: PreferredCodec =
    obj.codec === 'auto' ||
    obj.codec === 'vp8' ||
    obj.codec === 'vp9' ||
    obj.codec === 'h264' ||
    obj.codec === 'h265' ||
    obj.codec === 'av1'
      ? obj.codec
      : 'auto';

  return {
    viewStyle,
    scrollStyle,
    qualityPreset,
    // Keep the stored field name for existing browsers; the value is a quality ratio in percent.
    customBitrate: Math.round(clampInt(obj.customBitrate, 20, 200, DEFAULT_DISPLAY_PREFS.customBitrate) / 2) * 2,
    // Older preferences coupled FPS to the preset. Migrate their effective value once.
    targetFps: obj.targetFps !== undefined
      ? clampInt(obj.targetFps, 10, 60, DEFAULT_DISPLAY_PREFS.targetFps)
      : qualityPreset === 'best' ? 60 : qualityPreset === 'low' ? 15
      : qualityPreset === 'custom' ? clampInt(obj.customFps, 10, 60, DEFAULT_DISPLAY_PREFS.targetFps)
      : DEFAULT_DISPLAY_PREFS.targetFps,
    codec,
    viewOnly: Boolean(obj.viewOnly),
    followWindow: obj.followWindow === true,
    enlargeCursor: obj.enlargeCursor === true,
    autoKeyboard: typeof obj.autoKeyboard === 'boolean' ? obj.autoKeyboard : defaults.autoKeyboard,
    followRemoteCursor: obj.followRemoteCursor === true,
    showRemoteCursor:
      typeof obj.showRemoteCursor === 'boolean'
        ? obj.showRemoteCursor
        : DEFAULT_DISPLAY_PREFS.showRemoteCursor,
    disableClipboard: Boolean(obj.disableClipboard),
    lockAfterSessionEnd: Boolean(obj.lockAfterSessionEnd),
    reverseMouseWheel: Boolean(obj.reverseMouseWheel),
    swapMouseButtons: Boolean(obj.swapMouseButtons),
  };
}

export function loadDisplayPrefs(useTouchDefaults = false): DisplayPrefs {
  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_STORAGE_KEY);
    if (!raw) return normalizeDisplayPrefs(null, useTouchDefaults);
    return normalizeDisplayPrefs(JSON.parse(raw), useTouchDefaults);
  } catch {
    return normalizeDisplayPrefs(null, useTouchDefaults);
  }
}

export function persistDisplayPrefs(prefs: DisplayPrefs): void {
  try {
    window.localStorage.setItem(DISPLAY_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function filterCodecSupport(
  support: CodecSupport,
  preferred: PreferredCodec,
): CodecSupport {
  if (preferred === 'auto' || !support[preferred]) {
    const hasFastCodec = support.h264 || support.vp8 || support.vp9 || support.h265;
    return {
      ...support,
      // Avoid advertising AV1 in auto/fallback mode so hosts without GPU AV1 do not drop to 3-7fps CPU encoding
      av1: hasFastCodec ? false : support.av1,
    };
  }
  return {
    vp8: preferred === 'vp8',
    vp9: preferred === 'vp9',
    h264: preferred === 'h264',
    h265: preferred === 'h265',
    av1: preferred === 'av1',
    reported: support.reported,
  };
}

export function applyMouseButtonSwap(
  button: 'left' | 'right' | 'middle',
  swap: boolean,
): 'left' | 'right' | 'middle' {
  if (!swap) return button;
  if (button === 'left') return 'right';
  if (button === 'right') return 'left';
  return button;
}

export function applyWheelDirection(delta: number, reverse: boolean): number {
  if (delta === 0) return 0;
  return reverse ? -delta : delta;
}
