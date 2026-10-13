import { useEffect, useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { autoFormatList, autoSizedPoints, backspaceList, contentBox, continueList, cssFont, shiftList, TEXT_LINE_HEIGHT, TEXT_PADDING, textColor, toggleList, type ListKind, type Markup, type MarkupStore, type Point, type TextEdit } from '@nb/markup';
import { settings, useSettings } from '../settings/settings';
import type { TileViewer } from '../viewer/TileViewer';

const MIN_EDIT_FONT_PX = 13;

interface Props {
  markup: Markup;
  store: MarkupStore;
  viewer: TileViewer;
  onDone: () => void;
}

/** Preferences › Markup › Auto-size Text Box and Call-out Markups: the box fitted to the new text. */
function fittedBox(m: Markup, text: string): { points?: Point[] } {
  if (!settings.get().autoSizeText || (m.type !== 'text' && m.type !== 'callout')) return {};
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = cssFont(m.style, m.style.fontSize ?? 12);
  const points = autoSizedPoints({ ...m, text }, (s) => ctx.measureText(s).width);
  return points ? { points } : {};
}

/** Typewriter text has no box to wrap in: the box is sized to fit the typed lines. */
function typewriterBox(m: Markup, text: string): [Point, Point] {
  const size = m.style.fontSize ?? 12;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = cssFont(m.style, size);
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), size) + TEXT_PADDING * 2;
  const h = lines.length * size * TEXT_LINE_HEIGHT + TEXT_PADDING * 2;
  const x = Math.min(m.points[0]![0], m.points[1]![0]);
  const y = Math.min(m.points[0]![1], m.points[1]![1]);
  return [
    [x, y],
    [x + w, y + h],
  ];
}

/**
 * Puts an edit into the textarea as typing, so Ctrl+Z undoes it. Only the span that differs is
 * replaced, which keeps the undo step small and the caret where the edit put it.
 */
function applyEdit(el: HTMLTextAreaElement, edit: TextEdit) {
  const old = el.value;
  const max = Math.min(old.length, edit.text.length);
  let head = 0;
  while (head < max && old[head] === edit.text[head]) head++;
  let tail = 0;
  while (tail < max - head && old[old.length - 1 - tail] === edit.text[edit.text.length - 1 - tail]) tail++;
  el.setSelectionRange(head, old.length - tail);
  const insert = edit.text.slice(head, edit.text.length - tail);
  const typed = insert ? document.execCommand('insertText', false, insert) : old.length - tail > head ? document.execCommand('delete') : true;
  // Where the browser will not type for us, set the value (and lose the undo step).
  if (!typed || el.value !== edit.text) el.value = edit.text;
  el.setSelectionRange(edit.start, edit.end);
}

const LIST_BUTTONS: { kind: ListKind; label: string; title: string }[] = [
  { kind: 'bullet', label: '•', title: 'Bulleted list (Ctrl+Shift+8)' },
  { kind: 'number', label: '1.', title: 'Numbered list (Ctrl+Shift+7)' },
  { kind: 'letter', label: 'a.', title: 'Lettered list' },
  { kind: 'roman', label: 'i.', title: 'Roman numeral list' },
  { kind: 'check', label: '☐', title: 'Checklist (Ctrl+Shift+9)' },
];

/** In-place editor positioned over a text box markup. Commits on blur; Esc cancels. */
export function TextEditor({ markup, store, viewer, onDone }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  /** Set while our own edit is being typed in, so it does not trigger auto-format again. */
  const applying = useRef(false);
  const { spellCheck } = useSettings();

  /** Runs a list operation on the text and selection; false (and nothing changed) when it does not apply. */
  const edit = (op: (text: string, start: number, end: number) => TextEdit | null): boolean => {
    const el = ref.current;
    if (!el) return false;
    const result = op(el.value, el.selectionStart, el.selectionEnd);
    if (!result) return false;
    applying.current = true;
    try {
      applyEdit(el, result);
    } finally {
      applying.current = false;
    }
    return true;
  };

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const box = contentBox(markup);
  const [x0, y0] = viewer.pageToClient([box.x, box.y], markup.pageIndex);
  const fontSize = markup.style.fontSize ?? 12;
  // When zoomed out, enlarge the editor so the text being typed stays readable.
  const scale = Math.max(viewer.zoomFor(markup.pageIndex), MIN_EDIT_FONT_PX / fontSize);
  const typewriter = markup.type === 'typewriter';
  // Typewriter text grows as it is typed, so give the editor room to the right.
  const width = Math.max(box.w * scale, typewriter ? 320 : 0);
  const height = Math.max(box.h * scale, typewriter ? fontSize * scale * 3 : 0);

  const finish = () => {
    const text = ref.current?.value ?? '';
    if (!cancelled.current && text !== (markup.text ?? '')) store.update(markup.id, typewriter ? { text, points: typewriterBox(markup, text) } : { text, ...fittedBox(markup, text) });
    // A text box that never received text is removed rather than left empty.
    if ((cancelled.current ? markup.text ?? '' : text).trim() === '') store.remove([markup.id]);
    onDone();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      cancelled.current = true;
      e.currentTarget.blur();
    } else if (e.key === 'Enter' && mod) {
      e.currentTarget.blur();
    } else if (e.nativeEvent.isComposing) {
      return;
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      if (edit(continueList)) e.preventDefault();
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
  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const typed = e.nativeEvent as InputEvent;
    if (applying.current || typed.isComposing || typed.inputType !== 'insertText' || typed.data !== ' ') return;
    const el = e.currentTarget;
    if (el.selectionStart === el.selectionEnd) edit((t, caret) => autoFormatList(t, caret));
  };

  // The bar sits above the editor, or below it where there is no room above.
  const barTop = y0 >= 34 ? y0 - 30 : y0 + height + 4;

  return (
    <>
      <div className="text-editor-bar" style={{ left: x0, top: barTop }} role="toolbar" aria-label="List formatting" onMouseDown={(e) => e.preventDefault()}>
        {LIST_BUTTONS.map((b) => (
          <button key={b.kind} type="button" title={b.title} aria-label={b.title} onClick={() => edit((t, a, z) => toggleList(t, a, z, b.kind))}>
            {b.label}
          </button>
        ))}
        <span className="sep" />
        <button type="button" title="Decrease list level (Shift+Tab)" aria-label="Decrease list level" onClick={() => edit((t, a, z) => shiftList(t, a, z, -1))}>
          ⇤
        </button>
        <button type="button" title="Increase list level (Tab)" aria-label="Increase list level" onClick={() => edit((t, a, z) => shiftList(t, a, z, 1))}>
          ⇥
        </button>
      </div>
      <textarea
        spellCheck={spellCheck}
        ref={ref}
        className="text-editor"
        defaultValue={markup.text ?? ''}
        wrap={typewriter ? 'off' : 'soft'}
        style={{
          left: x0,
          top: y0,
          width,
          height,
          font: cssFont(markup.style, fontSize * scale),
          lineHeight: 1.2,
          textAlign: markup.style.textAlign ?? 'left',
          textDecoration: markup.style.underline ? 'underline' : undefined,
          padding: 4 * scale,
          color: textColor(markup.style),
        }}
        onBlur={finish}
        onKeyDown={onKeyDown}
        onInput={onInput}
      />
    </>
  );
}
