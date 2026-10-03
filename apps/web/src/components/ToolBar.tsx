import { useEffect, useRef, useState } from 'react';
import { FONT_FAMILIES, LINE_DASHES, MARKUP_LABELS, styleCapabilities, type FontFamily, type LineDash, type MarkupType } from '@nb/markup';
import { FILL_TYPES, toolLabel, type FillType, type MarkupTools, type Tool, type ToolsState } from '../markup/MarkupTools';
import { shortcutLabel } from '../commands/shortcuts';

/** How a tool's shortcut is shown in menus and tooltips, e.g. `L` or `Shift+N` (from the active profile). */
export function toolShortcut(tool: Tool): string | undefined {
  return shortcutLabel(`tool.${tool}`);
}

export const MARKUP_TOOLS: { tool: Tool; icon: string }[] = [
  { tool: 'select', icon: '⬉' },
  { tool: 'lasso', icon: '◌' },
  { tool: 'line', icon: '╱' },
  { tool: 'arrow', icon: '↗' },
  { tool: 'dimension', icon: '⟷' },
  { tool: 'polyline', icon: '⋀' },
  { tool: 'arc', icon: '⌒' },
  { tool: 'rect', icon: '▭' },
  { tool: 'ellipse', icon: '◯' },
  { tool: 'polygon', icon: '⬡' },
  { tool: 'cloud', icon: '☁' },
  { tool: 'cloudPlus', icon: '☁⁺' },
  { tool: 'pen', icon: '✎' },
  { tool: 'highlighter', icon: '▮' },
  { tool: 'eraser', icon: '⌫' },
  { tool: 'textHighlight', icon: 'H̲' },
  { tool: 'underline', icon: 'U̲' },
  { tool: 'strikeout', icon: 'S̶' },
  { tool: 'squiggly', icon: 'W̰' },
  { tool: 'replaceText', icon: 'R̶‸' },
  { tool: 'text', icon: 'T' },
  { tool: 'callout', icon: '↘T' },
  { tool: 'typewriter', icon: 'Aa' },
  { tool: 'note', icon: '▤' },
  { tool: 'image', icon: '⛶' },
  { tool: 'attachment', icon: '📎' },
  { tool: 'flag', icon: '⚑' },
  { tool: 'snapshot', icon: '📷' },
  { tool: 'stamp', icon: '⛋' },
  { tool: 'legend', icon: '☷' },
  { tool: 'hyperlink', icon: '🔗' },
  { tool: 'space', icon: '⬚' },
  { tool: 'redaction', icon: '▇' },
];

export const MEASURE_TOOLS: { tool: Tool; icon: string }[] = [
  { tool: 'calibrate', icon: '⇹' },
  { tool: 'length', icon: '↔' },
  { tool: 'polylength', icon: '⤳' },
  { tool: 'area', icon: '▰' },
  { tool: 'perimeter', icon: '⬠' },
  { tool: 'count', icon: '#' },
  { tool: 'angle', icon: '∠' },
  { tool: 'diameter', icon: '⌀' },
  { tool: 'radius', icon: '◔' },
  { tool: 'arcLength', icon: '◠' },
  { tool: 'volume', icon: '⬙' },
  { tool: 'dynamicFill', icon: '🪣' },
  { tool: 'visualSearch', icon: '🔍' },
];

const TOOL_HINTS: Partial<Record<Tool, string>> = {
  polyline: 'click points; double-click or Enter to finish',
  polygon: 'click vertices; click the first point, double-click or Enter to finish',
  arc: 'click the start, a point on the curve, then the end',
  typewriter: 'click where to type',
  stamp: 'click or drag to place the last used stamp (Tools › Stamp for others)',
  legend: 'drag a box; it lists the markups on the page with quantities and totals',
  eraser: 'rub out parts of pen and highlighter strokes (Tools › Eraser for sizes and the whole-markup eraser)',
  dimension: 'drag a line; type the dimension text',
  replaceText: 'drag across the text to replace; type the new wording',
  attachment: 'choose a file, then click to place its paperclip',
  flag: 'click to place a flag; double-click to add a note',
  snapshot: 'drag a box: the area is copied as a picture',
  textHighlight: 'drag across text in the PDF',
  underline: 'drag across text in the PDF',
  strikeout: 'drag across text in the PDF',
  squiggly: 'drag across text in the PDF',
  callout: 'press where the arrow points, drag to where the text goes',
  cloudPlus: 'drag a cloud; a callout for your note is added to it',
  lasso: 'drag around markups to select them; Shift adds to the selection',
  note: 'click to place a note, then type its comment',
  image: 'choose a picture, then click or drag to place it',
  calibrate: 'click two points a known distance apart',
  polylength: 'click points; double-click or Enter to finish',
  area: 'click vertices; click the first point, double-click or Enter to finish',
  perimeter: 'click vertices; double-click or Enter to finish',
  count: 'click each item; Enter to finish',
  angle: 'click a point, the vertex, then another point',
  diameter: 'click the two ends of a diameter',
  radius: 'click the centre, then a point on the circle',
  arcLength: 'click the start, a point on the arc, then the end',
  volume: 'click the outline; set the depth in Properties',
  space: 'click the outline of a room or zone; click the first point to finish',
  visualSearch: 'drag a box around one symbol to find every other copy',
  dynamicFill: 'click inside a room: its outline becomes the chosen markup',
  redaction: 'drag over what to remove; Tools › Redaction › Apply Redactions removes it for good',
  eraseContent: 'drag over PDF content to remove it from the page',
  cutout: 'click the hole inside the area; click the first point to finish',
};

