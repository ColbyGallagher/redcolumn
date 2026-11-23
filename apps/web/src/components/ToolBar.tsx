import { Children, Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HATCH_PATTERNS, isMeasureKind, TEXT_PADDING, lineEnds, MARKUP_LABELS, resolveHatch, styleCapabilities, type FontFamily, type HatchPattern, type HatchSpec, type LineEnding, type Markup, type MarkupStore, type MarkupStyle, type MarkupType, type StampDef, type StoredHatch, type TakeoffTemplate, type TextAlign, type VerticalAlign } from '@nb/markup';
import { ALIGN_ICONS, LineSpacing, NumberField, VALIGN_ICONS } from './PropertiesPanel';
import type { Scale } from '@nb/measure';
import { FILL_TYPES, isMarkupTool, toolLabel, type FillType, type MarkupTools, type Tool, type ToolsState } from '../markup/MarkupTools';
import { ComboField, FONT_SIZES } from './ComboField';
import { LineStyleSelect } from './LineStyleSelect';
import { CountSymbolSelect } from './CountSymbolSelect';
import { FontPicker } from './FontPicker';
import { customHatchName, HatchSwatch, LEGACY_HATCH_LABELS } from './HatchSwatch';
import { ShapeGeometry } from './ShapeGeometry';
import { StampMenu } from './StampsDialog';
import { STYLE_ICONS, TOOL_ICONS } from './toolIcons';
import { shortcutLabel } from '../commands/shortcuts';
import { useWorkspace } from '../workspace/profiles';
import { useFloatingPopup } from './useFloatingPopup';
import { ColorMenu } from './ColorMenu';
import { commonCapabilities, distinctIdentities, identityOf, identityPatch, sharedIdentity, styleMixed, toolIdentity, type IdentityField } from '../markup/selectionFormat';
import { saveToolBack } from '../toolchest/saveBack';
import { useMenubarSlot } from './menubarSlot';
import type { TakeoffAssemblyProps } from './RibbonAssembly';
import { takesAssembly } from '../assemblies/assemblyChoice';
import { useAssemblyChoice } from './AssemblyInputs';

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
  snapshot: 'drag a box, or click the corners of a shape (click the first corner, double-click or Enter to finish): the area is copied as a picture',
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
  eraseContent: 'drag over PDF content to remove it from the page, or click corners for an outline (click the first corner to finish)',
  cutContent: 'drag over PDF content to copy and remove it, or click corners for an outline (click the first corner to finish)',
  cutout: 'click the hole inside the area; click the first point to finish',
};

/** Cloud bubble sizes (pt): fine steps for everyday clouds, wider ones for very large bubbles. */
const BUBBLE_SIZES = [5, 10, 15, 20, 30, 40, 50, 60, 80, 100];
const MARKER_SIZES = [4, 6, 8, 10, 14, 20];

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
/** Types with no separate outer line vs interior/content: Line › Opacity dims the whole markup. */
const WHOLE_OPACITY_TYPES = new Set<MarkupType>(['highlighter', 'textHighlight', 'image', 'signature', 'stamp']);

/** What the Units & Scale group works on: the current page's scale, set the same way the navigation bar's scale list does. */
export interface UnitsScaleProps {
  scale: Scale | null;
  disabled: boolean;
  /** A scale picked from the list. */
  onPreset: (scale: Scale) => void;
  /** Opens the custom scale dialog. */
  onCustom: () => void;
  /** The default units (Preferences › Units) changed: the page scale is reworded to match. */
  onUnitsChanged: () => void;
}

export interface ToolBarProps {
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
  /** The selected markups (select mode, two or more), whose shared style the Format tab edits together. */
  selection?: { markups: readonly Markup[]; store: MarkupStore } | null;
  enabled: boolean;
  /**
   * The Markup Format tab's Units & Scale group: set while a measure tool is active or measurements are
   * selected (null otherwise, and the group is left out).
   */
  unitsScale?: UnitsScaleProps | null;
  /** The document's markup layers, offered by the Layer field. */
  layerNames?: readonly string[];
  /** Asks for a new layer's name (the Layer field's "New layer…"). */
  askLayer?: () => Promise<string | null>;
  /** Tools the active profile shows (null: all). */
  visibleTools: readonly Tool[] | null;
  /** Name filled into a stamp preview's {User} field. */
  author: string;
  onPlaceStamp: (stamp: StampDef) => void;
  onNewStamp: () => void;
  onManageStamps: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** The toolbar's display options (ribbon or simplified), at its right-hand end. */
  toolbarMenu?: ReactNode;
  /** Takeoff › Templates: the document's takeoff templates (the library's are read when the menu opens), and arming one. */
  takeoffTemplates?: { document: readonly TakeoffTemplate[]; onUse: (t: TakeoffTemplate) => void } | null;
  /** Takeoff › Assembly: the assembly (and its variables' values) the next measurements are taken off as. */
  takeoffAssembly?: TakeoffAssemblyProps | null;
}

export function toolTitle(tool: Tool) {
  const name = toolLabel(tool);
  const hint = TOOL_HINTS[tool];
  const key = toolShortcut(tool);
  return `${name}${key ? ` (${key})` : ''}${hint ? ` — ${hint}` : ''}`;
}

