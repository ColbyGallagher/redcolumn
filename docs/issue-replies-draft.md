# Draft issue replies (not posted)

## #247 (yihshin)

Thanks for the detail — all three are being worked on.

1. **Vertical align:** middle and bottom now centre the visible text rather than the line boxes, and the text no longer jumps to the top while you edit it. PR #254.
2. **Stuck on "Loading page…":** it looks like the PDF renderer stops (for example when it runs out of memory) and never restarts, so every open document waits forever. I'm adding an automatic restart and a "Couldn't draw this page — Retry" message. It would help to know roughly how many PDFs you had open and how big they were, and whether the OneDrive files were "online-only" (cloud icon) when you opened them. If you can find it, the log file from the desktop app around the time it happened would help too.
3. **Markups coming back without saving:** found it. With Document Recovery on (the default), "Don't Save" kept your markups on this computer, and because files are recognised by their contents, opening the same file again (even a fresh copy from email) brought them back. "Don't Save" now always discards, and recovered markups after a crash ask Keep / Discard instead of appearing silently. PR #253.

## #244 (YD-QS)

Thank you for the detailed write-up — it's exactly what I needed. I've broken it into tasks and work has started:

- Space / right-click / double-click to finish (item 3): PR #255. Right-click finishing is a preference, off by default.
- Thumbnails no longer open on every file, and the panel layout is remembered (item 10): PR #256.
- Search → Apply Count to Checked, using your Tool Chest count tools (item 9): PR #257.
- Separate X/Y scale (item 1): in progress. Calibrating was replacing the whole scale and silently dropping a separate Y; that is being fixed along with the live readouts and PDF export.
- Next: crossing selection (2), count on first click (5), drag-a-rectangle area (6), Resume (4), properties on selection and Subject/Label/Layer for active tools (7/8), then arcs inside measurements (11).

For the X/Y scale bug: could you attach (or describe) a page where you saw it — in particular whether the page is rotated, and whether you saw the wrong value while drawing, in the Markups List, or after reopening the file?

Several of the "suggested additions" already exist: Markups List with export, area cutouts, snapping, viewports with their own scales, locking, legends and customisable shortcuts. If any of them don't behave the way you'd expect, let me know.

## #243 (CadmasterAdam)

The app doesn't install an Outlook/Explorer preview handler, so the preview pane is drawn by whichever PDF previewer is registered on your PC (often Edge or another PDF app). Could you tell me which one it is? It's usually named at the top of the preview pane. If that's another app's previewer, the centring issue is on their side. A redcolumn previewer is possible but a large job, so it's not planned right now.

## #251

(Closes automatically when PR #252 merges — no reply needed.)

## #244 follow-up (not posted)

Two more things that would help:

- **Count starting on the first click (item 5):** in my testing the first click already counts as #1, and the total label sits on the first symbol. Could you list the steps where you see a caption placed first? In particular, does it happen with a count tool from your Tool Chest, or with the built-in Count tool?
- **Arcs (item 11):** you can already curve a segment after drawing it: hold Alt and drag the small knob in the middle of the segment. Ctrl+drag while placing points, Ctrl+click to smooth a corner and Shift+click to add or remove points are coming next, matching the keys you described.
