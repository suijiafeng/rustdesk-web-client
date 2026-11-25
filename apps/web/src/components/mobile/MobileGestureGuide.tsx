// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { t, type I18nKey, type Locale } from '../../lib/i18n.ts';

const gestureRows = {
  touch: [
    ['gTouchTapTitle', 'gTouchTapDesc'],
    ['gDoubleTapTitle', 'gTouchDoubleTapDesc'],
    ['gTouchRightTitle', 'gTouchRightDesc'],
    ['gTouchDragTitle', 'gTouchDragDesc'],
    ['gTouchPinchTitle', 'gTouchPinchDesc'],
    ['gTouchScrollTitle', 'gTouchScrollDesc'],
  ],
  mouse: [
    ['gMouseSlideTitle', 'gMouseSlideDesc'],
    ['gMouseTapTitle', 'gMouseTapDesc'],
    ['gDoubleTapTitle', 'gMouseDoubleTapDesc'],
    ['gMouseDragTitle', 'gMouseDragDesc'],
    ['gMouseRightTitle', 'gMouseRightDesc'],
    ['gMousePinchTitle', 'gMousePinchDesc'],
    ['gTouchScrollTitle', 'gTouchScrollDesc'],
  ],
} as const satisfies Record<string, readonly (readonly [I18nKey, I18nKey])[]>;

export function MobileGestureGuide({ locale, touchMode }: { locale: Locale; touchMode: boolean }) {
  const inputMode = touchMode ? 'touch' : 'mouse';
  return (
    <div className="tool-group">
      <h2>{t(locale, touchMode ? 'touchModeGestures' : 'mouseModeGestures')}</h2>
      <dl data-testid="gesture-guide">
        {gestureRows[inputMode].map(([title, description]) => (
          <div key={title}>
            <dt>{t(locale, title)}</dt>
            <dd>{t(locale, description)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