export function ToolBar({ tools, state, styleType, textType, textMarkupStyle, markups, selectedStyle, cloudBubble, geometry, selection, enabled, visibleTools, author, onPlaceStamp, onNewStamp, onManageStamps, onUndo, onRedo, toolbarMenu }: ToolBarProps) {
  const shown = ({ tool }: { tool: Tool }) => !visibleTools || visibleTools.includes(tool);
  const toolsPick = (tool: Tool) => tools.setTool(tool);
  const slot = useMenubarSlot();
  const row = (
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
      <StyleControls tools={tools} state={state} styleType={styleType} textType={textType} textMarkupStyle={textMarkupStyle} markups={markups} selectedStyle={selectedStyle} cloudBubble={cloudBubble} geometry={geometry} selection={selection} enabled={enabled} />
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
      {toolbarMenu && (
        <>
          <span className="grow" />
          {toolbarMenu}
        </>
      )}
    </div>
  );
  // In the menu bar's row, beside the redcolumn menu; without one, under it.
  return slot ? createPortal(row, slot) : row;
}

export type StyleControlsProps = Pick<ToolBarProps, 'tools' | 'state' | 'styleType' | 'textType' | 'textMarkupStyle' | 'markups' | 'selectedStyle' | 'cloudBubble' | 'geometry' | 'selection' | 'enabled'>;

/**
 * The style of what is being drawn or what is selected (colour, fill, width, line, opacity, hatch,
 * arrows, bubbles, font): shown after the tools on the simplified toolbar, and in the ribbon's
 * contextual Markup Format tab.
 */