const WIDTHS = [0.5, 1, 1.5, 2, 3, 5, 8, 12];

/**
 * Related markup tools share one toolbar button (a flyout): the button draws with
 * the group's last-used tool and its ▾ lists the rest.
 */
const TOOL_GROUPS: { name: string; tools: Tool[] }[] = [
  { name: 'Select', tools: ['select'] },
  { name: 'Lasso', tools: ['lasso'] },
  { name: 'Lines', tools: ['line', 'arrow', 'polyline', 'arc', 'dimension'] },
  { name: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'cloud', 'cloudPlus'] },
  { name: 'Pen', tools: ['pen', 'highlighter', 'eraser'] },
  { name: 'Text markup', tools: ['textHighlight', 'underline', 'strikeout', 'squiggly', 'replaceText'] },
  { name: 'Text', tools: ['text', 'callout', 'typewriter', 'note'] },
  { name: 'Insert', tools: ['image', 'attachment', 'stamp', 'legend', 'hyperlink', 'flag', 'snapshot'] },
];

const MEASURE_GROUPS: { name: string; tools: Tool[] }[] = [
  { name: 'Calibrate', tools: ['calibrate'] },
  { name: 'Length', tools: ['length', 'polylength', 'arcLength'] },
  { name: 'Area', tools: ['area', 'perimeter', 'volume', 'dynamicFill'] },
  { name: 'Circle', tools: ['diameter', 'radius'] },
  { name: 'Count', tools: ['count', 'visualSearch'] },
  { name: 'Angle', tools: ['angle'] },
];

const ICONS = new Map([...MARKUP_TOOLS, ...MEASURE_TOOLS].map((t) => [t.tool, t.icon]));

