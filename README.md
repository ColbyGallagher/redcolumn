# redcolumn

Open-source PDF markup and takeoff for construction drawings, in the browser. Mark up and measure
drawings, run takeoffs, compare revisions, manage drawing sets, and review together in live
sessions and shared Projects in OneDrive. It is also a Windows desktop app that opens and saves real file paths, and works offline. Your documents
stay in your browser: there is no redcolumn server or account (see [PRIVACY.md](PRIVACY.md)).

## Features

- **Markup:** lines, arrows, clouds, callouts, text, stamps (with tick boxes that fill in other
  fields and recolour the stamp, editable after placing), highlights, a Tool Library of saved
  tools, and a Markups list with custom columns, statuses, filters and summaries.
- **Measurement and takeoff:** calibrated scales and viewports, length, area, perimeter, volume,
  count and angle, snapping to drawing content, Smart Fill and Symbol Search.
- **Drawing sets:** sheet detection, sets, auto-linking sheet references, compare and overlay
  revisions, slip sheets, batch processing.
- **Documents:** page tools, headers and footers, OCR, forms, redaction, digital signatures,
  encryption and PDF/A.
- **Working together:** Live Sessions in the host's OneDrive, with access levels,
  chat, markup alerts and session reports; and Projects, shared OneDrive folders of PDFs with check
  out and check in, revisions and a Project Record.
- **Spreadsheets:** export the Markups list as CSV or PDF, or keep it in an Excel workbook
  in OneDrive that updates as markups change.
- **Compatibility:** reads and writes standard PDF annotations and XFDF, and imports Bluebeam®
  Revu® tool sets (`.btx`).

## Getting started

Needs Node.js 22 and pnpm.

```sh
pnpm install
pnpm dev          # the web app
pnpm test
pnpm typecheck
```

### Releasing the desktop app

Raise `version` in `apps/desktop/package.json` (the app compares it with the latest release's tag
at every launch), merge that, then tag the merge commit and push the tag:

```sh
git checkout master && git pull
git tag v0.2.0
git push origin v0.2.0
```

The `Release` workflow (`.github/workflows/release.yml`) checks that the tag is `v` plus the
desktop version, runs the typecheck and tests, builds the installer on Windows and the DMGs on
macOS, and publishes a GitHub release with `redcolumn-Setup.exe` (plus `redcolumn-Setup.exe.blockmap`
and `latest.yml`), `redcolumn-arm64.dmg` and `redcolumn-x64.dmg` attached. The files keep those names
because the web app's Install button links to `releases/latest/download/<file>`, so each new release
is what the button downloads. A tag with a suffix such as `v0.3.0-beta.1` is published as a
pre-release, which the Install button and the update check ignore.

**How installed apps update.** The desktop app checks the latest release a few seconds after every
launch and shows the result in the header bar. The installed Windows app updates itself
(`electron-updater`): it downloads the installer in the background, checks its SHA-512 against
`latest.yml`, shows a "Restart to update" button, and otherwise installs when the app is closed. It
never restarts over unsaved changes. The Mac app only shows an "Update to x.y.z" button that opens
the release page, because Squirrel.Mac needs a Developer ID signature. `latest.yml` and the
`.blockmap` must stay attached to the release, or Windows apps cannot update. Running the workflow by hand from the Actions tab builds the installers as
workflow artifacts without publishing. The installers are unsigned (the Mac app is only ad-hoc
signed), so Windows SmartScreen warns and macOS Gatekeeper blocks the first launch until the user
chooses Open Anyway.

To build locally instead, run `pnpm --filter @nb/desktop package` on Windows or
`pnpm --filter @nb/desktop package:mac` on a Mac; the output is written to `apps/desktop/release/`.

### Local assistant

The desktop app can answer GitHub Copilot, Claude, Codex, and Cursor about the drawing that is
open. In the desktop app, File › Preferences › MCP turns that on and shows the command for each
client. The website does not run it. See [PRIVACY.md](PRIVACY.md).

The user help (Help › Help, F1) is in `apps/web/public/help`: Markdown pages in `pages/`, the
contents in `toc.js`. Its screenshots are taken by `scripts/help` from sample drawings (see the
header of `scripts/help/shots.cjs`); re-run it after changing the interface.

`apps/web/.env.example` lists the optional settings for OneDrive; setting them up
is described in `docs/CLOUD-SETUP.md`. Planned work is in `docs/ROADMAP.md`.

## Repository

| Part | What it does |
|---|---|
| `apps/web` | The React app |
| `packages/pdf-core` | PDFium (WebAssembly) in a Web Worker: rendering, text, page operations |
| `packages/markup` | Markup model, PDF annotation import and export, XFDF, summaries |
| `packages/measure` | Scales, measurements, snapping, symbol search |
| `packages/sheets` | Sheet number detection and sheet links |
| `packages/stitch` | Stitching sheets along match lines |

## Privacy

redcolumn has no server, account, analytics or tracking. See [PRIVACY.md](PRIVACY.md) for what the
optional features (Live Sessions, Projects and signature checks) send and to whom.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). Please do not open a public issue.

## Licence

redcolumn is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE). Third-party
software it includes is listed, with its licences, in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). After changing dependencies, regenerate it with
`node scripts/third-party-notices.mjs`.

Contributions are accepted under the same licence (Apache License 2.0, section 5).

The Apache License does not grant rights to the redcolumn name or logo (section 6).

## Measurements disclaimer

Measurements, quantities and takeoffs depend on the scale and calibration you set and on the
drawings themselves. Check them before relying on them for pricing, ordering or construction.
redcolumn is provided "as is", without warranty of any kind (Apache License 2.0, sections 7
and 8).

## Trademarks

redcolumn is an independent project. It is not affiliated with, endorsed by or sponsored by
Bluebeam, Inc. or Nemetschek SE. Bluebeam and Revu are trademarks of Bluebeam, Inc. Adobe and
Acrobat are trademarks of Adobe Inc. These and other names appear only to describe file
compatibility.
