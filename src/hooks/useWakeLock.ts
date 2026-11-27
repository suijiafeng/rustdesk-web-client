import { useEffect } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

/**
 * Keeps the device screen awake while a remote desktop session is active.
 * Automatically releases on disconnect/unmount and re-acquires when returning to foreground.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || typeof document === 'undefined') return;
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) return;

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const releaseLock = () => {
      const current = sentinel;
      sentinel = null;
      if (current && !current.released) {
        void current.release().catch(() => {});
      }
    };

    const requestLock = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const next = await wakeLock.request('screen');
        if (cancelled) {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
      } catch {
        // Ignore browser rejections (e.g. battery saver mode or restricted iframe).
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestLock();
      } else {
        releaseLock();
      }
    };

    void requestLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseLock();
    };
  }, [active]);
}
