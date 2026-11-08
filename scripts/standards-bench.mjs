// Link-detection benchmark: runs the app's sheet and link detection on a drawing set and scores it
// against an answer key of every cross-reference the set really draws.
//
//   pnpm standards:bench [set.pdf] [--truth set.links.json] [--standard file.rcstandard] [--json out.json]
//
// With no arguments it scores the Kestrel Road demo set (docs/demo-sets), whose answer key the
// set's generator writes (python scripts/make_road_set.py). A real set can be scored with a
// hand-made answer key in the same format; keep client sets and their keys out of the repo.
//
// What is scored, per kind (section, detail, elevation, matchline, chainage):
// - recall: answer-key references that got a link to a right sheet;
// - precision: of the links found on answer-key references or of an in-scope kind, how many go
//   to a right sheet;
// - kind: links on a reference that carry the reference's kind;
// - lands: links on titled drawings whose target area covers the title.
// Plain sheet references (`REFER TO DRG ...`) and the index are not in the key, so links of kind
// `sheet` count only where they sit on a key reference. Optional key entries (a chainage in a note)
// are scored when something links them, and not missed when nothing does.
// Calibration compares the confidence detection gave each link with how often links at that
// confidence were right (by band, plus the expected calibration error and Brier score: lower is
// better), and how right the links applied without review (confidence 0.75 and up) are.
// Steps: the setup wizard's meter for each step as the person would see it, after checking a
// spot-check sample (answered here from the key).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : null;
};
const truthArg = flag('--truth');
const standardArg = flag('--standard');
const jsonOut = flag('--json');
const file = resolve(args[0] ?? join(root, 'docs/demo-sets/kestrel-road-set.pdf'));
const truthFile = resolve(truthArg ?? file.replace(/\.pdf$/i, '.links.json'));
if (!existsSync(file) || !existsSync(truthFile)) {
  console.error(`Usage: pnpm standards:bench [set.pdf] [--truth set.links.json] [--standard file.rcstandard] [--json out.json]\nMissing: ${existsSync(file) ? truthFile : file}`);
  process.exit(1);
}

const sheetsLib = await import(pathToFileURL(join(root, 'packages/sheets/src/index.ts')).href);
const { detectSheets, detectLinks, detectChainageLinks, DEFAULT_LINK_HINTS, DEFAULT_CHAINAGE_HINTS, spotCheckSample, stepMeter } = sheetsLib;

let standard = null;
if (standardArg) {
  const { parseStandardFile } = await import(pathToFileURL(join(root, 'apps/web/src/sheets/standards.ts')).href);
  standard = parseStandardFile(readFileSync(standardArg, 'utf8'));
}

// ---- read the set as the app does
const pdf = await globalThis.__pdfNode();
const t0 = performance.now();
const { docId, pages: sizes } = await pdf.open(new Uint8Array(readFileSync(file)).buffer);
const pages = [];
for (let i = 0; i < sizes.length; i++) pages.push({ width: sizes[i].width, height: sizes[i].height, words: await pdf.text(docId, i) });
await pdf.close(docId);
const tText = performance.now() - t0;

const t1 = performance.now();
const sheets = detectSheets(pages, standard?.sheets);
const numbers = sheets.map((s) => s?.number ?? null);
const links = [
  ...detectLinks(pages, numbers, standard?.links ?? DEFAULT_LINK_HINTS),
  ...detectChainageLinks(pages, sheets, standard?.chainage ?? DEFAULT_CHAINAGE_HINTS, !!standard),
];
const tDetect = performance.now() - t1;

// ---- score
const truth = JSON.parse(readFileSync(truthFile, 'utf8'));
const KINDS = ['section', 'detail', 'elevation', 'matchline', 'chainage'];
const PAD = 3;

const overlaps = (a, b, pad = 0) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
const rectOf = ([x, y, w, h]) => ({ x, y, w, h });
const keyLinks = truth.links.map((t) => ({ ...t, r: rectOf(t.rect), target: t.targetRect ? rectOf(t.targetRect) : null }));

