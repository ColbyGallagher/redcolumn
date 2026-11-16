# Close out comments

Close-out shows what is still open on each sheet, and carries the open comments to the next revision.

A comment is a markup that says something: it has a comment, its own text, or a reply.

## Open and closed

A comment is **closed** when its status is one that closes it. Without a register template, those are **Accepted**, **Completed** and **Cancelled**. A comment with no status is open, and so is one that is **Rejected**.

A client's [register template](#comment-register) can say otherwise: under **Status wording**, tick **Closed** for the statuses that close a comment for that client. Documents read with that client's drawing standard use it.

## See what is open on each sheet

1. Choose {{Document > Close-out…}}.
2. The table has one row per sheet: its number and title, its revision now, and how many comments are open and closed.
3. Click a sheet to list its comments. Each shows its status and the revision it was raised at.
4. Click a comment to go to it on its sheet.

- **Show** switches between sheets with open comments and every sheet with comments.
- **Closed means** chooses whose closed statuses to count by: the usual ones, or a register template's.
- **Export CSV** saves the list as it is shown.

## The revision a comment was raised at

redcolumn records the revision of the sheet a comment was raised on. It is recorded once, the first time either of these happens:

- the comment is exported to a [comment register](#comment-register);
- its sheet is replaced with [Slip Sheet](#slip-sheet).

It is saved with the markup, and shows in the Markups list in the **Raised at Revision** column. A register template can have a column for it. It is not recorded for a sheet whose revision was not found: check the sheet's details in the Sheets panel first.

## Carry open comments to the next revision

1. Choose {{Document > Slip Sheet…}} and add the new revisions, as in [Slip sheet a new revision](#slip-sheet).
2. Tick **Leave closed comments behind**.
3. Click **Slip Sheet**.

Open comments stay on their sheets, as before. Closed comments on the replaced sheets are removed from the new revision. Markups that are not comments stay.

The set as it was is kept under {{Document > Revisions…}}, with its markups written into it, so the closed comments can still be read there. Registers you exported earlier have them too.

> **Note:** Sheets that are not replaced keep all their comments, closed or not.

> **Warning:** In a Live Session you may only remove your own markups, unless you were given the right to edit anyone's. Closed comments by other people stay.
