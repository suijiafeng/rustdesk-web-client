import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Build once; static requests never spend CPU recompressing the same asset. */
export function precompressAssets(): Plugin {
  return {
    name: 'precompress-static-assets',
    apply: 'build',
    enforce: 'post',
    async writeBundle(options, bundle) {
      const outDir = options.dir ? path.resolve(options.dir) : '';
      if (!outDir) return;
      for (const asset of Object.values(bundle)) {
        if (!/\.(?:js|css|html|svg|json|webmanifest)$/.test(asset.fileName)) continue;
        const target = path.resolve(outDir, asset.fileName);
        if (!target.startsWith(outDir + path.sep)) continue;
        const source = await readFile(target);
        if (source.length < 1024) continue;
        const variants = [
          ['br', brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })],
          ['gz', gzipSync(source, { level: 9 })],
        ] as const;
        for (const [extension, compressed] of variants) {
          if (compressed.length >= source.length) continue;
          await writeFile(`${target}.${extension}`, compressed);
        }
      }
    },
  };
}
