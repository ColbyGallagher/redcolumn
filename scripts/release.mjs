#!/usr/bin/env node
// Publishes a new desktop build. Two steps, because the version bump goes through a pull request
// (like every other change) and the tag must go on the merged commit:
//
//   pnpm release status                       where things stand: version, last tag, last build
//   pnpm release prepare patch|minor|major    open the "Desktop x.y.z" pull request
//   pnpm release prepare 0.2.0                (or an exact version; 0.3.0-beta.1 is a pre-release)
//   pnpm release tag                          after that pull request merged: tag it and start the build
//
// Options: --dry-run (show what would happen, change nothing), --yes (do not ask), --watch (tag:
// follow the build in the terminal), --force (tag: skip the changelog and CI safety checks).
//
// What happens after the tag is pushed is the Release workflow (.github/workflows/release.yml): it
// builds the Windows, Mac and Linux installers, then WAITS for you to approve the `release`
// environment on GitHub. Installed Windows apps update themselves once the release is published,
// so approving is the real "ship it" button, and this script never presses it.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c, confirm, flag, out, pause, run, show, tryOut } from './lib/cli.mjs';

const args = process.argv.slice(2);
const dryRun = flag(args, '--dry-run');
const yes = flag(args, '--yes');
const watch = flag(args, '--watch');
const force = flag(args, '--force');
const [command, arg] = args;

const DESKTOP_PKG = 'apps/desktop/package.json';
const CHANGELOG = 'apps/web/src/help/changelog.ts';
const STABLE = /^v\d+\.\d+\.\d+$/;

const fail = (msg) => {
  console.error(c.red(`\n${msg}`));
  process.exit(1);
};

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}
/** Negative when a is older than b (a pre-release is older than its release). */
function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  if (x.pre === y.pre) return 0;
  return x.pre === null ? 1 : y.pre === null ? -1 : x.pre < y.pre ? -1 : 1;
}

function preflight() {
  if (tryOut('gh', ['auth', 'status']) === null) fail('The GitHub CLI is not signed in. Run: gh auth login');
  const r = run('git', ['fetch', 'origin', 'master', '--tags', '--quiet']);
  if (r.status !== 0) fail(`Could not reach GitHub: ${r.stderr.trim()}`);
}

