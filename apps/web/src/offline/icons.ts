/**
 * The app's icons: PNG files in public/ that the manifest and index.html refer to. Install prompts,
 * Android home screens and iOS need raster icons (192 and 512 pixels, maskable versions, a 180 pixel
 * Apple touch icon). The 'any' icons are the logo on a transparent background; the maskable and Apple
 * ones sit on a navy square because the system masks or fills those itself. Plain module: runs in
 * Node (vite.config.ts, tests) and in the browser.
 */

/** The PNG icons the manifest and index.html refer to, by file name. */
export const ICON_FILES: { name: string; size: number; maskable: boolean }[] = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-192.png', size: 192, maskable: true },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: true },
];
