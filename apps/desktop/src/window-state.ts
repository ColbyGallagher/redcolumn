import { randomBytes } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from './atomic';

export const DEFAULT_WINDOW_WIDTH = 1440;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseWindowState(raw: unknown): SavedWindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!isFiniteNumber(obj.width) || obj.width <= 0 || !isFiniteNumber(obj.height) || obj.height <= 0) return null;
  const state: SavedWindowState = {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(obj.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(obj.height)),
    maximized: obj.maximized === true,
  };
  if (isFiniteNumber(obj.x) && isFiniteNumber(obj.y)) {
    state.x = Math.round(obj.x);
    state.y = Math.round(obj.y);
  }
  return state;
}

/** True when enough of the window's title-bar strip sits inside at least one display's work area to grab and move it. */
export function isReachableOnDisplays(bounds: Rect, displays: readonly Rect[]): boolean {
  const titleHeight = Math.min(40, bounds.height);
  const minHoriz = Math.min(100, bounds.width);
  const minVert = Math.min(20, bounds.height);
  for (const d of displays) {
    const horiz = Math.min(bounds.x + bounds.width, d.x + d.width) - Math.max(bounds.x, d.x);
    const vert = Math.min(bounds.y + titleHeight, d.y + d.height) - Math.max(bounds.y, d.y);
    if (horiz >= minHoriz && vert >= minVert) return true;
  }
  return false;
}

function fitToWorkArea(width: number, height: number, workArea?: Rect): { width: number; height: number } {
  if (!workArea || workArea.width <= 0 || workArea.height <= 0) return { width, height };
  return {
    width: Math.max(Math.min(MIN_WINDOW_WIDTH, workArea.width), Math.min(width, workArea.width)),
    height: Math.max(Math.min(MIN_WINDOW_HEIGHT, workArea.height), Math.min(height, workArea.height)),
  };
}

/**
 * Turns the last saved window state into bounds safe for the displays currently attached.
 * If the old monitor is gone, the remembered size is kept (clamped to the primary display)
 * and the position is dropped so the OS centers the window on screen.
 */
export function resolveWindowBounds(saved: SavedWindowState | null, displays: readonly Rect[], primaryWorkArea?: Rect): SavedWindowState {
  if (!saved) {
    const fitted = fitToWorkArea(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT, primaryWorkArea);
    return { width: fitted.width, height: fitted.height, maximized: false };
  }
  const width = Math.max(MIN_WINDOW_WIDTH, Math.round(saved.width));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.round(saved.height));
  const maximized = saved.maximized === true;
  if (saved.x !== undefined && saved.y !== undefined && displays.length > 0) {
    const x = Math.round(saved.x);
    const y = Math.round(saved.y);
    if (isReachableOnDisplays({ x, y, width, height }, displays)) {
      return { x, y, width, height, maximized };
    }
  }
  const fitted = fitToWorkArea(width, height, primaryWorkArea);
  return { width: fitted.width, height: fitted.height, maximized };
}

export async function loadWindowState(filePath: string): Promise<SavedWindowState | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return parseWindowState(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function saveWindowState(filePath: string, state: SavedWindowState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(filePath, JSON.stringify(state));
}

/** Synchronous atomic write for the window `close` handler so quitting never drops the final bounds. */
export function saveWindowStateSync(filePath: string, state: SavedWindowState): void {
  const dir = path.dirname(filePath);
  fsSync.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    fsSync.writeFileSync(temp, JSON.stringify(state));
    fsSync.renameSync(temp, filePath);
  } catch (err) {
    try {
      fsSync.unlinkSync(temp);
    } catch {
      // Ignore cleanup errors.
    }
    throw err;
  }
}

/** Remembers the app window's size, position and maximized state across sessions. */
export class WindowStateStore {
  private readonly filePath: string;
  private readonly debounceMs: number;
  private current: SavedWindowState | null = null;
  private lastSavedJson: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string, debounceMs = 300) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
  }

  async load(): Promise<SavedWindowState | null> {
    this.current = await loadWindowState(this.filePath);
    this.lastSavedJson = this.current ? JSON.stringify(this.current) : null;
    return this.current;
  }

  resolve(displays: readonly Rect[], primaryWorkArea?: Rect): SavedWindowState {
    return resolveWindowBounds(this.current, displays, primaryWorkArea);
  }

  update(state: SavedWindowState): void {
    this.current = state;
    const json = JSON.stringify(state);
    if (json === this.lastSavedJson) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const snapshot = this.current;
      if (!snapshot) return;
      const snapshotJson = JSON.stringify(snapshot);
      void saveWindowState(this.filePath, snapshot)
        .then(() => {
          this.lastSavedJson = snapshotJson;
        })
        .catch(() => undefined);
    }, this.debounceMs);
  }

  flushSync(state?: SavedWindowState): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (state) this.current = state;
    if (!this.current) return;
    const json = JSON.stringify(this.current);
    if (json === this.lastSavedJson) return;
    try {
      saveWindowStateSync(this.filePath, this.current);
      this.lastSavedJson = json;
    } catch {
      // Never block closing the window if the disk is read-only or full.
    }
  }
}
