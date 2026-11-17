import { pdfArguments } from './pdf-args';

/**
 * macOS sends open-file (Finder Open With, Dock drop, double-click) at any time: before the app is
 * ready, while it runs, and when every window is closed. Before start() the paths wait here; after it
 * each one goes straight to the deliver callback, which finds or creates a window.
 */
export class OpenFileRouter {
  private early: string[] = [];
  private deliver: ((filePath: string) => void) | null = null;

  /** accepts: only PDF/DWG/DXF paths that exist (the same rule as the command line). */
  private accepts: (filePath: string) => boolean;

  constructor(accepts: (filePath: string) => boolean = (p) => pdfArguments([p]).length > 0) {
    this.accepts = accepts;
  }

  handle(filePath: string) {
    if (!this.accepts(filePath)) return;
    if (this.deliver) this.deliver(filePath);
    else this.early.push(filePath);
  }

  /** Delivers what arrived early, then everything that arrives later. */
  start(deliver: (filePath: string) => void) {
    this.deliver = deliver;
    for (const filePath of this.early.splice(0)) deliver(filePath);
  }
}
