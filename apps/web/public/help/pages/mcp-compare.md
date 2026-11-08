# Compare documents

The client can compare two revisions by meaning, not just by word. See [Compare](#compare) for the panel you see. Nothing in either document changes.

## start_comparison

**Does:** starts an AI comparison of two open documents, the old revision and the new.

**Asks first:** you see an **Allow** prompt, because the text of both documents goes to your AI client. You see a plain text comparison in the AI Compare panel at once; the client then improves on it.

**Limits:** both revisions must be open in tabs. Neither can be a scan without text (OCR it first).

**Model:** a cheaper model is fine for starting it.

## get_comparison

**Does:** reads the comparison that you started ({{Document > AI Compare Documents…}}) or the client started.

**Returns:** the document cut into paragraphs. Paragraphs with the same text in both revisions are already matched, and only counted. The rest come back with ids (`o12` for old, `n7` for new), pages and text.

**Limits:** 100 paragraphs per side a call, up to 400. The reply has `nextOffset` while more remain. It fails if no comparison has been started.

**Model:** a strong model. It has to match the leftover paragraphs by meaning, not position.

## report_document_changes

**Does:** gives the client's verdict on paragraphs.

**Takes:** a list of changes. Each is `modified`, `moved`, `unchanged`, `added` or `removed`, with the old and new paragraph ids and a short reason. It can also add a two or three sentence summary of what changed, shown above the list.

**Where you see it:** in the AI Compare panel, marked as the client's judgement, with the changed wording. Paragraphs it leaves out are compared by text similarity and marked as that.

**Limits:** 500 changes a call. The client can call it once per page of results; a later verdict on a paragraph replaces an earlier one. If it cannot judge the comparison, it reports an error with the reason.

**Model:** a strong model.

Back to [Connect an AI client](#mcp).
