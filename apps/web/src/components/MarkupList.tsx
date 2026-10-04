import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { isMeasureKind, isTextType, MARKUP_LABELS, measureProps, type ColumnSet, type CustomColumn, type Markup, type MarkupStore } from '@nb/markup';
import { DEFAULT_SCALE, formatMeasure, measureValue, type MeasureKind, type Scale } from '@nb/measure';
import type { SheetInfo } from '@nb/sheets';
import {
  buildRows,
  formatNumber,
  groupRows,
  listColumns,
  missingRequired,
  resolveLayout,
  type CellContext,
  type ColumnLayout,
  type ListColumn,
  type ListRowData,
} from '../columns/listColumns';
import { updateWorkspace, useWorkspace, type MarkupListSettings } from '../workspace/profiles';
import { askText } from './AskText';
import { settings as settingsStore, useSettings } from '../settings/settings';
import { ContextMenu, type ContextMenuState, type MenuEntry } from './ContextMenu';
import { FilterBuilderDialog } from './FilterBuilderDialog';

interface Props {
  markups: Markup[];
  store: MarkupStore | null;
  /** The scale each markup is measured at. */
  scaleOf: (m: Markup) => Scale;
  sheets: Readonly<Record<number, SheetInfo>>;
  columnSet: ColumnSet;
  readOnly: boolean;
  selected: ReadonlySet<string>;
  onSelect: (m: Markup, additive: boolean) => void;
  /** Right-click on a row (the App adds tool library and other actions). */
  onRowMenu: (m: Markup, x: number, y: number) => void;
  onManageColumns: () => void;
  onExport: (rows: ListRowData[], columns: ListColumn[]) => void;
  /** The markups the filter keeps (null when not filtering), so the page can dim or hide the rest. */
  onFiltered?: (kept: ReadonlySet<string> | null) => void;
}

const MIN_WIDTH = 40;
/** Lists longer than this render only the rows in view (plus OVERSCAN either side). */
const WINDOW_FROM = 300;
const OVERSCAN = 20;
/** The window moves in steps of this many rows, so scrolling re-renders the list only now and then. */
const WINDOW_STEP = 10;
/** Row height until the first row is measured. */
const ROW_GUESS = 30;

/** A row of the list body: a group header, a markup, or a reply under its markup. */
type Line = { kind: 'group'; label: string; count: number } | { kind: 'markup'; row: ListRowData } | { kind: 'reply'; m: Markup; reply: NonNullable<Markup['replies']>[number] };

/**
 * A comment cell. Wrapped, it shows the whole comment and the row grows to fit; unwrapped it is one
 * line high like every row, and grows with its text over the rows below while being edited. Enter
 * adds a line; Ctrl+Enter or leaving the cell saves.
 */
