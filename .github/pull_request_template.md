<!-- Read CONTRIBUTING.md and AGENTS.md first. Open as a draft until CI is green. -->

## Issue

Closes #

## What changed

<!-- One or two sentences. What and why, not a file list. -->

## Tried by hand

<!-- What you did in the app (web or desktop) to check it works, and what you saw. -->

## Screenshots

<!-- Required for interface changes: before and after, or a short recording. Delete for non-UI changes. -->

## Tests

<!-- Paste the summary lines. A bug fix needs a test that failed before the fix: say that you saw it fail. -->

- [ ] `pnpm verify:fast` (client-data, typecheck, unit tests)
- [ ] `pnpm e2e:web` (anything the user can see)
- [ ] New or changed commands have a test in `e2e/coverage.ts`, not `'todo'`
- [ ] Bug fix: a test that failed before the fix

## Checklist

- [ ] One change, scoped to the issue; no unrelated edits
- [ ] No client data, real names, email addresses or local paths in code, commits or this text
- [ ] No code copied from proprietary or incompatibly licensed sources (CONTRIBUTING.md)
- [ ] Interface text goes through `msg()`; `pnpm i18n:check` passes
- [ ] Touches CI, dependencies, desktop IPC, security or the saved-file format? Say so here: these need the maintainer's approval
- [ ] Written with an AI agent? Say so, and what you checked yourself
