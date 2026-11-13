# Sheet scales

Measurements are only as good as the scale. These two tools let the client check each sheet's scale and suggest a fix. See also [Review sheet scales](#scale-review).

## get_sheet_info

**Does:** reports what each sheet's title block says and where its scale stands.

**Returns, for each page:**

- the sheet number, title and discipline
- the scale text, the sheet size it was stated for, and the size the page actually is
- the scale that gives (corrected when, for example, an A1 drawing was saved at A3)
- the review status: ready, resized, check, matches, differs, views, nts or none
- the page's scale and viewports
- whether the page can be measured

**For one page** it also checks the scale against the page's scale bars and dimensions, and suggests viewports from its view titles.

**Limits:** without a page, every page is listed, but the scale-bar check is skipped. It changes nothing. The client should run it before measuring.

**Model:** a cheaper model is fine to read the table. A strong model is better to judge the scale-bar check and the suggested viewports.

## propose_page_scale

**Does:** suggests the scale a page's title block states, when redcolumn did not read it or read it wrong.

**Takes:** the page, the scale as written (`1:100`, `1/4" = 1'-0"`, `NTS`, `AS SHOWN`), the sheet size it is for if the title block says (such as A1), and a reason that says where it read it.

**Where you see it:** it sets no scale. The suggestion waits in {{Document > Review Sheet Scales}}, tagged **AI**, with its reasoning. You check it against the page and apply it.

**Limits:** it never replaces sheet information from your drawing standard or typed by a person.

**Model:** a strong model. A wrong scale makes every measurement on the sheet wrong.

Back to [Connect an AI client](#mcp).
