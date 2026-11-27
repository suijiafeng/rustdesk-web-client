import type { useClipboardSync } from '../hooks/useClipboardSync';
import { t, type Locale } from '../lib/i18n';
import type { ConnectionPhase } from '../types';

interface SessionNoticesProps {
  locale: Locale;
  phase: ConnectionPhase;
  webRtcFallbackReason: string | null;
  onDismissWebRtcFallback: () => void;
  sessionTip: { text: string; error: boolean } | null;
  clipboardSync: boolean;
  clipboardAllowed: boolean;
  clipboard: ReturnType<typeof useClipboardSync>;
}

/**
 * Renders non-intrusive live session notice banners (WebRTC fallback notice,
 * transient status tips, and manual clipboard sync prompts).
 */
export function SessionNotices({
  locale,
  phase,
  webRtcFallbackReason,
  onDismissWebRtcFallback,
  sessionTip,
  clipboardSync,
  clipboardAllowed,
  clipboard,
}: SessionNoticesProps) {
  const isLive = phase === 'live';
  const showRegion = isLive || webRtcFallbackReason !== null;
  if (!showRegion) return null;

  const showClipboardPrompt = isLive && clipboardSync && clipboardAllowed && Boolean(clipboard.pending);
  const isClipboardWrite = clipboard.pending === 'write';
  const clipboardPromptText = t(locale, isClipboardWrite ? 'clipRemoteReady' : 'clipLocalReady');
  const clipboardActionText = t(locale, isClipboardWrite ? 'copy' : 'clipSyncAction');

  const handleClipboardAction = () => {
    void (isClipboardWrite ? clipboard.writeRemote() : clipboard.readLocal());
  };

  const stopBubble = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="session-tip-region" aria-live="polite" aria-atomic="true">
      {webRtcFallbackReason !== null && (
        <div
          className="session-tip fallback-tip"
          data-testid="webrtc-fallback-tip"
          data-session-notice
          onPointerDown={stopBubble}
          onPointerUp={stopBubble}
          onPointerMove={stopBubble}
          onClick={stopBubble}
        >
          <span>
            {t(locale, 'webRtcFallback')}
            <br />
            {webRtcFallbackReason}
          </span>
          <button
            type="button"
            data-testid="webrtc-fallback-dismiss"
            aria-label={t(locale, 'close')}
            onClick={onDismissWebRtcFallback}
          >
            ×
          </button>
        </div>
      )}

      {isLive && sessionTip && (
        <div className="session-tip" data-testid="session-tip">
          {sessionTip.text}
        </div>
      )}

      {showClipboardPrompt && (
        <div
          className="session-tip clipboard-tip"
          data-testid="clipboard-tip"
          onPointerDown={stopBubble}
          onClick={stopBubble}
        >
          <span>{clipboardPromptText}</span>
          <button type="button" onClick={handleClipboardAction}>
            {clipboardActionText}
          </button>
          <button type="button" aria-label={t(locale, 'close')} onClick={clipboard.dismiss}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
