# Open drawings and pages

Two tools tell the client what is open and how big each page is. Neither changes anything, so the client runs them without asking.

## list_open_documents

**Does:** lists the drawings open in redcolumn.

**Returns:** for each drawing, its name, page count, the page on screen, and that page's sheet number.

**Limits:** open drawings only. It cannot open a file.

**Model:** a cheaper model is fine.

## get_page

**Does:** reports one page's geometry.

**Returns:** the page size in PDF points, its scale if it has one, and how many [viewports](#mcp-viewports) it has. Point positions start at the top-left of the page, with y going down.

**Limits:** one page a call. The page on screen is used when no page is given. A page number outside the document is refused with the valid range.

**Model:** a cheaper model is fine.

See [Connect an AI client](#mcp) for how pages and points are numbered.
