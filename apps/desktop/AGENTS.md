# Desktop app (Electron)

`apps/desktop` is a thin Electron shell around the web app's build. The interface is the web app
(`apps/web`); this package adds windows, native file dialogs, printing, smart-card signing,
Excel links, the assistant server and the installer. The page talks to it only through
`window.redcolumn`, defined in `src/preload.ts` and typed on the web side in
`apps/web/src/desktop/host.ts` (`desktop()` returns `null` in the browser). Changes to the main
process, preload or IPC are security-sensitive and need the maintainer's agreement.

## Rules

- **Keep the sandbox.** Every window uses `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` (`src/main.ts`, `src/security.ts`). CI runs Electronegativity on
  `src` and fails on HIGH findings (`scripts/electronegativity-gate.mjs`).
- **Every IPC handler checks its sender.** Handlers start with `fromApp(event)` (`src/paths.ts`)
  and, where they act on a window, `windows.has(event.sender)`. Copy that pattern for a new handler.
- **The page never sees file paths.** Paths handed out by a dialog, a drop or a launch argument
  go in the `PathAllowlist` (`src/allowlist.ts`), and the page gets a token. Do not add a channel
  that takes a path from the page.
- **Text shown by the main process is translated by the page.** Dialog titles and buttons come
  from `apps/web/src/desktop/mainStrings.ts` (`src/i18n.ts`); `pnpm i18n:check` also scans Electron
  dialog options here.
- **CommonJS, built with tsc.** `tsconfig.json` emits CommonJS to `dist/`; relative imports omit
  the `.ts` extension. Tests run the TypeScript directly with `--experimental-strip-types`
  (`test/resolve-ts.mjs` adds the extension), so use only erasable TypeScript: no `enum`,
  `namespace` or constructor parameter properties.

## Testing

- Unit tests: `src/**/*.test.ts` (`pnpm --filter @nb/desktop test`). `src/token.test.ts` needs
  SoftHSM2 and OpenSC; it skips without them locally, and CI sets `REQUIRE_TOKEN_TESTS=1`.
- End to end: `pnpm e2e:desktop` builds a `VITE_E2E=1` web build and runs the same specs in the
  unpackaged app (`e2e/README.md`). CI does not run it yet; run it yourself for desktop changes.
- Installers: `pnpm --filter @nb/desktop package` (Windows), `package:mac`, `package:linux`. CI
  packages Mac and Linux on every PR.