export function StyleControls({ tools, state, styleType: toolStyleType, textType: toolTextType, textMarkupStyle, markups, selectedStyle, cloudBubble, geometry, selection, enabled }: StyleControlsProps) {
  // Two or more markups selected: the controls show what they share and edit them together. Of mixed
  // types, only the fields every type has; where their values differ a field reads "Mixed".
  const sel = selection && selection.markups.length > 1 ? selection : null;
  const selTypes = sel ? new Set(sel.markups.map((m) => m.type)) : null;
  const mixedTypes = !!sel && selTypes!.size > 1;
  const styleType = toolStyleType ?? (mixedTypes ? sel!.markups[0]!.type : null);
  const caps = mixedTypes ? commonCapabilities(selTypes!) : styleType ? styleCapabilities(styleType) : null;
  const style = mixedTypes ? sel!.markups[0]!.style : styleType ? (selectedStyle ?? (state.preset?.type === styleType && state.tool === styleType && state.preset.style ? state.preset.style : state.styles[styleType])) : null;
  const textType = mixedTypes ? (caps!.font ? styleType : null) : toolTextType;
  const textStyle = mixedTypes ? style : textType ? (textMarkupStyle ?? (textType === styleType ? style : state.styles[textType])) : null;
  const textCaps = textType ? (mixedTypes ? caps : styleCapabilities(textType)) : null;
  const mixedOf = <K extends keyof MarkupStyle>(key: K, resolve?: (v: MarkupStyle[K]) => unknown) => !!sel && styleMixed(sel.markups, key, resolve);
  const mixedDash = mixedOf('dash', (v) => v ?? 'solid') || mixedOf('dashArray') || mixedOf('lineStyle');
  const wholeOpacity = styleType ? (mixedTypes ? [...selTypes!].every((t) => WHOLE_OPACITY_TYPES.has(t)) : WHOLE_OPACITY_TYPES.has(styleType)) : false;
  const mixedFontSize = mixedOf('fontSize', (v) => (v === undefined ? undefined : Math.round(v)));
  const preview = (type: MarkupType, patch: Partial<MarkupStyle> | null) => {
    tools.previewStyle(patch, mixedTypes ? undefined : type);
  };
  // One edit to the whole selection is one undo step.
  const apply = (type: MarkupType, patch: Partial<MarkupStyle>) => {
    // A field commits on Enter and again on blur: the repeat changes nothing and must not make a second undo step.
    if (sel && sel.markups.every((m) => { const cur = sel.store.get(m.id)?.style ?? m.style; return (Object.keys(patch) as (keyof MarkupStyle)[]).every((k) => JSON.stringify(cur[k] ?? null) === JSON.stringify(patch[k] ?? null)); })) return;
    if (mixedTypes) {
      sel!.store.checkpoint();
      tools.applyStyle(sel!.markups.map((m) => m.id), patch);
    } else tools.setStyle(type, patch);
  };
  const hatchActive = !!style && !!resolveHatch(style.hatch, style.hatchSpec);
  return (
    <>
      {state.tool === 'dynamicFill' && (
        <label className="field" title="What Smart Fill makes from the region it finds">
          Fill as
          <select value={state.fillAs} disabled={!enabled} onChange={(e) => tools.setFillAs(e.target.value as FillType)}>
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
        <Cluster label="Line">
          <PropLine>
          <ColorMenu
            label="Line color"
            short="Line"
            title="Line color: the outline of the shape, or the line itself"
            icon={STYLE_ICONS.line}
            value={style.stroke}
            mixed={mixedOf('stroke')}
            disabled={!enabled}
            onChange={(c) => c && apply(styleType, { stroke: c })}
            onPreview={(c) => preview(styleType, c === undefined ? null : c ? { stroke: c } : null)}
          />
          {/* A text box drawn without its border has no outline to give a width to. */}
          {!(styleType === 'text' && !mixedTypes && (style.noBox || style.borderless)) && (
            <label className="field" title="Line width">
              <FieldTag icon={STYLE_ICONS.width} label="Width" />
              <ComboField
                title="Line width"
                value={mixedOf('width') ? undefined : style.width}
                placeholder={mixedOf('width') ? 'Mixed' : undefined}
                options={styleType === 'highlighter' ? HIGHLIGHT_WIDTHS : WIDTHS}
                min={0}
                max={200}
                unit="pt"
                disabled={!enabled}
                onChange={(w) => apply(styleType, { width: w })}
                onPreview={(w) => preview(styleType, w === null ? null : { width: w })}
              />
            </label>
          )}
          {textStyle && !mixedTypes && (textType === 'text' || textType === 'callout') && (
            <label className="field" title="Draw an outline around the text box (its fill draws either way)">
              <input
                type="checkbox"
                disabled={!enabled}
                checked={!textStyle.noBox && !textStyle.borderless}
                onChange={(e) => apply(textType, e.target.checked ? { noBox: undefined, borderless: undefined } : { noBox: undefined, borderless: true })}
              />
              Border
            </label>
          )}
          </PropLine>
          <PropLine>
          {caps!.dash && (
            <label className="field" title="Line style">
              <FieldTag icon={STYLE_ICONS.lineStyle} label="Line" />
              <LineStyleSelect
                style={style}
                mixed={mixedDash}
                disabled={!enabled}
                markups={markups}
                onChange={(patch) => apply(styleType, patch)}
                onPreview={(patch) => preview(styleType, patch)}
              />
            </label>
          )}
          <label className="field" title={wholeOpacity ? 'Opacity' : 'Opacity of the outer line'}>
            <FieldTag icon={STYLE_ICONS.opacity} label="Opacity" />
            {wholeOpacity ? (
              <ComboField
                title="Opacity"
                integer
                value={mixedOf('opacity') ? undefined : Math.round(style.opacity * 100)}
                placeholder={mixedOf('opacity') ? 'Mixed' : undefined}
                options={[100, 80, 60, 40, 20]}
                min={1}
                max={100}
                unit="%"
                disabled={!enabled}
                onChange={(o) => apply(styleType, { opacity: o / 100 })}
                onPreview={(o) => preview(styleType, o === null ? null : { opacity: o / 100 })}
              />
            ) : (
              <ComboField
                title="Line opacity"
                integer
                value={mixedOf('strokeOpacity', (v) => v ?? 1) ? undefined : Math.round((style.strokeOpacity ?? 1) * 100)}
                placeholder={mixedOf('strokeOpacity', (v) => v ?? 1) ? 'Mixed' : undefined}
                options={[100, 80, 60, 40, 20, 0]}
                min={0}
                max={100}
                unit="%"
                disabled={!enabled}
                onChange={(o) => apply(styleType, { strokeOpacity: o === 100 ? undefined : o / 100 })}
                onPreview={(o) => preview(styleType, o === null ? null : { strokeOpacity: o === 100 ? undefined : o / 100 })}
              />
            )}
          </label>
          </PropLine>
        </Cluster>
      )}
      {style && styleType && (
        <Cluster label="Fill">
          <PropLine>
          <ColorMenu
            label="Fill color"
            short="Fill"
            title="Fill color: the inside of the shape"
            icon={STYLE_ICONS.fill}
            value={style.fill ?? null}
            mixed={mixedOf('fill', (v) => v ?? null)}
            noneLabel="No fill"
            disabled={!enabled || !caps!.fill}
            onChange={(c) => apply(styleType, { fill: c })}
            onPreview={(c) => preview(styleType, c === undefined ? null : { fill: c })}
          />
          {caps!.fill && (style.fill || (sel && sel.markups.some((m) => m.style.fill))) && (
            <label className="field" title="Opacity of the fill alone">
              <FieldTag icon={STYLE_ICONS.fill} label="Opacity" />
              <ComboField
                title="Fill opacity"
                integer
                value={mixedOf('fillOpacity', (v) => v ?? 1) ? undefined : Math.round((style.fillOpacity ?? 1) * 100)}
                placeholder={mixedOf('fillOpacity', (v) => v ?? 1) ? 'Mixed' : undefined}
                options={[100, 80, 60, 40, 20]}
                min={1}
                max={100}
                unit="%"
                disabled={!enabled}
                onChange={(o) => apply(styleType, { fillOpacity: o / 100 })}
                onPreview={(o) => preview(styleType, o === null ? null : { fillOpacity: o / 100 })}
              />
            </label>
          )}
          </PropLine>
        </Cluster>
      )}
      {style && styleType && (
        <Cluster label="Hatch" show={!!caps!.hatch}>
          <PropLine>
            <div className="field" title="Hatch pattern">
              <FieldTag icon={STYLE_ICONS.hatch} />
              <HatchMenu
                bare
                mixed={mixedOf('hatch')}
                style={style}
                disabled={!enabled}
                onChange={(patch) => apply(styleType, patch)}
                onPreview={(patch) => preview(styleType, patch)}
              />
            </div>
          </PropLine>
          <PropLine>
            <HatchColor
              style={style}
              active={enabled && hatchActive}
              mixed={mixedOf('hatchColor', (v) => v ?? null)}
              onChange={(patch) => apply(styleType, patch)}
              onPreview={(patch) => preview(styleType, patch)}
            />
            <label className="field hatch-scale" title="50 is half the pattern, 200 is twice. 100 is a quarter inch.">
              <HatchScale style={style} active={enabled && hatchActive} mixed={mixedOf('hatchScale', (v) => v ?? 100)} onChange={(patch) => apply(styleType, patch)} />
            </label>
          </PropLine>
        </Cluster>
      )}
      {style && styleType && !mixedTypes && (styleType === 'length' || styleType === 'polylength') && (
        <Cluster label="Arrows">
          <PropLine>
          <div className="field" title="Arrowheads on the ends of the line">
            Arrows
            <PreviewSelect
              label="Arrowheads"
              value={lineEnds({ type: styleType, style })[1]}
              options={
                ARROW_CHOICES.some((c) => c.value === lineEnds({ type: styleType, style })[1])
                  ? ARROW_CHOICES
                  : [...ARROW_CHOICES, { value: lineEnds({ type: styleType, style })[1], label: 'Other' }]
              }
              disabled={!enabled}
              onChange={(cap) => apply(styleType, { startCap: cap, endCap: cap })}
              onPreview={(cap) => preview(styleType, cap === null ? null : { startCap: cap, endCap: cap })}
            />
          </div>
          </PropLine>
          <PropLine>
          {lineEnds({ type: styleType, style }).some((e) => e !== 'none') && (
            <label className="field">
              <ComboField
                title="Arrow size"
                integer
                value={Math.round((style.capScale ?? 1) * 100)}
                options={[50, 75, 100, 150, 200, 300]}
                min={10}
                max={1000}
                unit="%"
                disabled={!enabled}
                onChange={(v) => apply(styleType, { capScale: v / 100 })}
                onPreview={(v) => preview(styleType, v === null ? null : { capScale: v / 100 })}
              />
            </label>
          )}
          </PropLine>
        </Cluster>
      )}
      {cloudBubble && (
        <Cluster label="Cloud">
          <label className="field" title="Size of the cloud's bubbles (pt)">
            Bubbles
            <ComboField
              title="Bubble size"
              value={cloudBubble.value}
              options={BUBBLE_SIZES}
              min={1}
              max={200}
              unit="pt"
              placeholder="Auto"
              disabled={!enabled}
              onChange={(v) => tools.setStyle('cloud', { arcRadius: v })}
              onPreview={(v) => tools.previewStyle(v === null ? null : { arcRadius: v }, 'cloud')}
            />
          </label>
        </Cluster>
      )}
      {style && styleType === 'count' && !mixedTypes && (
        <Cluster label="Count">
          <PropLine>
            <div className="field" title="Marker shape or custom symbol">
              Shape
              <CountSymbolSelect
                style={style}
                markups={markups}
                mixed={mixedOf('countShape', (v) => v ?? 'circle') || mixedOf('countSymbol')}
                disabled={!enabled}
                onChange={(patch) => apply('count', patch)}
                onPreview={(patch) => preview('count', patch)}
              />
            </div>
          </PropLine>
          <PropLine>
            <label className="field" title="Size of the count marker (pt)">
              Size
              <ComboField
                title="Marker size"
                value={mixedOf('arcRadius') ? undefined : style.arcRadius}
                options={MARKER_SIZES}
                min={0.5}
                max={200}
                unit="pt"
                placeholder={mixedOf('arcRadius') ? 'Mixed' : 'Auto'}
                disabled={!enabled}
                onChange={(v) => apply('count', { arcRadius: v })}
                onPreview={(v) => preview('count', v === null ? null : { arcRadius: v })}
              />
            </label>
          </PropLine>
        </Cluster>
      )}
      <Cluster label="Text" show={!!textStyle && !!textType && textCaps!.font}>
      <PropLine>
      {textStyle && textType && textCaps!.font && (
        <div className="field" title="Font">
          <FieldTag icon={STYLE_ICONS.font} label="Font" />
          <FontPicker
            className="font-family"
            value={textStyle.fontFamily}
            mixed={!!mixedOf('fontFamily', (v) => v ?? 'sans')}
            disabled={!enabled}
            onChange={(family) => apply(textType, { fontFamily: family as FontFamily })}
            onPreview={(family) => preview(textType, family === null ? null : { fontFamily: family as FontFamily })}
          />
        </div>
      )}
      {textStyle && textType && textCaps!.font && (
        <label className="field" title="Font size (pt)">
          <FieldTag icon={STYLE_ICONS.fontSize} label="Size" />
          <ComboField
            title="Font size"
            integer
            value={mixedFontSize ? undefined : textStyle.fontSize !== undefined ? Math.round(textStyle.fontSize) : undefined}
            placeholder={mixedFontSize ? 'Mixed' : 'Auto'}
            options={FONT_SIZES}
            min={2}
            max={288}
            unit="pt"
            disabled={!enabled}
            onChange={(v) => apply(textType, { fontSize: Math.round(v) })}
            onPreview={(v) => preview(textType, v === null ? null : { fontSize: Math.round(v) })}
          />
        </label>
      )}
      {textStyle && textType && textCaps!.font && (
        <span className="seg" role="group" aria-label="Text style">
          <FormatToggle on={!!textStyle.bold} mixed={mixedOf('bold', (v) => !!v)} disabled={!enabled} label="B" title="Bold" className="b" onChange={(v) => apply(textType, { bold: v })} />
          <FormatToggle on={!!textStyle.italic} mixed={mixedOf('italic', (v) => !!v)} disabled={!enabled} label="I" title="Italic" className="i" onChange={(v) => apply(textType, { italic: v || undefined })} />
          <FormatToggle on={!!textStyle.underline} mixed={mixedOf('underline', (v) => !!v)} disabled={!enabled} label="U" title="Underline" className="u" onChange={(v) => apply(textType, { underline: v || undefined })} />
          <FormatToggle on={!!textStyle.strikethrough} mixed={mixedOf('strikethrough', (v) => !!v)} disabled={!enabled} label="S" title="Strikethrough" className="s" onChange={(v) => apply(textType, { strikethrough: v || undefined })} />
        </span>
      )}
      </PropLine>
      <PropLine>
      {textStyle && textType && textCaps!.font && textCaps!.textLayout && (
        <>
          <span className="seg" role="group" aria-label="Text alignment">
            {(['left', 'center', 'right', 'justify'] as TextAlign[]).map((a) => (
              <FormatToggle key={a} on={(textStyle.textAlign ?? 'left') === a} disabled={!enabled} label={ALIGN_ICONS[a]} title={a === 'justify' ? 'Justified' : `Align ${a}`} className="" onChange={() => apply(textType, { textAlign: a === 'left' ? undefined : a })} />
            ))}
          </span>
          <span className="seg" role="group" aria-label="Vertical alignment">
            {(['top', 'middle', 'bottom'] as VerticalAlign[]).map((a) => (
              <FormatToggle key={a} on={(textStyle.verticalAlign ?? 'top') === a} disabled={!enabled} label={VALIGN_ICONS[a]} title={`Align ${a}`} className="" onChange={() => apply(textType, { verticalAlign: a === 'top' ? undefined : a })} />
            ))}
          </span>
          <label className="field" title="Line spacing">
            Spacing
            <LineSpacing key={textType} value={textStyle.lineHeight} disabled={!enabled} onChange={(v) => apply(textType, { lineHeight: v })} />
          </label>
          <label className="field" title="Gap between the box edge and the text lines (measured to the line box, not the ink)">
            Padding
            <NumberField key={textType} value={textStyle.textMargin} placeholder={String(TEXT_PADDING)} min={0} max={50} step={0.5} unit="pt" disabled={!enabled} onChange={(v) => apply(textType, { textMargin: v })} />
          </label>
        </>
      )}
      </PropLine>
      </Cluster>
    </>
  );
}

