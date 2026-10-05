export type LengthUnit = 'in' | 'ft' | 'yd' | 'mi' | 'mm' | 'cm' | 'm' | 'km';

export const METERS_PER_UNIT: Record<LengthUnit, number> = {
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
};

export const LENGTH_UNITS = Object.keys(METERS_PER_UNIT) as LengthUnit[];

/** One PDF point is 1/72 inch of paper. */
const METERS_PER_PAPER_POINT = 0.0254 / 72;

/** Drawing scale for a page: how much real-world length one PDF point represents. */
export interface Scale {
  metersPerPoint: number;
  /** Display unit for lengths; areas use its square unless `areaUnit` is set. */
  unit: LengthUnit;
  /** Unit whose square areas are shown in (e.g. m² beside lengths in mm); `unit` when unset. */
  areaUnit?: LengthUnit;
  /** Unit whose cube volumes are shown in; `areaUnit`, else `unit`, when unset. */
  volumeUnit?: LengthUnit;
  /** Wording for areas in a unit (e.g. Bluebeam's "sq m"), used while areas are in that unit. */
  areaLabel?: { unit: LengthUnit; label: string };
  /** Wording for volumes in a unit (e.g. "cu m"), used while volumes are in that unit. */
  volumeLabel?: { unit: LengthUnit; label: string };
  /** Decimal places for angles (one when unset). */
  anglePrecision?: number;
  /**
   * Imperial lengths with inch fractions: feet as feet-inches (12'-6 1/2"), inches as fractional
   * inches (6 1/2"). Only applies when unit is ft or in.
   */
  feetInches: boolean;
  /** Decimal places, or with fractions the denominator of an inch (e.g. 16). */
  precision: number;
  /** Human-readable scale, e.g. `1/8" = 1'-0"` or `Calibrated`. */
  label: string;
}

export interface ScalePreset {
  label: string;
  group: 'Architectural' | 'Engineering' | 'Metric';
  scale: Scale;
}

function paperScale(paperInches: number, realMeters: number, unit: LengthUnit, feetInches: boolean, precision: number, label: string): Scale {
  return { metersPerPoint: realMeters / (paperInches * 72), unit, feetInches, precision, label };
}

const ft = (n: number) => n * METERS_PER_UNIT.ft;

const ARCH: [string, number][] = [
  ['1/16" = 1\'-0"', 1 / 16],
  ['3/32" = 1\'-0"', 3 / 32],
  ['1/8" = 1\'-0"', 1 / 8],
  ['3/16" = 1\'-0"', 3 / 16],
  ['1/4" = 1\'-0"', 1 / 4],
  ['3/8" = 1\'-0"', 3 / 8],
  ['1/2" = 1\'-0"', 1 / 2],
  ['3/4" = 1\'-0"', 3 / 4],
  ['1" = 1\'-0"', 1],
  ['1-1/2" = 1\'-0"', 1.5],
  ['3" = 1\'-0"', 3],
];

const ENG = [10, 20, 30, 40, 50, 60, 100, 200, 500];
const METRIC = [1, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2500, 5000];

export const SCALE_PRESETS: ScalePreset[] = [
  ...ARCH.map(([label, paperIn]): ScalePreset => ({
    label,
    group: 'Architectural',
    scale: paperScale(paperIn, ft(1), 'ft', true, 16, label),
  })),
  ...ENG.map((feet): ScalePreset => {
    const label = `1" = ${feet}'`;
    return { label, group: 'Engineering', scale: paperScale(1, ft(feet), 'ft', false, 2, label) };
  }),
  ...METRIC.map((ratio): ScalePreset => {
    const label = `1:${ratio}`;
    return {
      label,
      group: 'Metric',
      scale: { metersPerPoint: METERS_PER_PAPER_POINT * ratio, unit: ratio <= 20 ? 'mm' : 'm', feetInches: false, precision: ratio <= 20 ? 0 : 2, label },
    };
  }),
];

/** Scale used for pages nobody has set: full size, measured in inches. */
export const DEFAULT_SCALE: Scale = {
  metersPerPoint: METERS_PER_PAPER_POINT,
  unit: 'in',
  feetInches: false,
  precision: 2,
  label: '1:1 (not set)',
};

/**
 * Scale from a calibration line: a segment `lengthPoints` long on the page that is `realLength`
 * `unit`s long in reality.
 */
