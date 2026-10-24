# Scripts: change many markups at once

A **script** is a few short lines that find markups and change them: put every cloud by one person on a layer, rename a layer, colour markups by author, or set a status on every comment that mentions something. Choose {{Tools > Scripts…}}.

Scripts only do what their lines say. They are not programs: they cannot reach the internet, your files, or anything outside the open document's markups. They run only when you click **Apply**, never by themselves.

## Write a script

```
# Sam's clouds go on their own layer, in blue
where type is cloud and author is "Sam"
set layer "Review – Sam"
set color blue

rename layer "Old notes" to "Notes"
```

- A **where** line finds markups. The **set** lines under it change each one it finds. **every markup** finds them all.
- **rename layer "Old" to "New"** moves every markup on a layer to another.
- Lines starting with `#` are notes for you.

### Finding markups

Compare a field with **is**, **is not**, **contains**, **does not contain**, **starts with**, **ends with**, **matches /pattern/**, **is empty** or **is not empty**, or with **<**, **<=**, **>** and **>=** for numbers. Join conditions with **and**, **or** and **not**, and use brackets to group them.

| Field | Is |
|---|---|
| `type` | the kind of markup: `cloud`, `rectangle`, `"text box"`, `length`… |
| `subject`, `author`, `status`, `layer`, `comment`, `text` | as in the [Markups list](#markups-list) |
| `color`, `fill` | a colour name (`red`, `blue`…) or `#rrggbb`; `fill` can be `none` |
| `width`, `opacity` | line width in points; opacity in percent |
| `page`, `sheet` | the page number, or its sheet number |
| `checked`, `locked` | `yes` or `no` |
| `replies` | how many replies it has |
| `column "Name"` | a custom column's value |

### Changing markups

`set` can change **color**, **fill**, **width**, **opacity**, **status** (by its name), **layer** (`none` takes it off its layer), **subject**, **comment**, **checked**, and **column "Name"**.

Locked markups are found but left alone.

## Preview, then apply

1. Click **Preview** (or press [[Ctrl+Enter]]). The box below lists every markup that would change and how. Nothing has changed yet.
2. If a line cannot be read, it is named with its line number. Fix it and preview again.
3. Click **Apply**. One [[Ctrl+Z]] takes the whole script back.

## Save scripts

Click **Save to Profile** to keep a script for later. Saved scripts are part of your [profile](#profiles), on this device. The **Examples** in the list are a starting point: click one to copy it into the editor.
