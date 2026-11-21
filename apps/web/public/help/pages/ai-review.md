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

## Optional AI review pass

You can have a second AI check the takeoff before you rely on it. The review pass is **off by default**.

The second AI should check the work in a **fresh context**: a new conversation, or a subagent, that did not make the takeoff. It gets only:

- the document.
- the takeoff output: what was measured, counted and grouped, where it is, and the sources each item cites.

It doesn't get the first pass's reasoning or confidence. That way it checks the work without inheriting the first pass's assumptions. redcolumn never calls a model itself, so your AI client runs the review. It can use the same model or a different one; a strong, different model usually catches more.

On the Takeoff tab:

- **Review pass after each AI takeoff** turns it on for this document. Your AI client is then asked, each time it adds results, to have them reviewed in a fresh context.
- **Request Review Pass** asks for one now. Your AI client sees the request.
- **Copy Reviewer Prompt** copies the reviewer's instructions. Paste them into a new conversation with your AI client.

The reviewer reports findings, labelled **AI review** in their own colour so they are never mistaken for the takeoff:

- on an item, such as *the kerb runs on past the crossing*. The item shows **AI review: N**. Open it to see each finding with its sources, and the reviewer's own quantity where it gave one.
- under **Possibly missed**, for something the takeoff doesn't have, with the page where it is.

Findings are never applied. **Accept Finding** records that you agree, then you fix or reject the item yourself. **Dismiss** records that you don't. Open findings count as waiting, unless the reviewer only agreed with an item.

## Grouping columns

The **Columns** tab lists custom columns the AI proposed, to group the takeoff the way you need: by level, zone, system, trade or material. A grouping column is text or a drop-down, never a number, so it never changes a quantity.

Each column shows:

- its **status**: *Proposed*. It becomes *In review* once you change it, then *Accepted* or *Rejected*.
- how many markups fall in each group.
- the AI's reasoning, and the reason it gave for each markup.

Before accepting a column you can:

- **rename** it, or switch it between drop-down and text.
- **regroup** a markup by typing or picking another group. The AI's value stays beside yours.

**Accept Column** adds the column to the document's [custom columns](#list-columns) and gives each markup its value, as one undo step. If the document already has a column of that name, that column is filled. After that, the column works like any other: you can edit it in the Markups list and group by it.

To remove a decided column:

- **Delete** forgets a rejected one.
- **Forget** removes an accepted column's record but leaves the column in the document.
- **Delete Column** removes it from the document too.

## Grouping tools

The **Tools** tab is the grouping tool library on this computer. A tool is a rule the AI proposed for reuse on later takeoffs, such as *group doors by fire rating*, *group by level from the sheet title* or *tag what is inside a zone*. A tool is never code. Each one is:

- a **filter**: which markups. It can check the type, subject, label, layer, page, or another column's value.
- an **action**: the value each picked markup gets in the tool's column. It can set a fixed value, copy the subject, label, layer, page, sheet or a column, use the name of the zone the markup is in, or map words in the sheet title to a value.

Each tool shows what it does, its rule in words, and why the AI made it.

- A proposed tool cannot run. **Accept Tool** or **Reject** it.
- **Edit** changes its name, description, column or rule. The rule is checked before it is saved.
- **Turn Off** keeps an accepted tool in the library without running it.
- **Delete** removes it. Groupings it already made stay as they are.
- **Run on This Document** proposes a grouping column. It waits on the Columns tab like any other, marked with the tool that made it, and the tool lists where it was used. A tool never changes the drawing or a quantity by itself.

## Who changed what

redcolumn keeps what the AI made beside what you change. An approved row says who approved it and when. If you changed the shape, subject or assembly first, the row is marked **edited** and shows the AI's version. An assembly approved with a different assembly says which one the AI proposed. Approved counts record which proposal placed them.

The list is saved in the document. Everyone in a [Live Session](#sessions) sees and works through the same list.

Back to [Connect an AI client](#mcp).
