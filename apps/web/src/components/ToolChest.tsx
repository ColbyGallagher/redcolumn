import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { boundsOf, drawMarkup, isTextType, MARKUP_LABELS, type Markup, type MarkupType, type Point } from '@nb/markup';
import { toolLabel, type Tool } from '../markup/MarkupTools';
import { importToolSets, toolSetFile } from '../toolchest/toolSets';
import { RECENT_TOOLS_ID, updateWorkspace, useWorkspace, type ToolChestItem, type ToolSet } from '../workspace/profiles';
import { ContextMenu, type ContextMenuState, type MenuEntry } from './ContextMenu';
import { useSettings } from '../settings/settings';
import { InlineName } from './InlineName';
import { MARKUP_TOOLS, MEASURE_TOOLS } from './ToolBar';

/** Drag data type for a Tool Library tool dragged onto a page (the value is the tool's id). */
export const TOOL_DRAG_TYPE = 'application/x-nb-tool';

/** Draws saved markups scaled to fit a 40×40 box, as they will be placed. */
function drawTemplate(ctx: CanvasRenderingContext2D, template: readonly Markup[]) {
  const b = boundsOf(template.flatMap((m) => m.points));
  // Text boxes and single points have little extent of their own; give them some room.
  const w = Math.max(b.w, 1);
  const h = Math.max(b.h, 1);
  const k = Math.min(32 / w, 32 / h, 4);
  ctx.save();
  ctx.translate(20, 20);
  ctx.scale(k, k);
  ctx.translate(-(b.x + w / 2), -(b.y + h / 2));
  for (const m of template) {
    // Strokes keep a readable on-screen width however far the shape is scaled down.
    const width = Math.min(Math.max(m.style.width * k, m.type === 'highlighter' ? 3 : 1), m.type === 'highlighter' ? 10 : 3) / k;
    drawMarkup(ctx, { ...m, style: { ...m.style, width, showLabel: false } }, k);
  }
  ctx.restore();
}

/** Sample geometry that shows a tool's look in a 40×40 box. */
function samplePoints(type: MarkupType): Point[] {
  switch (type) {
    case 'line':
    case 'arrow':
    case 'length':
      return [
        [6, 34],
        [34, 6],
      ];
    case 'pen':
      return Array.from({ length: 15 }, (_, i) => [5 + i * 2.1, 20 + Math.sin(i / 2) * 9] as Point);
    case 'highlighter':
      return [
        [4, 20],
        [36, 20],
      ];
    case 'polylength':
    case 'polyline':
      return [
        [5, 32],
        [16, 10],
        [26, 28],
        [35, 8],
      ];
    case 'area':
    case 'perimeter':
    case 'polygon':
      return [
        [6, 30],
        [12, 7],
        [34, 10],
        [30, 34],
      ];
    case 'count':
      return [
        [11, 12],
        [28, 16],
        [17, 30],
      ];
    case 'arc':
      return [
        [5, 30],
        [20, 10],
        [35, 30],
      ];
    case 'note':
      return [
        [8, 8],
        [32, 32],
      ];
    case 'angle':
      return [
        [34, 30],
        [6, 30],
        [26, 6],
      ];
    default:
      return [
        [5, 9],
        [35, 31],
      ];
  }
}

/** A tool's look drawn small, from its saved style. */
export function ToolPreview({ item, size = 40 }: { item: Pick<ToolChestItem, 'type' | 'style' | 'image' | 'markups'>; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const k = (size / 40) * dpr;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      if (item.markups?.length && item.type !== 'signature') {
        drawTemplate(ctx, item.markups);
        return;
      }
      const style = {
        ...item.style,
        // Thick lines and big markers are scaled down so the preview still reads.
        width: Math.min(item.style.width, item.type === 'highlighter' ? 10 : 3),
        arcRadius: item.type === 'count' ? 4 : item.type === 'cloud' ? 4 : 3,
        fontSize: isTextType(item.type) ? 11 : item.style.fontSize,
        showLabel: false,
        leader: undefined,
      };
      const m: Markup = {
        id: 'preview',
        type: item.type,
        pageIndex: 0,
        points: samplePoints(item.type),
        style,
        status: 'none',
        author: '',
        createdAt: 0,
        modifiedAt: 0,
        ...(isTextType(item.type) ? { text: 'Aa' } : {}),
        ...(item.image ? { image: item.image } : {}),
      };
      if (item.type === 'signature' && item.image) {
        const img = new Image();
        img.onload = () => {
          const aspect = img.naturalWidth / img.naturalHeight || 3;
          const w = aspect >= 1 ? 36 : 36 * aspect;
          const h = w / aspect;
          ctx.drawImage(img, 20 - w / 2, 20 - h / 2, w, h);
        };
        img.src = item.image;
        return;
      }
      drawMarkup(ctx, m, 4);
    };
    draw();
  }, [item, size]);
  return <canvas ref={ref} className="tool-preview" style={{ width: size, height: size }} aria-hidden="true" />;
}

