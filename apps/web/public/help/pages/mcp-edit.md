# Edit and delete markups

Name a markup by its **id**, or by its **number** (shown in the Markups List), from [List markups](#mcp-list-markups). Each call is one undo step.

## update_markup and update_markups

**Does:** changes a markup's **points**, **text**, or **style** (line colour, fill, line width, opacity, font size). Colours are hex, such as `#ff0000`.

**Returns:** the markup as it now stands. For many, a `failed` list names any that redcolumn then refused.

**Limits:** 500 at a time. Locked markups stay locked, and markups made by someone else may be refused. One bad item changes nothing.

**Model:** a cheaper model is fine when it is given exact values ("make every cloud red"). Use a strong model when it must work out new positions.

## set_markup and set_markups

**Does:** sets a markup's **status**, **comment**, **subject**, or a **custom column** value. Status, comment and subject stay on these tools, not on `update_markup`.

**Returns:** the change, or a `failed` list.

**Limits:**

- 500 at a time.
- The status must already exist on the drawing, such as Accepted or Completed. A bad status changes nothing.
- A calculated (formula) column cannot be set.

**Model:** a cheaper model is fine.

## select_markups

**Does:** selects markups on the drawing on screen, so a later command (align, group, copy) acts on them. An empty list clears the selection.

**Limits:** the drawing has to be on screen.

**Model:** a cheaper model is fine.

## delete_markups

**Does:** deletes markups by id.

**Asks first:** redcolumn shows an **Allow** prompt. After you allow it, the delete is one undo step.

**Limits:** locked markups are refused. Markups made by someone else may be refused. The list of ids has to name markups that exist.

**Model:** a cheaper model is fine once you have said what to delete. Decide that part yourself.

Back to [Connect an AI client](#mcp).
