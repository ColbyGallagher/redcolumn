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

### Protected or open

- **Protected** (the default): only the columns to fill in can be changed. This stops a column being deleted or overtyped by accident. The designer can filter the sheet but not sort it, because Excel does not sort a protected sheet.
- **Open**: nothing is locked, so the sheet can be sorted.

> **Note:** Protection is not security. The password is written on the workbook's **Read me** sheet, so anyone who needs to sort or restructure the sheet can unprotect it on purpose.

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
