---
name: pr-workflow
description: Author -> review -> fix -> merge workflow for PRs in this repo. Use when asked to implement a change as a PR, review a PR, address review comments, or merge a PR. Pick the role (author, reviewer, or merger) from the request.
---

# PR workflow

Pipeline: author opens a draft PR -> CI green -> independent review -> author fixes -> CI green -> re-review of the fix delta -> human approves (or auto-merge if low risk) -> merge.

This works with any agent or none: where a step says "tell" or "wait for", use whatever your
tools provide (a PR comment always works). Read [AGENTS.md](../../../AGENTS.md) first.

Each stage runs in its own session. Identify which role you are in, then follow only that section.

## Checks (run before every push)

- `pnpm check:client-data`: no client drawings or identifiers. The repo is public. Use fictional names and generated drawings. Never paste client project names, drawing numbers or file paths into commits, PR text or review comments: the hook only sees commits.
- `pnpm typecheck`
- `pnpm test`, `pnpm check:tests` and `pnpm check:e2e-coverage`
- `pnpm e2e` before marking a PR ready: the end-to-end suite (e2e/README.md) drives every tool in the browser and the desktop app. CI runs the web project (`e2e-web`, not yet a required check) but not the desktop one.

## Role: author

1. Implement the change on its own branch from up-to-date `origin/master`. Keep the diff scoped to the task; no unrelated cleanups.
2. Run the checks above and fix failures before pushing.
3. Push and open a **draft** PR using the PR template (`.github/pull_request_template.md`). Say how a reviewer can reach you if not by PR comments.
4. Wait for CI and review without busy-polling: use your tool's PR notifications if it has them, otherwise check back later.
5. On review comments: fix blockers and small asks, push, and resolve the thread. Reply with a one-line reason on anything you decline. Skip optional/nit findings unless trivial.
6. After a fix push, wait for CI. Re-run checks locally first.
7. Stop after 3 review rounds. If blockers remain, summarize them for the human instead of looping.

## Role: reviewer

1. Start from a fresh session. Do not reuse the author's context. If you can choose, use a different (preferably stronger) model from the author's: it shares fewer blind spots.
2. Review the whole diff for correctness, security, data loss and missing tests. If your tool has a code-review command, run it at high effort.
3. Label every comment with a severity prefix:
   - `BLOCKER:` correctness, security, data loss, broken build. Must be fixed.
   - `SHOULD:` real but non-blocking issue.
   - `NIT:` optional style/preference.
4. Make each comment concrete: what is wrong, the failing scenario, the suggested fix.
5. Also check that the diff matches the PR's stated task and contains no unrelated changes, that a bug fix has a test that would have failed before it, and that no assertion was weakened to get green.
6. Treat the author's claims ("tests pass", "tried it") as unverified: check CI results and the tests themselves.
7. Post findings and end your turn. Do not push fixes and do not merge. The author owns the fix.
8. On a re-review after fixes, review only the new commits plus any previously open threads.

## Role: merger

Merge only when all of these hold on the current head:

- CI is green.
- All four `e2e-web` shards are green, even though they are not required checks yet. A quarantined test is skipped, so it cannot excuse a failure.
- CI does not run the desktop end-to-end tests. For changes to the desktop app, or to behaviour that differs there, `pnpm e2e:desktop` has been run on the current head. A failure may be accepted only if the same test also fails on the base branch: list each one in the merge comment, with the summary line. Any new failure blocks.
- No open `BLOCKER:` threads.
- The branch is up to date with the base (merge base in and re-validate if not).
- No push has landed since the last review without a re-review of that delta.

**Always require explicit human approval first** for changes touching: database migrations or schema, auth, payments, deploy/CI config (`.github/`), data deletion, dependency/lockfile changes, the desktop main process or IPC, or the saved-file format.

For anything else, either the human merges after a short summary, or enable auto-merge only once the conditions above are met. Never self-merge as the reviewer session. Never use an admin bypass to merge past failing or missing checks.

## Escalate to the human

- Ambiguous or architectural review feedback.
- Review loop exceeds 3 rounds.
- Failing CI that is not caused by the PR and has no known fix.
- Merge conflicts where both sides changed the same logic.
