import { useSyncExternalStore } from 'react';
import type { Markup } from '@nb/markup';

/** A signature or initials saved on this device, placed on documents from the Signatures panel. */
export interface SavedSignature {
  id: string;
  name: string;
  kind: 'signature' | 'initials';
  /** Transparent PNG data URL, trimmed to the ink. */
  image: string;
  /** Width / height of the image. */
  aspect: number;
  createdAt: number;
}

const KEY = 'nb.signatures';

function load(): SavedSignature[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedSignature[];
    return Array.isArray(list) ? list.filter((s) => typeof s.image === 'string') : [];
  } catch {
    return [];
  }
}

let list = load();
const listeners = new Set<() => void>();

function commit(next: SavedSignature[]) {
  list = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable: the signature lasts for this visit.
  }
  listeners.forEach((l) => l());
}

export const signatures = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => list,
  add: (s: Omit<SavedSignature, 'id' | 'createdAt'>) => commit([...list, { ...s, id: crypto.randomUUID(), createdAt: Date.now() }]),
  rename: (id: string, name: string) => commit(list.map((s) => (s.id === id ? { ...s, name } : s))),
  remove: (id: string) => commit(list.filter((s) => s.id !== id)),
};

export function useSignatures(): SavedSignature[] {
  return useSyncExternalStore(signatures.subscribe, signatures.get);
}

/**
 * Fingerprint of a document's content for signing: the file itself plus every markup other than
 * signatures. A signature stores the fingerprint from when it was placed; if the current one
 * differs, the document was changed after signing. (Signatures are left out so that a second
 * person can countersign without invalidating the first.)
 */
export async function documentDigest(fileHash: string, markups: readonly Markup[]): Promise<string> {
  const content = markups
    .filter((m) => m.type !== 'signature')
    .map((m) => ({ id: m.id, type: m.type, page: m.pageIndex, points: m.points, text: m.text ?? '', comment: m.comment ?? '', status: m.status, subject: m.subject ?? '', fields: m.fields ?? {}, style: m.style }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bytes = new TextEncoder().encode(JSON.stringify({ file: fileHash, markups: content }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Crops a canvas to its non-transparent pixels (plus a little padding) and returns a PNG. */
export function trimCanvas(src: HTMLCanvasElement, pad = 6): { image: string; aspect: number } | null {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { image: out.toDataURL('image/png'), aspect: out.width / out.height };
}
