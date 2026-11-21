# Review AI takeoff

When an AI client takes off quantities through the [local MCP server](#mcp), nothing it makes counts until you check it. {{Tools > Takeoff > Review AI Takeoff…}} lists everything it made, so you can check each item against the drawing and approve, edit or reject it. The list opens by itself when something new arrives.

redcolumn never calls an AI model itself. The AI runs in your own client.

## What is in the list

The list holds three kinds of result:

- **Drawn:** a measurement the AI drew, such as a kerb length or a pavement area. Until you approve it, it is an **AI draft**: it is drawn dashed on the sheet and left out of quantities, reports and the Takeoff tab's totals. A saved PDF keeps it hidden, so other PDF viewers don't show it.
- **Assembly:** an [assembly](#assemblies) the AI proposed for a measurement, with the quantities it expects.
- **Count:** repeats of a symbol the AI found ([AI auto count](#ai-auto-count)).

Each row shows:

- the AI's **confidence**. Results below the threshold are flagged ⚑. So are results where the AI didn't give a confidence. Waiting items come first, least sure first. Change the threshold with **Flag below … % confidence**.
- what it is, and its page.
- the quantity: the measurement, or how many matches are ticked.
- its state: **Waiting**, **Approved** or **Rejected**.

Click a row to open it on the sheet and see its details:

- **Sources:** where the AI read it, such as a legend entry, a schedule row or a note. Click a source to see it on the drawing. A row with no source says so: check it against the drawing yourself.
- **Reasoning:** why the AI says it is what it says.
- For a drawn measurement: its subject and assembly, which you can change, and **Edit Shape** to select it on the sheet and reshape it.
- For an assembly: another assembly, or quantities set by hand. The **AI expected** column shows the AI's own figures. ⚠ marks any that differ from what redcolumn works out.
- For a count: each match, to look at and to untick before approving.

## Approve, edit and reject

- **Approve** one row, or tick rows and press **Approve Selected**. **Approve … at …%+** approves every waiting result at or above the threshold.
- **Reject** takes a drawn measurement off the sheet. It stays in the list as rejected, so **Review Again** puts it back. Rejecting an assembly or count proposal leaves the drawing as it is.
- Every approval and rejection is one undo step.
- **Clear Decided** (with **All, with decisions** shown) forgets rejected drafts and decided proposals.

Keys, while the list has focus:

- **A** approve
- **R** reject
- **E** edit
- **N** or **↓** next
- **P** or **↑** previous
- **Esc** close

## Who changed what

redcolumn keeps what the AI made beside what you change. An approved row says who approved it and when. If you changed the shape, subject or assembly first, the row is marked **edited** and shows the AI's version. An assembly approved with a different assembly says which one the AI proposed. Approved counts record which proposal placed them.

The list is saved in the document. Everyone in a [Live Session](#sessions) sees and works through the same list.

Back to [Connect an AI client](#mcp).
