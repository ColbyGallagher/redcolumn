# Drawing standards

A client's drawings always look the same: the same title block, and the same way of numbering sheets. A **drawing standard** writes that down once. Pick it for any set from that client, and redcolumn reads the sheet numbers, titles and revisions from the places you showed it instead of guessing. Pages the standard does not fit, such as a cover or another consultant's sheets, are still read the usual way.

Standards are kept with your [profile](#profiles) and can be shared as files.

## Make a standard

1. Open a set from the client and choose {{Document > Drawing Standards…}}.
2. Type a **Name**, such as the client or consultant.
3. Click **+ Draw box** and drag a box around the **sheet number** in the title block. Draw more boxes for the sheet title, the revision and the scale. Choose what each box holds from the list beside it.
   - Use **Ignore (other number)** for a number that is *not* the sheet's, such as a drawing-file or contract number printed beside it.

   ![Boxes on the title block and the Drawing Standards panel](img/drawing-standard.png)
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

## Sheet links and marks

Open **Sheet links and marks** to tell redcolumn how this client's drawings point at each other. A standard does not need title-block boxes to use these.

![Sheet links and marks](img/drawing-standard-links.png)

| Setting | Use it when |
|---|---|
| **Callouts cite** | Callout bubbles show only part of the drawing number, such as *300082* for *HLD1BDD-WSPAU-0508-BR-DRG-300082*. Pick that part. |
| **Identifiers** | The client labels details and sections in an unusual way, such as *DT3*. Type the forms with `#` for a digit and `@` for a letter: `@@#`. Separate several with commas. |
| **Section, Elevation and Enlarged plan titles** | The client's titles use other words, such as *SECT* or *CROSS SECTION*. The [Links tab](#links) shows each link's kind. |
| **Match lines** | Match lines are written another way, such as *CONTINUED ON*. |

**Marks** lists the section marks, titles and detail callouts taught for this client. Use the standard for the document, then click **Teach a mark…** and box an example. When the document uses a standard, the Teach a mark dialog asks whether to look for the mark in **sets read with** that standard or in **every set**. Marks kept with a standard are only looked for in that client's sets, so they can't cause wrong links in other sets.

If you already taught marks for every set, **Move *n* marks for every set here** gives them to this standard.

## Alignments and chainage

On roads, rail and pipelines, drawings refer to places by **chainage** (station): *12+00*, *1+250.000* or *CH 1250*. redcolumn links each chainage to the **cross section** drawn at it, or else to the **plan sheet** that covers it. On a plan, a chainage with a cross section links to that cross section.

Under **Alignments and chainage**:

| Setting | What to type |
|---|---|
| **Alignment names** | The names the drawings print, such as `MC01, RAMP A`. Each chainage belongs to the alignment named on its row or close by, so a ramp's 12+00 never links to the mainline's. Leave it empty for a single alignment. |
| **Written before a chainage** | The prefixes the client uses, such as `STA, CH`. |
| **Plan sheet titles** | Words in the titles of the sheets that cover a stretch, such as `PLAN AND LONGITUDINAL SECTION`. |
| **Cross-section sheet titles** | Words in the titles of cross-section sheets, such as `CROSS SECTIONS`. |

Each plan covers the run of chainages printed on it. A chainage written somewhere else on the sheet, far from that run, does not stretch it.

Without a drawing standard, redcolumn still looks for chainages on sheets titled *Plan and Profile* and *Cross Sections*, but the links wait under **Needs review** in the [Links tab](#links).

## Use a standard on a set

Open the set, choose {{Document > Drawing Standards…}} and pick the standard under **This document**. The sheets are read again straight away and their links are found again.

- Sheet numbers you typed yourself are never replaced.
- Choose **None** to go back to reading the set from its text alone.
- If you change a standard, sets that use it are read again the next time you open them.

## Offered when a set opens

When you open a set that isn't read with a standard, redcolumn checks your saved standards against it. If one fits most of the sheets it checks, a bar at the top offers it:

![A drawing standard offered for a set](img/drawing-standard-offer.png)

- **Use *name*** reads the set with it.
- **Not this set** stops it being offered for this set. Choosing **None** for a set does the same.

A standard is only offered when it can tell its client's sets apart. That means it either has a drawing-number **Template**, or **Words on this client's sheets** such as the client's name or a project code.

## Use a standard for a whole Project

If you own a [Project](#projects), open one of its files, then choose {{Document > Drawing Standards…}} and click **Use *name* for the Project**. Everyone who opens a file from the Project gets the standard added to their profile, and its files are read with it. Click **Stop** to remove it from the Project.

## Share a standard

Click **Export…** to save the standard as a `.rcstandard` file, and send it to your team. They click **Import…** to add it. Importing a standard you already have updates it.

---

*Drawing standards build on Miche-pup's work on agency title blocks and link kinds.*
