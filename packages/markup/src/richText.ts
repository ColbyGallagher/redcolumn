// Reads the mixed formatting of a FreeText annotation's /RC (rich text) into the plain text and
// the styled parts our text markups keep. Only what the model has is read: bold, italic,
// underline, strikethrough and colour, from `<span style>` and the `<b>` `<i>` `<u>` `<s>` tags.

import { cssColor } from './bluebeam';
import { unescapeXml } from './xml';
import { normalizeSpans, type SpanStyle, type TextSpan } from './textSpans';

/** What a CSS declaration list (`font-weight:bold; color:#FF0000`) says about the styles we keep. */
function cssSpanStyle(css: string): SpanStyle {
  const out: SpanStyle = {};
  for (const decl of css.slice(0, 2000).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const key = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().toLowerCase();
    if (key === 'font-weight') out.bold = /bold|^[6-9]00$/.test(value) ? true : value === 'normal' || /^[1-5]00$/.test(value) ? false : out.bold;
    else if (key === 'font-style') out.italic = /italic|oblique/.test(value) ? true : value === 'normal' ? false : out.italic;
    else if (key === 'text-decoration' || key === 'text-decoration-line') {
      if (value === 'none') {
        out.underline = false;
        out.strikethrough = false;
      } else {
        if (/underline/.test(value)) out.underline = true;
        if (/line-through/.test(value)) out.strikethrough = true;
      }
    } else if (key === 'color') {
      const c = cssColor(value);
      if (c) out.color = c;
    }
  }
  for (const k of Object.keys(out) as (keyof SpanStyle)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * The text of a /RC (paragraphs joined by line breaks, no-break spaces as spaces) and the parts of
 * it styled apart from the body. Null when the markup is not well formed enough to trust.
 */
export function parseRichText(rc: string): { text: string; spans: TextSpan[] } | null {
  if (rc.length > 1_000_000) return null;
  let text = '';
  const spans: TextSpan[] = [];
  const stack: { tag: string; style: SpanStyle }[] = [];
  let inBody = false;
  let paragraphs = 0;
  let inParagraph = false;
  const current = (): SpanStyle => Object.assign({}, ...stack.map((s) => s.style)) as SpanStyle;
  const newParagraph = () => {
    if (paragraphs > 0) text += '\n';
    paragraphs++;
  };
  for (const piece of rc.split(/(<[^>]*>)/)) {
    if (!piece) continue;
    if (piece[0] !== '<') {
      if (!inBody) continue;
      // Text outside any paragraph starts one.
      if (!inParagraph && piece.trim()) {
        newParagraph();
        inParagraph = true;
      }
      if (!inParagraph) continue;
      const t = unescapeXml(piece).replace(/ /g, ' ').replace(/[\r\n]+/g, ' ');
      const style = current();
      if (Object.keys(style).length) spans.push({ start: text.length, end: text.length + t.length, style });
      text += t;
      continue;
    }
    if (piece.startsWith('<?') || piece.startsWith('<!')) continue;
    const closing = piece.startsWith('</');
    const selfClosing = /\/\s*>$/.test(piece);
    const tag = /^<\/?\s*([\w:-]+)/.exec(piece)?.[1]?.toLowerCase();
    if (!tag) return null;
    if (tag === 'body') {
      inBody = !closing;
      continue;
    }
    if (!inBody) continue;
    if (tag === 'p') {
      if (closing) inParagraph = false;
      else {
        newParagraph();
        inParagraph = !selfClosing;
      }
    } else if (tag === 'br') {
      text += '\n';
    } else if (closing) {
      const at = stack.map((s) => s.tag).lastIndexOf(tag);
      if (at >= 0) stack.splice(at);
    } else if (!selfClosing && ['span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del'].includes(tag)) {
      const css = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(piece);
      const own = tag === 'span' ? cssSpanStyle(unescapeXml(css?.[1] ?? css?.[2] ?? '')) : tag === 'b' || tag === 'strong' ? { bold: true } : tag === 'i' || tag === 'em' ? { italic: true } : tag === 'u' ? { underline: true } : { strikethrough: true };
      stack.push({ tag, style: own });
    }
  }
  return { text, spans: normalizeSpans(spans, text.length) };
}

/**
 * The spans a /RC adds to a markup whose text is `text`: none when it says the same as the plain
 * markup or does not agree with the text (another program changed one but not the other). Styles
 * equal to the markup's own are left out.
 */
export function spansFromRichText(rc: string | null | undefined, text: string, base: { bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean; color: string }): TextSpan[] {
  if (!rc || !text) return [];
  let parsed: ReturnType<typeof parseRichText>;
  try {
    parsed = parseRichText(rc);
  } catch {
    return [];
  }
  if (!parsed || parsed.spans.length === 0) return [];
  const clean = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\n+$/, '').replace(/ /g, ' ');
  if (clean(parsed.text) !== clean(text)) return [];
  const own = parsed.spans.map((s) => {
    const style: SpanStyle = { ...s.style };
    for (const f of ['bold', 'italic', 'underline', 'strikethrough'] as const) if (style[f] !== undefined && style[f] === !!base[f]) delete style[f];
    if (style.color && style.color.toLowerCase() === base.color.toLowerCase()) delete style.color;
    return { ...s, style };
  });
  return normalizeSpans(own, text.length);
}
