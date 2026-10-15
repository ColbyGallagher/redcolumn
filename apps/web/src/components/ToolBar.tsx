import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { FONT_FAMILIES, HATCH_PATTERNS, lineEnds, MARKUP_LABELS, resolveHatch, styleCapabilities, type FontFamily, type HatchPattern, type HatchSpec, type LineEnding, type Markup, type MarkupStore, type MarkupStyle, type MarkupType, type StampDef, type StoredHatch } from '@nb/markup';
import type { Scale } from '@nb/measure';
import { FILL_TYPES, toolLabel, type FillType, type MarkupTools, type Tool, type ToolsState } from '../markup/MarkupTools';
import { ComboField } from './ComboField';
import { LineStyleSelect } from './LineStyleSelect';
import { customHatchName, HatchSwatch, LEGACY_HATCH_LABELS } from './HatchSwatch';
import { ShapeGeometry } from './ShapeGeometry';
import { StampMenu } from './StampsDialog';
import { STYLE_ICONS, TOOL_ICONS } from './toolIcons';
import { shortcutLabel } from '../commands/shortcuts';
import { useWorkspace } from '../workspace/profiles';

/** How a tool's shortcut is shown in menus and tooltips, e.g. `L` or `Shift+N` (from the active profile). */
export function toolShortcut(tool: Tool): string | undefined {
  return shortcutLabel(`tool.${tool}`);
}

/** A toolbar tool and the icon its button shows (a text glyph, or a drawn icon from toolIcons). */
export interface ToolEntry {
  tool: Tool;
  icon: ReactNode;
}

/** A named run of related tools: kept together on the toolbar and as a submenu in tool menus. */
export interface ToolGroup {
  label: string;
  tools: ToolEntry[];
}

export const MARKUP_GROUPS: ToolGroup[] = [
  {
    label: 'Select',
    tools: [
      { tool: 'select', icon: '⬉' },
      { tool: 'lasso', icon: '◌' },
    ],
  },
  {
    label: 'Lines',
    tools: [
      { tool: 'line', icon: '╱' },
      { tool: 'arrow', icon: '↗' },
      { tool: 'dimension', icon: '⟷' },
      { tool: 'polyline', icon: TOOL_ICONS.polyline },
      { tool: 'arc', icon: '⌒' },
      { tool: 'ellipticalArc', icon: '◜' },
    ],
  },
  {
    label: 'Shapes',
    tools: [
      { tool: 'rect', icon: '▭' },
      { tool: 'ellipse', icon: '◯' },
      { tool: 'polygon', icon: '⬡' },
      { tool: 'cloud', icon: '☁' },
      { tool: 'polygonCloud', icon: '⛅' },
      { tool: 'cloudPlus', icon: '☁⁺' },
    ],
  },
  {
    label: 'Freehand',
    tools: [
      { tool: 'pen', icon: '✎' },
      { tool: 'highlighter', icon: TOOL_ICONS.highlighter },
      { tool: 'eraser', icon: TOOL_ICONS.eraser },
    ],
  },
  {
    label: 'Text Markup',
    tools: [
      { tool: 'textHighlight', icon: 'H̲' },
      { tool: 'underline', icon: 'U̲' },
      { tool: 'strikeout', icon: 'S̶' },
      { tool: 'squiggly', icon: 'W̰' },
      { tool: 'replaceText', icon: 'R̶‸' },
    ],
  },
  {
    label: 'Text & Notes',
    tools: [
      { tool: 'text', icon: 'T' },
      { tool: 'callout', icon: '↘T' },
      { tool: 'typewriter', icon: 'Aa' },
      { tool: 'flagLabel', icon: TOOL_ICONS.flagLabel },
      { tool: 'note', icon: '▤' },
    ],
  },
  {
    label: 'Insert',
    tools: [
      { tool: 'image', icon: TOOL_ICONS.image },
      { tool: 'stamp', icon: TOOL_ICONS.stamp },
      { tool: 'attachment', icon: '📎' },
      { tool: 'hyperlink', icon: '🔗' },
      { tool: 'snapshot', icon: '📷' },
    ],
  },
  {
    label: 'Tables & Areas',
    tools: [
      { tool: 'legend', icon: '☷' },
      { tool: 'table', icon: '▦' },
      { tool: 'space', icon: '⬚' },
      { tool: 'redaction', icon: '▇' },
    ],
  },
];

