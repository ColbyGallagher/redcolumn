# Stitch sheets

The client can join drawing sheets along their match lines. See [Stitched view](#stitch) for what you see. Nothing is joined until the client places match lines, and every change is one undo step.

## get_stitching

**Does:** reads how the sheets are stitched.

**Returns:** the hand-placed match lines (id, page, ends, side that stays, name, partner, and any problem), the regions that leave out title blocks, and the stitched groups (pages in order, each sheet's scale and rotation against the first, and the joins).

**Limits:** it changes nothing. It can be narrowed to one page.

**Model:** a cheaper model is fine.

## get_stitch_image

**Does:** takes a picture of the stitched sheets, each cut at its region and match lines, outlined in blue and labelled with its page number.

**Returns:** the picture, the bounds of the group, and for each sheet the numbers that turn its page points into pixels.

**Limits:** 256 to 4096 pixels on the long side (2000 when not given), 18 to 600 dpi (100 when not given). It changes nothing.

**Model:** a strong model, to judge whether a join is right.

## place_match_lines

**Does:** joins sheets. Each pair is the same match line on two pages, given by its two ends on each. The ends meet, so a sheet at another scale is scaled to fit. The order the ends are given in does not matter.

**Takes:** a list of pairs, each with a name (a station such as `STA 12+00`; `ML-n` when left out). Which side of each line stays can be given by `keepSide` (right or left, walking from the first end to the second) or `keepPoint` (any point inside the part that stays). With neither, the side with more of the sheet stays.

**Returns:** the groups the sheets now form. Check them with `get_stitch_image`.

**Limits:** 100 pairs a call, as one undo step. One bad pair places nothing. Match line ends must lie inside the sheet's region, if it has one.

**Model:** a strong model. The client has to find the match lines in pictures and work out both ends on both sheets.

## update_match_lines

**Does:** changes match lines by id: moves their ends, changes the side that stays (or flips it), renames, pairs with another line (or unpairs), or slides the sheet joined at the line.

**Limits:** 100 lines a call. `resetSlide` puts a slid sheet back where the line ends place it.

**Model:** a strong model.

## set_stitch_region

**Does:** sets the part of a sheet that holds the drawing, so the title block, legend and notes are left out. It is two opposite corners, or the corners of a polygon for an L-shaped area. `points` null clears it, and the sheet falls back to its largest viewport or the whole sheet.

**Limits:** match line ends have to lie inside the region.

**Model:** a strong model.

## delete_match_lines

**Does:** removes match lines by id, clears the regions on some pages, or with `all` removes every match line and region.

**Asks first:** you see an **Allow** prompt. It is one undo step after that.

**Limits:** a line whose partner is removed waits for a new one. Pages already made with Stitch to New Page stay.

**Model:** a cheaper model is fine once you have said what to remove.

## show_stitched_view

**Does:** shows the sheets stitched with a page as one drawing in redcolumn, or the normal view when `on` is false.

**Limits:** the drawing has to be on screen.

**Model:** a cheaper model is fine.

## stitch_to_page

**Does:** draws the stitched sheets onto one new page at the end of the document. The page stays vector and has the first sheet's scale, so measuring works across the joins. Markups on the kept parts are copied over unless the client turns that off.

**Asks first:** you see an **Allow** prompt. It is one undo step after that.

**Returns:** the new page number. The client should look at it with `get_page_image`.

**Limits:** the drawing has to be on screen.

**Model:** a cheaper model is fine to run it. Use a strong one to check the result.

Back to [Connect an AI client](#mcp).