/** One row inside a cluster (the ribbon stacks two); an empty row draws nothing. */
function PropLine({ children }: { children: ReactNode }) {
  if (Children.toArray(children).length === 0) return null;
  return <div className="prop-line">{children}</div>;
}

/**
 * A labelled cluster of related style controls (Line, Fill, Text). In the ribbon it draws as a block with
 * its name underneath; on the simplified toolbar it adds no box of its own.
 */
function Cluster({ label, show = true, children }: { label: string; show?: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <div className="prop-cluster" role="group" aria-label={label}>
      <div className="prop-cluster-items">{children}</div>
      <span className="prop-cluster-label">{label}</span>
    </div>
  );
}

const NEW_LAYER = '\u0000new-layer';
const MIXED = '\u0000mixed';

export type MarkupFieldsProps = Pick<ToolBarProps, 'tools' | 'state' | 'markups' | 'selection' | 'enabled' | 'layerNames' | 'askLayer' | 'takeoffAssembly'>;

/**
 * Subject, Label, Layer and Assembly in the Markup Format tab. With markups selected they edit those
 * markups (mixed values read "Mixed", and one edit is one undo step); with a drawing tool running they
 * edit what the tool gives the markups it places next, and the command carries on. A Tool Chest tool can
 * be saved back.
 */
