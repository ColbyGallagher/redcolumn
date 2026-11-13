# Draw markups

The client can draw markups for you. Each call is one undo step.

## place_markup

**Does:** draws one markup on a page: a line, rectangle, ellipse, cloud, polygon, text box, pen, highlight, measurement, and so on. It can also draw a **Cloud+** (a cloud with a callout) and a **Smart Fill** (one point inside a closed outline).

**Takes:** the page, the type, the points, and optionally text, comment and subject. The points depend on the type:

- a line, rectangle, ellipse, cloud, text box or redaction: two opposite corners.
- a callout: the tip, the knee, and the box's two corners.
- a pen or highlight: the path.
- a polygon, area or space: its corners.

**Returns:** the new markup.

**Limits:**

- **Image, stamp, signature and file attachment** need a file, so the client cannot draw them. It can start the tool with [run_command](#mcp-commands) and you pick the file.
- **Length, area and volume** need a page (or [viewport](#mcp-viewports)) with a scale. On a page with no scale, or one marked NOT TO SCALE, they are refused. See [Sheet scales](#mcp-scale).
- **Cloud+ and Smart Fill** need the drawing on screen.
- A read-only drawing refuses all drawing.

## place_markups

**Does:** draws many markups in one undo step.

**Takes:** a list, each item like `place_markup`. A page on the call is the default for items that do not give their own.

**Returns:** each new markup's id, number, type and page.

**Limits:** 500 at a time. One bad item draws nothing. Not for Cloud+ or Smart Fill.

**Model:** the tools are simple, but the *points* decide whether a markup lands where you meant. If the client works positions out from a picture, use a strong model. If you give it exact numbers, a cheaper model is fine.

Back to [Connect an AI client](#mcp).
