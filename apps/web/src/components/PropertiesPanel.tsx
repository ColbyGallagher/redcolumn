import { msg, msgParts } from '@nb/i18n';
import { markupName } from '../i18n/names';
import { keyed } from '../i18n/keyed';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BLEND_MODES,
  CELL_STYLE_KEYS,
  DEFAULT_STYLES,
  effectiveBlendMode,
  tableCellFormat,
  tableCellStyle,
  HATCH_PATTERNS,
  LINE_ENDINGS,
  lineEnds,
  resolveHatch,
  MARKUP_LABELS,
  measureProps,
  refillStamp,
  styleCapabilities,
  TEXT_PADDING,
  type FontFamily,
  type LineEnding,
  type Markup,
  type MarkupDocument,
  type MarkupStyle,
  type Alignment,
  type BlendMode,
  type MarkupType,
  type StoredHatch,
  type StyleCapabilities,
  type TextAlign,
  type VerticalAlign,
  labelPatch,
  markupLabel,
  ROTATABLE,
} from '@nb/markup';
import { DEFAULT_SCALE, formatArea, formatLength, formatMeasure, formatVolume, isMeasureKind, measureDetails, measureValue, METERS_PER_UNIT, parseLength, QUANTITY, slopeAngle, slopeApplies, slopeNeedsRun, type ManualKind, type Scale, type Slope, type SlopeSpec } from '@nb/measure';
import { defaultManualUnit, makeManual, manualEditValue, MANUAL_KIND_LABELS, MANUAL_UNITS } from '../measure/manualQuantity';
import { gradeReadout, parseRotationInput } from '../markup/rotationInput';
import { isMarkupTool, type MarkupTools, type ToolsState } from '../markup/MarkupTools';
import { cellsFor, customKey, type CellContext } from '../columns/listColumns';
import { useWorkspace } from '../workspace/profiles';
import { LineStyleSelect } from './LineStyleSelect';
import { CountSymbolSelect } from './CountSymbolSelect';
import { ColorMenu } from './ColorMenu';
import { ComboField, FONT_SIZES } from './ComboField';
import { STYLE_ICONS } from './toolIcons';
import { customHatchName, HatchSwatch, LEGACY_HATCH_LABELS } from './HatchSwatch';
import { StampFieldsForm } from './StampsDialog';
import { FontPicker } from './FontPicker';
import { canHaveCutout } from '../markup/cutoutTarget';
import { mayChooseStatus, mayTick } from '../review/statusUi';
import { isCloudPlusSelection } from '../markup/selectionFormat';

interface Props {
  markups: Markup[];
  selected: ReadonlySet<string>;
  store: MarkupDocument | null;
  scales: Readonly<Record<number, Scale>>;
  tools: MarkupTools | null;
  toolsState: ToolsState;
  readOnly: boolean;
  /** The document's columns and statuses, with what cells need to work out values. */
  cellContext: CellContext;
}

/**
 * Properties of the selected markups: general info plus every
 * appearance option that applies to their type. With nothing selected and a drawing tool active,
 * it edits that tool's defaults instead.
 */
