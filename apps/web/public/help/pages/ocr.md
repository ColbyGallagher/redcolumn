# OCR (make scans searchable)

A scanned drawing is just a picture: you can't search it, select its words, or use the text tools on it. **OCR** (optical character recognition) reads the words and adds them as invisible text. The pages look exactly the same.

1. Choose {{Document > OCR…}} (or press [[Ctrl+Shift+O]]).

   ![The OCR window](img/ocr.png)
2. Choose the **Pages**. **Pages without text** does only the scanned ones.
3. Choose the **Resolution**. Higher reads small text better but is slower.
4. Tick the **Languages** on the pages. Each extra language makes OCR slower.
5. Click **Run OCR**.

Progress shows at the bottom of the screen. You can keep working while it runs.

> **Note:** The first time, OCR downloads its reading engine (about 11 MB). To use OCR offline, download it ahead of time in [Preferences](#preferences) › **Offline**.

To OCR many files, use {{Batch > OCR…}}.