function ToolGroup({ name, tools, state, enabled, onPick }: { name: string; tools: Tool[]; state: ToolsState; enabled: boolean; onPick: (t: Tool) => void }) {
  const [last, setLast] = useState<Tool>(tools[0]!);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const activeHere = tools.includes(state.tool) && !state.preset;
  // The button shows the group's tool in use, else the one used last.
  const current = tools.includes(state.tool) ? state.tool : tools.includes(last) ? last : tools[0]!;
  useEffect(() => {
    if (tools.includes(state.tool)) setLast(state.tool);
  }, [state.tool, tools]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="tool-group" ref={root}>
      <button className={`btn tool${activeHere ? ' active' : ''}`} disabled={!enabled} title={toolTitle(current)} onClick={() => onPick(current)}>
        {ICONS.get(current)}
      </button>
      {tools.length > 1 && (
        <button className="btn tool-caret" disabled={!enabled} title={`${name} tools`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          ▾
        </button>
      )}
      {open && (
        <div className="tool-flyout" role="menu">
          {tools.map((t) => (
            <button
              key={t}
              role="menuitem"
              className={`menu-item${state.tool === t ? ' checked' : ''}`}
              onClick={() => {
                setOpen(false);
                onPick(t);
              }}
            >
              <span className="check">{ICONS.get(t)}</span>
              <span className="label">{toolLabel(t)}</span>
              {toolShortcut(t) && <span className="sc">{toolShortcut(t)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  tools: MarkupTools;
  state: ToolsState;
  /** Type whose style the controls edit: the active tool, or the selected markups' type. */
  styleType: MarkupType | null;
  enabled: boolean;
  /** Tools the active profile shows (null: all). */
  visibleTools: readonly Tool[] | null;
  onUndo: () => void;
  onRedo: () => void;
}

function toolTitle(tool: Tool) {
  const name = toolLabel(tool);
  const hint = TOOL_HINTS[tool];
  const key = toolShortcut(tool);
  return `${name}${key ? ` (${key})` : ''}${hint ? ` — ${hint}` : ''}`;
}

export function ToolBar({ tools, state, styleType, enabled, visibleTools, onUndo, onRedo }: Props) {
  const shown = ({ tool }: { tool: Tool }) => !visibleTools || visibleTools.includes(tool);
  const style = styleType ? (state.preset?.type === styleType && state.tool === styleType && state.preset.style ? state.preset.style : state.styles[styleType]) : null;
  const toolsPick = (tool: Tool) => tools.setTool(tool);
  return (
    <div className="toolbar tools">
      {TOOL_GROUPS.map((g) => {
        const tools = g.tools.filter((tool) => shown({ tool }));
        return tools.length ? <ToolGroup key={g.name} name={g.name} tools={tools} state={state} enabled={enabled} onPick={toolsPick} /> : null;
      })}
      <span className="sep" />
      {MEASURE_GROUPS.map((g) => {
        const tools = g.tools.filter((tool) => shown({ tool }));
        return tools.length ? <ToolGroup key={g.name} name={g.name} tools={tools} state={state} enabled={enabled} onPick={toolsPick} /> : null;
      })}
      {state.tool === 'dynamicFill' && (
        <label className="field" title="What Smart Fill makes from the region it finds">
          Fill as
          <select value={state.fillAs} onChange={(e) => tools.setFillAs(e.target.value as FillType)}>
            {FILL_TYPES.map((t) => (
              <option key={t} value={t}>
                {MARKUP_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field" title="Snap to drawing lines, endpoints and intersections (hold Alt to bypass; Shift for 45°)">
        <input type="checkbox" checked={state.snap} onChange={(e) => tools.setSnap(e.target.checked)} />
        Snap
      </label>
      <span className="sep" />
      <label className="field" title="Color">
        <input
          type="color"
          disabled={!style}
          value={style?.stroke ?? '#000000'}
          onChange={(e) => styleType && tools.setStyle(styleType, { stroke: e.target.value })}
        />
      </label>
      <label className="field" title="Fill">
        <input
          type="checkbox"
          disabled={!style || !styleType || !styleCapabilities(styleType).fill}
          checked={!!style?.fill}
          onChange={(e) => styleType && tools.setStyle(styleType, { fill: e.target.checked ? '#fef9c3' : null })}
        />
        Fill
      </label>
      <label className="field" title="Line width (pt)">
        <select
          disabled={!style}
          value={style?.width ?? 1}
          onChange={(e) => styleType && tools.setStyle(styleType, { width: Number(e.target.value) })}
        >
          {WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w} pt
            </option>
          ))}
        </select>
      </label>
      {style && styleType && styleCapabilities(styleType).dash && (
        <label className="field" title="Line style">
          <select value={style.dash ?? 'solid'} onChange={(e) => tools.setStyle(styleType, { dash: e.target.value === 'solid' ? undefined : (e.target.value as LineDash) })}>
            {LINE_DASHES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field" title="Opacity">
        <select disabled={!style} value={Math.round((style?.opacity ?? 1) * 100)} onChange={(e) => styleType && tools.setStyle(styleType, { opacity: Number(e.target.value) / 100 })}>
          {[100, 80, 60, 40, 20].map((o) => (
            <option key={o} value={o}>
              {o}%
            </option>
          ))}
          {style && ![100, 80, 60, 40, 20].includes(Math.round(style.opacity * 100)) && <option value={Math.round(style.opacity * 100)}>{Math.round(style.opacity * 100)}%</option>}
        </select>
      </label>
      {style && styleType && styleCapabilities(styleType).font && (
        <label className="field" title="Font">
          <select className="font-family" value={style.fontFamily ?? 'sans'} onChange={(e) => tools.setStyle(styleType, { fontFamily: e.target.value as FontFamily })}>
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.css }}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {style && styleType && styleCapabilities(styleType).font && (
        <label className="field" title="Font size (pt)">
          <input
            className="font-size"
            type="number"
            min={4}
            max={144}
            value={style.fontSize ?? ''}
            placeholder="Auto"
            onChange={(e) => Number(e.target.value) > 0 && tools.setStyle(styleType, { fontSize: Number(e.target.value) })}
          />
          pt
        </label>
      )}
      <span className="sep" />
      <button className="btn" disabled={!enabled} onClick={onUndo} title="Undo (Ctrl+Z)">
        ↶
      </button>
      <button className="btn" disabled={!enabled} onClick={onRedo} title="Redo (Ctrl+Y)">
        ↷
      </button>
      <button className="btn" disabled={!state.selected.size} onClick={() => tools.deleteSelected()} title="Delete (Del)">
        🗑
      </button>
    </div>
  );
}
