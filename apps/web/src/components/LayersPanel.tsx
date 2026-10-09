import {
  useMemo,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { PdfLayer } from "../documents/layers";
import { askText } from "./AskText";
import {
  ContextMenu,
  SEP,
  type ContextMenuState,
  type MenuEntry,
} from "./ContextMenu";

/** What a layer does besides showing: locked layers keep their visibility; print and export mark the layers each one uses. */
interface LayerFlags {
  lock?: boolean;
  print?: boolean;
  export?: boolean;
}

/** A named set of layer states (hidden layers and flags) that can be switched to in one go. */
interface LayerConfig {
  hidden: string[];
  flags: Record<string, LayerFlags>;
}

/** The panel's settings for one document, kept on this device. Layers are keyed `pdf:<id>` or `mk:<name>`. */
interface LayerPrefs {
  flags: Record<string, LayerFlags>;
  /** Markup layers added from the panel (they have no markups until some are moved to them). */
  added: string[];
  /** Markup layer order, as arranged by Add Before / After. */
  order: string[];
  configs: Record<string, LayerConfig>;
  config: string;
}

/** How the list is shown, for every document. */
interface LayerView {
  sort: boolean;
  pageOnly: boolean;
}

const DEFAULT_CONFIG = "Default";
const PREFS_KEY = "redcolumn.layers.";
const VIEW_KEY = "redcolumn.layers-view";
const EMPTY_PREFS: LayerPrefs = {
  flags: {},
  added: [],
  order: [],
  configs: {},
  config: DEFAULT_CONFIG,
};

const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

function load<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw) value = { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    // Storage blocked or unreadable: start from the defaults.
  }
  cache.set(key, value);
  return value;
}

function save<T>(key: string, value: T) {
  cache.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this session only.
  }
  listeners.forEach((l) => l());
}

function useStored<T>(key: string, fallback: T): [T, (next: T) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => load(key, fallback),
  );
  return [value, (next) => save(key, next)];
}

/** Markup layers added in the Layers panel for a document, so menus can offer them before any markup is on them. */
export function addedMarkupLayers(docKey: string): string[] {
  return load<LayerPrefs>(PREFS_KEY + docKey, EMPTY_PREFS).added;
}

interface Row {
  key: string;
  name: string;
  depth: number;
  /** Locked by the file itself (PDF layers). */
  fileLocked: boolean;
  /** Markups on the layer (markup layers). */
  count?: number;
  children: Row[];
}

export interface LayersPanelProps {
  /** Keys the panel's saved settings (the file's content hash); null with no document. */
  docKey: string | null;
  /** The PDF's own layers (optional content), and which of them are hidden. */
  pdfLayers: readonly PdfLayer[];
  hiddenPdf: ReadonlySet<string>;
  /** Markup layers (their markups' `layer`) with counts, and which are hidden. */
  markupLayers: readonly { name: string; count: number }[];
  hiddenMarkup: ReadonlySet<string>;
  /** Shows exactly the layers not listed. */
  onHidden: (pdf: string[], markup: string[]) => void;
  /** The PDF layers and markup layers the current page uses; null while unknown. */
  onPage: { pdf: ReadonlySet<string>; markup: ReadonlySet<string> } | null;
  showLinks: boolean;
  onShowLinks: (show: boolean) => void;
}

const pdfKey = (id: string) => `pdf:${id}`;
const mkKey = (name: string) => `mk:${name}`;

/**
 * Layers, laid out as Bluebeam's panel: one list of the PDF's own layers and the markup layers,
 * each with visibility (the eye) and Lock, Print and Export settings, and saved configurations.
 */
