import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  MARKUP_LABELS,
  isMeasureKind,
  measureProps,
  type Markup,
  type MarkupStore,
  type Viewport,
} from '@nb/markup';
import {
  DECIMAL_PRECISIONS,
  FRACTION_PRECISIONS,
  LENGTH_UNITS,
  SCALE_PRESETS,
  formatMeasure,
  formatScaleNumber,
  measureValue,
  parseScaleNumber,
  scaleEquation,
  scaleFromParts,
  scaleParts,
  type LengthUnit,
  type MeasureKind,
  type PaperUnit,
  type Scale,
} from '@nb/measure';
import { toolLabel, type Tool } from '../markup/MarkupTools';
import { shortcutLabel } from '../commands/shortcuts';
import { SCALE_GROUPS, unitsFor, useSettings } from '../settings/settings';

const PRESETS_KEY = 'nb.scalePresets';
const PAPER_UNITS: PaperUnit[] = ['in', 'mm', 'cm'];

export interface MeasureDefaults {
  subject: string;
  label: string;
}

interface SavedPreset {
  label: string;
  scale: Scale;
}

function loadPresets(): SavedPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const { label, scale } = item as { label?: unknown; scale?: Scale };
      if (typeof label !== 'string' || !scale || typeof scale.metersPerPoint !== 'number' || typeof scale.unit !== 'string') return [];
      return [{ label, scale }];
    });
  } catch {
    return [];
  }
}

function writePresets(list: SavedPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {
    // The preset still applies for this visit.
  }
}

function closeScale(a: Scale, b: Scale): boolean {
  return a.unit === b.unit && b.metersPerPoint > 0 && Math.abs(a.metersPerPoint / b.metersPerPoint - 1) < 1e-4;
}

function pagesOf(mode: 'all' | 'range', text: string, count: number): number[] | null {
  if (count < 1) return null;
  if (mode === 'all') return Array.from({ length: count }, (_, i) => i);
  const pages = new Set<number>();
  if (!text.trim()) return null;
  for (const part of text.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > count) return null;
      for (let i = a; i <= b; i++) pages.add(i - 1);
    } else if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n < 1 || n > count) return null;
      pages.add(n - 1);
    } else return null;
  }
  return pages.size ? [...pages] : null;
}

function tip(tool: Tool, label = toolLabel(tool)): string {
  const key = shortcutLabel(`tool.${tool}`);
  return key ? `${label} (${key})` : label;
}

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function LengthIcon() {
  return (
    <Ico>
      <path d="M2.2 4.2v7.6M13.8 4.2v7.6M2.2 8h11.6" />
      <path d="M4.3 6.4 2.4 8l1.9 1.6M11.7 6.4 13.6 8l-1.9 1.6" />
    </Ico>
  );
}

function AreaIcon() {
  return (
    <Ico>
      <rect x="3.2" y="3.2" width="9.6" height="9.6" />
      <path d="M3.6 12.2 12.4 3.6" />
      <rect x="2" y="2" width="2.1" height="2.1" fill="currentColor" stroke="none" />
      <rect x="11.9" y="2" width="2.1" height="2.1" fill="currentColor" stroke="none" />
      <rect x="2" y="11.9" width="2.1" height="2.1" fill="currentColor" stroke="none" />
      <rect x="11.9" y="11.9" width="2.1" height="2.1" fill="currentColor" stroke="none" />
    </Ico>
  );
}

function PerimeterIcon() {
  return (
    <Ico>
      <path d="M3 12.2 5 4.2 9.2 2.4 13.6 6.2 11.2 13.2Z" />
    </Ico>
  );
}

function DiameterIcon() {
  return (
    <Ico>
      <circle cx="8" cy="8" r="5.3" />
      <path d="M3.4 8h9.2" />
      <path d="M5.2 6.6 3.4 8l1.8 1.4M10.8 6.6 12.6 8l-1.8 1.4" />
    </Ico>
  );
}

function AngleIcon() {
  return (
    <Ico>
      <path d="M8 2.4V8h6.2" />
      <path d="M8 5.1A2.9 2.9 0 0 1 10.9 8" />
    </Ico>
  );
}

function RadiusIcon() {
  return (
    <Ico>
      <circle cx="8" cy="8" r="5.3" />
      <circle cx="8" cy="8" r="0.7" fill="currentColor" stroke="none" />
      <path d="M8 8h5" />
      <path d="M11.2 6.7 13.2 8l-2 1.3" />
    </Ico>
  );
}

