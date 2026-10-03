/** Recent console messages and errors, kept so Help › Send Log Files can save them for support. */
const MAX = 500;
const lines: string[] = [];

function push(level: string, args: unknown[]) {
  const text = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : (() => {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })()))
    .join(' ');
  lines.push(`${new Date().toISOString()} [${level}] ${text}`);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

let installed = false;

/** Starts keeping warnings, errors and uncaught failures (once). */
export function installLogCapture() {
  if (installed) return;
  installed = true;
  for (const level of ['warn', 'error', 'info'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      original(...args);
    };
  }
  window.addEventListener('error', (e) => push('uncaught', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', (e) => push('unhandled', [e.reason]));
}

/** The log as a text file: the app and browser, then the recent messages. */
export function logFile(): Blob {
  const header = [
    `redcolumn log, saved ${new Date().toISOString()}`,
    `Page: ${location.href.split('?')[0]}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${screen.width}×${screen.height} @${devicePixelRatio}x`,
    '',
  ];
  return new Blob([[...header, ...(lines.length ? lines : ['(no warnings or errors recorded)'])].join('\n')], { type: 'text/plain' });
}
