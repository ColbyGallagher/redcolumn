import { msg, msgc } from '@nb/i18n';
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
import { commonCapabilities, distinctIdentities, identityOf, identityPatch, isCloudPlusSelection, isMixed, sharedIdentity, styleMixed, toolIdentity, type IdentityField } from '../markup/selectionFormat';
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
  /** The English name: a stable key. */
  id: string;
  /** The name shown, in the interface language. */
  readonly label: string;
  tools: ToolEntry[];
}

export const MARKUP_GROUPS: ToolGroup[] = [
  {
    id: 'Select',
    get label() {
      return msg('Select');
    },
    tools: [
      { tool: 'select', icon: '⬉' },
      { tool: 'lasso', icon: '◌' },
    ],
  },
  {
    id: 'Lines',
    get label() {
      return msg('Lines');
    },
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
    id: 'Shapes',
    get label() {
      return msg('Shapes');
    },
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
    id: 'Freehand',
    get label() {
      return msg('Freehand');
    },
    tools: [
      { tool: 'pen', icon: '✎' },
      { tool: 'highlighter', icon: TOOL_ICONS.highlighter },
      { tool: 'eraser', icon: TOOL_ICONS.eraser },
    ],
  },
  {
    id: 'Text Markup',
    get label() {
      return msg('Text Markup');
    },
    tools: [
      { tool: 'textHighlight', icon: 'H̲' },
      { tool: 'underline', icon: 'U̲' },
      { tool: 'strikeout', icon: 'S̶' },
      { tool: 'squiggly', icon: 'W̰' },
      { tool: 'replaceText', icon: 'R̶‸' },
    ],
  },
  {
    id: 'Text & Notes',
    get label() {
      return msg('Text & Notes');
    },
    tools: [
      { tool: 'text', icon: 'T' },
      { tool: 'callout', icon: '↘T' },
      { tool: 'typewriter', icon: 'Aa' },
      { tool: 'flagLabel', icon: TOOL_ICONS.flagLabel },
      { tool: 'note', icon: '▤' },
    ],
  },
  {
    id: 'Insert',
    get label() {
      return msg('Insert');
    },
    tools: [
      { tool: 'image', icon: TOOL_ICONS.image },
      { tool: 'stamp', icon: TOOL_ICONS.stamp },
      { tool: 'attachment', icon: '📎' },
      { tool: 'hyperlink', icon: '🔗' },
      { tool: 'snapshot', icon: '📷' },
    ],
  },
  {
    id: 'Tables & Areas',
    get label() {
      return msg('Tables & Areas');
    },
    tools: [
      { tool: 'legend', icon: '☷' },
      { tool: 'table', icon: '▦' },
      { tool: 'space', icon: '⬚' },
      { tool: 'redaction', icon: '▇' },
    ],
  },
];