const stats = Object.fromEntries(KINDS.map((k) => [k, { key: 0, linked: 0, right: 0, kind: 0, titled: 0, lands: 0, found: 0, foundRight: 0 }]));
/** Every link found, with whether it went somewhere right (null: not something the key covers). */
const scored = [];
const claimed = new Set();
for (const t of keyLinks) {
  const s = stats[t.kind];
  if (!t.optional) s.key++;
  const on = links.filter((l) => l.pageIndex === t.pageIndex && overlaps(l.rect, t.r, PAD));
  on.forEach((l) => claimed.add(l));
  const right = on.filter((l) => t.targetPages.includes(l.targetPage));
  if (!t.optional) {
    if (on.length) s.linked++;
    if (right.length) s.right++;
    if (right.some((l) => l.kind === t.kind)) s.kind++;
  }
  if (t.target && !t.optional) {
    s.titled++;
    if (right.some((l) => l.targetRect && overlaps(l.targetRect, t.target))) s.lands++;
  }
  for (const l of on) {
    s.found++;
    const ok = t.targetPages.includes(l.targetPage);
    if (ok) s.foundRight++;
    scored.push({ link: l, kind: t.kind, ok, key: t });
  }
}
// Links of an in-scope kind on nothing in the key. A chainage written elsewhere (a note, a long
// section's table) is right when it goes to a plan showing that chainage or the cross section
// drawn at it, on any alignment; anything else is wrong (a bubble that is not one).
const coverage = truth.chainages ?? {};
const chainageValue = (label) => {
  const m = /(\d+)(?:\+(\d+(?:\.\d+)?)|(\.\d+)?)\s*$/.exec(label.replace(/^\D+/, ''));
  if (!m) return null;
  return m[2] !== undefined ? Number(m[1]) * 1000 + Number(m[2]) : Number(m[1] + (m[3] ?? ''));
};
const showsChainage = (page, v) =>
  Object.values(coverage).some(
    (c) => c.plans.some((p) => p.pageIndex === page && v >= p.from - 0.5 && v <= p.to + 0.5) || c.sections.some((x) => x.pageIndex === page && x.values.some((y) => Math.abs(y - v) < 0.05)),
  );
const spurious = links.filter((l) => !claimed.has(l) && KINDS.includes(l.kind));
for (const l of spurious) {
  const v = l.kind === 'chainage' ? chainageValue(l.label) : null;
  const ok = v !== null && showsChainage(l.targetPage, v);
  stats[l.kind].found++;
  if (ok) stats[l.kind].foundRight++;
  scored.push({ link: l, kind: l.kind, ok, key: null });
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const pad = (v, n) => String(v).padEnd(n);
const lpad = (v, n) => String(v).padStart(n);

const sheetRight = truth.sheets.filter((s) => numbers[s.pageIndex]?.toUpperCase() === s.number.toUpperCase()).length;

console.log(`\n${file}`);
console.log(`${pages.length} pages, text ${(tText / 1000).toFixed(1)} s, detection ${(tDetect / 1000).toFixed(2)} s${standard ? `, standard "${standard.name}"` : ', no drawing standard'}`);
console.log(`Sheet numbers read: ${sheetRight} of ${truth.sheets.length}\n`);
console.log(`${pad('kind', 11)}${lpad('key', 5)}${lpad('recall', 8)}${lpad('precision', 11)}${lpad('kind ok', 9)}${lpad('lands', 7)}${lpad('found', 7)}`);
const total = { key: 0, right: 0, found: 0, foundRight: 0 };
for (const k of KINDS) {
  const s = stats[k];
  for (const f of Object.keys(total)) total[f] += s[f];
  console.log(`${pad(k, 11)}${lpad(s.key, 5)}${lpad(pct(s.right, s.key), 8)}${lpad(pct(s.foundRight, s.found), 11)}${lpad(pct(s.kind, s.right), 9)}${lpad(s.titled ? pct(s.lands, s.titled) : '-', 7)}${lpad(s.found, 7)}`);
}
console.log(`${pad('all', 11)}${lpad(total.key, 5)}${lpad(pct(total.right, total.key), 8)}${lpad(pct(total.foundRight, total.found), 11)}${lpad('', 9)}${lpad('', 7)}${lpad(total.found, 7)}`);

// ---- calibration: confidence given vs how often right
const BANDS = [0, 0.5, 0.7, 0.85, 1.0001];
console.log('\nconfidence   links   right');
const calibration = [];
for (let i = 0; i < BANDS.length - 1; i++) {
  const inBand = scored.filter((x) => x.link.confidence >= BANDS[i] && x.link.confidence < BANDS[i + 1]);
  const right = inBand.filter((x) => x.ok).length;
  calibration.push({ from: BANDS[i], to: Math.min(1, BANDS[i + 1]), links: inBand.length, right });
  console.log(`${pad(`${BANDS[i].toFixed(2)}-${Math.min(1, BANDS[i + 1]).toFixed(2)}`, 13)}${lpad(inBand.length, 5)}${lpad(pct(right, inBand.length), 8)}`);
}
// Expected calibration error over ten equal-width bins, and Brier score.
const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, right: 0 }));
for (const x of scored) {
  const b = bins[Math.min(9, Math.floor(x.link.confidence * 10))];
  b.n++;
  b.conf += x.link.confidence;
  b.right += x.ok ? 1 : 0;
}
const ece = scored.length ? bins.reduce((s, b) => s + (b.n ? Math.abs(b.conf - b.right) : 0), 0) / scored.length : 0;
const brier = scored.length ? scored.reduce((s, x) => s + (x.link.confidence - (x.ok ? 1 : 0)) ** 2, 0) / scored.length : 0;
const AUTO = 0.75;
const applied = scored.filter((x) => x.link.confidence >= AUTO);
console.log(`calibration error ${ece.toFixed(3)}, Brier ${brier.toFixed(3)}`);
console.log(`applied without review: ${applied.length} of ${scored.length}, ${pct(applied.filter((x) => x.ok).length, applied.length)} right`);

