"""Cover sheet, drawing index, general legend, typical sections and setout tables."""
import math

from reportlab.lib.colors import white
from reportlab.lib.units import mm

from . import truth
from .catalog import BY_KEY, SHEETS
from .draw import *  # noqa: F401,F403
from .geom import CULVERT_CH, CULVERT_INV, E0, MC00, MC01, N0, V00, V01, bearing_dms
from .titleblock import F, FB, GREY, INK, NAVY, ORANGE, RED, client_mark, text

CX = (FX0 + FX1) / 2
GREEN_LAND = HexColor("#E3EEDB")
LAND = HexColor("#F2EFE6")
STREET = HexColor("#FFFFFF")
ARTERIAL = HexColor("#F2C879")


# ================================================================== cover
def _locality(c, x, y, w, h):
    rect(c, x, y, w, h, 0.4, INK, LAND)
    c.saveState()
    clip = c.beginPath()
    clip.rect(x * mm, y * mm, w * mm, h * mm)
    c.clipPath(clip, stroke=0, fill=0)
    # street grid
    for i in range(0, int(w), 16):
        pl(c, [(x + i, y), (x + i + 6, y + h)], 0.35, STREET)
    for j in range(0, int(h), 14):
        pl(c, [(x, y + j), (x + w, y + j + 4)], 0.35, STREET)
    # parks
    for px, py, pw, ph in ((0.08, 0.55, 0.16, 0.30), (0.62, 0.12, 0.2, 0.22), (0.38, 0.72, 0.14, 0.2)):
        rect(c, x + px * w, y + py * h, pw * w, ph * h, 0, GREEN_LAND, GREEN_LAND)
    # river
    river = [(x - 5, y + 0.30 * h), (x + 0.18 * w, y + 0.36 * h), (x + 0.30 * w, y + 0.22 * h),
             (x + 0.46 * w, y + 0.18 * h), (x + 0.60 * w, y + 0.30 * h), (x + 0.82 * w, y + 0.26 * h),
             (x + w + 5, y + 0.34 * h)]
    pl(c, river, 7.0, HexColor("#BFE3F7"), cap=1, join=1)
    # arterial roads
    art = [(x - 5, y + 0.78 * h), (x + 0.3 * w, y + 0.70 * h), (x + 0.6 * w, y + 0.74 * h), (x + w + 5, y + 0.64 * h)]
    pl(c, art, 2.6, ARTERIAL, cap=1, join=1)
    pl(c, art, 0.15, HexColor("#C8A04A"), cap=1, join=1)
    art2 = [(x + 0.2 * w, y - 5), (x + 0.28 * w, y + 0.45 * h), (x + 0.24 * w, y + h + 5)]
    pl(c, art2, 2.0, ARTERIAL, cap=1, join=1)
    # the site of work (Kestrel Road) as a bold red dash-dot path
    site = [(x + 0.40 * w, y + 0.52 * h), (x + 0.50 * w, y + 0.52 * h), (x + 0.58 * w, y + 0.46 * h),
            (x + 0.62 * w, y + 0.38 * h), (x + 0.70 * w, y + 0.36 * h), (x + 0.82 * w, y + 0.37 * h)]
    pl(c, site, 1.6, white, cap=1, join=1)
    pl(c, site, 1.0, RED, (5.0, 1.6, 1.0, 1.6), cap=0, join=1)
    c.restoreState()
    rect(c, x, y, w, h, 0.4, INK)
    text(c, x + 0.08 * w + 2, y + 0.84 * h - 1, "HARTLEY PARK", FB, 8, HexColor("#7FA06E"))
    text(c, x + 0.62 * w + 2, y + 0.30 * h, "CORELLA RESERVE", FB, 8, HexColor("#7FA06E"))
    text(c, x + 0.70 * w, y + 0.12 * h, "NORTHGATE", F, 13, HexColor("#8C9199"), "c")
    rtext(c, x + 0.45 * w, y + 0.25 * h - 6, "CORELLA CREEK", -8, F, 8, HexColor("#1D6FE0"), "c")
    text(c, x + 0.12 * w, y + 0.80 * h, "WARATAH HIGHWAY", FB, 9, HexColor("#8C6A1F"))
    rtext(c, x + 0.27 * w, y + 0.12 * h, "MARLOW STREET", 83, FB, 8, HexColor("#8C9199"), "c")
    text(c, x + 0.80 * w, y + 0.45 * h, "IRONBARK AVENUE", FB, 8, HexColor("#8C9199"), "c")
    # site of work callout
    bx, by = x + 0.52 * w, y + 0.60 * h
    pl(c, [(bx, by), (x + 0.545 * w, y + 0.505 * h)], 0.25, INK)
    text(c, bx, by + 2, "SITE OF WORK", FB, 10, INK, "c")
    north_arrow(c, x + w - 14, y + h - 22, 6.5)
    text(c, x + w / 2, y - 7.0, "LOCALITY PLAN", F, 13, INK, "c")
    text(c, x + w / 2, y - 12.0, "NOT TO SCALE", F, 8, INK, "c")


def cover_sheet(c):
    client_mark(c, CX, 548.0, 17)
    text(c, CX, 514.0, "NORTHGATE REGIONAL COUNCIL", F, 36, INK, "c")
    text(c, CX, 478.0, "KESTREL ROAD UPGRADE", FB, 62, INK, "c")
    text(c, CX, 448.0, "STAGE 2", FB, 40, ORANGE, "c")
    text(c, CX, 423.0, "BETWEEN MARLOW STREET AND IRONBARK AVENUE", F, 30, INK, "c")
    text(c, CX, 386.0, "DESIGN PACKAGE RW01", F, 46, INK, "c")
    text(c, CX, 350.0, "ROADWORKS", FB, 58, INK, "c")
    text(c, CX, 320.0, "100% DETAILED DESIGN", F, 34, INK, "c")
    _locality(c, 170.0, 62.0, 330.0, 184.0)
    text(c, 14.0, 17.0, "UNOFFICIAL", F, 24, RED)
    text(c, FX1 - 4.0, 17.0, "FOR REVIEW AND COMMENT", F, 24, RED, "r")
    rect(c, 14.0, 30.0, 126.0, 9.0, 0.3, RED)
    text(c, 77.0, 33.2, "DRAWING COLOUR CODED - PRINT ALL COPIES IN COLOUR", FB, 6.8, RED, "c")


