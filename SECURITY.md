# Security policy

redcolumn opens drawings from anyone, holds signing keys, and signs in to OneDrive, so security
reports are welcome and taken seriously.

## Supported versions

Only the current app is supported: the one published from the `master` branch at
`https://redcolumn-web.vercel.app/`, which updates itself. Fixes are not back-ported to older
builds or to copies other people host.

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub: on the repository's **Security** tab, choose **Report a
vulnerability** (GitHub's private vulnerability reporting). Only the maintainer sees it.

Please include:

- what the problem is and what an attacker could do with it;
- the steps or a file that shows it, and the browser and version you used;
- the commit or the date of the build you tested, if you know it;
- whether you have told anyone else.

Do not include real drawings, other people's data, or live access tokens. Strip tokens from any
HAR file or log before attaching it.

## What happens next

redcolumn is maintained by one person, so these are aims rather than guarantees:

- an acknowledgement within 7 days;
- an assessment, with a severity and a plan, within 14 days;
- a fix for serious problems as soon as one can be made safely, usually within 30 days;
- a published GitHub Security Advisory once a fix is live, crediting you if you wish.

If a report turns out to be in Microsoft's or another project's code rather than
redcolumn's, we will help you get it to them.

## Scope

In scope: this repository and the app it publishes, including how the app handles files you open,
links, Live Sessions, Projects, digital signatures, encryption and redaction, what it stores in
your browser, and how it uses Microsoft sign-in.

Out of scope: Microsoft's, GitHub's and Vercel's own services; attacks that need a
compromised device or browser; denial of service against any hosted service; and social
engineering.

## Testing safely

Use your own test accounts and test files. Do not access other people's data or sessions, do not
attack Microsoft's or any other provider's infrastructure, and stop and report as soon
as you find something. Research done in good faith within these rules will not be pursued.

## How redcolumn is kept secure

- The app has no server; your files stay in your browser unless you use Live Sessions, Projects or
  spreadsheet sync (see [PRIVACY.md](PRIVACY.md)).
- The published pages carry a Content-Security-Policy that limits the scripts, frames and
  connections they can use (`apps/web/src/security/csp.ts`).
- Every pull request runs the tests, a production build, a dependency audit and CodeQL code
  scanning. GitHub Actions are pinned to commits, and Dependabot proposes updates to them.
- The hardening plan for Live Sessions, Projects and the desktop app is in
  [docs/SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md).
- OpenSSF Scorecard checks the repository's security practices weekly.
- The security test plan is in [docs/security/PENTEST-PLAN.md](docs/security/PENTEST-PLAN.md).
