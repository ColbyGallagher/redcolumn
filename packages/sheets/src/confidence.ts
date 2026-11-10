/**
 * How sure link detection is, and how sure the person can be of a whole step.
 *
 * Each link carries the evidence it was found on: what form the reference took (a bubble, a slash
 * reference, a chainage) and what was checked about it (its title found, a bubble on the target
 * sheet naming this one, its alignment agreed on both ends, the chainage inside the target
 * sheet's range). Every piece of evidence moves the
 * odds that the link is right, by a weight in log-odds, so the reasons add up and can be shown
 * ("why 62%"). Weights are set by hand and checked against `pnpm standards:bench`.
 *
 * For a step of the setup wizard (all section links, all chainage links), the meter combines how
 * much was found with how right it is: the scores' average until the person checks examples, then
 * their checks, with the scores counting as a few checks more (so 8 right of 8 is not 100%, and
 * 1 wrong of 1 is not 0%). Alongside, the lower bound of what the checks alone say.
 */
import type { DetectedLink } from './links.ts';

export type EvidenceKey =
  // What the reference is (one per link): sets the starting odds.
  | 'bubble'
  | 'slash'
  | 'reference'
  | 'chainage'
  // What was checked.
  | 'titleFound'
  | 'cutMarker'
  | 'noTarget'
  | 'matchLineLabel'
  | 'alignmentAgrees'
  | 'alignmentUnknown'
  | 'severalAlignments'
  | 'sectionsOnSeveral'
  | 'aiProposed'
  | 'inSheetRange'
  | 'outsideSheetRange';

/**
 * What each piece of evidence adds, in log-odds (negative: makes a link less likely right). Links
 * keep only the keys, so stored links stay small and re-score when weights are tuned. The forms start from what each was trusted with before evidence was kept
 * (a bubble 0.9, a slash reference 0.85, a plain reference 0.8, a chainage 0.6), so detection
 * that checks nothing more scores as it did.
 */
export const EVIDENCE: Record<EvidenceKey, { weight: number; says: string }> = {
  bubble: { weight: 2.2, says: 'an identifier over a sheet number, as callout bubbles are drawn' },
  slash: { weight: 1.73, says: 'a slash reference such as 3/C-501' },
  reference: { weight: 1.39, says: 'a sheet number written in the text' },
  chainage: { weight: 0.41, says: 'a chainage read from the text' },
  titleFound: { weight: 0, says: 'the title it points to is on the target sheet' },
  cutMarker: { weight: 0.4, says: 'the target sheet has a bubble with this identifier naming this sheet' },
  noTarget: { weight: -1.2, says: 'no title with that identifier on the target sheet' },
  matchLineLabel: { weight: 0.8, says: 'the sheet number is on a label that says match line' },
  alignmentAgrees: { weight: 1.33, says: 'the drawing standard names the alignment, and both ends are on it' },
  alignmentUnknown: { weight: 0, says: 'which alignment this chainage is on could not be told' },
  severalAlignments: { weight: -0.4, says: 'the sheet shows several alignments, and this chainage could be on another' },
  aiProposed: { weight: 0, says: 'proposed by an AI assistant over MCP, waiting for a person to keep it' },
  sectionsOnSeveral: { weight: -0.6, says: 'cross sections at this chainage are drawn for more than one alignment' },
  inSheetRange: { weight: 0.4, says: "the chainage is inside the range in the target sheet's title" },
  outsideSheetRange: { weight: -1.0, says: "the chainage is outside the range in the target sheet's title" },
};

/** A link's confidence from its evidence: the odds the evidence adds up to, as 0..1 to two places. */
export function scoreEvidence(found: readonly EvidenceKey[]): number {
  const logOdds = found.reduce((s, k) => s + EVIDENCE[k].weight, 0);
  return Math.round(100 / (1 + Math.exp(-logOdds))) / 100;
}

/** Why a link scored what it did, strongest reasons first, for the person. */
export function explain(link: Pick<DetectedLink, 'evidence'>): { says: string; effect: 'raises' | 'lowers' | 'notes' }[] {
  return (link.evidence ?? [])
    .filter((k) => Object.hasOwn(EVIDENCE, k))
    .map((k) => EVIDENCE[k])
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .map((e) => ({ says: e.says, effect: e.weight > 0 ? 'raises' : e.weight < 0 ? 'lowers' : 'notes' }));
}

/**
 * The lower end of a 95% Wilson interval for `right` of `checked`: how right the links are at
 * least, going by a few checked examples. 8 right of 8 says at least 68%, not 100%.
 */
