# Viewports

A viewport is a region of a page drawn at its own scale, such as a detail or a section beside a plan. Measurements inside it use its scale. See [Viewports](#viewports) for how you work with them.

## list_viewports

**Does:** lists a page's viewports.

**Returns:** each viewport's id, name, page, rectangle (x, y, width, height in points, from the top-left, y down), and scale, written the way `get_page` writes it.

**Limits:** it changes nothing. It can be narrowed to one page.

**Model:** a cheaper model is fine.

## place_viewport

**Does:** places one viewport on a page.

**Takes:** the page, two opposite corners, and optionally a name and a scale. The part off the page is cut away. It starts at the page's scale unless a scale is given.

**Returns:** the new viewport's id and rectangle. One undo step.

**Limits:** the scale has to be text redcolumn understands, such as `1:100` or `1/4" = 1'-0"`.

**Model:** a strong model when the client works the corners out from a picture or a view title. A cheaper model is fine if you give it the corners.

## place_viewports

**Does:** places many viewports in one undo step.

**Takes:** a list, each item like `place_viewport`. A page on the call is the default for items without one.

**Returns:** each new viewport's id, name, page, rectangle and scale.

**Limits:** 100 at a time. One bad item places nothing.

**Model:** as for `place_viewport`.

## set_viewport_scale

**Does:** sets the scale of one viewport, so measurements inside it use that scale and the page's scale is left alone.

**Returns:** the viewport as it now stands. One undo step.

**Limits:** text that is not a scale is refused and nothing changes.

**Model:** a strong model to decide the scale. A cheaper model is fine when you give it.

Back to [Connect an AI client](#mcp).
