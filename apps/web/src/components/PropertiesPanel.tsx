import { useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_STYLES,
  FONT_FAMILIES,
  HATCH_PATTERNS,
  LINE_DASHES,
  LINE_ENDINGS,
  lineEnds,
  resolveHatch,
  MARKUP_LABELS,
  measureProps,
  styleCapabilities,
  type FontFamily,
  type LineDash,
  type LineEnding,
  type Markup,
  type MarkupStore,
  type MarkupStyle,
  type MarkupType,
  type StoredHatch,
  type StyleCapabilities,
  type TextAlign,
  type VerticalAlign,
} from '@nb/markup';
import { DEFAULT_SCALE, formatArea, formatLength, formatMeasure, formatVolume, isMeasureKind, measureDetails, measureValue, METERS_PER_UNIT, parseLength, QUANTITY, type Scale, type Slope } from '@nb/measure';
import { isMarkupTool, type MarkupTools, type ToolsState } from '../markup/MarkupTools';
import { cellsFor, customKey, type CellContext } from '../columns/listColumns';
import { HatchSwatch, LEGACY_HATCH_LABELS } from './HatchSwatch';

interface Props {
  markups: Markup[];
  selected: ReadonlySet<string>;
  store: MarkupStore | null;
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
    if (!toolType || !tools) return <p className="empty">Select a markup on the drawing, or pick a markup tool, to see its properties.</p>;
    return (
      <div className="props-panel">
        <div className="props-heading">
          <strong>{MARKUP_LABELS[toolType]}</strong> tool defaults
        </div>
        <p className="empty">Applies to new {MARKUP_LABELS[toolType].toLowerCase()} markups.</p>
        <StyleEditor
          style={toolsState.styles[toolType]}
          type={toolType}
          caps={styleCapabilities(toolType)}
          disabled={false}
          onChange={(patch) => tools.setDefaultStyle(toolType, patch)}
        />
        <div className="props-actions">
          <button className="btn" onClick={() => tools.setDefaultStyle(toolType, resetPatch(toolsState.styles[toolType], toolType))}>
            Reset to defaults
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
  const value = isMeasureKind(m.type) ? measureValue(m.type, m.points, scale.metersPerPoint, measureProps(m)) : null;
  const types = [...new Set(chosen.map((c) => c.type))];
  const caps = intersectCaps(types.map(styleCapabilities));
  const ids = chosen.map((c) => c.id);
  const disabled = readOnly || !tools;
  return (
    <div className="props-panel">
      {chosen.length > 1 && (
        <p className="empty">
          {chosen.length} selected · changes apply to all{types.length > 1 ? ` (${types.map((t) => MARKUP_LABELS[t]).join(', ')})` : ''}.
        </p>
      )}
      <Section title="General">
        <dl>
          <dt>Type</dt>
          <dd>{MARKUP_LABELS[m.type]}</dd>
          <dt>Page</dt>
          <dd>{m.pageIndex + 1}</dd>
          <dt>Author</dt>
          <dd>{m.author}</dd>
          <dt>Modified</dt>
          <dd>{new Date(m.modifiedAt).toLocaleString()}</dd>
          {value !== null && isMeasureKind(m.type) && (
            <>
              <dt>Measurement</dt>
              <dd>{formatMeasure(m.type, value, scale)}</dd>
            </>
          )}
        </dl>
        <Row label="Subject">
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
        <Row label="Status">
          <select
            value={m.status}
            disabled={statusReadOnly}
            onChange={(e) => {
              store?.checkpoint();
              store?.batch(() => ids.forEach((id) => store.update(id, { status: e.target.value })));
            }}
          >
            {cellContext.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === 'none' ? '—' : s.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Checked" title="A review mark, separate from the status (Bluebeam's checkmark)">
          <input
            type="checkbox"
            checked={!!m.checked}
            disabled={statusReadOnly}
            onChange={(e) => {
              store?.checkpoint();
              store?.batch(() => ids.forEach((id) => store.update(id, { checked: e.target.checked || undefined })));
            }}
          />
        </Row>
        <Row label="Comment">
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
      {chosen.length === 1 && m.type === 'ellipticalArc' && (
        <Section title="Arc">
          {(['Start', 'End'] as const).map((label, k) => {
            const angles = m.arcAngles ?? [0, 180];
            return (
              <Row key={label} label={`${label} angle`} title="Degrees counter-clockwise from east, as on paper">
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
      {chosen.length === 1 && isMeasureKind(m.type) && QUANTITY[m.type] !== 'count' && QUANTITY[m.type] !== 'angle' && (
        <MeasurementSection m={m} scale={scale} store={store} tools={tools} readOnly={readOnly} />
      )}
      {m.signature && (
        <Section title="Signature">
          <dl>
            <dt>Signed by</dt>
            <dd>{m.signature.signer}</dd>
            <dt>Signed</dt>
            <dd>{new Date(m.signature.signedAt).toLocaleString()}</dd>
            {m.signature.reason && (
              <>
                <dt>Reason</dt>
                <dd>{m.signature.reason}</dd>
              </>
            )}
          </dl>
        </Section>
      )}
      {cellContext.columns.length > 0 && <CustomFields markup={m} ids={ids} store={store} readOnly={readOnly} cellContext={cellContext} />}
      <StyleEditor style={m.style} type={m.type} caps={caps} disabled={disabled} onChange={(patch) => tools?.applyStyle(ids, patch)} />
      {tools && (
        <div className="props-actions">
          {types.length === 1 && (
            <button className="btn" title={`Use this style for new ${MARKUP_LABELS[m.type].toLowerCase()} markups`} onClick={() => tools.setDefaultStyle(m.type, { ...m.style })}>
              Set as default
            </button>
          )}
          <button
            className="btn"
            disabled={disabled}
            title="Restore each markup's default appearance"
            onClick={() => {
              store?.checkpoint();
              for (const c of chosen) tools.applyStyle([c.id], resetPatch(c.style, c.type));
            }}
          >
            Reset style
          </button>
        </div>
      )}
    </div>
  );
}

/** The document's custom column values for the selected markups (edits apply to all of them). */
function CustomFields({ markup: m, ids, store, readOnly, cellContext }: { markup: Markup; ids: string[]; store: MarkupStore | null; readOnly: boolean; cellContext: CellContext }) {
  const cells = cellsFor(m, cellContext);
  return (
    <Section title="Custom Columns">
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

interface EditorProps {
  style: MarkupStyle;
  type: MarkupType;
  caps: StyleCapabilities;
  disabled: boolean;
  onChange: (patch: Partial<MarkupStyle>) => void;
}

function StyleEditor({ style, type, caps, disabled, onChange }: EditorProps) {
  const [startCap, endCap] = lineEnds({ type, style });
  const set = <K extends keyof MarkupStyle>(key: K, value: MarkupStyle[K] | undefined) => onChange({ [key]: value } as Partial<MarkupStyle>);
  const measure = isMeasureKind(type);
  const hatchOn = !!resolveHatch(style.hatch);
  const hatchValue = style.hatch ?? 'none';
  return (
    <fieldset className="props-style" disabled={disabled}>
      <Section title="Appearance">
        <Row label="Color">
          <input type="color" value={style.stroke} onChange={(e) => set('stroke', e.target.value)} />
        </Row>
        <Row label="Line width">
          <NumberField value={style.width} min={0} max={200} step={0.25} unit="pt" onChange={(v) => set('width', v)} />
        </Row>
        {caps.dash && (
          <Row label="Line style">
            <select value={style.dash ?? 'solid'} onChange={(e) => set('dash', e.target.value === 'solid' ? undefined : (e.target.value as LineDash))}>
              {LINE_DASHES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="Opacity">
          <Percent value={style.opacity} onChange={(v) => set('opacity', v)} />
        </Row>
        {caps.fill && (
          <>
            <Row label="Fill">
              <label className="inline">
                <input type="checkbox" checked={!!style.fill} onChange={(e) => set('fill', e.target.checked ? fillFor(style) : null)} />
                {style.fill ? '' : 'None'}
              </label>
              {style.fill && <input type="color" value={style.fill} onChange={(e) => set('fill', e.target.value)} />}
            </Row>
            {(style.fill || hatchOn) && (
              <Row label="Fill opacity">
                <Percent value={style.fillOpacity ?? 1} onChange={(v) => set('fillOpacity', v)} />
              </Row>
            )}
          </>
        )}
        {caps.hatch && (
          <>
            <Row label="Hatch">
              <select
                value={hatchValue}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'none') onChange({ hatch: undefined, hatchColor: undefined, hatchScale: undefined });
                  else onChange({ hatch: value as StoredHatch });
                }}
              >
                {HATCH_PATTERNS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
                {hatchValue !== 'none' && !HATCH_PATTERNS.some((h) => h.value === hatchValue) && (
                  <option value={hatchValue}>{LEGACY_HATCH_LABELS[hatchValue] ?? hatchValue}</option>
                )}
              </select>
              {hatchOn && style.hatch && <HatchSwatch pattern={style.hatch} color={style.hatchColor ?? style.stroke} />}
            </Row>
            {hatchOn && (
              <>
                <Row label="Hatch color">
                  <input type="color" value={style.hatchColor ?? style.stroke} onChange={(e) => set('hatchColor', e.target.value)} />
                </Row>
                <Row label="Scale" title="50 is half the pattern, 200 is twice. 100 is a quarter inch.">
                  <NumberField value={style.hatchScale ?? 100} min={50} max={200} step={1} unit="%" onChange={(v) => set('hatchScale', v ?? 100)} />
                </Row>
              </>
            )}
          </>
        )}
        {caps.arcRadius === 'Arc size' && (
          <Row label="Arcs">
            <select value={style.cloudInside ? 'inside' : 'outside'} onChange={(e) => set('cloudInside', e.target.value === 'inside' || undefined)}>
              <option value="outside">Bulge outward</option>
              <option value="inside">Bulge inward</option>
            </select>
          </Row>
        )}
        {caps.arcRadius && (
          <Row label={caps.arcRadius}>
            <NumberField value={style.arcRadius} placeholder="Auto" min={0.5} max={200} step={0.5} unit="pt" onChange={(v) => set('arcRadius', v)} />
          </Row>
        )}
      </Section>

      {(caps.lineEnds || caps.leader) && (
        <Section title={type === 'length' ? 'Dimension' : 'Line endings'}>
          {caps.lineEnds && (
            <>
              <Row label="Start">
                <EndingSelect value={startCap} onChange={(v) => set('startCap', v)} />
              </Row>
              <Row label="End">
                <EndingSelect value={endCap} onChange={(v) => set('endCap', v)} />
              </Row>
              <Row label="Ending size">
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
            <Row label="Offset" title="Distance from the measured points to the dimension line, with extension lines (negative flips the side)">
              <NumberField value={style.leader ?? 0} min={-500} max={500} step={1} unit="pt" onChange={(v) => set('leader', v || undefined)} />
            </Row>
          )}
        </Section>
      )}

      {caps.font && (
        <Section title={measure || caps.label ? 'Label text' : 'Font'}>
          <Row label="Font">
            <select value={style.fontFamily ?? 'sans'} onChange={(e) => set('fontFamily', e.target.value === 'sans' ? undefined : (e.target.value as FontFamily))}>
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Size">
            <NumberField value={style.fontSize} placeholder="Auto" min={1} max={288} step={0.5} unit="pt" onChange={(v) => set('fontSize', v)} />
          </Row>
          <Row label="Style">
            <span className="seg">
              <Toggle on={style.bold ?? measure} label="B" title="Bold" className="b" onChange={(v) => set('bold', v)} />
              <Toggle on={!!style.italic} label="I" title="Italic" className="i" onChange={(v) => set('italic', v || undefined)} />
              <Toggle on={!!style.underline} label="U" title="Underline" className="u" onChange={(v) => set('underline', v || undefined)} />
            </span>
          </Row>
          <Row label="Text color">
            <input type="color" value={style.textColor ?? style.stroke} onChange={(e) => set('textColor', e.target.value)} />
            {style.textColor && (
              <button type="button" className="link" onClick={() => set('textColor', undefined)}>
                Match line
              </button>
            )}
          </Row>
          {caps.textLayout && (
            <>
              <Row label="Align">
                <span className="seg">
                  {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
                    <Toggle key={a} on={(style.textAlign ?? 'left') === a} label={ALIGN_ICONS[a]} title={`Align ${a}`} onChange={() => set('textAlign', a === 'left' ? undefined : a)} />
                  ))}
                </span>
              </Row>
              <Row label="Vertical">
                <span className="seg">
                  {(['top', 'middle', 'bottom'] as VerticalAlign[]).map((a) => (
                    <Toggle key={a} on={(style.verticalAlign ?? 'top') === a} label={VALIGN_ICONS[a]} title={`Align ${a}`} onChange={() => set('verticalAlign', a === 'top' ? undefined : a)} />
                  ))}
                </span>
              </Row>
            </>
          )}
          {caps.label && (
            <>
              <Row label="Show label">
                <input type="checkbox" checked={style.showLabel ?? true} onChange={(e) => set('showLabel', e.target.checked ? undefined : false)} />
              </Row>
              <Row label="Background">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={style.labelBackground !== null}
                    onChange={(e) => set('labelBackground', e.target.checked ? undefined : null)}
                  />
                  {style.labelBackground === null ? 'None' : ''}
                </label>
                {style.labelBackground !== null && (
                  <input type="color" value={style.labelBackground ?? '#ffffff'} onChange={(e) => set('labelBackground', e.target.value)} />
                )}
              </Row>
            </>
          )}
        </Section>
      )}
    </fieldset>
  );
}

const ALIGN_ICONS: Record<TextAlign, string> = { left: '⇤', center: '↔', right: '⇥' };
const VALIGN_ICONS: Record<VerticalAlign, string> = { top: '⤒', middle: '↕', bottom: '⤓' };

/** A pale version of the line color, as a starting fill. */
function fillFor(style: MarkupStyle): string {
  const n = parseInt(style.stroke.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.75);
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const SLOPE_KINDS: { value: Slope['kind']; label: string; unit: string }[] = [
  { value: 'pitch', label: 'Pitch', unit: ':12' },
  { value: 'degrees', label: 'Degrees', unit: '°' },
  { value: 'percent', label: 'Grade', unit: '%' },
];

/**
 * A measurement's own properties: its other quantities (perimeter of an area, wall area of a run),
 * depth (turning areas into volumes and lengths into walls), slope, and cutouts.
 */
function MeasurementSection({ m, scale, store, tools, readOnly }: { m: Markup; scale: Scale; store: MarkupStore | null; tools: MarkupTools | null; readOnly: boolean }) {
  if (!isMeasureKind(m.type)) return null;
  const q = QUANTITY[m.type];
  const d = measureDetails(m.type, m.points, scale.metersPerPoint, measureProps(m));
  const per = METERS_PER_UNIT[scale.unit];
  const update = (patch: Partial<Markup>) => {
    store?.checkpoint();
    store?.update(m.id, patch);
  };
  const holes = m.holes?.length ?? 0;
  return (
    <Section title="Measurement">
      <dl>
        {d.length !== undefined && (
          <>
            <dt>{q === 'length' ? 'Length' : 'Perimeter'}</dt>
            <dd>{formatLength(d.length, scale)}</dd>
          </>
        )}
        {d.area !== undefined && (
          <>
            <dt>Area</dt>
            <dd>{formatArea(d.area, scale)}</dd>
          </>
        )}
        {d.volume !== undefined && (
          <>
            <dt>Volume</dt>
            <dd>{formatVolume(d.volume, scale)}</dd>
          </>
        )}
        {d.wallArea !== undefined && (
          <>
            <dt>Wall area</dt>
            <dd>{formatArea(d.wallArea, scale)}</dd>
          </>
        )}
      </dl>
      <Row label={q === 'length' ? 'Height' : 'Depth'} title={q === 'length' ? 'Wall height: gives the wall area' : 'Depth: gives the volume'}>
        <input
          key={`${m.id}:${m.depth ?? ''}:${scale.unit}`}
          defaultValue={m.depth ? formatLength(m.depth, scale) : ''}
          placeholder={`e.g. ${scale.unit === 'ft' ? `8'-0"` : `2.4`} (${scale.unit})`}
          disabled={readOnly}
          aria-label="Depth"
          onBlur={(e) => {
            const text = e.target.value.replace(new RegExp(`\\s*${scale.unit}$`), '').trim();
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
      {m.type !== 'volume' && (
        <Row label="Slope" title="Measured on plan; the slope gives the true length or area">
          <select
            value={m.slope?.kind ?? ''}
            disabled={readOnly}
            aria-label="Slope kind"
            onChange={(e) => update({ slope: e.target.value ? { kind: e.target.value as Slope['kind'], value: m.slope?.value ?? 0 } : undefined })}
          >
            <option value="">None</option>
            {SLOPE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          {m.slope && (
            <input
              key={`${m.id}:${m.slope.kind}:${m.slope.value}`}
              type="number"
              step="any"
              min={0}
              aria-label="Slope"
              defaultValue={m.slope.value || ''}
              disabled={readOnly}
              style={{ width: 64 }}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0 && v !== m.slope!.value) update({ slope: { kind: m.slope!.kind, value: v } });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          )}
          {m.slope && <span className="unit">{SLOPE_KINDS.find((k) => k.value === m.slope!.kind)!.unit}</span>}
        </Row>
      )}
      {(q === 'area' || q === 'volume') && (
        <div className="props-actions">
          <button className="btn" disabled={readOnly || !tools || m.locked} onClick={() => tools?.startCutout(m.id)} title="Draw a polygon inside the area to subtract it">
            Add cutout
          </button>
          {holes > 0 && (
            <button className="btn" disabled={readOnly || m.locked} onClick={() => update({ holes: undefined, holeBulges: undefined })}>
              Remove {holes} cutout{holes > 1 ? 's' : ''}
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
  onChange: (v: number | undefined) => void;
}

/** Number input that lets partial entries ("1.") be typed; commits whenever the text is a valid number. */
function NumberField({ value, min, max, step, unit, placeholder, onChange }: NumberFieldProps) {
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
