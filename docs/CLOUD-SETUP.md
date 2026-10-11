# Live Sessions and Projects: Google Drive and OneDrive

Several people mark up the same PDFs together in a Live Session. A session lives in a folder in
the host's Google Drive or OneDrive. There is no redcolumn server: each person's browser reads and
writes the shared folder directly, and Google or Microsoft holds the files. [Projects](#projects-onedrive)
(shared folders of PDFs with check out and revisions) work the same way, in OneDrive only.

## Sessions panel

- **My Sessions** lists the sessions this browser has started or joined. **+ Start** opens the
  Start a New Session dialog (name, Google Drive or OneDrive, documents from open tabs, the library
  or disk, and attendees with their access); **Join…** picks a Drive session folder or takes a
  OneDrive session link. Most people join from the invite link the host sends.
- You can be in several sessions at once. Each session's documents open as tabs across the top,
  marked Live; the panel shows one session's documents, attendees and Record at a time.
- **Leave session** closes that session's tabs; the others carry on.

## Access

Each session has an access policy: a default for anyone with the invite link, people with their
own level, and groups of people sharing a level. The levels are **No access**, **View documents**
(read-only markups, can chat) and **Add comments** (markup). A person's own level wins; otherwise
the most generous of their groups; otherwise the default. The host always has full control and
edits the policy under Attendees → Permissions….

People are matched by their Google or Microsoft email, or by the name they join with (Edit →
Author). The app respects the policy, but what actually protects the files is the folder's sharing
in Google Drive or OneDrive.

## Security policy and hosting

Each built page carries a Content Security Policy (`apps/web/src/security/csp.ts`): only the app's
own scripts run, and the page connects only to Microsoft Graph and sign-in, and to Google's APIs,
for the providers whose client ID the build has. The help also requires Trusted Types. GitHub Pages
cannot send headers, so the policy is a `<meta>`, and the app refuses to run inside another page.
Vercel sends `apps/web/vercel.json`'s headers as well (`frame-ancestors 'none'`, `no-referrer`,
`nosniff`, a `Permissions-Policy`).

- **Vercel preview deployments** are built from branches that may not have been reviewed. Do not
  register preview addresses as Microsoft redirect URIs or Google JavaScript origins, and leave
  `VITE_MICROSOFT_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` unset for the Preview environment. To test
  sign-in on previews, use a separate test app registration with its own client IDs.
- **Certificate services** (time stamps, OCSP, revocation lists) and **form submit addresses** in
  PDFs are not in the policy, so those requests are refused with a message and signing carries on
  without them. Most of these services refuse browser requests anyway.

### End-to-end encrypted sessions

New Live Sessions are encrypted end to end unless the host unticks it (`apps/web/src/studio/crypto/`).

- **The key is in the invite link** after `#rk=`, which browsers never send to a server. The
  session's PDFs, markups, chat, the Record and the manifest are sealed with AES-GCM in the browser
  before upload, so Google and Microsoft store only ciphertext, and a forwarded sharing link without
  the `#` part opens nothing. File names, seat names and presence (which page someone is on) are
  file properties and stay readable to anyone the folder is shared with.
- **Signing.** Each browser has its own ECDSA key (kept in IndexedDB, not extractable) and signs
  every room file it writes. The host has keys of its own for the session, kept in its app folder
  (`session-host-keys.json`, not shared): the link pins their fingerprint, the host signs the
  manifest, and the manifest lists each admitted seat's keys. Room files from a seat the host has
  not admitted, signed by another key, or (for documents) from someone without markup access are
  ignored, even by people who can write to the folder in OneDrive.
- **Removing someone** (setting their access to none) makes a new session key, wrapped (ECDH) for
  everyone else; their room files are rewritten with it and the host re-encrypts the documents.
  What the removed person already read cannot be taken back.
- **Encrypted Projects** are a choice when making a Project (off by default, so a team can still
  open the PDFs in OneDrive). Their key is in the Project link after `#pk=`; every file's content
  is sealed before upload. File names and properties stay readable, and there is no signing or key
  change on removal: removing someone from the folder in OneDrive is what keeps them out.
