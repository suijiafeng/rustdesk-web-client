// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { CodecSupport } from '@rustdesk-web/shared';

export interface CodecProbeEntry {
  name: 'vp8' | 'vp9' | 'av1' | 'h264' | 'h265';
  candidates: readonly string[];
}

export const WEB_CODECS: readonly CodecProbeEntry[] = [
  { name: 'vp8', candidates: ['vp8'] },
  { name: 'vp9', candidates: ['vp09.00.41.08', 'vp09.00.10.08'] },
  { name: 'av1', candidates: ['av01.0.08M.08'] },
  { name: 'h264', candidates: ['avc1.640033', 'avc1.4D4033', 'avc1.42E033', 'avc1.42E01F'] },
  { name: 'h265', candidates: ['hev1.1.6.L93.B0'] },
];

export function webCodecsStatus(): { ok: boolean; reason: string } {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'WebCodecs is only available in a browser environment.' };
  }
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason:
        'WebCodecs is unavailable on this page. Open it as http://localhost or http://127.0.0.1, or put the gateway behind HTTPS. A plain http:// LAN address hides VideoDecoder.',
    };
  }
  if (typeof VideoDecoder === 'undefined') {
    return {
      ok: false,
      reason: 'This browser has no WebCodecs VideoDecoder. Use a current Chromium, Edge, or Safari.',
    };
  }
  return { ok: true, reason: '' };
}

export async function probeCodecs(): Promise<CodecSupport> {
  const result: CodecSupport = {
    vp8: false,
    vp9: false,
    h264: false,
    h265: false,
    av1: false,
    reported: true,
  };
  if (typeof VideoDecoder === 'undefined') return result;
  await Promise.all(
    WEB_CODECS.map(async (entry) => {
      for (const codec of entry.candidates) {
        try {
          const check = await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true });
          if (check.supported) {
            result[entry.name] = true;
            return;
          }
        } catch {
          // Try the next candidate profile.
        }
      }
    }),
  );
  return result;
}