interface Props {
  tool: Tool;
  presetId: string | null;
  enabled: boolean;
  /** Arms a tool: `copy` places the exact saved markup, `style` draws new markups in its look. */
  onUse: (item: ToolChestItem, mode?: 'copy' | 'style') => void;
  onSetTool: (tool: Tool) => void;
  /** Saves the selected markup's look into a tool set (null when nothing is selected). */
  onAddSelected: ((setId: string) => void) | null;
}


/**
 * The Tool Library: collapsible tool sets of saved tools, each drawn as a
 * preview of its look. Click a tool to draw with it. Right-click a markup on the page or in the
 * list → Add to Tool Library to save its look here.
 */
export function ToolChestPanel({ tool, presetId, enabled, onUse, onSetTool, onAddSelected }: Props) {
  const ws = useWorkspace();
  const prefs = useSettings();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [naming, setNaming] = useState<{ setId: string | 'new'; itemId?: string } | null>(null);
  const [standardOpen, setStandardOpen] = useState(true);
  const [dragItem, setDragItem] = useState<{ setId: string; itemId: string } | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importFiles = (files: File[]) =>
    void importToolSets(files).then(({ added, skipped, failed }) =>
      setMessage(
        [
          added ? `Imported ${added} tool${added === 1 ? '' : 's'}.` : '',
          skipped ? `${skipped} tool${skipped === 1 ? ' is' : 's are'} not supported yet (stamps, images, symbols…).` : '',
          ...failed,
        ]
          .filter(Boolean)
          .join(' ') || 'No tools found.',
      ),
    );
  const closeMenu = useCallback(() => setMenu(null), []);

  const editSet = (id: string, fn: (s: ToolSet) => ToolSet | null) =>
    updateWorkspace((w) => ({ ...w, toolChests: w.toolChests.map((t) => (t.id === id ? fn(t) : t)).filter((t): t is ToolSet => !!t) }));

  const moveSet = (id: string, by: -1 | 1) =>
    updateWorkspace((w) => {
      const list = [...w.toolChests];
      const i = list.findIndex((t) => t.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return w;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { ...w, toolChests: list };
    });

  const moveItem = (from: string, itemId: string, to: string, before?: string) =>
    updateWorkspace((w) => {
      const item = w.toolChests.find((t) => t.id === from)?.items.find((i) => i.id === itemId);
      if (!item) return w;
      return {
        ...w,
        toolChests: w.toolChests.map((t) => {
          let items = t.id === from ? t.items.filter((i) => i.id !== itemId) : t.items;
          if (t.id === to) {
            const copy = from === to ? item : { ...item, id: crypto.randomUUID() };
            const at = before ? items.findIndex((i) => i.id === before) : -1;
            items = at < 0 ? [...items, copy] : [...items.slice(0, at), copy, ...items.slice(at)];
          }
          return { ...t, items };
        }),
      };
    });

  const setMenuFor = (e: ReactMouseEvent, set: ToolSet, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const isRecent = set.id === RECENT_TOOLS_ID;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Icon View', checked: set.view !== 'detail', onClick: () => editSet(set.id, (s) => ({ ...s, view: 'icon' })) },
        { label: 'Detail View', checked: set.view === 'detail', onClick: () => editSet(set.id, (s) => ({ ...s, view: 'detail' })) },
        { sep: true },
        { label: 'Add Selected Markup', disabled: !onAddSelected || isRecent, onClick: () => onAddSelected?.(set.id) },
        { label: 'Rename…', disabled: isRecent, onClick: () => setNaming({ setId: set.id }) },
        {
          label: 'Scale Tools to Page Scale',
          checked: !!set.scaleToPage,
          disabled: isRecent,
          onClick: () => editSet(set.id, (s) => ({ ...s, scaleToPage: !s.scaleToPage || undefined })),
        },
        {
          label: 'Export Tool Set…',
          disabled: !set.items.length,
          onClick: () => {
            const url = URL.createObjectURL(toolSetFile(set));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${set.name.replace(/[\\/:*?"<>|]+/g, '_')}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        },
        { label: 'Move Up', disabled: index === 0, onClick: () => moveSet(set.id, -1) },
        { label: 'Move Down', disabled: index === ws.toolChests.length - 1, onClick: () => moveSet(set.id, 1) },
        { label: 'Hide Tool Set', onClick: () => editSet(set.id, (s) => ({ ...s, hidden: true })) },
        { sep: true },
        isRecent
          ? { label: 'Clear Recent Tools', disabled: !set.items.length, onClick: () => editSet(set.id, (s) => ({ ...s, items: [] })) }
          : {
              label: 'Delete Tool Set…',
              danger: true,
              onClick: () => {
                if (confirm(`Delete the tool set "${set.name}" and its ${set.items.length} tool(s)?`)) editSet(set.id, () => null);
              },
            },
      ],
    });
  };

  const itemMenu = (e: ReactMouseEvent, set: ToolSet, item: ToolChestItem) => {
    e.preventDefault();
    e.stopPropagation();
    const others = ws.toolChests.filter((t) => t.id !== set.id && t.id !== RECENT_TOOLS_ID);
    const copyTo: MenuEntry[] = others.length ? others.map((t) => ({ label: t.name, onClick: () => moveItem(set.id, item.id, t.id) })) : [{ label: 'No other tool sets', disabled: true }];
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(item.markups?.length && item.type !== 'signature'
          ? [
              { label: 'Place Copy', checked: prefs.toolChestMode === 'copy', disabled: !enabled, onClick: () => onUse(item, 'copy') },
              { label: 'Draw with Style', checked: prefs.toolChestMode === 'style', disabled: !enabled, onClick: () => onUse(item, 'style') },
            ]
          : [{ label: 'Use Tool', disabled: !enabled, onClick: () => onUse(item) }]),
        { label: 'Rename…', onClick: () => setNaming({ setId: set.id, itemId: item.id }) },
        { label: set.id === RECENT_TOOLS_ID ? 'Save to Tool Set' : 'Move to Tool Set', items: copyTo },
        {
          label: 'Duplicate',
          disabled: set.id === RECENT_TOOLS_ID,
          onClick: () => editSet(set.id, (s) => ({ ...s, items: [...s.items, { ...item, id: crypto.randomUUID(), label: `${item.label} (copy)` }] })),
        },
        { sep: true },
        { label: 'Delete Tool', danger: true, onClick: () => editSet(set.id, (s) => ({ ...s, items: s.items.filter((i) => i.id !== item.id) })) },
      ],
    });
  };

  const finishNaming = (name: string | null) => {
    const n = naming;
    setNaming(null);
    if (!n || !name) return;
    if (n.setId === 'new') {
      updateWorkspace((w) => ({ ...w, toolChests: [...w.toolChests, { id: crypto.randomUUID(), name, collapsed: false, view: 'icon', items: [] }] }));
    } else if (n.itemId) {
      editSet(n.setId, (s) => ({ ...s, items: s.items.map((i) => (i.id === n.itemId ? { ...i, label: name } : i)) }));
    } else {
      editSet(n.setId, (s) => ({ ...s, name }));
    }
  };

  const hidden = ws.toolChests.filter((t) => t.hidden);

  return (
    <div
      className={`toolchest${fileDrag ? ' drag' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
          e.preventDefault();
          setFileDrag(true);
        }
      }}
      onDragLeave={() => setFileDrag(false)}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files].filter((f) => /\.(btx|json)$/i.test(f.name));
        setFileDrag(false);
        if (!files.length) return;
        e.preventDefault();
        importFiles(files);
      }}
    >
      <div className="toolchest-bar">
        <button className="btn small" onClick={() => setNaming({ setId: 'new' })} title="Create a new tool set">
          + New Tool Set
        </button>
        <button className="btn small" onClick={() => fileRef.current?.click()} title="Import tool sets (Bluebeam® Revu® .btx, or redcolumn .json), or drop them here">
          Import…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".btx,.json,application/xml,text/xml,application/json"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) importFiles(files);
          }}
        />
        {hidden.length > 0 && (
          <button
            className="btn small flat"
            onClick={(e) =>
              setMenu({
                x: e.clientX,
                y: e.clientY,
                items: hidden.map((t) => ({ label: `Show "${t.name}"`, onClick: () => editSet(t.id, (s) => ({ ...s, hidden: false })) })),
              })
            }
          >
            {hidden.length} hidden
          </button>
        )}
      </div>
      {message && (
        <p className="toolchest-message" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}
      {naming?.setId === 'new' && (
        <div className="toolset">
          <div className="toolset-head">
            <InlineName initial="" placeholder="Tool set name" onDone={finishNaming} />
          </div>
        </div>
      )}
      {ws.toolChests.map((set, index) => {
        if (set.hidden) return null;
        const isRecent = set.id === RECENT_TOOLS_ID;
        return (
          <section
            key={set.id}
            className="toolset"
            onDragOver={(e) => {
              if (dragItem && !isRecent) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!dragItem || isRecent) return;
              e.preventDefault();
              moveItem(dragItem.setId, dragItem.itemId, set.id);
              setDragItem(null);
            }}
          >
            <div className="toolset-head" onContextMenu={(e) => setMenuFor(e, set, index)}>
              {naming?.setId === set.id && !naming.itemId ? (
                <InlineName initial={set.name} placeholder="Tool set name" onDone={finishNaming} />
              ) : (
                <>
                  <button className="toolset-toggle" aria-expanded={!set.collapsed} onClick={() => editSet(set.id, (s) => ({ ...s, collapsed: !s.collapsed }))}>
                    <span className="caret">{set.collapsed ? '▸' : '▾'}</span>
                    <span className="toolset-name">{set.name}</span>
                    <span className="count">{set.items.length}</span>
                  </button>
                  <button className="toolset-menu" title="Tool set options" onClick={(e) => setMenuFor(e, set, index)}>
                    ▾
                  </button>
                </>
              )}
            </div>
            {!set.collapsed && (
              <div className={`toolset-items ${set.view === 'detail' ? 'detail' : 'icons'}`}>
                {set.items.map((item) => {
                  const active = presetId === item.id;
                  return naming?.itemId === item.id ? (
                    <div key={item.id} className="tool-item editing">
                      <InlineName initial={item.label} placeholder="Tool name" onDone={finishNaming} />
                    </div>
                  ) : (
                    <button
                      key={item.id}
                      className={`tool-item${active ? ' active' : ''}`}
                      disabled={!enabled}
                      title={`${item.label}${item.subject && item.subject !== item.label ? ` — ${item.subject}` : ''} (${item.tool ? toolLabel(item.tool) : MARKUP_LABELS[item.type]})${item.markups?.length ? '\nClick, then click the page to place a copy — or drag it onto the page.' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        setDragItem({ setId: set.id, itemId: item.id });
                        // Dropped on a page, the tool places a copy there (see App's dropTool).
                        e.dataTransfer.setData(TOOL_DRAG_TYPE, item.id);
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      onDragEnd={() => setDragItem(null)}
                      onDragOver={(e) => {
                        if (dragItem && !isRecent) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        if (!dragItem || isRecent) return;
                        e.preventDefault();
                        e.stopPropagation();
                        moveItem(dragItem.setId, dragItem.itemId, set.id, item.id);
                        setDragItem(null);
                      }}
                      onClick={() => onUse(item)}
                      onContextMenu={(e) => itemMenu(e, set, item)}
                    >
                      <ToolPreview item={item} size={set.view === 'detail' ? 28 : 40} />
                      {set.view === 'detail' ? (
                        <span className="tool-text">
                          <span className="tool-label">{item.label}</span>
                          <span className="tool-type">{item.tool ? toolLabel(item.tool) : MARKUP_LABELS[item.type]}</span>
                        </span>
                      ) : (
                        <span className="tool-caption">{item.label}</span>
                      )}
                    </button>
                  );
                })}
                {!set.items.length && (
                  <p className="toolset-empty">
                    {isRecent ? 'Tools you draw with appear here.' : 'Right-click a markup → Add to Tool Library, or drag a tool here.'}
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
      <section className="toolset">
        <div className="toolset-head">
          <button className="toolset-toggle" aria-expanded={standardOpen} onClick={() => setStandardOpen((o) => !o)}>
            <span className="caret">{standardOpen ? '▾' : '▸'}</span>
            <span className="toolset-name">Standard Tools</span>
          </button>
        </div>
        {standardOpen && (
          <div className="toolset-items standard">
            {[...MARKUP_TOOLS, ...MEASURE_TOOLS].map(({ tool: t, icon }) => (
              <button key={t} className={`btn tool${tool === t && !presetId ? ' active' : ''}`} disabled={!enabled} title={toolLabel(t)} onClick={() => onSetTool(t)}>
                {icon}
              </button>
            ))}
          </div>
        )}
      </section>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
}
