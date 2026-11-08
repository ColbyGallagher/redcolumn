# Run commands

The client can run the same commands as the menus and the command palette (see [Find any tool or command](#find-tools)).

## list_commands

**Does:** lists the commands, with whether each can run right now.

**Filters:** `category` (File, Edit, View, Document, Bulk, Tools, Window or Help), `query` (the id or label contains the words, such as `zoom` or `rotate`), and `available` (leave out commands that cannot run now).

**Limits:** the full list is long (over 300 commands), so the client should narrow it. It changes nothing. See [Every command](#mcp-command-list) for the whole list with ids.

**Model:** a cheaper model is fine.

## run_command

**Does:** runs one command from the list by its id, such as `view.zoomIn` or `edit.delete`.

**Asks first:** deletes, saves and changes to the document wait for **Allow** in redcolumn. A command that opens a dialog returns at once, and the dialog waits for you in redcolumn.

**Returns:** that the command ran, or why it could not (for example "not available").

**Limits:** only commands the menus offer. A command that is not available right now is refused. The client cannot fill in a dialog for you, so it cannot choose a file.

**Model:** a cheaper model is fine, since the command list says what each does. Use a strong model when the job takes many commands in the right order.

Back to [Connect an AI client](#mcp).