- **Costs:** PDFs cannot be previewed in OneDrive or Google Drive, and a lost invite link cannot be
  recovered. The host manages the session from any browser signed in to the same account, since the
  host keys are in its app folder.

### Desktop app

The desktop app (`apps/desktop`) keeps the Microsoft sign-in in its main process, encrypted with
the system key store. Every OneDrive call from the page goes through a Graph broker there
(`apps/desktop/src/graph.ts`), which attaches the token and applies the same rules as the web app:
Graph only, wider access only for sharing calls and other people's drives, and deletes only of the
app's own lock files and session folders. The page never receives a Microsoft token. Every
`app://` response carries `frame-ancestors 'none'` and `nosniff`, and the packaged binary has the
`RunAsNode`, `NODE_OPTIONS` and `--inspect` fuses off and asar integrity checks on.

### Projects on a folder on this computer (desktop app)

In the desktop app, Projects can live in a folder that the person's own sync client keeps in step
(OneDrive, Dropbox, Google Drive, a file server): **New project in a folder on this computer…** and
**Open a project folder on this computer…** in the Projects panel. redcolumn signs in to nothing and
holds no token; the sync client moves the files, and sharing is done in that client (**Show
folder** opens it). The main process (`apps/desktop/src/folderDrive.ts`) gives the page opaque IDs,
never paths, keeps every path inside a folder the person chose (symbolic links out are refused),
creates only `.json` and `.pdf` files, never replaces a file when making one, writes replacements
beside the file and renames them over it, deletes only check-out lock files, and does not list
sync clients' conflict copies or half-synced files. A check-out counts once its claim has been on
disk for 30 seconds with no earlier claim seen, since others' claims take a while to sync. The
Project's owner is the install that made it. Encrypted Projects work here too.

### Encrypt local data (desktop app)

**Preferences › Account › Access › This computer › Encrypt local data** seals the library's PDFs,
the library list and every document's markups with AES-GCM before they reach this computer's
storage. The key is made once by the main process and kept only encrypted by the system key store
(`safeStorage`: DPAPI on Windows, Keychain on macOS), so the files copied off the disk, or read by
another account, are unreadable. Turning it on or off converts what is stored as the app restarts,
before anything opens; reading always accepts both forms. Preferences, Studio lists and saved
sign-in details are not covered.

## Google Drive

### How it works

Starting a session creates `Apps/redcolumn/<name> (redcolumn session)/` in the host's Drive, shared
"Anyone with the link" (as editor, or as viewer with editors invited by email). In it:

- `session.json`: the name, host, status and permissions. Only the host writes it.
- the session's PDFs.
- one `*.nbseat` file per attendee browser, holding that attendee's merged Yjs state (markups for
  every document, plus the Record and chat), with presence in its file properties.

Each attendee writes only their own seat, so writes never collide. Everyone reads the others'
seats, using the API key because the folder is public by link, and merges them, every few seconds.
The app uses the `drive.file` scope only: it can reach only files it created or that the person
picked, so Google's security review is not needed. Joining asks the attendee to select the session
folder once in Google's Picker; that grants the app access to add their seat.

Code: `apps/web/src/studio/drive/`.

### Google Cloud setup (once, by whoever deploys the app)

1. **Project**: at https://console.cloud.google.com, create a project. Note its **Project number**
   (Dashboard → Project info); this is `VITE_GOOGLE_APP_ID`.
2. **APIs**: go to APIs & Services → Library and enable **Google Drive API** and **Google Picker API**.
3. **OAuth consent screen** (Google Auth Platform):
   - Branding: app name, support email, developer contact, and a link to the privacy policy
     (`PRIVACY.md` in the repository).
   - Audience: **External**. While in **Testing**, add each user under **Test users**.
   - Data access: add the scope `https://www.googleapis.com/auth/drive.file`. This scope is
     non-sensitive, so **Publish app** needs no verification review.
