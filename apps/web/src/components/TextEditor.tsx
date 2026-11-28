import { msg } from '@nb/i18n';
import { useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { applySpanStyle, autoFormatList, autoSizedPoints, backspaceList, baseTextStyle, contentBox, continueList, cssFont, layoutRuns, normalizeSpans, rangeHasFlag, shiftList, shiftSpans, textBlockShift, textLineHeight, textPadding, textColor, toggleList, toggleSpanFlag, type ListKind, type Markup, type MarkupDocument, type Point, type SpanFlag, type StyledMeasure, type TextEdit, type TextSpan } from '@nb/markup';
import { readDom, readSelection, renderRuns, setSelection, type RichState } from './richEditorDom';
import { settings, useSettings } from '../settings/settings';
import type { TileViewer } from '../viewer/TileViewer';

const MIN_EDIT_FONT_PX = 13;

interface Props {
  markup: Markup;
  store: MarkupDocument;
  viewer: TileViewer;
  onDone: () => void;
}

/** Widths of text in the markup's font at its size, in a given weight and slant (for text with styled parts). */
function styledMeasurer(m: Markup): { plain: (s: string) => number; styled: StyledMeasure } {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const size = m.style.fontSize ?? 12;
  return {
    plain: (s) => {
      ctx.font = cssFont(m.style, size);
      return ctx.measureText(s).width;
    },
    styled: (s, bold, italic) => {
      ctx.font = cssFont({ ...m.style, bold, italic }, size);
      return ctx.measureText(s).width;
    },
  };
}

/** Preferences › Markup › Auto-size Text Box and Call-out Markups: the box fitted to the new text. */
function fittedBox(m: Markup, text: string, spans: TextSpan[]): { points?: Point[] } {
  if (!settings.get().autoSizeText || (m.type !== 'text' && m.type !== 'callout')) return {};
  const { plain, styled } = styledMeasurer(m);
  const points = autoSizedPoints({ ...m, text, spans }, plain, styled);
  return points ? { points } : {};
}

/** Typewriter text has no box to wrap in: the box is sized to fit the typed lines. */
function typewriterBox(m: Markup, text: string, spans: TextSpan[]): [Point, Point] {
  const size = m.style.fontSize ?? 12;
  const { plain, styled } = styledMeasurer(m);
  const lines = text.split('\n');
  const widths = spans.length ? layoutRuns(text, spans, baseTextStyle(m), 1e9, styled).map((l) => l.width) : lines.map(plain);
  const w = Math.max(...widths, size) + textPadding(m.style) * 2;
  const h = lines.length * size * textLineHeight(m.style) + textPadding(m.style) * 2;
  const x = Math.min(m.points[0]![0], m.points[1]![0]);
  const y = Math.min(m.points[0]![1], m.points[1]![1]);
  return [
    [x, y],
    [x + w, y + h],
  ];
}

/** Ctrl+B / I / U (and Ctrl+Shift+X) while typing: the style flag each toggles. */
const FORMAT_KEYS: Record<string, SpanFlag | undefined> = { b: 'bold', i: 'italic', u: 'underline' };

const FORMAT_BUTTONS: { flag: SpanFlag; label: string; title: string }[] = [
  { flag: 'bold', get label() { return msg('B'); }, get title() { return msg('Bold (Ctrl+B)'); } },
  { flag: 'italic', get label() { return msg('I'); }, get title() { return msg('Italic (Ctrl+I)'); } },
  { flag: 'underline', get label() { return msg('U'); }, get title() { return msg('Underline (Ctrl+U)'); } },
  { flag: 'strikethrough', get label() { return msg('S'); }, get title() { return msg('Strikethrough (Ctrl+Shift+X)'); } },
];

/** Colours offered for selected words; the last (undefined) goes back to the markup's own colour. */
const SWATCHES = ['#000000', '#d92d20', '#e8710a', '#0b8043', '#1a73e8', '#9334e6'];

const LIST_BUTTONS: { kind: ListKind; label: string; title: string }[] = [
  { kind: 'bullet', get label() { return msg('•'); }, get title() { return msg('Bulleted list (Ctrl+Shift+8)'); } },
  { kind: 'number', get label() { return msg('1.'); }, get title() { return msg('Numbered list (Ctrl+Shift+7)'); } },
  { kind: 'letter', get label() { return msg('a.'); }, get title() { return msg('Lettered list'); } },
  { kind: 'roman', get label() { return msg('i.'); }, get title() { return msg('Roman numeral list'); } },
  { kind: 'check', get label() { return msg('☐'); }, get title() { return msg('Checklist (Ctrl+Shift+9)'); } },
];

/** Whether a #rrggbb color is light enough that it cannot be read on white. */
function isLight(color: string): boolean {
  const n = parseInt(color.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
}

/**
 * The editor is white, unless the text is light (a flag label's white on its dark flag): then it sits
 * on the markup's own fill, so what is typed can be read.
 */
function editorBackground(m: Markup): string | undefined {
  if (!isLight(textColor(m.style))) return undefined;
  return m.style.fill ?? m.style.stroke;
}

/** In-place editor positioned over a text box markup. Commits on blur, Esc or Ctrl+Enter. */
export function TextEditor({ markup, store, viewer, onDone }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { spellCheck } = useSettings();
  /** The markup's own style as it is while editing (Ctrl+B with nothing selected changes it for the whole markup). */
  const [style, setStyle] = useState(markup.style);
  const styleRef = useRef(style);
  styleRef.current = style;
  const base = () => baseTextStyle({ style: styleRef.current });
  // The text as typed, so middle and bottom alignment can follow it as lines wrap and are added.
  const [typed, setTyped] = useState<{ text: string; spans: TextSpan[] }>({ text: markup.text ?? '', spans: normalizeSpans(markup.spans, (markup.text ?? '').length) });
  /** Undo history: our own, since the editor's DOM is rebuilt by every list and style edit. */
  const history = useRef<{ stack: RichState[]; at: number; time: number; kind: string }>({ stack: [], at: -1, time: 0, kind: '' });
  /** Which formatting buttons are pressed at the selection. */
  const [pressed, setPressed] = useState<Record<SpanFlag, boolean>>({ bold: false, italic: false, underline: false, strikethrough: false });

  /** The editor as it is now: text, spans and selection. */
  const current = (): RichState => {
    const el = ref.current!;
    const { text, spans } = readDom(el, base());
    const sel = readSelection(el, base()) ?? { start: text.length, end: text.length };
    return { text, spans, start: Math.min(sel.start, text.length), end: Math.min(sel.end, text.length) };
  };

  /** Shows a state in the editor. */
  const show = (s: RichState, b = base()) => {
    const el = ref.current!;
    renderRuns(el, s.text, s.spans, b);
    setSelection(el, s.start, s.end);
    setTyped({ text: s.text, spans: s.spans });
  };

  /** Adds a state to the undo history; typing within a moment of the last typing joins its step. */
  const remember = (s: RichState, kind: string) => {
    const h = history.current;
    const now = Date.now();
    h.stack.length = h.at + 1;
    if (kind === 'typing' && h.kind === 'typing' && now - h.time < 800 && h.at > 0) h.stack[h.at] = s;
    else {
      h.stack.push(s);
      h.at = h.stack.length - 1;
    }
    h.time = now;
    h.kind = kind;
  };

  /** Makes an edit: shown, and undoable as one step. */
  const apply = (s: RichState, kind = 'edit') => {
    show(s);
    remember(s, kind);
    updatePressed();
  };

  const undo = (dir: -1 | 1) => {
    const h = history.current;
    const to = h.at + dir;
    if (to < 0 || to >= h.stack.length) return;
    h.at = to;
    h.kind = '';
    show(h.stack[to]!);
    updatePressed();
  };

  /** Runs a list operation on the text and selection; false (and nothing changed) when it does not apply. */
  const edit = (op: (text: string, start: number, end: number) => TextEdit | null): boolean => {
    if (!ref.current) return false;
    const s = current();
    const result = op(s.text, s.start, s.end);
    if (!result) return false;
    apply({ text: result.text, spans: shiftSpans(s.spans, s.text, result.text), start: result.start, end: result.end });
    return true;
  };

  /** Which of bold, italic, underline and strikethrough the selected words all have (the caret's word when collapsed). */
  const updatePressed = () => {
    const el = ref.current;
    if (!el) return;
    const s = current();
    const b = base();
    const at = s.start === s.end ? [Math.max(0, s.start - 1), Math.min(s.text.length, Math.max(s.start, 1))] : [s.start, s.end];
    const next = { bold: false, italic: false, underline: false, strikethrough: false };
    for (const f of Object.keys(next) as SpanFlag[]) next[f] = s.text ? rangeHasFlag(s.text, s.spans, at[0]!, at[1]!, f, b) : !!b[f];
    setPressed((old) => (old.bold === next.bold && old.italic === next.italic && old.underline === next.underline && old.strikethrough === next.strikethrough ? old : next));
  };

  /**
   * Bold, italic, underline, strikethrough: on the selected words when some of the text is
   * selected, else on the whole markup, as the Properties panel's toggles do.
   */
  const format = (flag: SpanFlag) => {
    if (!ref.current) return;
    const s = current();
    const partial = s.start !== s.end && !(s.start === 0 && s.end === s.text.length);
    if (partial) {
      apply({ ...s, spans: toggleSpanFlag(s.text, s.spans, s.start, s.end, flag, base()) });
      return;
    }
    const live = store.get(markup.id)?.style ?? styleRef.current;
    const next = { ...live, [flag]: flag === 'bold' ? !live.bold : !live[flag] || undefined };
    store.checkpoint();
    store.update(markup.id, { style: next });
    styleRef.current = next;
    setStyle(next);
    // Words styled apart no longer say otherwise about this flag.
    apply({ ...s, spans: applySpanStyle(s.spans, 0, s.text.length, { [flag]: undefined }, s.text.length) });
  };

  /** A colour for the selected words (or the whole markup when nothing in particular is selected); undefined goes back to the markup's own. */
  const colorize = (color: string | undefined) => {
    if (!ref.current) return;
    const s = current();
    const partial = s.start !== s.end && !(s.start === 0 && s.end === s.text.length);
    if (partial) {
      apply({ ...s, spans: applySpanStyle(s.spans, s.start, s.end, { color }, s.text.length) });
      return;
    }
    const live = store.get(markup.id)?.style ?? styleRef.current;
    const next = { ...live, textColor: color };
    if (color === undefined) delete next.textColor;
    store.checkpoint();
    store.update(markup.id, { style: next });
    styleRef.current = next;
    setStyle(next);
    apply({ ...s, spans: applySpanStyle(s.spans, 0, s.text.length, { color: undefined }, s.text.length) });
  };

  // Typed text the browser put outside any run is drawn as the markup's own style: rebuild so what is shown is what is saved.
  const normalizeDom = () => {
    const el = ref.current!;
    if (Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE || (n as HTMLElement).tagName === 'DIV')) {
      const s = current();
      show(s);
    }
  };

  useLayoutEffect(() => {
    const el = ref.current!;
    const initial: RichState = { text: typed.text, spans: typed.spans, start: 0, end: typed.text.length };
    show(initial);
    el.focus();
    setSelection(el, 0, typed.text.length);
    remember(initial, 'edit');
    // History moves (the context menu's Undo) are ours too.
    const onBefore = (e: InputEvent) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        undo(e.inputType === 'historyUndo' ? -1 : 1);
      }
    };
    el.addEventListener('beforeinput', onBefore);
    const onSelect = () => {
      if (document.activeElement === el) updatePressed();
    };
    document.addEventListener('selectionchange', onSelect);
    return () => {
      el.removeEventListener('beforeinput', onBefore);
      document.removeEventListener('selectionchange', onSelect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const box = contentBox(markup);
  const [x0, y0] = viewer.pageToClient([box.x, box.y], markup.pageIndex);
  const fontSize = style.fontSize ?? 12;
  // When zoomed out, enlarge the editor so the text being typed stays readable.
  const scale = Math.max(viewer.zoomFor(markup.pageIndex), MIN_EDIT_FONT_PX / fontSize);
  const typewriter = markup.type === 'typewriter';
  // Typewriter text grows as it is typed, so give the editor room to the right.
  const width = Math.max(box.w * scale, typewriter ? 320 : 0);
  const height = Math.max(box.h * scale, typewriter ? fontSize * scale * 3 : 0);

  // Middle and bottom text sits lower than the top: pad the first line down to where it renders.
  const valigned = !typewriter && (style.verticalAlign ?? 'top') !== 'top';
  let padTop = textPadding(style) * scale;
  if (valigned) {
    const m = styledMeasurer({ ...markup, style });
    padTop = Math.max(0, padTop + textBlockShift({ ...markup, style, text: typed.text, spans: typed.spans }, m.plain, m.styled) * scale);
  }

  const finish = () => {
    const now = ref.current ? readDom(ref.current, base()) : { text: markup.text ?? '', spans: markup.spans ?? [] };
    const text = now.text;
    const spans = now.spans;
    const was = JSON.stringify(normalizeSpans(markup.spans, (markup.text ?? '').length));
    if (text !== (markup.text ?? '') || JSON.stringify(spans) !== was) {
      const kept = spans.length ? spans : undefined;
      store.update(markup.id, typewriter ? { text, spans: kept, points: typewriterBox({ ...markup, style }, text, spans) } : { text, spans: kept, ...fittedBox({ ...markup, style }, text, spans) });
    }
    // A text box that never received text is removed rather than left empty (a flowchart shape is a shape without it).
    if (markup.type !== 'flowShape' && text.trim() === '') store.remove([markup.id]);
    onDone();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape' || (e.key === 'Enter' && mod)) {
      e.currentTarget.blur();
    } else if (mod && !e.altKey && key === 'z') {
      e.preventDefault();
      undo(e.shiftKey ? 1 : -1);
    } else if (mod && !e.altKey && !e.shiftKey && key === 'y') {
      e.preventDefault();
      undo(1);
    } else if (mod && !e.shiftKey && !e.altKey && FORMAT_KEYS[key]) {
      e.preventDefault();
      format(FORMAT_KEYS[key]!);
    } else if (mod && e.shiftKey && !e.altKey && key === 'x') {
      e.preventDefault();
      format('strikethrough');
    } else if (e.nativeEvent.isComposing) {
      return;
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      // Lines are made here, not by the browser, so the text keeps plain "\n" breaks.
      e.preventDefault();
      if (!edit(continueList)) {
        const s = current();
        const text = `${s.text.slice(0, s.start)}\n${s.text.slice(s.end)}`;
        apply({ text, spans: shiftSpans(s.spans, s.text, text), start: s.start + 1, end: s.start + 1 });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = current();
      const text = `${s.text.slice(0, s.start)}\n${s.text.slice(s.end)}`;
      apply({ text, spans: shiftSpans(s.spans, s.text, text), start: s.start + 1, end: s.start + 1 });
    } else if (e.key === 'Tab' && !mod && !e.altKey) {
      // Tab in a list moves the item; elsewhere it leaves the editor, as before.
      if (edit((t, a, b) => shiftList(t, a, b, e.shiftKey ? -1 : 1))) e.preventDefault();
    } else if (e.key === 'Backspace' && !mod && !e.altKey && !e.shiftKey) {
      if (edit(backspaceList)) e.preventDefault();
    } else if (mod && e.shiftKey && !e.altKey) {
      const kind: ListKind | undefined = { Digit8: 'bullet', Digit7: 'number', Digit9: 'check' }[e.code] as ListKind | undefined;
      if (kind) {
        e.preventDefault();
        edit((t, a, b) => toggleList(t, a, b, kind));
      }
    }
  };

  // Typing a space after `-`, `*` or `[]` at the start of a line starts a list.
  const onInput = (e: FormEvent<HTMLDivElement>) => {
    const native = e.nativeEvent as InputEvent;
    normalizeDom();
    const s = current();
    remember(s, 'typing');
    setTyped({ text: s.text, spans: s.spans });
    updatePressed();
    if (native.isComposing || native.inputType !== 'insertText' || native.data !== ' ') return;
    if (s.start === s.end) edit((t, caret) => autoFormatList(t, caret));
  };

  // Only the text of what is pasted or dropped is kept: its own formatting would not match the model.
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!pasted) return;
    const s = current();
    const text = s.text.slice(0, s.start) + pasted + s.text.slice(s.end);
    apply({ text, spans: shiftSpans(s.spans, s.text, text), start: s.start + pasted.length, end: s.start + pasted.length }, 'paste');
  };

  // The bar sits above the editor, or below it where there is no room above.
  const barTop = y0 >= 34 ? y0 - 30 : y0 + height + 4;

  return (
    <>
      <div className="text-editor-bar" style={{ left: x0, top: barTop }} role="toolbar" aria-label={msg('Text formatting')} onMouseDown={(e) => e.preventDefault()}>
        {FORMAT_BUTTONS.map((b) => (
          <button key={b.flag} type="button" className={`fmt fmt-${b.flag}`} title={b.title} aria-label={b.title} aria-pressed={pressed[b.flag]} onClick={() => format(b.flag)}>
            {b.label}
          </button>
        ))}
        {SWATCHES.map((c) => (
          <button key={c} type="button" className="swatch-button" title={msg('Text colour {c}', { c })} aria-label={msg('Text colour {c}', { c })} onClick={() => colorize(c)}>
            <span style={{ background: c }} />
          </button>
        ))}
        <button type="button" title={msg('Text colour: as the markup')} aria-label={msg('Automatic text colour')} onClick={() => colorize(undefined)}>
          A
        </button>
        <span className="sep" />
        {LIST_BUTTONS.map((b) => (
          <button key={b.kind} type="button" title={b.title} aria-label={b.title} onClick={() => edit((t, a, z) => toggleList(t, a, z, b.kind))}>
            {b.label}
          </button>
        ))}
        <span className="sep" />
        <button type="button" title={msg('Decrease list level (Shift+Tab)')} aria-label={msg('Decrease list level')} onClick={() => edit((t, a, z) => shiftList(t, a, z, -1))}>
          ⇤
        </button>
        <button type="button" title={msg('Increase list level (Tab)')} aria-label={msg('Increase list level')} onClick={() => edit((t, a, z) => shiftList(t, a, z, 1))}>
          ⇥
        </button>
      </div>
      <div
        ref={ref}
        className="text-editor"
        role="textbox"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        spellCheck={spellCheck}
        style={{
          left: x0,
          top: y0,
          width,
          height,
          // Line height rides in the shorthand: setting it apart makes React warn when the font changes while typing.
          font: cssFont(style, fontSize * scale).replace(/px /, `px/${textLineHeight(style)} `),
          textAlign: style.textAlign ?? 'left',
          whiteSpace: typewriter ? 'pre' : 'pre-wrap',
          padding: textPadding(style) * scale,
          ...(valigned ? { paddingTop: padTop, paddingBottom: 0 } : {}),
          color: textColor(style),
          background: editorBackground({ ...markup, style }),
        }}
        onBlur={finish}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onPaste={onPaste}
        onDrop={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
      />
    </>
  );
}
