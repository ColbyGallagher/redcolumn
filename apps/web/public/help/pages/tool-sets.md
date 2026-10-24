# Tool sets, import and export

## Make a new tool set

Click **+ New Tool Set** at the top of the Tool Library, type a name, and press [[Enter]].

![The New Tool Set and Import buttons](img/tool-library-buttons.png)

1. **+ New Tool Set** — make an empty set.
2. **Import…** — load tool sets from a file.

## Tool set options

Click the **⋯** (Tool set options) button at the right of a set's heading:

![Tool set options](img/tool-set-menu.png)

| Option | Does |
|---|---|
| **Icon View / Detail View** | Tools as a grid of pictures, or a list with names. |
| **Add Selected Markup** | Saves the selected markup into this set. |
| **Rename…** | Renames the set. |
| **Scale Tools to Page Scale** | Tools keep their real-world size: copies grow or shrink with each page's scale. |
| **Export Tool Set…** | Saves the set as a file to share. |
| **Export for Revu (.btx)…** | Saves the set as a Bluebeam® Revu® tool set. See [Export to Revu](#tool-sets). |
| **Move Up / Move Down** | Changes the order of sets. |
| **Hide Tool Set** | Hides it from the panel. |
| **Delete Tool Set…** | Deletes the set and its tools. |

## Import tool sets

1. Click **Import…**.
2. Pick a tool set file and click **Open**.

redcolumn reads its own `.json` tool sets and Bluebeam® Revu® tool sets (`.btx`). You can also drag the file onto the Tool Library.

## Import line styles and hatches

**Import…** also reads Bluebeam® Revu® line style sets (`.blx`) and hatch sets (`.bhx`). Revu keeps them in its settings folder, next to your tool sets.

- **Line styles** appear in the **Line style** list, in the toolbar and in [Properties](#properties), under the set's name. Pick one to draw a line as a pattern of dashes, text and symbols, such as *Gas* or *Fenceline Circle*.
- **Hatches** appear in the **Hatch** list the same way. Revu's *Standard* hatch set is already built in, so importing it adds nothing new.

Each set is listed as a tag under the Import button. Click **×** on a tag to remove the set from your profile. Markups that already use a style or hatch keep it, because the pattern is saved with the markup.

## Export to Revu

Tool sets, line styles and hatches go back to Bluebeam® Revu® as its own files:

- **Tool sets**: right-click a set and choose **Export for Revu (.btx)…**. Tools that came from Revu and were not restyled go back exactly as Revu stored them. Other tools are written from their type and look. Tools Revu has no equivalent for (such as dimensions or flowchart shapes) are named in the message and left out.
- **Line styles and hatches**: click **⤓** on the set's tag to save it as a `.blx` or `.bhx`.

In Revu, import the file from its Tool Chest, Line Style or Hatch Pattern manager.

## Share with your team

Export a set, send the file to colleagues, and they **Import** it. Tool sets are part of your [profile](#profiles), so backing up a profile backs them up too.
