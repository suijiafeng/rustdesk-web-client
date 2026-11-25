// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { DisplayInfo } from '@rustdesk-web/shared';
import { Focus, Monitor } from 'lucide-react';
import { t } from '../../lib/i18n.ts';
import { ResolutionSelect } from '../ResolutionSelect.tsx';
import { SessionDisplayControls, type SessionDisplayControlsProps } from '../SessionDisplayControls.tsx';
import { useToast } from '../ToastProvider.tsx';
import { MobileMenuSwitch } from './MobileMenuSwitch.tsx';

export interface MobileDisplayMenuProps extends Omit<SessionDisplayControlsProps, 'rows' | 'onRequestSent'> {
  displays: readonly DisplayInfo[];
  currentDisplay: number;
  viewOnly: boolean;
  followWindow: boolean;
  onToggleFollowWindow: () => void;
  onSwitchDisplay: (display: number) => boolean;
  resolutions: readonly { width: number; height: number }[];
  frameWidth: number;
  frameHeight: number;
  onResolution: (width: number, height: number) => boolean;
}

export function MobileDisplayMenu({
  displays,
  currentDisplay,
  viewOnly,
  followWindow,
  onToggleFollowWindow,
  onSwitchDisplay,
  resolutions,
  frameWidth,
  frameHeight,
  onResolution,
  canChangeResolution,
  ...displayControls
}: MobileDisplayMenuProps & {
  canChangeResolution: boolean;
}) {
  const showToast = useToast();
  const { locale } = displayControls;
  const hasMultipleDisplays = displays.length > 1;
  const resolutionLabel = t(locale, 'remoteResolution');
  const followWindowLabel = t(locale, 'followWindow');

  function showRequestSent(selection: string) {
    showToast(`${t(locale, 'displayRequestSent')} · ${selection}`);
  }

  return (
    <>
      {hasMultipleDisplays ? (
        <div className="tool-group tool-options">
          {displays.map((display, displayIndex) => {
            const displayLabel = display.name || `${t(locale, 'screens')} ${displayIndex + 1}`;
            return (
              <button
                key={`${display.name}-${displayIndex}`}
                type="button"
                aria-pressed={displayIndex === currentDisplay}
                disabled={display.online === false}
                onClick={() => {
                  if (onSwitchDisplay(displayIndex)) showRequestSent(displayLabel);
                }}
              >
                <Monitor size={18} aria-hidden="true" />
                {displayLabel}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="tool-group">
        {canChangeResolution && resolutions.length > 0 ? (
          <div className="tool-row">
            <Monitor size={18} aria-hidden="true" />
            <span>{resolutionLabel}</span>
            <ResolutionSelect
              label={resolutionLabel}
              resolutions={resolutions}
              frameWidth={frameWidth}
              frameHeight={frameHeight}
              disabled={viewOnly}
              onSelect={(width, height) => {
                if (onResolution(width, height)) showRequestSent(`${width} × ${height}`);
              }}
            />
          </div>
        ) : null}
        <SessionDisplayControls {...displayControls} onRequestSent={showRequestSent} rows />
      </div>
      {hasMultipleDisplays ? (
        <div className="tool-group">
          <MobileMenuSwitch icon={Focus} label={followWindowLabel} checked={followWindow} onChange={() => {
            onToggleFollowWindow();
            const nextStateLabel = t(locale, followWindow ? 'optionOff' : 'optionOn');
            showToast(`${followWindowLabel} · ${nextStateLabel}`);
          }} />
        </div>
      ) : null}
    </>
  );
}
