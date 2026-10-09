# Erase, cut and edit PDF content

These tools change the **drawing itself**, not markups. Use them with care.

All three are in {{Edit > PDF Content}}:

![Edit, PDF Content](img/menu-pdf-content.png)

## Erase Content

Removes part of the drawing (lines, text and pictures) under a box.

1. Choose {{Edit > PDF Content > Erase Content}}.
2. Drag a box over what to remove. Let go and it is gone.

   ![Dragging an erase box over a line of notes](img/erase-content.png)

## Cut Content

Like Erase, but first copies what was there to the clipboard as a picture, so you can paste it somewhere else (as an [Image](#tool-image)).

1. Choose {{Edit > PDF Content > Cut Content}}.
2. Drag a box over the area.
3. Click where you want it and press [[Ctrl+V]].

## Edit Text

Changes the words of text in the PDF, or adds new text.

1. Choose {{Edit > PDF Content > Edit Text}}.
2. Click on the text to change. It flashes, and a box shows its words.

   ![Editing a line of text](img/edit-text.png)
3. Change the words and click **Replace**.

Click where there is no text to **add** new text to the page (in Helvetica, 10 pt).

> **Note:** If the PDF's own font doesn't have a letter you typed, the text is set in Helvetica instead.

> **Warning:** These change the PDF content for everyone who opens the saved file. Press [[Ctrl+Z]] to undo straight away. For removing private information safely, use [Redaction](#tool-redaction).