export const MEASURE_GROUPS: ToolGroup[] = [
  { id: 'Scale', get label() { return msg('Scale'); }, tools: [{ tool: 'calibrate', icon: '⇹' }] },
  {
    id: 'Lengths',
    get label() {
      return msg('Lengths');
    },
    tools: [
      { tool: 'length', icon: '↔' },
      { tool: 'polylength', icon: '⤳' },
      { tool: 'perimeter', icon: '⬠' },
      { tool: 'arcLength', icon: '◠' },
    ],
  },
  {
    id: 'Circles & Angles',
    get label() {
      return msg('Circles & Angles');
    },
    tools: [
      { tool: 'diameter', icon: '⌀' },
      { tool: 'radius', icon: '◔' },
      { tool: 'angle', icon: '∠' },
    ],
  },
  {
    id: 'Areas & Volumes',
    get label() {
      return msg('Areas & Volumes');
    },
    tools: [
      { tool: 'area', icon: '▰' },
      { tool: 'volume', icon: '⬙' },
      { tool: 'dynamicFill', icon: '🪣' },
    ],
  },
  {
    id: 'Counts',
    get label() {
      return msg('Counts');
    },
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

/** Tooltips for the text alignment buttons (functions: msg runs at render, not import). */
const ALIGN_TITLES: Record<TextAlign, () => string> = {
  left: () => msg('Align left'),
  center: () => msg('Align center'),
  right: () => msg('Align right'),
  justify: () => msg('Justified'),
};
const VALIGN_TITLES: Record<VerticalAlign, () => string> = {
  top: () => msg('Align top'),
  middle: () => msg('Align middle'),
  bottom: () => msg('Align bottom'),
};

/** Cloud bubble sizes (pt): fine steps for everyday clouds, wider ones for very large bubbles. */
const BUBBLE_SIZES = [5, 10, 15, 20, 30, 40, 50, 60, 80, 100];
const MARKER_SIZES = [4, 6, 8, 10, 14, 20];

/** What a measurement line can end in from the toolbar (more in Properties). */
const ARROW_CHOICES: { value: LineEnding; label: string }[] = [
  { value: 'filledArrow', get label() { return msg('Filled arrow'); } },
  { value: 'openArrow', get label() { return msg('Open arrow'); } },
  { value: 'closedArrow', get label() { return msg('Closed arrow'); } },
  { value: 'tick', get label() { return msg('Tick'); } },
  { value: 'none', get label() { return msg('None'); } },
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
      <button className="btn" disabled={!enabled} onClick={onUndo} title={msg('Undo (Ctrl+Z)')}>
        ↶
      </button>
      <button className="btn" disabled={!enabled} onClick={onRedo} title={msg('Redo (Ctrl+Y)')}>
        ↷
      </button>
      <button className="btn" disabled={!state.selected.size} onClick={() => tools.deleteSelected()} title={msg('Delete (Del)')}>
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
  // Cloud+ pairs a cloud with a callout: both when drawing and when selected, cloud and text box widths (and the text box's border & font) stay independent.
  const cloudPlus = sel ? isCloudPlusSelection(sel.markups) : state.tool === 'cloudPlus';
  const clouds = cloudPlus && sel ? sel.markups.filter((m) => m.type === 'cloud') : null;
  const callouts = cloudPlus && sel ? sel.markups.filter((m) => m.type === 'callout') : null;
  const styleType = toolStyleType ?? (mixedTypes ? sel!.markups[0]!.type : null);
  const caps = mixedTypes ? commonCapabilities(selTypes!) : styleType ? styleCapabilities(styleType) : null;
  const style = mixedTypes ? sel!.markups[0]!.style : styleType ? (selectedStyle ?? (state.preset?.type === styleType && state.tool === styleType && state.preset.style ? state.preset.style : state.styles[styleType])) : null;
  const cloudStyle = cloudPlus ? (clouds ? clouds[0]!.style : style) : null;
  const textType = cloudPlus ? 'callout' : mixedTypes ? (caps!.font ? styleType : null) : toolTextType;
  const textStyle = cloudPlus ? (callouts ? callouts[0]!.style : (textMarkupStyle ?? state.styles.callout)) : mixedTypes ? style : textType ? (textMarkupStyle ?? (textType === styleType ? style : state.styles[textType])) : null;
  const textCaps = textType ? (cloudPlus ? styleCapabilities('callout') : mixedTypes ? caps : styleCapabilities(textType)) : null;
  const mixedOf = <K extends keyof MarkupStyle>(key: K, resolve?: (v: MarkupStyle[K]) => unknown) => !!sel && styleMixed(sel.markups, key, resolve);
  const textMarkups = cloudPlus ? callouts : sel?.markups ?? null;
  const textMixedOf = <K extends keyof MarkupStyle>(key: K, resolve?: (v: MarkupStyle[K]) => unknown) => !!textMarkups && styleMixed(textMarkups, key, resolve);
  const cloudWidthMixed = !!clouds && styleMixed(clouds, 'width');
  const calloutWidthMixed = !!callouts && styleMixed(callouts, 'width');
  const cloudFillMixed = !!clouds && styleMixed(clouds, 'fill', (v) => v ?? null);
  const calloutFillMixed = !!callouts && styleMixed(callouts, 'fill', (v) => v ?? null);
  const cloudFillOpacityMixed = !!clouds && styleMixed(clouds, 'fillOpacity', (v) => v ?? 1);
  const calloutFillOpacityMixed = !!callouts && styleMixed(callouts, 'fillOpacity', (v) => v ?? 1);
  const borderMixed = !!textMarkups && isMixed(textMarkups.map((m) => !m.style.noBox && !m.style.borderless));
  const mixedDash = mixedOf('dash', (v) => v ?? 'solid') || mixedOf('dashArray') || mixedOf('lineStyle');
  const wholeOpacity = styleType ? (mixedTypes ? [...selTypes!].every((t) => WHOLE_OPACITY_TYPES.has(t)) : WHOLE_OPACITY_TYPES.has(styleType)) : false;
  const mixedFontSize = textMixedOf('fontSize', (v) => (v === undefined ? undefined : Math.round(v)));
  const preview = (type: MarkupType, patch: Partial<MarkupStyle> | null) => {
    tools.previewStyle(patch, mixedTypes ? undefined : type);
  };
  const previewType = (type: MarkupType, patch: Partial<MarkupStyle> | null) => {
    tools.previewStyle(patch, type);
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
  // Applies only to markups (or defaults) of `type`, even when a Cloud+ pair is selected.
  const applyType = (type: MarkupType, patch: Partial<MarkupStyle>) => {
    if (sel) {
      const targets = sel.markups.filter((m) => m.type === type);
      if (targets.length && targets.every((m) => { const cur = sel.store.get(m.id)?.style ?? m.style; return (Object.keys(patch) as (keyof MarkupStyle)[]).every((k) => JSON.stringify(cur[k] ?? null) === JSON.stringify(patch[k] ?? null)); })) return;
    }
    tools.setStyle(type, patch);
  };
  const applyText = (type: MarkupType, patch: Partial<MarkupStyle>) => (cloudPlus ? applyType(type, patch) : apply(type, patch));
  const previewText = (type: MarkupType, patch: Partial<MarkupStyle> | null) => (cloudPlus ? previewType(type, patch) : preview(type, patch));
  const hatchActive = !!style && !!resolveHatch(style.hatch, style.hatchSpec);
  return (
    <>
      {state.tool === 'dynamicFill' && (
        <label className="field" title={msg('What Smart Fill makes from the region it finds')}>
          {msg('Fill as')}
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
        <Cluster label={msg('Line')}>
          <PropLine>
          <ColorMenu
            label={msg('Line color')}
            short={msg('Line')}
            title={msg('Line color: the outline of the shape, or the line itself')}
            icon={STYLE_ICONS.line}
            value={style.stroke}
            mixed={mixedOf('stroke')}
            disabled={!enabled}
            onChange={(c) => c && apply(styleType, { stroke: c })}
            onPreview={(c) => preview(styleType, c === undefined ? null : c ? { stroke: c } : null)}
          />
          {/* Cloud+ has separate cloud and text box line widths; a borderless text box has no outline to give a width to. */}
          {cloudPlus && cloudStyle && textStyle ? (
            <>
              <label className="field" title={msg('Cloud line width')}>
                <FieldTag icon={STYLE_ICONS.width} label={msg('Cloud')} />
                <ComboField
                  title={msg('Cloud line width')}
                  value={cloudWidthMixed ? undefined : cloudStyle.width}
                  placeholder={cloudWidthMixed ? msg('Mixed') : undefined}
                  options={WIDTHS}
                  min={0}
                  max={200}
                  unit="pt"
                  disabled={!enabled}
                  onChange={(w) => applyType('cloud', { width: w })}
                  onPreview={(w) => previewType('cloud', w === null ? null : { width: w })}
                />
              </label>
              <label className="field" title={msg('Text box line width')}>
                <FieldTag icon={STYLE_ICONS.width} label={msg('Text box')} />
                <ComboField
                  title={msg('Text box line width')}
                  value={calloutWidthMixed ? undefined : textStyle.width}
                  placeholder={calloutWidthMixed ? msg('Mixed') : undefined}
                  options={WIDTHS}
                  min={0}
                  max={200}
                  unit="pt"
                  disabled={!enabled}
                  onChange={(w) => applyType('callout', { width: w })}
                  onPreview={(w) => previewType('callout', w === null ? null : { width: w })}
                />
              </label>
            </>
          ) : !(styleType === 'text' && !mixedTypes && (style.noBox || style.borderless)) && (
            <label className="field" title={msg('Line width')}>
              <FieldTag icon={STYLE_ICONS.width} label={msg('Width')} />
              <ComboField
                title={msg('Line width')}
                value={mixedOf('width') ? undefined : style.width}
                placeholder={mixedOf('width') ? msg('Mixed') : undefined}
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
          {textStyle && (!mixedTypes || cloudPlus) && (textType === 'text' || textType === 'callout') && (
            <label className="field" title={msg('Draw an outline around the text box (its fill draws either way)')}>
              <input
                type="checkbox"
                disabled={!enabled}
                checked={!borderMixed && !textStyle.noBox && !textStyle.borderless}
                ref={(el) => { if (el) el.indeterminate = borderMixed; }}
                onChange={(e) => applyType(textType, e.target.checked ? { noBox: undefined, borderless: undefined } : { noBox: undefined, borderless: true })}
              />
              {msg('Border')}
            </label>
          )}
          </PropLine>
          <PropLine>
          {caps!.dash && (
            <label className="field" title={msg('Line style')}>
              <FieldTag icon={STYLE_ICONS.lineStyle} label={msg('Line')} />
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
          <label className="field" title={wholeOpacity ? msg('Opacity') : msg('Opacity of the outer line')}>
            <FieldTag icon={STYLE_ICONS.opacity} label={msg('Opacity')} />
            {wholeOpacity ? (
              <ComboField
                title={msg('Opacity')}
                integer
                value={mixedOf('opacity') ? undefined : Math.round(style.opacity * 100)}
                placeholder={mixedOf('opacity') ? msg('Mixed') : undefined}
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
                title={msg('Line opacity')}
                integer
                value={mixedOf('strokeOpacity', (v) => v ?? 1) ? undefined : Math.round((style.strokeOpacity ?? 1) * 100)}
                placeholder={mixedOf('strokeOpacity', (v) => v ?? 1) ? msg('Mixed') : undefined}
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
        <Cluster label={msg('Fill')}>
          {cloudPlus && cloudStyle && textStyle ? (
            <>
              <PropLine>
                <ColorMenu
                  label={msg('Cloud fill color')}
                  short={msg('Cloud')}
                  title={msg('Cloud fill color: the inside of the cloud')}
                  icon={STYLE_ICONS.fill}
                  value={cloudStyle.fill ?? null}
                  mixed={cloudFillMixed}
                  noneLabel="No fill"
                  disabled={!enabled}
                  onChange={(c) => applyType('cloud', { fill: c })}
                  onPreview={(c) => previewType('cloud', c === undefined ? null : { fill: c })}
                />
                {(cloudStyle.fill || (clouds && clouds.some((m) => m.style.fill))) && (
                  <label className="field" title={msg('Opacity of the cloud fill alone')}>
                    <FieldTag icon={STYLE_ICONS.fill} label={msg('Opacity')} />
                    <ComboField
                      title={msg('Cloud fill opacity')}
                      integer
                      value={cloudFillOpacityMixed ? undefined : Math.round((cloudStyle.fillOpacity ?? 1) * 100)}
                      placeholder={cloudFillOpacityMixed ? msg('Mixed') : undefined}
                      options={[100, 80, 60, 40, 20]}
                      min={1}
                      max={100}
                      unit="%"
                      disabled={!enabled}
                      onChange={(o) => applyType('cloud', { fillOpacity: o / 100 })}
                      onPreview={(o) => previewType('cloud', o === null ? null : { fillOpacity: o / 100 })}
                    />
                  </label>
                )}
              </PropLine>
              <PropLine>
                <ColorMenu
                  label={msg('Text box fill color')}
                  short={msg('Text box')}
                  title={msg('Text box fill color: the background of the text box')}
                  icon={STYLE_ICONS.fill}
                  value={textStyle.fill ?? null}
                  mixed={calloutFillMixed}
                  noneLabel="No fill"
                  disabled={!enabled}
                  onChange={(c) => applyType('callout', { fill: c })}
                  onPreview={(c) => previewType('callout', c === undefined ? null : { fill: c })}
                />
                {(textStyle.fill || (callouts && callouts.some((m) => m.style.fill))) && (
                  <label className="field" title={msg('Opacity of the text box fill alone')}>
                    <FieldTag icon={STYLE_ICONS.fill} label={msg('Opacity')} />
                    <ComboField
                      title={msg('Text box fill opacity')}
                      integer
                      value={calloutFillOpacityMixed ? undefined : Math.round((textStyle.fillOpacity ?? 1) * 100)}
                      placeholder={calloutFillOpacityMixed ? msg('Mixed') : undefined}
                      options={[100, 80, 60, 40, 20]}
                      min={1}
                      max={100}
                      unit="%"
                      disabled={!enabled}
                      onChange={(o) => applyType('callout', { fillOpacity: o / 100 })}
                      onPreview={(o) => previewType('callout', o === null ? null : { fillOpacity: o / 100 })}
                    />
                  </label>
                )}
              </PropLine>
            </>
          ) : (
            <PropLine>
              <ColorMenu
                label={msg('Fill color')}
                short={msg('Fill')}
                title={msg('Fill color: the inside of the shape')}
                icon={STYLE_ICONS.fill}
                value={style.fill ?? null}
                mixed={mixedOf('fill', (v) => v ?? null)}
                noneLabel="No fill"
                disabled={!enabled || !caps!.fill}
                onChange={(c) => apply(styleType, { fill: c })}
                onPreview={(c) => preview(styleType, c === undefined ? null : { fill: c })}
              />
              {caps!.fill && (style.fill || (sel && sel.markups.some((m) => m.style.fill))) && (
                <label className="field" title={msg('Opacity of the fill alone')}>
                  <FieldTag icon={STYLE_ICONS.fill} label={msg('Opacity')} />
                  <ComboField
                    title={msg('Fill opacity')}
                    integer
                    value={mixedOf('fillOpacity', (v) => v ?? 1) ? undefined : Math.round((style.fillOpacity ?? 1) * 100)}
                    placeholder={mixedOf('fillOpacity', (v) => v ?? 1) ? msg('Mixed') : undefined}
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
          )}
        </Cluster>
      )}
      {style && styleType && (
        <Cluster label={msg('Hatch')} show={!!caps!.hatch}>
          <PropLine>
            <div className="field" title={msg('Hatch pattern')}>
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
            <label className="field hatch-scale" title={msg('50 is half the pattern, 200 is twice. 100 is a quarter inch.')}>
              <HatchScale style={style} active={enabled && hatchActive} mixed={mixedOf('hatchScale', (v) => v ?? 100)} onChange={(patch) => apply(styleType, patch)} />
            </label>
          </PropLine>
        </Cluster>
      )}
      {style && styleType && !mixedTypes && (styleType === 'length' || styleType === 'polylength') && (
        <Cluster label={msg('Arrows')}>
          <PropLine>
          <div className="field" title={msg('Arrowheads on the ends of the line')}>
            {msg('Arrows')}
            <PreviewSelect
              label={msg('Arrowheads')}
              value={lineEnds({ type: styleType, style })[1]}
              options={
                ARROW_CHOICES.some((c) => c.value === lineEnds({ type: styleType, style })[1])
                  ? ARROW_CHOICES
                  : [...ARROW_CHOICES, { value: lineEnds({ type: styleType, style })[1], label: msg('Other') }]
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
                title={msg('Arrow size')}
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
        <Cluster label={msg('Cloud')}>
          <label className="field" title={msg('Size of the cloud\'s bubbles (pt)')}>
            {msg('Bubbles')}
            <ComboField
              title={msg('Bubble size')}
              value={cloudBubble.value}
              options={BUBBLE_SIZES}
              min={1}
              max={200}
              unit="pt"
              placeholder={msg('Auto')}
              disabled={!enabled}
              onChange={(v) => tools.setStyle('cloud', { arcRadius: v })}
              onPreview={(v) => tools.previewStyle(v === null ? null : { arcRadius: v }, 'cloud')}
            />
          </label>
        </Cluster>
      )}
      {style && styleType === 'count' && !mixedTypes && (
        <Cluster label={msg('Count')}>
          <PropLine>
            <div className="field" title={msg('Marker shape or custom symbol')}>
              {msg('Shape')}
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
            <label className="field" title={msg('Size of the count marker (pt)')}>
              {msg('Size')}
              <ComboField
                title={msg('Marker size')}
                value={mixedOf('arcRadius') ? undefined : style.arcRadius}
                options={MARKER_SIZES}
                min={0.5}
                max={200}
                unit="pt"
                placeholder={mixedOf('arcRadius') ? msg('Mixed') : msg('Auto')}
                disabled={!enabled}
                onChange={(v) => apply('count', { arcRadius: v })}
                onPreview={(v) => preview('count', v === null ? null : { arcRadius: v })}
              />
            </label>
          </PropLine>
        </Cluster>
      )}
      <Cluster label={msg('Text')} kind="text" show={!!textStyle && !!textType && textCaps!.font}>
      <PropLine>
      {textStyle && textType && textCaps!.font && (
        <div className="field" title={msg('Font')}>
          <FieldTag icon={STYLE_ICONS.font} label={msg('Font')} />
          <FontPicker
            className="font-family"
            value={textStyle.fontFamily}
            mixed={!!textMixedOf('fontFamily', (v) => v ?? 'sans')}
            disabled={!enabled}
            onChange={(family) => applyText(textType, { fontFamily: family as FontFamily })}
            onPreview={(family) => previewText(textType, family === null ? null : { fontFamily: family as FontFamily })}
          />
        </div>
      )}
      {textStyle && textType && textCaps!.font && (
        <label className="field" title={msg('Font size (pt)')}>
          <FieldTag icon={STYLE_ICONS.fontSize} label={msg('Size')} />
          <ComboField
            title={msg('Font size')}
            integer
            value={mixedFontSize ? undefined : textStyle.fontSize !== undefined ? Math.round(textStyle.fontSize) : undefined}
            placeholder={mixedFontSize ? msg('Mixed') : msg('Auto')}
            options={FONT_SIZES}
            min={2}
            max={288}
            unit="pt"
            disabled={!enabled}
            onChange={(v) => applyText(textType, { fontSize: Math.round(v) })}
            onPreview={(v) => previewText(textType, v === null ? null : { fontSize: Math.round(v) })}
          />
        </label>
      )}
      {textStyle && textType && textCaps!.font && (
        <span className="seg" role="group" aria-label={msg('Text style')}>
          <FormatToggle on={!!textStyle.bold} mixed={textMixedOf('bold', (v) => !!v)} disabled={!enabled} label="B" title={msg('Bold')} className="b" onChange={(v) => applyText(textType, { bold: v })} />
          <FormatToggle on={!!textStyle.italic} mixed={textMixedOf('italic', (v) => !!v)} disabled={!enabled} label="I" title={msg('Italic')} className="i" onChange={(v) => applyText(textType, { italic: v || undefined })} />
          <FormatToggle on={!!textStyle.underline} mixed={textMixedOf('underline', (v) => !!v)} disabled={!enabled} label="U" title={msg('Underline')} className="u" onChange={(v) => applyText(textType, { underline: v || undefined })} />
          <FormatToggle on={!!textStyle.strikethrough} mixed={textMixedOf('strikethrough', (v) => !!v)} disabled={!enabled} label="S" title={msg('Strikethrough')} className="s" onChange={(v) => applyText(textType, { strikethrough: v || undefined })} />
        </span>
      )}
      </PropLine>
      <PropLine>
      {textStyle && textType && textCaps!.font && textCaps!.textLayout && (
        <>
          <span className="seg" role="group" aria-label={msg('Text alignment')}>
            {(['left', 'center', 'right', 'justify'] as TextAlign[]).map((a) => (
              <FormatToggle key={a} on={(textStyle.textAlign ?? 'left') === a} disabled={!enabled} label={ALIGN_ICONS[a]} title={ALIGN_TITLES[a]()} className="" onChange={() => applyText(textType, { textAlign: a === 'left' ? undefined : a })} />
            ))}
          </span>
          <span className="seg" role="group" aria-label={msg('Vertical alignment')}>
            {(['top', 'middle', 'bottom'] as VerticalAlign[]).map((a) => (
              <FormatToggle key={a} on={(textStyle.verticalAlign ?? 'top') === a} disabled={!enabled} label={VALIGN_ICONS[a]} title={VALIGN_TITLES[a]()} className="" onChange={() => applyText(textType, { verticalAlign: a === 'top' ? undefined : a })} />
            ))}
          </span>
          <label className="field" title={msg('Line spacing')}>
            {msg('Spacing')}
            <LineSpacing key={textType} value={textStyle.lineHeight} disabled={!enabled} onChange={(v) => applyText(textType, { lineHeight: v })} />
          </label>
          <label className="field" title={msg('Gap between the box edge and the text lines (measured to the line box, not the ink)')}>
            {msg('Padding')}
            <NumberField key={textType} value={textStyle.textMargin} placeholder={String(TEXT_PADDING)} min={0} max={50} step={0.5} unit="pt" disabled={!enabled} onChange={(v) => applyText(textType, { textMargin: v })} />
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
function Cluster({ label, kind, show = true, children }: { label: string; /** A name for styles: never translated. */ kind?: string; show?: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <div className="prop-cluster" role="group" aria-label={label} data-cluster={kind}>
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
        placeholder={current.mixed ? msg('Mixed') : undefined}
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
      {text('subject', sel ? msg('Subject of the selected markups') : msg('Subject the next markups from this tool get'), msg('Subject'), subject, 'ident-subjects')}
      <datalist id="ident-subjects">
        {distinctIdentities(markups, 'subject').map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {text('label', sel ? msg('Label (category) of the selected markups') : msg('Label (category) the next markups from this tool get'), msg('Label'), label)}
    </PropLine>
    <PropLine>
      <label className="field" title={sel ? msg('Layer of the selected markups') : msg('Layer the next markups from this tool go on')}>
        {msg('Layer')}
        <select
          className="ident"
          aria-label={msg('Layer')}
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
              {msg('Mixed')}
            </option>
          )}
          <option value="">{msg('No layer')}</option>
          {layers.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
          {askLayer && <option value={NEW_LAYER}>{msg('New layer…')}</option>}
        </select>
      </label>
      <label
        className="field"
        title={
          !canEditAssembly
            ? msg('Assemblies apply to measurement markups')
            : asmChosen.length
              ? msg('Assembly the selected measurements are taken off as')
              : msg('Assembly the next measurements are taken off as')
        }
      >
        {msg('Assembly')}
        <select
          className="ident"
          aria-label={msg('Assembly')}
          value={asmChoice.value}
          disabled={!canEditAssembly}
          onChange={(e) => (e.target.value === '__manage' ? takeoffAssembly?.onManage() : pickAssembly(e.target.value))}
        >
          {asmChoice.value === '*' && <option value="*">{msg('(several)')}</option>}
          <option value="">{msg('None')}</option>
          {(takeoffAssembly?.assemblies ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          {asmChoice.value && asmChoice.value !== '*' && !asmChoice.assembly && <option value={asmChoice.value}>{msg('(deleted assembly)')}</option>}
          <option value="__manage">{msg('Manage assemblies…')}</option>
        </select>
      </label>
      {drawing && item && (
        <button
          type="button"
          className="btn"
          title={msg('Save this subject, label, layer and style back to the Tool Chest tool')}
          disabled={!enabled}
          onClick={() => saveToolBack(item.id, { fields: edits, ...(preset?.style ? { style: preset.style } : {}) })}
        >
          {msg('Save to Tool Chest')}
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
  const name = mixed ? msg('Mixed') : !current ? msg('None') : (HATCH_PATTERNS.find((h) => h.value === current)?.label ?? (current.startsWith('set:') ? customHatchName(current) : LEGACY_HATCH_LABELS[current]) ?? msg('None'));
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
        aria-label={msg('Hatch pattern')}
        title={msg('Hatch pattern')}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        {active && current && <HatchSwatch pattern={current} spec={style.hatchSpec} color={color} width={24} height={14} />}
        <span className="ls-name">{name}</span>
      </button>
      {open && floating && createPortal(
        <div className="hatch-pop" role="listbox" aria-label={msg('Hatch')} ref={pop} style={{ ...floating, minWidth: undefined }} onMouseLeave={() => onPreview?.(null)}>
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
      label={msg('Hatch color')}
      short={msgc('colour button', 'Hatch')}
      icon={STYLE_ICONS.hatch}
      value={style.hatchColor ?? null}
      mixed={mixed}
      fallback={style.stroke}
      noneLabel={msg('Same as line')}
      disabled={!active}
      onChange={(c) => onChange({ hatchColor: c ?? undefined })}
      onPreview={onPreview ? (c) => onPreview(c === undefined ? null : { hatchColor: c ?? undefined }) : undefined}
    />
  );
}

function HatchScale({ style, active, mixed, onChange }: { style: MarkupStyle; active: boolean; mixed?: boolean; onChange: (patch: Partial<MarkupStyle>) => void }) {
  return (
    <>
      <span>{msgc('hatch pattern size', 'Scale')}</span>
      <input
        type="number"
        aria-label={msg('Hatch scale')}
        disabled={!active}
        min={50}
        max={200}
        step={1}
        value={mixed ? '' : (style.hatchScale ?? 100)}
        placeholder={mixed ? msg('Mixed') : undefined}
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
