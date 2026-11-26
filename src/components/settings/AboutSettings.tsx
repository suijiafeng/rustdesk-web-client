import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { probeCodecs } from '../../lib/decoder';
import { t, type Locale } from '../../lib/i18n';
import type { CodecSupport } from '../../lib/protocol';

// Called by SettingsView to retain probing when settings opens, shared by Display and About tabs.
export function useProbedCodecSupport(): CodecSupport | null {
  const [codecSupport, setCodecSupport] = useState<CodecSupport | null>(null);

  useEffect(() => {
    let active = true;
    probeCodecs()
      .then((res) => {
        if (active) setCodecSupport(res);
      })
      .catch(() => {
        if (active) {
          setCodecSupport({ vp8: false, vp9: false, h264: false, h265: false, av1: false, reported: false });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return codecSupport;
}

function listSupportedCodecs(support: CodecSupport | null): string[] | null {
  if (!support) return null;
  const list: string[] = [];
  if (support.h264) list.push('H.264');
  if (support.h265) list.push('H.265');
  if (support.vp8) list.push('VP8');
  if (support.vp9) list.push('VP9');
  if (support.av1) list.push('AV1');
  return list;
}

export function AboutSettings({
  locale,
  codecSupport,
}: {
  locale: Locale;
  codecSupport: CodecSupport | null;
}) {
  const detectedCodecs = listSupportedCodecs(codecSupport);
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  const audioSupported =
    typeof AudioDecoder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined';
  const webRtcSupported = typeof RTCPeerConnection !== 'undefined';

  return (
    <div className="flex flex-col gap-5">
      <section className="rd-settings-card" data-testid="about-rustdesk-card">
        <h3 className="rd-settings-card-title">{t(locale, 'aboutRustDeskTitle')}</h3>

        <div className="rd-info-row">
          <span className="text-[var(--ink-soft)]">{t(locale, 'aboutVersion')}</span>
          <span className="font-mono-tabular text-[var(--ink)]">{__APP_VERSION__}</span>
        </div>

        <div className="rd-info-row">
          <span className="text-[var(--ink-soft)]">{t(locale, 'aboutProtocol')}</span>
          <span className="text-[var(--ink)]">RustDesk Native + WebCodecs</span>
        </div>

        <div className="rd-info-row">
          <span className="text-[var(--ink-soft)]">{t(locale, 'aboutGithub')}</span>
          <a
            href="https://github.com/suijiafeng/rustdesk-web-client"
            target="_blank"
            rel="noopener noreferrer"
            className="rd-about-link inline-flex items-center gap-1"
          >
            <span>suijiafeng/rustdesk-web-client</span>
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>

        <div className="rd-info-row">
          <span className="text-[var(--ink-soft)]">{t(locale, 'aboutWebsite')}</span>
          <a
            href="https://rustdesk.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rd-about-link inline-flex items-center gap-1"
          >
            <span>rustdesk.com</span>
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="rd-settings-card" data-testid="about-env-card">
        <h3 className="rd-settings-card-title">{t(locale, 'aboutEnvTitle')}</h3>

        <div className="rd-info-row">
          <span className="text-[var(--ink-soft)]">{t(locale, 'aboutEnvSecureContext')}</span>
          <span className={`rd-env-status ${secureContext ? 'ok' : 'warn'}`}>
            <span className="rd-env-dot" aria-hidden="true" />
            {t(locale, secureContext ? 'aboutEnvSecureOk' : 'aboutEnvSecureWarn')}
          </span>
        </div>

        <div className="rd-info-row">
          <span className="text-[var(--ink-soft)]">{t(locale, 'aboutDecoders')}</span>
          <span
            className={`rd-env-status font-mono-tabular ${
              detectedCodecs === null
                ? 'muted'
                : detectedCodecs.length > 0
                  ? 'ok'
                  : 'bad'
            }`}
            data-testid="about-detected-codecs"
          >
            <span className="rd-env-dot" aria-hidden="true" />
            {detectedCodecs === null
              ? t(locale, 'aboutDecodersDetecting')
              : detectedCodecs.length > 0
                ? detectedCodecs.join(' · ')
                : t(locale, 'aboutDecodersNone')}
          </span>
        </div>

        <div className="rd-info-row">
          <span className="text-[var(--ink-soft)]">{t(locale, 'aboutEnvAudio')}</span>
          <span className={`rd-env-status ${audioSupported ? 'ok' : 'warn'}`}>
            <span className="rd-env-dot" aria-hidden="true" />
            {t(locale, audioSupported ? 'aboutEnvAvailable' : 'aboutEnvUnavailable')}
          </span>
        </div>

        <div className="rd-info-row">
          <span className="text-[var(--ink-soft)]">{t(locale, 'aboutEnvWebRtc')}</span>
          <span className={`rd-env-status ${webRtcSupported ? 'ok' : 'warn'}`}>
            <span className="rd-env-dot" aria-hidden="true" />
            {t(locale, webRtcSupported ? 'aboutEnvAvailable' : 'aboutEnvUnavailable')}
          </span>
        </div>

        <div className="rd-about-banner">
          <div className="text-sm font-medium">{t(locale, 'aboutBannerLine1')}</div>
          <div className="text-xs opacity-90">{t(locale, 'aboutBannerLine2')}</div>
        </div>
      </section>
    </div>
  );
}


