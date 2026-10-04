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
5. **API key**: go to Credentials → Create credentials → API key, then edit it.
   - Application restrictions → Websites: `http://localhost:5173/*`, `http://localhost:4173/*`,
     `https://colbygallagher.github.io/*`, `https://docs.google.com/*` (the Picker runs there),
     and any other address the app is served from (for example your Vercel domain).
   - API restrictions: Google Drive API and Google Picker API.
   - The key is `VITE_GOOGLE_API_KEY`.
6. **Configure the app**:
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
- Work accounts whose tenant blocks "Anyone" links fall back to an organization-only link.
- Session folders live in the app's own folder, `Apps/redcolumn` (OneDrive names it after the app
  registration, so keep that named `redcolumn`).

### Microsoft Entra setup (once, by whoever deploys the app)

1. In the [Entra admin center](https://entra.microsoft.com) → App registrations → **New
   registration**. Supported account types: *Accounts in any organizational directory and personal
   Microsoft accounts* (or narrower, and set `VITE_MICROSOFT_TENANT` to match).
2. Platform **Single-page application**, redirect URIs: `http://localhost:5173/msal-redirect.html`
   and your site's, e.g. `https://<user>.github.io/redcolumn/msal-redirect.html`.
3. API permissions → Microsoft Graph → Delegated: `Files.ReadWrite.AppFolder`, `Files.ReadWrite` and
   `Files.ReadWrite.All` (users consent themselves; no admin consent needed unless the tenant
   requires it). Access is asked for a step at a time, and only when Microsoft refuses the smaller
   one: first `Files.ReadWrite.AppFolder` (only `Apps/redcolumn`), then `Files.ReadWrite` (if
   sharing the session folder needs it), then `Files.ReadWrite.All` (if an attendee cannot open the
   host's folder without it). Each browser remembers how far it had to go.
4. Put the **Application (client) ID** in `VITE_MICROSOFT_CLIENT_ID` (`apps/web/.env.local`
   locally, an Actions variable for GitHub Pages).

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
- New Projects are shared by link so an invite link works: "Anyone with the link" can edit, or, for
  work accounts whose tenant blocks that, people in the organization. Turn the link off or make it
  view-only under People to restrict the Project to the people listed.

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
