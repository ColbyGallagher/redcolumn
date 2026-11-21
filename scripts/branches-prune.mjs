#!/usr/bin/env node
// Finds local branches (and their worktrees) whose pull request has been merged, and deletes them.
// It only shows what it would do unless you pass --apply.
//
//   pnpm branches:prune             show what would be removed
//   pnpm branches:prune --apply     remove it
//
// A branch counts as merged only when GitHub has a merged pull request from that branch AND the
// local branch is exactly where the pull request ended (no commits made after). A branch with
// later commits, a worktree with uncommitted changes, the branch you are on and master are never
// touched. Remote branches are not touched.
import { resolve } from 'node:path';
import { c, flag, out, root, run, tryOut } from './lib/cli.mjs';

const args = process.argv.slice(2);
const apply = flag(args, '--apply');
const verbose = flag(args, '--verbose');

if (tryOut('gh', ['auth', 'status']) === null) {
  console.error('The GitHub CLI is not signed in. Run: gh auth login');
  process.exit(1);
}
run('git', ['fetch', '--prune', 'origin'], { stdio: 'ignore' });

const merged = JSON.parse(out('gh', ['pr', 'list', '--state', 'merged', '--limit', '500', '--json', 'number,headRefName,headRefOid,title']));
const byBranch = new Map();
for (const pr of merged) {
  const list = byBranch.get(pr.headRefName) ?? [];
  list.push(pr);
  byBranch.set(pr.headRefName, list);
}

const here = tryOut('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const branches = out('git', ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads']).split('\n').filter(Boolean).map((l) => l.split(' '));

// worktrees: path by branch
const worktrees = new Map();
let cur = {};
for (const line of out('git', ['worktree', 'list', '--porcelain']).split('\n')) {
  if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
  else if (line.startsWith('branch ')) worktrees.set(line.slice(7).replace('refs/heads/', ''), cur.path);
}
const mainPath = resolve(out('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root }), '..');

const plan = [];
const kept = [];
for (const [name, sha] of branches) {
  if (name === 'master' || name === 'main' || name === here) continue;
  const prs = byBranch.get(name);
  if (!prs) {
    kept.push([name, 'no merged pull request']);
    continue;
  }
  if (!prs.some((p) => p.headRefOid === sha)) {
    kept.push([name, 'has commits after its pull request merged']);
    continue;
  }
  const pr = prs.find((p) => p.headRefOid === sha);
  const wt = worktrees.get(name);
  let note = '';
  let removeWorktree = false;
  if (wt) {
    if (resolve(wt) === resolve(root) || resolve(wt) === mainPath) {
      kept.push([name, 'checked out in the main checkout or this worktree']);
      continue;
    }
    const dirty = tryOut('git', ['status', '--porcelain'], { cwd: wt });
    if (dirty === null) note = 'worktree folder is gone; will be unregistered';
    else if (dirty) {
      kept.push([name, `worktree has uncommitted changes (${wt})`]);
      continue;
    } else note = `worktree ${wt} will be removed`;
    removeWorktree = true;
  }
  plan.push({ name, sha, pr, wt, removeWorktree, note });
}

if (plan.length) {
  console.log(c.bold(apply ? 'Removing' : 'Would remove'));
  for (const p of plan) console.log(`  ${c.red('✖')} ${p.name}  ${c.dim(`#${p.pr.number} ${p.pr.title}`)}${p.note ? `\n      ${c.dim(p.note)}` : ''}`);
} else console.log('Nothing to remove.');

if (verbose && kept.length) {
  console.log(c.bold('\nKept'));
  for (const [n, why] of kept) console.log(`  ${n}  ${c.dim(why)}`);
} else if (kept.length) console.log(c.dim(`\n${kept.length} other branch${kept.length === 1 ? '' : 'es'} kept (--verbose lists why).`));

if (!apply) {
  if (plan.length) console.log(`\nRun again with ${c.bold('--apply')} to remove the ${plan.length} above.`);
  process.exit(0);
}

let removed = 0;
for (const p of plan) {
  if (p.removeWorktree) {
    const r = run('git', ['worktree', 'remove', '--force', p.wt]);
    if (r.status !== 0) run('git', ['worktree', 'prune']);
  }
  const r = run('git', ['branch', '-D', p.name]);
  if (r.status === 0) removed++;
  else console.error(c.yellow(`Could not delete ${p.name}: ${r.stderr.trim()}`));
}
run('git', ['worktree', 'prune']);
console.log(c.green(`\nRemoved ${removed} branch${removed === 1 ? '' : 'es'}.`));
