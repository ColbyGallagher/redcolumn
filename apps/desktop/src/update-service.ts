import { isNewer } from './version';

/**
 * Where the app stands on updates. `available` means a newer version exists that the app cannot
 * install by itself (the person opens `url`); `downloading` and `ready` are the in-app path.
 */
export interface UpdateState {
  status: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'unavailable';
  current: string;
  latest?: string;
  /** The release page, for `available`. */
  url?: string;
  /** Whole percent, for `downloading`. */
  percent?: number;
}

/** The part of electron-updater's AppUpdater this service uses, so a test can stand in for it. */
export interface NativeUpdater {
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
}

export interface UpdateServiceOptions {
  current: string;
  /** Downloads and installs by itself (Windows installer builds). Null: only tell the person. */
  native: NativeUpdater | null;
  /** The newest published release (tag and page), or null when it cannot be read. */
  fetchLatest: () => Promise<{ tag: string; url: string } | null>;
  /** Documents have unsaved changes, so the app must not restart on its own. */
  hasUnsavedChanges: () => boolean;
  /** A download with no progress for this long counts as stalled, so a check can start over. Default 10 minutes. */
  stallMs?: number;
  now?: () => number;
}

export type InstallResult = { ok: true } | { ok: false; reason: string };

/**
 * Checks for a newer release and, where the platform allows, downloads it in the background and
 * installs it when the app next quits or when the person restarts into it.
 */
export class UpdateService {
  state: UpdateState;
  /** Called whenever `state` changes. */
  onChange: (state: UpdateState) => void = () => undefined;
  private pending: Promise<UpdateState> | null = null;
  private readonly opts: UpdateServiceOptions;
  /** When the download last made progress. */
  private progressAt = 0;

  constructor(opts: UpdateServiceOptions) {
    this.opts = opts;
    this.state = { status: 'idle', current: opts.current };
    const native = opts.native;
    if (!native) return;
    native.on('update-available', (info) => {
      this.progressAt = this.now();
      this.set({ status: 'downloading', latest: info.version, percent: 0 });
    });
    native.on('update-not-available', () => this.set({ status: 'latest' }));
    native.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Math.floor(progress.percent)));
      this.progressAt = this.now();
      if (this.state.status === 'downloading' && this.state.percent !== percent) this.set({ status: 'downloading', latest: this.state.latest, percent });
    });
    native.on('update-downloaded', (info) => this.set({ status: 'ready', latest: info.version }));
    native.on('error', () => {
      // A failed download is retried at the next launch; the person is not told twice.
      if (this.state.status !== 'ready') this.set({ status: 'unavailable' });
    });
  }

  /** Looks for a newer version. A download or a finished download is not disturbed, unless the download stalled. */
  check(): Promise<UpdateState> {
    const stalled = this.state.status === 'downloading' && this.now() - this.progressAt > (this.opts.stallMs ?? 10 * 60_000);
    if ((this.state.status === 'downloading' && !stalled) || this.state.status === 'ready') return Promise.resolve(this.state);
    this.pending ??= this.run().finally(() => (this.pending = null));
    return this.pending;
  }

  /** Restarts into a downloaded update, unless that would lose unsaved work. */
  install(): InstallResult {
    const native = this.opts.native;
    if (!native || this.state.status !== 'ready') return { ok: false, reason: 'There is no update ready to install.' };
    if (this.opts.hasUnsavedChanges()) return { ok: false, reason: 'Save or close the documents with unsaved changes first.' };
    native.quitAndInstall(true, true);
    return { ok: true };
  }

  private async run(): Promise<UpdateState> {
    this.set({ status: 'checking' });
    try {
      if (this.opts.native) await this.opts.native.checkForUpdates();
      else await this.checkRelease();
    } catch {
      this.set({ status: 'unavailable' });
    }
    // The native updater reports through its events; one that said nothing leaves the check unanswered.
    if (this.state.status === 'checking') this.set({ status: 'unavailable' });
    return this.state;
  }

  private async checkRelease() {
    const release = await this.opts.fetchLatest();
    if (!release) this.set({ status: 'unavailable' });
    else if (isNewer(release.tag, this.opts.current)) this.set({ status: 'available', latest: release.tag.replace(/^v/, ''), url: release.url });
    else this.set({ status: 'latest' });
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private set(next: Omit<UpdateState, 'current'>) {
    this.state = { ...next, current: this.opts.current };
    this.onChange(this.state);
  }
}
