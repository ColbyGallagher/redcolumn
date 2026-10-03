# Roadmap

What is planned next for redcolumn, and how new work is tested. Sizes are rough: **S** (a day or
two), **M** (about a week), **L** (several weeks).

## Next

| Work | Notes | Size |
|---|---|---|
| Translate markups | Translate selected markups' text and comments through `services/ai` | S |
| Spreadsheet links for quantities | Export measurement totals as `.xlsx` with named cells, or a CSV that refreshes when markups change | M |
| Account settings | A settings page for the Google and Microsoft sign-ins used by Live Sessions and Team Projects | S |
| More storage providers | Dropbox and SharePoint, through the same provider interface as `apps/web/src/studio/drive/` | M |
| Customisable toolbars | Show, hide and arrange toolbar groups per profile | M |
| Docking panels | Panels that dock left, right or bottom, float, and group in tabs | L |
| Background jobs | Run every long operation (OCR, batch, compare) through `apps/web/src/jobs/jobs.ts` with progress and Cancel | M |

## Later

- An MCP server in `services/ai` exposing markups, measurements, search and page operations to AI
  assistants (L).
- Detached windows for multi-monitor work (L).

## Not planned

- 3D PDF, CAD and Office plugins, printer drivers and scanner capture: not practical in a browser
  app.

## Testing approach

- Each markup type: a round trip (create, export with `pdf-lib`, import with `importAnnotations`)
  alongside the tests in `packages/markup/src/*.test.ts`.
- Each measurement: value tests in `packages/measure`, including viewports and cutouts.
- Each document operation: a fixture PDF from `scripts/make_test_pdf.py`, the operation, then checks
  through `pdf-core` (page count, boxes, text).
- Redaction: after applying, extract text and render the region to prove nothing remains.
- Signatures: sign, then validate with our code and with an external validator.
- The installable offline app: `apps/web/test/browser/` drives Chromium with Playwright.
  `offline.cjs` and `updates.cjs` run against the production build (`pnpm --filter @nb/web
  preview`); `touch.cjs` against the dev server. Each takes `PDF=<file>`.
