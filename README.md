# redcolumn

Open-source PDF markup and takeoff for construction drawings, in the browser. Mark up and measure
drawings, run takeoffs, compare revisions, manage drawing sets, and review together in live
sessions over Google Drive or OneDrive and shared Projects in OneDrive. It installs as an app and works offline. Your documents
stay in your browser: there is no redcolumn server or account (see [PRIVACY.md](PRIVACY.md)).

## Features

- **Markup:** lines, arrows, clouds, callouts, text, stamps, highlights, a Tool Library of saved
  tools, and a Markups list with custom columns, statuses, filters and summaries.
- **Measurement and takeoff:** calibrated scales and viewports, length, area, perimeter, volume,
  count and angle, snapping to drawing content, Smart Fill and Symbol Search.
- **Drawing sets:** sheet detection, sets, auto-linking sheet references, compare and overlay
  revisions, slip sheets, batch processing.
- **Documents:** page tools, headers and footers, OCR, forms, redaction, digital signatures,
  encryption and PDF/A.
- **Working together:** Live Sessions in the host's Google Drive or OneDrive, with access levels,
  chat, markup alerts and session reports; and Projects, shared OneDrive folders of PDFs with check
  out and check in, revisions and a Project Record.
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

`apps/web/.env.example` lists the optional settings for Google Drive and OneDrive; setting them up
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
