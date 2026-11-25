// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardActionResult } from '../lib/platform.ts';

function newSyncState() {
  return { last: null as string | null, remote: null as string | null, revision: 0, writing: false };
}

export function useClipboardSync(
  enabled: boolean,
  send: (text: string) => ClipboardActionResult,
  showRemote: (text: string | null) => void,
) {
  const latest = useRef({ enabled, send, showRemote });
  latest.current = { enabled, send, showRemote };
  const state = useRef(newSyncState());
  const [needsRead, setNeedsRead] = useState(false);

  const sendLocal = useCallback((text: string): ClipboardActionResult => {
    if (!latest.current.enabled) return 'disabled';
    const current = state.current;
    const result = current.last === text && current.remote === null ? 'ok' : latest.current.send(text);
    if (result === 'ok') {
      current.last = text;
      current.remote = null;
      current.revision += 1;
      setNeedsRead(false);
    }
    return result;
  }, []);

  const readLocal = useCallback(async (): Promise<ClipboardActionResult> => {
    if (!latest.current.enabled || document.visibilityState !== 'visible' || !document.hasFocus()) return 'disabled';
    const current = state.current;
    const revision = current.revision;
    let text: string;
    try {
      if (!navigator.clipboard?.readText) return 'read-failed';
      text = await navigator.clipboard.readText();
    } catch {
      return 'read-failed';
    }
    if (state.current !== current || current.revision !== revision || document.visibilityState !== 'visible'
      || !document.hasFocus()) return 'disabled';
    return sendLocal(text);
  }, [sendLocal]);

  const receive = useCallback(async (text: string) => {
    if (!latest.current.enabled) {
      latest.current.showRemote(text);
      return;
    }
    const current = state.current;
    if (current.last === text && current.remote === null) return;
    current.remote = text;
    current.revision += 1;
    if (current.writing) return;
    current.writing = true;
    try {
      while (state.current === current && latest.current.enabled && current.remote !== null) {
        const value: string = current.remote;
        if (!navigator.clipboard?.writeText || document.visibilityState !== 'visible'
          || !document.hasFocus()) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
        if (state.current !== current || !latest.current.enabled) return;
        current.last = value;
        if (current.remote === value) {
          current.remote = null;
          latest.current.showRemote(null);
        }
      }
    } catch {
      if (state.current === current && latest.current.enabled) latest.current.showRemote(current.remote);
    } finally {
      current.writing = false;
    }
  }, []);

  const noteCopied = useCallback((text: string) => {
    const current = state.current;
    current.last = text;
    if (current.remote === text) current.remote = null;
    current.revision += 1;
  }, []);

  useEffect(() => {
    setNeedsRead(false);
    if (!enabled) return;
    const onReturn = async () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const current = state.current;
      const revision = current.revision;
      if (current.remote !== null) return;
      try {
        const permission = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
        if (state.current !== current || current.revision !== revision || !latest.current.enabled) return;
        if (permission.state === 'granted') {
          const result = await readLocal();
          if (result !== 'read-failed') return;
        }
      } catch {
        // Browsers without the permission API need an explicit click.
      }
      if (state.current === current && current.revision === revision && latest.current.enabled) setNeedsRead(true);
    };
    void onReturn();
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      state.current = newSyncState();
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [enabled, readLocal]);

  return { needsRead, readLocal, receive, sendLocal, noteCopied };
}
