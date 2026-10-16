# End-to-end tests

Playwright tests that drive redcolumn like a person: open a PDF, pick tools, click on the drawing, type in dialogs. Then they check the result: the markup made, its measurement, the page scale, the search hits. Every spec runs twice:

| Project | What runs | How |
|---|---|---|
| `web` | Chromium on the Vite dev server (port 5179) | `pnpm e2e:web` |
| `desktop` | The Electron app, unpackaged, on a `VITE_E2E=1` build in `apps/web/dist-e2e` | `pnpm e2e:desktop` |

`pnpm e2e` runs both. `pnpm verify` runs everything that must pass before a merge: typecheck, unit tests, the release build, a check that the build has no test hook, and both e2e projects. CI does not run the e2e suite, so run `pnpm verify` yourself before merging.

## First run

```bash
pnpm install
pnpm --filter @nb/e2e exec playwright install chromium
```

## When something fails

`pnpm e2e:report` opens the HTML report. Failed tests include a screenshot and a trace (`playwright show-trace <trace.zip>`): every step, the DOM, the console and the network.

To run one spec or one test:

```bash
pnpm --filter @nb/e2e exec playwright test --project=web measure
pnpm --filter @nb/e2e exec playwright test --project=web -g "calibrate"
pnpm --filter @nb/e2e exec playwright test --project=web --headed --debug scale
```

`E2E_REUSE=1` keeps a dev server you already started on port 5179. `E2E_PORT` picks another port.

## How it works

- **Test hook.** Development and `VITE_E2E` builds set `window.__nb` (`apps/web/src/App.tsx`):
  - `viewer` and `tools` (pane A);
  - `commands()`, the live command table that menus, shortcuts and the palette use;
  - `assistant(method, params)`, the desktop MCP tools (`list_markups`, `get_page`, ...).

  Release builds never have it; `support/check-release.mjs` checks this.
- **Fixtures.** `fixtures/make-fixtures.mjs` draws `plan.pdf` at known positions: a 100 pt bar marked 10'-0", a 200 x 100 pt room, five symbols, and known words. `expected.json` records those positions. It also writes:
  - `plan-rev1.pdf`: a second, slightly different document (compare, overlay, insert and replace pages);
  - `sheets.pdf`: three sheets with a room name and a scale note in the same title-block boxes (page labels and scales from regions);
  - `forms.pdf`: fill-in lines and a check box (Auto-Create Fields);
  - `stitch.pdf`: a road cut onto three rotated sheets along match lines (stitched view; a port of `scripts/make_stitch_test_pdf.py`);
  - `picture.png` (image tool) and `notes.txt` (attachments).

  The PDFs are committed; after changing the generator, run `pnpm e2e:fixtures` and commit the output.
- **Saving and printing answer themselves.** No dialog waits for a person:
  - `app.saved()` returns every file the app saved (Save As, Extract, Split, exports). On the web a stand-in for the browser's Save As picker keeps them; on the desktop the save dialog is answered with a folder in the test's profile.
  - `app.printed()` returns each print job's page count. Nothing reaches a printer: the web app's print frame is never added, and the desktop's print channels are replaced.
  - `support/files.ts` reads saved PDFs (pdf-lib) and zips back.
- **Isolation.** Each web test gets a new browser context. Each desktop test gets its own Electron process, profile folder and `APPDATA`, so it never touches your installed app's data. Teardown force-quits the app, so "Save changes?" prompts can't block it.
- **Settings.** Tests start in imperial feet. A spec can change this with `test.use({ settings: { unitSystem: 'metric', ... } })`.
- **Commands wait for a render.** `app.cmd(id)` waits until the app re-renders, so a command's `checked` and `enabled` are current when you read them.
- **Expected values are worked out by hand** from the fixture geometry. Never paste in whatever the app prints. If a value changes, check the arithmetic before you update the test.

## Coverage

`coverage.ts` lists every command id. Each entry is one of:

- the spec that tests it;
- `skip` with a reason;
- `todo`.

`specs/coverage.spec.ts` fails when:

- the app has a command that isn't listed;
- the list has a command the app no longer has;
- a covered command doesn't appear in its spec.

It also prints the covered, skip and todo counts. Set `E2E_STRICT_COVERAGE=1` to fail on `todo` too. This will be the default once every command has a test.

To add a test, write it in the spec for its area and change the command's entry from `'todo'` to `{ spec: '<file>' }`.
