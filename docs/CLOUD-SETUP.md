# Live Sessions: Google Drive and OneDrive

Several people mark up the same PDFs together in a Live Session. A session lives in a folder in
the host's Google Drive or OneDrive. There is no redcolumn server: each person's browser reads and
writes the shared folder directly, and Google or Microsoft holds the files.

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
