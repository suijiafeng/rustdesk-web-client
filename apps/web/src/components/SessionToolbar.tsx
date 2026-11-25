// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { DisplayInfo, QualityLevel } from '@rustdesk-web/shared';

interface SessionToolbarProps {
  displays: readonly DisplayInfo[];
  currentDisplay: number;
  quality: QualityLevel;
  viewOnly: boolean;
  privacyAllowed: boolean;
  onSwitchDisplay: (display: number) => void;
  onQuality: (quality: QualityLevel) => void;
  onToggleViewOnly: () => void;
}

const QUALITIES: QualityLevel[] = ['low', 'balanced', 'best'];

export function SessionToolbar({
  displays,
  currentDisplay,
  quality,
  viewOnly,
  privacyAllowed,
  onSwitchDisplay,
  onQuality,
  onToggleViewOnly,
}: SessionToolbarProps) {
  return (
    <div
      data-testid="session-toolbar"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        zIndex: 3,
        maxWidth: 'calc(100% - 220px)',
      }}
    >
      {displays.map((display, index) => (
        <button
          key={`${display.name}-${index}`}
          type="button"
          disabled={!display.online}
          aria-pressed={index === currentDisplay}
          onClick={() => onSwitchDisplay(index)}
          style={{ cursor: 'pointer' }}
        >
          {display.name || `Display ${index + 1}`}
        </button>
      ))}
      <label>
        Quality{' '}
        <select
          aria-label="Quality"
          value={quality}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'low' || next === 'balanced' || next === 'best') onQuality(next);
          }}
        >
          {QUALITIES.map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
      </label>
      <button type="button" aria-pressed={viewOnly} onClick={onToggleViewOnly} style={{ cursor: 'pointer' }}>
        {viewOnly ? 'View only' : 'Control'}
      </button>
      {!privacyAllowed ? <span data-testid="privacy-revoked">Privacy control unavailable</span> : null}
    </div>
  );
}
