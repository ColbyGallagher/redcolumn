# Privacy policy

_Last updated: 11 October 2026_

redcolumn is a free, open-source PDF markup and takeoff app that runs in your web browser. This
policy explains what happens to your documents and information when you use it. It applies to the
app published from this repository (for example at `colbygallagher.github.io/redcolumn`). If
someone else runs their own copy, their policy applies to it.

## The short version

- **Your PDFs stay on your device.** Opening, marking up, measuring and saving documents happens
  entirely in your browser. The redcolumn project never receives your documents or markups.
- **There is no redcolumn server, no account and no tracking.** The app has no analytics,
  advertising, cookies of its own or error reporting.
- **The local assistant stays on your computer.** The desktop app can let an AI client you already
  run read the open drawing. That is off until you turn it on, and the redcolumn project never
  sees it.
- **Live Sessions and Projects use your own OneDrive.** When you share documents with others,
  they go to Microsoft under your account, not to us.

## What stays on your device

The app keeps these in your browser's storage, on your device only:

- documents you open or save to the library, with their markups, measurements and revisions;
- your settings, profiles, tool sets, signatures and stamps;
- a list of Live Sessions and Projects you have started or joined, which library files came from
  a Project, and check-ins and notes waiting to be sent;
- the app itself and its OCR language data, so it works offline.

Clearing your browser's site data for redcolumn deletes all of it. Nobody else can see it,
including us.

## Loading the app

