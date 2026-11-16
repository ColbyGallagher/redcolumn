# Move from Bluebeam® Revu®

{{File > Migrate from Revu…}} brings your Revu libraries across in one go: tool sets, stamps, line styles, hatch patterns, profiles, bookmark templates, Sets categories and keyboard shortcuts.

## Run the wizard

1. Choose {{File > Migrate from Revu…}}.
2. **Desktop app:** redcolumn looks in Revu's settings folder on this computer and lists what it found. If you have more than one Revu version, pick it from **Revu version**.
   **Browser:** click **Choose Folder…** and pick Revu's settings folder (see below). The browser reads the library files in it; nothing is uploaded.
3. Untick anything you do not want. **Show** lists the files in a group.
4. Click **Import**. Each group says what it added, and anything that failed says why.

Everything goes into the profile you are using, except Revu profiles (`.bpx`): each becomes a new profile, a copy of yours with Revu's Markups list columns. Switch to one in {{File > Profiles}}.

Importing a tool set or profile twice adds it twice. Stamps, hatch sets, bookmark templates and categories with the same name are replaced.

## Where Revu keeps its settings

Revu 21 keeps them in `%APPDATA%\Bluebeam Software\Revu\21` (older versions: `20`, `2019`…). Paste that into the File Explorer address bar to open it. To move from another computer, copy that folder across and choose the copy with **Choose Folder…**.

| File in the folder | Becomes |
|---|---|
| `*.btx` | Tool sets in the Tool Library |
| `Stamps\*.pdf` | Stamps (text stamps stay editable; picture stamps keep their artwork with live text) |
| `*.blx` | Line styles |
| `*.bhx` | Hatch patterns (Revu's standard ones are already built in) |
| `*.bpx` | New profiles with Revu's Markups list columns |
| `Construction.xml` and other bookmark templates | Bookmark templates (Bookmarks panel) |
| `Categories\*.xml` | Sets category templates (Preferences › Sets) |
| `KeyboardShortcuts.xml` | Keyboard shortcuts |

The wizard never reads Revu's other settings files: `DigitalIDs.xml`, `UserPreferences.xml`, `ApplicationSettings.xml`, recent file lists, form templates or workflows.

## Keyboard shortcuts

redcolumn's shortcuts already follow Revu 21's, so most keys do the same thing. Importing `KeyboardShortcuts.xml` brings across any you changed in Revu. In {{File > Keyboard Shortcuts…}}:

- **Import…** also reads `KeyboardShortcuts.xml`.
- **Revu 21 Preset** gives every command exactly Revu 21's keys and turns off the few redcolumn adds (such as [[O]] for Offset and [[Ctrl+Shift+K]] for Find Commands).
- **Reset All** goes back to redcolumn's defaults.

## What does not come across

These have no equivalent in redcolumn yet, or cannot be read from the settings folder. Nothing is dropped without being reported.

- **Tool set items** that are not markups: images, symbols drawn from PDFs, and some stamps inside a tool set. The import counts them as "not supported yet".
- **Profiles:** only the Markups list columns. Revu's toolbars, panel layout, and the tool sets a profile loads are not read.
- **Custom columns** listed in a profile's order but not stored in it (Revu writes some that way): they are left out and named in the report.
- **Keyboard shortcuts** for Revu features redcolumn does not have (3D, scanner, JavaScript console…): the import lists them.
- **Preferences** (`UserPreferences.xml`): units, colours, autosave and other settings. Set them in {{File > Preferences…}}.
- **Digital IDs:** certificates are not in the settings folder. Import your `.pfx` in {{Tools > Digital IDs…}}, or use the card or token they are on.
- **Studio** sessions, projects and sign-in.
- **Form templates** and **workflows** from the start page.
- **Tool sets kept outside the settings folder** (on a network share, or added from another folder in Revu's Tool Chest): import those `.btx` files from the Tool Library's **Import…**.
- **Batch sequences and Revu scripts.**

Markups in your PDFs need no migration: redcolumn reads and writes the annotations Revu uses. See the [compatibility report](https://github.com/ColbyGallagher/redcolumn/blob/master/docs/compatibility.md).