export function PropertiesPanel({ markups, selected, store, scales, tools, toolsState, readOnly, cellContext }: Props) {
  const chosen = markups.filter((m) => selected.has(m.id));
  const toolType = isMarkupTool(toolsState.tool) ? toolsState.tool : null;

  if (!chosen.length) {
    if (toolsState.tool === 'cloudPlus' && tools) {
      const cloudStyle = toolsState.styles.cloud;
      const calloutStyle = toolsState.styles.callout;
      return (
        <div className="props-panel">
          <div className="props-heading">
            <strong>{/* i18n-ignore: product feature name */}Cloud+</strong> {msg('tool defaults')}
          </div>
          <p className="empty">{msg('Applies to new cloud+ markups.')}</p>
          <StyleEditor
            style={cloudStyle}
            type="cloud"
            caps={styleCapabilities('cloud')}
            disabled={false}
            markups={markups}
            segments={false}
            onChange={(patch) => tools.setDefaultStyle('cloud', patch)}
            cloudPlus={{
              cloudStyle,
              calloutStyle,
              onCloudChange: (patch) => tools.setDefaultStyle('cloud', patch),
              onCalloutChange: (patch) => tools.setDefaultStyle('callout', patch),
            }}
          />
          <div className="props-actions">
            <button
              className="btn"
              onClick={() => {
                tools.setDefaultStyle('cloud', resetPatch(cloudStyle, 'cloud'));
                tools.setDefaultStyle('callout', resetPatch(calloutStyle, 'callout'));
              }}
            >
              {msg('Reset to defaults')}
            </button>
          </div>
        </div>
      );
    }
    if (!toolType || !tools) return <p className="empty">{msg('Select a markup on the drawing, or pick a markup tool, to see its properties.')}</p>;
    return (
      <div className="props-panel">
        <div className="props-heading">
          {keyed(msgParts('{strong} tool defaults', { strong: <strong>{markupName(toolType)}</strong> }))}
        </div>
        <p className="empty">{msg('Applies to new {kind} markups.', { kind: markupName(toolType) })}</p>
        <StyleEditor
          style={toolsState.styles[toolType]}
          type={toolType}
          caps={styleCapabilities(toolType)}
          disabled={false}
          markups={markups}
          segments={toolType === 'polylength'}
          onChange={(patch) => tools.setDefaultStyle(toolType, patch)}
        />
        <div className="props-actions">
          <button className="btn" onClick={() => tools.setDefaultStyle(toolType, resetPatch(toolsState.styles[toolType], toolType))}>
            {msg('Reset to defaults')}
          </button>
        </div>
      </div>
    );
  }

  // Someone else's markup without the right to edit anyone's: only its status can change here.
  const statusReadOnly = readOnly;
  readOnly = readOnly || (!!store && chosen.some((c) => !store.mayEdit(c)));
  const m = chosen[0]!;
  const scale = cellContext.scaleOf(m);
  const value = isMeasureKind(m.type) ? measureValue(m.type, m.points, scale.metersPerPoint, measureProps(m), scale.yMetersPerPoint) : null;
  const types = [...new Set(chosen.map((c) => c.type))];
  const cloudPlusSel = isCloudPlusSelection(chosen);
  const clouds = cloudPlusSel ? chosen.filter((c) => c.type === 'cloud') : [];
  const callouts = cloudPlusSel ? chosen.filter((c) => c.type === 'callout') : [];
  const cloudIds = clouds.map((c) => c.id);
  const calloutIds = callouts.map((c) => c.id);
  const caps = intersectCaps(types.map(styleCapabilities));
  const ids = chosen.map((c) => c.id);
  const disabled = readOnly || !tools;
  // With cells of a table selected, its font settings are theirs, as in a spreadsheet; the rest is the table's.
  const cellSel = chosen.length === 1 && m.type === 'table' ? (tools?.tableSelection() ?? null) : null;
  const shownStyle = cellSel ? tableCellStyle(m, cellSel.range.row, cellSel.range.col) : m.style;
  const cellFill = cellSel ? tableCellFormat(m, cellSel.range.row, cellSel.range.col).fill : undefined;
  const changeStyle = (patch: Partial<MarkupStyle>) => {
    if (!cellSel) return tools?.applyStyle(ids, patch);
    const own = Object.fromEntries(Object.entries(patch).filter(([k]) => (CELL_STYLE_KEYS as readonly string[]).includes(k)));
    const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => !(CELL_STYLE_KEYS as readonly string[]).includes(k)));
    if (Object.keys(own).length) tools?.applyCellStyle(own);
    if (Object.keys(rest).length) tools?.applyStyle(ids, rest);
  };
  return (
    <div className="props-panel">
      {chosen.length > 1 && (
        <p className="empty">
          {types.length > 1
            ? msg('{count} selected · changes apply to all ({kinds}).', { count: chosen.length, kinds: types.map((t) => markupName(t)).join(', ') })
            : msg('{count} selected · changes apply to all.', { count: chosen.length })}
        </p>
      )}
      <Section title={msg('General')}>
        <dl>
          <dt>{msg('Type')}</dt>
          <dd>{markupName(m.type)}</dd>
          <dt>{msg('Page')}</dt>
          <dd>{m.pageIndex + 1}</dd>
          <dt>{msg('Author')}</dt>
          <dd>{m.author}</dd>
          <dt>{msg('Modified')}</dt>
          <dd>{new Date(m.modifiedAt).toLocaleString()}</dd>
          {value !== null && isMeasureKind(m.type) && (
            <>
              <dt>{msg('Measurement')}</dt>
              <dd>{formatMeasure(m.type, value, scale, measureProps(m))}</dd>
            </>
          )}
        </dl>
        <Row label={msg('Subject')}>
          <input
            key={`${m.id}:${m.subject ?? ''}`}
            defaultValue={m.subject ?? ''}
            placeholder={MARKUP_LABELS[m.type]}
            disabled={readOnly}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (m.subject ?? '')) {
                store?.checkpoint();
                store?.batch(() => ids.forEach((id) => store.update(id, { subject: v || undefined })));
              }
            }}
          />
        </Row>
        <Row label={msg('Label')}>
          <input
            key={`${m.id}:${markupLabel(m)}`}
            defaultValue={markupLabel(m)}
            placeholder={msg('Category, e.g. Tile 1')}
            disabled={readOnly}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== markupLabel(m)) {
                store?.checkpoint();
                store?.batch(() => ids.forEach((id) => store.update(id, labelPatch(m, v))));
              }
            }}
          />
        </Row>
        <Row label={msg('Status')}>
          <select
            value={m.status}
            disabled={statusReadOnly}
            onChange={(e) => {
              store?.checkpoint();
              store?.batch(() => ids.forEach((id) => store.update(id, { status: e.target.value })));
            }}
          >
            {cellContext.statuses.map((s) => (
              <option key={s.id} value={s.id} disabled={!mayChooseStatus(store, ids, s.id)}>
                {s.id === 'none' ? '—' : s.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label={msg('Checked')} title={msg('A review mark, separate from the status (Bluebeam\'s checkmark)')}>
          <input
            type="checkbox"
            checked={!!m.checked}
            disabled={statusReadOnly || !mayTick(store)}
            onChange={(e) => {
              store?.checkpoint();
              store?.batch(() => ids.forEach((id) => store.update(id, { checked: e.target.checked || undefined })));
            }}
          />
        </Row>
        <Row label={msg('Comment')}>
          <input
            key={`${m.id}:${m.comment ?? ''}`}
            defaultValue={m.comment ?? ''}
            disabled={readOnly}
            onBlur={(e) => {
              if (e.target.value !== (m.comment ?? '')) store?.update(m.id, { comment: e.target.value });
            }}
          />
        </Row>
      </Section>
      {tools && !readOnly && !chosen.some((c) => c.locked) && <ArrangeSection chosen={chosen} tools={tools} />}
      {chosen.length === 1 && m.stamp?.form && (
        <Section title={msg('Stamp Fields')}>
          <StampFieldsForm
            fields={m.stamp.form.fields}
            values={m.stamp.form.values}
            disabled={readOnly || !!m.locked}
            onChange={(values) => {
              const next = refillStamp(m.stamp!, values);
              if (!next || !store) return;
              store.checkpoint();
              store.update(m.id, { stamp: next.stamp, style: { ...m.style, stroke: next.color } });
            }}
          />
        </Section>
      )}
      {chosen.length === 1 && m.type === 'ellipticalArc' && (
        <Section title={msg('Arc')}>
          {(['Start', 'End'] as const).map((label, k) => {
            const angles = m.arcAngles ?? [0, 180];
            return (
              <Row key={label} label={label === 'Start' ? msg('Start angle') : msg('End angle')} title={msg('Degrees counter-clockwise from east, as on paper')}>
                <NumberField
                  value={angles[k]}
                  min={-360}
                  max={720}
                  step={1}
                  unit="°"
                  onChange={(v) => {
                    if (v === undefined || readOnly || m.locked) return;
                    const next: [number, number] = [...angles];
                    next[k] = v;
                    store?.checkpoint();
                    store?.update(m.id, { arcAngles: next });
                  }}
                />
              </Row>
            );
          })}
        </Section>
      )}
      {chosen.length === 1 && m.type === 'manual' && <ManualSection m={m} scale={scale} store={store} readOnly={readOnly} />}
      {chosen.length === 1 && isMeasureKind(m.type) && m.type !== 'manual' && QUANTITY[m.type] !== 'count' && QUANTITY[m.type] !== 'angle' && (
        <MeasurementSection m={m} scale={scale} store={store} tools={tools} readOnly={readOnly} />
      )}
      {m.signature && (
        <Section title={msg('Signature')}>
          <dl>
            <dt>{msg('Signed by')}</dt>
            <dd>{m.signature.signer}</dd>
            <dt>{msg('Signed')}</dt>
            <dd>{new Date(m.signature.signedAt).toLocaleString()}</dd>
            {m.signature.reason && (
              <>
                <dt>{msg('Reason')}</dt>
                <dd>{m.signature.reason}</dd>
              </>
            )}
          </dl>
        </Section>
      )}
      {cellContext.columns.length > 0 && <CustomFields markup={m} ids={ids} store={store} readOnly={readOnly} cellContext={cellContext} />}
      {cellSel && tools && (
        <Section title={msg('Cells')}>
          <p className="empty">
            {cellSel.range.rowSpan * cellSel.range.colSpan === 1
              ? msg('Row {row}, column {column}: font settings below apply to just these cells.', { row: cellSel.range.row + 1, column: cellSel.range.col + 1 })
              : msg('{rows, plural, one {# row} other {# rows}} by {columns, plural, one {# column} other {# columns}}: font settings below apply to just these cells.', { rows: cellSel.range.rowSpan, columns: cellSel.range.colSpan })}
          </p>
          <fieldset className="props-style" disabled={disabled}>
            <Row label={msg('Cell fill')}>
              <label className="inline">
                <input type="checkbox" checked={!!cellFill} onChange={(e) => tools.applyCellStyle({ fill: e.target.checked ? '#fef9c3' : undefined })} />
                {cellFill ? '' : msg('None')}
              </label>
              {cellFill && <input type="color" value={cellFill} onChange={(e) => tools.applyCellStyle({ fill: e.target.value })} />}
            </Row>
            <div className="props-actions">
              <button className="btn" title={msg('Take the font, colour and fill of these cells back to the table\'s')} onClick={() => tools.clearCellFormatting()}>
                {msg('Clear cell formatting')}
              </button>
            </div>
          </fieldset>
        </Section>
      )}
      <StyleEditor
        style={shownStyle}
        type={m.type}
        caps={caps}
        disabled={disabled}
        markups={markups}
        segments={types.every((t) => t === 'polylength')}
        onChange={changeStyle}
        onPreview={disabled ? undefined : (patch) => tools?.previewStyle(patch, cellSel ? 'table' : undefined)}
        cloudPlus={
          cloudPlusSel
            ? {
                cloudStyle: clouds[0]!.style,
                calloutStyle: callouts[0]!.style,
                onCloudChange: (patch) => tools?.applyStyle(cloudIds, patch),
                onCalloutChange: (patch) => tools?.applyStyle(calloutIds, patch),
                onCloudPreview: disabled ? undefined : (patch) => tools?.previewStyle(patch, 'cloud'),
                onCalloutPreview: disabled ? undefined : (patch) => tools?.previewStyle(patch, 'callout'),
              }
            : undefined
        }
      />
      {tools && (
        <div className="props-actions">
          {types.length === 1 && (
            <button className="btn" title={msg('Use this style for new {kind} markups', { kind: markupName(m.type) })} onClick={() => tools.setDefaultStyle(m.type, { ...m.style })}>
              {msg('Set as default')}
            </button>
          )}
          <button
            className="btn"
            disabled={disabled}
            title={msg('Restore each markup\'s default appearance')}
            onClick={() => {
              store?.checkpoint();
              for (const c of chosen) tools.applyStyle([c.id], resetPatch(c.style, c.type));
            }}
          >
            {msg('Reset style')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Rotation, flip and alignment of the selected markups, as buttons and a value. */
function ArrangeSection({ chosen, tools }: { chosen: Markup[]; tools: MarkupTools }) {
  const rotatable = chosen.every((c) => ROTATABLE.has(c.type));
  const angle = chosen[0]!.rotation ?? 0;
  const sameAngle = chosen.every((c) => (c.rotation ?? 0) === angle);
  const aligns: { how: Alignment; label: string; icon: string }[] = [
    { how: 'left', label: msg('Align left edges'), icon: '⇤' },
    { how: 'center', label: msg('Align centres horizontally'), icon: '↔' },
    { how: 'right', label: msg('Align right edges'), icon: '⇥' },
    { how: 'top', label: msg('Align top edges'), icon: '⤒' },
    { how: 'middle', label: msg('Align centres vertically'), icon: '↕' },
    { how: 'bottom', label: msg('Align bottom edges'), icon: '⤓' },
  ];
  return (
    <Section title={msg('Arrange')}>
      {rotatable && (
        <Row label={msg('Rotation')} title={msg('Degrees clockwise about the centre of the markup. You can also type a road grade: 2% or 1:50 (a positive grade rises to the right, a negative grade such as -2% or -1:50 falls to the right).')}>
          <RotationField value={sameAngle ? angle : undefined} onApply={(v) => tools.setRotation(v)} />
          <button className="btn" title={msg('Turn 90° anticlockwise')} onClick={() => tools.setRotation(angle - 90)}>
            ↺
          </button>
          <button className="btn" title={msg('Turn 90° clockwise')} onClick={() => tools.setRotation(angle + 90)}>
            ↻
          </button>
        </Row>
      )}
      <Row label={msg('Flip')} title={msg('Mirror across the centre of the selection')}>
        <button className="btn" title={msg('Flip horizontal (left to right)')} onClick={() => tools.flipSelected('horizontal')}>
          {msg('⇋ Horizontal')}
        </button>
        <button className="btn" title={msg('Flip vertical (top to bottom)')} onClick={() => tools.flipSelected('vertical')}>
          {msg('⥮ Vertical')}
        </button>
      </Row>
      {chosen.length > 1 && (
        <>
          <Row label={msg('Align')} title={msg('Line the selection up along its combined bounds')}>
            <span className="seg">
              {aligns.map((a) => (
                <button key={a.how} className="btn" title={a.label} aria-label={a.label} onClick={() => tools.alignSelected(a.how)}>
                  {a.icon}
                </button>
              ))}
            </span>
          </Row>
          {chosen.length > 2 && (
            <Row label={msg('Distribute')} title={msg('Space the selection evenly between its outermost markups')}>
              <button className="btn" title={msg('Even gaps left to right')} onClick={() => tools.distributeSelected('horizontal')}>
                {msg('⇹ Horizontal')}
              </button>
              <button className="btn" title={msg('Even gaps top to bottom')} onClick={() => tools.distributeSelected('vertical')}>
                {msg('⇳ Vertical')}
              </button>
            </Row>
          )}
        </>
      )}
    </Section>
  );
}

/** The document's custom column values for the selected markups (edits apply to all of them). */
function CustomFields({ markup: m, ids, store, readOnly, cellContext }: { markup: Markup; ids: string[]; store: MarkupDocument | null; readOnly: boolean; cellContext: CellContext }) {
  const cells = cellsFor(m, cellContext);
  return (
    <Section title={msg('Custom Columns')}>
      {cellContext.columns.map((c) => {
        const raw = m.fields?.[c.id] ?? '';
        const commit = (v: string) => {
          if (v !== raw) store?.setField(ids, c.id, v);
        };
        const missing = c.required && c.type !== 'formula' && !raw.trim();
        const label = c.required ? `${c.name} *` : c.name;
        let control: ReactNode;
        if (c.type === 'formula') {
          const cell = cells[customKey(c.id)];
          control = <span className={`formula-value${cell?.error ? ' bad' : ''}`}>{cell?.error ? `⚠ ${cell.error}` : cell?.text || '—'}</span>;
        } else if (c.type === 'choice') {
          control = (
            <select value={raw} disabled={readOnly} className={missing ? 'missing' : ''} onChange={(e) => commit(e.target.value)}>
              <option value="">—</option>
              {(c.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        } else if (c.type === 'checkmark') {
          control = <input type="checkbox" checked={raw === 'true'} disabled={readOnly} onChange={(e) => commit(e.target.checked ? 'true' : '')} />;
        } else if (c.type === 'multiline') {
          control = <textarea key={`${m.id}:${raw}`} rows={3} defaultValue={raw} disabled={readOnly} className={missing ? 'missing' : ''} onBlur={(e) => commit(e.target.value)} />;
        } else {
          control = (
            <input
              key={`${m.id}:${raw}`}
              type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
              step="any"
              defaultValue={raw}
              disabled={readOnly}
              className={missing ? 'missing' : ''}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          );
        }
        return (
          <Row key={c.id} label={label}>
            {control}
          </Row>
        );
      })}
    </Section>
  );
}

/** Patch that restores the type's default style, keeping zoom-derived sizes. */
function resetPatch(style: MarkupStyle, type: MarkupType): Partial<MarkupStyle> {
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(style)) patch[k] = undefined;
  Object.assign(patch, DEFAULT_STYLES[type]);
  // Label and marker sizes were chosen for the zoom the markup was drawn at.
  if (isMeasureKind(type) || type === 'cloud') {
    delete patch.arcRadius;
    if (isMeasureKind(type)) delete patch.fontSize;
  }
  return patch as Partial<MarkupStyle>;
}

function intersectCaps(list: StyleCapabilities[]): StyleCapabilities {
  const first = list[0]!;
  const out = { ...first };
  for (const c of list.slice(1)) {
    for (const k of Object.keys(out) as (keyof StyleCapabilities)[]) {
      if (k === 'arcRadius') out.arcRadius = out.arcRadius === c.arcRadius ? out.arcRadius : null;
      else (out[k] as boolean) = (out[k] as boolean) && (c[k] as boolean);
    }
  }
  return out;
}

interface CloudPlusEditor {
  cloudStyle: MarkupStyle;
  calloutStyle: MarkupStyle;
  onCloudChange: (patch: Partial<MarkupStyle>) => void;
  onCalloutChange: (patch: Partial<MarkupStyle>) => void;
  onCloudPreview?: (patch: Partial<MarkupStyle> | null) => void;
  onCalloutPreview?: (patch: Partial<MarkupStyle> | null) => void;
}

interface EditorProps {
  style: MarkupStyle;
  type: MarkupType;
  caps: StyleCapabilities;
  disabled: boolean;
  markups: readonly Markup[];
  /** Offer the segment-lengths toggle: every markup edited is a polylength. */
  segments: boolean;
  onChange: (patch: Partial<MarkupStyle>) => void;
  onPreview?: (patch: Partial<MarkupStyle> | null) => void;
  /** Cloud+ pair (cloud + callout): cloud and text box widths, border, arcs and font edit their own part. */
  cloudPlus?: CloudPlusEditor;
}

const WHOLE_OPACITY_TYPES = new Set<MarkupType>(['highlighter', 'textHighlight', 'image', 'signature', 'stamp']);

function StyleEditor({ style, type, caps, disabled, markups, segments, onChange, onPreview, cloudPlus }: EditorProps) {
  const [startCap, endCap] = lineEnds({ type, style });
  const set = <K extends keyof MarkupStyle>(key: K, value: MarkupStyle[K] | undefined) => onChange({ [key]: value } as Partial<MarkupStyle>);
  const previewColor = <K extends keyof MarkupStyle>(key: K, clearUndefined = false) =>
    onPreview ? (c: string | null | undefined) => onPreview(c === undefined ? null : ({ [key]: clearUndefined ? (c ?? undefined) : c } as Partial<MarkupStyle>)) : undefined;
  const measure = isMeasureKind(type);
  const hatchOn = !!resolveHatch(style.hatch, style.hatchSpec);
  const hatchValue = style.hatch ?? 'none';
  const { hatchSets } = useWorkspace();
  const fontStyle = cloudPlus ? cloudPlus.calloutStyle : style;
  const fontCaps = cloudPlus ? styleCapabilities('callout') : caps;
  const fontSet = <K extends keyof MarkupStyle>(key: K, value: MarkupStyle[K] | undefined) =>
    cloudPlus ? cloudPlus.onCalloutChange({ [key]: value } as Partial<MarkupStyle>) : set(key, value);
  const fontPreview = cloudPlus ? cloudPlus.onCalloutPreview : onPreview;
  const fontPreviewColor = <K extends keyof MarkupStyle>(key: K, clearUndefined = false) =>
    fontPreview ? (c: string | null | undefined) => fontPreview(c === undefined ? null : ({ [key]: clearUndefined ? (c ?? undefined) : c } as Partial<MarkupStyle>)) : undefined;
  return (
    <fieldset className="props-style" disabled={disabled}>
      <Section title={msg('Appearance')}>
        <Row label={msg('Line color')} title={msg('The outline of the shape, or the line itself')}>
          <ColorMenu
            wide
            label={msg('Line color')}
            short={msg('Line')}
            icon={STYLE_ICONS.line}
            value={style.stroke}
            onChange={(c) => c && set('stroke', c)}
            onPreview={onPreview ? (c) => onPreview(c === undefined ? null : c ? { stroke: c } : null) : undefined}
          />
        </Row>
        {cloudPlus ? (
          <>
            <Row label={msg('Cloud line width')}>
              <NumberField value={cloudPlus.cloudStyle.width} min={0} max={200} step={0.25} unit="pt" onChange={(v) => cloudPlus.onCloudChange({ width: v })} />
            </Row>
            <Row label={msg('Text box line width')}>
              <NumberField value={cloudPlus.calloutStyle.width} min={0} max={200} step={0.25} unit="pt" onChange={(v) => cloudPlus.onCalloutChange({ width: v })} />
            </Row>
            <Row label={msg('Text box border')} title={msg('Draw an outline around the text box (its fill draws either way)')}>
              <input
                type="checkbox"
                checked={!cloudPlus.calloutStyle.noBox && !cloudPlus.calloutStyle.borderless}
                onChange={(e) => cloudPlus.onCalloutChange(e.target.checked ? { noBox: undefined, borderless: undefined } : { noBox: undefined, borderless: true })}
              />
            </Row>
          </>
        ) : (
          <>
            {!(type === 'text' && (style.noBox || style.borderless)) && (
              <Row label={msg('Line width')}>
                <NumberField value={style.width} min={0} max={200} step={0.25} unit="pt" onChange={(v) => set('width', v)} />
              </Row>
            )}
            {(type === 'text' || type === 'callout') && (
              <Row label={msg('Border')} title={msg('Draw an outline around the text box (its fill draws either way)')}>
                <input
                  type="checkbox"
                  checked={!style.noBox && !style.borderless}
                  onChange={(e) => onChange(e.target.checked ? { noBox: undefined, borderless: undefined } : { noBox: undefined, borderless: true })}
                />
              </Row>
            )}
          </>
        )}
        {caps.dash && (
          <Row label={msg('Line style')}>
            <LineStyleSelect style={style} markups={markups} disabled={disabled} onChange={onChange} onPreview={onPreview} />
          </Row>
        )}
        {!WHOLE_OPACITY_TYPES.has(type) && (
          <Row label={msg('Line opacity')} title={msg('Opacity of the outer line alone')}>
            <Percent value={style.strokeOpacity ?? 1} onChange={(v) => set('strokeOpacity', v >= 1 ? undefined : v)} />
          </Row>
        )}
        <Row label={msg('Opacity')}>
          <Percent value={style.opacity} onChange={(v) => set('opacity', v)} />
        </Row>
        {caps.blend && (
          <Row label={msg('Blend mode')} title={msg('How the markup mixes with what is underneath it')}>
            <select value={effectiveBlendMode({ type, style })} onChange={(e) => set('blendMode', e.target.value as BlendMode)}>
              {BLEND_MODES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Row>
        )}
        {caps.fill && (
          cloudPlus ? (
            <>
              <Row label={msg('Cloud fill')} title={msg('The inside of the cloud')}>
                <ColorMenu
                  wide
                  label={msg('Cloud fill')}
                  short={msg('Cloud')}
                  icon={STYLE_ICONS.fill}
                  value={cloudPlus.cloudStyle.fill ?? null}
                  noneLabel={msg('No fill')}
                  onChange={(c) => cloudPlus.onCloudChange({ fill: c })}
                  onPreview={cloudPlus.onCloudPreview ? (c) => cloudPlus.onCloudPreview!(c === undefined ? null : { fill: c }) : undefined}
                />
              </Row>
              {(cloudPlus.cloudStyle.fill || hatchOn) && (
                <Row label={msg('Cloud fill opacity')}>
                  <Percent value={cloudPlus.cloudStyle.fillOpacity ?? 1} onChange={(v) => cloudPlus.onCloudChange({ fillOpacity: v })} />
                </Row>
              )}
              <Row label={msg('Text box fill')} title={msg('The background of the text box')}>
                <ColorMenu
                  wide
                  label={msg('Text box fill')}
                  short={msg('Text box')}
                  icon={STYLE_ICONS.fill}
                  value={cloudPlus.calloutStyle.fill ?? null}
                  noneLabel={msg('No fill')}
                  onChange={(c) => cloudPlus.onCalloutChange({ fill: c })}
                  onPreview={cloudPlus.onCalloutPreview ? (c) => cloudPlus.onCalloutPreview!(c === undefined ? null : { fill: c }) : undefined}
                />
              </Row>
              {cloudPlus.calloutStyle.fill && (
                <Row label={msg('Text box fill opacity')}>
                  <Percent value={cloudPlus.calloutStyle.fillOpacity ?? 1} onChange={(v) => cloudPlus.onCalloutChange({ fillOpacity: v })} />
                </Row>
              )}
            </>
          ) : (
            <>
              <Row label={msg('Fill color')} title={msg('The inside of the shape')}>
                <ColorMenu wide label={msg('Fill color')} short={msg('Fill')} icon={STYLE_ICONS.fill} value={style.fill ?? null} noneLabel={msg('No fill')} onChange={(c) => set('fill', c)} onPreview={previewColor('fill')} />
              </Row>
              {(style.fill || hatchOn) && (
                <Row label={msg('Fill opacity')}>
                  <Percent value={style.fillOpacity ?? 1} onChange={(v) => set('fillOpacity', v)} />
                </Row>
              )}
            </>
          )
        )}
        {caps.hatch && (
          <>
            <Row label={msg('Hatch')}>
              <select
                value={hatchValue}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'none') onChange({ hatch: undefined, hatchSpec: undefined, hatchColor: undefined, hatchScale: undefined });
                  else {
                    const spec = hatchSets.flatMap((s) => s.hatches).find((h) => h.id === value)?.spec;
                    onChange({ hatch: value as StoredHatch, hatchSpec: spec });
                  }
                }}
              >
                {HATCH_PATTERNS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
                {hatchSets.map((set) => (
                  <optgroup key={set.title} label={set.title}>
                    {set.hatches.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {hatchValue !== 'none' && !HATCH_PATTERNS.some((h) => h.value === hatchValue) && !hatchSets.some((s) => s.hatches.some((h) => h.id === hatchValue)) && (
                  <option value={hatchValue}>{hatchValue.startsWith('set:') ? customHatchName(hatchValue) : (LEGACY_HATCH_LABELS()[hatchValue] ?? hatchValue)}</option>
                )}
              </select>
              {hatchOn && style.hatch && <HatchSwatch pattern={style.hatch} spec={style.hatchSpec} color={style.hatchColor ?? style.stroke} />}
            </Row>
            {hatchOn && (
              <>
                <Row label={msg('Hatch color')}>
                  <ColorMenu wide label={msg('Hatch color')} short={msg('Hatch')} icon={STYLE_ICONS.hatch} value={style.hatchColor ?? null} fallback={style.stroke} noneLabel={msg('Same as line')} onChange={(c) => set('hatchColor', c ?? undefined)} onPreview={previewColor('hatchColor', true)} />
                </Row>
                <Row label={msg('Scale')} title={msg('50 is half the pattern, 200 is twice. 100 is a quarter inch.')}>
                  <NumberField value={style.hatchScale ?? 100} min={50} max={200} step={1} unit="%" onChange={(v) => set('hatchScale', v ?? 100)} />
                </Row>
              </>
            )}
          </>
        )}
        {(caps.arcRadius === 'Arc size' || cloudPlus) && (
          <Row label={msg('Arcs')}>
            <select
              value={(cloudPlus ? cloudPlus.cloudStyle : style).cloudInside ? 'inside' : 'outside'}
              onChange={(e) => {
                const v = e.target.value === 'inside' || undefined;
                if (cloudPlus) cloudPlus.onCloudChange({ cloudInside: v });
                else set('cloudInside', v);
              }}
            >
              <option value="outside">{msg('Bulge outward')}</option>
              <option value="inside">{msg('Bulge inward')}</option>
            </select>
          </Row>
        )}
        {caps.arcRadius === 'Marker size' && (
          <Row label={msg('Marker shape')} title={msg('The shape or custom symbol placed at each counted item')}>
            <CountSymbolSelect style={style} markups={markups} disabled={disabled} onChange={onChange} onPreview={onPreview} />
          </Row>
        )}
        {(caps.arcRadius || cloudPlus) && (
          <Row label={caps.arcRadius === 'Marker size' ? msg('Marker size') : msg('Arc size')}>
            <NumberField
              value={(cloudPlus ? cloudPlus.cloudStyle : style).arcRadius}
              placeholder={msg('Auto')}
              min={0.5}
              max={200}
              step={0.5}
              unit="pt"
              onChange={(v) => (cloudPlus ? cloudPlus.onCloudChange({ arcRadius: v }) : set('arcRadius', v))}
            />
          </Row>
        )}
      </Section>

      {(caps.lineEnds || caps.leader) && (
        <Section title={type === 'length' ? msg('Dimension') : msg('Line endings')}>
          {caps.lineEnds && (
            <>
              <Row label={msg('Start')}>
                <EndingSelect value={startCap} onChange={(v) => set('startCap', v)} />
              </Row>
              <Row label={msg('End')}>
                <EndingSelect value={endCap} onChange={(v) => set('endCap', v)} />
              </Row>
              <Row label={msg('Ending size')}>
                <input
                  type="range"
                  min={25}
                  max={400}
                  step={5}
                  value={Math.round((style.capScale ?? 1) * 100)}
                  onChange={(e) => set('capScale', Number(e.target.value) / 100)}
                />
                <span className="unit">{Math.round((style.capScale ?? 1) * 100)}%</span>
              </Row>
            </>
          )}
          {caps.leader && (
            <Row label={msg('Offset')} title={msg('Distance from the measured points to the dimension line, with extension lines (negative flips the side)')}>
              <NumberField value={style.leader ?? 0} min={-500} max={500} step={1} unit="pt" onChange={(v) => set('leader', v || undefined)} />
            </Row>
          )}
          {caps.leader && (
            <Row label={msg('Text slide')} title={msg('How far the text sits along the dimension line from its middle (drag the text\'s yellow knob); past an end the line runs out to it')}>
              <NumberField value={style.labelOffset ?? 0} min={-2000} max={2000} step={1} unit="pt" onChange={(v) => set('labelOffset', v || undefined)} />
            </Row>
          )}
          {caps.leader && (
            <Row label={msg('Text turn')} title={msg('Turns the text, clockwise (or drag the knob above the text)')}>
              <NumberField value={style.labelRotation ?? 0} min={-180} max={180} step={1} unit="°" onChange={(v) => set('labelRotation', v || undefined)} />
            </Row>
          )}
        </Section>
      )}

      {(caps.font || cloudPlus) && (
        <Section title={measure || fontCaps.label ? msg('Label text') : msg('Font')}>
          <Row label={msg('Font')}>
            <FontPicker
              value={fontStyle.fontFamily}
              disabled={disabled}
              onChange={(family) => fontSet('fontFamily', family === 'sans' ? undefined : (family as FontFamily))}
              onPreview={fontPreview ? (family) => fontPreview(family === null ? null : { fontFamily: family === 'sans' ? undefined : (family as FontFamily) }) : undefined}
            />
          </Row>
          <Row label={msg('Size')}>
            <ComboField
              title={msg('Font size')}
              integer
              value={fontStyle.fontSize !== undefined ? Math.round(fontStyle.fontSize) : undefined}
              placeholder={msg('Auto')}
              options={FONT_SIZES}
              min={2}
              max={288}
              unit="pt"
              disabled={disabled}
              onChange={(v) => fontSet('fontSize', Math.round(v))}
              onPreview={fontPreview ? (v) => fontPreview(v === null ? null : { fontSize: Math.round(v) }) : undefined}
            />
          </Row>
          <Row label={msg('Style')}>
            <span className="seg">
              <Toggle on={fontStyle.bold ?? measure} label="B" title={msg('Bold')} className="b" onChange={(v) => fontSet('bold', v)} />
              <Toggle on={!!fontStyle.italic} label="I" title={msg('Italic')} className="i" onChange={(v) => fontSet('italic', v || undefined)} />
              <Toggle on={!!fontStyle.underline} label="U" title={msg('Underline')} className="u" onChange={(v) => fontSet('underline', v || undefined)} />
              <Toggle on={!!fontStyle.strikethrough} label="S" title={msg('Strikethrough')} className="s" onChange={(v) => fontSet('strikethrough', v || undefined)} />
            </span>
          </Row>
          <Row label={msg('Text color')}>
            <ColorMenu wide label={msg('Text color')} short={msg('Text')} icon={STYLE_ICONS.line} value={fontStyle.textColor ?? null} fallback={fontStyle.stroke} noneLabel={msg('Same as line')} onChange={(c) => fontSet('textColor', c ?? undefined)} onPreview={fontPreviewColor('textColor', true)} />
          </Row>
          {fontCaps.textLayout && (
            <>
              <Row label={msg('Align')}>
                <span className="seg">
                  {(['left', 'center', 'right', 'justify'] as TextAlign[]).map((a) => (
                    <Toggle key={a} on={(fontStyle.textAlign ?? 'left') === a} label={ALIGN_ICONS[a]} title={a === 'justify' ? msg('Justified') : a === 'left' ? msg('Align left') : a === 'center' ? msg('Align center') : msg('Align right')} onChange={() => fontSet('textAlign', a === 'left' ? undefined : a)} />
                  ))}
                </span>
              </Row>
              <Row label={msg('Vertical')}>
                <span className="seg">
                  {(['top', 'middle', 'bottom'] as VerticalAlign[]).map((a) => (
                    <Toggle key={a} on={(fontStyle.verticalAlign ?? 'top') === a} label={VALIGN_ICONS[a]} title={a === 'top' ? msg('Align top') : a === 'middle' ? msg('Align middle') : msg('Align bottom')} onChange={() => fontSet('verticalAlign', a === 'top' ? undefined : a)} />
                  ))}
                </span>
              </Row>
              <Row label={msg('Line spacing')}>
                <LineSpacing key={markups?.map((x) => x.id).join(',')} value={fontStyle.lineHeight} onChange={(v) => fontSet('lineHeight', v)} />
              </Row>
              <Row label={msg('Padding')}>
                <NumberField value={fontStyle.textMargin} placeholder={String(TEXT_PADDING)} min={0} max={50} step={0.5} unit="pt" onChange={(v) => fontSet('textMargin', v)} />
              </Row>
            </>
          )}
          {caps.label && (
            <>
              <Row label={msg('Show label')}>
                <input type="checkbox" checked={style.showLabel ?? true} onChange={(e) => set('showLabel', e.target.checked ? undefined : false)} />
              </Row>
              {segments && (
                <Row label={msg('Segment lengths')}>
                  <input type="checkbox" checked={style.showSegmentLabels ?? true} disabled={style.showLabel === false} onChange={(e) => set('showSegmentLabels', e.target.checked ? undefined : false)} />
                </Row>
              )}
              <Row label={msg('Background')}>
                <ColorMenu wide label={msg('Label background')} short={msg('Background')} icon={STYLE_ICONS.fill} value={style.labelBackground === undefined ? '#ffffff' : style.labelBackground} noneLabel={msg('No background')} onChange={(c) => set('labelBackground', c)} onPreview={previewColor('labelBackground')} />
              </Row>
            </>
          )}
        </Section>
      )}
    </fieldset>
  );
}

export const ALIGN_ICONS: Record<TextAlign, string> = { left: '⇤', center: '↔', right: '⇥', justify: '☰' };
export const VALIGN_ICONS: Record<VerticalAlign, string> = { top: '⤒', middle: '↕', bottom: '⤓' };

const SLOPE_KINDS: { value: Slope['kind']; label: string; unit: string }[] = [
  { value: 'pitch', get label() { return msg('Pitch'); }, unit: ':12' },
  { value: 'degrees', get label() { return msg('Degrees'); }, unit: '°' },
  { value: 'percent', get label() { return msg('Grade %'); }, unit: '%' },
  { value: 'ratio', get label() { return msg('Rise:Run'); }, unit: '' },
  { value: 'elevation', get label() { return msg('Elevations'); }, unit: 'm' },
  { value: 'hip', get label() { return msg('Hip'); }, unit: ':12' },
  { value: 'valley', get label() { return msg('Valley'); }, unit: ':12' },
];

/** A plane's slope as pitch (rise per 12), whatever it was entered as. */
const asPitch = (spec: SlopeSpec): number => (spec.kind === 'pitch' ? spec.value : +(12 * Math.tan(slopeAngle(spec))).toFixed(4));

/** A new slope of `kind`, keeping what it can of the current one. */
function slopeOfKind(kind: Slope['kind'], cur: Slope | undefined): Slope {
  const plane: SlopeSpec | null = cur && (cur.kind === 'pitch' || cur.kind === 'degrees' || cur.kind === 'percent' || cur.kind === 'ratio') ? cur : cur && (cur.kind === 'hip' || cur.kind === 'valley') ? cur.a : null;
  switch (kind) {
    case 'pitch':
    case 'degrees':
    case 'percent':
      return { kind, value: plane && plane.kind === kind ? plane.value : 0 };
    case 'ratio':
      return plane?.kind === 'ratio' ? plane : { kind, rise: 0, run: 12 };
    case 'elevation':
      return cur?.kind === 'elevation' ? cur : { kind, from: 0, to: 0 };
    case 'hip':
    case 'valley':
      return { kind, a: { kind: 'pitch', value: plane ? asPitch(plane) : 0 }, ...(cur && (cur.kind === 'hip' || cur.kind === 'valley') && cur.b ? { b: cur.b } : {}) };
  }
}

/**
 * A measurement's slope: its kind (Hip and Valley for runs only) and the numbers it takes. An area
 * with elevations needs the run they are over; without it the area stays flat, and the row says so.
 */
function SlopeRows({ m, readOnly, update }: { m: Markup; readOnly: boolean; update: (patch: Partial<Markup>) => void }) {
  if (!isMeasureKind(m.type)) return null;
  const kind = m.type;
  const slope = m.slope;
  const kinds = SLOPE_KINDS.filter((k) => slopeApplies(kind, slopeOfKind(k.value, undefined)));
  const set = (next: Slope | undefined) => update({ slope: next });
  const num = (label: string, value: number | undefined, commit: (v: number | undefined) => void, opts: { optional?: boolean; placeholder?: string; signed?: boolean } = {}) => (
    <input
      key={`${m.id}:${label}:${value ?? ''}`}
      type="number"
      step="any"
      min={opts.signed ? undefined : 0}
      aria-label={label}
      title={label}
      placeholder={opts.placeholder}
      defaultValue={value === undefined || (!opts.signed && !value) ? '' : value}
      disabled={readOnly}
      style={{ width: 64 }}
      onBlur={(e) => {
        const text = e.target.value.trim();
        if (!text) {
          if (opts.optional && value !== undefined) commit(undefined);
          else if (!opts.optional && value) commit(0);
          return;
        }
        const v = Number(text);
        if (Number.isFinite(v) && (opts.signed || v >= 0) && v !== value) commit(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
  return (
    <>
      <Row label={msg('Slope')} title={msg('Measured on plan; the slope gives the true length or area')}>
        <select value={slope && slopeApplies(kind, slope) ? slope.kind : ''} disabled={readOnly} aria-label={msg('Slope kind')} onChange={(e) => set(e.target.value ? slopeOfKind(e.target.value as Slope['kind'], slope) : undefined)}>
          <option value="">{msg('None')}</option>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {slope && (slope.kind === 'pitch' || slope.kind === 'degrees' || slope.kind === 'percent') && (
          <>
            {num(msg('Slope'), slope.value, (v) => set({ kind: slope.kind, value: v ?? 0 }))}
            <span className="unit">{SLOPE_KINDS.find((k) => k.value === slope.kind)!.unit}</span>
          </>
        )}
        {slope?.kind === 'ratio' && (
          <>
            {num(msg('Rise'), slope.rise, (v) => set({ ...slope, rise: v ?? 0 }))}:{num(msg('Run'), slope.run, (v) => set({ ...slope, run: v ?? 0 }))}
          </>
        )}
      </Row>
      {slope?.kind === 'elevation' && (
        <>
          <Row label={msg('From')} title={msg('Level at the start, in meters')}>
            {num(msg('From level'), slope.from, (v) => set({ ...slope, from: v ?? 0 }), { signed: true })}
            <span className="unit">m</span>
          </Row>
          <Row label={msg('To')} title={msg('Level at the end, in meters')}>
            {num(msg('To level'), slope.to, (v) => set({ ...slope, to: v ?? 0 }), { signed: true })}
            <span className="unit">m</span>
          </Row>
          {QUANTITY[kind] === 'area' && (
            <Row label={msg('Run')} title={msg('The horizontal distance the rise happens over, in meters')}>
              {num(msg('Run'), slope.run, (v) => set(v ? { ...slope, run: v } : { kind: 'elevation', from: slope.from, to: slope.to }), { optional: true })}
              <span className="unit">m</span>
            </Row>
          )}
          {slopeNeedsRun(kind, slope) && <div className="prop-note">{msg('Add the run the rise is over: until then the area stays flat.')}</div>}
        </>
      )}
      {(slope?.kind === 'hip' || slope?.kind === 'valley') && slopeApplies(kind, slope) && (
        <Row label={msg('Pitches')} title={msg('The two roof planes meeting at the line, as rise per 12 (square eaves corner)')}>
          {num(msg('First pitch'), asPitch(slope.a), (v) => set({ ...slope, a: { kind: 'pitch', value: v ?? 0 } }))}
          {num(msg('Second pitch'), slope.b ? asPitch(slope.b) : undefined, (v) => set(v === undefined ? { kind: slope.kind, a: slope.a } : { ...slope, b: { kind: 'pitch', value: v } }), { optional: true, placeholder: msg('same as first') })}
          <span className="unit">:12</span>
        </Row>
      )}
    </>
  );
}

/** A manual quantity's typed value, with its kind, unit and note. */
function ManualSection({ m, scale, store, readOnly }: { m: Markup; scale: Scale; store: MarkupDocument | null; readOnly: boolean }) {
  const q = m.manual;
  if (!q) return null;
  const set = (manual: NonNullable<Markup['manual']>) => {
    store?.checkpoint();
    store?.update(m.id, { manual });
  };
  const note = q.note ?? '';
  return (
    <Section title={msg('Manual Quantity')}>
      <Row label={msg('Kind')}>
        <select
          value={q.kind}
          disabled={readOnly}
          aria-label={msg('Kind')}
          onChange={(e) => {
            // The number as typed carries over to the new kind's usual unit.
            const kind = e.target.value as ManualKind;
            const next = makeManual(kind, manualEditValue(q), defaultManualUnit(kind, scale), note);
            if (next) set(next);
          }}
        >
          {(Object.keys(MANUAL_KIND_LABELS) as ManualKind[]).map((k) => (
            <option key={k} value={k}>
              {MANUAL_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Row>
      <Row label={msg('Value')}>
        <input
          key={`${m.id}:${q.kind}:${q.value}:${q.unit ?? ''}`}
          type="number"
          step="any"
          min={0}
          defaultValue={manualEditValue(q)}
          disabled={readOnly}
          aria-label={msg('Value')}
          onBlur={(e) => {
            const v = e.target.value.trim() === '' ? NaN : Number(e.target.value);
            const next = makeManual(q.kind, v, q.unit, note);
            if (next && Math.abs(next.value - q.value) > 1e-12) set(next);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <select
          value={MANUAL_UNITS[q.kind].some((u) => u.id === q.unit) ? q.unit : MANUAL_UNITS[q.kind][0]!.id}
          disabled={readOnly || q.kind === 'count'}
          aria-label={msg('Unit')}
          onChange={(e) => set({ ...q, unit: e.target.value })}
        >
          {MANUAL_UNITS[q.kind].map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={msg('Note')}>
        <input
          key={`${m.id}:${note}`}
          defaultValue={note}
          disabled={readOnly}
          aria-label={msg('Note')}
          onBlur={(e) => {
            const text = e.target.value.trim();
            if (text !== note) {
              const { note: _old, ...rest } = q;
              set(text ? { ...rest, note: text } : rest);
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </Row>
    </Section>
  );
}

/**
 * A measurement's own properties: its other quantities (perimeter of an area, wall area of a run),
 * depth (turning areas into volumes and lengths into walls), slope, and cutouts.
 */
function MeasurementSection({ m, scale, store, tools, readOnly }: { m: Markup; scale: Scale; store: MarkupDocument | null; tools: MarkupTools | null; readOnly: boolean }) {
  if (!isMeasureKind(m.type)) return null;
  const q = QUANTITY[m.type];
  const d = measureDetails(m.type, m.points, scale.metersPerPoint, measureProps(m), scale.yMetersPerPoint);
  const per = METERS_PER_UNIT[scale.unit];
  const update = (patch: Partial<Markup>) => {
    store?.checkpoint();
    store?.update(m.id, patch);
  };
  const holes = m.holes?.length ?? 0;
  return (
    <Section title={msg('Measurement')}>
      <dl>
        {d.length !== undefined && (
          <>
            <dt>{q === 'length' ? msg('Length') : msg('Perimeter')}</dt>
            <dd>{formatLength(d.length, scale)}</dd>
          </>
        )}
        {d.area !== undefined && (
          <>
            <dt>{msg('Area')}</dt>
            <dd>{formatArea(d.area, scale)}</dd>
          </>
        )}
        {d.volume !== undefined && (
          <>
            <dt>{msg('Volume')}</dt>
            <dd>{formatVolume(d.volume, scale)}</dd>
          </>
        )}
        {d.wallArea !== undefined && (
          <>
            <dt>{msg('Wall area')}</dt>
            <dd>{formatArea(d.wallArea, scale)}</dd>
          </>
        )}
      </dl>
      <Row label={q === 'length' ? msg('Height') : msg('Depth')} title={q === 'length' ? msg('Wall height: gives the wall area') : msg('Depth: gives the volume')}>
        <input
          key={`${m.id}:${m.depth ?? ''}:${scale.unit}`}
          defaultValue={m.depth ? formatLength(m.depth, scale) : ''}
          placeholder={msg('e.g. {sample} ({unit})', { sample: scale.unit === 'ft' ? `8'-0"` : '2.4', unit: scale.unit })}
          disabled={readOnly}
          aria-label={msg('Depth')}
          onBlur={(e) => {
            const text = e.target.value.trim();
            if (!text) {
              if (m.depth) update({ depth: undefined });
              return;
            }
            const v = parseLength(text, scale.unit);
            if (v !== null && Math.abs(v * per - (m.depth ?? 0)) > 1e-9) update({ depth: v * per });
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </Row>
      {m.type !== 'volume' && <SlopeRows m={m} readOnly={readOnly} update={update} />}
      {canHaveCutout(m) && (
        <div className="props-actions">
          <button className="btn" disabled={readOnly || !tools || m.locked} onClick={() => tools?.startCutout(m.id)} title={msg('Draw a polygon inside the area to subtract it')}>
            {msg('Add cutout')}
          </button>
          {holes > 0 && (
            <button className="btn" disabled={readOnly || m.locked} onClick={() => update({ holes: undefined, holeBulges: undefined })}>
              {msg('Remove {count, plural, one {# cutout} other {# cutouts}}', { count: holes })}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="props-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Row({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="prop-row" title={title}>
      <span className="prop-label">{label}</span>
      <span className="prop-control">{children}</span>
    </div>
  );
}

function EndingSelect({ value, onChange }: { value: LineEnding; onChange: (v: LineEnding) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as LineEnding)}>
      {LINE_ENDINGS.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({ on, label, title, className, onChange }: { on: boolean; label: string; title: string; className?: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={`seg-btn${on ? ' active' : ''}${className ? ` ${className}` : ''}`} title={title} aria-pressed={on} onClick={() => onChange(!on)}>
      {label}
    </button>
  );
}

function Percent({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <>
      <input type="range" min={0} max={100} step={1} value={pct} onChange={(e) => onChange(Number(e.target.value) / 100)} />
      <span className="unit">{pct}%</span>
    </>
  );
}

interface NumberFieldProps {
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  unit: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: number | undefined) => void;
}

const LINE_SPACINGS = [1, 1.15, 1.5, 2];

/** Line spacing as a multiple of the font size: a preset, or a custom value. Unset is the default (1.2). Keyed by the selection, so each starts from its own value rather than the last one's Custom. */
export function LineSpacing({ value, disabled, onChange }: { value: number | undefined; disabled?: boolean; onChange: (v: number | undefined) => void }) {
  const preset = value !== undefined && LINE_SPACINGS.includes(value);
  const [custom, setCustom] = useState(value !== undefined && !preset);
  const choice = value === undefined ? 'default' : preset && !custom ? String(value) : 'custom';
  return (
    <>
      <select
        aria-label={msg('Line spacing')}
        value={choice}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setCustom(v === 'custom');
          if (v === 'default') onChange(undefined);
          else if (v === 'custom') onChange(value ?? 1.2);
          else onChange(Number(v));
        }}
      >
        <option value="default">{msg('Default')}</option>
        {LINE_SPACINGS.map((n) => (
          <option key={n} value={String(n)}>
            {n.toFixed(n === 1.15 ? 2 : 1)}
          </option>
        ))}
        <option value="custom">{msg('Custom')}</option>
      </select>
      {choice === 'custom' && <NumberField value={value} min={0.5} max={5} step={0.05} unit="×" disabled={disabled} onChange={(v) => onChange(v)} />}
    </>
  );
}

/**
 * Rotation as clockwise degrees, or a road-style grade such as `2%` or `1:50`. Whatever is typed
 * applies once, on Enter or when you leave the field (Escape reverts), so half-typed grades such as
 * `-2` are never applied. Shows the equivalent value as you type.
 */
function RotationField({ value, onApply }: { value: number | undefined; onApply: (degrees: number) => void }) {
  const shown = value === undefined ? '' : String(Math.round(value * 100) / 100);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const parsed = text.trim() === '' || text === shown ? undefined : parseRotationInput(text);
  const bad = parsed && !parsed.ok;
  const note = parsed ? (parsed.ok ? [parsed.readout, parsed.warning].filter(Boolean).join(' ') : parsed.error) : value !== undefined ? gradeReadout(value) : undefined;
  const commit = () => {
    if (!parsed?.ok) return false;
    onApply(parsed.degrees);
    setText(String(Math.round(parsed.degrees * 100) / 100));
    return true;
  };
  return (
    <>
      <input
        type="text"
        className="num"
        value={text}
        placeholder={value === undefined ? msg('Mixed') : undefined}
        aria-label={msg('Rotation')}
        aria-invalid={bad ? true : undefined}
        title={msg('Degrees clockwise, or a grade such as 2% or 1:50. Positive rises to the right, negative (-2%) falls to the right.')}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          if (!commit()) setText(shown);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setText(shown);
        }}
      />
      <span className="unit">°</span>
      {note && (
        <span className="unit rotation-note" role={bad ? 'alert' : undefined} style={bad ? { color: '#c0392b' } : undefined}>
          {note}
        </span>
      )}
    </>
  );
}

/** Number input that lets partial entries ("1.") be typed; commits whenever the text is a valid number. */
export function NumberField({ value, min, max, step, unit, placeholder, disabled, onChange }: NumberFieldProps) {
  const shown = value === undefined ? '' : String(Math.round(value * 100) / 100);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <>
      <input
        type="number"
        className="num"
        value={text}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === '' && placeholder) return onChange(undefined);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => setText(shown)}
      />
      <span className="unit">{unit}</span>
    </>
  );
}