The app is served by GitHub Pages (and preview copies by Vercel). Like any website host, they
receive standard request information when your browser loads the app, such as your IP address,
browser type and the pages requested, and handle it under their own privacy policies
([GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement),
[Vercel](https://vercel.com/legal/privacy-policy)). We do not receive or use this information.

## Checking for updates (desktop app)

In the desktop app, Help › Check for Updates (and only when you choose it) asks GitHub for the
newest release of this project, `api.github.com/repos/ColbyGallagher/redcolumn/releases/latest`.
GitHub receives your IP address and the request's standard headers, and handles them under its
privacy policy. Nothing from your documents is sent. Nothing is downloaded until you open the
release page and choose to.

## Live Sessions (OneDrive)

Live Sessions let several people mark up the same PDFs. They are optional and only start when you
sign in to Microsoft.

- **Where the files go:** the session's PDFs, markups, chat and activity record are saved in a
  folder in the host's OneDrive, and shared with the people the host invites. Your browser talks
  to Microsoft directly.
- **Sign-in:** you sign in with Microsoft in a pop-up from them. The app receives permission to
  use your OneDrive, and your name and email, so others in the session
  can see who made each markup. These sign-in details stay in your browser and are never sent to
  us.
- **OneDrive access:** Microsoft offers three levels of access. redcolumn asks for the smallest
  first, and for more only when sharing a folder or opening someone else's needs it. Before
  Microsoft's window opens for more, the app says why in its own dialog, and you can cancel.
  1. **The app's own folder** (`Apps/redcolumn`). This is all most people ever grant. Sessions,
     Projects, spreadsheet sync and settings backup live here.
  2. **Your OneDrive.** Needed to share a session or Project folder by link or by email. This
     permission lets the app read and change any file in your OneDrive. redcolumn uses it only on
     the session or Project folder you are sharing.
  3. **Your OneDrive and files shared with you.** Needed only to join a session or Project in
     someone else's OneDrive. This permission also reaches files other people have shared with
     you. redcolumn uses it only on the folder in the invite you opened.

  Microsoft remembers what you allowed until you withdraw it (Microsoft account → Privacy → Apps
  and services). The app uses the wider access only for the calls that needed it (sharing, or the
  folder you opened), and only in that tab: everything else, and the next visit, starts again from
  the app's own folder. The app only deletes its own check-out lock files and session folders it
  made in `Apps/redcolumn`.
- **How long you stay signed in to Microsoft:** by default only while the tab is open; closing it
  signs you out. Tick **Stay signed in on this device** before signing in to keep the sign-in in
  this browser instead (Microsoft limits it to about a day without use). After 30 minutes with no
  cloud work (no session or Project open), the app forgets the sign-in in that tab. **Sign out**
  forgets it in the app; **Sign out everywhere** also ends your Microsoft session in this browser.
  The sign-in token is only ever sent to Microsoft Graph.
- **Seeing what was allowed and done:** **Preferences › Account › Access** shows who is signed in,
  the access in use and where the sign-in is kept. **Activity** lists what the app created, saved,
  shared and deleted in OneDrive from this browser. That list stays in your
  browser and is never sent anywhere. Before the first sign-in, the app shows a
  short summary of what goes where.
- **Encryption:** new sessions are encrypted end to end unless the host turns it off. The key is
  in the invite link after `#`, which is never sent to Microsoft or us, so Microsoft stores only
  scrambled files. File names and attendee names are still visible to people the folder is shared
  with.
- **What other attendees see:** your name or email, your markups, chat messages, and which page
  you are viewing while you are in the session.
- **Removing it:** delete the session folder in your OneDrive. You can withdraw the app's access
  at any time from your Microsoft account (Privacy → Apps and services).

Microsoft handles these files under its own terms and privacy policies.

## Spreadsheet sync (OneDrive)

If you turn on **Sync** in the Markups list, redcolumn writes that list (the columns, filter and
sort you see: subjects, comments, authors, dates, measurements) to an Excel
workbook in `Apps/redcolumn` in your OneDrive, under your own account, and rewrites it when markups
change. Nothing goes to us. The spreadsheet is yours: share or delete it in OneDrive.
Stopping the sync, or clearing site data, does not delete it. The app keeps the spreadsheet's link
in your browser's storage so it can carry on after a reload.

## Projects (OneDrive)

Projects are shared folders of PDFs for a team. They are optional and only start when you sign in
to Microsoft.

- **Where the files go:** a Project is a folder in the owner's OneDrive, under `Apps/redcolumn`.
  It holds the PDFs, every revision of each, who checked each in and when, and the Project
  Record. People who check a file in write to that folder with their own account. Your browser
  talks to Microsoft directly; nothing passes through us.
- **Sign-in and access:** the same Microsoft sign-in and permissions as Live Sessions (see
  above). The owner can see, and change, who the folder is shared with through the app; that list
  comes from OneDrive.
- **What other people on the Project see:** your name or email on the files you add and check
  in, your check-outs, your notes and your activity in the Project Record, and your comments on
  revisions.
- **Deleting:** deleting a file or folder in the app only hides it from the Project. Its files
  stay in the OneDrive folder until the owner deletes them there. Removing the whole Project means
  deleting its folder in OneDrive.
- **Link sharing:** a new Project is shared by link so people can join from an invite link. The
  owner can turn the link off or make it view-only in the Projects panel.

Microsoft handles these files under its own terms and privacy policy.

## Optional features that contact other services

These only run when you use them:

- **Digital signatures:** if you turn on trusted time stamps, or check whether a certificate has
  been revoked, your browser contacts the certificate service named in your settings or in the
  certificate (for example DigiCert). It sends a fingerprint of the signature or certificate, not
  the document.
- **Email invitations** to a Live Session or Project are sent by OneDrive when the
  host shares the folder.
- **Help → Send Log Files** saves a file of recent app messages to your device. Nothing is sent
  unless you choose to send that file to someone.

## Local assistant (desktop app)

The desktop app can let GitHub Copilot, Claude, Codex, or Cursor read the open drawing, run commands,
and edit markups. Deletes and document changes wait for Allow in redcolumn. This is off until you
turn it on under File › Preferences › MCP.

- It runs only inside the desktop app on that computer. The listener accepts connections from
  this computer only. The redcolumn project does not receive the drawing, the questions, or the
  replies.
- The client you use sends what you ask to its own vendor, the same as any other local tool you
  connect to it. That includes what the tools return: the markup list, and, when the assistant asks
  to see or read a page, a picture of that page or part of it and its text.
- Turning the assistant off stops the app listening. Quitting the desktop app stops it too.

## Children

redcolumn is a tool for professional drawings and is not directed at children.

## Changes

Changes to this policy are made in this file in the public repository, so its full history is
visible on GitHub. The date at the top shows the latest change.

## Contact

Questions about this policy: open an issue at https://github.com/ColbyGallagher/redcolumn/issues.
