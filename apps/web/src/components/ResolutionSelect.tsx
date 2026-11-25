// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { AdaptiveSelect } from './AdaptiveSelect.tsx';

interface ResolutionSelectProps {
  label: string;
  resolutions: readonly { width: number; height: number }[];
  frameWidth: number;
  frameHeight: number;
  disabled: boolean;
  tone?: 'remote' | 'settings';
  onSelect: (width: number, height: number) => void;
}

export function ResolutionSelect({ label, resolutions, frameWidth, frameHeight, disabled, tone = 'remote', onSelect }: ResolutionSelectProps) {
  const current = `${frameWidth}x${frameHeight}`;
  const listed = resolutions.some(({ width, height }) => `${width}x${height}` === current);

  const options = resolutions.map(({ width, height }) => ({
    value: `${width}x${height}`,
    label: `${width} × ${height}`,
  }));
  return (
    <AdaptiveSelect
      label={label}
      tone={tone === 'remote' ? tone : undefined}
      testId="resolution-select"
      value={current}
      disabled={disabled}
      options={listed ? options : [{ value: current, label: `${frameWidth} × ${frameHeight}`, disabled: true }, ...options]}
      onChange={(value) => {
        const selected = resolutions.find(({ width, height }) => `${width}x${height}` === value);
        if (selected && selected.width > 0 && selected.height > 0) onSelect(selected.width, selected.height);
      }}
    />
  );
}
