import { useEffect, useMemo, useState } from 'react';
import { isTextType, MARKUP_LABELS, type Markup, type MarkupStore } from '@nb/markup';
import type { PdfDocument } from '@nb/pdf-core';
import { useSettings } from '../settings/settings';
import { addToDictionary, misspellings, speller, type Speller } from '../spelling/spell';

interface Props {
  store: MarkupStore;
  markups: readonly Markup[];
  doc: PdfDocument;
  readOnly: boolean;
  /** Shows a markup (selects and zooms to it). */
  onShowMarkup: (m: Markup) => void;
  /** Shows an area of a page (a misspelling in the PDF's own text). */
  onShowText: (pageIndex: number, rect: { x: number; y: number; w: number; h: number }) => void;
  onClose: () => void;
}

/** Where a word was found: a markup's text, comment or a reply, or the PDF's own text. */
type Where = { kind: 'markup'; id: string; field: 'text' | 'comment' | number } | { kind: 'pdf'; pageIndex: number; rect: { x: number; y: number; w: number; h: number } };

interface Issue {
  key: string;
  word: string;
  index: number;
  context: string;
  where: Where;
  label: string;
}

/** The markup texts to check, with where each came from. */
function markupTexts(m: Markup): { field: 'text' | 'comment' | number; text: string }[] {
  const out: { field: 'text' | 'comment' | number; text: string }[] = [];
  if ((isTextType(m.type) || m.type === 'dimension' || m.type === 'replaceText') && m.text) out.push({ field: 'text', text: m.text });
  if (m.comment && !isTextType(m.type) && m.type !== 'replaceText') out.push({ field: 'comment', text: m.comment });
  (m.replies ?? []).forEach((r, i) => r.text && out.push({ field: i, text: r.text }));
  return out;
}

/**
 * Edit › Check Spelling: steps through misspelled words in markup text, comments and replies (and,
 * if asked, the drawing's own text), with suggestions to change them, ignore them or add them to
 * the dictionary.
 */
