# Security hardening: Live Sessions and Projects

> **Note (14 October 2026):** Google Drive, Google sign-in and Google Sheets sync have been removed;
> Live Sessions, Projects and spreadsheet sync are OneDrive only. Google items below are historical.

A plan for tightening how redcolumn uses Google Drive and OneDrive, without adding a redcolumn
server. It covers four things:

1. telling people plainly what access the app gets;
2. restricting what scripts can run on the app's pages;
3. shortening how long a sign-in token lives, and where it is kept;
4. further tightening of sharing, then encryption and signing.

It also covers the Electron version: hardening the shell, keeping tokens out of the page, and an
option to run Projects (and slower Live Sessions) on a local folder that the person's own sync
client (OneDrive, Dropbox, Google Drive, a file server) keeps in step, with no cloud sign-in at
all.

Sizes are as in [ROADMAP.md](ROADMAP.md): **S** (a day or two), **M** (about a week), **L**
(several weeks).

## Principles

- **Least access, asked for at the moment it is needed, for that action only.**
- **Short-lived tokens, kept where the fewest scripts can reach them.**
- **Only code we ship runs on our pages.** Third-party scripts load only when the person picks the
  feature that needs them.
- **Say what is true.** The privacy notice describes what the permission allows, not only what our
  code happens to do with it.
- **No redcolumn server.** Everything here runs in the person's browser or desktop app.

## Where things stand

Traced from the code (`apps/web/src/studio/drive/`), October 2026.

| Area | Today | Risk |
|---|---|---|
| OneDrive permission | Starts at `Files.ReadWrite.AppFolder` (`Apps/redcolumn` only). Any 403 steps up to `Files.ReadWrite` (the whole OneDrive); a refusal in someone else's drive steps up to `Files.ReadWrite.All` (also files shared with them). `onedrive.ts` lines 297–309 | After a step-up, the token can read and write every file the person can reach, not only session folders |
| Step-up memory | The level is kept in `localStorage` (`nb.onedrive.level`) and used for every later token, including settings backup and spreadsheet sync. `onedrive.ts` lines 88–105 | Broad tokens are requested for work that needs only the app folder |
| Microsoft token | MSAL cache in `localStorage` (`onedrive.ts` line 45), so it lasts across visits | Any script on the app's origin (including `/help/`) can read the refresh token, which lasts up to 24 hours |
| Google permission | `drive.file` only: files the app made or the person picked. `google.ts` line 18 | Already narrow |
| Google token | Access token in `sessionStorage`, about an hour, no refresh token. `google.ts` lines 105–170 | Already short-lived |
| Bearer token destination | `OneDrive.fetch` sends the token to any absolute URL it is given; list paging follows `@odata.nextLink` unchecked. `onedrive.ts` lines 275–295, 399–404 | A token could go to a host other than Graph if a URL were ever wrong or tampered with |
| Invites | `shareWithUser` defaults to `write`; Live Session invites pass no role. `onedrive.ts` line 580, `DriveSession.ts` line 827 | An attendee given **View documents** in the app can still change the folder in OneDrive |
| Links | Session and Project folders are shared "Anyone with the link" (edit when the link may edit), falling back to the organization. `onedrive.ts` lines 555–578 | A forwarded link lets anyone in, with no expiry |
| Deletes | `remove()` deletes any item ID it is given; only Project lock files are passed today. `removeFolder()` deletes a session folder when the host ends it. `onedrive.ts` lines 636–652 | The limit lives in the callers, not the API |
| Content Security Policy | None. `apps/web/index.html`, `msal-redirect.html`, `public/help/index.html` | Nothing limits what an injected script could load or where it could send data |
| Hosting | GitHub Pages (`vite.config.ts` line 96), which cannot set response headers, and Vercel (`redcolumn-web.vercel.app`, with a preview deployment for every branch), which can but has no `vercel.json` yet | On GitHub Pages a CSP can only be a `<meta>`, which cannot do `frame-ancestors`. On Vercel no security headers are sent |
| Service worker | Precaches the app shell only; no Graph or Google responses are cached. `vite.config.ts` lines 112–153 | Fine as is |
| Privacy notice | "Even then, it only reads and writes the session folders." `PRIVACY.md` line 58 | True of the code, but the permission is broader, and the notice should say so |

