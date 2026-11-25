// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { CodecSupport, QualityLevel } from '@rustdesk-web/shared';
import type { PreferredCodec } from '../lib/displayPrefs.ts';
import { t, type Locale } from '../lib/i18n.ts';
import { AdaptiveSelect } from './AdaptiveSelect.tsx';

export interface SessionDisplayControlsProps {
  locale: Locale;
  quality: QualityLevel;
  targetFps: number;
  codec: PreferredCodec;
  codecSupport: CodecSupport | null;
  onQuality: (quality: QualityLevel) => void;
  onFps: (fps: number) => void;
  onCodec: (codec: PreferredCodec) => void;
}

const qualities = { low: 'qualityLow', balanced: 'qualityBalanced', best: 'qualityBest' } as const;
export const videoCodecs = { vp8: 'VP8', vp9: 'VP9', h264: 'H.264', h265: 'H.265', av1: 'AV1' } as const;
const codecs = Object.keys(videoCodecs) as Array<keyof typeof videoCodecs>;

export function SessionDisplayControls({ locale, quality, targetFps, codec, codecSupport, onQuality, onFps, onCodec }: SessionDisplayControlsProps) {
  const fpsOptions = [...new Set([15, 24, 30, 45, 60, targetFps])].sort((a, b) => a - b);
  return (
    <div className="session-display-controls">
      <AdaptiveSelect tone="remote" testId="quality-select" label={t(locale, 'sessionQuality')} value={quality}
        options={(Object.keys(qualities) as QualityLevel[]).map((value) => ({ value, label: t(locale, qualities[value]) }))}
        onChange={(value) => onQuality(value as QualityLevel)} />
      <AdaptiveSelect tone="remote" testId="fps-select" label={t(locale, 'targetFps')} value={String(targetFps)}
        options={fpsOptions.map((fps) => ({ value: String(fps), label: `${fps} FPS` }))}
        onChange={(value) => onFps(Number(value))} />
      <AdaptiveSelect tone="remote" testId="codec-select" label={t(locale, 'defaultCodec')} value={codec}
        options={[{ value: 'auto', label: t(locale, 'codecAuto') }, ...codecs.map((value) => ({
          value, label: videoCodecs[value], disabled: !codecSupport?.[value],
        }))]}
        onChange={(value) => onCodec(value as PreferredCodec)} />
    </div>
  );
}
