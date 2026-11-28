# Working on redcolumn

Read this before changing code, whether you are a person or an AI agent. [CONTRIBUTING.md](CONTRIBUTING.md)
covers how to get a change merged; this file covers how to make it.

**Scoped guides** (read the one for the area you touch):
[markup and PDF round trips](packages/markup/AGENTS.md) ·
[desktop app](apps/desktop/AGENTS.md) ·
[interface text and translation](packages/i18n/AGENTS.md) ·
[end-to-end tests](e2e/README.md)

## Where code belongs

pnpm monorepo, Node 24 (`.nvmrc`), pnpm version from `packageManager` in `package.json`.

| Folder | What it is | May import |
|---|---|---|
| `packages/i18n` | `msg()`, catalogs, locale-aware numbers | nothing in the repo |
| `packages/sheets` | sheet numbers, sheet links | nothing |
| `packages/pdf-core` | PDFium (WebAssembly) in a Web Worker | nothing |
| `packages/measure` | scales, measurements, snapping, symbol search | i18n |
| `packages/stitch` | stitching sheets along match lines | sheets |
| `packages/model3d` | the 3D model viewer | measure |
| `packages/markup` | markup model, PDF annotation import/export, XFDF, FDF, Bluebeam files | measure, sheets |
| `apps/web` | the React app (everything the user sees) | any package |
| `apps/desktop` | Electron shell: windows, files, IPC, installer | no workspace package; it loads the web build |
| `e2e` | Playwright tests, run against web and desktop | (drives the apps) |

A package imports only what its *May import* column names: no package imports `apps/*`, and
nothing imports `@nb/web`. Add a dependency between packages only with the maintainer's agreement. Logic that can be tested without a browser belongs in a package or a
plain `.ts` module, not in a React component.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm dev                 # web app on Vite
pnpm check:client-data   # no client drawings or identifiers (also a pre-commit hook)
pnpm i18n:check          # catalogs, untranslated literals, logical CSS
pnpm typecheck
pnpm test                # every package's unit tests (node --test)
pnpm check:tests         # every *.test.* file is reached by some package's test script
pnpm build && pnpm check:bundle
pnpm e2e:web             # Playwright, web (see e2e/README.md for first-run setup)
pnpm verify:fast         # client-data + typecheck + test
pnpm verify              # everything, including both e2e projects
```

Package test scripts list their files with globs. `src/*.test.ts` is **not recursive**: a test in
`src/sub/x.test.ts` never runs unless the glob is `src/**/*.test.ts` or the file is listed.
`pnpm check:tests` (in CI) fails if a test file is not reached.

## Rules that CI enforces

- **Client data.** The repository is public. Never commit client drawings, project names, drawing
  numbers, people's names, email addresses or local paths, in files, commit messages or PR text.
  Use the generated fixtures and fictional names. `scripts/check-client-data.mjs` checks files and,
  on a PR, every commit message and added line.
- **Interface text** goes through `msg()` from `@nb/i18n`, never as a bare literal
  ([packages/i18n/AGENTS.md](packages/i18n/AGENTS.md)).
- **Commands need tests.** Every command in `apps/web/src/commands/appCommands.ts` has an entry in
  `e2e/coverage.ts`. A new command gets `{ spec: '<file>' }` with a test that runs it, or
  `{ skip: '<reason>' }` if it cannot run unattended. Not `'todo'`.

## When a test is required

- **Bug fix:** a test that fails before the fix and passes after it. Say in the PR that you saw it fail.
- **New behaviour:** unit tests for the logic; an e2e test for a new command or tool.
- **Refactor:** existing tests must pass unchanged. Changing an assertion to make it pass is not a
  refactor: explain why the old expectation was wrong.
- Expected values are worked out from the input, never pasted from what the code printed.
- Never weaken, skip or delete a failing test to get green. If a test is wrong or flaky, say so in
  the PR and let the maintainer decide.

## Needs the maintainer's approval first

Open an issue or ask before starting any of these, and call them out in the PR:

- `.github/` (workflows, templates), repository settings, release and version bumps;
- dependencies or `pnpm-lock.yaml`;
- security-sensitive code: `apps/desktop/src` main process, preload and IPC, the web app's CSP
  (`apps/web/src/security`), sign-in and tokens, PDF signing;
- the saved-file format: what `packages/markup` writes into PDFs, XFDF, FDF or Bluebeam files;
- deleting user data, or changing where it is stored;
- large features, new top-level folders, or rewrites.

Never use `pull_request_target`, or any other trigger that runs fork code with secrets or a write
token, for CI or AI review. Fork PRs run `ci.yml` on plain `pull_request` with read-only
permissions; keep it that way.

## Scope of a PR

One change per PR, small enough to review in one sitting (as a guide, under ~400 changed lines
excluding tests and fixtures). No drive-by refactors, renames or formatting changes. Link the issue.

## Definition of done

- The change does what the issue's acceptance criteria say, and you tried it in the app.
- `pnpm verify:fast` passes locally, plus `pnpm e2e:web` for anything the user can see.
- Tests as above; `pnpm i18n:check` and `pnpm check:client-data` pass.
- The PR template is filled in: linked issue, what you tried by hand, screenshots for UI changes,
  test results.
- CI is green. Claims in a PR (including an agent's "all tests pass") are unverified until CI shows
  them; CI results are the evidence.
