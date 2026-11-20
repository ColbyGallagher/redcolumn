// The DOM side of the text editor: a contentEditable made of one <span> per run of styled text,
// read back into the markup's plain text and its spans. Text lives in text nodes with its line
// breaks as "\n" (the editor is `white-space: pre-wrap`); a trailing <br data-end> keeps a final
// empty line visible. Offsets everywhere are UTF-16 code units into the plain text.

import { normalizeSpans, styleRuns, type BaseTextStyle, type SpanStyle, type TextSpan } from '@nb/markup';

export interface RichState {
  text: string;
  spans: TextSpan[];
  start: number;
  end: number;
}

/** The inline CSS of one run, every property explicit so a run can switch a markup-wide style off. */
function applyRunStyle(el: HTMLElement, r: { bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; color: string }) {
  // CSSOM assignments, not a style attribute: the desktop CSP (style-src 'self') blocks the latter.
  el.style.fontWeight = r.bold ? 'bold' : 'normal';
  el.style.fontStyle = r.italic ? 'italic' : 'normal';
  el.style.textDecoration = [r.underline && 'underline', r.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none';
  el.style.color = r.color;
}

/** Fills `root` with the text as runs (replacing what it had). */
export function renderRuns(root: HTMLElement, text: string, spans: readonly TextSpan[], base: BaseTextStyle) {
  root.textContent = '';
  for (const r of styleRuns(text, spans, base)) {
    const el = document.createElement('span');
    el.dataset.b = r.bold ? '1' : '0';
    el.dataset.i = r.italic ? '1' : '0';
    el.dataset.u = r.underline ? '1' : '0';
    el.dataset.s = r.strikethrough ? '1' : '0';
    el.dataset.c = r.color;
    applyRunStyle(el, r);
    el.textContent = r.text;
    root.appendChild(el);
  }
  const end = document.createElement('br');
  end.dataset.end = '1';
  root.appendChild(end);
}

interface Walk {
  text: string;
  spans: TextSpan[];
}

/** The resolved style of an element: its own data attributes over its parent's. */
function styleOf(el: Element, parent: Required<SpanStyle>): Required<SpanStyle> {
  const d = (el as HTMLElement).dataset;
  if (!d) return parent;
  return {
    bold: d.b !== undefined ? d.b === '1' : parent.bold,
    italic: d.i !== undefined ? d.i === '1' : parent.italic,
    underline: d.u !== undefined ? d.u === '1' : parent.underline,
    strikethrough: d.s !== undefined ? d.s === '1' : parent.strikethrough,
    color: d.c ?? parent.color,
  };
}

/** Reads a node (and what it holds) into plain text and the spans where it differs from `base`. */
function walk(node: Node, base: BaseTextStyle, startStyle?: Required<SpanStyle>): Walk {
  const own: Required<SpanStyle> = { bold: !!base.bold, italic: !!base.italic, underline: !!base.underline, strikethrough: !!base.strikethrough, color: base.color.toLowerCase() };
  const out: Walk = { text: '', spans: [] };
  const add = (s: string, st: Required<SpanStyle>) => {
    if (!s) return;
    const diff: SpanStyle = {};
    if (st.bold !== own.bold) diff.bold = st.bold;
    if (st.italic !== own.italic) diff.italic = st.italic;
    if (st.underline !== own.underline) diff.underline = st.underline;
    if (st.strikethrough !== own.strikethrough) diff.strikethrough = st.strikethrough;
    if (st.color.toLowerCase() !== own.color) diff.color = st.color;
    if (Object.keys(diff).length) out.spans.push({ start: out.text.length, end: out.text.length + s.length, style: diff });
    out.text += s;
  };
  const visit = (n: Node, st: Required<SpanStyle>) => {
    if (n.nodeType === Node.TEXT_NODE) {
      add((n as Text).data.replace(/\r\n?/g, '\n').replace(/​/g, ''), st);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (el.tagName === 'BR') {
      if (el.dataset.end === undefined) add('\n', st);
      return;
    }
    const next = styleOf(el, st);
    const block = el.tagName === 'DIV' || el.tagName === 'P';
    // A block the browser made (in place of a typed line break) starts a new line.
    if (block && out.text && !out.text.endsWith('\n')) out.text += '\n';
    for (const c of Array.from(el.childNodes)) visit(c, next);
  };
  for (const c of node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? Array.from(node.childNodes) : [node]) visit(c, startStyle ?? own);
  return out;
}

/** The plain text and spans the editor shows. */
export function readDom(root: HTMLElement, base: BaseTextStyle): { text: string; spans: TextSpan[] } {
  const w = walk(root, base);
  return { text: w.text, spans: normalizeSpans(w.spans, w.text.length) };
}

/** How many characters of text come before a point in the editor. */
export function offsetAt(root: HTMLElement, node: Node, offset: number, base: BaseTextStyle): number {
  const range = document.createRange();
  range.setStart(root, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  return walk(holder, base).text.length;
}

/** The selection as offsets into the text, or null when it is not in the editor. */
export function readSelection(root: HTMLElement, base: BaseTextStyle): { start: number; end: number } | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const a = offsetAt(root, sel.anchorNode!, sel.anchorOffset, base);
  const b = offsetAt(root, sel.focusNode!, sel.focusOffset, base);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** Selects `[start, end)` of the text. */
export function setSelection(root: HTMLElement, start: number, end: number) {
  const locate = (target: number): [Node, number] => {
    let seen = 0;
    let last: [Node, number] = [root, 0];
    const find = (n: Node): [Node, number] | null => {
      if (n.nodeType === Node.TEXT_NODE) {
        const len = (n as Text).data.length;
        if (target <= seen + len) return [n, target - seen];
        seen += len;
        last = [n, len];
        return null;
      }
      const el = n as HTMLElement;
      if (el.tagName === 'BR') {
        if (el.dataset.end === undefined) {
          if (target <= seen) return [el.parentNode!, Array.from(el.parentNode!.childNodes).indexOf(el as ChildNode)];
          seen += 1;
        }
        return null;
      }
      for (const c of Array.from(n.childNodes)) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    return find(root) ?? last;
  };
  const sel = document.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const [sn, so] = locate(start);
  const [en, eo] = start === end ? [sn, so] : locate(end);
  range.setStart(sn, so);
  range.setEnd(en, eo);
  sel.removeAllRanges();
  sel.addRange(range);
}
