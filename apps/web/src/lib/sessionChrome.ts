// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

/** Top session controls hide while the mobile soft keyboard is open, until the menu button reopens them. */
export function sessionToolbarVisible(narrow: boolean, keyboardOpen: boolean, reopened: boolean): boolean {
  return !narrow || !keyboardOpen || reopened;
}
