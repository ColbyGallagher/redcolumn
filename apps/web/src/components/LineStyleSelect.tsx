import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { documentLineStyles, LINE_DASHES, type CustomLine, type LineDash, type Markup, type MarkupStyle } from '@nb/markup';
import { lineSetLibrary, useWorkspace } from '../workspace/profiles';
import { openLineStyles } from './LineStylesDialog';
import { LineStyleSwatch } from './LineStyleSwatch';
import type { SwatchSpec } from './swatchGeometry';
import './lineStyleSelect.css';

interface Props {
  style: MarkupStyle;
  /** The open document's markups, whose own line styles are offered beside the sets. */
  markups: readonly Markup[];
  onChange: (patch: Partial<MarkupStyle>) => void;
  /** The selected markups have different line styles: nothing is shown as picked. */
  mixed?: boolean;
}

interface Item {
  /** 'custom' (the current unlisted style), 'manage', a plain dash, 'line:<set>:<style>' or 'doc:<style>'. */
  value: string;
  label: string;
  swatch?: SwatchSpec;
  /** The heading it is listed under. */
  group?: string;
}

const sameLine = (a: CustomLine, b: CustomLine) => a.name === b.name && JSON.stringify(a.spec) === JSON.stringify(b.spec);

/**
 * The Line style picker: plain dashes, the built-in and imported line style sets, and the custom
 * styles a Revu document brings with it, each drawn beside its name. A style's own pick shows as
 * selected wherever it is listed.
 */
export function LineStyleSelect({ style, markups, onChange, mixed }: Props) {
  const ws = useWorkspace();
  const sets = useMemo(() => lineSetLibrary(ws), [ws]);
  const inDocument = useMemo(() => documentLineStyles(markups, sets.flatMap((s) => s.styles)), [markups, sets]);

  const current = style.lineStyle;
  let value = current || style.dashArray ? 'custom' : (style.dash ?? 'solid');
  if (current) {
    sets.forEach((set, si) =>
      set.styles.forEach((l, li) => {
        if (sameLine(l, current)) value = `line:${si}:${li}`;
      }),
    );
    inDocument.forEach((l, i) => {
      if (sameLine(l, current)) value = `doc:${i}`;
    });
  }
  const selected = mixed ? '' : value;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (value === 'custom' && !mixed) {
      out.push({
        value: 'custom',
        label: style.lineStyle ? style.lineStyle.name || 'Custom' : `Custom (${style.dashArray!.map((n) => Math.round(n * 100) / 100).join(' ')})`,
        swatch: style.lineStyle ? { line: style.lineStyle } : { dashArray: style.dashArray },
      });
    }
    LINE_DASHES.forEach((d) => out.push({ value: d.value, label: d.label, swatch: { dash: d.value } }));
    inDocument.forEach((l, i) => out.push({ value: `doc:${i}`, label: l.name || 'Custom', swatch: { line: l }, group: 'In this document' }));
    sets.forEach((set, si) => set.styles.forEach((l, li) => out.push({ value: `line:${si}:${li}`, label: l.name, swatch: { line: l }, group: set.title })));
    out.push({ value: 'manage', label: 'Manage line styles…' });
    return out;
  }, [value, mixed, style.lineStyle, style.dashArray, inDocument, sets]);

  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: 300 });

  const selectedIndex = items.findIndex((it) => it.value === selected);

  const pick = (item: Item) => {
    setOpen(false);
    const v = item.value;
    if (v === 'custom') return;
    // Nothing is picked by opening the manager: the picker keeps showing the current style.
    if (v === 'manage') {
      openLineStyles();
      return;
    }
    // A style from a line set ('line:<set>:<style>') or from the document ('doc:<style>').
    const [kind, a, b] = v.split(':');
    const picked = kind === 'line' ? sets[Number(a)]?.styles[Number(b)] : kind === 'doc' ? inDocument[Number(a)] : undefined;
    if (picked) onChange({ lineStyle: structuredClone(picked), dash: undefined, dashArray: undefined });
    // A plain style replaces a custom (Bluebeam) one.
    else onChange({ dash: v === 'solid' ? undefined : (v as LineDash), dashArray: undefined, lineStyle: undefined });
  };

  const openList = (at = selectedIndex) => {
    setActive(at >= 0 ? at : 0);
    setOpen(true);
  };

  // Place the list under the button (above it when there is no room below).
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const flip = below < 200 && above > below;
    setBox({
      left: Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 240) - 4)),
      top: flip ? undefined : r.bottom + 2,
      bottom: flip ? window.innerHeight - r.top + 2 : undefined,
      width: Math.max(r.width, 240),
      maxHeight: Math.min(360, flip ? above : below),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const move = (i: number) => setActive(Math.max(0, Math.min(items.length - 1, i)));

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      if (!open) openList(k === 'ArrowDown' && selectedIndex < 0 ? 0 : selectedIndex);
      else move(active + (k === 'ArrowDown' ? 1 : -1));
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      if (!open) openList();
      move(k === 'Home' ? 0 : items.length - 1);
    } else if (k === 'Enter' || k === ' ') {
      // Space keeps feeding a type-ahead word that has begun.
      if (k === ' ' && open && typed.current.text && Date.now() - typed.current.at < 700) return typeAhead(' ', e);
      e.preventDefault();
      if (!open) openList();
      else pick(items[active]!);
    } else if (k === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    } else if (k === 'Tab') {
      setOpen(false);
    } else if (k.length === 1) {
      typeAhead(k, e);
    }
  };

  const typeAhead = (ch: string, e: KeyboardEvent) => {
    e.preventDefault();
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 700 ? ch : t.text + ch;
    t.at = now;
    const word = t.text.toLowerCase();
    const from = open ? active : selectedIndex;
    // One letter (or the same letter again) steps on to the next name beginning with it; a longer word narrows from here.
    const repeated = word.length > 1 && [...word].every((c) => c === word[0]);
    const needle = repeated ? word[0]! : word;
    const start = word.length === 1 || repeated ? from + 1 : Math.max(from, 0);
    let hit: number | undefined;
    for (let k = 0; k < items.length && hit === undefined; k++) {
      const i = (start + k) % items.length;
      if (items[i]!.label.toLowerCase().startsWith(needle)) hit = i;
    }
    if (hit === undefined) return;
    if (!open) openList(hit);
    setActive(hit);
  };

  const shown = selected === '' ? undefined : items[selectedIndex];

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ls-select"
        role="combobox"
        aria-label="Line style"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        {shown?.swatch && <LineStyleSwatch spec={shown.swatch} />}
        <span className="ls-name">{mixed ? 'Mixed' : (shown?.label ?? '')}</span>
      </button>
      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Line styles"
            className="ls-list"
            style={{ left: box.left, top: box.top, bottom: box.bottom, width: box.width, maxHeight: box.maxHeight }}
            // Clicking an option must not take focus off the picker.
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.map((item, i) => {
              const heading = item.group !== lastGroup && item.group ? item.group : undefined;
              lastGroup = item.group;
              return (
                <li key={item.value} role="presentation">
                  {heading && (
                    <div className="ls-group" role="presentation">
                      {heading}
                    </div>
                  )}
                  <div
                    id={optionId(i)}
                    role="option"
                    aria-selected={item.value === selected}
                    data-value={item.value}
                    className={`ls-option${i === active ? ' active' : ''}${item.value === 'manage' ? ' manage' : ''}`}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => pick(item)}
                  >
                    {item.swatch && <LineStyleSwatch spec={item.swatch} />}
                    <span className="ls-name">{item.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