export function wilsonLower(right: number, checked: number, z = 1.96): number {
  if (checked <= 0) return 0;
  const p = right / checked;
  const z2 = z * z;
  const centre = p + z2 / (2 * checked);
  const spread = z * Math.sqrt((p * (1 - p)) / checked + z2 / (4 * checked * checked));
  return Math.max(0, (centre - spread) / (1 + z2 / checked));
}

/** A small, repeatable random number source (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Links for the person to check: the least sure first (where mistakes are), one from the middle,
 * and the rest at random, so a step's check is not only its doubtful links. The same links and
 * seed give the same sample.
 */
export function spotCheckSample<T extends Pick<DetectedLink, 'id' | 'confidence'>>(links: readonly T[], count = 8, seed = 1): T[] {
  if (links.length <= count) return [...links];
  const byScore = [...links].sort((a, b) => a.confidence - b.confidence || a.id.localeCompare(b.id));
  const lowest = Math.max(1, Math.round(count / 4));
  const picked = new Set<T>(byScore.slice(0, lowest));
  picked.add(byScore[Math.floor(byScore.length / 2)]!);
  const rest = byScore.filter((l) => !picked.has(l));
  const next = random(seed);
  while (picked.size < count && rest.length) picked.add(rest.splice(Math.floor(next() * rest.length), 1)[0]!);
  return byScore.filter((l) => picked.has(l));
}

/** Meter bands: links apply; links apply but the flagged ones want a look; hand the step to AI. */
export type Band = 'good' | 'review' | 'ai';
export const GOOD_FROM = 0.9;
export const USABLE_FROM = 0.7;
/** Above this share of pages with no text layer, text detection cannot do the job. */
export const NO_TEXT_SHARE = 0.1;
/** How many checks the scores' average counts as, once the person has checked some. */
export const SCORES_COUNT_AS = 4;

export interface StepInput {
  /** The step's links (all kinds it covers). */
  links: readonly Pick<DetectedLink, 'id' | 'confidence'>[];
  /** References seen in the set for this step, linked or not (callouts, chainages); 0 when unknown. */
  references: number;
  /** Of those, how many got at least one link (one reference can link to two sheets). */
  linked: number;
  /** The person's checks, by link id: true right, false wrong. */
  checks?: ReadonlyMap<string, boolean>;
  /** Pages with no text layer, and all pages. */
  pagesWithoutText?: number;
  pages?: number;
  /** Marks found by shape whose identifier could not be read. */
  unreadable?: number;
}

export interface StepMeter {
  /** Share of references that got a link (1 when references are not known and there are links). */
  coverage: number;
  /** How right the links are thought to be. */
  accuracy: number;
  /** Where `accuracy` comes from. */
  from: 'scores' | 'checks';
  /** What the checks alone say the links are right at least (95%); null before any check. */
  atLeast: number | null;
  checked: number;
  wrong: number;
  /** coverage × accuracy: how much of the step's work is done right. */
  score: number;
  band: Band;
  warnings: string[];
}

/** How a wizard step is doing, and whether to recommend AI for it. */
export function stepMeter(input: StepInput): StepMeter {
  const { links, references } = input;
  const linked = Math.min(input.linked, references);
  const coverage = references > 0 ? linked / references : links.length ? 1 : 0;
  const results = [...(input.checks ?? new Map()).entries()].filter(([id]) => links.some((l) => l.id === id));
  const checked = results.length;
  const wrong = results.filter(([, ok]) => !ok).length;
  const byScores = links.length ? links.reduce((s, l) => s + l.confidence, 0) / links.length : 0;
  const accuracy = (checked - wrong + SCORES_COUNT_AS * byScores) / (checked + SCORES_COUNT_AS);
  const score = coverage * accuracy;
  const warnings: string[] = [];
  const noText = input.pages ? (input.pagesWithoutText ?? 0) / input.pages : 0;
  if (noText > NO_TEXT_SHARE) warnings.push(`${input.pagesWithoutText} of ${input.pages} pages have no text to read`);
  if (input.unreadable) warnings.push(`${input.unreadable} marks were found by shape but their text could not be read`);
  if (references > 0 && linked < references) warnings.push(`${references - linked} of ${references} found no sheet to link to`);
  if (wrong) warnings.push(`${wrong} of ${checked} checked links were wrong`);
  const band: Band = !links.length || noText > NO_TEXT_SHARE || score < USABLE_FROM ? 'ai' : score < GOOD_FROM ? 'review' : 'good';
  return { coverage, accuracy, from: checked ? 'checks' : 'scores', atLeast: checked ? wilsonLower(checked - wrong, checked) : null, checked, wrong, score, band, warnings };
}
