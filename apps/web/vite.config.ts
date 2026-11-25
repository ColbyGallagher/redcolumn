import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';
import { buildManifest } from './src/offline/manifest.ts';
import { appCsp, redirectCsp } from './src/security/csp.ts';
import { compileCatalog, parsePo } from '../../packages/i18n/src/po.ts';

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

/**
 * The 3D viewer's own files (issue #191): the fragments worker, which holds loaded models, and
 * web-ifc's wasm, which reads IFC files. Served from model3d/ rather than a CDN, in development and
 * in the build. web-ifc finds its wasm by file name in that folder, so the names stay fixed.
 */
function model3dAssets(): Plugin {
  const pkg = dirname(require.resolve('@nb/model3d/package.json'));
  const from = (id: string) => require.resolve(id, { paths: [pkg] });
  const files: Record<string, string> = {
    'fragments-worker.mjs': from('@thatopen/fragments/worker'),
    'web-ifc.wasm': from('web-ifc/web-ifc.wasm'),
  };
  return {
    name: 'model3d-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.match(/\/model3d\/([^/]+)$/)?.[1];
        const file = name ? files[name] : undefined;
        if (!file) return next();
        res.setHeader('Content-Type', name!.endsWith('.mjs') ? 'text/javascript' : 'application/wasm');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(files)) this.emitFile({ type: 'asset', fileName: `model3d/${name}`, source: readFileSync(file) });
    },
  };
}

/** The 3D viewer's code (three.js, That Open, web-ifc and @nb/model3d), which goes in model3d/ so the offline copy can leave it out. */
const MODEL3D_CODE = /\/(three|@thatopen|web-ifc|camera-controls|three-mesh-bvh|packages\/model3d)\//;
function chunkFileNames(chunk: { moduleIds?: readonly string[] }) {
  return chunk.moduleIds?.length && chunk.moduleIds.every((id) => MODEL3D_CODE.test(id)) ? 'model3d/[name]-[hash].js' : 'assets/[name]-[hash].js';
}

/** Spell checking's dictionaries (Hunspell files from npm), served at spell/en-US.aff, spell/fr-FR.dic and so on. */
function spellAssets(): Plugin {
  const files: Record<string, string> = {};
  for (const [code, pkg] of [['en-US', 'dictionary-en'], ['en-GB', 'dictionary-en-gb'], ['en-AU', 'dictionary-en-au'], ['de-DE', 'dictionary-de'], ['fr-FR', 'dictionary-fr']]) {
    const dir = dirname(require.resolve(pkg!));
    files[`${code}.aff`] = `${dir}/index.aff`;
    files[`${code}.dic`] = `${dir}/index.dic`;
  }
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
 * Translation catalogs (packages/i18n/catalogs/*.po) imported as modules: each compiles to its
 * translations only, and is loaded on demand when its language is chosen (src/i18n/start.ts).
 */
function poCatalogs(): Plugin {
  return {
    name: 'po-catalogs',
    transform(code, id) {
      if (!id.split('?')[0]!.endsWith('.po')) return null;
      return { code: `export default ${JSON.stringify(compileCatalog(parsePo(code)))};`, map: null };
    },
  };
}

/**
 * Writes the Content Security Policy and referrer policy into each built page as <meta> tags
 * (GitHub Pages cannot send headers; vercel.json sends the same policy as a header). Only the
 * build: the dev server needs inline scripts for hot reload. See src/security/csp.ts.
 */
function securityMeta(): Plugin {
  let options = { microsoft: false };
  return {
    name: 'security-meta',
    apply: 'build',
    configResolved(config) {
      options = { microsoft: !!config.env.VITE_MICROSOFT_CLIENT_ID };
    },
    transformIndexHtml(html, ctx) {
      const csp = /msal-redirect\.html$/.test(ctx.filename) ? redirectCsp() : appCsp(options);
      const tags = `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="no-referrer" />\n    `;
      return html.replace(/(<meta charset="[^"]*" \/>\s*)/i, `$1${tags}`);
    },
  };
}

/**
 * The landing page (public/home) and the help (public/help) are their own static sites. Vercel serves
 * /home to the landing page (vercel.json) and /help/ to the help's index; the dev server would
 * otherwise answer /home, /home/ and /help/ with the app, so send them to their pages.
 */
function landingPage(): Plugin {
  return {
    name: 'landing-page',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query = ''] = (req.url ?? '').split('?');
        const page = path === '/home' || path === '/home/' ? '/home/index.html' : path === '/help' || path === '/help/' ? '/help/index.html' : null;
        if (page) req.url = `${page}${query ? `?${query}` : ''}`;
        next();
      });
    },
  };
}

