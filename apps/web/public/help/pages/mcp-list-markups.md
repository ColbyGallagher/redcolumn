# List markups

## list_markups

**Does:** reads the markups on an open drawing. It changes nothing, so the client runs it without asking.

**Returns:** each markup's id, number, type, page, text, status and measurement. With `detail` set to brief, points, style and author are left out. With `summary` on, it returns only counts by type, status and page.

**Filters:**

- **page** — one page.
- **type** — one markup type, such as `rect`, `cloud` or `length`.
- **status** — one status name.
- **search** — markups whose text, subject or comment contains the words, ignoring case.

**Limits:**

- 500 markups a call. Ask for more with `limit`, up to 2000.
- The reply has `total`, and `nextOffset` while more remain. The client sends `nextOffset` back as `offset` to carry on.
- On a big drawing the client should ask for `summary` or a filter first, so it does not read thousands of markups it does not need.

**Model:** a cheaper model is fine. Deciding *which* markups matter can take a stronger one.

The ids it returns are what [Edit and delete markups](#mcp-edit), [Takeoff proposals](#mcp-takeoff) and most other tools use to name a markup.
