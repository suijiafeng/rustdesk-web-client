// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export type SessionChrome = 'desktop' | 'dock' | 'keyboard';

/** Desktop keeps the top toolbar. A touch or narrow layout uses the bottom dock, hidden while the soft keyboard is open. */
export function sessionChromeMode(input: {
  width: number;
  coarsePointer: boolean;
  keyboardOpen: boolean;
  viewportNarrow: boolean;
}): SessionChrome {
  const touchLayout = input.width > 0
    ? input.coarsePointer || input.width <= 768
    : input.coarsePointer || input.viewportNarrow;
  if (!touchLayout) return 'desktop';
  return input.keyboardOpen ? 'keyboard' : 'dock';
}