4. **OAuth client**: go to Clients → Create client → **Web application**.
   - Authorized JavaScript origins: `http://localhost:5173`, `http://localhost:4173`,
     `https://colbygallagher.github.io`, and any other address the app is served from.
   - No redirect URIs are needed.
   - The Client ID is `VITE_GOOGLE_CLIENT_ID`.
5. **Desktop client** (the Electron app only): Clients → Create client → **Desktop app**.
   No JavaScript origin can be registered for `app://redcolumn`, and Google refuses sign-in inside
   an embedded browser, so the desktop app opens the system browser and listens on
   `http://127.0.0.1:<port>` (PKCE and `state`). Put the client ID in
   `VITE_GOOGLE_DESKTOP_CLIENT_ID` and the client secret in `VITE_GOOGLE_DESKTOP_CLIENT_SECRET`:
   Google requires the secret on the token request for Desktop clients even with PKCE, and treats
   it as non-confidential for installed apps. The desktop app uses this client in dev too.
   Test sign-in from a packaged build.
6. **API key**: go to Credentials → Create credentials → API key, then edit it.
   - Application restrictions → Websites: `http://localhost:5173/*`, `http://localhost:4173/*`,
     `https://colbygallagher.github.io/*`, `https://docs.google.com/*` (the Picker runs there),
     and any other address the app is served from (for example your Vercel domain).
   - API restrictions: Google Drive API and Google Picker API.
   - The key is `VITE_GOOGLE_API_KEY`.
   - The desktop app loads from `app://redcolumn`, which is not a website a key can be restricted
     to. For Drive sessions in the desktop app, create a second key with API restrictions only
     (Google Drive API and Google Picker API) and put it in `VITE_GOOGLE_DESKTOP_API_KEY`. Test
     the Picker from a packaged build.
7. **Configure the app**:
   - Local: copy `apps/web/.env.example` to `apps/web/.env.local` and fill it in.
   - GitHub Pages: add the same names under the repository's Settings → Secrets and variables →
     Actions → **Variables**.

None of these values is secret: browser apps ship them publicly, and the key only works from the
listed sites.

Note: Google Workspace domains that block "Anyone with the link" sharing cannot host Drive sessions.

## OneDrive

OneDrive sessions work like Google Drive ones (same folder layout: `session.json`, the PDFs, and
one `.nbseat` file per attendee, read every few seconds), over Microsoft Graph, with these
differences:

- **Everyone signs in with Microsoft** (personal, work or school account). Graph has no key-based
  reads, so attendees read the shared folder as themselves.
- **The session is identified by the folder's sharing link** (as a Graph share ID, `u!…`). Invite
  links are `?onedrive=<share id>`; Join also accepts the OneDrive / SharePoint sharing link
  itself. Opening it redeems the link, so the attendee keeps access.
- Graph has no custom file properties, so the manifest and seats carry theirs inside the JSON
  (under `_nb`); PDFs are recognised by extension.
- **Links:** view-only by default; people who mark up or chat are invited by email (or the host
  ticks "Anyone with the link can edit"). Work and school accounts get a link for people in the
  organization first, and "Anyone" only if that fails; invite people outside by email. A session's
  link stops letting new people in when the session ends, or after a week if it has no end date
  (people who already joined keep access; Microsoft needs Microsoft 365 for this on personal
  accounts, and the link is made without an end where it is refused). Ending a session removes its
  links before it deletes the folder, so the copy in the recycle bin cannot be reached by link.
- Session folders live in the app's own folder, `Apps/redcolumn` (OneDrive names it after the app
  registration, so keep that named `redcolumn`).

### Microsoft Entra setup (once, by whoever deploys the app)

