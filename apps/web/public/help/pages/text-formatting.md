# Format text (font, size, box)

These controls work for [Text Box](#tool-text), [Callout](#tool-callout), [Typewriter](#tool-typewriter) and [Flag Label](#tool-flag-label).

## On the toolbar

Pick the text tool (or select a text markup). The toolbar shows:

![Text controls on the toolbar](img/toolbar-text.png)

1. **Box** — untick to show the text with no box at all.
2. **Border** — untick to keep the box's fill but hide its outline.
3. **Font** — the typeface: the standard fonts, or any font installed on your computer (see below).
4. **Size** — the text size in points. Leave it empty (**Auto**) to fit the zoom you are working at.

The **colour** swatch sets the box outline. To fill the box, tick **Fill**.

## In the Properties panel

Select the text markup and open the [Properties panel](#properties) for more:

![Text settings in the Properties panel](img/properties-text.png)

- **B**, **I**, **U** — bold, italic, underline.
- **Align** — left, centre or right.
- **Vertical** — top, middle or bottom of the box.
- **Text color** — the colour of the words (separate from the box).

## Use a font installed on your computer

The **Font** list (on the toolbar and in the Properties panel) starts with the three standard fonts, then fonts you used recently, then every font installed on your computer. Each name is shown in its own typeface; type in the box at the top to narrow the list.

- **Desktop app** — your installed fonts are listed straight away.
- **Browser** — click **Show installed fonts…** at the bottom of the list. Chrome and Edge ask your permission once. Other browsers cannot list them, so only the three standard fonts are offered.

When you save or export, the font is **embedded** in the PDF (only the letters you used), so the text looks the same in every viewer, even on a computer without that font.

- Some fonts' licences forbid embedding (Segoe Script is one). Those, and fonts that cannot be embedded for technical reasons, are written as the nearest standard font (Helvetica, Times or Courier), and a notice tells you which.
- If you open a document that uses a font this computer does not have, a notice lists it and the text is shown in a similar font. The font name is kept, so it appears correctly again on a computer that has it.

## Lists

While you type in a text markup, a small bar above it makes lists. Select lines and press a button, or just start typing:

- **•** bulleted, **1.** numbered, **a.** lettered, **i.** roman, **☐** checklist. Press the same button again to take the lines out of the list.
- Type `-` or `*` and a space at the start of a line to start a bulleted list, or `[]` and a space for a checklist.
- **Enter** adds the next item. Press Enter on an empty item to finish the list. Numbers follow on by themselves.
- **Tab** and **Shift+Tab** (or the arrow buttons) move an item in and out a level. Numbered lists change style as they nest: 1. then a. then i.; bullets change shape.
- **Backspace** at the start of an item's text takes the item out of the list.
- **[[Ctrl+Shift+8]]** bullets, **[[Ctrl+Shift+7]]** numbers, **[[Ctrl+Shift+9]]** checklist.

A list is ordinary text (`• milk`, `1. milk`), so it looks the same in Bluebeam, Acrobat and other viewers. Lines that wrap hang under the item's text once you finish editing.

## Make the box fit the text

Select the text box and choose {{Edit > Auto-size Text Box}} (or press [[Alt+Z]]).

![A roomy text box shrinking to fit its text](gif/auto-size-text.gif)
