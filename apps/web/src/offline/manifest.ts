import { ICON_FILES } from './icons.ts';

/**
 * The web app manifest: what installing redcolumn gives the operating system. Built here rather
 * than inline in vite.config.ts so it can be tested. `base` is the path the app is served from
 * ('/' locally, '/redcolumn/' on GitHub Pages).
 */

/** Where a shared PDF is posted (the service worker answers it; see src/offline/sw-share.js). */
export const SHARE_TARGET_PATH = 'share-target';
/** The start page's query for the launcher's shortcuts and for files shared in. */
export type LaunchAction = 'open' | 'new' | 'shared';

export interface ManifestScreenshot {
  src: string;
  sizes: string;
  type: string;
  form_factor: 'wide' | 'narrow';
  label: string;
}

export function buildManifest(base: string, screenshots: ManifestScreenshot[] = []) {
  const at = (path: string) => `${base}${path}`;
  const pngs = ICON_FILES.filter((f) => f.name.startsWith('icon-'));
  return {
    // A fixed id, so a later change of start_url does not make browsers treat it as another app.
    id: base,
    name: 'redcolumn',
    short_name: 'redcolumn',
    description: 'AI-native PDF markup and takeoff for construction drawings',
    lang: 'en',
    start_url: base,
    scope: base,
    display: 'standalone',
    // Desktop: drop the title bar strip and draw the menu bar there (see the overlay rules in styles.css).
    display_override: ['window-controls-overlay', 'standalone'],
    theme_color: '#2a2d31',
    background_color: '#1f2124',
    categories: ['productivity', 'business', 'utilities'],
    icons: [
      { src: at('icon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ...pngs.map((f) => ({ src: at(f.name), sizes: `${f.size}x${f.size}`, type: 'image/png', purpose: f.options.fullBleed ? 'maskable' : 'any' })),
    ],
    shortcuts: [
      { name: 'Open', short_name: 'Open', description: 'Open a PDF from this device', url: `${base}?action=open`, icons: [{ src: at('icon-192.png'), sizes: '192x192', type: 'image/png' }] },
      { name: 'New PDF', short_name: 'New', description: 'Start a new blank PDF', url: `${base}?action=new`, icons: [{ src: at('icon-192.png'), sizes: '192x192', type: 'image/png' }] },
    ],
    screenshots,
    // Installed on a desktop, redcolumn is offered for PDFs in the file manager (read with launchQueue).
    file_handlers: [{ action: base, accept: { 'application/pdf': ['.pdf'] } }],
    // A new launch (a file, a shortcut) goes to the window already open rather than a second one.
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
    // On phones, PDFs can be shared to redcolumn from other apps.
    share_target: {
      action: at(SHARE_TARGET_PATH),
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['application/pdf', '.pdf'] }] },
    },
  };
}

export type WebManifest = ReturnType<typeof buildManifest>;
