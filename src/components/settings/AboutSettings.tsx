import { useEffect, useState } from 'react';
import { probeCodecs } from '../../lib/decoder';
import { t, type Locale } from '../../lib/i18n';

// Called by SettingsView to retain probing when settings opens, before the About tab is selected.
export function useDetectedCodecs() {
  const [detectedCodecs, setDetectedCodecs] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    probeCodecs()
      .then((res) => {
        if (!active) return;
        const list: string[] = [];
        if (res.vp8) list.push('VP8');
        if (res.vp9) list.push('VP9');
        if (res.h264) list.push('H.264');
        if (res.h265) list.push('H.265');
        if (res.av1) list.push('AV1');
        setDetectedCodecs(list);
      })
      .catch(() => {
        if (active) setDetectedCodecs([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return detectedCodecs;
}

export function AboutSettings({
  locale,
  detectedCodecs,
}: {
  locale: Locale;
  detectedCodecs: string[] | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rd-settings-card" data-testid="about-rustdesk-card">
        <h2 className="rd-settings-card-title">{t(locale, 'aboutRustDeskTitle')}</h2>
        <div className="rd-about-meta">
          <div>
            <span className="text-[var(--ink-soft)]">{t(locale, 'aboutVersion')}: </span>
            <span className="font-mono-tabular">{__APP_VERSION__}</span>
          </div>
          <div>
            <span className="text-[var(--ink-soft)]">{t(locale, 'aboutProtocol')}: </span>
            <span>RustDesk Native + WebCodecs</span>
          </div>
          <div>
            <span className="text-[var(--ink-soft)]">{t(locale, 'aboutDecoders')}: </span>
            <span className="font-mono-tabular" data-testid="about-detected-codecs">
              {detectedCodecs === null
                ? t(locale, 'aboutDecodersDetecting')
                : detectedCodecs.length > 0
                  ? detectedCodecs.join(' · ')
                  : t(locale, 'aboutDecodersNone')}
            </span>
          </div>
          <a
            href="https://rustdesk.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rd-about-link"
          >
            {t(locale, 'aboutWebsite')}
          </a>
          <a
            href="https://github.com/suijiafeng/rustdesk/tree/feature/web-client/web-client"
            target="_blank"
            rel="noopener noreferrer"
            className="rd-about-link"
          >
            {t(locale, 'aboutGithub')}
          </a>
        </div>

        <div className="rd-about-banner">
          <div className="text-sm font-medium">{t(locale, 'aboutBannerLine1')}</div>
          <div className="text-sm font-semibold">{t(locale, 'aboutBannerLine2')}</div>
        </div>
      </section>
    </div>
  );
}