export const MEASURE_GROUPS: ToolGroup[] = [
  { label: 'Scale', tools: [{ tool: 'calibrate', icon: '⇹' }] },
  {
    label: 'Lengths',
    tools: [
      { tool: 'length', icon: '↔' },
      { tool: 'polylength', icon: '⤳' },
      { tool: 'perimeter', icon: '⬠' },
      { tool: 'arcLength', icon: '◠' },
    ],
  },
  {
    label: 'Circles & Angles',
    tools: [
      { tool: 'diameter', icon: '⌀' },
      { tool: 'radius', icon: '◔' },
      { tool: 'angle', icon: '∠' },
    ],
  },
  {
    label: 'Areas & Volumes',
    tools: [
      { tool: 'area', icon: '▰' },
      { tool: 'volume', icon: '⬙' },
      { tool: 'dynamicFill', icon: '🪣' },
    ],
  },
  {
    label: 'Counts',
    tools: [
      { tool: 'count', icon: '#' },
      { tool: 'visualSearch', icon: '🔍' },
    ],
  },
];

export const MARKUP_TOOLS: ToolEntry[] = MARKUP_GROUPS.flatMap((g) => g.tools);
export const MEASURE_TOOLS: ToolEntry[] = MEASURE_GROUPS.flatMap((g) => g.tools);

