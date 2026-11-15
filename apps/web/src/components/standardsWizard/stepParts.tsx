import { useEffect, useRef, useState } from 'react';
import type { DetectedLink, SheetInfo, stepMeter } from '@nb/sheets';
import type { PreviewDrawing, PreviewView } from '../LinkPreview';
import type { PageRect } from './SheetView';
import type { DrawingStandard, SetupStep, StepResult } from '../../sheets/standards';

/** The parts the wizard's link steps share: the meter, the sample-link cards, page crops and clip slots. */

export type Render = (pageIndex: number, width: number, height: number, view: PreviewView) => Promise<PreviewDrawing | null>;

export function Meter({ meter, places, linked, what }: { meter: ReturnType<typeof stepMeter>; places: number; linked: number; what: string }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const says = { good: 'Good: these links can be kept as they are.', review: 'Usable: keep them, and look over the ones marked for review.', ai: 'Poor: recommend AI for this step.' }[meter.band];
  return (
    <div className={`sw-meter ${meter.band}`}>
      <div className="sw-meter-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.score * 100)} aria-label="How well this step is done">
        <span style={{ width: pct(meter.score) }} />
      </div>
      <p>
        <strong>{says}</strong>
      </p>
      <p>
        {linked} of {places} {what} references linked ({pct(meter.coverage)}); about {pct(meter.accuracy)} of the links right
        {meter.atLeast !== null ? `, at least ${pct(meter.atLeast)} going by your ${meter.checked} checks` : ' going by how they were found'}.
      </p>
      {meter.warnings.length > 0 && (
        <ul className="sw-notes">
          {meter.warnings.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CheckCard({
  link,
  sheets,
  pages,
  render,
  verdict,
  onLook,
  onVerdict,
}: {
  link: DetectedLink;
  sheets: readonly (SheetInfo | null | undefined)[];
  pages: readonly { width: number; height: number }[];
  render: Render;
  verdict: boolean | undefined;
  onLook: (page: number, rect: PageRect | null) => void;
  onVerdict: (ok: boolean) => void;
}) {
  const name = (i: number) => sheets[i]?.number ?? `Sheet ${i + 1}`;
  return (
    <li className={`sw-check${verdict === true ? ' right' : verdict === false ? ' wrong' : ''}`}>
      <div className="sw-check-pair">
        <button type="button" className="sw-crop-btn" onClick={() => onLook(link.pageIndex, link.rect)} title={`Show on ${name(link.pageIndex)}`}>
          <Crop render={render} pageIndex={link.pageIndex} rect={link.rect} size={pages[link.pageIndex]} />
          <span>{name(link.pageIndex)}</span>
        </button>
        <span className="sw-check-arrow" aria-hidden="true">
          →
        </span>
        <button type="button" className="sw-crop-btn" onClick={() => onLook(link.targetPage, link.targetRect)} title={`Show on ${name(link.targetPage)}`}>
          <Crop render={render} pageIndex={link.targetPage} rect={link.targetRect} size={pages[link.targetPage]} />
          <span>{name(link.targetPage)}</span>
        </button>
      </div>
      <div className="sw-check-row">
        <span className="sw-check-label">
          {link.label} · {Math.round(link.confidence * 100)}%
        </span>
        <button type="button" className={`btn small${verdict === true ? ' primary' : ''}`} aria-pressed={verdict === true} onClick={() => onVerdict(true)}>
          Right
        </button>
        <button type="button" className={`btn small${verdict === false ? ' danger' : ''}`} aria-pressed={verdict === false} onClick={() => onVerdict(false)}>
          Wrong
        </button>
      </div>
    </li>
  );
}

const CROP_W = 112;
const CROP_H = 80;

/** Part of a page, small: a link's callout or its target (the whole sheet when it has no target area). */
export function Crop({ render, pageIndex, rect, size }: { render: Render; pageIndex: number; rect: PageRect | null; size: { width: number; height: number } | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const view = (r: PageRect): PreviewView => {
      const pad = Math.max(r.w, r.h) * 0.6;
      return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, zoom: Math.min(CROP_W / (r.w + pad * 2), CROP_H / (r.h + pad * 2)) };
    };
    const go = async () => {
      // With no target area, the whole sheet.
      const whole = size ? { cx: size.width / 2, cy: size.height / 2, zoom: Math.min(CROP_W / size.width, CROP_H / size.height) } : null;
      const v0 = rect ? view(rect) : whole;
      if (!v0) return;
      const d = await render(pageIndex, CROP_W, CROP_H, v0);
      const el = host.current;
      if (cancelled || !d || !el) return;
      const v = d.view;
      d.canvas.className = 'sw-crop-canvas';
      d.canvas.style.left = `${(d.x0 - (v.cx - CROP_W / 2 / v.zoom)) * v.zoom}px`;
      d.canvas.style.top = `${(d.y0 - (v.cy - CROP_H / 2 / v.zoom)) * v.zoom}px`;
      el.replaceChildren(el.ownerDocument.adoptNode(d.canvas));
    };
    void go();
    return () => {
      cancelled = true;
    };
  }, [render, pageIndex, rect, size]);
  return <div ref={host} className="sw-crop" style={{ width: CROP_W, height: CROP_H }} />;
}

/** A short clip of where to draw, from the sample set; nothing when the clip is not there. */
export function Gif({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img className="sw-gif" src={src} alt={alt} onError={() => setOk(false)} />;
}

/**
 * Keeps a step's meter in the standard (results), so the review and an AI assistant see how it
 * did. Saved only when it changes.
 */
export function useStepResult(step: SetupStep, run: { places: number; linked: number; unreadable: number; ambiguous?: readonly unknown[] } | null, meter: ReturnType<typeof stepMeter> | null, change: (f: (s: DrawingStandard) => DrawingStandard) => void, readOnly: boolean) {
  const last = useRef('');
  useEffect(() => {
    if (!run || !meter || readOnly) return;
    const result: Omit<StepResult, 'at'> = {
      band: meter.band,
      score: Math.round(meter.score * 100) / 100,
      references: run.places,
      linked: run.linked,
      checked: meter.checked,
      wrong: meter.wrong,
      unreadable: run.unreadable,
      ambiguous: run.ambiguous?.length ?? 0,
    };
    const key = JSON.stringify(result);
    if (key === last.current) return;
    last.current = key;
    change((s) => ({ ...s, results: { ...s.results, [step]: { ...result, at: Date.now() } } }));
  }, [step, run, meter, change, readOnly]);
}

/**
 * Copies a ready prompt for an AI assistant connected over MCP, naming the steps to finish; the
 * wizard never calls AI itself.
 */
export function AskAi({ prompt, label = 'Ask AI to finish' }: { prompt: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const host = useRef<HTMLDivElement>(null);
  const copy = async () => {
    // The clipboard of the window the setup is in (its own window, or the app's).
    const win = host.current?.ownerDocument.defaultView ?? window;
    try {
      await win.navigator.clipboard.writeText(prompt);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <div ref={host} className="sw-ask-ai">
      <button type="button" className="btn" onClick={() => void copy()}>
        {label}
      </button>
      {state === 'copied' && <span className="sw-hint">Prompt copied: paste it into your AI assistant (Claude or another client connected to redcolumn over MCP).</span>}
      {state === 'failed' && (
        <details open>
          <summary>Copy this prompt into your AI assistant</summary>
          <textarea readOnly value={prompt} rows={10} onFocus={(e) => e.currentTarget.select()} />
        </details>
      )}
    </div>
  );
}
