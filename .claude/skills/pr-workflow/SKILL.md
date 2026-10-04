---
name: pr-workflow
description: Author -> review -> fix -> merge workflow for PRs in this repo. Use when asked to implement a change as a PR, review a PR, address review comments, or merge a PR. Pick the role (author, reviewer, or merger) from the request.
---

# PR workflow

Pipeline: author opens a draft PR -> CI green -> fresh-session review -> author fixes -> CI green -> re-review of the fix delta -> human approves (or auto-merge if low risk) -> merge.

Each stage runs in its own session. Identify which role you are in, then follow only that section.

## Checks (run before every push)

- `pnpm typecheck`
- `pnpm test`

## Role: author

1. Implement the change on the designated branch. Keep the diff scoped to the task; no unrelated cleanups.
2. Run the checks above and fix failures before pushing.
3. Push and open a **draft** PR. Put your session ID in the PR description so the reviewer can reach you with `send_message`.
4. Call `subscribe_pr_activity` for the PR, then end your turn. Do not poll.
5. On review comments: fix blockers and small asks, push, and resolve the thread. Reply with a one-line reason on anything you decline. Skip optional/nit findings unless trivial.
6. After a fix push, wait for CI. Re-run checks locally first.
7. Stop after 3 review rounds. If blockers remain, summarize them for the human instead of looping.

## Role: reviewer

1. Start from a fresh session. Do not reuse the author's context.
2. Run the `code-review` skill with `--comment` on the PR at `high` effort.
3. Label every comment with a severity prefix:
   - `BLOCKER:` correctness, security, data loss, broken build. Must be fixed.
   - `SHOULD:` real but non-blocking issue.
   - `NIT:` optional style/preference.
4. Make each comment concrete: what is wrong, the failing scenario, the suggested fix.
5. Also check that the diff matches the PR's stated task and contains no unrelated changes.
6. Post findings and end your turn. Do not push fixes and do not merge. The author owns the fix.
7. On a re-review after fixes, review only the new commits plus any previously open threads.

## Role: merger

Merge only when all of these hold on the current head:

- CI is green.
- No open `BLOCKER:` threads.
- The branch is up to date with the base (merge base in and re-validate if not).
- No push has landed since the last review without a re-review of that delta.

**Always require explicit human approval first** for changes touching: database migrations or schema, auth, payments, deploy/CI config (`.github/`), data deletion, or dependency/lockfile changes.

For anything else, either the human merges after a short summary, or enable auto-merge only once the conditions above are met. Never self-merge as the reviewer session.

## Escalate to the human

- Ambiguous or architectural review feedback.
- Review loop exceeds 3 rounds.
- Failing CI that is not caused by the PR and has no known fix.
- Merge conflicts where both sides changed the same logic.
