import { effectiveScale, matchPaper, METERS_PER_UNIT, type PaperMatch, type Scale } from '@nb/measure';
import type { SheetInfo } from '@nb/sheets';
import { checkScale, type ScaleCheck, type ScaleReading } from './scaleCheck';

/**
 * Where a page stands against its title block's scale:
 * - `ready`: the title block gives a scale for the page's own sheet size.
 * - `resized`: the page was saved at another size than the scale was written for (A1 as A3), so
 *   the proposed scale is corrected for it.
 * - `check`: the proposed scale needs checking against a known length: the page's proportions
 *   differ from the stated sheet's (cropped or padded), it is resized onto a sheet that is not a
 *   standard size of the same family, the scale is implausibly large for a drawing (1:1), or the
 *   page's own scale bar or dimensions measure otherwise.
 * - `matches`: the page's scale is set and agrees with the title block.
 * - `differs`: the page's scale is set and disagrees with the title block.
 * - `nts`: the title block says not to scale (NTS, AS NOTED, AS SHOWN).
 * - `none`: no scale was found in the title block.
 */
export type ScaleReviewStatus = 'ready' | 'resized' | 'check' | 'matches' | 'differs' | 'nts' | 'none';

export interface ScaleReviewRow {
  page: number;
  sheet: SheetInfo | undefined;
  /** The sheet the page was made at, when it is a standard size. */
  actual: PaperMatch | null;
  /** The sheet size the title block says the scale is for. */
  stated: string | null;
  /** The scale the title block gives for this page, corrected for the page's size. */
  proposed: Scale | null;
  /** Page length ÷ stated sheet length (0.5 for A1 saved as A3). */
  printRatio: number;
  /** The page's own scale, when one has been set. */
  current: Scale | undefined;
  status: ScaleReviewStatus;
  /**
   * What the page's scale bars and dimensions say about the proposed scale (the page's own scale
   * when the title block gives none). Unset until the page has been read.
   */
  check?: ScaleCheck;
}

/** Below 1:2 a title-block scale is far more likely misread (1:1,000 as 1:1) than a full-size sheet. */
const MIN_PLAUSIBLE_METERS_PER_POINT = (2 * METERS_PER_UNIT.in) / 72;

const NOT_TO_SCALE = /\b(NTS|N\.T\.S\.?|NOT TO SCALE|AS NOTED|AS SHOWN|VARIES)\b/i;

/** Whether two scales measure the same, within half a percent. */
export function sameScale(a: Scale, b: Scale): boolean {
  return Math.abs(a.metersPerPoint / b.metersPerPoint - 1) < 0.005 && Math.abs((a.yMetersPerPoint ?? a.metersPerPoint) / (b.yMetersPerPoint ?? b.metersPerPoint) - 1) < 0.005;
}

/**
 * One row for every page: its title-block scale, corrected for the size the page was saved at,
 * against the scale the page has now, and against the lengths drawn on the page (`readings`, by
 * page, once read): a proposal they disagree with is left for checking. `sizes` are the pages'
 * sizes in PDF points.
 */
export function scaleReviewRows(
  sizes: readonly { width: number; height: number }[],
  sheets: Readonly<Record<number, SheetInfo>>,
  scales: Readonly<Record<number, Scale>>,
  readings: Readonly<Record<number, readonly ScaleReading[]>> = {},
): ScaleReviewRow[] {
  return sizes.map((size, page) => withCheck(rowFor(size, page, sheets[page], scales[page]), readings[page]));
}

function withCheck(row: ScaleReviewRow, readings: readonly ScaleReading[] | undefined): ScaleReviewRow {
  const against = row.proposed ?? row.current;
  if (!readings || !against) return row;
  const check = checkScale(against, readings);
  const status = check.result === 'disagrees' && (row.status === 'ready' || row.status === 'resized') ? 'check' : row.status;
  return { ...row, check, status };
}

function rowFor(size: { width: number; height: number }, page: number, sheet: SheetInfo | undefined, current: Scale | undefined): ScaleReviewRow {
  const actual = matchPaper(size.width, size.height);
  const row: ScaleReviewRow = { page, sheet, actual, stated: null, proposed: null, printRatio: 1, current, status: 'none' };
  const text = sheet?.scaleText?.trim();
  if (!text) return row;
  const effective = effectiveScale(text, size.width, size.height, sheet?.paperText);
  if (!effective) return { ...row, status: NOT_TO_SCALE.test(text) ? 'nts' : 'none' };
  const proposed = effective.scale;
  const status: ScaleReviewStatus = current ? (sameScale(current, proposed) ? 'matches' : 'differs') : effective.aspectMismatch || effective.unknownSize || proposed.metersPerPoint < MIN_PLAUSIBLE_METERS_PER_POINT ? 'check' : effective.printRatio === 1 ? 'ready' : 'resized';
  return { ...row, stated: effective.statement.paper?.name ?? null, proposed, printRatio: effective.printRatio, status };
}

/** Rows picked to apply when the review opens: unscaled pages whose title-block scale needs no checking. */
export function defaultPicks(rows: readonly ScaleReviewRow[]): Set<number> {
  return new Set(rows.filter((r) => r.status === 'ready' || r.status === 'resized').map((r) => r.page));
}

/** Rows a person should look at: everything except pages agreeing with their title block and their own lengths. */
export function needsReview(row: ScaleReviewRow): boolean {
  return row.status !== 'matches' || row.check?.result === 'disagrees';
}
