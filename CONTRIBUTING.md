# Contributing to redcolumn

Contributions are welcome, including ones written with AI coding agents. The bar is the same
however the code was written: it has to be correct, tested, and small enough to review. Read
[AGENTS.md](AGENTS.md) (where code belongs, commands, testing rules) before you start; agents
should be pointed at it too.

## Before you start

- **Small fixes** (a bug with a clear cause, a typo, a missing test): open a PR directly, linked
  to an issue if there is one.
- **Anything larger** (a feature, a new tool or command, a change to what is saved in PDFs, a
  refactor across files): open an issue first and wait for the maintainer to agree on the
  approach. Unrequested large PRs may be closed even if they work.
- **Looking for something to do?** Issues the maintainer has marked as ready for outside
  contributors have acceptance criteria: a list of what must be true when the work is done. Use
  the *Contributor-ready task* issue template to propose one. Ask in the issue before starting,
  so two people do not do the same work.
- Areas that need the maintainer's approval before any work are listed in AGENTS.md (CI and
  `.github/`, dependencies, the desktop main process and IPC, security, the saved-file format).

## Code origin and licence

redcolumn is licensed under the [Apache License 2.0](LICENSE). By opening a PR you agree that your
contribution is licensed under it too (Apache License 2.0, section 5), and you confirm that you
have the right to submit it.

**Do not submit code you did not write or that you cannot license under Apache-2.0.** In particular:

- nothing copied, decompiled or translated from proprietary software, including Bluebeam Revu,
  Adobe Acrobat and their plug-ins, SDKs, resources and installers;
- nothing from projects under licences that are incompatible with Apache-2.0 (for example GPL or
  AGPL code), or with no licence at all;
- no files, drawings or data from clients or employers.

Compatibility work (reading and writing Bluebeam's files, matching Revu's behaviour) is done from
the published PDF specification, from files you made yourself, and from observing behaviour, not
from anyone's code. If an AI agent produced code that looks like it came from somewhere specific,
check, and say so in the PR. Third-party libraries are added as dependencies (with the maintainer's
agreement), never pasted in.

## Making the change

- One change per PR, scoped to its issue. No unrelated refactors or formatting.
- Follow the rules in AGENTS.md: tests for bug fixes and new behaviour, interface text through
  `msg()`, no client data.
- Run `pnpm verify:fast` before you push, and `pnpm e2e:web` for anything the user can see.
- Use Node 24 (`.nvmrc`). Node 26 cannot run the web app's unit tests.

## Opening the PR

Fill in the PR template: the issue it closes, what you tried by hand in the app, screenshots or a
short recording for interface changes, and what tests you ran. Open it as a draft until CI is
green.

**AI-assisted PRs:** say so, and say which parts you checked yourself. Statements like "all
tests pass" are checked against CI, not taken on trust. Please read your own diff before asking
for review: you are responsible for every line in it.

## What happens next

- CI runs on every PR (`.github/workflows/ci.yml`): client-data guard, typecheck, unit tests,
  build, bundle guard, dependency audit, desktop security scan, and Mac and Linux packaging. Fork
  PRs run with read-only permissions and no secrets.
- The Vercel preview shows **Authorization required to deploy** on PRs from forks until the
  maintainer allows it. That is expected and is not a CI failure.
- The maintainer reviews and merges. There may be a round or two of changes.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in an issue or PR.

Never change CI to use `pull_request_target`, or any other trigger that runs fork code with
repository secrets or a write token, including for AI review bots. Such PRs will be closed.
