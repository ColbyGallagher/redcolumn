"""Two disciplines' plan sheets from the Kestrel Road demo set, for bulk stitching tests.

    python scripts/make_road_disciplines.py [output.pdf]

Pages 1-2 are the roadworks alignment control plans (sheets 1 and 2, joined at the match line
at CH 280). Pages 3-4 are the same two windows as drainage plans: no existing services, and the
second sheet's drawing sits a little out of register in its frame (SHIFT_MM), as sheets of
another discipline drawn off the same base often do. Also writes <output>.json: where the match
line is drawn on each page, in PDF points from the page's top-left, y down.

Every project, company and person in the set is fictional.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

from roadset import sheets_plan, truth  # noqa: E402
from roadset.catalog import BY_KEY, title_block_data  # noqa: E402
from roadset.draw import FX0, FY0  # noqa: E402
from roadset.geom import MATCHLINES, MC00, MM_PER_M, WINDOWS  # noqa: E402
from roadset.titleblock import SHEET_H, SHEET_W, draw_titleblock  # noqa: E402

SHIFT_MM = (1.2, -0.8)
PT = 72 / 25.4

# (plan sheet, discipline, drawing shift in mm, services drawn)
PAGES = [
    (1, "ROADWORKS", (0.0, 0.0), True),
    (2, "ROADWORKS", (0.0, 0.0), True),
    (1, "DRAINAGE", (0.0, 0.0), False),
    (2, "DRAINAGE", SHIFT_MM, False),
]


def match_line(n, shift):
    """The CH 280 match line's ends on plan n, in page points (top-left origin, y down)."""
    ms = MATCHLINES[0][0]
    lo, hi = sheets_plan._match_extent(ms)
    wx0, wy0 = WINDOWS[n]
    out = []
    for off in (lo, hi):
        x, y = MC00.pt(ms, off)
        px = (FX0 + (x - wx0) * MM_PER_M + shift[0]) * PT
        py = (FY0 + (y - wy0) * MM_PER_M + shift[1]) * PT
        out.append([round(px, 3), round(SHEET_H * PT - py, 3)])
    return out


def build(path):
    c = canvas.Canvas(path, pagesize=(SHEET_W * mm, SHEET_H * mm), pageCompression=1, invariant=1)
    c.setTitle("Kestrel Road Upgrade Stage 2 - roadworks and drainage plans (sample)")
    c.setAuthor("Meridian Civil Consulting (fictional)")
    info = []
    for i, (n, disc, shift, services) in enumerate(PAGES, 1):
        truth.page = i
        sheet = dict(BY_KEY["plan%d" % n])
        if disc == "DRAINAGE":
            sheet.update(t1="DRAINAGE PLAN", drg=sheet["drg"].replace("-RW-DRG-00003", "-DR-DRG-00005"))
        sheets_plan.plan_sheet(c, n, shift=shift, services=services)
        data = title_block_data(sheet)
        if disc == "DRAINAGE":
            data["discipline"] = "DRAINAGE"
            data["package"] = "DESIGN PACKAGE DR01  |  DRAINAGE"
        draw_titleblock(c, data)
        c.showPage()
        info.append({"page": i, "plan": n, "discipline": disc, "shiftMm": list(shift), "matchLine": match_line(n, shift)})
    c.save()
    with open(os.path.splitext(path)[0] + ".json", "w", encoding="utf-8", newline="\n") as f:
        json.dump({"page": {"width": round(SHEET_W * PT, 3), "height": round(SHEET_H * PT, 3)}, "pages": info}, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "road-disciplines.pdf"
    build(out)
    print("wrote", out)