# ================================================================== index
def index_sheet(c):
    cols = [("DRAWING NUMBER", 14.0, 150.0), ("DISCIPLINE", 164.0, 62.0), ("DRAWING TITLE", 226.0, 270.0),
            ("SHEET", 496.0, 54.0), ("SCALE", 550.0, 54.0), ("REV", 604.0, 48.0)]
    text(c, CX, 560.0, "DRAWING INDEX", F, 30, INK, "c")
    y = 545.0
    hh, rh = 12.0, 14.0
    x0, x1 = cols[0][1], cols[-1][1] + cols[-1][2]
    rect(c, x0, y - hh, x1 - x0, hh, 0.35, INK, NAVY)
    for name, cx_, w in cols:
        text(c, cx_ + w / 2, y - hh + 3.8, name, FB, 10, white, "c")
    y -= hh
    groups = [("cover", "index", "legend"), ("ts1", "ts2"), ("plan1", "plan2", "plan3", "plan4", "setout"),
              ("ls1", "ls2", "ls3", "ls4", "ls01"), ("xs1", "xs2", "xs3", "xs4", "xs5", "xs01")]
    by = {s["key"]: s for s in SHEETS}
    for g in groups:
        y -= 4.0
        for key in g:
            s = by[key]
            rect(c, x0, y - rh, x1 - x0, rh, 0.15, RULE)
            for name, cx_, w in cols:
                pl(c, [(cx_, y), (cx_, y - rh)], 0.15, RULE)
            pl(c, [(x1, y), (x1, y - rh)], 0.15, RULE)
            text(c, cols[0][1] + 3.0, y - rh + 4.6, s["drg"], F, 11, INK)
            text(c, cols[1][1] + cols[1][2] / 2, y - rh + 4.6, "ROADWORKS", F, 11, INK, "c")
            text(c, cols[2][1] + 3.0, y - rh + 4.6, s["index_title"], F, 11, INK, max_w=cols[2][2] - 6)
            text(c, cols[3][1] + cols[3][2] / 2, y - rh + 4.6, "SHEET %d" % s["sn"], F, 11, INK, "c")
            text(c, cols[4][1] + cols[4][2] / 2, y - rh + 4.6, s["scale"], F, 11, INK, "c")
            text(c, cols[5][1] + cols[5][2] / 2, y - rh + 4.6, "C", FB, 11, INK, "c")
            c.linkRect("", s["key"], (x0 * mm, (y - rh) * mm, (cols[2][1] + cols[2][2]) * mm, y * mm),
                       relative=0, thickness=0)
            y -= rh
    # status key under the table
    y -= 14.0
    text(c, x0, y, "STATUS KEY", FB, 10, INK)
    for i, ln in enumerate(("S0  DRAFT", "S2  FOR INFORMATION", "S3  FOR REVIEW AND COMMENT",
                            "S4  FOR APPROVAL", "S6  ISSUED FOR CONSTRUCTION")):
        text(c, x0 + 3.0, y - 6.0 - i * 5.2, ln, F, 8.5, INK)
    text(c, 330.0, y, "DRAWING NUMBER FORMAT", FB, 10, INK)
    text(c, 333.0, y - 6.0, "KRU2-MCC-0412-RW-DRG-000000", FB, 9, INK)
    for i, ln in enumerate(("KRU2 = KESTREL ROAD UPGRADE STAGE 2   |   MCC = MERIDIAN CIVIL CONSULTING",
                            "0412 = PROJECT No   |   RW = ROADWORKS   |   DRG = DRAWING",
                            "SIX-DIGIT SERIES: 0000xx GENERAL / 0000xx TYPICALS AND PLANS / 0002xx LONG SECTIONS / 0003xx CROSS SECTIONS")):
        text(c, 333.0, y - 12.0 - i * 5.2, ln, F, 7.8, GREY)


# ================================================================== legend
def _sym(c, kind, x, y):
    """Draw a legend symbol centred at (x + 11, y), 22 mm wide."""
    x0, x1 = x, x + 22
    if kind == "cad":
        pl(c, [(x0, y), (x1, y)], 0.2, CADASTRAL)
    elif kind == "proj":
        pl(c, [(x0, y), (x1, y)], 0.35, PROJECT, (8.0, 1.6, 1.0, 1.6))
    elif kind == "con":
        pl(c, [(x0, y), (x1, y)], 0.35, CONSTR, (8.0, 1.6, 1.0, 1.6))
    elif kind == "low":
        pl(c, [(x0, y), (x1, y)], 0.8, INK)
    elif kind == "ex":
        pl(c, [(x0, y), (x1, y)], 0.2, EXIST, (3.0, 2.0))
    elif kind == "new":
        rect(c, x0, y - 2.2, 22, 4.4, 0, PAVE, PAVE)
        pl(c, [(x0, y - 2.2), (x1, y - 2.2)], 0.3, INK)
        pl(c, [(x0, y + 2.2), (x1, y + 2.2)], 0.3, INK)
    elif kind == "pave":
        rect(c, x0, y - 2.0, 22, 4.0, 0, white, PAVE)
    elif kind == "lab":
        label_box(c, x0 + 6, y, "MCX", 7)
        arrow(c, x0 + 11, y, x1, y, 1.4, 0.15)
    elif kind == "cl":
        pl(c, [(x0, y), (x1, y)], 0.3, INK, (8.0, 1.6, 1.0, 1.6))
    elif kind == "chan":
        pl(c, [(x0, y - 0.9), (x1, y - 0.9)], 0.25, DRAIN)
        pl(c, [(x0, y + 0.9), (x1, y + 0.9)], 0.25, DRAIN)
    elif kind == "culv":
        rect(c, x0, y - 2.2, 22, 4.4, 0.25, DRAIN, CREEKC)
    elif kind == "light":
        circle(c, x0 + 11, y, 1.5, 0.3, INK, white)
        circle(c, x0 + 11, y, 0.3, 0.1, INK, INK)
    elif kind == "path":
        pl(c, [(x0, y - 1.0), (x1, y - 1.0)], 0.15, INK)
        pl(c, [(x0, y + 1.0), (x1, y + 1.0)], 0.15, INK)
    elif kind == "barrier":
        pl(c, [(x0, y), (x1, y)], 0.9, INK)
    elif kind == "rail":
        pl(c, [(x0, y), (x1, y)], 0.3, INK, (1.2, 1.2))
    elif kind == "fence":
        pl(c, [(x0, y), (x1, y)], 0.25, INK, (4.0, 1.0))
    elif kind == "pit":
        rect(c, x0 + 9, y - 1.5, 3.0, 3.0, 0.25, DRAIN, white)
    elif kind == "pole":
        circle(c, x0 + 11, y, 1.3, 0.25, POWER)
    elif kind == "mh":
        circle(c, x0 + 11, y, 1.6, 0.25, SEWER)
        pl(c, [(x0 + 9.4, y), (x0 + 12.6, y)], 0.2, SEWER)
    elif kind == "hyd":
        rect(c, x0 + 9.4, y - 1.4, 2.8, 2.8, 0.25, WATER, white)
    elif kind == "tree":
        circle(c, x0 + 11, y, 2.0, 0.15, HexColor("#9CC48F"), TREE)
    elif kind == "bldg":
        rect(c, x0 + 7, y - 1.6, 8.0, 3.2, 0.15, EXIST, BLDG)
    elif kind == "sew":
        pl(c, [(x0, y), (x1, y)], 0.3, SEWER, (3.0, 2.0))
    elif kind == "wm":
        pl(c, [(x0, y), (x1, y)], 0.3, WATER, (3.0, 2.0))
    elif kind == "uge":
        pl(c, [(x0, y), (x1, y)], 0.3, POWER, (0.6, 1.3))
    elif kind == "tel":
        pl(c, [(x0, y), (x1, y)], 0.3, COMMS, (0.6, 1.3))