export function LayersPanel({
  docKey,
  pdfLayers,
  hiddenPdf,
  markupLayers,
  hiddenMarkup,
  onHidden,
  onPage,
  showLinks,
  onShowLinks,
}: LayersPanelProps) {
  const [prefs, setPrefs] = useStored<LayerPrefs>(
    PREFS_KEY + (docKey ?? ""),
    EMPTY_PREFS,
  );
  const [view, setView] = useStored<LayerView>(VIEW_KEY, {
    sort: false,
    pageOnly: false,
  });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const flagsOf = (r: Row, flags = prefs.flags): Required<LayerFlags> => ({
    lock: flags[r.key]?.lock ?? r.fileLocked,
    print: flags[r.key]?.print ?? true,
    export: flags[r.key]?.export ?? true,
  });

  // The PDF's tree (by depth), then the markup layers in the order arranged here.
  const tree = useMemo(() => {
    const roots: Row[] = [];
    const stack: Row[] = [];
    for (const l of pdfLayers) {
      const row: Row = {
        key: pdfKey(l.id),
        name: l.name,
        depth: l.depth,
        fileLocked: l.locked,
        children: [],
      };
      while (stack.length && stack[stack.length - 1]!.depth >= l.depth)
        stack.pop();
      (stack.length ? stack[stack.length - 1]!.children : roots).push(row);
      stack.push(row);
    }
    const counts = new Map(markupLayers.map((l) => [l.name, l.count]));
    const names = [
      ...markupLayers.map((l) => l.name),
      ...prefs.added.filter((n) => !counts.has(n)),
    ];
    const rank = (n: string) => {
      const i = prefs.order.indexOf(n);
      return i < 0 ? prefs.order.length + names.indexOf(n) : i;
    };
    for (const name of names.sort((a, b) => rank(a) - rank(b))) {
      roots.push({
        key: mkKey(name),
        name: name || "(No Layer)",
        depth: 0,
        fileLocked: false,
        count: counts.get(name) ?? 0,
        children: [],
      });
    }
    return roots;
  }, [pdfLayers, markupLayers, prefs.added, prefs.order]);

  const all = useMemo(() => {
    const out: Row[] = [];
    const walk = (rows: Row[]) =>
      rows.forEach((r) => (out.push(r), walk(r.children)));
    walk(tree);
    return out;
  }, [tree]);

  const shown = useMemo(() => {
    const onThisPage = (r: Row): boolean =>
      !view.pageOnly ||
      !onPage ||
      (r.key.startsWith("pdf:")
        ? onPage.pdf.has(r.key.slice(4))
        : onPage.markup.has(r.key.slice(3))) ||
      r.children.some(onThisPage);
    const order = (rows: Row[]) =>
      view.sort
        ? [...rows].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true }),
          )
        : rows;
    const out: { row: Row; depth: number }[] = [];
    const walk = (rows: Row[], depth: number) => {
      for (const r of order(rows.filter(onThisPage))) {
        out.push({ row: r, depth });
        if (!collapsed.has(r.key)) walk(r.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, view, onPage, collapsed]);

  const hiddenKeys = new Set([
    ...[...hiddenPdf].map(pdfKey),
    ...[...hiddenMarkup].map(mkKey),
  ]);
  const setHidden = (keys: Iterable<string>) => {
    const list = [...keys];
    onHidden(
      list.filter((k) => k.startsWith("pdf:")).map((k) => k.slice(4)),
      list.filter((k) => k.startsWith("mk:")).map((k) => k.slice(3)),
    );
  };
  /** Hides the layers `hide` picks, leaving locked layers as they are. */
  const showWhere = (hide: (r: Row) => boolean, flags = prefs.flags) =>
    setHidden(
      all
        .filter((r) =>
          flagsOf(r, flags).lock ? hiddenKeys.has(r.key) : hide(r),
        )
        .map((r) => r.key),
    );
  const fileDefaults = () =>
    all
      .filter(
        (r) =>
          r.key.startsWith("pdf:") &&
          !pdfLayers.find((l) => pdfKey(l.id) === r.key)?.on,
      )
      .map((r) => r.key);

  const setFlag = (r: Row, flag: keyof LayerFlags, value: boolean) =>
    setPrefs({
      ...prefs,
      flags: {
        ...prefs.flags,
        [r.key]: { ...prefs.flags[r.key], [flag]: value },
      },
    });
  const toggle = (r: Row) => {
    if (flagsOf(r).lock) return;
    const next = new Set(hiddenKeys);
    if (next.has(r.key)) next.delete(r.key);
    else next.add(r.key);
    setHidden(next);
  };

  const applyConfig = (name: string) => {
    const config = prefs.configs[name];
    setPrefs({ ...prefs, config: name, flags: config?.flags ?? {} });
    setHidden(config?.hidden ?? fileDefaults());
  };

  /** Steps the Dial: shows one layer at a time, in list order. */
  const dial = (step: 1 | -1) => {
    const rows = shown.map((s) => s.row).filter((r) => !flagsOf(r).lock);
    if (!rows.length) return;
    const visible = rows.filter((r) => !hiddenKeys.has(r.key));
    const at =
      visible.length === 1 ? rows.indexOf(visible[0]!) : step === 1 ? -1 : 0;
    const next = rows[(at + step + rows.length) % rows.length]!;
    showWhere((r) => r !== next);
  };

  const addLayer = (where: "before" | "after") => {
    void askText("Add Layer", "", {
      label:
        "A markup layer. Move markups to it from their right-click menu › Layer.",
      confirm: "Add",
    }).then((name) => {
      name = name?.trim() ?? "";
      if (!name || all.some((r) => r.key === mkKey(name!))) return;
      const order = all
        .filter((r) => r.key.startsWith("mk:"))
        .map((r) => r.key.slice(3));
      const at = selected?.startsWith("mk:")
        ? order.indexOf(selected.slice(3))
        : -1;
      order.splice(
        at < 0
          ? where === "before"
            ? 0
            : order.length
          : where === "before"
            ? at
            : at + 1,
        0,
        name,
      );
      setPrefs({ ...prefs, added: [...prefs.added, name], order });
      setSelected(mkKey(name));
    });
  };

  const open = (e: MouseEvent<HTMLElement>, items: MenuEntry[]) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 2, items });
  };

  const layersMenu = (): MenuEntry[] => [
    {
      label: "Reset Layers",
      onClick: () => (
        setPrefs({ ...prefs, flags: {} }),
        setHidden(fileDefaults())
      ),
    },
    {
      label: "Show Print Layers",
      onClick: () => showWhere((r) => !flagsOf(r).print),
    },
    {
      label: "Show Export Layers",
      onClick: () => showWhere((r) => !flagsOf(r).export),
    },
    { label: "Show All Layers", onClick: () => showWhere(() => false) },
    SEP,
    {
      label: "Show Layers On Page Only",
      checked: view.pageOnly,
      onClick: () => setView({ ...view, pageOnly: !view.pageOnly }),
    },
    {
      label: "Sort Layers Alphabetically",
      checked: view.sort,
      onClick: () => setView({ ...view, sort: !view.sort }),
    },
    SEP,
    {
      label: "Dial",
      disabled: !all.length,
      items: [
        { label: "Next Layer", onClick: () => dial(1) },
        { label: "Previous Layer", onClick: () => dial(-1) },
      ],
    },
  ];

  const rowMenu = (r: Row): MenuEntry[] => {
    const empty =
      r.key.startsWith("mk:") &&
      prefs.added.includes(r.key.slice(3)) &&
      !r.count;
    return [
      {
        label: hiddenKeys.has(r.key) ? "Show Layer" : "Hide Layer",
        disabled: flagsOf(r).lock,
        onClick: () => toggle(r),
      },
      {
        label: "Show Only This Layer",
        onClick: () => showWhere((x) => x !== r),
      },
      ...(empty
        ? [
            SEP,
            {
              label: "Delete Layer",
              danger: true,
              onClick: () => {
                const name = r.key.slice(3);
                setPrefs({
                  ...prefs,
                  added: prefs.added.filter((n) => n !== name),
                  order: prefs.order.filter((n) => n !== name),
                });
              },
            },
          ]
        : []),
    ];
  };

  const parents = all.filter((r) => r.children.length).map((r) => r.key);
  const allCollapsed =
    parents.length > 0 && parents.every((k) => collapsed.has(k));
  const configs = [
    DEFAULT_CONFIG,
    ...Object.keys(prefs.configs).filter((n) => n !== DEFAULT_CONFIG),
  ];
  const check = (r: Row, flag: keyof LayerFlags, label: string) => (
    <td className="layer-flag">
      <input
        type="checkbox"
        aria-label={`${label} ${r.name}`}
        checked={flagsOf(r)[flag]}
        onChange={(e) => setFlag(r, flag, e.target.checked)}
      />
    </td>
  );

  return (
    <div className="layers">
      <div className="layers-bar">
        <button
          className="layers-menu-btn title"
          aria-haspopup="menu"
          onClick={(e) => open(e, layersMenu())}
        >
          Layers <Caret />
        </button>
        <button
          className="layers-menu-btn"
          aria-haspopup="menu"
          title="Add Layer"
          disabled={!docKey}
          onClick={(e) =>
            open(e, [
              { label: "Add Before…", onClick: () => addLayer("before") },
              { label: "Add After…", onClick: () => addLayer("after") },
              { label: "Add Child…", disabled: true },
            ])
          }
        >
          {ICONS.addLayer} <Caret />
        </button>
        <button
          className="layers-menu-btn"
          aria-haspopup="menu"
          title="Document"
          onClick={(e) =>
            open(e, [
              {
                label: "Show Hyperlinks",
                checked: showLinks,
                onClick: () => onShowLinks(!showLinks),
              },
            ])
          }
        >
          {ICONS.page} <Caret />
        </button>
        <select
          className="layers-config"
          aria-label="Layer configuration"
          value={prefs.config}
          disabled={!docKey}
          onChange={(e) => applyConfig(e.target.value)}
        >
          {configs.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          className="layers-menu-btn"
          aria-haspopup="menu"
          title="Configurations"
          disabled={!docKey}
          onClick={(e) =>
            open(e, [
              {
                label: "Save Configuration",
                icon: ICONS.save,
                onClick: () =>
                  setPrefs({
                    ...prefs,
                    configs: {
                      ...prefs.configs,
                      [prefs.config]: {
                        hidden: [...hiddenKeys],
                        flags: prefs.flags,
                      },
                    },
                  }),
              },
              {
                label: "New Configuration",
                icon: ICONS.newConfig,
                onClick: () =>
                  void askText("New Configuration", "", {
                    label:
                      "Saves which layers show, and their Lock, Print and Export settings.",
                    confirm: "Save",
                  }).then((name) => {
                    name = name?.trim() ?? "";
                    if (name)
                      setPrefs({
                        ...prefs,
                        config: name,
                        configs: {
                          ...prefs.configs,
                          [name]: {
                            hidden: [...hiddenKeys],
                            flags: prefs.flags,
                          },
                        },
                      });
                  }),
              },
              {
                label: "Delete Configuration",
                icon: ICONS.deleteConfig,
                disabled: prefs.config === DEFAULT_CONFIG,
                onClick: () => {
                  const { [prefs.config]: _, ...rest } = prefs.configs;
                  setPrefs({ ...prefs, configs: rest, config: DEFAULT_CONFIG });
                },
              },
            ])
          }
        >
          {ICONS.sliders} <Caret />
        </button>
      </div>
      <div className="layers-grid">
        <table>
          <thead>
            <tr>
              <th className="layer-name">
                <button
                  className="layer-twisty"
                  aria-label={allCollapsed ? "Expand all" : "Collapse all"}
                  disabled={!parents.length}
                  onClick={() =>
                    setCollapsed(allCollapsed ? new Set() : new Set(parents))
                  }
                >
                  {allCollapsed ? "+" : "−"}
                </button>
                Layer
              </th>
              <th>Lock</th>
              <th>Print</th>
              <th>Export</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row: r, depth }) => {
              const hidden = hiddenKeys.has(r.key);
              const locked = flagsOf(r).lock;
              return (
                <tr
                  key={r.key}
                  className={`${selected === r.key ? "selected" : ""}${hidden ? " off" : ""}`}
                  onClick={() => setSelected(r.key)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelected(r.key);
                    setMenu({ x: e.clientX, y: e.clientY, items: rowMenu(r) });
                  }}
                >
                  <td
                    className="layer-name"
                    title={
                      r.count !== undefined
                        ? `${r.count} markup${r.count === 1 ? "" : "s"}`
                        : undefined
                    }
                  >
                    <div
                      className="layer-cell"
                      style={{ paddingLeft: 6 + depth * 14 }}
                    >
                      {r.children.length ? (
                        <button
                          className="layer-twisty"
                          aria-label={
                            collapsed.has(r.key) ? "Expand" : "Collapse"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = new Set(collapsed);
                            if (!next.delete(r.key)) next.add(r.key);
                            setCollapsed(next);
                          }}
                        >
                          {collapsed.has(r.key) ? "+" : "−"}
                        </button>
                      ) : (
                        <span className="layer-twisty-space" />
                      )}
                      <button
                        className="layer-eye"
                        aria-pressed={!hidden}
                        aria-label={`${hidden ? "Show" : "Hide"} ${r.name}`}
                        title={
                          locked
                            ? "Locked: unlock to show or hide"
                            : hidden
                              ? "Show"
                              : "Hide"
                        }
                        disabled={locked}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(r);
                        }}
                      >
                        {hidden ? ICONS.eyeOff : ICONS.eye}
                      </button>
                      <span className="layer-label">{r.name}</span>
                    </div>
                  </td>
                  {check(r, "lock", "Lock")}
                  {check(r, "print", "Print")}
                  {check(r, "export", "Export")}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && (
          <p className="empty">
            {!docKey
              ? "Open a document to see its layers."
              : view.pageOnly && all.length
                ? "No layers on this page."
                : "This document has no layers. Add one, or right-click markups › Layer."}
          </p>
        )}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Caret() {
  return (
    <svg
      className="caret"
      viewBox="0 0 10 10"
      width="9"
      height="9"
      aria-hidden="true"
    >
      <path
        d="M2 3.5 5 6.5 8 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function icon(children: ReactNode, size = 16): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS = {
  eye: icon(
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>,
    14,
  ),
  eyeOff: icon(
    <>
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"
        opacity="0.45"
      />
      <path d="M2.5 13.5l11-11" />
    </>,
    14,
  ),
  addLayer: icon(
    <>
      <path d="M7 3 1.5 6.5 7 10l5.5-3.5z" />
      <path d="M1.5 9.5 7 13l3-1.9" />
      <path d="M12.5 10v4M10.5 12h4" stroke="var(--accent)" />
    </>,
  ),
  page: icon(
    <>
      <path d="M3.5 1.5h6l3 3v4M3.5 1.5v13h5M9.5 1.5v3h3" />
      <path
        d="M10.5 11.5a2.2 2.2 0 1 1 1 2.6M10.5 11.5V9.8M10.5 11.5h1.7"
        stroke="var(--accent)"
      />
    </>,
  ),
  sliders: icon(
    <path d="M3.5 2v12M8 2v12M12.5 2v12M2 10h3M6.5 5h3M11 8.5h3" />,
  ),
  save: icon(
    <>
      <path d="M7 2 1.5 5.5 7 9l5.5-3.5z" />
      <path d="M1.5 8.5 7 12l1.5-1M10 10.5l2 2 3-3.5" stroke="var(--accent)" />
    </>,
  ),
  newConfig: icon(
    <>
      <path d="M7 2 1.5 5.5 7 9l5.5-3.5z" />
      <path d="M1.5 8.5 7 12l2.5-1.6M12.5 10v4M10.5 12h4" />
    </>,
  ),
  deleteConfig: icon(
    <>
      <path d="M7 2 1.5 5.5 7 9l5.5-3.5z" />
      <path d="M1.5 8.5 7 12l2.5-1.6M11 10.5l3 3M14 10.5l-3 3" />
    </>,
  ),
};
