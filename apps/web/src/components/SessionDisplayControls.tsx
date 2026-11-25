// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { CodecSupport, QualityLevel } from '@rustdesk-web/shared';
import { Film, Gauge, SlidersHorizontal } from 'lucide-react';
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
  rows?: boolean;
}

const qualities = { low: 'qualityLow', balanced: 'qualityBalanced', best: 'qualityBest' } as const;
const videoCodecs = { h264: 'H.264', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', h265: 'H.265' } as const;
const codecs = Object.keys(videoCodecs) as Array<keyof typeof videoCodecs>;

export function SessionDisplayControls({ locale, quality, targetFps, codec, codecSupport, onQuality, onFps, onCodec, rows = false }: SessionDisplayControlsProps) {
  const qualityLabel = t(locale, rows ? 'qualityAndFps' : 'sessionQuality');
  const fpsLabel = t(locale, 'targetFps');
  const codecLabel = t(locale, 'sessionCodecLabel');
  const fpsOptions = [...new Set([15, 30, 60, targetFps])].sort((a, b) => a - b);
  const qualitySelect = (
    <AdaptiveSelect tone="remote" testId="quality-select" label={qualityLabel} value={quality}
      options={(Object.keys(qualities) as QualityLevel[]).map((value) => ({ value, label: t(locale, qualities[value]) }))}
      onChange={(value) => onQuality(value as QualityLevel)} />
  );
  const fpsSelect = (
    <AdaptiveSelect tone="remote" testId="fps-select" label={fpsLabel} value={String(targetFps)}
      options={fpsOptions.map((fps) => ({ value: String(fps), label: `${fps} FPS` }))}
      onChange={(value) => onFps(Number(value))} />
  );
  const codecSelect = (
    <AdaptiveSelect tone="remote" testId="codec-select" label={codecLabel} value={codec}
      options={[{ value: 'auto', label: t(locale, 'codecAuto') }, ...codecs
        .filter((value) => !rows || value !== 'h265' || codec === value)
        .map((value) => ({ value, label: videoCodecs[value], disabled: !codecSupport?.[value] }))]}
      onChange={(value) => onCodec(value as PreferredCodec)} />
  );
  if (rows) {
    return (
      <div data-testid="mobile-quality" className="mobile-quality">
        <div className="tool-row"><SlidersHorizontal size={18} aria-hidden="true" /><span>{qualityLabel}</span>{qualitySelect}</div>
        <div className="tool-row"><Gauge size={18} aria-hidden="true" /><span>{fpsLabel}</span>{fpsSelect}</div>
        <div className="tool-row"><Film size={18} aria-hidden="true" /><span>{codecLabel}</span>{codecSelect}</div>
      </div>
    );
  }
  return <div className="session-display-controls">{qualitySelect}{fpsSelect}{codecSelect}</div>;
}
