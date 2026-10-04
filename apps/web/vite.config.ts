import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';
import { iconPngs } from './src/offline/icons.ts';
import { buildManifest } from './src/offline/manifest.ts';

const require = createRequire(import.meta.url);

/** Languages whose OCR data is served (see src/documents/ocr.ts). */
const OCR_LANGUAGES = ['eng', 'fra', 'deu', 'spa', 'ita', 'por', 'nld'];

/**
 * OCR runs Tesseract in the browser. Its worker, engine and English data come from npm and are
 * served at fixed paths under ocr/ (Tesseract looks the language data up by file name), in
 * development and in the build, rather than from a CDN at run time.
 */
function ocrAssets(): Plugin {
  const tesseract = dirname(require.resolve('tesseract.js/package.json'));
  const files: Record<string, string> = {
    'worker.min.js': require.resolve('tesseract.js/dist/worker.min.js'),
    'tesseract-core-lstm.wasm.js': require.resolve('tesseract.js-core/tesseract-core-lstm.wasm.js', { paths: [tesseract] }),
    'tesseract-core-simd-lstm.wasm.js': require.resolve('tesseract.js-core/tesseract-core-simd-lstm.wasm.js', { paths: [tesseract] }),
    'tesseract-core-relaxedsimd-lstm.wasm.js': require.resolve('tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', { paths: [tesseract] }),
    // English and the other languages OCR offers (about 3 MB each, fetched only when used).
    ...Object.fromEntries(OCR_LANGUAGES.map((l) => [`${l}.traineddata.gz`, require.resolve(`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`)])),
  };
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.match(/\/ocr\/([^/]+)$/)?.[1];
        const file = name ? files[name] : undefined;
        if (!file) return next();
        res.setHeader('Content-Type', name!.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(files)) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(file) });
    },
  };
}

/** Spell checking's English dictionary (Hunspell files from npm), served at spell/en.aff and spell/en.dic. */
function spellAssets(): Plugin {
  const dir = dirname(require.resolve('dictionary-en'));
  const files: Record<string, string> = { 'en.aff': `${dir}/index.aff`, 'en.dic': `${dir}/index.dic` };
  return {
    name: 'spell-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.match(/\/spell\/([^/]+)$/)?.[1];
        const file = name ? files[name] : undefined;
        if (!file) return next();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(files)) this.emitFile({ type: 'asset', fileName: `spell/${name}`, source: readFileSync(file) });
    },
  };
}

/**
 * PNG icons for install prompts, home screens and iOS, drawn from the SVG's shapes (see
 * src/offline/icons.ts) and served at the top of the app in development and in the build.
 */
function appIcons(): Plugin {
  let icons: Promise<{ name: string; bytes: Uint8Array }[]> | null = null;
  const all = () => (icons ??= iconPngs());
  return {
    name: 'app-icons',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.split('/').pop();
        if (!name?.endsWith('.png')) return next();
        void all().then((list) => {
          const icon = list.find((i) => i.name === name);
          if (!icon) return next();
          res.setHeader('Content-Type', 'image/png');
          res.end(icon.bytes);
        });
      });
    },
    async generateBundle() {
      for (const icon of await all()) this.emitFile({ type: 'asset', fileName: icon.name, source: icon.bytes });
    },
  };
}

const base = process.env.GITHUB_PAGES === 'true' ? '/redcolumn/' : '/';

/** Screenshots in public/screenshots, shown by richer install prompts. */
const SCREENSHOTS = [
  { src: `${base}screenshots/wide.png`, sizes: '1280x800', type: 'image/png', form_factor: 'wide' as const, label: 'A drawing with markups and the Markups list' },
  { src: `${base}screenshots/narrow.png`, sizes: '390x844', type: 'image/png', form_factor: 'narrow' as const, label: 'redcolumn on a phone' },
];

export default defineConfig({
  // Project Pages live at /redcolumn/; local `pnpm dev` stays at /.
  base,
  plugins: [
    react(),
    ocrAssets(),
    spellAssets(),
    appIcons(),
    VitePWA({
      // New versions install in the background and wait; the app applies them when no work is in
      // progress (src/offline/updates.ts), so a reload never interrupts a gesture, a dialog or a job.
      registerType: 'prompt',
      manifest: buildManifest(base, SCREENSHOTS) as Partial<ManifestOptions>,
      workbox: {
        // Precache the whole app shell, including the PDFium wasm, the spelling dictionary and the
        // icons, so every menu and command works offline.
        globPatterns: ['**/*.{js,css,html,svg,wasm,png,aff,dic}'],
        // OCR's engine and data (about 11 MB) load when OCR is first used, not with the app; they
        // are cached then (below), or ahead of time from Preferences › Offline.
        globIgnores: ['ocr/**', 'screenshots/**'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // msal-redirect.html receives Microsoft sign-in results in its query string, which the
        // precache would not match; let it load from the network rather than fall back to the app.
        navigateFallbackDenylist: [/msal-redirect\.html/, /share-target/],
        runtimeCaching: [
          {
            // The cache name is shared with src/offline/ocrCache.ts, which fills it ahead of time.
            urlPattern: ({ url }) => /\/ocr\/[^/]+$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'nb-ocr', cacheableResponse: { statuses: [200] } },
          },
          {
            // PDF/A's embedded fonts (about 4 MB in all) load when an archive copy first needs them.
            urlPattern: ({ url }) => /\/fonts\/[^/]+\.ttf$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'nb-fonts', cacheableResponse: { statuses: [200] } },
          },
        ],
        // PDFs shared from other apps (the manifest's share_target) are posted to the service worker.
        importScripts: ['sw-share.js'],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        // The page Microsoft sign-in popups return to (see src/studio/drive/onedrive.ts).
        'msal-redirect': fileURLToPath(new URL('msal-redirect.html', import.meta.url)),
      },
    },
  },
});