def _legend_col(c, x, y, title, rows, label_x=30.0, rh=8.0):
    text(c, x, y, title, F, 13, INK)
    y -= 9.0
    for kind, label in rows:
        _sym(c, kind, x, y)
        text(c, x + label_x, y - 1.2, label, F, 8.5, INK)
        y -= rh
    return y


def legend_sheet(c):
    y = 565.0
    y = _legend_col(c, 22.0, y, "GENERAL", [
        ("cad", "CADASTRAL BOUNDARY"), ("proj", "PROJECT BOUNDARY"), ("con", "CONSTRUCTION BOUNDARY"),
        ("low", "LIMIT OF WORKS"), ("ex", "EXISTING ROAD EDGE"), ("new", "NEW ROAD DESIGN"),
        ("pave", "EXISTING PAVEMENT"), ("lab", "CONTROL LINE ALIGNMENT LABEL"),
        ("cl", "CONTROL LINE ALIGNMENT"), ("chan", "PROPOSED CHANNEL"), ("culv", "NEW CROSS DRAINAGE CULVERT"),
    ]) - 8.0
    y = _legend_col(c, 22.0, y, "ROADWORKS", [
        ("light", "NEW STREET LIGHTING"), ("path", "SHARED PATH / FOOTPATH"), ("barrier", "TYPE F BARRIER"),
        ("rail", "STEEL RAIL BARRIER"), ("fence", "PEDESTRIAN FENCE"), ("pit", "STORMWATER PIT"),
    ]) - 8.0
    _legend_col(c, 22.0, y, "SURVEY LEGEND", [
        ("pole", "POWER POLE"), ("mh", "SEWER MANHOLE"), ("hyd", "WATER HYDRANT"), ("tree", "TREE"),
        ("bldg", "BUILDING"), ("sew", "SEWER"), ("wm", "WATER MAIN"), ("uge", "UNDERGROUND POWER"),
        ("tel", "TELECOMMUNICATIONS"),
    ])
    # general notes
    text(c, 250.0, 565.0, "GENERAL NOTES", F, 13, INK)
    notes = [
        "REDUCED LEVELS ARE TO AUSTRALIAN HEIGHT DATUM (AHD71).",
        "COORDINATE CONTROL IS ON MAP GRID OF AUSTRALIA (MGA ZONE 56, GDA2020).",
        "ALL DIMENSIONS ARE IN METRES UNLESS NOTED OTHERWISE. PAVEMENT THICKNESSES ARE IN MILLIMETRES. ALL LEVELS, COORDINATES AND CHAINAGES ARE EXPRESSED IN METRES.",
        "THIS DRAWING SET IS A FICTIONAL SAMPLE PREPARED TO DEMONSTRATE DOCUMENT CONTROL AND MARKUP WORKFLOWS. IT MUST NOT BE USED FOR CONSTRUCTION.",
        "EXISTING SERVICES ARE SHOWN FROM SURVEY AND DIAL BEFORE YOU DIG RECORDS ONLY. THE CONTRACTOR SHALL CONFIRM POSITION AND DEPTH BY POTHOLING BEFORE EXCAVATION.",
        "CONTROL LINE MC00 IS THE CROWN OF KESTREL ROAD. MC01 IS THE CROWN OF HARTLEY STREET. OFFSETS ARE POSITIVE TO THE RIGHT LOOKING UP CHAINAGE.",
        "KERB AND GUTTER IS TYPE SM2 UNLESS NOTED. REFER TO TYPICAL SECTIONS FOR PAVEMENT COMPOSITION.",
        "STORMWATER PIPES ARE CLASS 2 RCP WITH RUBBER RING JOINTS UNLESS NOTED.",
        "ALL WORKS SHALL BE CARRIED OUT IN ACCORDANCE WITH THE COUNCIL ENGINEERING STANDARDS AND THE SPECIFICATION.",
    ]
    yy = 556.0
    from reportlab.lib.utils import simpleSplit
    for i, n in enumerate(notes, 1):
        text(c, 250.0, yy, "%d." % i, F, 9, INK)
        for ln in simpleSplit(n, F, 9, 340.0 * mm):
            text(c, 260.0, yy, ln, F, 9, INK)
            yy -= 4.4
        yy -= 1.6
    # abbreviations
    yy -= 8.0
    text(c, 250.0, yy, "ABBREVIATIONS", F, 13, INK)
    yy -= 8.0
    ab = [("AC", "ASPHALTIC CONCRETE"), ("AHD", "AUSTRALIAN HEIGHT DATUM"), ("BOK", "BACK OF KERB"),
          ("CH", "CHAINAGE"), ("CL", "CONTROL LINE / CENTRE LINE"), ("DGB", "DENSE GRADED BASE"),
          ("DGS", "DENSE GRADED SUBBASE"), ("EX", "EXISTING"), ("FL", "FLOW LINE"), ("IL", "INVERT LEVEL"),
          ("K&G", "KERB AND GUTTER"), ("MGA", "MAP GRID OF AUSTRALIA"), ("RCBC", "REINFORCED CONCRETE BOX CULVERT"),
          ("RCP", "REINFORCED CONCRETE PIPE"), ("RL", "REDUCED LEVEL"), ("SEW", "SEWER"),
          ("TC / CT", "TANGENT TO CURVE / CURVE TO TANGENT"), ("TEL", "TELECOMMUNICATIONS"),
          ("UGE", "UNDERGROUND ELECTRICAL"), ("WM", "WATER MAIN")]
    half = (len(ab) + 1) // 2
    for i, (a, b) in enumerate(ab):
        col, row = divmod(i, half)
        text(c, 252.0 + col * 200.0, yy - row * 5.4, a, FB, 8.5, INK)
        text(c, 282.0 + col * 200.0, yy - row * 5.4, b, F, 8.5, INK)
    # amendment box bottom right
    rect(c, 470.0, 20.0, 180.0, 40.0, 0.3, INK)
    text(c, 474.0, 52.0, "SHEET REVISION NOTES", FB, 9, INK)
    for i, ln in enumerate(("REV A  50% DETAILED DESIGN - ISSUED FOR COUNCIL REVIEW",
                            "REV B  80% DETAILED DESIGN - SERVICES AND DRAINAGE ADDED",
                            "REV C  100% DETAILED DESIGN - CULVERT AND LEVELS UPDATED")):
        text(c, 474.0, 45.0 - i * 5.5, ln, F, 8, INK)


