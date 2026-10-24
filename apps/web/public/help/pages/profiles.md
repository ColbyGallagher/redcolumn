# Profiles

A **profile** remembers how your workspace is set up: which tools are on the toolbar, which panels show, your Tool Library, the Markups list's columns and filters, your stamps and your keyboard shortcuts. Make a profile for each kind of work (for example *Estimating* and *Site review*) and switch between them in one click.

## Switch profile

Choose {{File > Profiles}} and click the profile.

![File, Profiles](img/menu-profiles.png)

## Manage profiles

Choose {{File > Profiles > Manage Profiles…}}.

![The Profiles window](img/profiles-dialog.png)

On the left:

| Button | Does |
|---|---|
| **New** | A new profile with the standard setup. |
| **Duplicate** | A copy of the selected profile, to change. |
| **Rename** | Renames it. |
| **Delete** | Deletes it (not the one in use). |
| **Import… / Export** | Loads a profile from a file, or saves one to share or back up. |

On the right, set up the selected profile:

| Tab | Sets |
|---|---|
| **Toolbar** | Whether the toolbar shows, and which tools are on it. |
| **Panels** | Which side panels are on the panel rail. |
| **Tool Library** | Which tool sets show. |
| **Markup List** | The list's columns, sorting and filters. |
| **Columns & Statuses** | Custom columns and statuses new documents start with. |

Changes are saved to the profile as you make them. Click **Done**.

## Import a Bluebeam® Revu® profile

**Import…** also reads a Revu profile (`.bpx`; Revu keeps them in its settings folder, such as *Field Issues* or *Quantity Takeoff*). It becomes a new profile, a copy of your current setup with the **Markup List** laid out as Revu's was: the same columns, in the same order, with the same widths, and the ones Revu hides hidden. Any custom columns the profile defines are added to **Columns & Statuses**.

Revu columns we have no equivalent for (such as *Label*, *Count* and *Legend*) are named in the message and left out. Revu's other panel layouts are not read. The profile can also be added from the Tool Library's **Import…**, which adds it without switching to it.

**Export for Revu** saves the active profile's **Markup List** as a Revu profile (`.bpx`): its columns, order, widths and hidden columns, and its custom columns. Only the markup list is written; Revu keeps its own settings for everything else. Export the profile's tool sets from the [Tool Library](#tool-sets).


> **Warning:** Profiles are saved in this browser (or this desktop app) only. Clearing the browser's site data, or uninstalling the app and its data, removes them. **Export** them to keep a copy.