## Phase 1: Tell people what access the app gets (S–M)

### 1.1 Correct PRIVACY.md and CLOUD-SETUP.md (S)

Replace the OneDrive access paragraph in `PRIVACY.md` with wording that separates what the
permission allows from what the app does. Draft:

> **OneDrive access.** Microsoft offers three levels of access. redcolumn asks for the smallest
> first and asks for more only when a step you take needs it, telling you why before Microsoft's
> sign-in window opens.
>
> 1. **The app's own folder** (`Apps/redcolumn`). This is all most people ever grant. Sessions,
>    Projects, spreadsheet sync and settings backup live here.
> 2. **Your OneDrive.** Needed to share a session or Project folder by link or by email. This
>    permission lets the app read and change any file in your OneDrive. redcolumn uses it only on
>    the session or Project folder you are sharing.
> 3. **Your OneDrive and files shared with you.** Needed only to join a session or Project in
>    someone else's OneDrive. This permission also reaches files other people have shared with
>    you. redcolumn uses it only on the folder in the invite you opened.
>
> Microsoft remembers what you allowed until you withdraw it (Microsoft account → Privacy → Apps
> and services). You can see the level this browser uses, and drop back to the smallest, in
> **Account settings**.

Do the same in `CLOUD-SETUP.md` step 3 of the Entra setup, and list there which Graph calls each
level is for (the table in 1.2).

### 1.2 An Access page in Account settings (M)

The roadmap already has an **Account settings** page (S). Build it with an **Access** section per
provider:

- the account signed in, and since when;
- the level this browser has reached, in the words from 1.1, with what the app does at that level;
- where the token is kept (this tab only, or this device), and when it expires;
- **Use the smallest access again** (drops the stored level; see 3.4);
- **Sign out** and **Sign out everywhere** (see 3.3);
- a link to the provider's page for withdrawing the app's access.

What each level is used for, from the code trace (for this page and for CLOUD-SETUP.md):

| Level | Used for |
|---|---|
| App folder | Find the app folder; create session and Project folders; upload, read, list and replace their files; settings backup (`profiles.json`); spreadsheet sync (`.xlsx`); end-of-session copies |
| Your OneDrive | Make a sharing link for a folder (`createLink`); invite by email (`invite`); list, change and remove who a Project folder is shared with (`permissions`) |
| Shared with you | Open a folder from an invite (`/shares/…`) and read and write it when it lives in someone else's OneDrive |

### 1.3 Explain before every step-up (S)

