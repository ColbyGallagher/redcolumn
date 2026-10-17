import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from '@nb/pdf-core';
import { RenderCopyJob } from '../documents/renderCopy/client';
import { KEEP_DPI } from '../documents/renderCopy/images';
import type { PagePlan } from '../documents/renderCopy/renderCopy';
import { settings, useSettings } from '../settings/settings';
import type { PageCost, TileViewer } from '../viewer/TileViewer';

/** A whole-page render that took this long, parsing included, marks a sheet as slow to draw. */
const SLOW_MS = 800;
/** How long the result stays up. */
const DONE_MS = 9000;

/** Files optimised this session: optimised again, without asking, when an edit reopens them. */
const accepted = new Set<string>();
/** Files the offer was turned down for this session. */
const declined = new Set<string>();

type State =
  | { kind: 'idle' }
  | { kind: 'offer'; page: number; ms: number; plan: PagePlan }
  | { kind: 'working'; label: string; done: number; total: number }
  | { kind: 'done'; text: string };

const n = (v: number) => v.toLocaleString();
/** 2,912,344 → "2.9 million"; smaller counts in full. */
const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)} million` : n(v));

interface Totals {
  ok: number;
  failed: number;
  objectsBefore: number;
  objectsAfter: number;
}

/** A first whole-page render of a sheet: parsing plus drawing (ms), and its size in megapixels. */
interface Look {
  ms: number;
  mpx: number;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** What makes the sheet slow and what optimising does about it, in a sentence. */
function cause(plan: PagePlan): string {
  const merged = plan.objectsBefore - plan.objectsAfter;
  if (plan.images && merged < 1000 && plan.clips < 50) {
    const mp = Math.round(plan.imagePixelsBefore / 1e6);
    return plan.images === 1
      ? `Its picture (${mp} megapixels) is far sharper than the page shows it; optimised, it is scaled to ${KEEP_DPI} dpi.`
      : `Its ${n(plan.images)} pictures (${mp} megapixels) are far sharper than the page shows them; optimised, they are scaled to ${KEEP_DPI} dpi.`;
  }
  if (merged >= plan.clips * 10) return `It is drawn as ${n(plan.objectsBefore)} separate lines; optimised, as ${n(plan.objectsAfter)}.`;
  return `It clips ${n(plan.clips)} hatches the slow way; optimised, its lines are cut to shape instead.`;
}

/**
 * Watches how long sheets take to draw. When one is slow for a reason an optimised copy fixes
 * (hundreds of thousands of separate hatch lines, clipped hatches), offers to draw the document
 * from such a copy (Preferences › Document › Optimise Slow Drawings). The copy is built in the
 * background, pages likely in view first, and each page is drawn from it only once it is checked
 * to look the same as the original. The file itself never changes.
 */
export function SlowDrawingPrompt({ viewer, doc, fileId }: { viewer: TileViewer; doc: PdfDocument; fileId: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const mode = useSettings().optimiseDrawings;
  /** Starts optimising (set by the effect for the current document). */
  const start = useRef<() => void>(() => {});
  /** Stops a run in progress, keeping the pages already checked. */
  const stop = useRef<() => void>(() => {});
  /** Lets the optimiser's copy of the file go (the offer was turned down). */
  const release = useRef<() => void>(() => {});

  useEffect(() => {
    let job: RenderCopyJob | null = null;
    let disposed = false;
    /** Analysing or optimising: nothing else starts meanwhile. */
    let busy = false;
    let offered = false;
    const planned = new Set<number>();
    /** Sheets slow to draw from the original, and the same sheets drawn from the copy. */
    const slow = new Map<number, Look>();
    const fast = new Map<number, Look>();
    /** Parsing each checked page of the copy (the check parsed it, so the viewer's render did not). */
    const copyParse = new Map<number, number>();
    setState({ kind: 'idle' });

    /** "Page 33 now draws in 0.4 s instead of 2.6 s.", for a sheet seen both ways at the same size. */
    const measured = (): string => {
      const pages = [viewer.getView().pageIndex, ...slow.keys()];
      for (const p of pages) {
        const a = slow.get(p);
        const b = fast.get(p);
        if (a && b && Math.abs(a.mpx - b.mpx) <= 0.25 * a.mpx) return ` Page ${p + 1} now draws in ${seconds(b.ms)} instead of ${seconds(a.ms)}.`;
      }
      return '';
    };

    const open = async () => (job ??= new RenderCopyJob(await doc.bytes()));

    /** Checks pages against the original; those that match are drawn from the copy from now on. */
    const check = async (pages: number[], totals: Totals) => {
      for (const [k, p] of pages.entries()) {
        if (disposed) return;
        setState({ kind: 'working', label: 'Checking optimised sheets', done: k, total: pages.length });
        const c = await doc.checkCopy(p);
        if (c.ok) {
          totals.ok++;
          totals.objectsBefore += c.originalObjects;
          totals.objectsAfter += c.copyObjects;
          copyParse.set(p, c.copyParseMs);
          viewer.refreshPages([p]);
        } else totals.failed++;
      }
    };

    const optimise = async () => {
      if (disposed) return;
      busy = true;
      accepted.add(fileId);
      const totals: Totals = { ok: 0, failed: 0, objectsBefore: 0, objectsAfter: 0 };
      try {
        const j = await open();
        const progress = (label: string) => (done: number, total: number) => !disposed && setState({ kind: 'working', label, done, total });
        // The sheets in view and the slow ones first, so the difference shows in seconds.
        const first = [...new Set([viewer.getView().pageIndex, ...slow.keys()])];
        const a = await j.build(first, progress('Optimising sheets in view'));
        if (disposed) return;
        if (a.bytes) {
          await doc.setRenderCopy(a.bytes);
          await check(a.pages.filter((p) => p.worthwhile).map((p) => p.pageIndex), totals);
        }
        const b = await j.build(null, progress('Optimising the other sheets'));
        if (disposed) return;
        if (b.bytes) {
          await doc.setRenderCopy(b.bytes, true);
          const done = new Set(first);
          await check(b.pages.filter((p) => p.worthwhile && !done.has(p.pageIndex)).map((p) => p.pageIndex), totals);
        }
        if (disposed) return;
        if (!totals.ok) {
          await doc.setRenderCopy(null);
          setState({ kind: 'done', text: 'Optimising made no difference to how these sheets look or draw, so they are drawn as before.' });
          return;
        }
        const failed = totals.failed ? ` ${n(totals.failed)} sheet${totals.failed === 1 ? '' : 's'} came out different and ${totals.failed === 1 ? 'is' : 'are'} drawn as before.` : '';
        setState({
          kind: 'done',
          text: `Optimised ${n(totals.ok)} sheet${totals.ok === 1 ? '' : 's'} for display, each checked against the original: ${compact(totals.objectsBefore)} drawing objects down to ${compact(totals.objectsAfter)}.${measured()}${failed} The file itself is unchanged.`,
        });
      } catch (err) {
        if (!disposed) setState({ kind: 'done', text: `Could not optimise this document: ${err instanceof Error ? err.message : String(err)}. It is drawn as before.` });
      } finally {
        job?.dispose();
        job = null;
      }
    };

    /** A slow sheet: works out whether optimising helps it, then offers (or just does it). */
    const consider = async (page: number, ms: number) => {
      const how = settings.get().optimiseDrawings;
      if (how === 'never' || declined.has(fileId) || busy || offered || planned.has(page)) return;
      busy = true;
      planned.add(page);
      try {
        const [plan] = await (await open()).plan([page]);
        if (disposed || !plan) return;
        if (!plan.worthwhile) {
          busy = false;
          return;
        }
        offered = true;
        if (how === 'always' || accepted.has(fileId)) {
          void optimise();
          return;
        }
        busy = false;
        setState({ kind: 'offer', page, ms, plan });
      } catch {
        // Encrypted, or unreadable to the optimiser: drawn as it is, and not offered again.
        offered = true;
        job?.dispose();
        job = null;
      }
    };

    const onCost = (c: PageCost) => {
      // Whole-page renders only: a tile's time says little about the sheet.
      if (!c.pageMpx) return;
      if (c.fromCopy) {
        if (!fast.has(c.pageIndex)) fast.set(c.pageIndex, { ms: c.pageMs + (c.parseMs || (copyParse.get(c.pageIndex) ?? 0)), mpx: c.pageMpx });
        return;
      }
      const ms = c.parseMs + c.pageMs;
      if (ms < SLOW_MS) return;
      if (!slow.has(c.pageIndex)) slow.set(c.pageIndex, { ms, mpx: c.pageMpx });
      void consider(c.pageIndex, ms);
    };
    for (const c of viewer.pageCosts()) onCost(c);
    const off = viewer.onPageCost(onCost);

    start.current = () => void optimise();
    release.current = () => {
      job?.dispose();
      job = null;
    };
    stop.current = () => {
      disposed = true;
      accepted.delete(fileId);
      job?.dispose();
      job = null;
      setState({ kind: 'idle' });
    };
    return () => {
      disposed = true;
      off();
      job?.dispose();
    };
  }, [viewer, doc, fileId]);

  useEffect(() => {
    if (state.kind !== 'done') return;
    const t = setTimeout(() => setState({ kind: 'idle' }), DONE_MS);
    return () => clearTimeout(t);
  }, [state]);

  if (state.kind === 'idle' || (state.kind === 'offer' && mode === 'never')) return null;
  return (
    <div className="slow-drawing" role="status">
      {state.kind === 'offer' && (
        <>
          <p>
            Page {state.page + 1} took {(state.ms / 1000).toFixed(1)} s to draw. {cause(state.plan)} Draw this document from an optimised copy? Your file is not changed.
          </p>
          <div className="slow-drawing-actions">
            <button className="btn primary" onClick={() => start.current()}>
              Optimise
            </button>
            <button
              className="btn"
              onClick={() => {
                declined.add(fileId);
                release.current();
                setState({ kind: 'idle' });
              }}
            >
              Not Now
            </button>
            <button
              className="btn"
              onClick={() => {
                settings.set({ optimiseDrawings: 'never' });
                release.current();
                setState({ kind: 'idle' });
              }}
            >
              Never Ask
            </button>
          </div>
        </>
      )}
      {state.kind === 'working' && (
        <>
          <p>
            {state.label}… {state.total > 0 && `${state.done} of ${state.total}`}
          </p>
          <progress max={Math.max(1, state.total)} value={state.done} />
          <div className="slow-drawing-actions">
            <button className="btn" onClick={() => stop.current()}>
              Stop
            </button>
          </div>
        </>
      )}
      {state.kind === 'done' && <p onClick={() => setState({ kind: 'idle' })}>{state.text}</p>}
    </div>
  );
}
