# Drawing standards

A client's drawings always look the same: the same title block, the same way of numbering sheets, the same callout bubbles. A **drawing standard** writes that down once. Pick it for any set from that client, and redcolumn reads the sheet numbers, titles and revisions from the places you showed it, and finds the links between sheets the way that client draws them. Pages the standard does not fit, such as a cover or another consultant's sheets, are still read the usual way.

Standards are kept with your [profile](#profiles) and can be shared as files.

## Set up a standard

1. Open a set from the client and choose {{Document > Set Up Drawing Standard…}}, or click **Set Up Standard** on the ribbon's Document tab.
2. The setup opens in its own window: the steps on the left, the sheet on the right. Type a name, such as the client or consultant, and click **Start**.
3. Work through the steps along the top. Each asks for one thing at a time, checks it on every sheet of the set, and says how well it went. Everything is saved as you go: close the setup and open it again to carry on.

![The setup: the drawing number boxed, and read on every sheet](img/drawing-standard-setup.png)

On the sheet, drag to draw a box. Scroll to zoom, and drag with the middle button to move around. Use the page strip, the thumbnails or **‹ ›** below to go to another sheet. **Re-draw box** draws the answer again.

> **Tip:** If your browser blocks the setup's window, it opens over redcolumn instead.

## 1. Title block

One field at a time: the **drawing number** first, then the **revision**, **title**, **scale**, **sheet size** (*A1*, *ANSI D*) and, if the title block has them, **project**, **status** and **date**. Box each one on the title block. The step shows what the box reads on this sheet and on others, and marks in the thumbnails the sheets where it reads nothing. **Skip** a field the title block does not have.

Then:

- **Your own fields**: anything else you want read from every sheet, such as *Package* or *Drawn by*. Type its name, click **Draw its box**, and box it. Each sheet's value becomes a tag of the sheet in [Sets](#sets).
- **Other numbers**: box any number that is *not* the sheet's but looks like one, such as a contract number. It is never taken for the sheet number.
- **Drawing numbers**: the **template** the client numbers sheets with. The setup suggests one from the numbers it read; click **Use** to take it.

  | In the template | Means |
  |---|---|
  | `#` | a digit |
  | `@` | a letter |
  | `?` | a digit or a letter |
  | `*` | any run of digits and letters |
  | anything else | itself |

  For example `KRU2-MCC-0412-RW-DRG-######`. With a template, only numbers built that way are taken as sheet numbers. Then choose which part of the number names the **discipline**, and type a name for each code.

Boxes are kept as a share of the page, so a half-size print of the same sheets reads from the same place.

## 2–4. Sections, elevations and details

Each of these steps teaches one kind of link with one example:

1. Find a mark on a plan, such as a section mark, and box its bubble: the letter and the sheet number it points to.

   ![Boxing a section mark](gif/standards-section-mark.gif)
2. Click **Next**. The setup goes to the sheet the mark names. Box the section's bubble and title there (*SECTION A-A*).

   ![Boxing the section's title](gif/standards-section-title.gif)
3. Click **Find the rest**. redcolumn learns from the pair (which part of the drawing number callouts cite, how letters are written, the words in front of titles), keeps both marks in the standard, and finds every mark like them in the set, by their text and by their shape.

The results show a **meter** and a few links to check. Click a picture to see it on the sheet, then **Right** or **Wrong**. Your answers set the meter, and they are kept on those links when you read the document with the standard.

| The meter says | Means |
|---|---|
| **Good** | Keep the links as they are. |
| **Usable** | Keep them, and look over the ones waiting under **Needs review** in the [Links tab](#links). |
| **Poor: recommend AI** | Text and shape search found too few, or too many were wrong. See **Finish with AI** below. |

**Found, but not read** lists marks that look right by their shape but have no text to read (outlined lettering, a scanned sheet). Click one to see it.

**Teach another example** adds a second pair, such as a bubble drawn another way. **This set has none** skips the step.

Marks kept with a standard are only looked for in that client's sets, so they can't cause wrong links in other sets.

## 5. Match lines

1. Box a match-line label on a plan: its words and the drawing it names (*MATCH LINE CH 280.000 / ADJOINS DRG …*).

   ![Boxing a match-line label](gif/standards-matchline-first.gif)
2. Click **Next**, and box the matching label on the adjoining sheet.

   ![Boxing the matching label](gif/standards-matchline-second.gif)
3. Click **Find the rest**. If the client labels match lines another way (*JOIN LINE*), the standard learns the words.

**Use these to stitch the plans** joins the plans along their match lines, as in [Stitching](#stitch).

## 6. Chainages

On roads, rail and pipelines, drawings refer to places by **chainage** (station): *12+00*, *1+250.000* or *CH 1250*. A chainage links to the **cross section** drawn at it, or else to the **plan sheet** that covers it. Many alignments share the same chainages, so redcolumn needs to know which alignment each one is on. Four boxes show it:

| Box | Where |
|---|---|
| ![](gif/standards-chainage-plan-chainage.gif) | A chainage on a plan: a tick label (*100*) or a written one (*CH 100*). |
| ![](gif/standards-chainage-plan-alignment.gif) | The name of the alignment it is on, on the same plan (*MC00*). |
| ![](gif/standards-chainage-section-alignment.gif) | On a cross-section sheet of that alignment, where it names it: in the title, or beside a section. **Next** takes you to one. |
| ![](gif/standards-chainage-section-chainage.gif) | On that sheet, one section's chainage with the word in front of it (*CHAINAGE 0*). |

redcolumn learns how chainages are written, the alignment's name and the form the client's names take (*MC00* means *MC01* and *MC02* are alignments too), which sheets are plans and which are cross sections, and where cross sections say their alignment. Then it links the set.

**Alignment unclear** lists chainages it cannot place, where cross sections at that chainage exist for more than one alignment and the sheet does not say which it means. Their links wait under **Needs review**.

On a plan, bare numbers count as chainages when they run along the alignment, evenly stepped in value and evenly spaced on the sheet. A number on its own, a scale bar or grid coordinates along the sheet's edge does not. Ranges such as *CH 280 TO CH 565* in a title are not links.

## 7. Review

![The review: how each step did, and the standard's settings](img/drawing-standard-review.png)

The review shows how each step went, and the standard's settings:

- **Name**, and **Words on this client's sheets** (the client's name, a project code): sets that print these, or whose numbers fit the template, are offered the standard when they open.
- **This document**: the standard this set is read with. Choose **None (read from the text)** to go back to the text alone.
- **Advanced: words and marks**: everything the steps learned, as lists you can correct by hand, and the marks taught for this client. Click **×** beside a mark to forget it.
- **Export…** and **Delete**.

Click **Read this document with it**. The sheets are read again straight away and their links are found again. Sheet numbers you typed yourself are never replaced. If you change a standard, sets that use it are read again the next time you open them.

{{Document > Drawing Standards…}} opens the setup at this review. {{Document > Teach Sheet Links…}} opens it at the link steps.

## Finish with AI

The setup never sends your drawings anywhere. When a step's meter says **Poor: recommend AI**, an AI assistant connected to redcolumn over [MCP](#mcp) can finish it, using the boxes you drew as its examples:

1. Click **Ask AI to finish** in the step, or in the review for every step left. A prompt is copied, naming the standard, the drawing, the steps and why.
2. Paste it into your AI assistant. It reads the sheets and proposes the links it finds, and words the standard should learn.
3. Nothing is used until you keep it. Links it proposes wait under **Needs review** in the [Links tab](#links), with the assistant's reasoning. Words it proposes wait in the review under **Proposed by AI**: click **Add these words** or **Dismiss**.

## Offered when a set opens

When you open a set that isn't read with a standard, redcolumn checks your saved standards against it. If one fits most of the sheets it checks, a bar at the top offers it:

![A drawing standard offered for a set](img/drawing-standard-offer.png)

- **Use *name*** reads the set with it.
- **Not this set** stops it being offered for this set. Choosing **None** for a set does the same.

A standard is only offered when it can tell its client's sets apart: it needs a drawing-number template, or words on this client's sheets.

## Use a standard for a whole Project

If you own a [Project](#projects), open one of its files, open the setup's review and click **Use *name* for the Project**. Everyone who opens a file from the Project gets the standard added to their profile, and its files are read with it. Click **Stop** to remove it from the Project.

## Share a standard

Click **Export…** in the review to save the standard as a `.rcstandard` file, and send it to your team. They click **Import…** on the setup's first screen to add it. Importing a standard you already have updates it. The file holds the boxes and words you taught, including the text read in the setup's example boxes, but no pictures of your drawings.

---

*Drawing standards build on Miche-pup's work on agency title blocks and link kinds.*
