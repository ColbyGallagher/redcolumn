# Make your own stamps

## Open the stamp library

Choose {{Tools > Stamp > Manage Stamps…}}.

![The Stamps window](img/stamps-dialog.png)

From here you can click a stamp and click **Place** to use it.

## Make a new stamp

1. Click **New…**.
2. Type a **Name** for the stamp (shown in the Stamp menu).
3. Type the **Wording**. The first line is the big headline. Lines after it are smaller.
4. To add something that fills itself in, click where it should go in the wording, then click a button underneath:

   | Button | Fills in |
   |---|---|
   | **Your name** | `{User}` – your author name |
   | **Date** | `{Date}` – the date it is placed |
   | **Time** | `{Time}` – the time it is placed |
   | **File name** | `{File}` – the PDF's name |
   | **Page or sheet number** | `{Page}` – e.g. A-101 |
   | **File location** | `{Path}` – where the PDF is |
   | **Day of the month**, **Month number**, **Year** | `{dd}`, `{mm}`, `{yyyy}` – e.g. 05/10/2026 |

5. Pick a **Colour** and a **Frame** (Rounded, Square or None).
6. Check the preview at the bottom, then click **Save Stamp**.

   ![Making a new CHECKED stamp](img/stamps-new.png)

Your stamp now appears in {{Tools > Stamp}}.

## Add fields to fill in

A stamp can ask for values when you place it, such as **Checked by** or **Status**. In the stamp editor, under **Fields**:

| Button | Adds |
|---|---|
| **Add Text Field** | A blank to type in. Give it a name (shown as the question). **Starts as** is its default value, and can hold `{User}`, `{Date}` and the other fields above. To pick from a list instead of typing, put one choice per line in **Pick from**; tick **Other text can be typed too** to suggest the choices but allow any text. A field cannot be named like one of the fields above (Date, User and so on), or like another field. |
| **Add Tick Boxes** | A list of boxes, one of which can be ticked. Ticking a box can recolour the stamp and fill in other fields. |

A field is listed under the wording as *Name: value*. To put it somewhere in the wording instead, click **In wording**: this adds `{Name}` (for example `Status: {Status}`). Renaming a field renames it in the wording too, and removing one takes it out of the wording. Use **↑** and **↓** to change the order fields are listed and asked for, and **✕** to remove one.

When you place the stamp, one small window asks for the values, with a preview. To change them later, double-click the stamp, or use **Stamp Fields** in the [Properties](#properties) panel. `{User}`, `{Date}` and the like keep what they were when the stamp was placed.

### Fields on a picture stamp

On a stamp that is a picture (imported, see below), each text sits where you put it:

- **Add Text** adds a text. Type its words, and set its size (as a percentage of the stamp's height), colour, alignment and bold.
- **Add Text Field** adds a field and a text that shows it (`{Name}`).
- Drag a text's dashed box in the preview to move it. Or click the box and use the arrow keys (hold **Shift** for bigger steps).

### What other PDF viewers see

A placed stamp is one stamp annotation. Its fields are not PDF form fields: the values are drawn into the stamp, so other PDF viewers show it as filled in, and its text is in its comment. Only this app can fill the fields in again.

## Import stamps from Bluebeam® Revu®

Revu keeps its stamps as PDF files in its Stamps folder.

1. Click **Import…** in the Stamps window.
2. Pick one or more stamp PDFs and click **Open**.

A stamp that is only text arrives as an ordinary stamp you can change. Revu's `&[Date]`, `&[Time]`, `&[File]`, `&[Path]`, `&[dd]`, `&[mm]` and `&[yyyy]` become the fields above. A stamp with artwork (a seal, a tag, a box) arrives as a picture with its text over it. You can change that text, but not the picture. Importing a stamp again replaces the one of the same name.

Stamp PDFs with form fields (dynamic stamps from other PDF tools) come in with their fields, each in its place:

- A text field whose script fills in the user's name, the date or time, or the file name becomes `{User}`, `{Date}`, `{Time}` or `{File}`.
- A text field that asks a question when the stamp is placed becomes a field with that question as its name (and its default value, if it has one).
- Any other text field, and a list (drop-down), becomes a field to fill in: a list keeps its choices (a list you can type in stays one). A field whose name is one of the fields above, such as Date, is renamed (Date 2) so it keeps its own value.

Not brought across: scripts that do anything else (they are never run; the field is a blank to fill in instead), tick boxes and buttons (they stay part of the picture), hidden fields (left out), and the pages after the first of a stamp file that holds several stamps.

## Change or delete a stamp

- To change one of **your** stamps, click it, then click **Copy and Edit…** (or edit it directly).
- To base a new stamp on a built-in one, click the built-in stamp and click **Copy and Edit…**.
- To delete one of your stamps, click it and click **Delete**. Built-in stamps cannot be deleted.

> **Note:** Your stamps are saved in your [profile](#profiles) on this device.
