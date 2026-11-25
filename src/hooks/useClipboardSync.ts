import { useCallback, useEffect, useRef, useState } from 'react';
import type { I18nKey } from '../lib/i18n';

interface Options {
  enabled: boolean;
  send: (text: string) => boolean;
  notify: (key: I18nKey, error?: boolean) => void;
}
const MAX_BYTES = 256 * 1024;
const newSession = () => ({ lastText: null as string | null, remote: null as string | null, revision: 0, writing: false });

export function useClipboardSync(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef(newSession());
  const [pending, setPending] = useState<'read' | 'write' | null>(null);
  const valid = (text: string) => new TextEncoder().encode(text).length <= MAX_BYTES;

  const sendLocal = useCallback((text: string) => {
    if (!latest.current.enabled) return false;
    if (!valid(text)) {
      latest.current.notify('clipTooLarge', true);
      return false;
    }
    const current = session.current;
    if ((text !== current.lastText || current.remote !== null) && !latest.current.send(text)) {
      latest.current.notify('clipSendFailed', true);
      return false;
    }
    current.lastText = text;
    current.remote = null;
    current.revision++;
    setPending(null);
    return true;
  }, []);

  const readLocal = useCallback(async (explicit = true) => {
    if (!latest.current.enabled) return;
    const current = session.current;
    const revision = current.revision;
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard unavailable');
      const text = await navigator.clipboard.readText();
      if (session.current !== current || !latest.current.enabled || current.revision !== revision) return;
      if (sendLocal(text) && explicit) latest.current.notify('clipSent');
    } catch {
      if (session.current !== current || !latest.current.enabled || current.revision !== revision) return;
      setPending('read');
      if (explicit) latest.current.notify('clipReadDenied', true);
    }
  }, [sendLocal]);

  const writeRemote = useCallback(async (explicit = true) => {
    const current = session.current;
    if (!latest.current.enabled || current.writing || current.remote === null) return;
    current.writing = true;
    try {
      // Serialize writes so a slower, older clipboard update cannot replace a newer one.
      while (session.current === current && latest.current.enabled && current.remote !== null) {
        const text: string = current.remote;
        if (!navigator.clipboard?.writeText || !document.hasFocus()) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        if (session.current !== current || !latest.current.enabled) return;
        current.lastText = text;
        if (current.remote === text) {
          current.remote = null;
          setPending(null);
          if (explicit) latest.current.notify('clipCopied');
        }
      }
    } catch {
      if (session.current === current && latest.current.enabled) {
        setPending('write');
        if (explicit) latest.current.notify('clipDenied', true);
      }
    } finally {
      current.writing = false;
    }
  }, []);

  const receive = useCallback((text: string) => {
    if (!latest.current.enabled || !valid(text)) return;
    const current = session.current;
    if (current.lastText === text && current.remote === null) return;
    current.remote = text;
    current.revision++;
    void writeRemote(false);
  }, [writeRemote]);

  useEffect(() => {
    session.current = newSession();
    setPending(null);
    if (!options.enabled) return;
    const syncOnReturn = async () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const current = session.current;
      const revision = current.revision;
      if (current.remote !== null) {
        setPending('write');
        return;
      }
      // Only read automatically with an existing grant. Safari instead gets a tap action.
      try {
        const permission = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
        if (session.current !== current || !latest.current.enabled || revision !== current.revision) return;
        if (permission.state === 'granted') {
          await readLocal(false);
          return;
        }
      } catch {
        // Browsers without this permission API still support an explicit paste gesture.
      }
      if (session.current === current && latest.current.enabled && revision === current.revision) setPending('read');
    };
    window.addEventListener('focus', syncOnReturn);
    document.addEventListener('visibilitychange', syncOnReturn);
    return () => {
      session.current = newSession();
      window.removeEventListener('focus', syncOnReturn);
      document.removeEventListener('visibilitychange', syncOnReturn);
    };
  }, [options.enabled, readLocal]);

  return { pending, receive, readLocal, writeRemote, sendLocal, dismiss: () => setPending(null) };
}