# ================================================================== typical sections
def _xf_level(off, xl, xr):
    return (xl if off < 0 else xr) * abs(off)


def _typical(c, yb, title, sub, xl, xr, ex_slope, scale=18.0, note=None, mark=None):
    """One 1:50 typical section; yb is the page y of the carriageway crown at the control line."""
    XC_ = 335.0
    k = scale

    def X(o):
        return XC_ + o * k

    def lv(o):
        return _xf_level(o, xl, xr)

    def Y(v):
        return yb + v * k

    kerb, bok = 7.0, 7.45
    p_in = 9.2
    pts = [(-16.0, lv(-12.2) - 0.05), (-12.2, lv(-12.2) + 0.02), (-p_in, lv(-p_in) + 0.02), (-bok, lv(-kerb) + 0.15),
           (-kerb, lv(-kerb)), (-3.5, lv(-3.5)), (0.0, 0.0), (3.5, lv(3.5)), (kerb, lv(kerb)),
           (bok, lv(kerb) + 0.15), (p_in, lv(p_in) + 0.02), (10.7, lv(10.7) + 0.02), (16.0, lv(10.7) - 0.05)]
    # existing ground
    pl(c, [(X(-16.0), Y(-0.35 + ex_slope * -16.0)), (X(16.0), Y(-0.35 + ex_slope * 16.0))], 0.25, INK, (2.5, 1.5))
    text(c, X(-15.8), Y(-0.35 - ex_slope * 16.0) - 6.0, "EXISTING SURFACE", F, 7, INK)
    # pavement layers under the carriageway: 40 AC14, 60 AC20, 150 DGB20, 250 DGS40
    layers = [(0.04, "#6F757D"), (0.10, "#8E949B"), (0.25, "#B9BEC4"), (0.50, "#DDE0E4")]
    prev = 0.0
    for depth, col in layers:
        top = [(X(o), Y(lv(o) - prev)) for o in (-kerb, -3.5, 0.0, 3.5, kerb)]
        bot = [(X(o), Y(lv(o) - depth)) for o in (kerb, 3.5, 0.0, -3.5, -kerb)]
        pl(c, top + bot, 0.15, EXIST, close=True, fill=HexColor(col))
        prev = depth
    # kerb and gutter
    for sgn in (-1, 1):
        kx, bx = X(sgn * kerb), X(sgn * bok)
        base = Y(lv(kerb) - 0.45)
        pl(c, [(kx, Y(lv(kerb))), (bx, Y(lv(kerb) + 0.15)), (bx, base), (kx, base)], 0.2, INK, close=True,
           fill=HexColor("#C9CDD2"))
    # paths
    for a, b in ((-12.2, -p_in), (p_in, 10.7)):
        pl(c, [(X(a), Y(lv(a) + 0.02)), (X(b), Y(lv(b) + 0.02)), (X(b), Y(lv(b) - 0.08)), (X(a), Y(lv(a) - 0.08))],
           0.2, INK, close=True, fill=HexColor("#D5D8DC"))
    # finished surface
    pl(c, [(X(o), Y(v)) for o, v in pts], 0.55, DESIGN_RED)
    # control line
    pl(c, [(X(0.0), Y(0.0) + 3), (X(0.0), Y(0.0) + 36)], 0.3, INK, (8.0, 1.6, 1.0, 1.6))
    text(c, X(0.0), Y(0.0) + 38.5, "CONTROL LINE", F, 7.5, INK, "c")
    # crossfall arrows
    for sgn, g in ((-1, xl), (1, xr)):
        ox = sgn * 1.75
        text(c, X(ox), Y(lv(ox)) + 3.2, "%.1f%%" % abs(g * 100) + (" FALL" if g < 0 else " RISE"), FB, 7, INK, "c")
    # dimension strings
    ytop = Y(max(v for _, v in pts)) + 50.0
    segs = [(-16.0, -12.2, "3.8"), (-12.2, -9.2, "3.0"), (-9.2, -7.45, "1.75"), (-7.45, -7.0, ""),
            (-7.0, -5.0, "2.0"), (-5.0, -3.5, "1.5"), (-3.5, 0.0, "3.5"), (0.0, 3.5, "3.5"),
            (3.5, 5.0, "1.5"), (5.0, 7.0, "2.0"), (7.0, 7.45, ""), (7.45, 9.2, "1.75"), (9.2, 10.7, "1.5"),
            (10.7, 16.0, "5.3")]
    names = {(-16.0, -12.2): "VERGE", (-12.2, -9.2): "SHARED PATH", (-9.2, -7.45): "VERGE",
             (-7.0, -5.0): "PARKING", (-5.0, -3.5): "CYCLE", (-3.5, 0.0): "TRAFFIC LANE", (0.0, 3.5): "TRAFFIC LANE",
             (3.5, 5.0): "CYCLE", (5.0, 7.0): "PARKING", (7.45, 9.2): "VERGE", (9.2, 10.7): "FOOTPATH",
             (10.7, 16.0): "VERGE"}
    for a, b, lab in segs:
        pl(c, [(X(a), ytop - 1.8), (X(a), ytop + 2.0)], 0.15, INK)
        if lab:
            dim_h(c, X(a), X(b), ytop, lab, 7.5)
            nm = names.get((a, b))
            if nm:
                rtext(c, (X(a) + X(b)) / 2 + 1.0, ytop + 5.0, nm, 90, F, 6.4, INK, "l")
    pl(c, [(X(16.0), ytop - 1.8), (X(16.0), ytop + 2.0)], 0.15, INK)
    dim_h(c, X(-16.0), X(16.0), ytop + 24.0, "32.0 ROAD RESERVE", 8.5)
    for xx in (-16.0, 16.0):
        pl(c, [(X(xx), ytop + 22.0), (X(xx), ytop + 26.0)], 0.15, INK)
        pl(c, [(X(xx), Y(-0.3 + ex_slope * xx) + 1), (X(xx), ytop + 22.0)], 0.2, PROJECT, (3.0, 1.6))
    text(c, X(-16.0) + 12.0, ytop + 28.5, "RESERVE BOUNDARY", F, 6.5, PROJECT, "c")
    text(c, X(16.0) - 12.0, ytop + 28.5, "RESERVE BOUNDARY", F, 6.5, PROJECT, "c")
    # layer call-outs on the right
    lx = X(kerb) + 12.0
    ly = Y(-0.25)
    for i, (depth, txt) in enumerate((("0.04", "40 AC14 WEARING COURSE"), ("0.10", "60 AC20 BINDER COURSE"),
                                      ("0.25", "150 DGB20 BASE"), ("0.50", "250 DGS40 SUBBASE"))):
        yy = Y(-float(depth) + 0.04 if i else -0.02)
        px, py = X(5.0), Y(lv(5.0) - [0.02, 0.07, 0.175, 0.375][i])
        tx, ty = X(11.0) + 2.0, Y(-0.55) - i * 5.0 - 6.0
        pl(c, [(px, py), (X(10.8), ty + 1.2), (tx - 1.0, ty + 1.2)], 0.15, INK)
        text(c, tx, ty, txt, F, 7, INK)
    # kerb callout
    pl(c, [(X(-7.2), Y(lv(-7.0)) - 3.5), (X(-8.4), Y(-1.1)), (X(-11.0), Y(-1.1))], 0.15, INK)
    text(c, X(-15.8), Y(-1.1) - 1.0, "TYPE SM2 KERB AND GUTTER", F, 7, INK)
    # titles
    tx = _titled(c, 24.0, Y(0.0) - 44.0, "section", mark, title, sub, 15, 11, 7.0) if mark else 24.0
    if not mark:
        text(c, tx, Y(0.0) - 44.0, title, FB, 15, INK)
        text(c, tx, Y(0.0) - 51.0, sub, F, 11, INK)
    if note:
        for i, ln in enumerate(note):
            text(c, tx, Y(0.0) - 58.0 - i * 4.4, ln, F, 8, GREY)


