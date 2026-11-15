"""Build the 21-sheet Kestrel Road Upgrade demo drawing set.

    python scripts/make_road_set.py [output.pdf]

Also writes <output>.links.json: every cross-reference the set draws (section and detail
callouts, elevation marks, match lines, chainages), the answer key for `pnpm standards:bench`.

Every project, company and person in the set is fictional. The plan sheets are
windows onto one shared model so neighbouring sheets stitch edge to edge.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

from roadset import sheets_cross, sheets_general, sheets_long, sheets_plan, truth  # noqa: E402
from roadset.catalog import SHEETS, title_block_data  # noqa: E402
from roadset.titleblock import SHEET_H, SHEET_W, draw_titleblock  # noqa: E402

DRAWERS = {
    "cover": sheets_general.cover_sheet,
    "index": sheets_general.index_sheet,
    "legend": sheets_general.legend_sheet,
    "ts1": sheets_general.typical_sheet1,
    "ts2": sheets_general.typical_sheet2,
    "setout": sheets_general.setout_sheet,
    "ls01": sheets_long.ls01_sheet,
}
for _n in range(1, 5):
    DRAWERS["plan%d" % _n] = (lambda c, n=_n: sheets_plan.plan_sheet(c, n))
    DRAWERS["ls%d" % _n] = (lambda c, n=_n: sheets_long.ls_sheet(c, n))
for _n in range(1, 6):
    DRAWERS["xs%d" % _n] = (lambda c, n=_n: sheets_cross.xs_sheet(c, n))
DRAWERS["xs01"] = lambda c: sheets_cross.xs_sheet(c, "xs01")


def build(path):
    c = canvas.Canvas(path, pagesize=(SHEET_W * mm, SHEET_H * mm), pageCompression=1)
    c.setTitle("Kestrel Road Upgrade Stage 2 - Roadworks drawing set (sample)")
    c.setAuthor("Meridian Civil Consulting (fictional)")
    c.setSubject("Fictional 21-sheet road design set for demonstrating markup and takeoff tools")
    c.setKeywords("sample, roadworks, alignment control plan, long section, cross section")
    c.showOutline()
    for s in SHEETS:
        truth.page = s["page"]
        c.bookmarkPage(s["key"])
        c.addOutlineEntry("%s  %s - %s" % (s["num"], s["t1"].title(), s["t2"].title()), s["key"], 0)
        DRAWERS[s["key"]](c)
        draw_titleblock(c, title_block_data(s))
        c.showPage()
    c.save()
    truth.write(os.path.splitext(path)[0] + ".links.json", SHEETS)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "kestrel-road-set.pdf"
    build(out)
    print("wrote", out)
