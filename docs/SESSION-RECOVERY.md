# Session save safety and recovery

The Sessions panel distinguishes saving on this device, locally saved updates waiting
to sync, and no pending writes. A shared-folder write is not a delivery receipt from
other reviewers: delivery still depends on the sync client or file server.

## Pending updates

The additive `redcolumn-session-pending` IndexedDB database stores unacknowledged Yjs
updates per backend, Session folder and participant seat. It supplements existing
document-markup persistence and does not change existing document IDs or storage.
Chat and Record updates are included. Writes are serialized atomic transactions;
transaction completion is the local save receipt. Uploads wait for that receipt and
remove only acknowledged operations. Encrypted Sessions seal pending bytes with the
Session key before local storage.

Rejoining the same profile and seat restores pending operations before polling or
timers start. Original Yjs and Record IDs make replay idempotent after an interrupted
upload acknowledgement. Unreadable data or missing keys stop recovery without clearing
the journal. Normal destruction holds the seat lock until outstanding writes settle.

Desktop close waits for local Session saves; a failure keeps the window open. Browser
leave/reload prompts cover local saves still in progress or failed. Changes already
saved locally may wait for a later rejoin. A save still in progress is not guaranteed
to survive immediate process or power loss. Deleting the profile removes local copies.
Rejoining still needs the shared Session manifest; this does not add offline startup.

## Closeout

Before exporting, the host refreshes the Session and confirms its own pending writes.
Every selected archive save is awaited. Cancellation, failure or an unsupported save
API stops closeout and retains the Session. Starting a browser download cannot confirm
successful saving; those browsers need desktop or a supported Project/OneDrive target.
Partly written archive copies may remain after a failed attempt.

The host refreshes again before returning markups to the library. Observed room or
document changes during archive saving require a fresh archive. Ending confirms final
host writes before removing shared files. This is not a distributed freeze: an offline
reviewer's pending changes or another device's sync queue cannot be detected here.
The end dialog asks everyone to finish syncing first.

## Validation

Unit tests exercise save cancellation/failure, encrypted and unencrypted recovery,
replay after upload, storage failure, failed recovery and concurrent edits during upload.
The desktop `session-review.spec.ts` uses generated PDF fixtures, two temporary profiles
and a temporary shared folder. It blocks uploads, terminates a reviewer after a local
save receipt, rejoins and checks markup/chat recovery without duplicates. It also checks
cancelled/failed saves and changes during closeout, then reopens the successful archive.
This does not validate transport through OneDrive or a cross-company network share.