function CommentCell({ value, disabled, wrap, onSave }: { value: string; disabled: boolean; wrap: boolean; onSave: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    // Wrapped, a hidden copy of the text behind the textarea sizes the cell (see the CSS).
    if (wrap) {
      el.parentElement!.dataset.text = `${el.value} `;
      return;
    }
    if (document.activeElement !== el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(fit, [value, wrap]);
  const textarea = (
    <textarea
      ref={ref}
      className="cell-comment"
      rows={1}
      defaultValue={value}
      disabled={disabled}
      placeholder="Add comment"
      onClick={(e) => e.stopPropagation()}
      onFocus={fit}
      onInput={fit}
      onBlur={(e) => {
        if (!wrap) e.target.style.height = '';
        if (e.target.value !== value) onSave(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.blur();
        else if (e.key === 'Escape') {
          e.currentTarget.value = value;
          fit();
          e.currentTarget.blur();
        }
      }}
    />
  );
  return wrap ? (
    <div className="comment-wrap" data-text={`${value} `}>
      {textarea}
    </div>
  ) : (
    textarea
  );
}

/** A list line's React key, also used to keep its measured height. */
const lineKey = (l: Line) => (l.kind === 'group' ? `group:${l.label}` : l.kind === 'reply' ? `${l.m.id}:${l.reply.id}` : l.row.markup.id);

const editList = (fn: (l: MarkupListSettings) => MarkupListSettings) => updateWorkspace((s) => ({ ...s, list: fn(s.list) }));

/**
 * The Markups list: every markup with its columns, including the document's custom
 * columns. Columns can be resized (drag a header edge), sorted (click a header), reordered (drag a
 * header), shown or hidden (right-click a header), and filtered (the filter row); filters can be
 * saved by name and are kept in the profile.
 */
export const MarkupList = memo(function MarkupList(props: Props) {
  const { markups: allMarkups, store, scaleOf, sheets, columnSet, readOnly, selected, onSelect, onRowMenu, onManageColumns, onExport } = props;
  const prefs = useSettings();
  const ws = useWorkspace();
  const settings = ws.list;
  // Spaces are regions markups belong to, listed on the Spaces panel rather than here.
  const markups = useMemo(() => allMarkups.filter((m) => m.type !== 'space'), [allMarkups]);
  const spaces = useMemo(() => allMarkups.filter((m) => m.type === 'space'), [allMarkups]);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<{ key: string; after: boolean } | null>(null);
  const resizing = useRef(false);
  const body = useRef<HTMLTableSectionElement>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  /** Groups folded shut, by label. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (label: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const closeMenu = useCallback(() => setMenu(null), []);

  const all = useMemo(() => listColumns(columnSet.columns), [columnSet.columns]);
  const layout = useMemo(() => resolveLayout(settings.columns, all), [settings.columns, all]);
  const visible = layout.filter((c) => !c.hidden);
  const ctx: CellContext = useMemo(
    () => ({ scaleOf, sheets, statuses: columnSet.statuses, columns: columnSet.columns, spaces }),
    [scaleOf, sheets, columnSet, spaces],
  );
  // Filters on columns this document does not have (another document's custom columns) are ignored.
  const filters = useMemo(() => {
    const keys = new Set(all.map((c) => c.key));
    return Object.fromEntries(Object.entries(settings.filters).filter(([k, v]) => keys.has(k) && v.trim()));
  }, [settings.filters, all]);
  const sort = settings.sort && all.some((c) => c.key === settings.sort!.key) ? settings.sort : null;
  const advanced = settings.advanced;
  const rows = useMemo(() => buildRows(markups, ctx, filters, sort, advanced), [markups, ctx, filters, sort, advanced]);
  const groupBy = settings.groupBy && all.some((c) => c.key === settings.groupBy) ? settings.groupBy : null;
  const groups = useMemo(() => (groupBy ? groupRows(rows, groupBy) : [{ label: '', rows }]), [rows, groupBy]);
  const missingCount = useMemo(() => markups.filter((m) => missingRequired(m, columnSet.columns).length).length, [markups, columnSet.columns]);
  const advancedOn = !!advanced?.rules.length;
  const filtering = Object.keys(filters).length > 0 || advancedOn;
  const onFiltered = props.onFiltered;
  useEffect(() => {
    onFiltered?.(filtering ? new Set(rows.map((r) => r.markup.id)) : null);
  }, [rows, filtering, onFiltered]);
  const activeSaved = settings.savedFilters.find((f) => JSON.stringify(f.filters) === JSON.stringify(settings.filters)) ?? null;

  const lines = useMemo(() => {
    const out: Line[] = [];
    for (const { label, rows: list } of groups) {
      if (groupBy) out.push({ kind: 'group', label, count: list.length });
      if (groupBy && folded.has(label)) continue;
      for (const row of list) {
        out.push({ kind: 'markup', row });
        for (const reply of row.markup.replies ?? []) out.push({ kind: 'reply', m: row.markup, reply });
      }
    }
    return out;
  }, [groups, groupBy, folded]);

  // Unwrapped, every row is one fixed height (see the list's CSS), measured from the first markup
  // row. Wrapped, rows grow with their comments: each rendered row's height is measured and kept,
  // and rows not yet seen count as one line. Either way a long list renders just the rows in view,
  // with spacers standing in for the rest.
  const wrap = settings.wrapComments !== false && visible.some((c) => c.key === 'comment');
  const scroller = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(0);
  const h = rowH || ROW_GUESS;
  /** Measured heights of wrapped rows, by line key. */
  const heights = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    const rendered = [...(body.current?.querySelectorAll<HTMLElement>('tr[data-key]') ?? [])];
    if (!rowH) {
      // One line high: the shortest markup row (a wrapped first row may be several lines).
      const one = Math.min(...rendered.filter((tr) => tr.dataset.id && tr.offsetHeight).map((tr) => tr.offsetHeight));
      if (Number.isFinite(one)) setRowH(one);
    }
    if (!wrap) return;
    let changed = false;
    for (const tr of rendered) {
      const k = tr.dataset.key!;
      if (tr.offsetHeight && heights.current.get(k) !== tr.offsetHeight) {
        heights.current.set(k, tr.offsetHeight);
        changed = true;
      }
    }
    if (changed) setMeasured((n) => n + 1);
  });
  const keys = useMemo(() => lines.map(lineKey), [lines]);
  /** Top of each line (and the bottom of the last), from the top of the body. */
  const offsets = useMemo(() => {
    const out = new Array<number>(keys.length + 1);
    out[0] = 0;
    for (let i = 0; i < keys.length; i++) out[i + 1] = out[i]! + (wrap ? (heights.current.get(keys[i]!) ?? h) : h);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, wrap, h, measured]);
  /** The line at a distance from the top of the body. */
  const lineAt = (y: number) => {
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1]! <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const headHeight = () => body.current?.parentElement?.querySelector('thead')?.offsetHeight ?? 0;
  const [view, setView] = useState({ first: 0, count: 40 });
  const track = useRef(() => {});
  track.current = () => {
    const el = scroller.current;
    if (!el) return;
    const first = Math.floor(lineAt(el.scrollTop) / WINDOW_STEP) * WINDOW_STEP;
    const count = Math.ceil(el.clientHeight / h);
    setView((v) => (v.first === first && v.count === count ? v : { first, count }));
  };
  const hasList = markups.length > 0;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    track.current();
    const ro = new ResizeObserver(() => track.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasList]);
  const windowed = lines.length > WINDOW_FROM;
  useEffect(() => {
    if (windowed) track.current();
  }, [windowed, rowH, offsets]);
  const start = windowed ? Math.min(lines.length, Math.max(0, view.first - OVERSCAN)) : 0;
  const end = windowed ? Math.min(lines.length, view.first + view.count + WINDOW_STEP + OVERSCAN) : lines.length;

  // Markups selected on the page are scrolled into view here (unless a cell of one is being edited).
  const selectedKey = [...selected].join(',');
  useEffect(() => {
    const el = scroller.current;
    if (!selectedKey || !el) return;
    if ([...(body.current?.querySelectorAll('tr.selected') ?? [])].some((r) => r.contains(document.activeElement))) return;
    const index = lines.findIndex((l) => l.kind === 'markup' && selected.has(l.row.markup.id));
    if (index < 0) return;
    // Rows sit below the sticky header, which covers the top of the scrolled area.
    const top = offsets[index]!;
    const bottom = offsets[index + 1]!;
    const room = el.clientHeight - headHeight();
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + room) el.scrollTop = Math.min(top, bottom - room);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const saveLayout = (next: (ListColumn & ColumnLayout)[]) => editList((l) => ({ ...l, columns: next.map(({ key, width, hidden }) => ({ key, width, hidden })) }));
  const setHidden = (key: string, hidden: boolean) => saveLayout(layout.map((c) => (c.key === key ? { ...c, hidden } : c)));
  const setFilter = (key: string, value: string) => editList((l) => ({ ...l, filters: { ...l.filters, [key]: value } }));

  const sortBy = (key: string, dir?: 'asc' | 'desc' | null) =>
    editList((l) => {
      if (dir !== undefined) return { ...l, sort: dir ? { key, dir } : null };
      const cur = l.sort?.key === key ? l.sort.dir : null;
      return { ...l, sort: cur === null ? { key, dir: 'asc' } : cur === 'asc' ? { key, dir: 'desc' } : null };
    });

  const startResize = (e: ReactPointerEvent, col: ListColumn & ColumnLayout) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    const startX = e.clientX;
    const startW = col.width;
    const th = (e.currentTarget as HTMLElement).parentElement!;
    let width = startW;
    const move = (ev: PointerEvent) => {
      width = Math.max(MIN_WIDTH, startW + ev.clientX - startX);
      // Resize live without re-rendering the whole list; saved on release.
      const colEl = th.closest('table')?.querySelector<HTMLTableColElement>(`col[data-key="${CSS.escape(col.key)}"]`);
      if (colEl) colEl.style.width = `${width}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      saveLayout(layout.map((c) => (c.key === col.key ? { ...c, width } : c)));
      setTimeout(() => (resizing.current = false));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const columnsMenu = (): MenuEntry[] =>
    layout.map((c) => ({
      label: c.label + (c.custom ? ' ·' : ''),
      checked: !c.hidden,
      keepOpen: true,
      disabled: !c.hidden && visible.length <= 1,
      onClick: () => setHidden(c.key, !c.hidden),
    }));

  const headerMenu = (e: ReactMouseEvent, col: ListColumn) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Sort Ascending', checked: settings.sort?.key === col.key && settings.sort.dir === 'asc', onClick: () => sortBy(col.key, 'asc') },
        { label: 'Sort Descending', checked: settings.sort?.key === col.key && settings.sort.dir === 'desc', onClick: () => sortBy(col.key, 'desc') },
        { label: 'Clear Sort', disabled: !settings.sort, onClick: () => sortBy(col.key, null) },
        { sep: true },
        { label: `Hide "${col.label}"`, disabled: visible.length <= 1, onClick: () => setHidden(col.key, true) },
        { label: 'Columns', items: columnsMenu() },
        { label: 'Reset Column Layout', onClick: () => editList((l) => ({ ...l, columns: [] })) },
        { label: 'Wrap Comments', checked: settings.wrapComments !== false, onClick: () => editList((l) => ({ ...l, wrapComments: l.wrapComments === false })) },
        { sep: true },
        { label: 'Manage Custom Columns…', onClick: onManageColumns },
      ],
    });
  };

  const saveFilter = async () => {
    const name = await askText('Save Filter', activeSaved?.name ?? '', { label: 'Saved filters are kept in your profile and listed in the filter menu.', confirm: 'Save' });
    if (!name?.trim()) return;
    editList((l) => {
      const existing = l.savedFilters.find((f) => f.name.toLowerCase() === name.trim().toLowerCase());
      const filters = Object.fromEntries(Object.entries(l.filters).filter(([, v]) => v.trim()));
      return {
        ...l,
        savedFilters: existing
          ? l.savedFilters.map((f) => (f === existing ? { ...f, filters } : f))
          : [...l.savedFilters, { id: crypto.randomUUID(), name: name.trim(), filters }],
      };
    });
  };

  // Takeoff totals per measurement kind, summed in SI units so pages at different scales add up.
  const totals = useMemo(() => {
    const out = new Map<MeasureKind, { value: number; scale: Scale; n: number }>();
    for (const r of rows) {
      const m = r.markup;
      if (!isMeasureKind(m.type) || m.type === 'angle') continue;
      const scale = scaleOf(m);
      const t = out.get(m.type) ?? { value: 0, scale, n: 0 };
      t.value += measureValue(m.type, m.points, scale.metersPerPoint, measureProps(m));
      t.n++;
      out.set(m.type, t);
    }
    return out;
  }, [rows, scaleOf]);
  const sums = visible.filter((c) => c.custom && (c.custom.type === 'number' || c.custom.type === 'formula'));
  const sumOf = (key: string, decimals?: number) => {
    let s = 0;
    let any = false;
    for (const r of rows) {
      const n = r.cells[key]?.num;
      if (n != null && Number.isFinite(n)) {
        s += n;
        any = true;
      }
    }
    return any ? formatNumber(s, decimals) : '';
  };

  const editor = (m: Markup, col: ListColumn, missing: boolean) => {
    const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
    // Someone else's markup without the right to edit anyone's: only its status can change.
    const fixed = readOnly || (!!store && !store.mayEdit(m));
    const c = col.custom;
    if (col.key === 'status') {
      const def = columnSet.statuses.find((s) => s.id === m.status);
      return (
        <span className="status-cell">
          <span className="status-dot" style={{ background: m.status === 'none' ? 'transparent' : (def?.color ?? '#9aa1a9') }} />
          <select value={m.status} disabled={readOnly} onClick={stop} onChange={(e) => store?.update(m.id, { status: e.target.value })}>
            {columnSet.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === 'none' ? '—' : s.name}
              </option>
            ))}
            {!def && m.status !== 'none' && <option value={m.status}>{m.status}</option>}
          </select>
        </span>
      );
    }
    if (col.key === 'comment') {
      return (
        <CommentCell
          // Keyed by value so remote/undo changes replace the draft.
          key={`${m.comment ?? ''}|${m.text ?? ''}`}
          value={(isTextType(m.type) ? m.text : m.comment) ?? ''}
          disabled={isTextType(m.type) || fixed}
          wrap={wrap}
          onSave={(comment) => store?.update(m.id, { comment })}
        />
      );
    }
    if (col.key === 'subject') {
      return (
        <span className="subject-cell">
          <span className="swatch" style={{ background: m.style.stroke }} />
          <input
            key={m.subject ?? ''}
            className="bare"
            defaultValue={m.subject || MARKUP_LABELS[m.type]}
            disabled={fixed}
            title="Subject"
            onClick={stop}
            onBlur={(e) => {
              const v = e.target.value.trim();
              const next = v === MARKUP_LABELS[m.type] ? '' : v;
              if (next !== (m.subject ?? '')) store?.update(m.id, { subject: next || undefined });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </span>
      );
    }
    if (!c) return null;
    const raw = m.fields?.[c.id] ?? '';
    const commit = (v: string) => {
      if (v !== raw) store?.setField([m.id], c.id, v);
    };
    const cls = missing ? 'missing' : '';
    switch (c.type) {
      case 'formula':
        return null;
      case 'choice':
        return (
          <select className={cls} value={raw} disabled={fixed} onClick={stop} onChange={(e) => commit(e.target.value)}>
            <option value="">{c.required ? '— required —' : '—'}</option>
            {(c.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {raw && !(c.options ?? []).includes(raw) && <option value={raw}>{raw}</option>}
          </select>
        );
      case 'checkmark':
        return <input type="checkbox" className={cls} checked={raw === 'true'} disabled={fixed} onClick={stop} onChange={(e) => commit(e.target.checked ? 'true' : '')} />;
      case 'multiline':
        return (
          <textarea
            key={raw}
            className={`cell-multiline ${cls}`}
            rows={1}
            defaultValue={raw}
            disabled={fixed}
            placeholder={c.required ? 'Required' : ''}
            onClick={stop}
            onBlur={(e) => commit(e.target.value)}
          />
        );
      default:
        return (
          <input
            key={raw}
            className={cls}
            type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
            step="any"
            defaultValue={raw}
            disabled={fixed}
            placeholder={c.required ? 'Required' : ''}
            onClick={stop}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        );
    }
  };

  const filterInput = (col: ListColumn) => {
    const value = settings.filters[col.key] ?? '';
    const choices: string[] | null =
      col.key === 'status'
        ? columnSet.statuses.filter((s) => s.id !== 'none').map((s) => s.name)
        : col.key === 'type'
          ? [...new Set(markups.map((m) => MARKUP_LABELS[m.type]))]
          : col.key === 'author'
            ? [...new Set(markups.map((m) => m.author))]
            : col.custom?.type === 'choice'
              ? (col.custom.options ?? [])
              : null;
    if (choices) {
      return (
        <select value={value} onChange={(e) => setFilter(col.key, e.target.value)} className={value ? 'on' : ''}>
          <option value="">All</option>
          {choices.map((o) => (
            <option key={o} value={`=${o}`}>
              {o}
            </option>
          ))}
          <option value="(blank)">(blank)</option>
          <option value="(not blank)">(not blank)</option>
          {value && !['(blank)', '(not blank)'].includes(value) && !choices.some((o) => `=${o}` === value) && <option value={value}>{value}</option>}
        </select>
      );
    }
    return (
      <input
        className={value ? 'on' : ''}
        value={value}
        placeholder={col.align === 'right' ? '>10, <5, =3' : 'Filter'}
        title="Type text to match. !text excludes, =text is exact, >10 or <=5 compare numbers, (blank) finds empty cells."
        onChange={(e) => setFilter(col.key, e.target.value)}
      />
    );
  };

  return (
    <div className="markups">
      <div className="markups-bar">
        <span className="markups-title">
          Markups <span className="count">{filtering ? `${rows.length} of ${markups.length}` : markups.length}</span>
        </span>
        {missingCount > 0 && (
          <button
            className="badge-warn"
            title="Markups missing a value in a required column. Click to show them."
            onClick={() => {
              const req = columnSet.columns.find((c) => c.required && c.type !== 'formula');
              if (req) editList((l) => ({ ...l, showFilterRow: true, filters: { [`custom:${req.id}`]: '(blank)' } }));
            }}
          >
            ⚠ {missingCount} missing required
          </button>
        )}
        <span className="grow" />
        <button className={`btn small flat${settings.showFilterRow ? ' active' : ''}`} onClick={() => editList((l) => ({ ...l, showFilterRow: !l.showFilterRow }))} title="Show the filter row">
          ⏷ Filter{filtering ? ' •' : ''}
        </button>
        <select
          className="saved-filters"
          value={activeSaved?.id ?? (filtering ? 'custom' : '')}
          title="Saved filters"
          onChange={(e) => {
            const f = settings.savedFilters.find((x) => x.id === e.target.value);
            editList((l) => ({ ...l, filters: f ? { ...f.filters } : {}, showFilterRow: f ? true : l.showFilterRow }));
          }}
        >
          <option value="">All markups</option>
          {filtering && !activeSaved && (
            <option value="custom" disabled>
              Custom filter
            </option>
          )}
          {settings.savedFilters.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button className="btn small flat" disabled={!filtering} onClick={() => void saveFilter()} title="Save the current filter by name">
          Save filter
        </button>
        {activeSaved && (
          <button
            className="btn small flat"
            title={`Delete the saved filter "${activeSaved.name}"`}
            onClick={() => editList((l) => ({ ...l, savedFilters: l.savedFilters.filter((f) => f.id !== activeSaved.id) }))}
          >
            Delete filter
          </button>
        )}
        <button className={`btn small flat${advancedOn ? ' active' : ''}`} onClick={() => setBuilderOpen(true)} title="Conditions on any columns, matching all or any of them">
          Filter Builder{advancedOn ? ` (${advanced!.rules.length})` : ''}…
        </button>
        <button className="btn small flat" disabled={!filtering} onClick={() => editList((l) => ({ ...l, filters: {}, advanced: null }))} title="Show all markups">
          Clear
        </button>
        <label className="group-by" title="How the page shows markups the filter leaves out">
          On page
          <select value={prefs.filteredMarkups} onChange={(e) => settingsStore.set({ filteredMarkups: e.target.value as 'show' | 'dim' | 'hide' })}>
            <option value="show">Show all</option>
            <option value="dim">Dim filtered out</option>
            <option value="hide">Hide filtered out</option>
          </select>
        </label>
        <label className="group-by" title="Group the list by a column">
          Group
          <select value={groupBy ?? ''} onChange={(e) => editList((l) => ({ ...l, groupBy: e.target.value || null }))}>
            <option value="">None</option>
            {all.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <span className="sep" />
        <button className="btn small flat" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items: [...columnsMenu(), { sep: true }, { label: 'Reset Column Layout', onClick: () => editList((l) => ({ ...l, columns: [] })) }] })} title="Show or hide columns">
          Columns ▾
        </button>
        <button className="btn small flat" onClick={onManageColumns} title="Add custom columns and statuses">
          Manage Columns…
        </button>
        <button className="btn small" disabled={!markups.length} onClick={() => onExport(rows, visible)} title="Export as CSV or a PDF summary">
          Export…
        </button>
      </div>
      {markups.length === 0 ? (
        <p className="empty">Markups and measurements you draw appear here.</p>
      ) : (
        <div className="markups-scroll" ref={scroller} onScroll={windowed ? () => track.current() : undefined}>
          <table className={wrap ? 'wrapped' : undefined} style={{ width: visible.reduce((s, c) => s + c.width, 0), ...(rowH && !wrap ? { '--list-row-h': `${rowH}px` } : {}) }}>
            <colgroup>
              {visible.map((c) => (
                <col key={c.key} data-key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {visible.map((c) => {
                  const sorted = settings.sort?.key === c.key ? settings.sort.dir : null;
                  const drop = dropKey?.key === c.key ? (dropKey.after ? ' drop-after' : ' drop-before') : '';
                  return (
                    <th
                      key={c.key}
                      className={`${c.align === 'right' ? 'num' : ''}${dragKey === c.key ? ' dragging' : ''}${drop}`}
                      draggable
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                      title={`${c.label}${c.custom?.required ? ' (required)' : ''} — click to sort, drag to reorder, right-click for options`}
                      onClick={() => {
                        if (!resizing.current) sortBy(c.key);
                      }}
                      onContextMenu={(e) => headerMenu(e, c)}
                      onDragStart={(e) => {
                        setDragKey(c.key);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', c.key);
                      }}
                      onDragEnd={() => {
                        setDragKey(null);
                        setDropKey(null);
                      }}
                      onDragOver={(e) => {
                        if (!dragKey || dragKey === c.key) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        setDropKey({ key: c.key, after: e.clientX > r.left + r.width / 2 });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!dragKey || !dropKey) return;
                        const moving = layout.find((x) => x.key === dragKey)!;
                        const rest = layout.filter((x) => x.key !== dragKey);
                        const at = rest.findIndex((x) => x.key === dropKey.key) + (dropKey.after ? 1 : 0);
                        saveLayout([...rest.slice(0, at), moving, ...rest.slice(at)]);
                        setDragKey(null);
                        setDropKey(null);
                      }}
                    >
                      <span className="th-label">
                        {c.label}
                        {c.custom?.required && <span className="req">*</span>}
                        {c.custom?.type === 'formula' && <span className="fx">ƒx</span>}
                      </span>
                      {sorted && <span className="sort">{sorted === 'asc' ? '▲' : '▼'}</span>}
                      <span className="col-resize" onPointerDown={(e) => startResize(e, c)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => {
                        e.stopPropagation();
                        saveLayout(layout.map((x) => (x.key === c.key ? { ...x, width: x.defaultWidth } : x)));
                      }} />
                    </th>
                  );
                })}
              </tr>
              {settings.showFilterRow && (
                <tr className="filter-row">
                  {visible.map((c) => (
                    <th key={c.key}>{filterInput(c)}</th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody ref={body}>
              {start > 0 && (
                <tr className="spacer" style={{ height: offsets[start] }}>
                  <td colSpan={visible.length} />
                </tr>
              )}
              {lines.slice(start, end).map((line) => {
                if (line.kind === 'group') {
                  const { label } = line;
                  return (
                    <tr key={`group:${label}`} data-key={`group:${label}`} className="group-row" onClick={() => toggleFold(label)}>
                      <td colSpan={visible.length}>
                        <span className="fold">{folded.has(label) ? '▸' : '▾'}</span> {label} <span className="count">{line.count}</span>
                      </td>
                    </tr>
                  );
                }
                if (line.kind === 'reply') {
                  const { m, reply: r } = line;
                  // Replies sit under their markup, indented.
                  return (
                    <tr key={`${m.id}:${r.id}`} data-key={`${m.id}:${r.id}`} className={`reply-row${selected.has(m.id) ? ' selected' : ''}`} onClick={(e) => onSelect(m, e.ctrlKey || e.metaKey || e.shiftKey)}>
                      <td colSpan={visible.length}>
                        <span className="reply-arrow">↳</span>
                        <b>{r.author}</b> <span className="reply-date">{new Date(r.createdAt).toLocaleString()}</span> {r.text}
                        {!readOnly && (
                          <button
                            className="chip-x"
                            title="Delete this reply"
                            onClick={(e) => {
                              e.stopPropagation();
                              store?.update(m.id, { replies: (m.replies ?? []).filter((x) => x.id !== r.id) });
                            }}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                }
                const { markup: m, cells } = line.row;
                const missing = new Set(missingRequired(m, columnSet.columns).map((c) => c.id));
                return (
                  <tr
                    key={m.id}
                    data-id={m.id}
                    data-key={m.id}
                    className={`${selected.has(m.id) ? 'selected' : ''}${missing.size ? ' has-missing' : ''}${m.hidden ? ' hidden-markup' : ''}`}
                    title={m.hidden ? 'Hidden on the page (right-click › Show)' : undefined}
                    onClick={(e) => onSelect(m, e.ctrlKey || e.metaKey || e.shiftKey)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onRowMenu(m, e.clientX, e.clientY);
                    }}
                  >
                    {visible.map((c) => {
                      const cell = cells[c.key];
                      const isMissing = !!c.custom && missing.has(c.custom.id);
                      const edit = editor(m, c, isMissing);
                      return (
                        <td key={c.key} className={`${c.align === 'right' ? 'num' : ''}${isMissing ? ' missing' : ''}${edit ? ' edit' : ''}`} title={cell?.error ?? (edit ? undefined : cell?.text)}>
                          {edit ?? (cell?.error ? <span className="cell-error">⚠ {cell.error}</span> : c.key === 'color' ? <span className="swatch" style={{ background: cell?.text }} /> : cell?.text)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {end < lines.length && (
                <tr className="spacer" style={{ height: offsets[lines.length]! - offsets[end]! }}>
                  <td colSpan={visible.length} />
                </tr>
              )}
              {rows.length === 0 && (
                <tr className="no-match">
                  <td colSpan={visible.length}>No markups match the filter.</td>
                </tr>
              )}
            </tbody>
            {sums.length > 0 && rows.length > 0 && (
              <tfoot>
                <tr>
                  {visible.map((c, i) => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                      {sums.includes(c) ? sumOf(c.key, (c.custom as CustomColumn).decimals) : i === 0 ? 'Total' : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {totals.size > 0 && (
        <div className="markups-totals">
          {[...totals].map(([kind, t]) => (
            <span key={kind}>
              {MARKUP_LABELS[kind]} ×{t.n}: <b>{formatMeasure(kind, t.value, t.scale)}</b>
            </span>
          ))}
        </div>
      )}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {builderOpen && (
        <FilterBuilderDialog
          columns={all}
          initial={advanced}
          onCancel={() => setBuilderOpen(false)}
          onApply={(f) => {
            editList((l) => ({ ...l, advanced: f }));
            setBuilderOpen(false);
          }}
        />
      )}
    </div>
  );
});