def _titled(c, x, y, kind, mark, title, sub, size, sub_size, r):
    """A drawing's title with its title bubble in front: the drawing's identifier over the sheet it
    is referenced from. y is the title's baseline. Returns the x the title text starts at."""
    ident, back = mark
    bx, by = x + r, y + size * 0.3528 * 0.35 - r * 0.15
    bb = bubble(c, bx, by, ident, BY_KEY[back]["num"], r)
    tx = x + 2 * r + 4.0
    text(c, tx, y, title, FB, size, INK)
    text(c, tx, y - size * 0.47, sub, F, sub_size, INK)
    tb = truth.text_box(tx, y, title, 0, FB, size)
    truth.target(kind, ident, truth.union(bb, tb))
    # the title bubble's number is the sheet the drawing is cut or called up on: a link back to it
    truth.link(kind, "%s/%s" % (ident, BY_KEY[back]["num"]), bb, [BY_KEY[back]["page"]], ident=ident)
    return tx


def _headwall_elevation(c, x0, y0):
    """Elevation E1: the culvert's upstream headwall seen from the creek, 1:100."""
    k = 10.0
    barrel_w, wall, h = 2.4, 0.3, 1.2
    tw = 3 * barrel_w + 4 * wall
    wing = 2.6
    base = y0
    top = base + (h + 0.6) * k
    # wingwalls splay down to the creek banks
    pl(c, [(x0, base), (x0 + wing * k, base), (x0 + wing * k, top), (x0, base + 0.5 * k)], 0.35, INK, close=True,
       fill=HexColor("#E3E6EA"))
    xr = x0 + (wing + tw) * k
    pl(c, [(xr, base), (xr + wing * k, base), (xr + wing * k, base + 0.5 * k), (xr, top)], 0.35, INK, close=True,
       fill=HexColor("#E3E6EA"))
    # headwall and parapet
    rect(c, x0 + wing * k, base, tw * k, (h + 0.6) * k, 0.4, INK, HexColor("#DDE3EA"))
    rect(c, x0 + wing * k - 1.0, top, tw * k + 2.0, 2.5, 0.3, INK, HexColor("#C9CDD2"))
    for i in range(3):
        bx = x0 + (wing + wall + i * (barrel_w + wall)) * k
        rect(c, bx, base + 0.3 * k, barrel_w * k, h * k, 0.3, DRAIN, white)
    # creek bed and road surface beyond
    pl(c, [(x0 - 6.0, base - 0.5), (xr + wing * k + 6.0, base - 0.5)], 0.25, INK, (2.0, 1.2))
    pl(c, [(x0 + wing * k - 4.0, top + 6.0), (xr + 4.0, top + 6.0)], 0.4, DESIGN_RED)
    text(c, xr + wing * k + 3.0, top + 5.0, "KESTREL ROAD (MC00) BEYOND", F, 6.5, INK)
    text(c, xr + wing * k + 3.0, base + 2.0, "INV RL %.2f" % CULVERT_INV, F, 6.5, INK)
    dim_h(c, x0 + wing * k, xr, base - 6.0, "%.1f" % tw, 7.5)
    _titled(c, x0, base - 18.0, "elevation", ("E1", "plan4"), "ELEVATION E1  CULVERT UPSTREAM HEADWALL",
            "3/2400 x 1200 RCBC AT CH %.2f   SCALE 1:100" % CULVERT_CH, 11, 8.5, 5.5)


