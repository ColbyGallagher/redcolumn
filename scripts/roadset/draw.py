"""Small drawing helpers shared by the sheet modules. All coordinates are mm on the page."""
import math

from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth

from .titleblock import F, FB, GREY, INK, NAVY, ORANGE, PALE, RED, RULE, fit_size, text

# drawing area inside the sheet frame (left of the title block strip)
FX0, FY0, FX1, FY1 = 10.0, 10.0, 661.0, 584.0

CADASTRAL = HexColor("#7FB6E0")
PROJECT = HexColor("#B5179E")
CONSTR = HexColor("#E02424")
LIMIT = HexColor("#D97706")
EXIST = HexColor("#A8A8A8")
PAVE = HexColor("#E4E6E8")
DRAIN = HexColor("#1D6FE0")
SEWER = HexColor("#E08A1E")
WATER = HexColor("#2B8CE0")
POWER = HexColor("#D62828")
COMMS = HexColor("#8E44AD")
TREE = HexColor("#D5ECCB")
BLDG = HexColor("#D2D4D6")
CREEKC = HexColor("#BFE3F7")
LABEL_GREEN = HexColor("#2ED47A")
DESIGN_RED = HexColor("#D62828")
HATCH = HexColor("#C9CDD2")


def pl(c, pts, lw=0.25, color=INK, dash=None, close=False, fill=None, cap=0, join=0):
    """Polyline / polygon through mm points."""
    if len(pts) < 2:
        return
    p = c.beginPath()
    p.moveTo(pts[0][0] * mm, pts[0][1] * mm)
    for x, y in pts[1:]:
        p.lineTo(x * mm, y * mm)
    if close:
        p.close()
    c.setLineWidth(lw * mm)
    c.setLineCap(cap)
    c.setLineJoin(join)
    c.setStrokeColor(color)
    if fill is not None:
        c.setFillColor(fill)
    if dash:
        c.setDash([d * mm for d in dash])
    c.drawPath(p, stroke=1 if lw > 0 else 0, fill=1 if fill is not None else 0)
    if dash:
        c.setDash([])


def rect(c, x, y, w, h, lw=0.2, color=INK, fill=None, dash=None):
    """Rectangle with lower-left corner (x, y)."""
    pl(c, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], lw, color, dash, True, fill)


def circle(c, x, y, r, lw=0.2, color=INK, fill=None):
    c.setLineWidth(lw * mm)
    c.setStrokeColor(color)
    if fill is not None:
        c.setFillColor(fill)
    c.circle(x * mm, y * mm, r * mm, stroke=1 if lw > 0 else 0, fill=1 if fill is not None else 0)


def rtext(c, x, y, s, ang=0.0, font=F, size=8, color=INK, align="l", max_w=None):
    """Text with its baseline origin at (x, y) rotated by ang degrees."""
    if max_w:
        size = fit_size(s, font, size, max_w)
    c.saveState()
    c.translate(x * mm, y * mm)
    c.rotate(ang)
    c.setFont(font, size)
    c.setFillColor(color)
    if align == "l":
        c.drawString(0, 0, s)
    elif align == "r":
        c.drawRightString(0, 0, s)
    else:
        c.drawCentredString(0, 0, s)
    c.restoreState()


def readable(ang):
    """Flip an angle (deg) so text reading along it is never upside down."""
    ang = (ang + 180.0) % 360.0 - 180.0
    if ang > 90.0:
        ang -= 180.0
    elif ang <= -90.0:
        ang += 180.0
    return ang


def twidth(s, font=F, size=8):
    return stringWidth(s, font, size) / mm


def arrow(c, x1, y1, x2, y2, size=2.2, lw=0.2, color=INK, both=False):
    pl(c, [(x1, y1), (x2, y2)], lw, color)
    for (ax, ay, bx, by) in ([(x2, y2, x1, y1)] + ([(x1, y1, x2, y2)] if both else [])):
        a = math.atan2(by - ay, bx - ax)
        p1 = (ax + size * math.cos(a + 0.22), ay + size * math.sin(a + 0.22))
        p2 = (ax + size * math.cos(a - 0.22), ay + size * math.sin(a - 0.22))
        pl(c, [(ax, ay), p1, p2], 0, color, close=True, fill=color)


def dim_h(c, x1, x2, y, label, size=6.5, color=INK, lw=0.15, ext=None, above=True):
    """Horizontal dimension with arrowheads and a centred label."""
    arrow(c, x1, y, x2, y, 1.6, lw, color, both=True)
    if ext is not None:
        for x in (x1, x2):
            pl(c, [(x, y - 1.0), (x, ext)], lw, color)
    cx = (x1 + x2) / 2
    w = twidth(label, F, size)
    if w + 2 > abs(x2 - x1):  # no room inside: put it above
        text(c, cx, y + 1.2, label, F, size, color, "c")
    else:
        text(c, cx, y + 0.8, label, F, size, color, "c")


def north_arrow(c, x, y, r=10.0):
    circle(c, x, y, r, 0.3, INK)
    pl(c, [(x, y + r * 0.95), (x + r * 0.42, y - r * 0.55), (x, y - r * 0.2), (x - r * 0.42, y - r * 0.55)],
       0.2, INK, close=True, fill=INK)
    pl(c, [(x, y + r * 0.95), (x + r * 0.42, y - r * 0.55), (x, y - r * 0.2)], 0, INK, close=True, fill=white)
    text(c, x, y + r + 1.8, "N", FB, 9, INK, "c")


def scale_bar(c, x, y, mm_per_unit, marks, unit_label, title, size=6.5):
    """Alternating black/white scale bar. marks: list of distances (m)."""
    h = 1.6
    for i in range(len(marks) - 1):
        x0 = x + marks[i] * mm_per_unit
        x1 = x + marks[i + 1] * mm_per_unit
        rect(c, x0, y, x1 - x0, h, 0.15, INK, INK if i % 2 == 0 else white)
        text(c, x0, y + h + 1.0, "%g" % marks[i], F, size, INK, "c")
    text(c, x + marks[-1] * mm_per_unit, y + h + 1.0, "%g%s" % (marks[-1], unit_label), F, size, INK, "c")
    text(c, x, y - 3.6, title, F, size, INK, "l")
    text(c, x + marks[-1] * mm_per_unit, y - 3.6, "@A1", F, size, INK, "r")


def label_box(c, x, y, s, size=7.5, fill=LABEL_GREEN):
    """Green alignment label, centred on (x, y). Returns (w, h)."""
    w = twidth(s, FB, size) + 2.4
    h = size / 2.835 + 1.4
    rect(c, x - w / 2, y - h / 2, w, h, 0.2, INK, fill)
    text(c, x, y - size / 2.835 * 0.35, s, FB, size, INK, "c")
    return w, h


def title_text(c, x, y, s, size=13, align="l"):
    text(c, x, y, s, FB, size, INK, align)


def sheet_note_box(c, x, y_top, w, title, lines, size=6.6, lead=3.1):
    """Heading plus numbered notes. Returns y of the bottom."""
    text(c, x, y_top - 3.5, title, FB, 8.5, INK)
    y = y_top - 8.0
    from reportlab.lib.utils import simpleSplit
    for i, ln in enumerate(lines, 1):
        parts = simpleSplit(ln, F, size, (w - 7) * mm)
        text(c, x, y, "%d." % i, F, size, INK)
        for p in parts:
            text(c, x + 5, y, p, F, size, INK)
            y -= lead
        y -= 0.8
    return y