export function calibratedScale(lengthPoints: number, realLength: number, unit: LengthUnit, feetInches = unit === 'ft'): Scale {
  if (!(lengthPoints > 0) || !(realLength > 0)) throw new Error('Calibration needs a non-zero line and length');
  return {
    metersPerPoint: (realLength * METERS_PER_UNIT[unit]) / lengthPoints,
    unit,
    feetInches: feetInches && unit === 'ft',
    precision: feetInches && unit === 'ft' ? 16 : unit === 'mm' ? 0 : 2,
    label: 'Calibrated',
  };
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Feet-inches with the inch fraction rounded to 1/`denominator`, e.g. `12'-6 1/2"`. */
export function formatFeetInches(feet: number, denominator = 16): string {
  const sign = feet < 0 ? '-' : '';
  const totalUnits = Math.round(Math.abs(feet) * 12 * denominator);
  const wholeFeet = Math.floor(totalUnits / (12 * denominator));
  const rem = totalUnits - wholeFeet * 12 * denominator;
  const inches = Math.floor(rem / denominator);
  const frac = rem - inches * denominator;
  let inchText = String(inches);
  if (frac) {
    const g = gcd(frac, denominator);
    inchText += ` ${frac / g}/${denominator / g}`;
  }
  return `${sign}${wholeFeet}'-${inchText}"`;
}

function trimNumber(value: number, precision: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

/** Inches with the fraction rounded to 1/`denominator`, e.g. `6 1/2"`. */
export function formatFractionalInches(inches: number, denominator = 16): string {
  const sign = inches < 0 ? '-' : '';
  const total = Math.round(Math.abs(inches) * denominator);
  const whole = Math.floor(total / denominator);
  const frac = total - whole * denominator;
  if (!frac) return `${sign}${whole}"`;
  const g = gcd(frac, denominator);
  return `${sign}${whole ? `${whole} ` : ''}${frac / g}/${denominator / g}"`;
}

/** Whether a scale shows lengths with inch fractions. */
export function usesFractions(scale: Scale): boolean {
  return scale.feetInches && (scale.unit === 'ft' || scale.unit === 'in');
}

/** Precision choices for a unit: decimal places, or inch fractions for feet and inches. */
export const DECIMAL_PRECISIONS = [0, 1, 2, 3, 4];
export const FRACTION_PRECISIONS = [1, 2, 4, 8, 16, 32, 64];

export function formatLength(meters: number, scale: Scale): string {
  const value = meters / METERS_PER_UNIT[scale.unit];
  if (scale.unit === 'ft' && scale.feetInches) return formatFeetInches(value, scale.precision);
  if (scale.unit === 'in' && scale.feetInches) return formatFractionalInches(value, scale.precision);
  return `${trimNumber(value, scale.feetInches ? 2 : scale.precision)} ${scale.unit}`;
}

export const AREA_LABELS: Record<LengthUnit, string> = {
  in: 'sq in',
  ft: 'sf',
  yd: 'sy',
  mi: 'sq mi',
  mm: 'mm²',
  cm: 'cm²',
  m: 'm²',
  km: 'km²',
};

export const VOLUME_LABELS: Record<LengthUnit, string> = {
  in: 'cu in',
  ft: 'cf',
  yd: 'cy',
  mi: 'cu mi',
  mm: 'mm³',
  cm: 'cm³',
  m: 'm³',
  km: 'km³',
};

/** The unit a scale shows areas in. */
export const areaUnitOf = (scale: Scale): LengthUnit => scale.areaUnit ?? scale.unit;
/** The unit a scale shows volumes in. */
export const volumeUnitOf = (scale: Scale): LengthUnit => scale.volumeUnit ?? scale.areaUnit ?? scale.unit;

/** How a scale names its area unit. */
export const areaLabelOf = (scale: Scale): string => {
  const unit = areaUnitOf(scale);
  return scale.areaLabel?.unit === unit ? scale.areaLabel.label : AREA_LABELS[unit];
};
/** How a scale names its volume unit. */
export const volumeLabelOf = (scale: Scale): string => {
  const unit = volumeUnitOf(scale);
  return scale.volumeLabel?.unit === unit ? scale.volumeLabel.label : VOLUME_LABELS[unit];
};

export function formatVolume(cubicMeters: number, scale: Scale): string {
  const unit = volumeUnitOf(scale);
  const per = METERS_PER_UNIT[unit];
  const value = cubicMeters / (per * per * per);
  return `${trimNumber(value, scale.feetInches ? 2 : scale.precision)} ${volumeLabelOf(scale)}`;
}

export function formatArea(squareMeters: number, scale: Scale): string {
  const unit = areaUnitOf(scale);
  const per = METERS_PER_UNIT[unit];
  const value = squareMeters / (per * per);
  // Areas are reported in decimal units even when lengths use feet-inches.
  const precision = scale.feetInches ? 2 : scale.precision;
  return `${trimNumber(value, precision)} ${areaLabelOf(scale)}`;
}

/**
 * Parses a length typed by a user into `unit`s. Accepts plain numbers (`25`, `25.5`) and, for
 * feet, feet-inches with optional fractions (`25'-6"`, `25' 6 1/2"`, `6"`, `3/4"`).
 * Returns null when the text is not a positive length.
 */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const t = text.trim();
  if (/^\d*\.?\d+$/.test(t)) {
    const v = Number(t);
    return v > 0 ? v : null;
  }
  if (unit !== 'ft' && unit !== 'in') return null;
  const m = /^(?:(\d*\.?\d+)\s*')?\s*-?\s*(?:(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?\s*")?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const feet = Number(m[1] ?? 0);
  const inches = Number(m[2] ?? 0) + (m[3] && m[4] ? Number(m[3]) / Number(m[4]) : 0);
  const totalFeet = feet + inches / 12;
  const value = unit === 'ft' ? totalFeet : totalFeet * 12;
  return value > 0 ? value : null;
}

function parseInches(text: string): number | null {
  // "1", "1/4", "1-1/2", "1 1/2", "0.5"
  const m = /^(\d+(?:\.\d+)?)?(?:[\s-]*(\d+)\/(\d+))?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

/**
 * Reads a drawing scale from title-block text such as `SCALE: 1/4" = 1'-0"`, `1" = 20'`, or
 * `1:100`. Returns the matching preset when there is one, so pickers recognise it. Returns null
 * for "NTS", "AS NOTED" and anything unrecognised.
 */
export function parseScaleText(text: string): Scale | null {
  const t = text.toUpperCase().replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'");
  if (/\b(NTS|N\.T\.S\.?|NOT TO SCALE|AS NOTED|AS SHOWN)\b/.test(t)) return null;
  const imperial = /(\d+(?:\.\d+)?(?:[\s-]+\d+\/\d+)?|\d+\/\d+)\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'(?:\s*-?\s*(\d+(?:\.\d+)?)\s*")?/.exec(t);
  if (imperial) {
    const paperIn = parseInches(imperial[1]!);
    const realFt = Number(imperial[2]) + Number(imperial[3] ?? 0) / 12;
    if (!paperIn || !(realFt > 0)) return null;
    const mpp = (realFt * METERS_PER_UNIT.ft) / (paperIn * 72);
    const preset = SCALE_PRESETS.find((p) => p.group !== 'Metric' && Math.abs(p.scale.metersPerPoint / mpp - 1) < 1e-6);
    if (preset) return preset.scale;
    const arch = realFt === 1;
    return { metersPerPoint: mpp, unit: 'ft', feetInches: arch, precision: arch ? 16 : 2, label: `${imperial[1]}" = ${realFt}'` };
  }
  const metric = /\b1\s*:\s*(\d+(?:\.\d+)?)\b/.exec(t);
  if (metric) {
    const ratio = Number(metric[1]);
    if (!(ratio > 0)) return null;
    const preset = SCALE_PRESETS.find((p) => p.group === 'Metric' && p.label === `1:${ratio}`);
    if (preset) return preset.scale;
    return { metersPerPoint: METERS_PER_PAPER_POINT * ratio, unit: 'm', feetInches: false, precision: 2, label: `1:${ratio}` };
  }
  return null;
}

/**
 * Reads a scale a user typed into a field. Takes everything `parseScaleText` does, and is lenient
 * about the marks: `1/4 = 1'`, `1/4 in = 1 ft`, `1/8"=1'-0"`, `1:75`. A bare `a = b` is read as
 * inches on paper to feet in reality. Returns null when the text is not a scale.
 */
export function parseTypedScale(text: string): Scale | null {
  const direct = parseScaleText(text);
  if (direct) return direct;
  const t = text
    .trim()
    .replace(/\b(?:inches|inch|in)\b\.?/gi, '"')
    .replace(/\b(?:feet|foot|ft)\b\.?/gi, "'");
  const bare = /^(\d+(?:\.\d+)?(?:[\s-]+\d+\/\d+)?|\d+\/\d+)\s*"?\s*=\s*(\d+(?:\.\d+)?)\s*'?(?:\s*-?\s*(\d+(?:\.\d+)?)\s*"?)?$/.exec(t);
  if (!bare) return parseScaleText(t);
  return parseScaleText(`${bare[1]}" = ${bare[2]}'${bare[3] ? `-${bare[3]}"` : ''}`);
}
