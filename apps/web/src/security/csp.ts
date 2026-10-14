/**
 * The Content Security Policy for the app's pages, from one source. The build writes each page's
 * policy into it as a <meta> (GitHub Pages cannot send headers), so every host gets the same one.
 * Hosts that can send headers (vercel.json, checked by csp.test.ts) add what a <meta> cannot:
 * `frame-ancestors` and the other headers below. See docs/SECURITY-HARDENING.md, 2.1 and 2.4.
 */

export interface CspOptions {
  /** Microsoft sign-in and OneDrive are configured (VITE_MICROSOFT_CLIENT_ID). */
  microsoft: boolean;
}

const MICROSOFT_CONNECT = [
  'https://graph.microsoft.com',
  'https://login.microsoftonline.com',
  // OneDrive download and upload-session URLs that Graph hands back (personal and work accounts).
  'https://*.sharepoint.com',
  'https://*.1drv.com',
  'https://*.livefilestore.com',
  'https://my.microsoftpersonalcontent.com',
];

/** Directives in order, as `name value…`, joined with `; `. */
function join(directives: [string, string[]][]): string {
  return directives.map(([name, values]) => [name, ...values].join(' ')).join('; ');
}

/** The policy for the app itself (index.html). */
export function appCsp({ microsoft }: CspOptions): string {
  return join([
    ['default-src', ["'self'"]],
    // PDFium and Tesseract compile WebAssembly; nothing uses eval or new Function.
    ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
    // Tesseract starts its worker from a blob: URL it makes itself.
    ['worker-src', ["'self'", 'blob:']],
    ['connect-src', ["'self'", ...(microsoft ? MICROSOFT_CONNECT : [])]],
    ['frame-src', ["'none'"]],
    ['img-src', ["'self'", 'blob:', 'data:']],
    ['style-src', ["'self'"]],
    ['font-src', ["'self'", 'data:']],
    ['media-src', ["'self'", 'blob:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    // Dialogs are forms whose submit is handled in script; nothing posts to another site.
    ['form-action', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['upgrade-insecure-requests', []],
  ]);
}

/** The page Microsoft sign-in popups return to: it only hands the result back to the app. */
export function redirectCsp(): string {
  return join([
    ['default-src', ["'none'"]],
    ['script-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
    ['object-src', ["'none'"]],
  ]);
}

/**
 * The help (public/help/index.html, written into that file by hand and checked by csp.test.ts).
 * Its pages are built with innerHTML through the `help` Trusted Types policy only.
 */
export function helpCsp(): string {
  return join([
    ['default-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
    ['img-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
    ['require-trusted-types-for', ["'script'"]],
    ['trusted-types', ['help']],
  ]);
}

/**
 * Headers for hosts that can send them (vercel.json). A <meta> policy cannot say
 * `frame-ancestors`, so the header carries only that; the rest of the policy is in each page.
 */
export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()' },
  ];
}
