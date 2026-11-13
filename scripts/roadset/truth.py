"""Ground truth: every cross-reference the set draws, written down as it is drawn.

Sheet code calls `link(...)` next to each callout, title mark, match-line label and chainage it
draws. `make_road_set.py` writes the list to JSON beside the PDF, and `pnpm standards:bench`
scores link detection against it.

Rectangles are stored in PDF points from the page's top-left corner (y down), the page space
redcolumn's text layer uses. Drawing code works in millimetres from the bottom-left.
"""
import json
import math

from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth

from .titleblock import SHEET_H

PT = mm  # points per millimetre

# The page being drawn (1-based), set by the build loop.
page = 0
LINKS = []
# Where each titled drawing sits: (kind, id, sheet key) -> (page, rect in points).
TARGETS = {}


def _rect_pt(x0, y0, x1, y1):
    """A rectangle in mm from the bottom-left as [x, y, w, h] in points from the top-left."""
    xa, xb = sorted((x0, x1))
    ya, yb = sorted((y0, y1))
    return [round(xa * PT, 2), round((SHEET_H - yb) * PT, 2), round((xb - xa) * PT, 2), round((yb - ya) * PT, 2)]


def box(x0, y0, x1, y1):
    return (x0, y0, x1, y1)


def circle_box(x, y, r):
    return (x - r, y - r, x + r, y + r)


def text_box(x, y, s, ang=0.0, font="Helvetica", size=8, align="l"):
    """The bounds of text drawn by draw.rtext (baseline origin at x, y; rotated by ang degrees)."""
    w = stringWidth(s, font, size) / mm
    h = size * 0.3528 * 0.75
    dx = {"l": 0.0, "c": -w / 2, "r": -w}[align]
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for u, v in ((dx, -h * 0.25), (dx + w, -h * 0.25), (dx + w, h), (dx, h)):
        pts.append((x + u * ca - v * sa, y + u * sa + v * ca))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def union(*boxes):
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def target(kind, ident, b):
    """Records where a titled drawing (section, detail, elevation) is, on the page being drawn."""
    TARGETS[(kind, ident)] = (page, _rect_pt(*b))


def link(kind, label, b, target_pages, ident=None, target_key=None, alignment=None, value=None, optional=False):
    """Records a reference drawn on the current page.

    kind: section | detail | elevation | matchline | chainage.
    target_pages: 1-based pages any of which is a right answer (a chainage on a plan can be shown
    on two overlapping plan sheets). For callouts pointing at a titled drawing, pass target_key
    (kind, id) instead and the page is filled in once the set is drawn.
    optional: a link here is right if it goes to one of target_pages, but finding none is not a miss.
    """
    LINKS.append(dict(kind=kind, label=label, page=page, rect=_rect_pt(*b), targetPages=list(target_pages),
                      id=ident, targetKey=list(target_key) if target_key else None,
                      alignment=alignment, value=value, optional=optional))


def write(path, sheets):
    out = []
    for l in LINKS:
        l = dict(l)
        key = l.pop("targetKey")
        l["targetRect"] = None
        if key:
            pg, rect = TARGETS[tuple(key)]
            l["targetPages"] = [pg]
            l["targetRect"] = rect
        # 0-based pages, as the app counts them
        l["pageIndex"] = l.pop("page") - 1
        l["targetPages"] = [p - 1 for p in l["targetPages"]]
        out.append(l)
    doc = {
        "about": "Ground-truth cross-references in kestrel-road-set.pdf, written by scripts/make_road_set.py. "
                 "Pages are 0-based; rects are [x, y, w, h] in PDF points from the page's top-left.",
        "sheets": [dict(pageIndex=s["page"] - 1, number=s["drg"], title="%s %s" % (s["t1"], s["t2"])) for s in sheets],
        "links": out,
        "chainages": coverage(),
    }
    with open(path, "w", newline="\n") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")


def coverage():
    """Per alignment, the stretch each plan sheet shows and the chainages each cross-section sheet
    draws (0-based pages), so a chainage written anywhere (a note, a long section) can be judged."""
    from .geom import MC00, MC01, XS_SHEETS, plan_pages
    from .catalog import BY_KEY
    out = {}
    for al in (MC00, MC01):
        spans = {}
        s = 0.0
        while s <= al.length + 1e-6:
            for p in plan_pages(al, s):
                lo, hi = spans.get(p, (s, s))
                spans[p] = (min(lo, s), max(hi, s))
            s += 1.0
        out[al.name] = {
            "plans": [dict(pageIndex=p - 1, **{"from": lo, "to": hi}) for p, (lo, hi) in sorted(spans.items())],
            "sections": [dict(pageIndex=BY_KEY[k]["page"] - 1, values=v) for k, (a, v) in XS_SHEETS.items() if a == al.name],
        }
    return out
