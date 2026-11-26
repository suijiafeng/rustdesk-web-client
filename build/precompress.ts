import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Build once; static requests never spend CPU recompressing the same asset. */
export function precompressAssets(): Plugin {
  return {
    name: 'precompress-static-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (!/\.(?:js|css|html|svg|json|webmanifest)$/.test(asset.fileName)) continue;
        const source = Buffer.from(asset.type === 'chunk' ? asset.code : asset.source);
        if (source.length < 1024) continue;
        const variants = [
          ['br', brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })],
          ['gz', gzipSync(source, { level: 9 })],
        ] as const;
        for (const [extension, compressed] of variants) {
          if (compressed.length >= source.length) continue;
          this.emitFile({ type: 'asset', fileName: `${asset.fileName}.${extension}`, source: compressed });
        }
      }
    },
  };
}