const base = process.env.GITHUB_PAGES === 'true' ? '/redcolumn/' : '/';

/** Screenshots in public/screenshots, shown by richer install prompts. */
const SCREENSHOTS = [
  { src: `${base}screenshots/wide.png`, sizes: '1280x800', type: 'image/png', form_factor: 'wide' as const, label: 'A drawing with markups and the Markups list' },
  { src: `${base}screenshots/narrow.png`, sizes: '390x844', type: 'image/png', form_factor: 'narrow' as const, label: 'redcolumn on a phone' },
];

/** Shown in About; the desktop package's version is the one releases bump. */
const appVersion: string = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  // Project Pages live at /redcolumn/; local `pnpm dev` stays at /.
  base,
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    ocrAssets(),
    spellAssets(),
    model3dAssets(),
    poCatalogs(),
    landingPage(),
    securityMeta(),
    VitePWA({
      // New versions install in the background and wait; the app applies them when no work is in
      // progress (src/offline/updates.ts), so a reload never interrupts a gesture, a dialog or a job.
      registerType: 'prompt',
      manifest: buildManifest(base, SCREENSHOTS) as Partial<ManifestOptions>,
      workbox: {
        // Precache the whole app shell, including the PDFium wasm, the spelling dictionaries, the
        // icons and the help pages, so every menu, command and help page works offline.
        globPatterns: ['**/*.{js,css,html,svg,wasm,png,aff,dic}', 'help/pages/*.md'],
        // OCR's engine and data (about 11 MB) load when OCR is first used, not with the app; they
        // are cached then (below), or ahead of time from Preferences › Offline. The help's
        // screenshots and tool animations are cached as they are first viewed.
        // The 3D viewer (several MB) loads when a model is first opened and is cached then (below).
        globIgnores: ['ocr/**', 'model3d/**', 'screenshots/**', 'help/img/**', 'help/gif/**'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // msal-redirect.html receives Microsoft sign-in results in its query string, which the
        // precache would not match; let it load from the network rather than fall back to the app.
        // The help and the landing page (/home) are their own sites, not the app.
        navigateFallbackDenylist: [/msal-redirect\.html/, /share-target/, /\/help\//, /\/home(\/|$)/],
        runtimeCaching: [
          {
            // The cache name is shared with src/offline/ocrCache.ts, which fills it ahead of time.
            urlPattern: ({ url }) => /\/ocr\/[^/]+$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'nb-ocr', cacheableResponse: { statuses: [200] } },
          },
          {
            // The 3D viewer's code, worker and wasm, once a model has been opened.
            urlPattern: ({ url }) => /\/model3d\/[^/]+$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'nb-model3d', cacheableResponse: { statuses: [200] } },
          },
          {
            // Help screenshots and the tool animations the hover previews show: from the cache,
            // refreshed in the background when online.
            urlPattern: ({ url }) => /\/help\/(img|gif)\/[^/]+$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'nb-help', cacheableResponse: { statuses: [200] } },
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
  worker: { format: 'es', rollupOptions: { output: { chunkFileNames, entryFileNames: (c) => (MODEL3D_CODE.test(c.facadeModuleId ?? '') ? 'model3d/[name]-[hash].js' : 'assets/[name]-[hash].js') } } },
  // SQLite (the search index, src/search/index) finds its .wasm next to its own module, which
  // pre-bundling in development would move.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        // The page Microsoft sign-in popups return to (see src/studio/drive/onedrive.ts).
        'msal-redirect': fileURLToPath(new URL('msal-redirect.html', import.meta.url)),
      },
      output: { chunkFileNames },
    },
  },
});
