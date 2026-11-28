import { msg } from '@nb/i18n';
import { useEffect, useSyncExternalStore } from 'react';
import type { MarkupDocument, PortalFacet, Point, Portal } from '@nb/markup';
import type { MarkupTools } from '../markup/MarkupTools';
import { PortalDialog } from './PortalDialog';

// Portals (Experimental): the app side. The sync itself is in @nb/markup (portals.ts, MarkupStore).

const NO_PORTALS: Portal[] = [];
const noop = () => () => {};

export function usePortals(store: (MarkupDocument & PortalFacet) | null): Portal[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noop, () => store?.portals() ?? NO_PORTALS);
}

/** Outlines each pane's portals on their linked pages, and tells each store its page count (linked pages past the end are ignored). */
export function usePortalGuides(panes: readonly (readonly [{ tools: MarkupTools } | null | undefined, (MarkupDocument & PortalFacet) | null | undefined, number | undefined])[]) {
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


/** What saving a portal's linked pages did, in a sentence. */
export function relinkNotice(name: string, r: { copied: number; adopted: number; unlinked: number }): string {
  const parts = [
    r.copied ? msg('{count, plural, one {# markup} other {# markups}} copied to the newly linked pages', { count: r.copied }) : '',
    r.adopted ? msg('{count, plural, one {# matching markup} other {# matching markups}} already there linked instead of copied', { count: r.adopted }) : '',
    r.unlinked ? msg('{count, plural, one {# copy} other {# copies}} on unlinked pages kept as ordinary markups', { count: r.unlinked }) : '',
  ].filter(Boolean);
  return parts.length ? msg('Portal "{name}" saved: {changes}.', { name, changes: parts.join('; ') }) : msg('Portal "{name}" saved.', { name });
}

/** Whether a selection holds a mirrored markup (Break Portal Link). */
export const anyLinked = (markups: readonly { portalLink?: unknown }[]) => markups.some((m) => !!m.portalLink);

interface HostProps {
  state: PortalDialogState;
  store: MarkupDocument & PortalFacet;
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
        onNotice(state.draft ? msg('Portal "{name}" links {count} pages. Markups drawn inside it are mirrored to each of them.', { name: p.name, count: p.pages.length }) : relinkNotice(p.name, r));
        onClose();
      }}
      onRemove={(id) => {
        store.removePortal(id);
        onNotice(msg('Portal removed. Its mirrored markups stay, as ordinary markups on each page.'));
        onClose();
      }}
      onClose={onClose}
    />
  );
}
