import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { documentLineStyles, LINE_DASHES, type CustomLine, type LineDash, type Markup, type MarkupStyle } from '@nb/markup';
import { lineSetLibrary, useWorkspace } from '../workspace/profiles';
import { openLineStyles } from './LineStylesDialog';
import { LineStyleSwatch } from './LineStyleSwatch';
import { swatchKey } from './swatchGeometry';
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
  /** The swatch's cache key, made once when the item is. */
  swatchId?: string;
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
    out.push({ value: 'manage', label: 'Manage line styles…', group: 'Actions' });
    out.forEach((it) => {
      if (it.swatch) it.swatchId = swatchKey(it.swatch);
    });
    return out;
  }, [value, mixed, style.lineStyle, style.dashArray, inDocument, sets]);

  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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
    // Scrolling anything behind the list moves the button out from under it; the list's own scrolling stays.
    const scrolled = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [open]);

  const move = (i: number) => setActive(Math.max(0, Math.min(items.length - 1, i)));

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    // Keys the picker uses are its own: the app's shortcuts (L for Line, Space to finish a measurement) must not see them.
    if (k !== 'Tab' && !(k === 'Escape' && !open)) e.stopPropagation();
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
  const valueText = mixed ? 'Mixed' : (shown?.label ?? '');

  // The option rows never change with the hovered or active row, only the two that do re-render.
  const latest = useRef({ pick, items });
  latest.current = { pick, items };
  const onPick = useCallback((i: number) => latest.current.pick(latest.current.items[i]!), []);
  const onHover = useCallback((i: number) => setActive(i), []);

  // Runs of items under one heading: a group in the listbox, so a screen reader announces where it is.
  const runs: { group?: string; rows: number[] }[] = [];
  items.forEach((it, i) => {
    const last = runs[runs.length - 1];
    if (last && last.group === it.group) last.rows.push(i);
    else runs.push({ group: it.group, rows: [i] });
  });
  const row = (i: number) => (
    <Option key={items[i]!.value} item={items[i]!} id={optionId(i)} index={i} active={i === active} selected={items[i]!.value === selected} onHover={onHover} onPick={onPick} />
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ls-select"
        role="combobox"
        aria-labelledby={`${uid}-label ${uid}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        title={valueText || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span id={`${uid}-label`} className="ls-sr">
          Line style
        </span>
        {shown?.swatch && !mixed && <LineStyleSwatch spec={shown.swatch} id={shown.swatchId!} />}
        <span id={`${uid}-value`} className="ls-name">
          {valueText}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Line styles"
            className="ls-list"
            style={{ left: box.left, top: box.top, bottom: box.bottom, width: box.width, maxHeight: box.maxHeight }}
            // Clicking an option must not take focus off the picker.
            onMouseDown={(e) => e.preventDefault()}
          >
            {runs.map((run, ri) =>
              run.group ? (
                <div key={`${run.group}:${ri}`} role="group" aria-label={run.group}>
                  <div className="ls-group" aria-hidden="true">
                    {run.group}
                  </div>
                  {run.rows.map(row)}
                </div>
              ) : (
                run.rows.map(row)
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

interface OptionProps {
  item: Item;
  id: string;
  index: number;
  active: boolean;
  selected: boolean;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
}

const Option = memo(function Option({ item, id, index, active, selected, onHover, onPick }: OptionProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-value={item.value}
      className={`ls-option${active ? ' active' : ''}${item.value === 'manage' ? ' manage' : ''}`}
      onMouseMove={() => !active && onHover(index)}
      onClick={() => onPick(index)}
    >
      {item.swatch && <LineStyleSwatch spec={item.swatch} id={item.swatchId!} />}
      <span className="ls-name">{item.label}</span>
    </div>
  );
});