1. In the [Entra admin center](https://entra.microsoft.com) → App registrations → **New
   registration**. Supported account types: *Accounts in any organizational directory and personal
   Microsoft accounts* (or narrower, and set `VITE_MICROSOFT_TENANT` to match).
2. Platform **Single-page application**, redirect URIs: `http://localhost:5173/msal-redirect.html`
   and your site's, e.g. `https://<user>.github.io/redcolumn/msal-redirect.html`.
   For the Electron app, add a platform **Mobile and desktop applications** with redirect URI
   `http://127.0.0.1` (no port, no path). The desktop app opens the system browser and redirects to
   `http://127.0.0.1:<port>`; Entra ignores the port of a loopback redirect, but the path must match,
   so the app sends none. `app://redcolumn/...` is not a valid SPA redirect.
   The same client ID is `VITE_MICROSOFT_CLIENT_ID`. A popup that works in dev does not mean the
   packaged build can sign in.
3. API permissions → Microsoft Graph → Delegated: `Files.ReadWrite.AppFolder`, `Files.ReadWrite` and
   `Files.ReadWrite.All` (users consent themselves; no admin consent needed unless the tenant
   requires it). Every call asks for the app folder alone, except sharing calls and calls into
   someone else's folder. When Microsoft refuses one of those, the app tries the next level for
   that kind of call only: silently if the person allowed it before, otherwise after its own dialog
   explains why and the person continues to Microsoft. Any other refusal is reported as an error,
   not answered with more access. Nothing about the level is stored; each tab starts small.

   | Level | Lets the app | Used for |
   |---|---|---|
   | `Files.ReadWrite.AppFolder` | Read and write `Apps/redcolumn` only | Find the app folder; create session and Project folders; upload, read, list and replace their files; settings backup (`profiles.json`); spreadsheet sync (`.xlsx`); end-of-session copies |
   | `Files.ReadWrite` | Read and write anything in the person's OneDrive | Make a sharing link for a folder (`createLink`); invite by email (`invite`); list, change and remove who a Project folder is shared with (`permissions`) |
   | `Files.ReadWrite.All` | Also files others have shared with them | Open a folder from an invite (`/shares/…`) and read and write it when it lives in someone else's OneDrive |

   The sign-in is kept for the tab only unless the person ticks **Stay signed in on this device**,
   and is forgotten after 30 minutes with no cloud calls.
   The token is sent only to `graph.microsoft.com`; download and upload-session URLs that Graph
   returns are pre-authorised and get no token.
4. Put the **Application (client) ID** in `VITE_MICROSOFT_CLIENT_ID` (`apps/web/.env.local`
   locally, an Actions variable for GitHub Pages).

## Markups to a spreadsheet (Google Sheets or Excel in OneDrive)

In the Markups list, **Sync…** keeps the list (its visible columns, filter and sort) in a
spreadsheet and rewrites it about a second and a half after each change. Measurements go in as
numbers, so the sheet can total them. Each document has its own link, remembered by file name in
this browser.

- **Google Sheets:** creates a spreadsheet in the person's Drive and writes it through the Sheets
  API, so everyone with it open sees cells change as they land. It uses the same `drive.file`
  scope as sessions (the app reaches only spreadsheets it created), so no new consent screen
  entry is needed. In the Cloud project, enable the **Google Sheets API** (APIs & Services →
  Library) and add it to the API key's restrictions.
- **Excel in OneDrive:** writes an `.xlsx` to `Apps/redcolumn`, replacing the same file each
  time, with the app-folder permission sessions already use. Excel for the web reloads a workbook
  that changed; the desktop app picks it up when the file syncs. It is a file replace, not a
  cell-by-cell edit, so changes you make in that sheet are overwritten by the next update.
- A token that has expired (Google's last an hour) is renewed with a click on **Reconnect**: the
  browser will not open a sign-in popup on its own. Sync runs only while the document is open.

Code: `apps/web/src/sheetsync/`.

## Projects (OneDrive)

A Project is a shared folder of PDFs that everyone on it can open from the Projects panel, with
check out and check in, a revision for every check-in, and a Project Record. It lives in the owner's
OneDrive. There is no redcolumn server: each person's browser reads and writes the folder directly,
and Microsoft holds the files. Projects use OneDrive only, and the same Microsoft app registration
as Live Sessions (see the Entra setup above); nothing more needs setting up.

### Projects panel

- **My Projects** lists the Projects this browser has made or opened. **+ New** makes one in your
  OneDrive; **Open…** takes the invite link the owner sent (`?project=<share id>`), or the OneDrive
  sharing link to the Project folder. Opening one signs you in to Microsoft.
- Inside a Project you browse folders, add PDFs from disk or the document in front, and
  rename, move or delete files and folders. A file opens as a copy in your library, remembered as
  coming from that Project file and revision, and is brought up to date when a newer revision
  exists.
- **Check Out** claims a file and opens it; only the holder can check it in. **Check In…** uploads
  your copy, with its markups written into the PDF as annotations, as the next revision, with a
  comment. **Undo Check Out** gives it up. The owner can release anyone's check-out, and anyone can
  release one left for more than a day.
- **Revisions** lists every check-in. An older revision opens on its own, or **Restore** makes it
  the newest again as a new revision.
- The **Project Record** lists who did what and when: files and folders added, renamed, moved and
  deleted, check-outs and check-ins, notes, and changes to who has access.
- Check-ins and notes made while offline are queued in the browser and sent, in order, when
  OneDrive can be reached again. A change OneDrive refuses (for example because someone else now
  holds the file) stays in the panel with its reason, to retry or discard.

### Access

The Project folder's sharing in OneDrive is what controls access; the app follows it.

- **Owner:** whoever made the Project. The owner sees **People**, which lists who the folder is
  shared with as OneDrive reports it (including the "anyone with the link" entry), changes each
  person between **Can edit** and **Can view**, removes them, and invites people by email.
- **Can edit:** open, check out and in, add and change files and folders.
- **Can view:** read only. The app finds this out when OneDrive refuses a write, and then offers
  no editing.
- New Projects are shared by a view-only link so an invite link works (for people in the
  organization first on work accounts); editors are invited by email under People. Turn the link
  off under People to restrict the Project to the people listed. Project links do not expire.

The app cannot hold back what OneDrive allows: anyone who can edit the folder in OneDrive itself
can also change its files there.

### How it is stored

A Project is one flat folder, `Apps/redcolumn/<name> (redcolumn project)/`. Every piece of state is
a separate file written by one person, so people never overwrite each other:

- `project.json`: the name and owner. Only the owner writes it.
- `dir-<id>.json`: a folder of the Project, made by whoever added it.
- `f-<file>-r0001.pdf`: one PDF per revision, never changed afterwards. `f-<file>-r0001.json`
  beside it holds the revision's name, folder, size, SHA-256, author and comment. A revision exists
  once both are there; downloads are checked against the hash.
- `lock-<file>-<claim>.json`: a check-out. Each person's claim is its own file, and the earliest
  one (by OneDrive's creation time) holds the file. Someone who loses a race removes their claim
  and is told who has it.
- `edit-<id>-<claim>.json`: a rename, move or delete. Edits apply in OneDrive's order. A deleted
  file or folder only disappears from the Project: its files stay in the OneDrive folder, so
  nothing is destroyed and the owner can still recover it there.
- `rec-<person>.json`: one person's share of the Project Record. The panel merges everyone's by
  time.

The panel re-reads the folder every 15 seconds while it is showing.

Code: `apps/web/src/studio/projects/` (the model and `Project` class, tested with an in-memory
drive), with the OneDrive calls in `apps/web/src/studio/drive/onedrive.ts` and the panel in
`apps/web/src/components/ProjectsPanel.tsx`.

### Limits

- Check-outs, check-ins and edits need a connection. Only check-ins and notes can be queued
  offline, and only for a file already checked out.
- A Project cannot be browsed after a reload while offline; only the queue survives a reload.
- If someone renames a file in the moment between your check-in reading the folder and writing
  it, their rename can be lost. Check-outs have a similar small window if OneDrive's clocks
  disagree.
- Microsoft's OneDrive and SharePoint sharing rules apply: a tenant that blocks external sharing
  cannot add people outside it.