def typical_sheet1(c):
    _typical(c, 440.0, "SECTION A-A  TYPICAL SECTION TS01 - KESTREL ROAD (MC00)", "NORMAL CROWN  -  CH 0 TO CH 270 AND CH 840 TO CH 1040   SCALE 1:50",
             -0.03, -0.03, 0.01,
             mark=("A", "plan1"),
             note=["1. PAVEMENT TYPE P1 UNLESS NOTED.  2. KERB AND GUTTER TYPE SM2 BOTH SIDES.",
                   "3. STORMWATER DRAINAGE AT 8.6 m RIGHT, SERVICES IN VERGES AS SHOWN ON PLAN."])
    _typical(c, 190.0, "SECTION B-B  TYPICAL SECTION TS02 - KESTREL ROAD (MC00)", "SUPERELEVATED  -  CH 340 TO CH 530 (RIGHT) AND CH 600 TO CH 790 (LEFT)   SCALE 1:50",
             +0.04, -0.04, 0.0,
             mark=("B", "plan2"),
             note=["1. FULL SUPERELEVATION 4% SHOWN FOR THE RIGHT-HAND CURVE. REVERSE FOR THE LEFT-HAND CURVE.",
                   "2. TRANSITIONS PER THE CROSSFALL BAND ON THE LONGITUDINAL SECTIONS."])


