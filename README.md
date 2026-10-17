# redcolumn

**Free, open-source PDF markup and takeoff for construction drawings. It runs in your browser or as a
desktop app, keeps your documents on your device, and needs no account, licence key or subscription.**

Mark up and measure drawings, run takeoffs, compare revisions, manage drawing sets, and share work
with your team through your own OneDrive when you choose to. Markups save into standard PDF
annotations, so they open in Bluebeam Revu and other PDF tools.

- [Install the desktop app](#install-the-desktop-app) (Windows or Mac)
- [Use it in the browser](https://colbygallagher.github.io/redcolumn/), no install needed
- [Privacy](#privacy-and-local-first)
- [Bluebeam compatibility](#bluebeam-compatibility)

## Why redcolumn

### Privacy and local first

Your drawings are yours. redcolumn is built so that a document only leaves your computer when you
send it somewhere yourself.

- **Your PDFs stay on your device.** Opening, marking up, measuring, OCR, redaction, signing and saving
  all happen in your browser or the desktop app. The project never receives your documents or markups.
- **No redcolumn server.** There is nothing to sign in to, nothing to host, and no copy of your work
  held by the project.
- **No accounts.** You do not register, log in or give an email address to use the app.
- **No licence keys, seats or subscriptions.** The software is Apache License 2.0. Nothing checks in
  with a licence server, and nothing stops working when a trial ends.
- **No analytics, advertising, tracking or error reporting.** The app sets no cookies of its own.
- **Works offline.** Once loaded, the app and your documents work with no internet connection.
  Installed, it runs from its own icon and window.
- **Cloud features are optional and use your own OneDrive.** Live Sessions, Projects and spreadsheet
  sync only start when you sign in to Microsoft, and the files go to your OneDrive, not to us. Live
  new Live Sessions are encrypted end to end unless the host turns that off. See
  [PRIVACY.md](PRIVACY.md) for exactly what each feature sends and to whom.
- **The local assistant stays on your computer.** The desktop app can let an AI client you already use
  read the open drawing. It is off until you turn it on, and deletes and document changes wait for
  your approval in redcolumn.

Read the full policy in [PRIVACY.md](PRIVACY.md).

### Free and open source

redcolumn is licensed under the [Apache License 2.0](LICENSE). You can read the source, build it
yourself, change it and use it at work without paying for it. There is no paid tier that unlocks
features. See [Licence](#licence).

### Bluebeam compatibility

redcolumn reads and writes the PDF annotations that Bluebeam Revu uses, so markups travel both ways
with files your team already has. Compatibility is tested against files produced by Revu itself.
The current results are in [docs/compatibility.md](docs/compatibility.md), generated from the
round-trip test suite. Summary (**—** means the test files had no items of that kind, so it is untested
rather than unsupported):

| Markup | Save to PDF | Export `.bax` | XFDF round trip |
|---|---|---|---|
| Shapes and lines | Supported | Supported | Supported |
| Measurements | Supported | Supported | Supported |
| Notes and text | Supported | Supported | Supported |
| Stamps | Supported | Supported | — |
| Images | Supported | Supported | Supported |
| Form fields | Supported | — (BAX leaves them out, as Revu does) | — |
| Pop-ups | Supported | Supported | — |

Revu tool sets and markup settings files can be imported: `.btx` tool sets are read (most tools come
through; a few group shapes are not yet kept), `.blx` line styles, `.bhx` hatch sets and `.bpx`
markup-list profiles are read in full. Writing those settings files back out is not built yet.

Compatibility is not a promise that every Revu feature comes through unchanged. Anything that does not
map is listed in the compatibility report, not dropped silently. If you find a file that does not
round-trip, please open an issue with the file or a description of it.

### Beyond markup

redcolumn adds features for working with drawing sets and takeoffs, not only for marking them up:

- **Calibrated takeoff in one place.** Scales and viewports, length, area, perimeter, volume, count and
  angle, with snapping to drawing content, Smart Fill and Symbol Search.
- **Drawing sets.** Sheet detection, sets, sheet references that link to each other, and slip sheets.
- **Compare and overlay revisions.** See what changed between two issues of a drawing.
- **Batch processing.** Run page labels, linking, signing and summaries across many files.
- **Markups list you can keep.** Custom columns, statuses, filters and summaries, exported as CSV or PDF,
  or kept live in an Excel workbook in your OneDrive.
- **Shared Projects without a vendor cloud.** Projects are folders of PDFs in your OneDrive with check
  out and check in, every revision kept, and a Project Record of who did what.
- **Live Sessions in your OneDrive.** Several people mark up the same drawings, with access levels,
  chat and session reports, and encryption on by default.
- **Documents.** OCR, redaction that removes the content as well as hiding it, digital signatures,
  encryption and PDF/A.
- **Local assistant.** Ask the AI client you already use about the open drawing, with your approval
  for every change.

### Performance

redcolumn renders PDFs with PDFium compiled to WebAssembly and runs it in a Web Worker, so drawing
and page work happens off the main thread and the interface stays responsive while a sheet loads. The
desktop app opens and saves files at their real paths, with no upload and download step. When a sheet
is slow to draw because of how it was exported (hundreds of thousands of separate hatch lines, for
example), redcolumn can draw it from an optimised copy. The copy is only used after it has been checked
to look the same as the original, and the file itself never changes.

There is no published head-to-head benchmark against Revu yet. Timings depend heavily on the
machine, the drawing and how it was exported, so we will publish comparisons with the files and
hardware used, rather than general claims.

## Install the desktop app

You can use redcolumn in any modern browser at
[colbygallagher.github.io/redcolumn](https://colbygallagher.github.io/redcolumn/) with nothing to
install. The desktop app adds a window of its own, opens PDFs from File Explorer or Finder and saves
straight back to the same file, and works offline. The downloads are on the
[latest release page](https://github.com/ColbyGallagher/redcolumn/releases/latest).

**The installers are not signed.** redcolumn is free and open source, and it does not buy a code-signing
certificate (Windows) or an Apple Developer ID (Mac). Your computer will therefore warn you the first time
you run it. That warning is about the publisher not being verified, not about the app containing malware.
You can check what you downloaded: the source code is in this repository, and the installers are built from
it by the public [Release workflow](.github/workflows/release.yml) and attached to the release.
Only download redcolumn from the release page above.

### Windows

1. Go to the [latest release](https://github.com/ColbyGallagher/redcolumn/releases/latest), or click
   **Install app** at the top right of the web app, and download **redcolumn-Setup.exe**.
2. Open the file from your Downloads folder. Windows SmartScreen shows **Windows protected your PC**
   because the publisher is unknown. Click **More info**, then **Run anyway**.
3. Follow the steps. The installer does not need administrator rights. It installs for your user
   account by default, and you can choose another folder on the way.
4. Start redcolumn from the Start menu or the desktop shortcut.

To remove it, use **Settings › Apps › Installed apps** and choose redcolumn.

### Mac

Choose the build that matches your processor. Apple menu › **About This Mac** shows which you have.

- **Apple Silicon** (M1 or later): **redcolumn-arm64.dmg**
- **Intel:** **redcolumn-x64.dmg**

1. Download the `.dmg` from the [latest release](https://github.com/ColbyGallagher/redcolumn/releases/latest).
2. Open it and drag **redcolumn** into **Applications**.
3. Open **redcolumn** from Applications. macOS says it cannot be opened because Apple cannot verify it.
   Click **Done**. Do not choose Move to Bin.
4. Open **System Settings › Privacy & Security**, scroll to the message about redcolumn, and click
   **Open Anyway**. Enter your password if asked, then click **Open** on the confirmation. You only need to
   do this once. The button appears for a while after the first attempt, so if it is not there, try opening
   the app again.

If the **Open Anyway** button is missing, or you prefer the command line, you can remove the download
flag from the app in Terminal. Run this only after dragging redcolumn into Applications, and only for a
copy you downloaded from the release page above:

```bash
xattr -dr com.apple.quarantine /Applications/redcolumn.app
```

Then open redcolumn normally.

### Updates

- **Windows:** the installed app checks for a new release a few seconds after launch. When one is ready
  it downloads in the background and shows **Restart to update**. It never restarts over unsaved work,
  and otherwise installs the update when you close the app.
- **Mac:** the app shows **Update to x.y.z** when a new release exists. That button opens the release
  page, and you drag the new version into Applications. Your documents and markups are kept.
- You can check at any time with **Help › Check for Updates**. That asks GitHub for the latest release
  and sends nothing from your documents. See [PRIVACY.md](PRIVACY.md#checking-for-updates-desktop-app).

### Verify your download (optional)

Each installer's SHA-512 checksum is recorded in `latest.yml` on the release, in base64. To compare it
on Windows, run this in PowerShell from the folder you downloaded to, then check the output against the
`sha512` value for `redcolumn-Setup.exe` in `latest.yml`:

```powershell
[Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash([System.IO.File]::ReadAllBytes("$PWD\redcolumn-Setup.exe")))
```

## Help and documentation

- **In the app:** Help › Help (F1) has the full user guide, with screenshots, and works offline.
- **Install and offline use:** [install page in the help](apps/web/public/help/pages/install.md).
- **Privacy:** [PRIVACY.md](PRIVACY.md)
- **Bluebeam compatibility report:** [docs/compatibility.md](docs/compatibility.md)
- **Planned work:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Setting up OneDrive for Live Sessions and Projects:** [docs/CLOUD-SETUP.md](docs/CLOUD-SETUP.md)

## Building from source

redcolumn is a pnpm monorepo. Needs Node.js 22 and pnpm.

```sh
pnpm install
pnpm dev          # the web app
pnpm test
pnpm typecheck
```

To build the desktop app locally, run `pnpm --filter @nb/desktop package` on Windows or
`pnpm --filter @nb/desktop package:mac` on a Mac. The output is written to `apps/desktop/release/`.

The optional settings for OneDrive are listed in `apps/web/.env.example`; `docs/CLOUD-SETUP.md`
explains how to set them up. The user help is in `apps/web/public/help`: Markdown pages in `pages/`, the
contents in `toc.js`. Its screenshots are taken by `scripts/help` from sample drawings (see the header of
`scripts/help/shots.cjs`); re-run it after changing the interface.

### Repository

| Part | What it does |
|---|---|
| `apps/web` | The React app |
| `apps/desktop` | The Electron desktop app, installer and update check |
| `packages/pdf-core` | PDFium (WebAssembly) in a Web Worker: rendering, text, page operations |
| `packages/markup` | Markup model, PDF annotation import and export, XFDF, summaries |
| `packages/measure` | Scales, measurements, snapping, symbol search |
| `packages/sheets` | Sheet number detection and sheet links |
| `packages/stitch` | Stitching sheets along match lines |

### Releasing the desktop app

Raise `version` in `apps/desktop/package.json` (the app compares it with the latest release's tag at
every launch), merge that, then tag the merge commit and push the tag:

```sh
git checkout master && git pull
git tag v0.2.0
git push origin v0.2.0
```

The `Release` workflow (`.github/workflows/release.yml`) checks that the tag is `v` plus the desktop
version, runs the typecheck and tests, builds the Windows installer and both Mac DMGs, and publishes a
GitHub release with `redcolumn-Setup.exe` (plus `redcolumn-Setup.exe.blockmap` and `latest.yml`),
`redcolumn-arm64.dmg` and `redcolumn-x64.dmg` attached. The file names stay fixed so the web app's Install
button, which links to `releases/latest/download/<file>`, always gets the newest release. A tag with a
suffix such as `v0.3.0-beta.1` is published as a pre-release, which the Install button and the update
check ignore.

`latest.yml` and the `.blockmap` must stay attached to the release, or installed Windows apps cannot
update. Running the workflow by hand from the Actions tab builds the installers as workflow artifacts
without publishing. The publish step waits for approval in the `release` environment.

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

Measurements, quantities and takeoffs depend on the scale and calibration you set and on the drawings
themselves. Check them before relying on them for pricing, ordering or construction. redcolumn is
provided "as is", without warranty of any kind (Apache License 2.0, sections 7 and 8).

## Trademarks

redcolumn is an independent project. It is not affiliated with, endorsed by or sponsored by Bluebeam,
Inc. or Nemetschek SE. Bluebeam and Revu are trademarks of Bluebeam, Inc. Adobe and Acrobat are
trademarks of Adobe Inc. Windows and macOS are trademarks of Microsoft and Apple. These and other names
appear only to describe compatibility and how to install the app.