const latestStableTag = () =>
  out('git', ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').find((t) => STABLE.test(t)) ?? null;
const masterVersion = () => JSON.parse(out('git', ['show', `origin/master:${DESKTOP_PKG}`])).version;
const tagExistsRemote = (tag) => Boolean(tryOut('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]));
const repoName = () => out('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);

/** Pull request titles merged since the last release, as changelog starting points. */
function unreleasedSubjects(since) {
  const range = since ? `${since}..origin/master` : 'origin/master';
  return out('git', ['log', '--first-parent', '--format=%s', range])
    .split('\n')
    .filter(Boolean)
    .filter((s) => !/^Desktop \d+\.\d+\.\d+/.test(s))
    .map((s) => s.replace(/\s*\(#\d+\)/g, '').trim());
}

const quoteJs = (s) => (s.includes("'") ? `"${s.replace(/"/g, '\\"')}"` : `'${s}'`);

// ---------------------------------------------------------------- status
function status() {
  preflight();
  const tag = latestStableTag();
  const version = masterVersion();
  const behind = tag ? Number(out('git', ['rev-list', '--count', '--first-parent', `${tag}..origin/master`])) : 0;
  console.log(`${c.bold('Version on master')}   ${version}`);
  console.log(`${c.bold('Latest release tag')}   ${tag ?? 'none'}`);
  if (tag) {
    if (`v${version}` === tag) console.log(`${c.bold('Unreleased changes')}   ${behind} merged since ${tag}${behind ? c.dim(' (run: pnpm release prepare patch)') : ''}`);
    else if (compare(version, tag.slice(1)) > 0) console.log(c.yellow(`master is on ${version}, which is not tagged yet. Run: pnpm release tag`));
  }
  const prs = tryOut('gh', ['pr', 'list', '--state', 'open', '--search', 'head:release/', '--json', 'number,title,url']);
  for (const p of JSON.parse(prs ?? '[]')) console.log(`${c.bold('Open release PR')}      #${p.number} ${p.title} ${c.dim(p.url)}`);
  const runs = tryOut('gh', ['run', 'list', '--workflow', 'release.yml', '--limit', '3', '--json', 'displayTitle,status,conclusion,headBranch,url,event']);
  console.log(c.bold('\nRecent Release workflow runs'));
  for (const r of JSON.parse(runs ?? '[]')) {
    const state = r.status === 'completed' ? r.conclusion : r.status;
    console.log(`  ${r.headBranch.padEnd(14)} ${String(state).padEnd(12)} ${c.dim(r.url)}`);
  }
}

// ---------------------------------------------------------------- prepare
async function prepare() {
  if (!arg) fail('Usage: pnpm release prepare patch|minor|major|<version>');
  preflight();
  const current = masterVersion();
  const cur = parse(current);
  let next;
  if (['patch', 'minor', 'major'].includes(arg)) {
    const [a, b, d] = cur.n;
    next = arg === 'major' ? `${a + 1}.0.0` : arg === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${d + 1}`;
  } else if (parse(arg)) next = arg;
  else fail(`"${arg}" is not patch, minor, major or a version like 0.2.0.`);

  const last = latestStableTag();
  if (compare(next, current) <= 0) fail(`${next} is not newer than the version on master (${current}).`);
  if (last && !parse(next).pre && compare(next, last.slice(1)) <= 0) fail(`${next} is not newer than the last release (${last}).`);
  if (tagExistsRemote(`v${next}`)) fail(`The tag v${next} already exists on GitHub.`);
  const existing = JSON.parse(out('gh', ['pr', 'list', '--state', 'open', '--head', `release/v${next}`, '--json', 'url']));
  if (existing.length) fail(`There is already an open pull request for ${next}: ${existing[0].url}`);

  const subjects = unreleasedSubjects(last);
  console.log(c.bold(`Release ${current} → ${next}`) + c.dim(`  (${subjects.length} change${subjects.length === 1 ? '' : 's'} since ${last ?? 'the start'})`));
  for (const s of subjects.slice(0, 40)) console.log(c.dim(`  · ${s}`));
  if (subjects.length > 40) console.log(c.dim(`  … and ${subjects.length - 40} more`));
  if (dryRun) {
    console.log(c.yellow(`\nDry run. Would branch release/v${next} from origin/master, set apps/desktop to ${next}, add a changelog entry, and open a pull request "Desktop ${next}".`));
    return;
  }
  if (!(await confirm('\nCreate the release branch and pull request?', yes))) fail('Cancelled. Nothing was changed.');

  // Work in a temporary checkout of origin/master so your own branch and edits are not touched.
  const tmp = join(tmpdir(), `rc-release-${next}`);
  rmSync(tmp, { recursive: true, force: true });
  const branch = `release/v${next}`;
  const add = run('git', ['worktree', 'add', '--no-track', '-b', branch, tmp, 'origin/master']);
  if (add.status !== 0) fail(`Could not create a worktree: ${add.stderr.trim()}`);
  const cleanup = () => {
    run('git', ['worktree', 'remove', '--force', tmp]);
    run('git', ['worktree', 'prune']);
  };
  try {
    // 1. version
    const pkgPath = join(tmp, DESKTOP_PKG);
    const pkg = readFileSync(pkgPath, 'utf8');
    writeFileSync(pkgPath, pkg.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));

    // 2. changelog draft: edit it before it is committed
    const clPath = join(tmp, CHANGELOG);
    const cl = readFileSync(clPath, 'utf8');
    const marker = /export const CHANGELOG: readonly ChangelogEntry\[\] = \[\r?\n/;
    const found = marker.exec(cl);
    if (!found) throw new Error(`Could not find the changelog list in ${CHANGELOG}.`);
    const eol = found[0].endsWith('\r\n') ? '\r\n' : '\n';
    const date = new Date().toISOString().slice(0, 10);
    const items = (subjects.length ? subjects : ['TODO: describe this release']).map((s) => `      ${quoteJs(s)},`).join(eol);
    const entry = ['  {', `    version: '${next}',`, `    date: '${date}',`, '    items: [', items, '    ],', '  },', ''].join(eol);
    writeFileSync(clPath, cl.replace(marker, found[0] + entry));

    console.log(`\n${c.bold('Edit the changelog now:')}\n  ${clPath}`);
    console.log(c.dim('  It is pre-filled from the merged pull request titles. Make each line one short sentence a user would understand,\n  drop internal changes, keep the quotes and commas.'));
    await pause('When you are done saving', yes);

    console.log(c.bold('\nChanges:'));
    show('git', ['diff', '--stat'], { cwd: tmp });
    if (!(await confirm('Commit, push and open the pull request?', yes))) throw new Error('Cancelled before committing. Nothing was pushed.');

    const commit = run('git', ['commit', '-am', `Desktop ${next}`], { cwd: tmp });
    if (commit.status !== 0) throw new Error(`Commit failed:\n${commit.stdout}${commit.stderr}`);
    const push = run('git', ['push', '-u', 'origin', branch], { cwd: tmp });
    if (push.status !== 0) throw new Error(`Push failed: ${push.stderr.trim()}`);
    const body = `Raises the desktop version to ${next} and adds its changelog entry.\n\nAfter this merges: \`pnpm release tag\`, then approve the \`release\` environment on GitHub.`;
    const url = out('gh', ['pr', 'create', '--base', 'master', '--head', branch, '--title', `Desktop ${next}`, '--body', body], { cwd: tmp });
    console.log(c.green(`\nPull request: ${url}`));
    if (await confirm('Merge it automatically once checks pass (squash)?', yes)) {
      const m = run('gh', ['pr', 'merge', url, '--auto', '--squash']);
      console.log(m.status === 0 ? c.green('Auto-merge is on.') : c.yellow(`Could not turn on auto-merge: ${m.stderr.trim()}`));
    }
    console.log(`\nNext, once it has merged: ${c.bold('pnpm release tag')}`);
  } catch (e) {
    console.error(c.red(`\n${e.message}`));
    cleanup();
    run('git', ['branch', '-D', branch]);
    process.exit(1);
  }
  cleanup();
  // The branch exists on GitHub now; the local copy is not needed.
  run('git', ['branch', '-D', branch]);
}

// ---------------------------------------------------------------- tag
async function tag() {
  preflight();
  const sha = out('git', ['rev-parse', 'origin/master']);
  const version = masterVersion();
  const name = `v${version}`;
  const last = latestStableTag();
  const subject = out('git', ['log', '-1', '--format=%s', sha]);

  console.log(`${c.bold('Tagging')} ${name} ${c.dim(`at origin/master ${sha.slice(0, 8)} "${subject}"`)}`);
  if (tagExistsRemote(name)) fail(`${name} is already released (the tag exists on GitHub). Raise the version with: pnpm release prepare patch`);
  if (last && !parse(version).pre && compare(version, last.slice(1)) <= 0) fail(`master is on ${version}, which is not newer than ${last}. Run: pnpm release prepare patch`);

  const problems = [];
  const changelog = out('git', ['show', `origin/master:${CHANGELOG}`]);
  if (!changelog.includes(`version: '${version}'`)) problems.push(`The changelog has no entry for ${version}.`);

  const checks = JSON.parse(tryOut('gh', ['run', 'list', '--branch', 'master', '--commit', sha, '--json', 'workflowName,status,conclusion']) ?? '[]');
  if (!checks.length) problems.push('No CI runs found for this commit.');
  for (const r of checks) {
    const state = r.status === 'completed' ? r.conclusion : r.status;
    console.log(`  ${state === 'success' ? c.green('✔') : state === 'skipped' ? c.dim('-') : c.red('✖')} ${r.workflowName} ${c.dim(state)}`);
    if (!['success', 'skipped', 'neutral'].includes(state)) problems.push(`${r.workflowName} is ${state} on this commit.`);
  }
  for (const p of problems) console.log(`${c.yellow('!')} ${p}`);
  if (problems.length && !force) fail('Fix that first, or pass --force to tag anyway.');

  if (dryRun) {
    console.log(c.yellow(`\nDry run. Would tag ${sha.slice(0, 8)} as ${name} and push it, which starts the build.`));
    return;
  }
  if (!(await confirm(`\nPush tag ${name}? This starts the installer builds. Nothing is published until you approve it on GitHub.`, yes))) fail('Cancelled. Nothing was pushed.');

  const t = run('git', ['tag', name, sha]);
  if (t.status !== 0) fail(`Could not create the tag: ${t.stderr.trim()}`);
  const p = run('git', ['push', 'origin', name]);
  if (p.status !== 0) {
    run('git', ['tag', '-d', name]);
    fail(`Push failed: ${p.stderr.trim()}`);
  }
  console.log(c.green(`\nPushed ${name}.`));

  // Find the workflow run that the tag started.
  let runInfo = null;
  for (let i = 0; i < 10 && !runInfo; i++) {
    runInfo = JSON.parse(tryOut('gh', ['run', 'list', '--workflow', 'release.yml', '--branch', name, '--limit', '1', '--json', 'databaseId,url']) ?? '[]')[0] ?? null;
    if (!runInfo) run(process.execPath, ['-e', 'setTimeout(()=>{},3000)']);
  }
  const repo = repoName();
  if (runInfo) {
    console.log(`Build: ${runInfo.url}`);
    console.log(`\n${c.bold('To publish:')} when the builds finish, open that page, choose ${c.bold('Review deployments')}, tick ${c.bold('release')} and approve.`);
    console.log(c.dim(`The release then appears at https://github.com/${repo}/releases/tag/${name} and installed Windows apps start updating.`));
    if (watch) show('gh', ['run', 'watch', String(runInfo.databaseId), '--exit-status']);
  } else console.log(`Could not find the build yet. Look at https://github.com/${repo}/actions/workflows/release.yml`);
}

// ---------------------------------------------------------------- main
const commands = { status, prepare, tag };
if (!commands[command]) {
  console.log('Usage: pnpm release <status | prepare patch|minor|major|x.y.z | tag> [--dry-run] [--yes] [--watch] [--force]');
  process.exit(command ? 2 : 0);
}
try {
  await commands[command]();
} catch (e) {
  fail(e.message);
}
