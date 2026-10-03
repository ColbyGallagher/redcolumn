import { useEffect, useRef } from 'react';
import { contentBox, cssFont, TEXT_LINE_HEIGHT, TEXT_PADDING, textColor, type Markup, type MarkupStore, type Point } from '@nb/markup';
import type { TileViewer } from '../viewer/TileViewer';

const MIN_EDIT_FONT_PX = 13;

interface Props {
  markup: Markup;
  store: MarkupStore;
  viewer: TileViewer;
  onDone: () => void;
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

/** In-place editor positioned over a text box markup. Commits on blur; Esc cancels. */
export function TextEditor({ markup, store, viewer, onDone }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);

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
    if (!cancelled.current && text !== (markup.text ?? '')) store.update(markup.id, typewriter ? { text, points: typewriterBox(markup, text) } : { text });
    // A text box that never received text is removed rather than left empty.
    if ((cancelled.current ? markup.text ?? '' : text).trim() === '') store.remove([markup.id]);
    onDone();
  };

  return (
    <textarea
      spellCheck
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
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
