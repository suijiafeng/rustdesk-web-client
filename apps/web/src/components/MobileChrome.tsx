// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useState } from 'react';
import type { ClientMessage } from '@rustdesk-web/shared';
import { chordMessages, textMessages } from '../lib/keyboard.ts';
import { clampOrbPosition, orbCoordsFromState, snapOrbToEdge, type OrbState } from '../lib/floatingMenu.ts';

interface MobileChromeProps {
  viewportWidth: number;
  viewportHeight: number;
  portrait: boolean;
  open: boolean;
  keyboardOpen: boolean;
  touchMode: boolean;
  viewOnly: boolean;
  onToggleOpen: () => void;
  onToggleKeyboard: () => void;
  onToggleTouchMode: () => void;
  onSend: (messages: ClientMessage[]) => void;
}

const SOFT_KEYS = [
  ['Esc', 'Escape'],
  ['Tab', 'Tab'],
  ['Left', 'ArrowLeft'],
  ['Right', 'ArrowRight'],
  ['Up', 'ArrowUp'],
  ['Down', 'ArrowDown'],
  ['PgUp', 'PageUp'],
  ['PgDn', 'PageDown'],
] as const;

export function MobileChrome({
  viewportWidth,
  viewportHeight,
  portrait,
  open,
  keyboardOpen,
  touchMode,
  viewOnly,
  onToggleOpen,
  onToggleKeyboard,
  onToggleTouchMode,
  onSend,
}: MobileChromeProps) {
  const [orb, setOrb] = useState<OrbState>({ side: 'right', yRatio: 0.72 });
  const position = orbCoordsFromState(orb, 46, viewportWidth, viewportHeight, 10);
  const sendKeys = (messages: ClientMessage[]) => {
    if (!viewOnly) onSend(messages);
  };

  return (
    <>
      <button
        type="button"
        data-testid="mobile-orb"
        aria-label="Session menu"
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
        Menu
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
            {touchMode ? 'Touch mode' : 'Mouse mode'}
          </button>
          <button type="button" onClick={onToggleKeyboard} style={{ cursor: 'pointer' }}>
            Keyboard
          </button>
          {keyboardOpen ? (
            <>
              <input
                aria-label="Remote text"
                data-testid="soft-text"
                disabled={viewOnly}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  const value = event.target.value;
                  event.target.value = '';
                  sendKeys(textMessages(value, viewOnly));
                }}
                style={{ minWidth: 120 }}
              />
              {SOFT_KEYS.map(([label, control]) => (
                <button
                  key={control}
                  type="button"
                  disabled={viewOnly}
                  onClick={() => sendKeys([
                    { type: 'key', action: 'down', control },
                    { type: 'key', action: 'up', control },
                  ])}
                  style={{ cursor: 'pointer' }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                disabled={viewOnly}
                onClick={() => sendKeys(chordMessages([{ control: 'Control' }, { chr: 'c' }], viewOnly))}
                style={{ cursor: 'pointer' }}
              >
                Ctrl+C
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