export function MarkupFields({ tools, state, markups, selection, enabled, layerNames = [], askLayer, takeoffAssembly }: MarkupFieldsProps) {
  const sel = selection && selection.markups.length > 0 ? selection : null;
  const drawing = !sel && (isMarkupTool(state.tool) || state.tool === 'cloudPlus');
  const preset = state.preset;
  const ws = useWorkspace();
  const item = preset?.id ? ws.toolChests.flatMap((t) => t.items).find((i) => i.id === preset.id) : undefined;
  const asmChosen = (sel?.markups ?? []).filter(takesAssembly);
  const toolTakesAsm = !sel && isMeasureKind(state.tool) && state.tool !== 'angle';
  const asmMayEdit = !!takeoffAssembly && (asmChosen.length ? !!sel?.store && asmChosen.every((m) => sel.store.mayEdit(m)) : enabled && toolTakesAsm);
  const { choice: asmChoice, pick: pickAssembly, dialog: asmDialog } = useAssemblyChoice({
    chosen: asmChosen,
    selected: sel ? sel.markups.length : toolTakesAsm ? 0 : 1,
    store: sel?.store ?? null,
    canEdit: asmMayEdit,
    defaults: takeoffAssembly?.defaults ?? { subject: '', label: '' },
    onDefaults: (next) => takeoffAssembly?.onDefaults(next),
    assemblies: takeoffAssembly?.assemblies ?? [],
  });
  if (!sel && !drawing) return null;
  const canEditAssembly = asmMayEdit && asmChoice.target !== 'none';
  const base = { subject: preset?.subject, label: preset?.label, layer: preset?.layer };
  const edits = state.toolFields ?? {};
  // The Markups list names a markup with no subject of its own by its type, so the field shows that name too.
  const shownOf = (m: Markup, f: IdentityField) => identityOf(m, f) || (f === 'subject' ? MARKUP_LABELS[m.type] : '');
  const shown = (f: IdentityField): { value: string; mixed: boolean } => {
    if (!sel) return { value: toolIdentity(base, edits, f), mixed: false };
    if (f !== 'subject') return sharedIdentity(sel.markups, f);
    const names = sel.markups.map((m) => shownOf(m, f));
    return names.every((n) => n === names[0]) ? { value: names[0] ?? '', mixed: false } : { value: '', mixed: true };
  };
  const commit = (f: IdentityField, value: string) => {
    if (!enabled) return;
    if (!sel) {
      if (value !== toolIdentity(base, edits, f)) tools.setToolFields({ [f]: value });
      return;
    }
    const targets = sel.markups.map((m) => sel.store.get(m.id) ?? m).filter((m) => !m.locked && sel.store.mayEdit(m));
    // A field commits on Enter and again on blur: the repeat changes nothing and must not make a second undo step.
    const next = f === 'layer' ? value : value.trim();
    if (!targets.length || targets.every((m) => shownOf(m, f) === next)) return;
    sel.store.checkpoint();
    sel.store.batch(() => {
      for (const m of targets) sel.store.update(m.id, identityPatch(m, f, value));
    });
  };
  const idKey = sel ? sel.markups.map((m) => m.id).join(',') : `tool:${state.tool}`;
  const subject = shown('subject');
  const label = shown('label');
  const layer = shown('layer');
  const layers = [...new Set([...layerNames, ...(layer.value ? [layer.value] : [])])].sort((a, b) => a.localeCompare(b));
  const text = (f: IdentityField, title: string, name: string, current: { value: string; mixed: boolean }, list?: string) => (
    <label className="field" title={title}>
      {name}
      <input
        key={`${idKey}:${f}:${current.mixed ? 'mixed' : current.value}`}
        className="ident"
        type="text"
        list={list}
        aria-label={name}
        defaultValue={current.value}
        placeholder={current.mixed ? 'Mixed' : undefined}
        disabled={!enabled}
        onBlur={(e) => commit(f, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
  return (
    <div className="prop-cluster">
    <div className="prop-cluster-items">
    <PropLine>
      {text('subject', sel ? 'Subject of the selected markups' : 'Subject the next markups from this tool get', 'Subject', subject, 'ident-subjects')}
      <datalist id="ident-subjects">
        {distinctIdentities(markups, 'subject').map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {text('label', sel ? 'Label (category) of the selected markups' : 'Label (category) the next markups from this tool get', 'Label', label)}
    </PropLine>
    <PropLine>
      <label className="field" title={sel ? 'Layer of the selected markups' : 'Layer the next markups from this tool go on'}>
        Layer
        <select
          className="ident"
          aria-label="Layer"
          value={layer.mixed ? MIXED : layer.value}
          disabled={!enabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_LAYER) void askLayer?.().then((name) => name && commit('layer', name.trim()));
            else commit('layer', v);
          }}
        >
          {layer.mixed && (
            <option value={MIXED} disabled hidden>
              Mixed
            </option>
          )}
          <option value="">No layer</option>
          {layers.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
          {askLayer && <option value={NEW_LAYER}>New layer…</option>}
        </select>
      </label>
      <label
        className="field"
        title={
          !canEditAssembly
            ? 'Assemblies apply to measurement markups'
            : asmChosen.length
              ? 'Assembly the selected measurements are taken off as'
              : 'Assembly the next measurements are taken off as'
        }
      >
        Assembly
        <select
          className="ident"
          aria-label="Assembly"
          value={asmChoice.value}
          disabled={!canEditAssembly}
          onChange={(e) => (e.target.value === '__manage' ? takeoffAssembly?.onManage() : pickAssembly(e.target.value))}
        >
          {asmChoice.value === '*' && <option value="*">(several)</option>}
          <option value="">None</option>
          {(takeoffAssembly?.assemblies ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          {asmChoice.value && asmChoice.value !== '*' && !asmChoice.assembly && <option value={asmChoice.value}>(deleted assembly)</option>}
          <option value="__manage">Manage assemblies…</option>
        </select>
      </label>
      {drawing && item && (
        <button
          type="button"
          className="btn"
          title="Save this subject, label, layer and style back to the Tool Chest tool"
          disabled={!enabled}
          onClick={() => saveToolBack(item.id, { fields: edits, ...(preset?.style ? { style: preset.style } : {}) })}
        >
          Save to Tool Chest
        </button>
      )}
    </PropLine>
    </div>
    {asmDialog}
    </div>
  );
}

/** A toggle button; `mixed` (a selection that is half on) shows it indeterminate, and a click turns it on for all. */
function FormatToggle({ on, mixed, disabled, label, title, className, onChange }: { on: boolean; mixed?: boolean; disabled?: boolean; label: string; title: string; className: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" disabled={disabled} className={`seg-btn ${className}${mixed ? ' mixed' : on ? ' active' : ''}`} title={title} aria-label={title} aria-pressed={mixed ? 'mixed' : on} onClick={() => onChange(mixed ? true : !on)}>
      {label}
    </button>
  );
}

/** A compact listbox dropdown that previews options in real time as the user hovers or steps through them. */
function PreviewSelect<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
  onPreview,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
  onPreview?: (value: T | null) => void;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; width: number }>({ left: 0, width: 120 });
  const selectedIndex = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const flip = below < 160 && r.top - 8 > below;
    setBox({
      left: Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 130) - 4)),
      top: flip ? undefined : r.bottom + 2,
      bottom: flip ? window.innerHeight - r.top + 2 : undefined,
      width: Math.max(r.width, 130),
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      previewRef.current?.(null);
      return;
    }
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
  useEffect(() => () => previewRef.current?.(null), []);

  const pick = (v: T) => {
    onPreview?.(null);
    setOpen(false);
    if (v !== value) onChange(v);
  };
  const move = (i: number) => {
    const next = Math.max(0, Math.min(options.length - 1, i));
    setActive(next);
    const opt = options[next];
    if (opt) onPreview?.(opt.value);
  };
  const shown = options[selectedIndex]?.label ?? value;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        className="ls-select"
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else {
            setActive(selectedIndex >= 0 ? selectedIndex : 0);
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setActive(selectedIndex >= 0 ? selectedIndex : 0);
              setOpen(true);
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            move(active + 1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            move(active - 1);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const opt = options[active];
            if (opt) pick(opt.value);
          } else if (e.key === 'Tab') setOpen(false);
        }}
      >
        <span className="ls-name">{shown}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="ls-list"
            style={{ left: box.left, top: box.top, bottom: box.bottom, width: box.width }}
            onMouseDown={(e) => e.preventDefault()}
            onMouseLeave={() => onPreview?.(null)}
          >
            {options.map((opt, i) => (
              <div
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                className={`ls-option${i === active ? ' active' : ''}`}
                onMouseEnter={() => {
                  setActive(i);
                  onPreview?.(opt.value);
                }}
                onClick={() => pick(opt.value)}
              >
                <span className="ls-name">{opt.label}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
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

/** Hatch pattern dropdown (and color/scale when not `bare`), with real-time hover preview. */
function HatchMenu({ style, mixed, disabled, bare, onChange, onPreview }: { style: MarkupStyle; mixed?: boolean; disabled: boolean; /** Pattern list only: the colour and scale sit beside the dropdown instead. */ bare?: boolean; onChange: (patch: Partial<MarkupStyle>) => void; onPreview?: (patch: Partial<MarkupStyle> | null) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const floating = useFloatingPopup(root, open);
  useEffect(() => {
    if (!open) {
      previewRef.current?.(null);
      return;
    }
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      // The color menu opened from here is its own portal, so a click in it is not outside.
      if (!root.current?.contains(t) && !pop.current?.contains(t) && !(t as Element).closest?.('.color-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the color menu opened from here first, not this popup as well.
      if (e.key === 'Escape' && !document.querySelector('.color-pop')) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => () => previewRef.current?.(null), []);

  const current = style.hatch;
  const { hatchSets } = useWorkspace();
  const active = !!resolveHatch(current, style.hatchSpec);
  const color = style.hatchColor ?? style.stroke;
  const name = mixed ? 'Mixed' : !current ? 'None' : (HATCH_PATTERNS.find((h) => h.value === current)?.label ?? (current.startsWith('set:') ? customHatchName(current) : LEGACY_HATCH_LABELS[current]) ?? 'None');
  const patchFor = (value: 'none' | HatchPattern | StoredHatch, spec?: HatchSpec): Partial<MarkupStyle> =>
    value === 'none' ? { hatch: undefined, hatchSpec: undefined, hatchColor: undefined, hatchScale: undefined } : { hatch: value, hatchSpec: spec };
  const choose = (value: 'none' | HatchPattern | StoredHatch, spec?: HatchSpec) => {
    onPreview?.(null);
    onChange(patchFor(value, spec));
    if (bare) setOpen(false);
  };
  return (
    <div className="hatch-menu" ref={root}>
      <button
        type="button"
        role="combobox"
        className={`ls-select hatch-select${active ? ' on' : ''}`}
        disabled={disabled}
        aria-label="Hatch pattern"
        title="Hatch pattern"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        {active && current && <HatchSwatch pattern={current} spec={style.hatchSpec} color={color} width={24} height={14} />}
        <span className="ls-name">{name}</span>
      </button>
      {open && floating && createPortal(
        <div className="hatch-pop" role="listbox" aria-label="Hatch" ref={pop} style={{ ...floating, minWidth: undefined }} onMouseLeave={() => onPreview?.(null)}>
          {HATCH_PATTERNS.map((h) => {
            const on = h.value === 'none' ? !current : current === h.value;
            return (
              <button
                key={h.value}
                type="button"
                role="option"
                aria-selected={on}
                className={`hatch-choice${on ? ' on' : ''}`}
                onMouseEnter={() => onPreview?.(h.value === 'none' ? { hatch: undefined, hatchSpec: undefined } : { hatch: h.value, hatchSpec: undefined })}
                onFocus={() => onPreview?.(h.value === 'none' ? { hatch: undefined, hatchSpec: undefined } : { hatch: h.value, hatchSpec: undefined })}
                onClick={() => choose(h.value)}
              >
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
                  <button
                    key={h.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`hatch-choice${on ? ' on' : ''}`}
                    onMouseEnter={() => onPreview?.({ hatch: h.id, hatchSpec: h.spec })}
                    onFocus={() => onPreview?.({ hatch: h.id, hatchSpec: h.spec })}
                    onClick={() => choose(h.id, h.spec)}
                  >
                    <HatchSwatch pattern={h.id} spec={h.spec} color={color} width={48} height={22} />
                    {h.name}
                  </button>
                );
              })}
            </div>
          ))}
          {current && !HATCH_PATTERNS.some((h) => h.value === current) && !hatchSets.some((s) => s.hatches.some((h) => h.id === current)) && (
            <button
              type="button"
              role="option"
              aria-selected
              className="hatch-choice on"
              onMouseEnter={() => onPreview?.({ hatch: current, hatchSpec: style.hatchSpec })}
              onClick={() => choose(current, style.hatchSpec)}
            >
              <HatchSwatch pattern={current} spec={style.hatchSpec} color={color} width={48} height={22} />
              {current.startsWith('set:') ? customHatchName(current) : (LEGACY_HATCH_LABELS[current] ?? current)}
            </button>
          )}
          {!bare && (
            <>
              <div className="hatch-pop-row">
                <HatchColor wide style={style} active={active} onChange={onChange} onPreview={onPreview} />
              </div>
              <div className="hatch-pop-row">
                <HatchScale style={style} active={active} onChange={onChange} />
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function HatchColor({ wide, style, active, mixed, onChange, onPreview }: { wide?: boolean; style: MarkupStyle; active: boolean; mixed?: boolean; onChange: (patch: Partial<MarkupStyle>) => void; onPreview?: (patch: Partial<MarkupStyle> | null) => void }) {
  return (
    <ColorMenu
      wide={wide}
      label="Hatch color"
      short="Hatch"
      icon={STYLE_ICONS.hatch}
      value={style.hatchColor ?? null}
      mixed={mixed}
      fallback={style.stroke}
      noneLabel="Same as line"
      disabled={!active}
      onChange={(c) => onChange({ hatchColor: c ?? undefined })}
      onPreview={onPreview ? (c) => onPreview(c === undefined ? null : { hatchColor: c ?? undefined }) : undefined}
    />
  );
}

function HatchScale({ style, active, mixed, onChange }: { style: MarkupStyle; active: boolean; mixed?: boolean; onChange: (patch: Partial<MarkupStyle>) => void }) {
  return (
    <>
      <span>Scale</span>
      <input
        type="number"
        aria-label="Hatch scale"
        disabled={!active}
        min={50}
        max={200}
        step={1}
        value={mixed ? '' : (style.hatchScale ?? 100)}
        placeholder={mixed ? 'Mixed' : undefined}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange({ hatchScale: Math.min(200, Math.max(50, n)) });
        }}
      />
      <span>%</span>
    </>
  );
}

/** Icons for markup types not drawn with a tool of their own name. */
const TYPE_ONLY_ICONS: Partial<Record<string, ReactNode>> = { signature: '✍', flag: '⚑', count: '#', flowShape: '▭', connector: '↳' };

/** The icon of a markup's type (the tool that draws it), as the toolbar shows it. */
export function markupTypeIcon(type: string): ReactNode {
  return [...MARKUP_TOOLS, ...MEASURE_TOOLS].find((t) => t.tool === type)?.icon ?? TYPE_ONLY_ICONS[type] ?? '◆';
}
