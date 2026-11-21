#!/usr/bin/env node
// One table of the open pull requests: checks, review, whether they can merge, auto-merge, and
// which stack each one sits on.
//
//   pnpm pr:status            every open pull request
//   pnpm pr:status --mine     only yours
//   pnpm pr:status --json     machine-readable
import { c, flag, out, tryOut } from './lib/cli.mjs';

const args = process.argv.slice(2);
const mine = flag(args, '--mine');
const asJson = flag(args, '--json');

if (tryOut('gh', ['auth', 'status']) === null) {
  console.error('The GitHub CLI is not signed in. Run: gh auth login');
  process.exit(1);
}

const fields = 'number,title,headRefName,baseRefName,isDraft,reviewDecision,mergeStateStatus,mergeable,autoMergeRequest,statusCheckRollup,updatedAt,author,url';
const listArgs = ['pr', 'list', '--state', 'open', '--limit', '200', '--json', fields];
if (mine) listArgs.push('--author', '@me');
const prs = JSON.parse(out('gh', listArgs));

/** Summarises the check rollup: failing wins over pending wins over passing. */
function ci(rollup) {
  if (!rollup?.length) return { text: 'none', level: 'none' };
  let fail = 0;
  let pending = 0;
  let pass = 0;
  for (const x of rollup) {
    const state = x.__typename === 'StatusContext' ? x.state : x.status !== 'COMPLETED' ? 'PENDING' : x.conclusion;
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(state)) fail++;
    else if (['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING'].includes(state)) pending++;
    else pass++;
  }
  if (fail) return { text: `${fail} failing`, level: 'fail' };
  if (pending) return { text: `${pending} running`, level: 'pending' };
  return { text: `${pass} passing`, level: 'pass' };
}

const MERGE = {
  CLEAN: ['ready', 'pass'],
  HAS_HOOKS: ['ready', 'pass'],
  UNSTABLE: ['checks failing', 'fail'],
  BEHIND: ['behind base', 'pending'],
  BLOCKED: ['blocked', 'pending'],
  DIRTY: ['conflicts', 'fail'],
  DRAFT: ['draft', 'none'],
  UNKNOWN: ['unknown', 'none'],
};
const REVIEW = { APPROVED: ['approved', 'pass'], CHANGES_REQUESTED: ['changes asked', 'fail'], REVIEW_REQUIRED: ['needs review', 'pending'] };

const age = (iso) => {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  return h < 1 ? 'now' : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const colour = (level, text) => ({ pass: c.green, fail: c.red, pending: c.yellow, none: c.dim })[level](text);

const rows = prs
  .sort((a, b) => a.number - b.number)
  .map((p) => {
    const check = ci(p.statusCheckRollup);
    const [mergeText, mergeLevel] = p.isDraft ? ['draft', 'none'] : (MERGE[p.mergeStateStatus] ?? [p.mergeStateStatus.toLowerCase(), 'none']);
    const [revText, revLevel] = REVIEW[p.reviewDecision] ?? ['-', 'none'];
    return {
      number: p.number,
      title: p.title,
      branch: p.headRefName,
      base: p.baseRefName,
      draft: p.isDraft,
      ci: check,
      review: [revText, revLevel],
      merge: [mergeText, mergeLevel],
      auto: Boolean(p.autoMergeRequest),
      age: age(p.updatedAt),
      author: p.author?.login,
      url: p.url,
    };
  });

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
if (!rows.length) {
  console.log('No open pull requests.');
  process.exit(0);
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
const header = ['#', 'Title', 'Checks', 'Review', 'Merge', 'Auto', 'Updated'];
const cells = rows.map((r) => [
  `#${r.number}`,
  clip(r.title, 52),
  r.ci.text,
  r.review[0],
  r.merge[0],
  r.auto ? 'on' : '-',
  r.age,
]);
const widths = header.map((h, i) => Math.max(h.length, ...cells.map((row) => row[i].length)));
console.log(c.bold(header.map((h, i) => pad(h, widths[i])).join('  ')));
rows.forEach((r, k) => {
  const row = cells[k];
  const line = [
    pad(row[0], widths[0]),
    pad(row[1], widths[1]),
    colour(r.ci.level, pad(row[2], widths[2])),
    colour(r.review[1], pad(row[3], widths[3])),
    colour(r.merge[1], pad(row[4], widths[4])),
    pad(row[5], widths[5]),
    row[6],
  ].join('  ');
  console.log(line);
  if (r.base !== 'master') console.log(c.dim(`${' '.repeat(widths[0] + 2)}↳ stacked on ${r.base}`));
});

const count = (f) => rows.filter(f).length;
console.log(
  c.dim(
    `\n${rows.length} open · ${count((r) => r.draft)} draft · ${count((r) => r.merge[0] === 'ready')} ready to merge · ${count((r) => r.ci.level === 'fail')} with failing checks · ${count((r) => r.merge[0] === 'conflicts')} with conflicts`,
  ),
);
