import { useSyncExternalStore } from 'react';
import type { CadConversion } from './client';

/** A conversion as kept: everything but the PDF (the document has that). */
export type KeptConversion = Omit<CadConversion, 'pdf'>;

/**
 * Drawings converted in this visit, by the id of the PDF they became: the report shown over the
 * document, and the original kept for converting again. Not stored: after a reload the PDF is an
 * ordinary PDF.
 */

interface Entry {
  conversion: KeptConversion;
  /** The report bar was closed. */
  dismissed: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

export const cadSession = {
  set(fileId: string, { pdf: _pdf, ...conversion }: CadConversion) {
    entries.set(fileId, { conversion, dismissed: false });
    changed();
  },
  get(fileId: string | undefined): Entry | undefined {
    return fileId ? entries.get(fileId) : undefined;
  },
  dismiss(fileId: string) {
    const e = entries.get(fileId);
    if (e && !e.dismissed) {
      e.dismissed = true;
      changed();
    }
  },
  forget(fileId: string) {
    if (entries.delete(fileId)) changed();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useCadConversion(fileId: string | undefined): Entry | undefined {
  useSyncExternalStore(cadSession.subscribe, () => version);
  return cadSession.get(fileId);
}
