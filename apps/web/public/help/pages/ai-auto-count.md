# AI auto count

Your AI client can count the repeats of a symbol for you: every smoke detector, socket or valve on a sheet. redcolumn finds the repeats with its own [symbol search](#symbol-search). The AI decides which ones are right and stages them. **You approve** before anything is counted.

redcolumn never calls an AI model itself. The AI runs in your own client, [connected over MCP](#mcp).

## How it works

1. You (or the AI) draw a rectangle markup around one example of the symbol.
2. The AI calls `find_symbol_matches` with that rectangle. redcolumn returns every place the symbol appears.
3. The AI checks the matches against a [picture of the page](#mcp-page-view) and calls `propose_counts` with the ones that are right, a subject such as *Smoke detector*, and its reasoning.
4. The proposal waits in {{Tools > Takeoff > Review AI Proposals…}}, which opens by itself.
5. You tick the matches you agree with and press **Approve**. redcolumn places Count markups with that subject, one per page, as **one undo step**. **Reject** discards the proposal.

## find_symbol_matches

**Does:** searches for repeats of an example symbol, on line work or, on a scanned sheet, by matching pixels.

**Takes:**

- `example`: `{ markupId }` of a markup drawn around the symbol, or `{ rect: { page, x, y, w, h } }` in PDF points.
- `page` or `pages`: where to search. The default is the example's page.
- `rotations`: also find the symbol turned.
- `scales`: also find copies drawn half to twice the size (line work only).
- `minScore`: the least score, above 0 and at most 1. The default is 0.9 on line work and 0.75 on scans.
- `limit`: most matches returned. The default is 200 and the most is 1000.

**Returns:** `matchId`, `page`, `bbox` (PDF points) and `score` for each match, and which engine ran (`vector` or `pixels`). The example is among the matches.

**Limits:** it changes nothing. Match ids last until you close redcolumn.

**Model:** a cheaper model is fine for the search. A strong model should check the matches against the page.

## propose_counts

**Does:** stages matches as a count proposal.

**Takes:** `matches` (matchIds, or `{ page, bbox }` items), a `subject`, and `reasoning`. Each must be given, so you can check it.

**Limits:** it places nothing. Up to 2000 matches a call.

**Model:** a strong model, because it has to judge which matches are the right symbol.

## list_count_proposals

**Does:** lists the count proposals and where each stands: pending, approved (and by whom) or rejected.

**Limits:** it changes nothing.

Back to [Connect an AI client](#mcp).