const TOOL_HINTS: Partial<Record<Tool, string>> = {
  polyline: 'click points; double-click or Enter to finish',
  polygon: 'click vertices; click the first point, double-click or Enter to finish',
  arc: 'click the start, a point on the curve, then the end',
  ellipticalArc: 'drag out the ellipse; set its start and end angles in Properties',
  polygonCloud: 'click vertices; click the first point, double-click or Enter to finish',
  typewriter: 'click where to type',
  stamp: 'opens the stamps; pick one, then click or drag to place it',
  legend: 'drag a box; it lists the markups on the page with quantities and totals',
  table: 'drag a box (or click), then choose its rows and columns; right-click for rows and columns, double-click a cell to type',
  eraser: 'rub out parts of pen and highlighter strokes (Tools › Eraser for sizes and the whole-markup eraser)',
  dimension: 'drag a line; type the dimension text',
  replaceText: 'drag across the text to replace; type the new wording',
  attachment: 'choose a file, then click to place its paperclip',
  snapshot: 'drag a box: the area is copied as a picture',
  highlighter: 'over text, drag to mark the words; hold Ctrl to draw a free stroke, or draw where there is no text',
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

/** Cloud bubble sizes (pt): fine steps for everyday clouds, wider ones for very large bubbles. */
const BUBBLE_SIZES = [5, 10, 15, 20, 30, 40, 50, 60, 80, 100];

/** What a measurement line can end in from the toolbar (more in Properties). */
const ARROW_CHOICES: { value: LineEnding; label: string }[] = [
  { value: 'filledArrow', label: 'Filled arrow' },
  { value: 'openArrow', label: 'Open arrow' },
  { value: 'closedArrow', label: 'Closed arrow' },
  { value: 'tick', label: 'Tick' },
  { value: 'none', label: 'None' },
];

const WIDTHS = [0.5, 1, 1.5, 2, 3, 5, 8, 12, 16, 24];
/** The highlighter sweeps wide bands. */
const HIGHLIGHT_WIDTHS = [4, 8, 12, 16, 20, 30, 40, 60, 80, 100, 150, 200];

interface Props {
  tools: MarkupTools;
  state: ToolsState;
  /** Type whose style the controls edit: the active tool, or the selected markups' type. */
  styleType: MarkupType | null;
  /** Cloud bubble size (pt): the selected cloud's, else the default for new ones (undefined: sized to the zoom). */
  /** Type whose font controls the toolbar shows (a Cloud+ offers its callout's). */
  textType: MarkupType | null;
  /** Style of the selected text markup, which the text controls show instead of the tool's defaults. */
  textMarkupStyle?: MarkupStyle;
  /** The open document's markups: their custom line styles are offered in the Line picker. */
  markups: readonly Markup[];
  /** Style of the selected markup (select mode), which the style controls show instead of the tool's defaults. */
  selectedStyle?: MarkupStyle;
  cloudBubble: { value: number | undefined } | null;
  /** Draw to Scale: the selected shape whose sizes the toolbar edits. */
  geometry: { markup: Markup; scale: Scale; store: MarkupStore; readOnly: boolean } | null;
  enabled: boolean;
  /** Tools the active profile shows (null: all). */
  visibleTools: readonly Tool[] | null;
  /** Name filled into a stamp preview's {User} field. */
  author: string;
  onPlaceStamp: (stamp: StampDef) => void;
  onNewStamp: () => void;
  onManageStamps: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

function toolTitle(tool: Tool) {
  const name = toolLabel(tool);
  const hint = TOOL_HINTS[tool];
  const key = toolShortcut(tool);
  return `${name}${key ? ` (${key})` : ''}${hint ? ` — ${hint}` : ''}`;
}

export function ToolBar({ tools, state, styleType, textType, textMarkupStyle, markups, selectedStyle, cloudBubble, geometry, enabled, visibleTools, author, onPlaceStamp, onNewStamp, onManageStamps, onUndo, onRedo }: Props) {
  const shown = ({ tool }: { tool: Tool }) => !visibleTools || visibleTools.includes(tool);
  const style = styleType ? (selectedStyle ?? (state.preset?.type === styleType && state.tool === styleType && state.preset.style ? state.preset.style : state.styles[styleType])) : null;
  const textStyle = textType ? (textMarkupStyle ?? (textType === styleType ? style : state.styles[textType])) : null;
  const toolsPick = (tool: Tool) => tools.setTool(tool);
  return (
    <div className="toolbar tools">
      {[MARKUP_GROUPS, MEASURE_GROUPS].map((groups, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep" />}
          {groups
            .map((g) => ({ ...g, tools: g.tools.filter(shown) }))
            .filter((g) => g.tools.length)
            .map((g) => (
              <span key={g.label} className="tool-group" role="group" aria-label={g.label}>
          {g.tools.map(({ tool, icon }) =>
            tool === 'stamp' ? (
              <StampMenu
                key={tool}
                icon={icon}
                disabled={!enabled}
                active={state.tool === 'stamp'}
                title={toolTitle(tool)}
                author={author}
                currentId={state.tool === 'stamp' ? (state.preset?.stamp?.id ?? null) : null}
                onPlace={onPlaceStamp}
                onNew={onNewStamp}
                onManage={onManageStamps}
              />
            ) : (
              <button key={tool} className={`btn tool${state.tool === tool && !state.preset ? ' active' : ''}`} data-toolbar-tool={tool} disabled={!enabled} title={toolTitle(tool)} onClick={() => toolsPick(tool)}>
                {icon}
              </button>
            ),
          )}
              </span>
            ))}
        </Fragment>
      ))}
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
      <span className="sep" />
      {geometry && (
        <>
          <ShapeGeometry key={geometry.markup.id} {...geometry} />
          <span className="sep" />
        </>
      )}
      {style && styleType && (
        <>
          <label className="field" title="Color">
            <input
              type="color"
              value={style.stroke}
              onChange={(e) => tools.setStyle(styleType, { stroke: e.target.value })}
            />
          </label>
          <label className="field" title="Fill">
            <FieldTag icon={STYLE_ICONS.fill} />
            <input
              type="checkbox"
              disabled={!styleCapabilities(styleType).fill}
              checked={!!style.fill}
              onChange={(e) => tools.setStyle(styleType, { fill: e.target.checked ? '#fef9c3' : null })}
            />
            Fill
          </label>
          <label className="field" title="Line width">
            <FieldTag icon={STYLE_ICONS.width} label="Width" />
            <ComboField
              title="Line width"
              value={style.width}
              options={styleType === 'highlighter' ? HIGHLIGHT_WIDTHS : WIDTHS}
              min={0}
              max={200}
              unit="pt"
              onChange={(w) => tools.setStyle(styleType, { width: w })}
            />
          </label>
          {styleCapabilities(styleType).dash && (
            <label className="field" title="Line style">
              <FieldTag icon={STYLE_ICONS.lineStyle} label="Line" />
              <LineStyleSelect style={style} markups={markups} onChange={(patch) => tools.setStyle(styleType, patch)} />
            </label>
          )}
          <label className="field" title="Opacity">
            <FieldTag icon={STYLE_ICONS.opacity} label="Opacity" />
            <ComboField title="Opacity" value={Math.round(style.opacity * 100)} options={[100, 80, 60, 40, 20]} min={1} max={100} unit="%" onChange={(o) => tools.setStyle(styleType, { opacity: o / 100 })} />
          </label>
          {styleCapabilities(styleType).hatch && <HatchMenu style={style} disabled={!enabled} onChange={(patch) => tools.setStyle(styleType, patch)} />}
        </>
      )}
      {style && styleType && (styleType === 'length' || styleType === 'polylength') && (
        <>
          <label className="field" title="Arrowheads on the ends of the line">
            Arrows
            <select
              value={lineEnds({ type: styleType, style })[1]}
              onChange={(e) => tools.setStyle(styleType, { startCap: e.target.value as LineEnding, endCap: e.target.value as LineEnding })}
            >
              {ARROW_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
              {!ARROW_CHOICES.some((c) => c.value === lineEnds({ type: styleType, style })[1]) && <option value={lineEnds({ type: styleType, style })[1]}>Other</option>}
            </select>
          </label>
          {lineEnds({ type: styleType, style }).some((e) => e !== 'none') && (
            <label className="field">
              <ComboField title="Arrow size" value={Math.round((style.capScale ?? 1) * 100)} options={[50, 75, 100, 150, 200, 300]} min={10} max={1000} unit="%" onChange={(v) => tools.setStyle(styleType, { capScale: v / 100 })} />
            </label>
          )}
        </>
      )}
      {cloudBubble && (
        <label className="field" title="Size of the cloud's bubbles (pt)">
          Bubbles
          <ComboField title="Bubble size" value={cloudBubble.value} options={BUBBLE_SIZES} min={1} max={200} unit="pt" placeholder="Auto" onChange={(v) => tools.setStyle('cloud', { arcRadius: v })} />
        </label>
      )}
      {textStyle && (textType === 'text' || textType === 'callout') && (
        <label className="field" title="Draw the box around the text (outline and fill)">
          <input type="checkbox" checked={!textStyle.noBox} onChange={(e) => tools.setStyle(textType, { noBox: e.target.checked ? undefined : true })} />
          Box
        </label>
      )}
      {textStyle && (textType === 'text' || textType === 'callout') && !textStyle.noBox && (
        <label className="field" title="Draw an outline around the text box (its fill draws either way)">
          <input type="checkbox" checked={!textStyle.borderless} onChange={(e) => tools.setStyle(textType, { borderless: e.target.checked ? undefined : true })} />
          Border
        </label>
      )}
      {textStyle && textType && styleCapabilities(textType).font && (
        <label className="field" title="Font">
          <FieldTag icon={STYLE_ICONS.font} label="Font" />
          <select className="font-family" value={textStyle.fontFamily ?? 'sans'} onChange={(e) => tools.setStyle(textType, { fontFamily: e.target.value as FontFamily })}>
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.css }}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {textStyle && textType && styleCapabilities(textType).font && (
        <label className="field" title="Font size (pt)">
          <FieldTag icon={STYLE_ICONS.fontSize} label="Size" />
          <input
            className="font-size"
            type="number"
            min={4}
            max={144}
            value={textStyle.fontSize ?? ''}
            placeholder="Auto"
            onChange={(e) => Number(e.target.value) > 0 && tools.setStyle(textType, { fontSize: Number(e.target.value) })}
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

/**
 * Whether the style controls carry a short text label beside their icon ("Width", "Opacity", …).
 * On trial: turn off if the toolbar reads as cluttered.
 */
const SHOW_FIELD_LABELS = true;

/** The icon (and, with SHOW_FIELD_LABELS, the short label) that names a toolbar style control. */
function FieldTag({ icon, label }: { icon: ReactNode; label?: string }) {
  return (
    <>
      <span className="field-icon">{icon}</span>
      {SHOW_FIELD_LABELS && label && <span className="field-label">{label}</span>}
    </>
  );
}

/** Hatch pattern, color and scale, behind one toolbar button. */
function HatchMenu({ style, disabled, onChange }: { style: MarkupStyle; disabled: boolean; onChange: (patch: Partial<MarkupStyle>) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = style.hatch;
  const { hatchSets } = useWorkspace();
  const active = !!resolveHatch(current, style.hatchSpec);
  const color = style.hatchColor ?? style.stroke;
  const name = !current ? 'Hatch' : (HATCH_PATTERNS.find((h) => h.value === current)?.label ?? (current.startsWith('set:') ? customHatchName(current) : LEGACY_HATCH_LABELS[current]) ?? 'Hatch');
  const choose = (value: 'none' | HatchPattern | StoredHatch, spec?: HatchSpec) => {
    if (value === 'none') onChange({ hatch: undefined, hatchSpec: undefined, hatchColor: undefined, hatchScale: undefined });
    else onChange({ hatch: value, hatchSpec: spec });
  };
  return (
    <div className="hatch-menu" ref={root}>
      <button type="button" className={`btn hatch-btn${active ? ' on' : ''}`} disabled={disabled} title="Hatch pattern, color and scale" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        <span className="field-icon">{STYLE_ICONS.hatch}</span>
        {name}
        {active && current && <HatchSwatch pattern={current} spec={style.hatchSpec} color={color} width={36} height={18} />}
      </button>
      {open && (
        <div className="hatch-pop" role="dialog" aria-label="Hatch">
          {HATCH_PATTERNS.map((h) => {
            const on = h.value === 'none' ? !current : current === h.value;
            return (
              <button key={h.value} type="button" className={`hatch-choice${on ? ' on' : ''}`} aria-pressed={on} onClick={() => choose(h.value)}>
                {h.value !== 'none' && <HatchSwatch pattern={h.value} color={color} width={48} height={22} />}
                {h.label}
              </button>
            );
          })}
          {hatchSets.map((set) => (
            <div key={set.title} className="hatch-group">
              <div className="hatch-group-title">{set.title}</div>
              {set.hatches.map((h) => {
                const on = current === h.id;
                return (
                  <button key={h.id} type="button" className={`hatch-choice${on ? ' on' : ''}`} aria-pressed={on} onClick={() => choose(h.id, h.spec)}>
                    <HatchSwatch pattern={h.id} spec={h.spec} color={color} width={48} height={22} />
                    {h.name}
                  </button>
                );
              })}
            </div>
          ))}
          {current && !HATCH_PATTERNS.some((h) => h.value === current) && !hatchSets.some((s) => s.hatches.some((h) => h.id === current)) && (
            <button type="button" className="hatch-choice on" aria-pressed onClick={() => choose(current, style.hatchSpec)}>
              <HatchSwatch pattern={current} spec={style.hatchSpec} color={color} width={48} height={22} />
              {current.startsWith('set:') ? customHatchName(current) : (LEGACY_HATCH_LABELS[current] ?? current)}
            </button>
          )}
          <div className="hatch-pop-row">
            <span>Color</span>
            <input type="color" aria-label="Hatch color" disabled={!active} value={color} onChange={(e) => onChange({ hatchColor: e.target.value })} />
          </div>
          <div className="hatch-pop-row">
            <span>Scale</span>
            <input
              type="number"
              aria-label="Hatch scale"
              disabled={!active}
              min={50}
              max={200}
              step={1}
              value={style.hatchScale ?? 100}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) onChange({ hatchScale: Math.min(200, Math.max(50, n)) });
              }}
            />
            <span>%</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Icons for markup types not drawn with a tool of their own name. */
const TYPE_ONLY_ICONS: Partial<Record<string, ReactNode>> = { signature: '✍', flag: '⚑', count: '#' };

/** The icon of a markup's type (the tool that draws it), as the toolbar shows it. */
export function markupTypeIcon(type: string): ReactNode {
  return [...MARKUP_TOOLS, ...MEASURE_TOOLS].find((t) => t.tool === type)?.icon ?? TYPE_ONLY_ICONS[type] ?? '◆';
}