export function SpellCheckDialog({ store, markups, doc, readOnly, onShowMarkup, onShowText, onClose }: Props) {
  const [checker, setChecker] = useState<Speller | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [withPdf, setWithPdf] = useState(false);
  const [pdfWords, setPdfWords] = useState<{ pageIndex: number; text: string; rect: { x: number; y: number; w: number; h: number } }[] | null>(null);
  const [replacement, setReplacement] = useState('');
  const [added, setAdded] = useState(0);

  useEffect(() => {
    speller().then(setChecker, (err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!withPdf || pdfWords) return;
    void (async () => {
      const out: { pageIndex: number; text: string; rect: { x: number; y: number; w: number; h: number } }[] = [];
      for (let i = 0; i < doc.pages.length; i++) for (const w of await doc.text(i)) out.push({ pageIndex: i, text: w.text, rect: { x: w.x0, y: w.y0, w: w.x1 - w.x0, h: w.y1 - w.y0 } });
      setPdfWords(out);
    })();
  }, [withPdf, pdfWords, doc]);

  const upperCase = useSettings().spellUpperCase;
  const issues = useMemo<Issue[]>(() => {
    if (!checker) return [];
    const out: Issue[] = [];
    const sorted = [...markups].sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt);
    for (const m of sorted) {
      for (const { field, text } of markupTexts(m)) {
        for (const miss of misspellings(checker, text, ignored, upperCase)) {
          const key = `${m.id}:${field}:${miss.index}:${miss.word}`;
          if (skipped.has(key)) continue;
          const where = field === 'text' ? 'text' : field === 'comment' ? 'comment' : `reply ${field + 1}`;
          out.push({ key, word: miss.word, index: miss.index, context: text, where: { kind: 'markup', id: m.id, field }, label: `${m.subject || MARKUP_LABELS[m.type]} ${where}, page ${m.pageIndex + 1}` });
        }
      }
    }
    if (withPdf && pdfWords) {
      pdfWords.forEach((w, i) => {
        for (const miss of misspellings(checker, w.text, ignored, upperCase)) {
          const key = `pdf:${i}:${miss.index}`;
          if (skipped.has(key)) continue;
          out.push({ key, word: miss.word, index: miss.index, context: w.text, where: { kind: 'pdf', pageIndex: w.pageIndex, rect: w.rect }, label: `Drawing text, page ${w.pageIndex + 1}` });
        }
      });
    }
    return out;
    // `added` re-runs the check after a word joins the dictionary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checker, markups, ignored, skipped, withPdf, pdfWords, added, upperCase]);

  const issue = issues[0] ?? null;
  const suggestions = useMemo(() => (issue && checker ? checker.suggest(issue.word).slice(0, 8) : []), [issue, checker]);
  useEffect(() => setReplacement(suggestions[0] ?? ''), [issue?.key, suggestions]);
  useEffect(() => {
    if (!issue) return;
    if (issue.where.kind === 'pdf') onShowText(issue.where.pageIndex, issue.where.rect);
    else {
      const m = store.get(issue.where.id);
      if (m) onShowMarkup(m);
    }
    // Show each issue once, as it comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.key]);

  /** Replaces the word in its markup text (or everywhere in markups, for Change All). */
  const change = (all: boolean) => {
    if (!issue || issue.where.kind !== 'markup' || !replacement) return;
    store.checkpoint();
    const swap = (text: string, index: number | null) =>
      index === null ? text.replace(new RegExp(`(?<![\\p{L}])${issue.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'gu'), replacement) : text.slice(0, index) + replacement + text.slice(index + issue.word.length);
    const targets = all ? markups : markups.filter((m) => m.id === (issue.where as { id: string }).id);
    for (const m of targets) {
      if (m.locked && !all) continue;
      const only = all ? null : issue;
      const patch: Partial<Markup> = {};
      for (const { field, text } of markupTexts(m)) {
        if (only && (only.where as { field: unknown }).field !== field) continue;
        const next = swap(text, only ? only.index : null);
        if (next === text) continue;
        if (field === 'text') patch.text = next;
        else if (field === 'comment') patch.comment = next;
        else patch.replies = (patch.replies ?? m.replies ?? []).map((r, i) => (i === field ? { ...r, text: next } : r));
      }
      if (Object.keys(patch).length) store.update(m.id, patch);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal spell-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>Check Spelling</h3>
        <label className="field">
          <input type="checkbox" checked={withPdf} onChange={(e) => setWithPdf(e.target.checked)} />
          Also check the drawing's own text
        </label>
        {error && <p className="error-text">{error}</p>}
        {!checker && !error && <p>Loading the dictionary…</p>}
        {checker && !issue && (
          <p className="spell-done">{withPdf && !pdfWords ? 'Reading the drawing text…' : 'No spelling mistakes found.'}</p>
        )}
        {issue && (
          <>
            <p className="spell-where">
              {issues.length} to review · {issue.label}
            </p>
            <p className="spell-context">
              {issue.context.slice(Math.max(0, issue.index - 60), issue.index)}
              <mark>{issue.word}</mark>
              {issue.context.slice(issue.index + issue.word.length, issue.index + issue.word.length + 60)}
            </p>
            <div className="form-grid">
              <label htmlFor="spell-to">Change to</label>
              <input id="spell-to" value={replacement} onChange={(e) => setReplacement(e.target.value)} disabled={issue.where.kind === 'pdf'} />
            </div>
            {suggestions.length > 0 && (
              <div className="spell-suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" className={`btn small${s === replacement ? ' active' : ''}`} onClick={() => setReplacement(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="actions spell-actions">
              <button className="btn" onClick={() => setSkipped((s) => new Set(s).add(issue.key))}>
                Ignore
              </button>
              <button className="btn" onClick={() => setIgnored((s) => new Set(s).add(issue.word.toLowerCase()))}>
                Ignore All
              </button>
              <button className="btn" onClick={() => void addToDictionary(issue.word).then(() => setAdded((n) => n + 1))}>
                Add to Dictionary
              </button>
              <button className="btn" disabled={readOnly || issue.where.kind === 'pdf' || !replacement} onClick={() => change(true)}>
                Change All
              </button>
              <button className="btn primary" disabled={readOnly || issue.where.kind === 'pdf' || !replacement} onClick={() => change(false)}>
                Change
              </button>
            </div>
          </>
        )}
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
