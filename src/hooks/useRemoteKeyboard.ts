import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { DisplayPrefs } from '../lib/displayPrefs';
import { shouldIsolateKeyboardEvent } from '../lib/inputIsolation';
import {
  isImeEvent,
  isModifier,
  isPrintableAscii,
  mapPhysicalKeyDown,
  mapPhysicalKeyUp,
} from '../lib/keys';
import type { ClientMessage } from '../lib/protocol';
import type { ConnectionPhase } from '../types';

interface Options {
  send: (message: ClientMessage) => void;
  closeChrome: () => void;
  chromeRef: RefObject<{ menu: boolean; dialog: boolean }>;
  phaseRef: RefObject<ConnectionPhase>;
  displayPrefsRef: RefObject<DisplayPrefs>;
  shortcutModifier: 'Meta' | 'Control';
  showCtrlAltDel: boolean;
}

export function useRemoteKeyboard({
  send,
  closeChrome,
  chromeRef,
  phaseRef,
  displayPrefsRef,
  shortcutModifier,
  showCtrlAltDel,
}: Options) {
  const captureComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const pressedChrByCodeRef = useRef<Map<string, string>>(new Map());

  // Forward text efficiently: single ASCII chars as native keystrokes, CJK/multi-char as batched seq
  const sendText = useCallback(
    (text: string) => {
      if (!text) return;
      if (text === ' ') {
        send({ type: 'key', action: 'down', control: 'Space' });
        send({ type: 'key', action: 'up', control: 'Space' });
        return;
      }
      if (isPrintableAscii(text)) {
        send({ type: 'key', action: 'down', chr: text });
        send({ type: 'key', action: 'up', chr: text });
        return;
      }
      const chars = Array.from(text);
      const CHUNK = 64;
      for (let i = 0; i < chars.length; i += CHUNK) {
        send({ type: 'text', text: chars.slice(i, i + CHUNK).join('') });
      }
    },
    [send],
  );

  const tapControl = useCallback(
    (control: string) => {
      if (chromeRef.current.menu || chromeRef.current.dialog) return;
      send({ type: 'key', action: 'down', control });
      send({ type: 'key', action: 'up', control });
    },
    [send],
  );

  const sendChord = useCallback(
    (parts: Array<{ control?: string; chr?: string }>) => {
      if (chromeRef.current.menu || chromeRef.current.dialog) return;
      const modifiers = parts
        .map((p) => p.control)
        .filter((c): c is string => Boolean(c && isModifier(c)));

      for (const part of parts) {
        if (part.control) {
          send({ type: 'key', action: 'down', control: part.control, modifiers });
        } else if (part.chr) {
          send({ type: 'key', action: 'down', chr: part.chr, modifiers });
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (part.chr) {
          send({ type: 'key', action: 'up', chr: part.chr, modifiers });
        } else if (part.control) {
          send({ type: 'key', action: 'up', control: part.control, modifiers });
        }
      }
    },
    [send],
  );

  const handleQuickKey = useCallback(
    (name: 'Esc' | 'Tab' | 'Ctrl+C' | 'Ctrl+V' | 'Ctrl+Alt+Del' | 'Lock') => {
      if (name === 'Ctrl+Alt+Del' && !showCtrlAltDel) return;
      closeChrome();
      if (name === 'Esc') tapControl('Escape');
      else if (name === 'Tab') tapControl('Tab');
      else if (name === 'Ctrl+C') sendChord([{ control: shortcutModifier }, { chr: 'c' }]);
      else if (name === 'Ctrl+V') sendChord([{ control: shortcutModifier }, { chr: 'v' }]);
      else if (name === 'Ctrl+Alt+Del') tapControl('CtrlAltDel');
      else if (name === 'Lock') tapControl('LockScreen');
    },
    [closeChrome, sendChord, shortcutModifier, showCtrlAltDel, tapControl],
  );

  // Global physical keyboard listener (capture phase + full host-browser shortcut isolation)
  useEffect(() => {
    const isInsideChromeInput = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest('[data-testid="connection-panel"]') ||
          target.closest('[data-adaptive-select], [data-session-confirm], [data-session-notice]') ||
          target.closest('[data-testid="session-menu"]') ||
          target.closest('[data-testid="softbar"]'),
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-adaptive-select], [data-session-confirm], [data-session-notice]')) return;
      if (chromeRef.current.menu || chromeRef.current.dialog) {
        if (e.key === 'Escape' && phaseRef.current === 'live') {
          e.preventDefault();
          closeChrome();
          return;
        }
        if (isInsideChromeInput(e.target)) {
          return;
        }
        e.preventDefault();
        return;
      }

      if (
        !shouldIsolateKeyboardEvent({
          phase: phaseRef.current,
          chromeOpen: chromeRef.current.menu || chromeRef.current.dialog,
          insideChromeInput: isInsideChromeInput(e.target),
        })
      ) {
        return;
      }

      // Let native OS IME (Chinese/Japanese/Korean) compose smoothly inside the hidden capture input
      if (captureComposingRef.current || isImeEvent(e)) {
        return;
      }

      // Prevent host browser shortcuts (Ctrl+R/F/P/S/+/-, Tab, Space, Backspace, Alt, F1-F12, repeats)
      e.preventDefault();
      e.stopPropagation();

      if (displayPrefsRef.current.viewOnly) {
        return;
      }

      const mapped = mapPhysicalKeyDown(e);
      if (mapped) {
        if (mapped.type === 'key' && mapped.chr && e.code) {
          pressedChrByCodeRef.current.set(e.code, mapped.chr);
        }
        send(mapped);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (
        !shouldIsolateKeyboardEvent({
          phase: phaseRef.current,
          chromeOpen: chromeRef.current.menu || chromeRef.current.dialog,
          insideChromeInput: isInsideChromeInput(e.target),
        })
      ) {
        return;
      }

      if (
        captureComposingRef.current ||
        isImeEvent(e) ||
        performance.now() - lastCompositionEndAtRef.current < 80
      ) {
        return;
      }

      // Prevent Alt/Meta keyup from focusing browser chrome menus
      e.preventDefault();
      e.stopPropagation();

      if (displayPrefsRef.current.viewOnly) {
        return;
      }

      const trackedChr = e.code ? pressedChrByCodeRef.current.get(e.code) : undefined;
      if (e.code) {
        pressedChrByCodeRef.current.delete(e.code);
      }
      const mapped = mapPhysicalKeyUp(e, trackedChr);
      if (mapped && mapped.type === 'key') {
        send(mapped);
      }
    };

    const onWindowBlur = () => {
      captureComposingRef.current = false;
      pressedChrByCodeRef.current.clear();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [closeChrome, send]);

  return {
    captureComposingRef,
    lastCompositionEndAtRef,
    sendText,
    sendChord,
    handleQuickKey,
  };
}