def typical_sheet2(c):
    # --- TS03 side road
    XC2, k = 215.0, 20.0
    yb = 470.0

    def X(o):
        return XC2 + o * k

    def lv(o):
        return -0.03 * abs(o)

    def Y(v):
        return yb + v * k

    pl(c, [(X(-10.0), Y(-0.3)), (X(10.0), Y(-0.3))], 0.25, INK, (2.5, 1.5))
    prev = 0.0
    for depth, col in [(0.04, "#B8BCC2"), (0.09, "#9DA2A9"), (0.20, "#D9DCE0"), (0.40, "#EEF0F2")]:
        top = [(X(o), Y(lv(o) - prev)) for o in (-4.5, 0.0, 4.5)]
        bot = [(X(o), Y(lv(o) - depth)) for o in (4.5, 0.0, -4.5)]
        pl(c, top + bot, 0.15, EXIST, close=True, fill=HexColor(col))
        prev = depth
    for sgn in (-1, 1):
        kx, bx = X(sgn * 4.5), X(sgn * 4.95)
        pl(c, [(kx, Y(lv(4.5))), (bx, Y(lv(4.5) + 0.15)), (bx, Y(lv(4.5) - 0.45)), (kx, Y(lv(4.5) - 0.45))], 0.2,
           INK, close=True, fill=HexColor("#C9CDD2"))
    pl(c, [(X(5.0), Y(lv(4.5) + 0.02)), (X(6.5), Y(lv(4.5) + 0.02)), (X(6.5), Y(lv(4.5) - 0.08)),
           (X(5.0), Y(lv(4.5) - 0.08))], 0.2, INK, close=True, fill=HexColor("#D5D8DC"))
    pts = [(-10.0, -0.15), (-4.95, lv(4.5) + 0.15), (-4.5, lv(4.5)), (0.0, 0.0), (4.5, lv(4.5)), (4.95, lv(4.5) + 0.15),
           (6.5, lv(4.5) + 0.02), (10.0, -0.2)]
    pl(c, [(X(o), Y(v)) for o, v in pts], 0.55, DESIGN_RED)
    pl(c, [(X(0.0), Y(0.0) + 3), (X(0.0), Y(0.0) + 30)], 0.3, INK, (8.0, 1.6, 1.0, 1.6))
    text(c, X(0.0), Y(0.0) + 32.5, "CONTROL LINE", F, 7.5, INK, "c")
    ytop = Y(0.0) + 42.0
    for a, b, lab in ((-10.0, -4.95, "5.05"), (-4.95, -4.5, ""), (-4.5, 0.0, "4.5"), (0.0, 4.5, "4.5"),
                      (4.5, 4.95, ""), (4.95, 6.5, "1.55"), (6.5, 10.0, "3.5")):
        pl(c, [(X(a), ytop - 1.8), (X(a), ytop + 2.0)], 0.15, INK)
        if lab:
            dim_h(c, X(a), X(b), ytop, lab, 7.5)
    pl(c, [(X(10.0), ytop - 1.8), (X(10.0), ytop + 2.0)], 0.15, INK)
    dim_h(c, X(-10.0), X(10.0), ytop + 14.0, "20.0 ROAD RESERVE", 8.5)
    text(c, X(0.0), Y(lv(2.2)) + 3.2, "3.0% FALL", FB, 7, INK, "c")
    _titled(c, 24.0, Y(0.0) - 36.0, "section", ("C", "plan1"), "SECTION C-C  TYPICAL SECTION TS03 - HARTLEY STREET (MC01)",
            "TWO-WAY, NO KERBSIDE PARKING   SCALE 1:50", 14, 11, 6.5)

    # --- pavement table
    tx, ty = 430.0, 562.0
    text(c, tx, ty + 3.0, "PAVEMENT COMPOSITION", FB, 13, INK)
    cols = [("TYPE", 18.0), ("LOCATION", 64.0), ("SURFACING", 50.0), ("BASE", 38.0), ("SUBBASE", 38.0), ("TOTAL", 20.0)]
    rows = [("P1", "KESTREL ROAD", "40 AC14 + 60 AC20", "150 DGB20", "250 DGS40", "500"),
            ("P2", "HARTLEY STREET", "40 AC10 + 50 AC14", "150 DGB20", "200 DGS40", "440"),
            ("P3", "CULVERT APPROACH", "40 AC14 + 60 AC20", "200 CTB", "250 DGS40", "550"),
            ("P4", "SHARED PATH", "100 PLAIN CONCRETE", "100 DGB20", "-", "200"),
            ("P5", "FOOTPATH", "75 PLAIN CONCRETE", "75 DGB20", "-", "150")]
    x = tx
    y = ty - 10.0
    for name, w in cols:
        rect(c, x, y - 9.0, w, 9.0, 0.3, INK, NAVY)
        text(c, x + w / 2, y - 6.2, name, FB, 7.5, white, "c")
        x += w
    y -= 9.0
    for r in rows:
        x = tx
        for (name, w), v in zip(cols, r):
            rect(c, x, y - 9.0, w, 9.0, 0.2, RULE)
            text(c, x + 2.0, y - 6.2, v, F if name != "TYPE" else FB, 7.4, INK, max_w=w - 3.5)
            x += w
        y -= 9.0
    text(c, tx, y - 6.0, "THICKNESSES IN mm. SUBGRADE DESIGN CBR 5%.", F, 7.5, GREY)

    # --- kerb detail 1:10
    _titled(c, 24.0, 318.0, "detail", ("3", "plan4"), "DETAIL 3  KERB AND GUTTER TYPE SM2", "SCALE 1:10", 12, 9, 6.0)
    s = 100.0
    ox, oy = 60.0, 250.0
    outline = [(ox, oy), (ox + 0.60 * s, oy), (ox + 0.60 * s, oy + 0.20 * s), (ox + 0.45 * s, oy + 0.20 * s),
               (ox + 0.45 * s, oy + 0.15 * s), (ox + 0.38 * s, oy + 0.15 * s), (ox + 0.38 * s, oy + 0.275 * s),
               (ox + 0.23 * s, oy + 0.275 * s), (ox + 0.23 * s, oy + 0.15 * s), (ox + 0.0, oy + 0.1 * s)]
    pl(c, outline, 0.35, INK, close=True, fill=HexColor("#E3E6EA"))
    dim_h(c, ox, ox + 0.6 * s, oy - 6.0, "600", 7.5)
    text(c, ox, oy + 0.275 * s + 14.0, "150 MIN COMPACTED DGB20 BEDDING", F, 6.8, INK)
    text(c, ox, oy + 0.275 * s + 9.0, "32 MPa CONCRETE", F, 6.8, INK)
    text(c, ox, oy - 14.0, "GUTTER FALL 5%", F, 6.8, INK)

    # --- pipe trench 1:20
    _titled(c, 190.0, 318.0, "detail", ("1", "plan1"), "DETAIL 1  STORMWATER TRENCH", "SCALE 1:20", 12, 9, 6.0)
    ox, oy = 255.0, 230.0
    s20 = 50.0
    pl(c, [(ox - 1.1 * s20, oy + 1.3 * s20), (ox - 0.7 * s20, oy + 1.3 * s20), (ox - 0.7 * s20, oy), (ox + 0.7 * s20, oy),
           (ox + 0.7 * s20, oy + 1.3 * s20), (ox + 1.1 * s20, oy + 1.3 * s20)], 0.4, INK)
    pl(c, [(ox - 0.7 * s20, oy), (ox + 0.7 * s20, oy), (ox + 0.7 * s20, oy + 0.15 * s20), (ox - 0.7 * s20, oy + 0.15 * s20)],
       0.2, INK, close=True, fill=HexColor("#E3E6EA"))
    circle(c, ox, oy + 0.15 * s20 + 0.225 * s20, 0.225 * s20, 0.5, DRAIN, white)
    text(c, ox, oy + 0.15 * s20 + 0.225 * s20 - 1.2, "RCP", F, 7, DRAIN, "c")
    text(c, ox + 0.78 * s20, oy + 0.15 * s20, "100 MIN BEDDING (20 mm NOMINAL)", F, 6.5, INK)
    text(c, ox + 0.78 * s20, oy + 0.85 * s20, "COMPACTED SELECT BACKFILL", F, 6.5, INK)
    dim_h(c, ox - 0.7 * s20, ox + 0.7 * s20, oy - 6.0, "OD + 600", 7.5)

    # --- path detail
    _titled(c, 440.0, 318.0, "detail", ("2", "plan3"), "DETAIL 2  SHARED PATH", "SCALE 1:20", 12, 9, 6.0)
    ox, oy = 450.0, 270.0
    pl(c, [(ox, oy), (ox + 3.0 * s20, oy), (ox + 3.0 * s20, oy + 0.1 * s20), (ox, oy + 0.1 * s20)], 0.35, INK, close=True,
       fill=HexColor("#D5D8DC"))
    pl(c, [(ox, oy), (ox + 3.0 * s20, oy), (ox + 3.0 * s20, oy - 0.1 * s20), (ox, oy - 0.1 * s20)], 0.2, INK, close=True,
       fill=HexColor("#EEF0F2"))
    dim_h(c, ox, ox + 3.0 * s20, oy + 12.0, "3000", 7.5)
    text(c, ox, oy - 12.0, "100 PLAIN CONCRETE, BROOM FINISH", F, 6.8, INK)
    text(c, ox, oy - 17.0, "100 DGB20 COMPACTED", F, 6.8, INK)
    text(c, ox, oy - 22.0, "2% MAX CROSSFALL TOWARDS KERB", F, 6.8, INK)

    # --- culvert section 1:50
    text(c, 24.0, 175.0, "NEW CULVERT - TYPICAL SECTION", FB, 12, INK)
    text(c, 24.0, 169.0, "3/2400 x 1200 RCBC AT CH 914.82   SCALE 1:50", F, 9, INK)
    ox, oy = 40.0, 60.0
    k50 = 20.0
    barrel_w, wall = 2.4, 0.3
    tw = 3 * barrel_w + 4 * wall
    pl(c, [(ox, oy), (ox + tw * k50, oy), (ox + tw * k50, oy + (1.2 + 0.6) * k50), (ox, oy + (1.2 + 0.6) * k50)],
       0.4, DRAIN, close=True, fill=HexColor("#DDE3EA"))
    for i in range(3):
        x0 = ox + (wall + i * (barrel_w + wall)) * k50
        rect(c, x0, oy + 0.3 * k50, barrel_w * k50, 1.2 * k50, 0.3, DRAIN, white)
    dim_h(c, ox, ox + tw * k50, oy - 8.0, "%.1f" % tw, 7.5)
    dim_h(c, ox + wall * k50, ox + (wall + barrel_w) * k50, oy + 1.8 * k50 + 6.0, "2400", 7.5)
    text(c, ox + tw * k50 + 4.0, oy + 0.9 * k50, "1200 CLEAR HEIGHT", F, 6.8, INK)
    text(c, ox + tw * k50 + 4.0, oy + 0.9 * k50 - 5.0, "300 SLABS AND WALLS", F, 6.8, INK)
    text(c, ox + tw * k50 + 4.0, oy + 0.9 * k50 - 10.0, "100 BLINDING CONCRETE", F, 6.8, INK)

    # --- service allocation table
    cols2 = [("SERVICE", 68.0), ("OFFSET FROM CL", 56.0), ("MIN COVER", 40.0), ("OWNER", 60.0)]
    rows2 = [("SEWER (SEW)", "15.0 LEFT", "1.2 m", "COUNCIL"),
             ("UNDERGROUND POWER (UGE)", "13.4 LEFT", "0.6 m", "ENERGY NETWORK"),
             ("WATER MAIN (WM)", "12.4 RIGHT", "0.75 m", "COUNCIL"),
             ("TELECOMMUNICATIONS (TEL)", "13.6 RIGHT", "0.6 m", "CARRIER"),
             ("STORMWATER D01", "8.6 RIGHT", "0.6 m", "COUNCIL")]
    tx2, ty2 = 330.0, 175.0
    text(c, tx2, ty2 + 3.0, "SERVICE ALLOCATIONS WITHIN RESERVE", FB, 12, INK)
    x = tx2
    y = ty2 - 4.0
    for name, w in cols2:
        rect(c, x, y - 9.0, w, 9.0, 0.3, INK, NAVY)
        text(c, x + w / 2, y - 6.2, name, FB, 7.5, white, "c")
        x += w
    y -= 9.0
    for r in rows2:
        x = tx2
        for (name, w), v in zip(cols2, r):
            rect(c, x, y - 9.0, w, 9.0, 0.2, RULE)
            text(c, x + 2.0, y - 6.2, v, F, 7.4, INK, max_w=w - 3.5)
            x += w
        y -= 9.0

    _headwall_elevation(c, 340.0, 55.0)


