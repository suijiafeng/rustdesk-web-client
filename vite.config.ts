import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { browserProtobuf } from './build/protobufPlugin.ts';
import { precompressAssets } from './build/precompress.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

export default defineConfig({
  plugins: [browserProtobuf(), react(), tailwindcss(), precompressAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': root },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
