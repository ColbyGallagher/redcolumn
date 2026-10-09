# Columns and custom columns

## Show or hide columns

Click **Columns ▾** on the list's toolbar and tick the columns to show.

![The Columns menu](img/list-columns-menu.png)

Built-in columns include ID, Subject, Page, Page Label, Space, Measurement, Length, Area, Volume, Wall Area, Depth, Slope, Author, Date, Status, Checkmark, Comments, Type, Colour and Capture.

**Reset Column Layout** puts the columns back to how they started.

## Add your own columns

Custom columns let you track anything: trade, cost code, due date, who is responsible.

1. Click **Manage Columns…** (or {{Tools > Markups List > Columns & Statuses…}}).

   ![The Markup Columns & Statuses window](img/columns-dialog.png)
2. Under **Add column**, click the kind of column:

   | Kind | For |
   |---|---|
   | **Text** | a single line of text |
   | **Multiline text** | longer notes |
   | **Dropdown** | picking one value from a list you write |
   | **Number** | numbers, with decimal places |
   | **Date** | a date |
   | **Checkmark** | a tick box |
   | **Calculation** | a value worked out from other columns, e.g. `[Quantity] * [Unit Cost]` |

   ![A new column added](img/columns-dialog-add.png)
3. Give it a **Name**, and fill in its settings (dropdown choices, decimal places, a default value).
4. Tick **Required** if every markup must have a value. The list warns you about markups missing one.
5. Click **Save**.

Fill in the new column by clicking its cells in the list, or in the [Properties panel](#properties) under **Custom Columns**.

> **Tip:** Click **+ Punch list columns** to add Location, Trade, Due date, Assigned to and a Done tick, plus punch-list statuses, in one click.

## Use the same columns every time

- **Set as profile default** — new documents start with these columns and statuses.
- **Export XML / Import XML…** — share your columns with colleagues.