Today a refusal raises the level, and the next sign-in popup asks Microsoft for more with no
explanation from us (`onedrive.ts` line 290 sets the message, but the popup is Microsoft's). Show
our own dialog first:

> **Share this folder from your OneDrive?**
> To make an invite link, Microsoft needs you to allow redcolumn to read and change files in your
> OneDrive. redcolumn will use it only for "Site meeting 14 Oct (redcolumn session)". You can drop
> back afterwards in Account settings.
> [Continue to Microsoft] [Cancel]

One dialog per kind of step-up (sharing; joining someone else's folder), naming the folder.

### 1.4 A local list of what the app did in the cloud (S)

Keep the last few hundred cloud actions (create, upload, replace, share, invite, permission
change, delete), with the folder name and time, in this browser's storage only. Show it under
Account settings → Access → **Activity**. It lets a careful person check that the app touched only
what it said. It is never sent anywhere. `help/logs.ts` already keeps app messages; this can sit
beside it.

### 1.5 First-use notice (S)

Before the first Microsoft or Google sign-in, a one-screen summary: what goes to the provider (the
session's PDFs, markups, chat, names), what never goes to redcolumn (anything: there is no
server), and a link to the Access section of PRIVACY.md.

## Phase 2: Restrict scripts (M)

The site's own code is what every token and document trusts. These steps limit what any other
script could do if one ever got onto the page (a compromised dependency, a bug that injects HTML).

### 2.1 A Content Security Policy on every page (M)

Add a policy to `index.html`, `msal-redirect.html` and `public/help/index.html`. On GitHub Pages
it has to be a `<meta http-equiv="Content-Security-Policy">`; insert it at build time with a small
Vite plugin (`transformIndexHtml`), since the dev server needs a looser one for hot reload. On
Vercel, send the same policy as a header from `vercel.json` (see 2.4). Generate both from one
source so they cannot drift apart.

Starting point for the app (every host to be confirmed in testing; see open questions):

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com;
worker-src 'self';
connect-src 'self'
  https://graph.microsoft.com https://login.microsoftonline.com
  https://*.sharepoint.com https://*.1drv.com https://*.livefilestore.com https://my.microsoftpersonalcontent.com
  https://www.googleapis.com https://sheets.googleapis.com https://openidconnect.googleapis.com https://oauth2.googleapis.com;
frame-src https://docs.google.com https://accounts.google.com;
img-src 'self' blob: data:;
style-src 'self';
font-src 'self';
object-src 'none';
base-uri 'none';
form-action 'none';
manifest-src 'self';
upgrade-insecure-requests;
require-trusted-types-for 'script';
```

Notes:

- `'wasm-unsafe-eval'` is for PDFium and Tesseract. The code has no `eval` or `new Function`.
- The Google hosts are needed only when Google is configured. Build without them when
  `VITE_GOOGLE_CLIENT_ID` is unset, and leave out the Microsoft hosts when
  `VITE_MICROSOFT_CLIENT_ID` is unset.
- OneDrive download and upload-session URLs come back from Graph on hosts that differ between
  personal and work accounts. Record the hosts actually used in testing and list only those.
- **Signature checks** (trusted time stamps, certificate status) contact servers the person or the
  certificate names, which a fixed `connect-src` cannot list. Decide between listing the common
  time stamp and status servers, or showing a clear message when one is blocked (open question).
- `msal-redirect.html` gets the same policy without the Google hosts. The help gets
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none';
  base-uri 'none'`.
- `style-src 'self'` must be checked against anything that writes `style="…"` into HTML strings.
  React's `style` prop goes through the DOM and is not affected.

### 2.2 Trusted Types (S)

`require-trusted-types-for 'script'` makes Chrome and Edge refuse raw HTML strings in `innerHTML`
and similar. The app itself has no `innerHTML` or `dangerouslySetInnerHTML`. The help
(`public/help/help.js`) builds its pages with `innerHTML` from our own Markdown, escaping text with
`esc()`. Give it a named policy (`trusted-types help`) that runs its output through the same
escaping, so a mistake in the Markdown renderer cannot become script.

### 2.3 Load third-party scripts only on demand (S)

Google sign-in (`accounts.google.com/gsi/client`) and the Picker (`apis.google.com`) are the only
scripts not bundled with the app. Check that neither loads until the person chooses Google, and
keep it that way (a test that the start page makes no request to a Google host). MSAL is bundled
from npm, which is preferred. These Google scripts change without notice, so Subresource Integrity
cannot pin them. That is a reason to keep them off the page until needed.

### 2.4 Headers that `<meta>` cannot set (S)

GitHub Pages cannot send headers, so these are not possible there. Vercel can, through a
`headers` entry in `vercel.json`:

- `frame-ancestors 'none'` (stops other sites framing the app to trick clicks);
- `Referrer-Policy: no-referrer` (keeps invite share IDs out of `Referer`);
- `Permissions-Policy` (turn off camera, microphone, geolocation and so on);
- `X-Content-Type-Options: nosniff`;
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` (keeps sign-in popups working).

Plan:

1. **Vercel:** add `vercel.json` with these headers and the CSP from 2.1 on every path. It is
   still a static site with no redcolumn server. Leave CSP reporting off, since reports would go
   to a server.
2. **GitHub Pages:** add `<meta name="referrer" content="no-referrer">` (that one works in
   `<meta>`), and a check at start-up that refuses to run inside a frame (`window.top !==
   window.self`).
3. **Pick one main address** and say which in the README. If it is Vercel, GitHub Pages can
   redirect to it, so every visitor gets the headers.

**Vercel preview deployments.** Every branch gets its own address, built from code that may not
have been reviewed. Do not register preview addresses as Microsoft redirect URIs or Google
JavaScript origins, and leave `VITE_MICROSOFT_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` unset for the
Preview environment. Then unreviewed code can never receive a sign-in for the production app
registration. If previews need to test sign-in, use a separate test app registration with its
own client IDs.

### 2.5 Supply chain (S)

- CI already installs with `--frozen-lockfile`. Add `pnpm audit --prod` as a non-blocking step
  first, then blocking for high and critical issues.
- Pin GitHub Actions to commit SHAs, not tags (`actions/checkout@<sha>`). This changes `.github/`,
  so it needs explicit approval (see the PR workflow).
- Keep the auth path's dependencies to MSAL and the browser. Review MSAL updates by hand.
- Publish a SHA-256 of each release build and make the build reproducible from the tag, so anyone
  can check that what is served is what is in the repository.

## Phase 3: Shorten token life (S–M)

What the providers give:

- **Microsoft:** access tokens last about 60–90 minutes. Refresh tokens issued to a single-page
  app last 24 hours and cannot be extended. MSAL renews silently within that window.
- **Google:** access tokens last about an hour. The browser flow gives no refresh token. Already
  kept in `sessionStorage`.

### 3.1 Keep the Microsoft cache for this tab only, by default (S)

Change `cacheLocation` in `onedrive.ts` line 45 from `localStorage` to `sessionStorage`. Closing
the tab then forgets the sign-in, and the 24-hour refresh token goes with it.

Cost: rejoining a session after closing the tab needs a sign-in click. Offer **Stay signed in on
this device** (off by default) in Account settings for people who want today's behaviour. When on,
use `localStorage` as now and say so on the Access page.

Check the `@azure/msal-browser` 5 options while doing this (cache encryption, `memoryStorage`).
Encryption at rest does not stop a script on our own origin, so it does not replace 3.1.

### 3.2 Forget tokens when cloud work stops (S)

- When the last Live Session is left and no Project is open, clear the Microsoft cache and revoke
  the Google token (`googleAuth.signOut` already revokes).
- After 30 minutes with no cloud activity, drop the in-memory tokens too. The next action shows
  **Reconnect**, as an expired token does today.
- Projects queue check-ins while offline (`studio/projects/queue.ts`). The queue already stops on
  `DriveAuthError` and waits for Reconnect, so clearing tokens does not lose queued work. Confirm
  this with a test.

### 3.3 Sign out properly (S)

`signOutOfMicrosoft` clears only the local cache (`onedrive.ts` lines 144–150). Keep that as
**Sign out**, and add **Sign out everywhere**, which also calls MSAL's `logoutPopup` to end the
Microsoft session in this browser. Both clear the stored level (3.4).

### 3.4 Ask for broader access per action, and do not keep it (M)

Today the stored level makes every later token broad.

- Remove `nb.onedrive.level`. Make `silentToken()` take the scopes the call needs, defaulting to
  `Files.ReadWrite.AppFolder`.
- Give the calls that need more their own scopes: `createLink`, `invite` and `permissions` ask for
  `Files.ReadWrite`; `/shares/…` and items in another person's drive ask for
  `Files.ReadWrite.All`. Everything else (settings backup, spreadsheet sync, own-folder writes)
  keeps asking for the app folder only.
- MSAL caches a token per scope set, so the broad token is used only by the calls that asked for
  it.

Be clear about the limit: Microsoft remembers the consent, so a script on our origin could still
silently ask for a broad token later. 3.4 narrows what our code holds and uses, not what the
consent allows. Only withdrawing the consent, or the Electron design in E2, removes that.

### 3.5 Step up only for the calls that need it (S)

`accessNeeded` (`onedrive.ts` lines 302–309) steps up on any 403 at the first level. Limit
step-ups to the calls in 3.4. A 403 anywhere else is reported as an error, not answered with a
wider permission.

### 3.6 Send the token only to Graph (S)

In `OneDrive.fetch`, refuse any absolute URL whose host is not `graph.microsoft.com` before
attaching the token. That covers `@odata.nextLink`, which comes back from Graph and should always
be on that host. Download and upload-session URLs already go out without the token (lines 373–381
and 491–492); keep it that way with a comment and a test.

## Phase 4: Tighter sharing (M)

### 4.1 Match folder rights to the app's access levels (M)

The app has **No access**, **View documents** and **Add comments**. In OneDrive everyone invited
gets `write`, because every attendee writes their own seat file (presence, chat). So the folder
right is wider than the app's level, and the app is what holds people back (`CLOUD-SETUP.md`
already says so).

- Make the invite role explicit everywhere. Projects already pass `reader` for viewers
  (`Project.ts` line 617). Live Session invites should pass a role, not rely on the default.
- Change the `shareWithUser` default to `reader`, so a missing role fails safe.
- For Live Sessions, decide whether **View documents** attendees can do without writing (no chat,
  no presence). Then they can be invited as `reader` and need only read access on their side (open
  question).
- Long term, the signing in Phase 5 makes the app level enforceable even with `write`: others
  ignore markups from someone without the right key.

### 4.2 Links (M)

- Default to a **view** link, with editors invited by email. Google sessions already offer
  "viewer with editors invited by email" (`CLOUD-SETUP.md` line 35); do the same for OneDrive.
- For work accounts, offer **People in your organization** first rather than as a fallback.
- Set `expirationDateTime` on Live Session links (for example, a week) where Microsoft accepts it,
  and fall back without it where it does not. Sessions are short-lived; Projects keep links
  without expiry.
- When a host ends a session, delete the link permissions (`removePermission`) before deleting the
  folder. Then a copy of the folder in the recycle bin is no longer reachable by link.

### 4.3 Put the delete limits in the API (S)

- `remove(fileId)`: refuse unless the item was listed in a session or Project folder this object
  resolved, and its name matches an app file (`lock-*.json` today). Keep the check in
  `onedrive.ts`, not only in `Project.ts`.
- `removeFolder(folderId)`: refuse unless the folder is in the person's own app folder and has a
  redcolumn manifest (`session.json`).

### 4.4 Ask Graph for less (S)

Add `$select` to the remaining reads (`list` children, permissions) so responses carry only the
fields the app uses, not every item's sharing and owner details.

## Phase 5: Encryption and signing (L)

This removes the remaining cases where the folder's sharing is the only protection.

- **Session key in the invite link's `#fragment`.** Browsers do not send the fragment to servers.
  The session's PDFs, seats, manifest and chat are encrypted in the browser (AES-GCM, WebCrypto)
  before upload. Microsoft and Google store only ciphertext, and a forwarded sharing link without
  the fragment is useless.
- **A signing key per person**, made in the browser (Ed25519 or ECDSA P-256, whichever WebCrypto
  supports across the browsers we support). Every seat file and check-in is signed, and the
  manifest lists whose keys may add comments. A View documents attendee with `write` in OneDrive
  cannot forge markups others accept.
- **Removing someone rotates the session key** and re-encrypts the files. Files they already
  downloaded cannot be taken back.
- **Costs:** PDFs cannot be previewed in the OneDrive or Drive web interface, and a lost key means
  lost data. On by default for Live Sessions; a per-Project choice ("Encrypted Project"), since
  teams may want to open Project PDFs in OneDrive.

## Electron version

The Electron project is not in this repository yet, so this section is a plan for it rather than
changes to existing code.

### E1 Shell hardening (S–M)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in every window;
  `webviewTag: false`.
- Load the app from a custom protocol (`app://redcolumn/`) registered as secure and standard, not
  `file://`, and never load remote pages in an app window.
- A real CSP header on every response via `session.defaultSession.webRequest.onHeadersReceived`,
  including `frame-ancestors 'none'`.
- Block navigation away from `app://` (`will-navigate`), and open external links in the default
  browser through `setWindowOpenHandler` with an allow-list of schemes (`https:`, `mailto:`).
- `session.setPermissionRequestHandler` that denies everything except what the app uses (for
  example, clipboard write).
- Electron Fuses: turn off `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and
  `EnableNodeCliInspectArguments`; turn on `EnableEmbeddedAsarIntegrityValidation` and
  `OnlyLoadAppFromAsar`.
- Sign and notarise builds. Ship updates only signed, over HTTPS, from the release host.
  *Status:* the Windows app updates itself (`electron-updater`) over HTTPS from the GitHub release,
  and checks the installer's SHA-512 against `latest.yml` from the same release. The installers
  are not signed yet, so that hash does not protect against a compromised release or publisher
  account. Signing the installer and setting `win.publisherName` in `electron-builder.yml` makes the
  updater refuse anything not signed by that publisher; do that before relying on updates as a
  security control. Until then, the Release workflow's publish job runs in the `release`
  environment, which should require a maintainer's approval, and `v*` tags should be protected,
  so publishing a release (which every installed Windows app then installs) needs a person.
  The Mac app does not install updates itself.
- The preload script exposes a few named functions through `contextBridge`, never `ipcRenderer`
  itself. The main process checks every IPC message's sender and arguments.

### E2 Tokens out of the page (M)

The browser can only keep a token where page scripts can reach it. Electron can do better:

- **Sign in from the main process** with the system browser, a loopback redirect and PKCE (MSAL
  Node for Microsoft; Google's desktop OAuth client for Google).
- **Keep tokens in the OS keychain** (`safeStorage`, or MSAL Node's cache extensions).
- **The page never sees a token.** The main process runs a small Graph broker with the same verbs
  as `DriveApi` (`list`, `download`, `createFile`, `updateContent`, and the rest). The page calls
  them over IPC with opaque folder and file IDs. The broker applies the rules from 3.4–3.6 and
  4.3: scopes per call, step-ups only for sharing and joining, the token only to Graph, deletes
  only for app files.

A script injected into the page could still ask the broker to do things, but only the things the
broker offers, only on folders the person opened, and it cannot take a token away to use
elsewhere.

### E3 Local folder option (M–L)

Let a Project, and optionally a Live Session, run on a local folder instead of a cloud API. The
person picks a folder that their sync client already syncs (OneDrive, Dropbox, Google Drive,
SharePoint, Syncthing, a network share). The sync client moves the files. redcolumn needs no
sign-in and holds no token.

**Why it fits.** Every piece of Project state is already a separate file written by one person
(`Project.ts` line 111), the pattern sync clients handle without conflicts. Projects talk to
storage only through `DriveApi` (`studio/drive/DriveApi.ts`), so a `FolderDrive` can stand in for
`OneDrive`.

**Picking a folder.**

- **Settings → Storage**: **Cloud (sign in)** or **Local folder**. A **Local folder only** mode
  hides the cloud sign-ins entirely.
- **New Project** / **Open Project** gets **Use a folder on this computer…**, which opens
  `dialog.showOpenDialog`. The main process remembers the chosen roots, and nothing outside them is
  reachable.
- The Projects panel shows where the folder is and, if it sits inside a known sync folder,
  which client syncs it.

**How `FolderDrive` maps `DriveApi`:**

| `DriveApi` | `FolderDrive` |
|---|---|
| `list(folderId)` | `readdir` of the folder; JSON files carry their properties inside under `_nb`, as OneDrive's do; PDFs recognised by extension |
| `download(fileId)` | `readFile` |
| `createFolder(name)` | `mkdir` inside the chosen root, adding a number on a name clash |
| `createFile(…)` | Write a new file, never replacing one with the same name |
| `updateContent` / `updateProperties` | Write to a temporary file beside it, then rename over, so the sync client never uploads half a file |
| `version` | Hash of the content (sync clients can change modification times) |
| `ownedByMe` | The manifest's owner key matches this person's signing key (see below) |
| `remove(fileId)` | Delete own lock files only, as in 4.3 |
| `removeFolder` | Not offered; the person deletes the folder in Explorer or Finder (or `shell.trashItem` to the recycle bin) |
| `shareWithLink` / `shareWithUser` / permissions | Not offered. The panel says "Share this folder in OneDrive (or Dropbox, …)" and opens the folder in the file manager |
| `readAppFile` / `writeAppFile` | The app's data folder (`app.getPath('userData')`) |

**IPC and path safety.**

- The page gets opaque IDs, never paths. The main process maps IDs to absolute paths.
- Every path is resolved with `realpath` and must stay inside a chosen root. Symlinks that lead
  outside are refused.
- Only file types the app writes are created (`.pdf`, `.json`, `.nbseat`, `.xlsx`).

**Changes.** Watch the folder (`fs.watch`, or chokidar for network shares) instead of polling, and
debounce events, since sync clients write in bursts.

**Sync clients' own behaviour.**

- **Conflict copies** ("file (DESKTOP-ABC's conflicting copy).json", "file-PC.json"): ignore
  files whose names do not match the app's patterns. Since each file has one writer, conflicts
  should only come from the same person on two computers.
- **Files on demand** (OneDrive, Dropbox): reading a placeholder makes the client download it.
  Show progress for large PDFs.
- **Latency:** seconds to minutes. Check-out locks become advisory with a confirm window: a claim
  counts once it has been on disk, with no earlier claim seen, for a set time (for example, 30
  seconds). The existing "the later claim removes itself" rule (`Project.ts` lines 527–541) still
  applies. Say in the panel that a check-out takes a moment to confirm.

**Identity.** A local folder has no Microsoft or Google account to say who wrote what.

- Each person gets a signing key pair, made on first use and kept in the OS keychain.
- Every file they write is signed. The manifest names the owner's public key, and the Project
  Record shows names with a short key fingerprint.
- This is trust on first use: it proves the same person wrote everything under that key, not who
  they are. Owners can confirm fingerprints in person or by phone. Say so in the help.

**Live Sessions on a local folder.** They work with the same file layout, but sync latency makes
them feel like a fast shared review, not a live one. Label them **Shared folder session (updates
as your sync client syncs)**. A faster direct connection between computers can come later (see
open questions).

*Built (desktop app):* `SessionFolderDrive` (`studio/drive/folder.ts`) runs a `DriveSession` on a
folder the host picks. Two differences from Projects:

- The main process's IDs are per computer, but a session's file IDs travel (room files are named
  after seats, and documents are rooms and manifest entries by ID). Inside the session folder a
  file is known to the page by a hash of its name instead, which is the same on every computer.
- No end-to-end encryption and no invite link: whoever shares the folder decides who gets in.
  `.nbseat`, `.nbsnap` and `.nbdelta` are allowed file types. **End session** moves the folder to
  the recycle bin (`shell.trashItem`), and only when it holds a `session.json` this install wrote.

**Browser version.** The same `FolderDrive` can run in Chrome and Edge through the File System
Access API, which the app already uses for exports. It is not available in Firefox or Safari, or
on iPad. Electron first, then the browser if it proves useful.

### E4 Electron storage of other data (S)

- Keep the library, markups and settings in the app's data folder, not in a page storage that
  other windows could share.
- Offer **Encrypt local data** using `safeStorage` for people on shared computers.

## Testing

- **Unit (`node --test`, beside `onedrive.test.ts`):** scopes requested per call (3.4); no step-up from
  unrelated 403s (3.5); the token refused for non-Graph URLs and for an off-host `nextLink` (3.6);
  `remove` and `removeFolder` refusals (4.3); `shareWithUser` default `reader` (4.1).
- **Unit:** `FolderDrive` against a temporary directory: atomic replace, no overwrite on create,
  path escape and symlink refusal, conflict copies ignored, lock confirm window.
- **Browser (Playwright, `apps/web/test/browser/`):** the production build loads with the CSP and
  makes no CSP violations through open, mark up, OCR, compare, export and sign; the start page
  makes no request to Google or Microsoft hosts; Trusted Types blocks a raw `innerHTML` in the
  help.
- **Manual, with a test Microsoft tenant and a personal account:** which calls work at the app
  folder level only; link expiry on personal and work accounts; the actual download and upload
  hosts for the CSP; that a session started and joined end to end still works after 3.1–3.5.
- **Electron:** Electronegativity (or an equivalent check) in CI; fuses verified on the packaged
  build; IPC handlers fuzzed with bad IDs and paths.

## Open questions

1. Which Graph calls succeed with `Files.ReadWrite.AppFolder` alone, on personal and work
   accounts? In particular `createLink` and `invite` on folders inside the app folder. If they
   work, step 2 is never needed for hosts.
2. Can an attendee join with `Files.Read.All` (read-only) if they only view and do not chat? See
   4.1.
3. Does `expirationDateTime` on `createLink` work on personal OneDrive accounts without Microsoft
   365?
4. Signature checks and `connect-src`: list common time stamp and certificate status servers, or
   block and explain? See 2.1.
5. Hosting: which address is the main one, GitHub Pages or Vercel? See 2.4.
6. For local-folder Live Sessions, is sync-client latency acceptable, or is a direct connection
   between computers (WebRTC) worth the work? Direct connections need someone to introduce the two
   computers and fail on some company networks without a relay, which would be a server.

## Order

| Step | Phase | Size | Why this order |
|---|---|---|---|
| Correct PRIVACY.md and CLOUD-SETUP.md | 1.1 | S | Accuracy first; no code |
| Token only to Graph; step-up only for sharing and joining | 3.5, 3.6 | S | Small, contained changes in `onedrive.ts` |
| Microsoft cache per tab, with Stay signed in | 3.1 | S | Biggest cut in token exposure for least work |
| Delete limits in the API; invite default `reader` | 4.3, 4.1 | S | Safe defaults |
| Keep production client IDs off Vercel previews | 2.4 | S | Settings only; closes a path for unreviewed code to get a sign-in |
| CSP, `vercel.json` headers, referrer `<meta>`, Trusted Types, frame check | 2.1–2.4 | M | Needs the host list from testing |
| Scopes per action, no stored level; explain before step-up | 3.4, 1.3 | M | Changes the sign-in flow; test with real accounts |
| Account settings → Access, activity list, first-use notice | 1.2, 1.4, 1.5 | M | Builds on 3.1–3.4 |
| Forget tokens when idle; sign out everywhere | 3.2, 3.3 | S | |
| View links, organization first, link expiry, unlink before delete | 4.2 | M | |
| Supply chain steps | 2.5 | S | `.github/` changes need approval |
| Electron shell hardening | E1 | S–M | Before the first public Electron build |
| Electron Graph broker, tokens in the keychain | E2 | M | |
| Electron local folder for Projects | E3 | M–L | |
| Encryption and signing | 5 | L | Shares the signing keys with E3 |
