/**
 * Tips for the start screen (no document open): a step-by-step taken from a help page, so the tip
 * and the help stay the same. Pages are picked for being short, useful and easy to miss.
 */

/** Help pages (public/help/pages/<id>.md) the start screen takes tips from. */
export const TIP_PAGES: readonly string[] = [
  'tool-cloud-plus',
  'calibrate',
  'smart-fill',
  'compare',
  'overlay',
  'draw-to-scale',
  'slip-sheet',
  'summary',
  'stamps-manage',
  'signatures',
  'combine',
  'header-footer',
  'ocr',
  'viewports',
  'spaces',
  'symbol-search',
  'new-pdf',
  'sets',
  'scale-bulk',
  'tool-callout',
  'page-split',
];

export interface TipStep {
  text: string;
  /** Bulleted choices under the step. */
  sub: string[];
}

export interface Tip {
  title: string;
  /** The page's opening paragraph (empty when it has none before the steps). */
  intro: string;
  steps: TipStep[];
  /** A picture from the steps (the last one, usually the result), relative to the help folder. */
  image?: { src: string; alt: string };
  /** The page's first Tip or Note. */
  note?: string;
}

const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/** The title, intro, first numbered list and a picture from a help page's Markdown. */
export function parseTip(md: string): Tip | null {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const title = lines.find((l) => l.startsWith('# '))?.slice(2).trim();
  if (!title) return null;

  // The opening paragraph, or (when the page opens with a heading) the first paragraph anywhere.
  const paragraph = (from: number, stopAtBlock: boolean) => {
    let text = '';
    for (let i = from; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (!l) {
        if (text) break;
        continue;
      }
      if (/^(#|\d+\.\s|[-*]\s|>|!\[|\|)/.test(l) || /^\s/.test(lines[i]!)) {
        // The fallback still stops at the steps, so it never takes a paragraph from after them.
        if (text || stopAtBlock || /^\d+\.\s/.test(l)) break;
        continue;
      }
      text += (text ? ' ' : '') + l;
    }
    return text;
  };
  const start = lines.findIndex((l) => l.startsWith('# ')) + 1;
  const intro = paragraph(start, true) || paragraph(start, false);

  const steps: TipStep[] = [];
  let image: Tip['image'];
  let started = false;
  for (const raw of lines) {
    const l = raw.trim();
    const num = /^\d+\.\s+(.*)$/.exec(raw);
    if (num) {
      started = true;
      steps.push({ text: num[1]!.trim(), sub: [] });
      continue;
    }
    if (!started) continue;
    if (!l) continue;
    // The list ends at the first line that is not indented under it.
    if (!/^\s/.test(raw)) break;
    const pic = IMAGE.exec(l);
    if (pic) image = { alt: pic[1]!, src: pic[2]! };
    else if (/^[-*]\s+/.test(l)) steps[steps.length - 1]!.sub.push(l.replace(/^[-*]\s+/, ''));
    else if (!l.startsWith('>')) steps[steps.length - 1]!.text += ' ' + l;
  }
  if (!steps.length) return null;
  if (!image) {
    const pic = lines.map((l) => IMAGE.exec(l.trim())).find(Boolean);
    if (pic) image = { alt: pic[1]!, src: pic[2]! };
  }

  const noteAt = lines.findIndex((l) => /^>\s*\*\*(Tip|Note):\*\*/.test(l));
  let note: string | undefined;
  if (noteAt >= 0) {
    const parts: string[] = [];
    for (let j = noteAt; j < lines.length && lines[j]!.startsWith('>'); j++) parts.push(lines[j]!.replace(/^>\s?/, ''));
    note = parts.join(' ').replace(/^\*\*(Tip|Note):\*\*\s*/, '').trim();
  }

  return { title, intro, steps, ...(image ? { image } : {}), ...(note ? { note } : {}) };
}

/** A piece of help text: plain, bold, a key combination, a menu path, code or a link to a help page. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'keys'; keys: string[] }
  | { kind: 'menu'; path: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; page: string | null; url: string | null };

const KEY_NAMES: Record<string, string> = { Plus: '+', BracketRight: ']', BracketLeft: '[' };

/** Splits help text into pieces (the help's own Markdown: **bold**, [[Ctrl+S]], {{File > Open}}, `code`, [links](#page)). */
export function inlineParts(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*(?!\*)|\[\[([^\]]+)\]\]|\{\{([^}]+)\}\}|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*/g;
  let at = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    // Italics inside bold (**Old page *n***) show as plain bold.
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1].replace(/\*/g, '') });
    else if (m[2] !== undefined) out.push({ kind: 'keys', keys: m[2].split(/\s*\+\s*(?=.)/).map((k) => KEY_NAMES[k] ?? k) });
    else if (m[3] !== undefined) out.push({ kind: 'menu', path: m[3].split(/\s*>\s*/) });
    else if (m[4] !== undefined) out.push({ kind: 'code', text: m[4] });
    else if (m[5] !== undefined) {
      const target = m[6]!;
      out.push({ kind: 'link', text: m[5], page: target.startsWith('#') ? target.slice(1) : null, url: /^https?:/.test(target) ? target : null });
    } else out.push({ kind: 'text', text: m[7]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}
