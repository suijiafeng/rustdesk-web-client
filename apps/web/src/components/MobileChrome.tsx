// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useState } from 'react';
import { clampOrbPosition, orbCoordsFromState, snapOrbToEdge, type OrbState } from '../lib/floatingMenu.ts';
import { t, type Locale } from '../lib/i18n.ts';

interface MobileChromeProps {
  viewportWidth: number;
  viewportHeight: number;
  locale: Locale;
  portrait: boolean;
  open: boolean;
  keyboardOpen: boolean;
  touchMode: boolean;
  onToggleOpen: () => void;
  onToggleKeyboard: () => void;
  onToggleTouchMode: () => void;
}

export function MobileChrome({
  viewportWidth,
  viewportHeight,
  locale,
  portrait,
  open,
  keyboardOpen,
  touchMode,
  onToggleOpen,
  onToggleKeyboard,
  onToggleTouchMode,
}: MobileChromeProps) {
  const [orb, setOrb] = useState<OrbState>({ side: 'right', yRatio: 0.72 });
  const position = orbCoordsFromState(orb, 46, viewportWidth, viewportHeight, 10);

  return (
    <>
      <button
        type="button"
        data-testid="mobile-orb"
        aria-label={t(locale, 'menuLabel')}
        style={{
          position: 'absolute',
          left: position.x,
          top: position.y,
          width: 46,
          height: 46,
          borderRadius: 23,
          zIndex: 4,
          cursor: 'pointer',
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          const startX = event.clientX;
          const startY = event.clientY;
          const origin = position;
          const move = (ev: PointerEvent) => {
            const next = clampOrbPosition(
              origin.x + ev.clientX - startX,
              origin.y + ev.clientY - startY,
              46,
              viewportWidth,
              viewportHeight,
              10,
            );
            setOrb(snapOrbToEdge(next.x, next.y, 46, viewportWidth, viewportHeight, 10));
          };
          const up = (ev: PointerEvent) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) onToggleOpen();
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        {t(locale, 'menuLabel')}
      </button>
      {open ? (
        <div
          data-testid="mobile-dock"
          data-orientation={portrait ? 'portrait' : 'landscape'}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 'max(12px, env(safe-area-inset-bottom))',
            zIndex: 4,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            padding: 8,
            background: 'rgba(16, 20, 24, 0.92)',
            color: '#fff',
          }}
        >
          <button type="button" onClick={onToggleTouchMode} style={{ cursor: 'pointer' }}>
            {touchMode ? t(locale, 'touch') : t(locale, 'mouse')}
          </button>
          <button type="button" aria-pressed={keyboardOpen} onClick={onToggleKeyboard} style={{ cursor: 'pointer' }}>
            {t(locale, 'keyboard')}
          </button>
        </div>
      ) : null}
    </>
  );
}
