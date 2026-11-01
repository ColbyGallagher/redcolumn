# Drawing standards

A client's drawings always look the same: the same title block, and the same way of numbering sheets. A **drawing standard** writes that down once. Pick it for any set from that client, and redcolumn reads the sheet numbers, titles and revisions from the places you showed it instead of guessing. Pages the standard does not fit, such as a cover or another consultant's sheets, are still read the usual way.

Standards are kept with your [profile](#profiles) and can be shared as files.

## Make a standard

1. Open a set from the client and choose {{Document > Drawing Standards…}}.
2. Type a **Name**, such as the client or consultant.
3. Click **+ Draw box** and drag a box around the **sheet number** in the title block. Draw more boxes for the sheet title, the revision and the scale. Choose what each box holds from the list beside it.
   - Use **Ignore (other number)** for a number that is *not* the sheet's, such as a drawing-file or contract number printed beside it.
4. Under **Drawing numbers**, give the **Template** the client uses, or click **Work out from this set**:

   | In the template | Means |
   |---|---|
   | `#` | a digit |
   | `@` | a letter |
   | `?` | a digit or a letter |
   | `*` | any run of digits and letters |
   | anything else | itself |

   For example `HLD1BDD-WSPAU-####-@@-DRG-######`. With a template, only numbers built that way are taken as sheet numbers.
5. Choose which part of the number names the **Discipline**, and type a name for each code (`BR` is *Bridges*). Leave it on **Letters at the start** for US-style numbers such as *C-101*.
6. Check the preview: *Sheet number read on 194 of 197 pages*, and which pages were not read.
7. Click **Save and use**.

Boxes are kept as a share of the page, so a half-size print of the same sheets reads from the same place.

## Use a standard on a set

Open the set, choose {{Document > Drawing Standards…}} and pick the standard under **This document**. The sheets are read again straight away and their links are found again.

- Sheet numbers you typed yourself are never replaced.
- Choose **None** to go back to reading the set from its text alone.
- If you change a standard, sets that use it are read again the next time you open them.

## Share a standard

Click **Export…** to save the standard as a `.rcstandard` file, and send it to your team. They click **Import…** to add it. Importing a standard you already have updates it.

---

*Drawing standards build on Miche-pup's work on agency title blocks and link kinds.*