# ================================================================== setout tables
def _table(c, x, y, title, cols, rows, rh=8.0, size=7.6):
    text(c, x, y + 2.0, title, FB, 11, INK)
    w = sum(w_ for _, w_ in cols)
    cx_ = x
    for name, cw in cols:
        rect(c, cx_, y - rh - 1.0, cw, rh + 1.0, 0.3, INK, NAVY)
        text(c, cx_ + cw / 2, y - rh + 1.0, name, FB, size, white, "c")
        cx_ += cw
    yy = y - rh - 1.0
    for r in rows:
        cx_ = x
        for (name, cw), v in zip(cols, r):
            rect(c, cx_, yy - rh, cw, rh, 0.15, RULE)
            text(c, cx_ + cw / 2, yy - rh + 2.3, v, F, size, INK, "c", max_w=cw - 2.0)
            cx_ += cw
        yy -= rh
    return yy


def _horiz_rows(al):
    rows = []
    for i, e in enumerate(al.els):
        for tag, s, x, y, b in (("%d" % (len(rows) + 1), e["s0"], e["x0"], e["y0"], e["b0"]),):
            rows.append((("TC" if e["kind"] == "C" else "CT") if e["s0"] > 0 else "START",
                         "%.3f" % s, "%.3f" % (E0 + x), "%.3f" % (N0 + y), bearing_dms(b),
                         "STRAIGHT" if e["kind"] == "S" else ("RIGHT CURVE" if e["turn"] > 0 else "LEFT CURVE"),
                         "-" if e["kind"] == "S" else "%.3f" % e["R"], "%.3f" % (e["s1"] - e["s0"])))
    e = al.els[-1]
    rows.append(("END", "%.3f" % e["s1"], "%.3f" % (E0 + e["x1"]), "%.3f" % (N0 + e["y1"]), bearing_dms(e["b1"]),
                 "-", "-", "-"))
    return rows


def setout_sheet(c):
    hcols = [("PT", 28.0), ("CHAINAGE", 34.0), ("EASTING", 40.0), ("NORTHING", 44.0), ("BEARING", 36.0),
             ("ELEMENT", 36.0), ("RADIUS", 26.0), ("LENGTH", 28.0)]
    text(c, 14.0, 568.0, "MAIN CONTROL LINES SETOUT TABLES", F, 20, INK)
    y = _table(c, 14.0, 548.0, "CONTROL LINE MC00 - HORIZONTAL ALIGNMENT", hcols, _horiz_rows(MC00)) - 10.0
    y = _table(c, 14.0, y, "CONTROL LINE MC01 - HORIZONTAL ALIGNMENT", hcols, _horiz_rows(MC01)) - 10.0
    vcols = [("PVI", 28.0), ("CHAINAGE", 34.0), ("RL", 30.0), ("GRADE IN %", 34.0), ("GRADE OUT %", 36.0),
             ("CURVE L", 32.0), ("K VALUE", 30.0), ("TYPE", 32.0)]
    vrows = []
    for i, (s, rl, L) in enumerate(V00.pvis):
        gi = V00.grades[i - 1] * 100 if i > 0 else None
        go = V00.grades[i] * 100 if i < len(V00.grades) else None
        cv = [cv_ for cv_ in V00.curves if cv_["s"] == s]
        vrows.append(("PVI%02d" % i, "%.3f" % s, "%.3f" % rl, "-" if gi is None else "%+.3f" % gi,
                      "-" if go is None else "%+.3f" % go, "%.3f" % L if L else "-",
                      "%.2f" % cv[0]["K"] if cv else "-", cv[0]["kind"] if cv else "-"))
    y = _table(c, 14.0, y, "CONTROL LINE MC00 - VERTICAL ALIGNMENT", vcols, vrows, 7.4) - 10.0
    v1 = []
    for i, (s, rl, L) in enumerate(V01.pvis):
        gi = V01.grades[i - 1] * 100 if i > 0 else None
        go = V01.grades[i] * 100 if i < len(V01.grades) else None
        cv = [cv_ for cv_ in V01.curves if cv_["s"] == s]
        v1.append(("PVI%02d" % i, "%.3f" % s, "%.3f" % rl, "-" if gi is None else "%+.3f" % gi,
                   "-" if go is None else "%+.3f" % go, "%.3f" % L if L else "-",
                   "%.2f" % cv[0]["K"] if cv else "-", cv[0]["kind"] if cv else "-"))
    _table(c, 14.0, y, "CONTROL LINE MC01 - VERTICAL ALIGNMENT", vcols, v1, 7.4)
    # 20 m stations
    scols = [("CHAINAGE", 28.0), ("EASTING", 36.0), ("NORTHING", 40.0), ("BEARING", 32.0), ("DESIGN RL", 26.0)]
    rows = []
    for s in range(0, 1041, 20):
        x, yy, b = MC00.at(s)
        rows.append(("%.3f" % s, "%.3f" % (E0 + x), "%.3f" % (N0 + yy), bearing_dms(b), "%.3f" % V00.level(s)))
    # two side-by-side halves
    half = (len(rows) + 1) // 2
    _table(c, 408.0, 548.0, "MC00 STATIONS AT 20 m (1 OF 2)", scols, rows[:half], 7.6, 7.2)
    _table(c, 408.0, 548.0 - 8.0 * (half + 3.5), "MC00 STATIONS AT 20 m (2 OF 2)", scols, rows[half:], 7.6, 7.2)
