# Comment registers

A comment register is the list of review comments as a spreadsheet, in the layout a client asks for: their column headings, one row per comment, a column for the designer's response, and their words for the statuses.

redcolumn exports the register, the designer fills it in with Excel, and you import the filled-in workbook. Responses become replies on the markups, and statuses are updated. Nothing is sent anywhere: the workbook is a file you email.

This works in the web version and the desktop app.

## Make a template for the client

A template says what the client's register looks like. You make it once per client.

1. Choose {{File > Export > Register Templates…}}.
2. Click **New**. You get the usual register columns to start from.
3. Type a **Name**, and choose the **Client** (a drawing standard) if you have set one up. Documents read with that standard start on this template.
4. Set up the **Columns**: the client's **Heading**, and what each column **Holds**.
   - A column of the Markups list, such as **ID**, **Page Label**, **Comments**, **Status** or **Author**.
   - **Reply 1 (text)**, **Reply 2 (text)**…: the first, second… reply on the markup. Use these for *Designer Response* and *Reviewer Close-out*.
   - **Reply 1 (who wrote it)**…: the name beside a response.
5. Set the **Status wording**: the client's word for each status, which statuses count as **Closed**, and other words to read as that status.
6. Under **Above the table**, add the cells of the title block: fixed text, or a detail (document name, project, revision, date, reviewer) that you fill in at each export.
7. Set the **Header row** and **First column** to where the client's table starts.
8. Click **Save Template**.

> **Tip:** **Save as File…** saves the template to share with your team. They use **Open File…** to add it.

### Pictures and links

- **Thumbnail**: add a column that **Holds** *Thumbnail (picture of the markup)*. Each row then shows its markup with the drawing around it, so the designer can see where the comment is without opening the drawing.
- **Link each item number to its comment**: clicking an item number in Excel opens the document at that comment.

> **Note:** A link opens the comment on a computer that has the document in redcolumn. Documents are kept on your device, so the links are for you and your team, not for someone who only has the workbook. A workbook exported from the desktop app opens the desktop app; one exported from the web version opens the web version.

Pictures make a workbook large to email. With more than 200 rows they are left out unless you tick **Include thumbnails** at export, and a register of more than 2000 rows cannot have them.

### Protected or open

- **Protected** (the default): only the columns to fill in can be changed. This stops a column being deleted or overtyped by accident. The designer can filter the sheet but not sort it, because Excel does not sort a protected sheet.
- **Open**: nothing is locked, so the sheet can be sorted.

> **Note:** Protection is not security. The password is written on the workbook's **Read me** sheet, so anyone who needs to sort or restructure the sheet can unprotect it on purpose.

## Use the client's own file

Many clients require their own register file. In the Windows desktop app, with Excel installed, the export can fill in a copy of that file instead of making a workbook that looks like it. The copy keeps the file's title block, logos, merged headings and styles.

1. Choose {{File > Export > Register Templates…}} and open the client's template.
2. Beside **Client's file**, click **Choose…** and pick the client's blank register (.xlsx).
3. Make the template match the file:
   - **Sheet name**: the sheet the register is on. A file with one sheet needs no name.
   - **Header row** and **First column**: where the file's table starts. For a heading over two rows, use the lower row.
   - **Columns**: one for each column of the file's table, in the file's order, with the file's **Heading**. For a column redcolumn has nothing for, choose **Nothing: left blank**. Its cells stay as the file has them.
4. redcolumn checks the headings against the file and says which do not match. Click **Save Template**.

At each export, choose **A copy of the client's file** as the **Workbook**, and choose where to save the copy. The client's blank file is never changed.

What goes into the copy:

- One row per comment under the header. When the file has something under its table, such as a sign-off block or a total, rows are inserted above it, so it moves down and is not written over.
- The details you mapped above the table, such as the document name. Fixed text cells in the template are not written: the file has its own.
- A hidden column beside the table and a hidden sheet, which tie each row to its comment.
- A dropdown on **Status** and the other columns that have set values, unless the file already has its own dropdown there.
- A link on each item number, when the template links them. Thumbnails are not put into a client's file.

> **Note:** The copy is not protected and has no **Read me** sheet. It is the client's file, so its own protection and sheets are left as they are. If the client's sheet is protected, unprotect it in Excel and save it before you export.

> **Tip:** Start from the client's blank file. Rows that are already in the file under the header are kept, and the comments are inserted above them.

The filled-in file is imported like any other register.

## Export a register

1. Choose {{File > Export > Comment Register…}}.
2. Choose the **Template**.
3. Choose the **Rows**: markups with a comment, or every markup.
4. Check the details that go above the table.
5. Click **Export**.

The workbook has three sheets: the register, a **Read me** that tells the designer which columns to fill in, and a hidden sheet that ties each row to its comment.

## Import the filled-in register

1. Open the same document.
2. Choose {{File > Import > Markups from Excel…}} and pick the workbook.
3. Check the preview and click **Apply**. See [Edit the list in Excel and bring it back](#list-excel) for what the preview shows.

What comes back:

- Text typed in a blank response column is added as a **reply**. If the row has a name in its *who wrote it* column, the reply is from that person; otherwise it is from the name you give in the preview.
- A changed **Status** is set on the markup, read through the template's wording.
- A response that was already there and has been rewritten is listed, but unticked.

A status word the template does not know is listed as an unknown value. Choose **Map to** to say which status it means: the answer is saved in the template, so it is not asked again.

> **Tip:** If the client's document controller copies the rows into their own workbook, the hidden column and sheet are lost. The import still works on a computer that has the template: it recognises the headings, and finds the rows by their item number.

> **Warning:** Rows added in Excel are not imported, and deleting a row does not delete its comment.
