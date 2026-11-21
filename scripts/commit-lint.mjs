#!/usr/bin/env node
// Checks the commits on this branch before you push, so CI does not find the problem for you.
//
//   pnpm commit:lint              commits since this branch left origin/master
//   pnpm commit:lint origin/foo   commits since another base
//
// Fails on:
//   - client identifiers in commit messages, added lines or added files (the same guard CI runs)
//   - any word listed in .commit-lint.local (one per line, never committed: put names that must
//     not appear in commits, branch names or the pull request here, such as competitor names)
//   - fixup!, squash! and amend! commits that were never folded in
// Warns about:
//   - a subject over 72 characters, or one that starts with WIP
//   - a file over 5 MB added to the branch (drawings and PDFs belong in reference_data, not git)
//   - a merge commit (the repo squash-merges; rebase instead)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { c, out, root, run, tryOut } from './lib/cli.mjs';

const base = process.argv[2] ?? (tryOut('git', ['rev-parse', '--verify', 'origin/master']) ? 'origin/master' : 'master');
const mergeBase = tryOut('git', ['merge-base', base, 'HEAD']);
if (!mergeBase) {
  console.error(`Cannot find where this branch left ${base}.`);
  process.exit(2);
}
const range = `${mergeBase}..HEAD`;
const branch = tryOut('git', ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '';

const commits = out('git', ['log', '--reverse', '--format=%H%x1f%P%x1f%s%x1f%B%x1e', range])
  .split('\x1e')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [sha, parents, subject, body] = s.split('\x1f');
    return { sha, short: sha.slice(0, 8), merge: parents.trim().split(' ').length > 1, subject, body };
  });

console.log(c.bold(`${commits.length} commit${commits.length === 1 ? '' : 's'}`) + c.dim(` on ${branch} since ${base}`));
if (!commits.length) process.exit(0);

const problems = [];
const warnings = [];

// 1. the repository's own client-data guard
const guard = run('node', ['scripts/check-client-data.mjs', '--range', range]);
if (guard.status !== 0) {
  const r = guard;
  problems.push(`Client data guard:\n${(r.stderr || r.stdout).trim().replace(/^/gm, '    ')}`);
}

// 2. private blocked words
const localFile = join(root, '.commit-lint.local');
const words = existsSync(localFile)
  ? readFileSync(localFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
if (words.length) {
  const re = new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  for (const cm of commits) {
    const hit = re.exec(`${cm.subject}\n${cm.body}`);
    if (hit) problems.push(`${cm.short} "${cm.subject}": message contains a blocked word (see .commit-lint.local).`);
  }
  if (re.test(branch)) problems.push('The branch name contains a blocked word (see .commit-lint.local).');
  // The pull request title and description, when there is one.
  const pr = tryOut('gh', ['pr', 'view', '--json', 'title,body']);
  if (pr) {
    const { title, body } = JSON.parse(pr);
    if (re.test(`${title}\n${body}`)) problems.push('The pull request title or description contains a blocked word (see .commit-lint.local).');
  }
} else {
  warnings.push('No .commit-lint.local, so no private words are checked. Create it with one word per line.');
}

// 3. leftovers, long subjects, merges
for (const cm of commits) {
  if (/^(fixup|squash|amend)!/.test(cm.subject)) problems.push(`${cm.short} "${cm.subject}": a ${cm.subject.split('!')[0]}! commit that was never folded in.`);
  if (cm.subject.length > 72) warnings.push(`${cm.short}: subject is ${cm.subject.length} characters (72 or fewer reads best).`);
  if (/^wip\b/i.test(cm.subject)) warnings.push(`${cm.short} "${cm.subject}": looks like work in progress.`);
  if (cm.merge) warnings.push(`${cm.short} "${cm.subject}": a merge commit. The repo squash-merges; rebase onto ${base} instead.`);
}

// 4. big added files
const added = out('git', ['diff', '--name-only', '--diff-filter=AM', range]).split('\n').filter(Boolean);
for (const f of added) {
  const size = Number(tryOut('git', ['cat-file', '-s', `HEAD:${f}`]) ?? 0);
  if (size > 5 * 1024 * 1024) warnings.push(`${f} is ${(size / 1048576).toFixed(1)} MB. Large files bloat the public repo.`);
}

for (const w of warnings) console.log(`${c.yellow('!')} ${w}`);
for (const p of problems) console.log(`${c.red('✖')} ${p}`);
if (problems.length) {
  console.log(c.red(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}. Fix before pushing.`));
  process.exit(1);
}
console.log(c.green(`\nClean${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.`));
