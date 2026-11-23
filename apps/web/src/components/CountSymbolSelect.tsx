import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { COUNT_SHAPE_OPTIONS, documentCountSymbols, sameCountSymbol, type CountShape, type CountSymbol, type Markup, type MarkupStyle } from '@nb/markup';
import { countSymbolLibrary, useWorkspace } from '../workspace/profiles';
import { openCountSymbols } from './CountSymbolsDialog';
import { CountSymbolSwatch } from './CountSymbolSwatch';
import './lineStyleSelect.css';

interface Props {
  style: MarkupStyle;
  /** The open document's markups, so imported custom count symbols also appear in the list. */
  markups: readonly Markup[];
  onChange: (patch: Partial<MarkupStyle>) => void;
  /** Selected counts have different shapes or symbols. */
  mixed?: boolean;
  disabled?: boolean;
}

interface Item {
  value: string;
  label: string;
  shape?: CountShape;
  symbol?: CountSymbol;
  group?: string;
}

/**
 * Count marker shape & custom symbol picker: lists the 6 standard shapes, custom symbols present
 * in the current PDF, the user's saved symbols, and a Manage symbols… action.
 */
export function CountSymbolSelect({ style, markups, onChange, mixed, disabled }: Props) {
  const ws = useWorkspace();
  const saved = useMemo(() => countSymbolLibrary(ws), [ws]);
  const inDocument = useMemo(() => documentCountSymbols(markups, saved), [markups, saved]);

  const currentSymbol = style.countSymbol;
  let value = currentSymbol ? 'custom' : `shape:${style.countShape ?? 'circle'}`;
  if (currentSymbol) {
    const savedIdx = saved.findIndex((s) => sameCountSymbol(s, currentSymbol));
    if (savedIdx >= 0) value = `saved:${savedIdx}`;
    else {
      const docIdx = inDocument.findIndex((s) => sameCountSymbol(s, currentSymbol));
      if (docIdx >= 0) value = `doc:${docIdx}`;
    }
  }
  const selected = mixed ? '' : value;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (value === 'custom' && currentSymbol && !mixed) {
      out.push({ value: 'custom', label: currentSymbol.name || 'Custom', symbol: currentSymbol });
    }
    COUNT_SHAPE_OPTIONS.forEach((opt) => out.push({ value: `shape:${opt.value}`, label: opt.label, shape: opt.value }));
    inDocument.forEach((s, i) => out.push({ value: `doc:${i}`, label: s.name || 'Custom', symbol: s, group: 'In this document' }));
    saved.forEach((s, i) => out.push({ value: `saved:${i}`, label: s.name, symbol: s, group: 'Saved symbols' }));
    out.push({ value: 'manage', label: 'Manage symbols…', group: 'Actions' });
    return out;
  }, [value, currentSymbol, mixed, inDocument, saved]);

  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: 300 });

  const selectedIndex = items.findIndex((it) => it.value === selected);

  const pick = (item: Item) => {
    setOpen(false);
    if (item.value === 'custom') return;
    if (item.value === 'manage') {
      openCountSymbols();
      return;
    }
    if (item.shape) {
      onChange({ countShape: item.shape === 'circle' ? undefined : item.shape, countSymbol: undefined });
      return;
    }
    if (item.symbol) {
      onChange({ countShape: undefined, countSymbol: structuredClone(item.symbol) });
    }
  };

  const openList = (at = selectedIndex) => {
    if (disabled) return;
    setActive(at >= 0 ? at : 0);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const flip = below < 200 && above > below;
    setBox({
      left: Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 210) - 4)),
      top: flip ? undefined : r.bottom + 2,
      bottom: flip ? window.innerHeight - r.top + 2 : undefined,
      width: Math.max(r.width, 210),
      maxHeight: Math.min(340, flip ? above : below),
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

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const it = items[active];
      if (it) pick(it);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const shown = items[selectedIndex];
  const swatchStyle = { stroke: style.stroke, fill: style.fill, fillOpacity: style.fillOpacity, width: style.width };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label="Marker shape"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        disabled={disabled}
        className="ls-select"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {mixed ? (
          <span className="ls-name">Mixed</span>
        ) : (
          <>
            <CountSymbolSwatch shape={shown?.shape ?? style.countShape ?? 'circle'} symbol={shown?.symbol ?? currentSymbol} style={swatchStyle} size={16} />
            <span className="ls-name">{shown?.label ?? 'Circle'}</span>
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Marker shape"
            className="ls-list"
            style={{ left: box.left, top: box.top, bottom: box.bottom, width: box.width, maxHeight: box.maxHeight }}
          >
            {items.map((item, i) => {
              const prev = items[i - 1];
              const showGroup = item.group && item.group !== prev?.group && item.value !== 'manage';
              return (
                <div key={item.value}>
                  {showGroup && <div className="ls-group">{item.group}</div>}
                  <div
                    id={optionId(i)}
                    role="option"
                    aria-selected={item.value === selected}
                    className={`ls-option${i === active ? ' active' : ''}${item.value === 'manage' ? ' manage' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(item);
                    }}
                  >
                    {item.value !== 'manage' && <CountSymbolSwatch shape={item.shape} symbol={item.symbol} style={swatchStyle} size={18} />}
                    <span className="ls-name">{item.label}</span>
                  </div>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
