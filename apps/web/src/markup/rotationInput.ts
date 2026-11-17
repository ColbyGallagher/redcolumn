/**
 * Parses what a person types into a rotation field: plain degrees, a road-style percentage fall
 * (`2%`) or a ratio (`1:50`).
 *
 * Grades follow the usual maths sign: a positive grade rises to the right of the page and a negative
 * grade falls to the right. The app turns markups clockwise on screen, so a fall to the right is a
 * positive clockwise angle. Plain degrees are the app's own clockwise degrees, unchanged.
 */

export type Turn = 'clockwise' | 'ccw';
export type RotationUnit = 'degrees' | 'percent' | 'ratio';

export type RotationParse =
  | { ok: true; unit: RotationUnit; /** Clockwise degrees in [0, 360). */ degrees: number; /** Text for the live readout. */ readout: string; warning?: string }
  | { ok: false; error: string };

const DEGREES = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*°?$/i;
const PERCENT = /^([+-]?)\s*(\d+\.?\d*|\.\d+)\s*%$/;
const RATIO = /^([+-]?)\s*1\s*:\s*(\d+\.?\d*|\.\d+)$/;

const DEG = 180 / Math.PI;
const norm = (d: number) => (((d % 360) + 360) % 360) || 0;
const fmt = (n: number, digits: number) => Number(n.toFixed(digits)).toString();

/** Text like "falls 2.00% to the right" for an angle in clockwise degrees, or undefined when near vertical. */
export function gradeReadout(clockwiseDegrees: number): string | undefined {
  const rad = (clockwiseDegrees * Math.PI) / 180;
  const fall = Math.tan(rad); // positive: falls to the right
  if (!Number.isFinite(fall) || Math.abs(fall) > 1000) return undefined;
  const pct = fall * 100;
  if (Math.abs(pct) < 0.005) return '≈ 0.00%';
  return `≈ ${fmt(-pct, 2)}%`; // maths sign: negative falls to the right
}

/** `turn` is how plain degrees (and the returned `degrees`) are measured: clockwise (default) or counter-clockwise on paper. */
export function parseRotationInput(text: string, turn: Turn = 'clockwise'): RotationParse {
  const out = (math: number) => (turn === 'ccw' ? math || 0 : norm(-math));
  const t = text.trim().replace(/−/g, '-');
  if (!t) return { ok: false, error: 'Type an angle, a percentage such as 2% or a ratio such as 1:50.' };

  const deg = DEGREES.exec(t);
  if (deg) {
    const d = Number(deg[1]);
    return { ok: true, unit: 'degrees', degrees: turn === 'ccw' ? d : norm(d), readout: gradeReadout(turn === 'ccw' ? -d : d) ?? '' };
  }

  const pct = PERCENT.exec(t);
  if (pct) {
    const grade = (pct[1] === '-' ? -1 : 1) * Number(pct[2]);
    const math = Math.atan(grade / 100) * DEG; // positive rises to the right
    return { ok: true, unit: 'percent', degrees: out(math), readout: `≈ ${fmt(Math.abs(math), 3)}°`, ...(Math.abs(grade) > 100 ? { warning: 'Steeper than 100% (45°).' } : {}) };
  }

  const ratio = RATIO.exec(t);
  if (ratio) {
    const n = Number(ratio[2]);
    if (n === 0) return { ok: false, error: 'A ratio of 1:0 is vertical. Use 90 degrees instead.' };
    const sign = ratio[1] === '-' ? -1 : 1;
    const math = sign * Math.atan(1 / n) * DEG;
    return { ok: true, unit: 'ratio', degrees: out(math), readout: `≈ ${fmt(Math.abs(math), 3)}° (${fmt(Math.abs(100 / n), 2)}%)`, ...(n < 1 ? { warning: 'Steeper than 1:1 (45°).' } : {}) };
  }

  if (/^[+-]?\d+,\d+\s*(%|°)?$/.test(t)) return { ok: false, error: 'Use a decimal point, not a comma (2.5).' };
  return { ok: false, error: 'Not a valid angle. Use degrees (45), a percentage (2%) or a ratio (1:50).' };
}
