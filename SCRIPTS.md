# Scripts you can run yourself

Everything here runs from a terminal in the repository folder. None of it needs Claude. Each
command is `pnpm <name>`; anything after the name is passed straight to the script.

Scripts that change something outside your computer (a pull request, a tag, deleting branches)
show you what they will do and ask first, or only preview until you add a flag.

**Contents**

1. [Is my machine ready?](#1-is-my-machine-ready)
2. [Is my code good enough to merge?](#2-is-my-code-good-enough-to-merge)
3. [Tests that need a closer look](#3-tests-that-need-a-closer-look)
4. [Pull requests and branches](#4-pull-requests-and-branches)
5. [Speed](#5-speed)
6. [The desktop app and releases](#6-the-desktop-app-and-releases)
7. [Everyday commands and older tools](#7-everyday-commands-and-older-tools)
8. [Private files these scripts read](#8-private-files-these-scripts-read)

---

## 1. Is my machine ready?

### `pnpm health`

Checks that your computer can build, test and release redcolumn, and tells you the fix for
anything that is not right. It changes nothing.

It looks at: the Node and pnpm versions, whether the commit guard (git hooks) is switched on,
whether dependencies are installed and up to date, whether Electron and the Playwright browser
are downloaded, whether the GitHub CLI (`gh`) is signed in, whether your private client list
exists, and whether the ports the dev server (5173) and the e2e tests (5179) need are free.

Run it first on a new machine, or when something refuses to start.

---

## 2. Is my code good enough to merge?

### `pnpm verify:fast`

The quick check, a minute or two: the client-data guard, the type check, and the unit tests. It
does not build the app or run the end-to-end tests.

- It stops at the first failure. Add `--keep-going` to run all three and see everything that
  failed.
- It ends with a summary of what passed and how long each step took.

Use it while you work. Use `pnpm verify` (below) before you merge.

### `pnpm verify`

The full gate: everything above, plus a production build, a check that the test hook did not
leak into the shipped app, and the end-to-end tests in both the browser and the desktop app.
Slow, so run it once before merging.

### `pnpm commit:lint`

Checks the commits on your branch before you push, so CI does not tell you off later. It looks at
every commit since your branch left `origin/master`.

It **fails** if it finds:

- client or project names in commit messages, added lines or added files (the same guard CI runs);
- any word from your private list (see [section 8](#8-private-files-these-scripts-read)) in a
  commit message, the branch name, or the pull request title and description;
- `fixup!` or `squash!` commits that were never folded in.

It only **warns** about: a subject line over 72 characters, a message that starts with WIP, a
merge commit (the repo squash-merges, so rebase instead), and a file over 5 MB added to the branch.

`pnpm commit:lint origin/some-branch` checks against a different starting point.

---

## 3. Tests that need a closer look

### `pnpm e2e:flake <test> -n 10`

Runs an end-to-end test over and over to find out whether it is **flaky** (fails sometimes) or
**broken** (fails every time). At the end it tells you which tests failed and how often, with the
first line of the error.

```bash
pnpm e2e:flake markups -n 20                    # every spec with "markups" in its path, 20 times, in Chromium
pnpm e2e:flake zoom --project desktop -n 10     # in the Electron app
pnpm e2e:flake --grep "rotate page" -n 15       # a test by its name
```

| Option | What it does |
|---|---|
| `-n 10` | How many times to run (default 10) |
| `--project web` or `desktop` | Browser or Electron app (default web) |
| `--workers 1` | Run tests one at a time, which can settle a test that depends on timing |
| `--no-build` | Desktop only: skip rebuilding the desktop test app, if you just did |
| `--stop-on-fail` | Stop at the first failing run |

If another copy of the repo is running its own e2e tests at the same time, give yours a different
port: `E2E_PORT=5190 pnpm e2e:flake ...`.

### `pnpm e2e:web`, `pnpm e2e:desktop`, `pnpm e2e`

Run all the end-to-end tests in the browser, in the desktop app, or both. `pnpm e2e:report` opens
the last HTML report with screenshots and traces of anything that failed.

---

## 4. Pull requests and branches

### `pnpm pr:status`

One table of every open pull request: its title, whether the checks pass, whether it is approved,
whether it can merge (ready, behind, conflicts), whether auto-merge is on, and when it last moved.
Pull requests built on top of another one are marked "stacked on".

- `pnpm pr:status --mine` shows only yours.
- `pnpm pr:status --json` prints it for other tools to read.

### `pnpm branches:prune`

Finds old local branches and worktrees whose pull request has been merged, so you can clear them.
**By default it only shows the list.** Add `--apply` to delete them.

It is careful. A branch is removed only when GitHub says its pull request merged **and** your local
branch is exactly where that pull request ended. It leaves alone:

- the branch you are on, and `master`;
- any branch with commits made after its pull request merged;
- any worktree with uncommitted changes (it tells you which);
- remote branches on GitHub.

`--verbose` also lists everything it kept and why.

```bash
pnpm branches:prune            # preview
pnpm branches:prune --apply    # do it
```

---

## 5. Speed

### `pnpm bench:compare <file.pdf> [pages]`

Measures how fast a PDF renders, and compares it with a saved result, so a slowdown is caught
before it ships. It runs the render benchmark three times and uses the middle result.

1. On a version you trust, save a baseline: `pnpm bench:compare drawings.pdf --save`
2. After changing rendering code, run it again without `--save`.

It prints the change in percent for the optimised draw, the original draw and the build time of
the optimised copy, and exits with an error if the optimised draw is more than 15% slower.

| Option | What it does |
|---|---|
| `1,2,40` | Only those pages (a separate baseline is kept per page set) |
| `--save` | Record this run as the baseline |
| `--runs 5` | Take the middle of 5 runs instead of 3 |
| `--threshold 25` | Allow up to 25% slower before it counts as a regression |

Times only mean something on the same computer, so the baselines stay on yours
(`bench-baselines.local`, never committed).

### `pnpm bench:render <file.pdf>`, `pnpm standards:bench`

The older single benchmarks that `bench:compare` is built on. `bench:render` shows the page-by-page
table; `standards:bench` times the drawing-standards detection.

---

## 6. The desktop app and releases

### `pnpm desktop:smoke`

The check that catches a **blank window**. It builds the real packaged desktop app, starts it, and
passes only if the window actually draws with no console errors. Unit tests cannot catch this
kind of failure, so run it after any change to the desktop app or the desktop code in the web app.

- Takes a few minutes the first time.
- It uses a temporary profile, so your installed redcolumn can stay open.
- `--skip-build` launches the last build again. `--timeout 120` allows 120 seconds instead of 90.
- The build stays in `C:\rc-smoke-build` (a temp folder on Mac and Linux) so you can open it and
  look; the next full run replaces it.

### `pnpm desktop`

Starts the desktop app in development mode with live reload.

### `pnpm release`: publish a new build

Publishing takes two commands, because the version number goes into the repo through a pull request
like every other change, and the tag must go on the merged result.

**Step 1: start the release.**

```bash
pnpm release prepare patch      # 0.1.21 -> 0.1.22   (or: minor, major, or an exact number such as 0.2.0)
```

It shows you the changes merged since the last release, then:

1. makes a temporary copy of `master` (your own branch and files are not touched);
2. raises the version in `apps/desktop/package.json`;
3. adds a changelog entry, **pre-filled from the merged pull request titles**, and waits while you
   edit it into short sentences a user would understand;
4. shows you the changes, then commits, pushes and opens a pull request called "Desktop 0.1.22";
5. offers to turn on auto-merge once the checks pass.

**Step 2: after that pull request has merged, tag it.**

```bash
pnpm release tag
```

It checks that the changelog has an entry, that CI passed on the commit, and that the version has
not been released before. Then it asks, tags the merged commit, and pushes the tag. That starts the
GitHub build of the Windows, Mac and Linux installers.

**Step 3: approve it on GitHub.** When the builds finish, the run waits for you. Open the link the
script printed, choose **Review deployments**, tick **release**, and approve. Only then is the
release published and installed Windows apps start updating. The script never does this step for
you, on purpose.

Other commands and options:

| Command | What it does |
|---|---|
| `pnpm release status` | Current version, last tag, unreleased changes, open release pull request, recent builds |
| `--dry-run` | Show what would happen, change nothing (works with `prepare` and `tag`) |
| `--yes` | Do not ask questions (it still will not approve the release for you) |
| `--watch` | With `tag`: follow the build in your terminal until it finishes or is waiting for approval |
| `--force` | With `tag`: go ahead even though the changelog entry is missing or CI is not green |

A version with a suffix such as `0.3.0-beta.1` is published as a pre-release, which the Install
button and the in-app update check ignore. If something goes wrong after `prepare`, closing the
pull request undoes it. If something goes wrong after `tag`, do not approve the release on GitHub.

---

## 7. Everyday commands and older tools

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the web app in your browser |
| `pnpm build` | Builds the web app for release |
| `pnpm typecheck` | Checks the types in every package |
| `pnpm test` | Runs every package's unit tests |
| `pnpm check:client-data` | Checks all tracked files for client drawings and project names (the commit hook and CI run this too) |
| `pnpm e2e:fixtures` | Regenerates the PDFs the e2e tests use |
| `pnpm cad:corpus` | Runs the CAD import over your local drawings and writes a report (local only) |
| `node scripts/third-party-notices.mjs` | Regenerates `THIRD_PARTY_NOTICES.md` after changing dependencies |
| `node scripts/electronegativity-gate.mjs <csv>` | The Electron security scan gate CI uses |
| `python scripts/make_test_pdf.py` and the other `make_*.py` | Generate sample PDFs, the Kestrel road set, title blocks and CAD fixtures |

---

## 8. Private files these scripts read

Both stay on your computer. Git ignores them (any file ending in `.local`), so they never reach
the public repository.

| File | Used by | What goes in it |
|---|---|---|
| `.client-data.local` | the commit hook, CI-style checks, `pnpm health` | Client and project words that must never appear in the repo, one per line |
| `.commit-lint.local` | `pnpm commit:lint` | Extra words that must not appear in commit messages, branch names or pull request text (for example competitor names), one per line. Lines starting with `#` are notes |
| `bench-baselines.local` | `pnpm bench:compare` | Saved benchmark times for this computer. Written by the script; delete it to start over |
