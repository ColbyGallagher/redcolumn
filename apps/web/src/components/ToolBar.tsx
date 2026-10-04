import { Fragment } from 'react';
import { FONT_FAMILIES, lineEnds, LINE_DASHES, MARKUP_LABELS, styleCapabilities, type FontFamily, type LineDash, type LineEnding, type Markup, type MarkupStore, type MarkupStyle, type MarkupType } from '@nb/markup';
import type { Scale } from '@nb/measure';
import { FILL_TYPES, toolLabel, type FillType, type MarkupTools, type Tool, type ToolsState } from '../markup/MarkupTools';
import { ComboField } from './ComboField';
import { ShapeGeometry } from './ShapeGeometry';
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

const ICONS = new Map([...MARKUP_TOOLS, ...MEASURE_TOOLS].map((t) => [t.tool, t.icon]));

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
  cloudBubble: { value: number | undefined } | null;
  /** Draw to Scale: the selected shape whose sizes the toolbar edits. */
  geometry: { markup: Markup; scale: Scale; store: MarkupStore; readOnly: boolean } | null;
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

export function ToolBar({ tools, state, styleType, textType, textMarkupStyle, cloudBubble, geometry, enabled, visibleTools, onUndo, onRedo }: Props) {
  const shown = ({ tool }: { tool: Tool }) => !visibleTools || visibleTools.includes(tool);
  const style = styleType ? (state.preset?.type === styleType && state.tool === styleType && state.preset.style ? state.preset.style : state.styles[styleType]) : null;
  const textStyle = textType ? (textMarkupStyle ?? (textType === styleType ? style : state.styles[textType])) : null;
  const toolsPick = (tool: Tool) => tools.setTool(tool);
  return (
    <div className="toolbar tools">
      {[MARKUP_TOOLS, MEASURE_TOOLS].map((list, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep" />}
          {list.filter(shown).map(({ tool, icon }) => (
            <button key={tool} className={`btn tool${state.tool === tool && !state.preset ? ' active' : ''}`} data-toolbar-tool={tool} disabled={!enabled} title={toolTitle(tool)} onClick={() => toolsPick(tool)}>
              {icon}
            </button>
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
            <input
              type="checkbox"
              disabled={!styleCapabilities(styleType).fill}
              checked={!!style.fill}
              onChange={(e) => tools.setStyle(styleType, { fill: e.target.checked ? '#fef9c3' : null })}
            />
            Fill
          </label>
          <label className="field">
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
              <select value={style.dash ?? 'solid'} onChange={(e) => tools.setStyle(styleType, { dash: e.target.value === 'solid' ? undefined : (e.target.value as LineDash) })}>
                {LINE_DASHES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <ComboField title="Opacity" value={Math.round(style.opacity * 100)} options={[100, 80, 60, 40, 20]} min={1} max={100} unit="%" onChange={(o) => tools.setStyle(styleType, { opacity: o / 100 })} />
          </label>
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
      {textStyle && textType && styleCapabilities(textType).font && (
        <label className="field" title="Font">
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
