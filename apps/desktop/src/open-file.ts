import { pdfArguments } from './pdf-args';

/**
 * macOS sends open-file (Finder Open With, Dock drop, double-click) at any time: before the app is
 * ready, while it runs, and when every window is closed. Before start() the paths wait here; after it
 * each one goes straight to the deliver callback, which finds or creates a window.
 */
export class OpenFileRouter {
  private early: string[] = [];
  private deliver: ((filePath: string) => void) | null = null;
  private accepts: (filePath: string) => boolean;

  /** accepts: only PDF/DWG/DXF paths that exist (the same rule as the command line). */
  constructor(accepts: (filePath: string) => boolean = (p) => pdfArguments([p]).length > 0) {
    this.accepts = accepts;
  }

  handle(filePath: string) {
    if (!this.accepts(filePath)) {
      console.warn(`open-file ignored (not a PDF/DWG/DXF, or not found): ${filePath}`);
      return;
    }
    if (this.deliver) this.deliver(filePath);
    else this.early.push(filePath);
  }

  /** Delivers what arrived early, then everything that arrives later. One failure does not lose the rest. */
  start(deliver: (filePath: string) => void) {
    this.deliver = deliver;
    for (const filePath of this.early.splice(0)) {
      try {
        deliver(filePath);
      } catch (error) {
        console.warn(`open-file failed for ${filePath}`, error);
      }
    }
  }
}

/**
 * Sends a file to the front window, creating one first when none is open (macOS keeps the app
 * running with every window closed). Nothing is created while the app is quitting.
 */
export function openIntoWindow<Q extends { note(filePath: string): void }>(
  find: () => Q | undefined,
  create: () => void,
  quitting: () => boolean,
  filePath: string,
) {
  let queue = find();
  if (!queue) {
    if (quitting()) return;
    create();
    queue = find();
  }
  queue?.note(filePath);
}
