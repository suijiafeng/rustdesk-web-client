import { useEffect } from 'react';

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 5_000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

/**
 * Keeps the device screen awake while enabled during an active remote session.
 * Automatically releases on disconnect/unmount, when hidden, or after 15 minutes
 * without pointer/keyboard/touch input, and re-acquires on subsequent activity.
 */
export function useWakeLock(active: boolean, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) return;

    let cancelled = false;
    let requesting = false;
    let idleExpired = false;
    let sentinel: WakeLockSentinelLike | null = null;
    let idleTimer: number | null = null;
    let lastActivityAt = Date.now();
    let lastResetAt = lastActivityAt;

    const clearIdleTimer = () => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const handleSentinelRelease = () => {
      if (sentinel?.released) {
        sentinel.removeEventListener?.('release', handleSentinelRelease);
        sentinel = null;
      }
    };

    const releaseLock = () => {
      const current = sentinel;
      sentinel = null;
      if (current) {
        current.removeEventListener?.('release', handleSentinelRelease);
        if (!current.released) {
          void current.release().catch(() => {});
        }
      }
    };

    const requestLock = async () => {
      if (cancelled || requesting || idleExpired || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      requesting = true;
      try {
        const next = await wakeLock.request('screen');
        if (cancelled || idleExpired || document.visibilityState !== 'visible') {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
        next.addEventListener?.('release', handleSentinelRelease);
      } catch {
        // Ignore browser rejections (e.g. battery saver mode or restricted iframe).
      } finally {
        requesting = false;
      }
    };

    const scheduleIdleRelease = (delayMs: number) => {
      clearIdleTimer();
      if (idleTimeoutMs <= 0 || cancelled || document.visibilityState !== 'visible') return;
      idleTimer = window.setTimeout(() => {
        idleTimer = null;
        if (cancelled) return;
        const remaining = idleTimeoutMs - (Date.now() - lastActivityAt);
        if (remaining > 500) {
          scheduleIdleRelease(remaining);
          return;
        }
        idleExpired = true;
        releaseLock();
      }, Math.max(0, delayMs));
    };

    const handleActivity = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const now = Date.now();
      lastActivityAt = now;
      const wasIdle = idleExpired;
      idleExpired = false;
      if (wasIdle || now - lastResetAt >= ACTIVITY_THROTTLE_MS) {
        lastResetAt = now;
        scheduleIdleRelease(idleTimeoutMs);
      }
      if (wasIdle || !sentinel || sentinel.released) {
        void requestLock();
      }
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        lastActivityAt = Date.now();
        lastResetAt = lastActivityAt;
        idleExpired = false;
        scheduleIdleRelease(idleTimeoutMs);
        void requestLock();
      } else {
        clearIdleTimer();
        releaseLock();
      }
    };

    scheduleIdleRelease(idleTimeoutMs);
    void requestLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, handleActivity, { passive: true, capture: true });
    }

    return () => {
      cancelled = true;
      clearIdleTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, handleActivity, { capture: true });
      }
      releaseLock();
    };
  }, [active, idleTimeoutMs]);
}
