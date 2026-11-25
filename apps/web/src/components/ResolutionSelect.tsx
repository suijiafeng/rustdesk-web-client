// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

interface ResolutionSelectProps {
  label: string;
  resolutions: readonly { width: number; height: number }[];
  frameWidth: number;
  frameHeight: number;
  disabled: boolean;
  onSelect: (width: number, height: number) => void;
}

export function ResolutionSelect({ label, resolutions, frameWidth, frameHeight, disabled, onSelect }: ResolutionSelectProps) {
  const current = `${frameWidth}x${frameHeight}`;
  const listed = resolutions.some(({ width, height }) => `${width}x${height}` === current);

  return (
    <select
      aria-label={label}
      value={current}
      disabled={disabled}
      onChange={(event) => {
        const selected = resolutions.find(({ width, height }) => `${width}x${height}` === event.target.value);
        if (selected && selected.width > 0 && selected.height > 0) onSelect(selected.width, selected.height);
      }}
    >
      {listed ? null : <option value={current} disabled>{frameWidth} × {frameHeight}</option>}
      {resolutions.map(({ width, height }) => (
        <option key={`${width}x${height}`} value={`${width}x${height}`}>{width} × {height}</option>
      ))}
    </select>
  );
}
