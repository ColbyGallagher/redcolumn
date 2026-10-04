import { useSyncExternalStore } from 'react';
import { GoogleDrive, googleConfigured, googleSignInConfigured, googleUser, signInWithGoogle } from '../studio/drive/google';
import { OneDrive, microsoftUser, oneDriveConfigured, signInWithMicrosoft } from '../studio/drive/onedrive';
import type { DriveApi } from '../studio/drive/DriveApi';
import { profiles } from './profiles';

/**
 * Profiles live in this browser's storage, which a person can clear and a browser can evict. This
 * keeps a copy in the signed-in Google Drive or OneDrive (Apps/redcolumn/profiles.json) that can be
 * restored on this or another computer.
 *
 * Once a device has backed up or restored, later changes are copied up on their own. Before that,
 * nothing is written, so a new computer's empty default profile never replaces a real backup.
 */

export type Backend = 'drive' | 'onedrive';

const FILE = 'profiles.json';
const KEY = 'nb.profiles.cloud';
const DELAY_MS = 20_000;

interface Link {
  backend: Backend;
  /** When this device last copied up or restored (ISO). */
  at: string;
}

let link: Link | null = readLink();
let failed: string | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

function readLink(): Link | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Link | null;
    return v && (v.backend === 'drive' || v.backend === 'onedrive') ? v : null;
  } catch {
    return null;
  }
}

function setLink(next: Link | null) {
  link = next;
  failed = null;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for this visit only.
  }
  changed();
}

const apis: { drive?: DriveApi; onedrive?: DriveApi } = {};
const api = (b: Backend): DriveApi => (apis[b] ??= b === 'drive' ? new GoogleDrive() : new OneDrive());

export const backendLabel = (b: Backend) => (b === 'drive' ? 'Google Drive' : 'OneDrive');

/** The cloud drives this build can use. */
export function availableBackends(): Backend[] {
  const out: Backend[] = [];
  if (googleConfigured && googleSignInConfigured) out.push('drive');
  if (oneDriveConfigured) out.push('onedrive');
  return out;
}

const signedIn = (b: Backend) => (b === 'drive' ? !!googleUser() : !!microsoftUser());

async function ensureSignedIn(b: Backend) {
  if (signedIn(b)) return;
  if (b === 'drive') await signInWithGoogle();
  else await signInWithMicrosoft();
}

/** Copies every profile up to the drive and remembers to keep doing so. */
export async function backUpProfiles(b: Backend): Promise<void> {
  await ensureSignedIn(b);
  await api(b).writeAppFile!(FILE, profiles.exportAll());
  setLink({ backend: b, at: new Date().toISOString() });
}

/** Whether the drive holds a backup (for confirming a restore). */
export async function hasBackup(b: Backend): Promise<boolean> {
  await ensureSignedIn(b);
  return (await api(b).readAppFile!(FILE)) !== null;
}

/** Brings the drive's profiles into this browser; returns how many, or 0 when there is no backup. */
export async function restoreProfiles(b: Backend): Promise<number> {
  await ensureSignedIn(b);
  const text = await api(b).readAppFile!(FILE);
  if (text === null) return 0;
  const n = profiles.importAll(text);
  setLink({ backend: b, at: new Date().toISOString() });
  return n;
}

export const stopBackingUp = () => setLink(null);

let timer: ReturnType<typeof setTimeout> | undefined;

/** Copies changes up shortly after they stop, once this device is linked and still signed in. Call once at start-up. */
export function startProfileBackup(): void {
  profiles.subscribe(() => {
    if (!link) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const cur = link;
      if (!cur || !signedIn(cur.backend) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      try {
        await api(cur.backend).writeAppFile!(FILE, profiles.exportAll());
        setLink({ backend: cur.backend, at: new Date().toISOString() });
      } catch (err) {
        failed = err instanceof Error ? err.message : String(err);
        changed();
      }
    }, DELAY_MS);
  });
}

export interface BackupState {
  link: Link | null;
  /** Why the last automatic copy did not happen. */
  failed: string | null;
}

let snapshot: BackupState = { link, failed };
function getSnapshot(): BackupState {
  if (snapshot.link !== link || snapshot.failed !== failed) snapshot = { link, failed };
  return snapshot;
}

export function useProfileBackup(): BackupState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot,
  );
}
