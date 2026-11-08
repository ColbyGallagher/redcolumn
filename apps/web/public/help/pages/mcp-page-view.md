# See and read a page

Two tools let the client look at a page. Neither changes anything.

## get_page_image

**Does:** takes a picture of a page, or part of one, as the drawing shows it. Markups are drawn over it unless the client turns them off.

**Returns:** the picture, and, as text, its scale in pixels per PDF point and the area it covers. That lets the client turn a pixel back into a page point: the page point is the region's corner plus the pixel position divided by the scale.

**Limits:**

- Between 256 and 4096 pixels on the longer side (1600 when not given).
- Between 18 and 600 dpi (200 when not given).
- A whole sheet is shrunk to fit, so small linework and lettering blur. The client should look at the whole page first to find what it wants, then ask for a **region** a few hundred points across.
- A region off the page is refused.

**Model:** a strong model. Reading what a picture shows is the job, and cheap models misread fine detail.

## get_page_text

**Does:** reads the text the PDF holds, in reading order.

**Returns:** each word with its box (top-left and bottom-right corners, in points) and font size.

**Filters:** a region of the page, or search text (words that contain it, ignoring case).

**Limits:**

- 1000 words a call, up to 5000 with `limit`. The reply has `total`, and `nextOffset` while more remain.
- A scanned page has no text until it is OCRed. See [OCR](#ocr).
- Text drawn as outlines or pictures is not text, and is not returned.

**Model:** a cheaper model is fine for searching and reading. A strong model is better when the words must be understood in a drawing's layout.

Back to [Connect an AI client](#mcp).
