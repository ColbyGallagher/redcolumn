# Privacy policy

_Last updated: 3 October 2026_

redcolumn is a free, open-source PDF markup and takeoff app that runs in your web browser. This
policy explains what happens to your documents and information when you use it. It applies to the
app published from this repository (for example at `colbygallagher.github.io/redcolumn`). If
someone else runs their own copy, their policy applies to it.

## The short version

- **Your PDFs stay on your device.** Opening, marking up, measuring and saving documents happens
  entirely in your browser. The redcolumn project never receives your documents or markups.
- **There is no redcolumn server, no account and no tracking.** The app has no analytics,
  advertising, cookies of its own or error reporting.
- **Live Sessions use your own Google Drive or OneDrive.** When you share documents with others,
  they go to Google or Microsoft under your account, not to us.

## What stays on your device

The app keeps these in your browser's storage, on your device only:

- documents you open or save to the library, with their markups, measurements and revisions;
- your settings, profiles, tool sets, signatures and stamps;
- a list of Live Sessions you have started or joined;
- the app itself and its OCR language data, so it works offline.

Clearing your browser's site data for redcolumn deletes all of it. Nobody else can see it,
including us.

## Loading the app

The app is served by GitHub Pages (and preview copies by Vercel). Like any website host, they
receive standard request information when your browser loads the app, such as your IP address,
browser type and the pages requested, and handle it under their own privacy policies
([GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement),
[Vercel](https://vercel.com/legal/privacy-policy)). We do not receive or use this information.

## Live Sessions (Google Drive and OneDrive)

Live Sessions let several people mark up the same PDFs. They are optional and only start when you
sign in to Google or Microsoft.

- **Where the files go:** the session's PDFs, markups, chat and activity record are saved in a
  folder in the host's Google Drive or OneDrive, and shared with the people the host invites.
  Your browser talks to Google or Microsoft directly.
- **Sign-in:** you sign in with Google or Microsoft in a pop-up from them. The app receives
  permission to use your Drive or OneDrive, and your name and email, so others in the session
  can see who made each markup. These sign-in details stay in your browser and are never sent to
  us.
- **Google Drive access:** the app asks for the narrowest Drive permission Google offers
  (`drive.file`). It can only open files and folders the app created or that you choose in
  Google's file picker. It cannot see the rest of your Drive.
- **OneDrive access:** the app first asks only for its own folder in your OneDrive
  (`Apps/redcolumn`). Microsoft requires broader access to share that folder, and to let people
  open a session folder in someone else's OneDrive, so the app asks for more only when Microsoft
  refuses the smaller permission. Even then, it only reads and writes the session folders.
- **What other attendees see:** your name or email, your markups, chat messages, and which page
  you are viewing while you are in the session.
- **Removing it:** delete the session folder in your Google Drive or OneDrive. You can withdraw the
  app's access at any time from your Google Account (Security → Third-party apps) or Microsoft
  account (Privacy → Apps and services).

Google and Microsoft handle these files under their own terms and privacy policies.

## Optional features that contact other services

These only run when you use them:

- **Digital signatures:** if you turn on trusted time stamps, or check whether a certificate has
  been revoked, your browser contacts the certificate service named in your settings or in the
  certificate (for example DigiCert). It sends a fingerprint of the signature or certificate, not
  the document.
- **Email invitations** to a Live Session are sent by Google Drive or OneDrive when the host shares
  the session folder.
- **Help → Send Log Files** saves a file of recent app messages to your device. Nothing is sent
  unless you choose to send that file to someone.

## Children

redcolumn is a tool for professional drawings and is not directed at children.

## Changes

Changes to this policy are made in this file in the public repository, so its full history is
visible on GitHub. The date at the top shows the latest change.

## Contact

Questions about this policy: open an issue at https://github.com/ColbyGallagher/redcolumn/issues.
