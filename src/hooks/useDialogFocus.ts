import { useEffect, useRef } from 'react';

// These dialogs mount only while open; preserve their opener across renders.
export function useDialogFocus(onClose: () => void) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const openerRef = useRef(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    )).filter(element => element.getClientRects().length > 0);
    if (!dialog.contains(document.activeElement)) (focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0] ?? dialog;
        const last = items.at(-1) ?? dialog;
        if (!dialog.contains(document.activeElement) ||
            (!event.shiftKey && document.activeElement === last) ||
            (event.shiftKey && document.activeElement === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (focusable()[0] ?? dialog).focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      const opener = openerRef.current;
      // Opening the next dialog may already have moved focus to its input.
      if (opener instanceof HTMLElement && opener.isConnected &&
          (document.activeElement === document.body || dialog.contains(document.activeElement))) opener.focus();
    };
  }, []);
  return dialogRef;
}