function VolumeIcon() {
  return (
    <Ico>
      <path d="M8 1.6 14 4.6 8 7.6 2 4.6Z" />
      <path d="M2 4.6V11l6 3 6-3V4.6" />
      <path d="M8 7.6V14" />
    </Ico>
  );
}

function CountIcon() {
  return (
    <Ico>
      <path d="M3.2 3v10M6.1 3v10M9 3v10M11.9 3v10M2.4 11.6 12.6 3.2" />
    </Ico>
  );
}

function FillIcon() {
  return (
    <Ico>
      <rect x="2.4" y="2.4" width="11.2" height="11.2" />
      <path d="M4 8.2q1.3-1.7 2.6 0t2.6 0 2.6 0" />
    </Ico>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5.5" y="5.5" width="7" height="7" rx="0.5" />
      <path d="M10.5 5.5V3.5h-7v7H5.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M3 4.5h10" />
      <path d="M6.2 4.5V3h3.6v1.5" />
      <path d="M4.3 4.5 5 13h6l.7-8.5" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 8 6" width="8" height="6" aria-hidden="true">
      <polyline points="1,1.2 4,4.2 7,1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

const TOOLS: { tool: Tool; icon: ReactNode; menu?: { tool: Tool; label: string }[] }[] = [
  { tool: 'length', icon: <LengthIcon /> },
  { tool: 'area', icon: <AreaIcon />, menu: [{ tool: 'area', label: 'Area' }, { tool: 'cutout', label: 'Polygon Cutout' }] },
  { tool: 'perimeter', icon: <PerimeterIcon />, menu: [{ tool: 'perimeter', label: 'Perimeter' }, { tool: 'polylength', label: 'Polylength' }] },
  { tool: 'diameter', icon: <DiameterIcon /> },
  { tool: 'angle', icon: <AngleIcon /> },
  { tool: 'radius', icon: <RadiusIcon />, menu: [{ tool: 'radius', label: 'Radius' }, { tool: 'arcLength', label: 'Arc Length' }] },
  { tool: 'volume', icon: <VolumeIcon /> },
  { tool: 'count', icon: <CountIcon /> },
];

function useDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t?.closest('[data-ms-pop]')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
}

function ToolStrip({ tool, onTool }: { tool: Tool; onTool: ((tool: Tool) => void) | null }) {
  const [menu, setMenu] = useState<Tool | null>(null);
  const close = () => setMenu(null);
  useDismiss(menu !== null, close);
  const armed = (id: Tool, extra?: { tool: Tool }[]) => tool === id || !!extra?.some((item) => item.tool === tool);
  const button = (id: Tool, icon: ReactNode, extra?: { tool: Tool; label: string }[]) => (
    <div key={id} className="ms-split" data-ms-pop={extra ? '' : undefined}>
      <button type="button" className={`ms-tool${armed(id, extra) ? ' on' : ''}`} data-measure-tool={id} title={tip(id)} disabled={!onTool} aria-pressed={armed(id, extra)} onClick={() => onTool?.(id)}>
        {icon}
      </button>
      {extra && (
        <>
          <button type="button" className="ms-drop" title={`${toolLabel(id)} tools`} disabled={!onTool} aria-expanded={menu === id} aria-label={`${toolLabel(id)} tools`} onClick={() => setMenu(menu === id ? null : id)}>
            <Chevron />
          </button>
          {menu === id && (
            <div className="ms-menu" role="menu">
              {extra.map((item) => (
                <button key={item.tool} type="button" role="menuitem" className={tool === item.tool ? 'on' : ''} onClick={() => { onTool?.(item.tool); close(); }}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
  return (
    <div className="ms-tools">
      {TOOLS.map((t) => button(t.tool, t.icon, t.menu))}
      <span className="ms-sep" />
      {button('dynamicFill', <FillIcon />)}
    </div>
  );
}

function precisionValue(scale: Scale | null, pending: string): string {
  if (!scale) return pending;
  const frac = scale.feetInches && (scale.unit === 'ft' || scale.unit === 'in');
  return `${frac ? 'f' : 'd'}${scale.precision}`;
}

function precisionText(value: string): string {
  const p = Number(value.slice(1));
  if (value[0] === 'f') return p === 1 ? 'Whole inches' : `1/${p}"`;
  return p ? `0.${'0'.repeat(p - 1)}1` : '1';
}

function PageScale({
  scale,
  pageIndex,
  pageCount,
  pageName,
  onScale,
  onApplyScale,
  onCalibrate,
}: {
  scale: Scale | null;
  pageIndex: number;
  pageCount: number;
  pageName: string;
  onScale: ((scale: Scale) => void) | null;
  onApplyScale: ((pages: number[]) => void) | null;
  onCalibrate: (() => void) | null;
}) {
  const system = useSettings().unitSystem;
  const groups = SCALE_GROUPS[system];
  const [saved, setSaved] = useState<SavedPreset[]>(loadPresets);
  const [mode, setMode] = useState<'preset' | 'custom'>(scale && matchPreset(scale, saved) ? 'preset' : 'custom');
  const [separateY, setSeparateY] = useState(scale?.yMetersPerPoint != null);
  const [paper, setPaper] = useState('');
  const [paperUnit, setPaperUnit] = useState<PaperUnit | ''>('');
  const [real, setReal] = useState('');
  const [realUnit, setRealUnit] = useState<LengthUnit | ''>('');
  const [yPaper, setYPaper] = useState('');
  const [yPaperUnit, setYPaperUnit] = useState<PaperUnit | ''>('');
  const [yReal, setYReal] = useState('');
  const [yRealUnit, setYRealUnit] = useState<LengthUnit | ''>('');
  const [pendingPrec, setPendingPrec] = useState('d2');
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<'all' | 'range'>('all');
  const [applyText, setApplyText] = useState('');
  const [applyError, setApplyError] = useState(false);
  const skip = useRef(false);
  const scaleKey = scale ? `${scale.label}|${scale.metersPerPoint}|${scale.unit}|${scale.yMetersPerPoint ?? ''}` : '';

  const fill = (next: Scale | null, presets = saved) => {
    setMode(next && matchPreset(next, presets) ? 'preset' : 'custom');
    setSeparateY(next?.yMetersPerPoint != null);
    if (!next) {
      setPaper('');
      setPaperUnit('');
      setReal('');
      setRealUnit('');
      setYPaper('');
      setYPaperUnit('');
      setYReal('');
      setYRealUnit('');
      return;
    }
    const parts = scaleParts(next);
    setPaper(formatScaleNumber(parts.paper));
    setPaperUnit(parts.paperUnit);
    setReal(formatScaleNumber(parts.real));
    setRealUnit(parts.realUnit);
    const yScale = next.yMetersPerPoint != null ? scaleParts({ ...next, metersPerPoint: next.yMetersPerPoint }) : parts;
    setYPaper(formatScaleNumber(yScale.paper));
    setYPaperUnit(yScale.paperUnit);
    setYReal(formatScaleNumber(yScale.real));
    setYRealUnit(yScale.realUnit);
  };

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    fill(scale);
    // The page or an outside edit (calibration, another control) replaces what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, scaleKey]);

  const closeApply = () => setApplyOpen(false);
  useDismiss(applyOpen, closeApply);

  const prec = precisionValue(scale, pendingPrec);
  const fracOk = (realUnit || scale?.unit) === 'ft' || (realUnit || scale?.unit) === 'in' || (!scale && !realUnit && system === 'imperial');

  const keep = (base: Scale, y?: number): Scale => {
    const next: Scale = {
      ...base,
      ...(scale?.areaUnit ? { areaUnit: scale.areaUnit } : {}),
      ...(scale?.volumeUnit ? { volumeUnit: scale.volumeUnit } : {}),
      ...(scale?.areaLabel ? { areaLabel: scale.areaLabel } : {}),
      ...(scale?.volumeLabel ? { volumeLabel: scale.volumeLabel } : {}),
      ...(scale?.anglePrecision != null ? { anglePrecision: scale.anglePrecision } : {}),
    };
    if (separateY) next.yMetersPerPoint = y ?? scale?.yMetersPerPoint ?? next.metersPerPoint;
    return next;
  };

  const commitBuilt = (built: Scale | null, y?: number) => {
    if (!built || !onScale) return;
    const builtin = SCALE_PRESETS.find((p) => closeScale(p.scale, built));
    const base = builtin ? { ...builtin.scale, feetInches: built.feetInches, precision: built.precision } : built;
    skip.current = true;
    onScale(keep(base, y));
  };

  const commitFields = (
    patch: Partial<{ paper: string; paperUnit: PaperUnit | ''; real: string; realUnit: LengthUnit | ''; yPaper: string; yPaperUnit: PaperUnit | ''; yReal: string; yRealUnit: LengthUnit | '' }> = {},
  ) => {
    const paperN = parseScaleNumber(patch.paper ?? paper);
    const realN = parseScaleNumber(patch.real ?? real);
    const pu = patch.paperUnit ?? paperUnit;
    const ru = patch.realUnit ?? realUnit;
    if (!paperN || !realN || !pu || !ru) return;
    const feetInches = prec[0] === 'f' && (ru === 'ft' || ru === 'in');
    const precision = feetInches || prec[0] === 'd' ? Number(prec.slice(1)) : 2;
    let y: number | undefined;
    if (separateY) {
      const yPaperN = parseScaleNumber(patch.yPaper ?? yPaper);
      const yPu = patch.yPaperUnit ?? yPaperUnit;
      const yRealN = parseScaleNumber(patch.yReal ?? yReal);
      const yRu = patch.yRealUnit ?? yRealUnit;
      y = yPaperN && yPu && yRealN && yRu ? scaleFromParts(yPaperN, yPu, yRealN, yRu)?.metersPerPoint : scale?.yMetersPerPoint;
    }
    commitBuilt(scaleFromParts(paperN, pu, realN, ru, { feetInches, precision }), y);
  };

  const onPrecision = (value: string) => {
    const feetInches = value[0] === 'f';
    const precision = Number(value.slice(1));
    if (!scale || !onScale) {
      setPendingPrec(value);
      return;
    }
    const fi = feetInches && (scale.unit === 'ft' || scale.unit === 'in');
    skip.current = true;
    onScale({ ...scale, feetInches: fi, precision });
  };

  const choosePreset = (value: string, axis: 'x' | 'y') => {
    const savedHit = value.startsWith('saved:') ? saved.find((s) => `saved:${s.label}` === value) : undefined;
    const builtin = SCALE_PRESETS.find((p) => p.label === value);
    const chosen = savedHit?.scale ?? builtin?.scale;
    if (!chosen || !onScale) return;
    skip.current = true;
    if (axis === 'y' && scale) onScale({ ...scale, yMetersPerPoint: chosen.metersPerPoint });
    else onScale(keep(chosen, separateY ? (scale?.yMetersPerPoint ?? chosen.metersPerPoint) : undefined));
  };

  const presetValue = (axis: 'x' | 'y') => {
    const target = !scale ? null : axis === 'y' && scale.yMetersPerPoint != null ? { ...scale, metersPerPoint: scale.yMetersPerPoint, label: '' } : scale;
    if (!target) return '';
    const savedHit = saved.find((s) => closeScale(s.scale, target));
    if (savedHit) return `saved:${savedHit.label}`;
    return SCALE_PRESETS.find((p) => closeScale(p.scale, target))?.label ?? '';
  };

  const realUnits = unitsFor(system, LENGTH_UNITS, (realUnit || scale?.unit || undefined) as LengthUnit | undefined);
  const yUnits = unitsFor(system, LENGTH_UNITS, (yRealUnit || undefined) as LengthUnit | undefined);
  const matched = scale ? matchPreset(scale, saved) : null;
  const canSave = !!scale && !!onScale && !SCALE_PRESETS.some((p) => closeScale(p.scale, scale));

  const presetSelect = (axis: 'x' | 'y', value: string) => {
    const current = value.startsWith('saved:') ? undefined : SCALE_PRESETS.find((p) => p.label === value);
    // A scale from the other measurement system (a metric ratio while working in imperial) still has to appear.
    const outside = current && !groups.includes(current.group);
    return (
    <select aria-label={axis === 'y' ? 'Y scale preset' : 'Scale preset'} value={value} disabled={!onScale || (axis === 'y' && !scale)} onChange={(e) => choosePreset(e.target.value, axis)}>
      <option value="" disabled>
        {scale && !value ? scale.label : 'Preset'}
      </option>
      {outside && <option value={current.label}>{current.label}</option>}
      {saved.length > 0 && (
        <optgroup label="Saved">
          {saved.map((s) => (
            <option key={s.label} value={`saved:${s.label}`}>
              {s.label}
            </option>
          ))}
        </optgroup>
      )}
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {SCALE_PRESETS.filter((p) => p.group === group).map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
    );
  };

  const equation = (
    axis: string,
    paperValue: string,
    setPaperValue: (v: string) => void,
    pu: PaperUnit | '',
    setPu: (v: PaperUnit) => void,
    realValue: string,
    setRealValue: (v: string) => void,
    ru: LengthUnit | '',
    setRu: (v: LengthUnit) => void,
    units: readonly LengthUnit[],
    onCommit: () => void,
  ) => (
    <div className="ms-eq">
      <input aria-label={`${axis} paper length`} value={paperValue} disabled={!onScale} onChange={(e) => setPaperValue(e.target.value)} onBlur={onCommit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <select aria-label={`${axis} paper unit`} value={pu} disabled={!onScale} onChange={(e) => { setPu(e.target.value as PaperUnit); }}>
        <option value="" disabled hidden />
        {PAPER_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <span className="ms-eq-sign">=</span>
      <input aria-label={`${axis} real length`} value={realValue} disabled={!onScale} onChange={(e) => setRealValue(e.target.value)} onBlur={onCommit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <select aria-label={`${axis} real unit`} value={ru} disabled={!onScale} onChange={(e) => setRu(e.target.value as LengthUnit)}>
        <option value="" disabled hidden />
        {units.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  );

  const applyPages = () => {
    const pages = pagesOf(applyMode, applyText, pageCount);
    if (!pages || !onApplyScale) {
      setApplyError(true);
      return;
    }
    onApplyScale(pages);
    setApplyOpen(false);
    setApplyError(false);
  };

  return (
    <div className="ms-block">
      <div className="ms-line">
        <span className="ms-k">Page:</span>
        <div className="ms-v ms-page">
          <span className="ms-name" title={pageName}>{pageName || '—'}</span>
          <div className="ms-pop-wrap" data-ms-pop>
            <button type="button" className="ms-btn" disabled={!onApplyScale} title={onApplyScale ? 'Use this page’s scale on other pages' : 'Set a scale on this page first'} onClick={() => { setApplyError(false); setApplyOpen((v) => !v); }}>
              <CopyIcon /> Add Scale to More Pages
            </button>
            {applyOpen && (
              <div className="ms-menu ms-apply" role="dialog" aria-label="Add scale to more pages">
                <label className="ms-check">
                  <input type="radio" name="ms-apply" checked={applyMode === 'all'} onChange={() => setApplyMode('all')} /> All pages
                </label>
                <label className="ms-check">
                  <input type="radio" name="ms-apply" checked={applyMode === 'range'} onChange={() => setApplyMode('range')} /> Pages
                </label>
                <input aria-label="Page range" placeholder="1-3, 5" value={applyText} disabled={applyMode !== 'range'} aria-invalid={applyError} onChange={(e) => { setApplyText(e.target.value); setApplyError(false); }} onKeyDown={(e) => e.key === 'Enter' && applyPages()} />
                <div className="ms-apply-actions">
                  <button type="button" className="ms-btn" onClick={closeApply}>Cancel</button>
                  <button type="button" className="ms-btn" onClick={applyPages}>Apply</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="ms-line">
        <span className="ms-k">Scale:</span>
        <button type="button" className="ms-btn" disabled={!onCalibrate} title={tip('calibrate')} onClick={() => onCalibrate?.()}>
          Calibrate
        </button>
      </div>
      <div className="ms-line">
        <span className="ms-k" />
        <div className="ms-radios">
          <label className="ms-check">
            <input type="radio" name="ms-scale-mode" checked={mode === 'preset'} disabled={!onScale} onChange={() => setMode('preset')} /> Preset
          </label>
          <label className="ms-check">
            <input type="radio" name="ms-scale-mode" checked={mode === 'custom'} disabled={!onScale} onChange={() => setMode('custom')} /> Custom
          </label>
        </div>
      </div>
      <div className="ms-line">
        <span className="ms-k">{separateY ? 'X' : ''}</span>
        <div className="ms-v">
          {mode === 'preset'
            ? presetSelect('x', presetValue('x'))
            : equation('X', paper, setPaper, paperUnit, (u) => { setPaperUnit(u); commitFields({ paperUnit: u }); }, real, setReal, realUnit, (u) => { setRealUnit(u); commitFields({ realUnit: u }); }, realUnits, () => commitFields())}
        </div>
      </div>
      {separateY && (
        <div className="ms-line">
          <span className="ms-k">Y</span>
          <div className="ms-v">
            {mode === 'preset'
              ? presetSelect('y', presetValue('y'))
              : equation(
                'Y',
                yPaper,
                setYPaper,
                yPaperUnit,
                (u) => {
                  setYPaperUnit(u);
                  commitFields({ yPaperUnit: u });
                },
                yReal,
                setYReal,
                yRealUnit,
                (u) => {
                  setYRealUnit(u);
                  commitFields({ yRealUnit: u });
                },
                yUnits,
                () => commitFields(),
              )}
          </div>
        </div>
      )}
      <div className="ms-line">
        <span className="ms-k" />
        <div className="ms-preset-actions">
          <button
            type="button"
            className="ms-btn"
            disabled={!canSave}
            title={canSave ? 'Save this scale in the preset list' : 'Set a custom scale first'}
            onClick={() => {
              if (!scale) return;
              const label = scale.label === 'Calibrated' || scale.label === '1:1 (not set)' ? scaleEquation(scale) : scale.label;
              const next = [{ label, scale: { ...scale, label } }, ...saved.filter((s) => s.label !== label)];
              writePresets(next);
              setSaved(next);
            }}
          >
            + Add Preset
          </button>
          {matched?.kind === 'saved' && (
            <button
              type="button"
              className="ms-btn"
              onClick={() => {
                const next = saved.filter((s) => s.label !== matched.label);
                writePresets(next);
                setSaved(next);
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="ms-line">
        <span className="ms-k" />
        <label className="ms-check">
          <input
            type="checkbox"
            checked={separateY}
            disabled={!onScale}
            onChange={(e) => {
              const on = e.target.checked;
              setSeparateY(on);
              if (!scale || !onScale) return;
              skip.current = true;
              if (on) onScale({ ...scale, yMetersPerPoint: scale.yMetersPerPoint ?? scale.metersPerPoint });
              else {
                const next = { ...scale };
                delete next.yMetersPerPoint;
                onScale(next);
              }
            }}
          />
          Separate Y Scale
        </label>
      </div>
      <div className="ms-line">
        <span className="ms-k">Precision:</span>
        <select className="ms-precision" aria-label="Precision" value={prec} disabled={!onScale} onChange={(e) => onPrecision(e.target.value)}>
          {DECIMAL_PRECISIONS.map((p) => (
            <option key={`d${p}`} value={`d${p}`}>
              {precisionText(`d${p}`)}
            </option>
          ))}
          {fracOk &&
            FRACTION_PRECISIONS.map((p) => (
              <option key={`f${p}`} value={`f${p}`}>
                {precisionText(`f${p}`)}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

function matchPreset(scale: Scale, saved: readonly SavedPreset[]): { kind: 'saved' | 'builtin'; label: string } | null {
  const savedHit = saved.find((s) => closeScale(s.scale, scale));
  if (savedHit) return { kind: 'saved', label: savedHit.label };
  const builtin = SCALE_PRESETS.find((p) => closeScale(p.scale, scale));
  return builtin ? { kind: 'builtin', label: builtin.label } : null;
}

function Properties({
  markups,
  selected,
  store,
  defaults,
  onDefaults,
  editable,
}: {
  markups: Markup[];
  selected: ReadonlySet<string>;
  store: MarkupStore | null;
  defaults: MeasureDefaults;
  onDefaults: (next: MeasureDefaults) => void;
  editable: boolean;
}) {
  const chosen = markups.filter((m) => selected.has(m.id) && isMeasureKind(m.type));
  const canEdit = chosen.length ? !!store && chosen.every((m) => store.mayEdit(m)) : editable;
  const key = chosen.length ? chosen.map((m) => `${m.id}:${m.subject ?? ''}:${m.text ?? ''}`).join('|') : `d:${defaults.subject}:${defaults.label}`;
  const [subject, setSubject] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (chosen.length) {
      setSubject(chosen[0]!.subject ?? '');
      setLabel(chosen[0]!.text ?? '');
    } else {
      setSubject(defaults.subject);
      setLabel(defaults.label);
    }
    // key already covers the markup fields and the defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const commit = () => {
    if (!chosen.length || !store) {
      if (!chosen.length) onDefaults({ subject, label });
      return;
    }
    if (!canEdit) return;
    const subjectValue = subject.trim();
    const labelValue = label.trim();
    const subjectSame = chosen.every((m) => (m.subject ?? '') === subjectValue);
    const labelSame = chosen.every((m) => (m.text ?? '') === labelValue);
    if (subjectSame && labelSame) return;
    store.checkpoint();
    store.batch(() =>
      chosen.forEach((m) =>
        store.update(m.id, {
          ...(subjectSame ? {} : { subject: subjectValue || undefined }),
          ...(labelSame ? {} : { text: labelValue || undefined }),
        }),
      ),
    );
  };

  return (
    <div className="ms-block">
      <label className="ms-line">
        <span className="ms-k">Subject:</span>
        <input
          value={subject}
          disabled={!canEdit}
          onChange={(e) => {
            setSubject(e.target.value);
            if (!chosen.length) onDefaults({ subject: e.target.value, label });
          }}
          onBlur={commit}
        />
      </label>
      <label className="ms-line">
        <span className="ms-k">Label:</span>
        <input
          value={label}
          disabled={!canEdit}
          onChange={(e) => {
            setLabel(e.target.value);
            if (!chosen.length) onDefaults({ subject, label: e.target.value });
          }}
          onBlur={commit}
        />
      </label>
    </div>
  );
}

function Viewports({
  viewports,
  allViewports,
  actions,
  adding,
}: {
  viewports: readonly Viewport[];
  allViewports: readonly Viewport[];
  actions: { add: () => void; update: (v: Viewport) => void; remove: (id: string) => void } | null;
  adding: boolean;
}) {
  const system = useSettings().unitSystem;
  const [saved] = useState(loadPresets);
  const [picked, setPicked] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const close = () => setMenu(false);
  useDismiss(menu, close);
  useEffect(() => {
    if (picked && !viewports.some((v) => v.id === picked)) setPicked(null);
  }, [viewports, picked]);

  const removeMany = (list: readonly Viewport[], ask: string) => {
    if (!actions || !list.length || !confirm(ask)) return;
    list.forEach((v) => actions.remove(v.id));
    setPicked(null);
    setMenu(false);
  };

  return (
    <div className="viewports">
      <div className="ms-vp-box" role="listbox" aria-label="Viewports">
        {viewports.map((v) => (
          <div key={v.id} className={`ms-vp-row${picked === v.id ? ' on' : ''}`} role="option" aria-selected={picked === v.id} onMouseDown={() => setPicked(v.id)}>
            <input
              key={`${v.id}:${v.name}`}
              defaultValue={v.name}
              aria-label="Viewport name"
              disabled={!actions}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== v.name) actions?.update({ ...v, name });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <select
              value={SCALE_PRESETS.some((p) => p.label === v.scale.label) || saved.some((s) => s.label === v.scale.label) ? v.scale.label : ''}
              aria-label="Viewport scale"
              disabled={!actions}
              onChange={(e) => {
                const preset = SCALE_PRESETS.find((p) => p.label === e.target.value) ?? saved.find((s) => s.label === e.target.value);
                const next = preset && 'scale' in preset ? preset.scale : undefined;
                if (next) actions?.update({ ...v, scale: next });
              }}
            >
              {!SCALE_PRESETS.some((p) => p.label === v.scale.label) && !saved.some((s) => s.label === v.scale.label) && <option value="">{v.scale.label}</option>}
              {saved.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}
                </option>
              ))}
              {SCALE_PRESETS.filter((p) => SCALE_GROUPS[system].includes(p.group) || p.label === v.scale.label).map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="viewports-head">
        <button type="button" className={`ms-glyph${adding ? ' on' : ''}`} title="Drag a box around a detail drawn at another scale" disabled={!actions} onClick={() => actions?.add()}>
          +
        </button>
        <button type="button" className="ms-glyph" title="Delete the selected viewport" disabled={!actions || !picked} onClick={() => picked && actions?.remove(picked)}>
          ×
        </button>
        <span className="ms-grow" />
        <div className="ms-pop-wrap" data-ms-pop>
          <button type="button" className="ms-glyph" title="Delete viewports" disabled={!actions || !allViewports.length} aria-expanded={menu} aria-label="Delete viewports" onClick={() => setMenu((v) => !v)}>
            <TrashIcon />
            <Chevron />
          </button>
          {menu && (
            <div className="ms-menu up" role="menu">
              <button type="button" role="menuitem" disabled={!viewports.length} onClick={() => removeMany(viewports, 'Delete the viewports on this page?')}>
                Delete on this page
              </button>
              <button type="button" role="menuitem" onClick={() => removeMany(allViewports, 'Delete every viewport in this document?')}>
                Delete in the document
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MeasurementsPanel({
  markups,
  scales,
  selected,
  onSelect,
  pageIndex,
  pageCount,
  pageName,
  onScale,
  onApplyScale,
  scaleOf,
  viewports,
  allViewports,
  onViewports,
  tool,
  onTool,
  store,
  defaults,
  onDefaults,
}: {
  markups: Markup[];
  scales: Readonly<Record<number, Scale>>;
  selected: ReadonlySet<string>;
  onSelect: (m: Markup) => void;
  pageIndex: number;
  pageCount: number;
  pageName: string;
  onScale: ((scale: Scale) => void) | null;
  /** Applies the current page's scale to these pages. Null until the page has a scale. */
  onApplyScale: ((pages: number[]) => void) | null;
  scaleOf: (m: Markup) => Scale;
  viewports: readonly Viewport[];
  allViewports: readonly Viewport[];
  onViewports: { add: () => void; update: (v: Viewport) => void; remove: (id: string) => void } | null;
  tool: Tool;
  onTool: ((tool: Tool) => void) | null;
  store: MarkupStore | null;
  defaults: MeasureDefaults;
  onDefaults: (next: MeasureDefaults) => void;
}) {
  const scale = scales[pageIndex] ?? null;
  const [open, setOpen] = useState({ scale: true, props: true, view: true, list: true });
  const rows = markups.filter((m) => isMeasureKind(m.type));
  const toggle = (key: keyof typeof open) => setOpen((s) => ({ ...s, [key]: !s[key] }));
  const totals = new Map<MeasureKind, { value: number; scale: Scale; n: number }>();
  for (const m of rows) {
    if (!isMeasureKind(m.type) || m.type === 'angle') continue;
    const rowScale = scaleOf(m);
    const value = measureValue(m.type, m.points, rowScale.metersPerPoint, measureProps(m), rowScale.yMetersPerPoint);
    const t = totals.get(m.type) ?? { value: 0, scale: rowScale, n: 0 };
    t.value += value;
    t.n++;
    totals.set(m.type, t);
  }

  const section = (key: keyof typeof open, title: string, body: ReactNode, className?: string) => (
    <section className={className}>
      <button type="button" className="ms-twist" aria-expanded={open[key]} onClick={() => toggle(key)}>
        <svg viewBox="0 0 8 6" width="8" height="6" className={open[key] ? '' : 'shut'} aria-hidden="true">
          <polyline points="1,1.2 4,4.2 7,1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        {title}
      </button>
      {open[key] && body}
    </section>
  );

  return (
    <div className="measure-panel">
      <ToolStrip tool={tool} onTool={onTool} />
      {section(
        'scale',
        'Page Scale',
        <PageScale scale={scale} pageIndex={pageIndex} pageCount={pageCount} pageName={pageName} onScale={onScale} onApplyScale={onApplyScale} onCalibrate={onTool ? () => onTool('calibrate') : null} />,
        'scale-settings',
      )}
      {section('props', 'Measurement Properties', <Properties markups={markups} selected={selected} store={store} defaults={defaults} onDefaults={onDefaults} editable={!!onTool || !!store} />)}
      {section('view', 'Viewports', <Viewports viewports={viewports} allViewports={allViewports} actions={onViewports} adding={tool === 'viewport'} />)}
      {rows.length > 0 &&
        section(
          'list',
          'On the drawing',
          <>
            <ul className="bookmark-list">
              {rows.map((m) => {
                const rowScale = scaleOf(m);
                const value = isMeasureKind(m.type) ? measureValue(m.type, m.points, rowScale.metersPerPoint, measureProps(m), rowScale.yMetersPerPoint) : null;
                return (
                  <li key={m.id}>
                    <button type="button" className={`bookmark${selected.has(m.id) ? ' active' : ''}`} onClick={() => onSelect(m)}>
                      <span className="num">{m.subject || MARKUP_LABELS[m.type]}</span>
                      <span className="name">
                        p. {m.pageIndex + 1}
                        {value !== null && isMeasureKind(m.type) ? ` · ${formatMeasure(m.type, value, rowScale)}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {totals.size > 0 && (
              <ul className="measure-totals">
                {[...totals].map(([kind, t]) => (
                  <li key={kind}>
                    Total {MARKUP_LABELS[kind]} ({t.n}): {formatMeasure(kind, t.value, t.scale)}
                  </li>
                ))}
              </ul>
            )}
          </>,
        )}
    </div>
  );
}