// ---- each piece of evidence: how many links carry it and how often they are right (for tuning EVIDENCE weights)
const byEvidence = new Map();
for (const x of scored) for (const k of x.link.evidence ?? []) {
  const e = byEvidence.get(k) ?? { links: 0, right: 0 };
  e.links++;
  e.right += x.ok ? 1 : 0;
  byEvidence.set(k, e);
}
console.log(`
${pad('evidence', 19)}${lpad('links', 6)}${lpad('right', 7)}`);
for (const [k, e] of [...byEvidence].sort((a, b) => b[1].links - a[1].links)) console.log(`${pad(k, 19)}${lpad(e.links, 6)}${lpad(pct(e.right, e.links), 7)}`);

// ---- the wizard's meter per step, after a spot check answered from the key
const STEPS = { sections: ['section'], elevations: ['elevation'], details: ['detail'], 'match lines': ['matchline'], chainage: ['chainage'] };
console.log(`
${pad('step', 13)}${lpad('links', 6)}${lpad('checked', 9)}${lpad('wrong', 7)}${lpad('accuracy', 10)}${lpad('at least', 10)}  band`);
const steps = {};
for (const [name, kinds] of Object.entries(STEPS)) {
  const inStep = scored.filter((x) => kinds.includes(x.kind));
  const required = keyLinks.filter((t) => kinds.includes(t.kind) && !t.optional);
  const references = required.length;
  const linked = required.filter((t) => scored.some((x) => x.key === t)).length;
  const sample = spotCheckSample(inStep.map((x) => ({ id: x.link.id, confidence: x.link.confidence, x })));
  const checks = new Map(sample.map((l) => [l.id, l.x.ok]));
  const meter = stepMeter({ links: inStep.map((x) => x.link), references, linked, checks });
  steps[name] = meter;
  console.log(
    `${pad(name, 13)}${lpad(inStep.length, 6)}${lpad(meter.checked, 9)}${lpad(meter.wrong, 7)}${lpad(pct(meter.accuracy * 100, 100), 10)}${lpad(meter.atLeast === null ? '-' : pct(meter.atLeast * 100, 100), 10)}  ${meter.band}${meter.warnings.length ? `  (${meter.warnings.join('; ')})` : ''}`,
  );
}

// ---- what went wrong, briefly
const missed = keyLinks.filter((t) => !t.optional && !scored.some((x) => x.key === t && x.ok));
if (missed.length) {
  console.log(`\nMissed (${missed.length}):`);
  for (const t of missed.slice(0, 25)) console.log(`  p${t.pageIndex + 1} ${t.kind} "${t.label}"${t.alignment ? ` ${t.alignment}` : ''} -> p${t.targetPages.map((p) => p + 1).join('/')}`);
  if (missed.length > 25) console.log(`  ... and ${missed.length - 25} more`);
}
const wrong = scored.filter((x) => !x.ok);
if (wrong.length) {
  console.log(`\nWrong links (${wrong.length}):`);
  for (const x of wrong.slice(0, 25)) console.log(`  p${x.link.pageIndex + 1} ${x.link.kind} "${x.link.label}" -> p${x.link.targetPage + 1} (${Math.round(x.link.confidence * 100)}%)${!x.key ? ' not a reference' : x.key.targetPages.length ? ` should be p${x.key.targetPages.map((p) => p + 1).join('/')}` : ' should not link'}`);
  if (wrong.length > 25) console.log(`  ... and ${wrong.length - 25} more`);
}

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ file, standard: standard?.name ?? null, pages: pages.length, sheetNumbers: { right: sheetRight, of: truth.sheets.length }, kinds: stats, calibration, ece, brier, evidence: Object.fromEntries(byEvidence), applied: { links: applied.length, right: applied.filter((x) => x.ok).length }, steps, missed: missed.length, wrong: wrong.length }, null, 1) + '\n',
  );
}
process.exit(0);
