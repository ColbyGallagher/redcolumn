import { useEffect, useSyncExternalStore } from 'react';
import type { MarkupStore, Point, Portal } from '@nb/markup';
import type { MarkupTools } from '../markup/MarkupTools';
import { PortalDialog } from './PortalDialog';

// Portals (Experimental): the app side. The sync itself is in @nb/markup (portals.ts, MarkupStore).

const NO_PORTALS: Portal[] = [];
const noop = () => () => {};

export function usePortals(store: MarkupStore | null): Portal[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noop, () => store?.portals() ?? NO_PORTALS);
}

/** Outlines each pane's portals on their linked pages, and tells each store its page count (linked pages past the end are ignored). */
export function usePortalGuides(panes: readonly (readonly [{ tools: MarkupTools } | null | undefined, MarkupStore | null | undefined, number | undefined])[]) {
  const storeA = panes[0]?.[1] ?? null;
  const storeB = panes[1]?.[1] ?? null;
  const countA = panes[0]?.[2];
  const countB = panes[1]?.[2];
  useEffect(() => {
    if (storeA && countA) storeA.setPageCount(countA);
    if (storeB && countB) storeB.setPageCount(countB);
  }, [storeA, storeB, countA, countB]);
  const a = usePortals(storeA);
  const b = usePortals(storeB);
  const toolsA = panes[0]?.[0]?.tools;
  const toolsB = panes[1]?.[0]?.tools;
  useEffect(() => {
    toolsA?.setPortalGuides(a);
    toolsB?.setPortalGuides(b);
  }, [toolsA, toolsB, a, b]);
}

/** What the Portals dialog is showing: a portal just outlined, or the document's portals. */
export interface PortalDialogState {
  pane: 'a' | 'b';
  draft?: { pageIndex: number; points: Point[] };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What saving a portal's linked pages did, in a sentence. */
export function relinkNotice(name: string, r: { copied: number; adopted: number; unlinked: number }): string {
  const parts = [
    r.copied ? `${plural(r.copied, 'markup', 'markups')} copied to the newly linked pages` : '',
    r.adopted ? `${plural(r.adopted, 'matching markup', 'matching markups')} already there linked instead of copied` : '',
    r.unlinked ? `${plural(r.unlinked, 'copy', 'copies')} on unlinked pages kept as ordinary markups` : '',
  ].filter(Boolean);
  return parts.length ? `Portal "${name}" saved: ${parts.join('; ')}.` : `Portal "${name}" saved.`;
}

/** Whether a selection holds a mirrored markup (Break Portal Link). */
export const anyLinked = (markups: readonly { portalLink?: unknown }[]) => markups.some((m) => !!m.portalLink);

interface HostProps {
  state: PortalDialogState;
  store: MarkupStore;
  pageCount: number;
  pageLabel: (pageIndex: number) => string;
  onClose: () => void;
  onNotice: (text: string) => void;
}

export function PortalDialogHost({ state, store, pageCount, pageLabel, onClose, onNotice }: HostProps) {
  const portals = usePortals(store);
  const scaleKey = (i: number) => {
    if (!store.hasScale(i)) return 'none';
    const s = store.scaleFor(i);
    return `${s.metersPerPoint}|${s.yMetersPerPoint ?? ''}`;
  };
  const scaleText = (i: number) => (store.hasScale(i) ? (store.scaleFor(i).label ?? 'its scale') : 'no scale');
  return (
    <PortalDialog
      pageCount={pageCount}
      pageLabel={pageLabel}
      scaleKey={scaleKey}
      scaleText={scaleText}
      portals={portals}
      draft={state.draft ?? null}
      onSave={(p) => {
        const r = store.setPortal(p);
        onNotice(state.draft ? `Portal "${p.name}" links ${p.pages.length} pages. Markups drawn inside it are mirrored to each of them.` : relinkNotice(p.name, r));
        onClose();
      }}
      onRemove={(id) => {
        store.removePortal(id);
        onNotice('Portal removed. Its mirrored markups stay, as ordinary markups on each page.');
        onClose();
      }}
      onClose={onClose}
    />
  );
}
