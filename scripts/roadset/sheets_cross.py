"""Cross sections, four per sheet, 1:100 horizontal and vertical: MC00 at 50 m centres, then MC01."""
import math

from reportlab.lib.colors import white
from reportlab.lib.units import mm

from .draw import *  # noqa: F401,F403
from . import truth
from .geom import HALF_W, MC00, MC01, V00, V01, XS_SHEETS, crossfall, daylight, design_section, ground, plan_pages
from .titleblock import F, FB, INK, text

SCALE = 10.0  # mm per metre (1:100)
LABEL_X0, LABEL_X1 = 12.0, 46.0
XC = 286.0  # page x of the control line
HALF_RANGE = 24.0
ROW_H = 14.0
ROWS = ["DESIGN STRINGS", "DESIGN LEVELS", "EXISTING LEVELS", "DESIGN OFFSETS"]
LINE = HexColor("#D5D9DD")
PITCH = 141.0
SERVICES = [  # offset, depth to centre, diameter, tag, colour
    (-15.0, 1.8, 0.225, "SEW", SEWER), (-13.4, 0.9, 0.100, "UGE", POWER),
    (12.4, 1.1, 0.150, "WM", WATER), (13.6, 0.7, 0.075, "TEL", COMMS),
    (8.6, 1.9, 0.375, "D01", DRAIN),
]


ALIGNMENTS = {"MC00": (MC00, V00), "MC01": (MC01, V01)}


def sections_for(n):
    return XS_SHEETS["xs%d" % n][1]


def draw_xs(c, ch, cell, al=MC00, vert=V00):
    yc0 = 580.0 - PITCH * (cell + 1) + 8.0
    tb = yc0 + 10.0
    ttop = tb + ROW_H * len(ROWS)
    pts, rl = design_section(al, vert, ch)
    left_out, right_out = pts[0], pts[-1]
    dl_l = daylight(al, ch, -1, left_out[0], left_out[1])
    dl_r = daylight(al, ch, +1, right_out[0], right_out[1])
    exg = [(o, ground(*al.pt(ch, o))) for o in range(-int(HALF_RANGE), int(HALF_RANGE) + 1)]
    lo = min([g for _, g in exg] + [p[1] for p in pts] + [dl_l[1], dl_r[1]])
    datum = math.floor(lo - 0.6)

    def X(o):
        return XC + o * SCALE

    def Y(v):
        return ttop + (v - datum) * SCALE

    # ---- table
    rect(c, LABEL_X0, tb, 526.0 - LABEL_X0, ROW_H * len(ROWS), 0.35, INK)
    pl(c, [(LABEL_X1, tb), (LABEL_X1, ttop)], 0.35, INK)
    for i, name in enumerate(ROWS):
        y = ttop - ROW_H * i
        if i:
            pl(c, [(LABEL_X0, y), (526.0, y)], 0.25, INK)
        text(c, LABEL_X0 + 2.0, y - ROW_H / 2 - 1.0, name, F, 6.4, INK)
    text(c, LABEL_X0 + 1.0, ttop + 3.0, "DATUM %.1f" % datum, F, 8, INK)

    # ---- clip the graphic to the section window
    c.saveState()
    cl = c.beginPath()
    cl.rect(LABEL_X1 * mm, ttop * mm, (526.0 - LABEL_X1) * mm, (PITCH - 24.0) * mm)
    c.clipPath(cl, stroke=0, fill=0)

    # existing ground
    pl(c, [(X(o), Y(g)) for o, g in exg], 0.25, INK, (2.0, 1.2))
    # cadastral and project boundaries
    for off, col, lab in ((-16.0, CADASTRAL, "CADASTRAL BDY"), (16.0, CADASTRAL, "CADASTRAL BDY"),
                          (-22.0, PROJECT, "PROJECT BDY"), (22.0, PROJECT, "PROJECT BDY")):
        g = ground(*al.pt(ch, off))
        pl(c, [(X(off), Y(g)), (X(off), Y(g) + 9.0)], 0.2, col, (3.0, 1.5) if col == PROJECT else None)
        rtext(c, X(off) + 1.0, Y(g) + 10.0, lab, 90, F, 5.8, col, "l")
    # buried services
    for off, depth, dia, tag, col in (SERVICES if al is MC00 else []):
        g = ground(*al.pt(ch, off))
        r = max(0.9, dia * SCALE / 2)
        circle(c, X(off), Y(g - depth), r, 0.3, col)
        rtext(c, X(off) + r + 0.9, Y(g - depth) - 1.0, tag, 0, FB, 5.2, col, "l")
    # pavement build-up under the carriageway
    top = [(X(o), Y(v)) for o, v, code in pts if -HALF_W <= o <= HALF_W]
    bot = [(x, y - 0.55 * SCALE) for x, y in reversed(top)]
    pl(c, top + bot, 0.15, EXIST, close=True, fill=HATCH)
    for sgn in (-1, 1):
        a = [p for p in pts if p[2] in ("BOK",) and p[0] * sgn > 0][0]
        k = [p for p in pts if p[2] == "KERB" and p[0] * sgn > 0][0]
        pl(c, [(X(k[0]), Y(k[1]) - 0.25 * SCALE), (X(a[0]), Y(a[1]) - 0.25 * SCALE), (X(a[0]), Y(a[1])),
               (X(k[0]), Y(k[1]) + 0.0)], 0.1, INK, close=True, fill=INK)
    # path slabs
    for a, b in ((pts[0], pts[1]), (pts[-2], pts[-1])):
        pl(c, [(X(a[0]), Y(a[1])), (X(b[0]), Y(b[1])), (X(b[0]), Y(b[1]) - 0.1 * SCALE),
               (X(a[0]), Y(a[1]) - 0.1 * SCALE)], 0.1, EXIST, close=True, fill=HATCH)
    # design surface, including the batters out to existing ground
    surf = [(X(dl_l[0]), Y(dl_l[1]))] + [(X(o), Y(v)) for o, v, code in pts] + [(X(dl_r[0]), Y(dl_r[1]))]
    pl(c, surf, 0.5, DESIGN_RED)
    # control line
    gcl = Y(rl)
    pl(c, [(X(0.0), gcl + 1.0), (X(0.0), gcl + 22.0)], 0.3, INK, (6.0, 1.5, 1.0, 1.5))
    label_box(c, X(0.0), gcl + 25.0, al.name, 7)
    # crossfall tags
    sl, sr = crossfall(ch) if al is MC00 else (-0.03, -0.03)
    for sgn, g in ((-1, sl), (1, sr)):
        text(c, X(sgn * 1.75), Y(rl + g * 1.75 * 1.0) + 3.0, "%+.1f%%" % (g * 100), F, 6.5, INK, "c")
    c.restoreState()

    # ---- table content at every string point and at each daylight point
    stations = [(o, v, code) for o, v, code in pts]
    stations = [(dl_l[0], dl_l[1], "DAYLIGHT")] + stations + [(dl_r[0], dl_r[1], "DAYLIGHT")]
    for o, v, code in stations:
        if abs(o) > HALF_RANGE:
            continue
        x = X(o)
        pl(c, [(x, tb), (x, ttop)], 0.1, LINE)
        g = ground(*al.pt(ch, o))
        txtx = x + 0.9
        rtext(c, txtx, ttop - ROW_H / 2, code, 90, F, 5.6, INK, "c")
        rtext(c, txtx, ttop - ROW_H * 1.5, "%.3f" % v, 90, F, 6.4, INK, "c")
        rtext(c, txtx, ttop - ROW_H * 2.5, "%.3f" % g, 90, F, 6.4, INK, "c")
        rtext(c, txtx, ttop - ROW_H * 3.5, "%.3f" % o, 90, F, 6.4, INK, "c")
    # drop lines from the design surface to the table for the main points
    for o, v, code in pts:
        pl(c, [(X(o), Y(v)), (X(o), ttop)], 0.08, LINE)

    label = "CHAINAGE %d" % ch
    text(c, XC, yc0 + 1.5, label, FB, 12, INK, "c")
    truth.link("chainage", label, truth.text_box(XC, yc0 + 1.5, label, 0, FB, 12, "c"), plan_pages(al, ch),
               alignment=al.name, value=float(ch))
    text(c, X(HALF_RANGE) , yc0 + 1.5, "SCALE 1:100", F, 6.5, INK, "r")


def _legend(c, x, y_top, w=130.0):
    rows = [("EXISTING SURFACE", "ex"), ("DESIGN SURFACE", "des"), ("NEW PAVEMENT", "pave"),
            ("KERB AND GUTTER", "kerb"), ("PROPOSED DRAINAGE (D01)", "dr"),
            ("EXISTING SEWER (SEW)", "sew"), ("EXISTING WATER MAIN (WM)", "wm"),
            ("EXISTING UNDERGROUND POWER (UGE)", "uge"), ("EXISTING TELECOMMUNICATIONS (TEL)", "tel"),
            ("CADASTRAL BOUNDARY", "cad"), ("PROJECT BOUNDARY", "proj")]
    h = 12 + len(rows) * 5.4
    rect(c, x, y_top - h, w, h, 0.25, INK, white)
    text(c, x + 4, y_top - 7.5, "LEGEND", FB, 10, INK)
    y = y_top - 14.5
    for label, kind in rows:
        x0, x1, ym = x + 4, x + 26, y + 1.0
        if kind == "ex":
            pl(c, [(x0, ym), (x1, ym)], 0.25, INK, (2.0, 1.2))
        elif kind == "des":
            pl(c, [(x0, ym), (x1, ym)], 0.5, DESIGN_RED)
        elif kind == "pave":
            rect(c, x0, ym - 1.2, x1 - x0, 2.4, 0.15, EXIST, HATCH)
        elif kind == "kerb":
            rect(c, x0 + 6, ym - 1.4, 4.5, 2.8, 0.1, INK, INK)
        elif kind == "dr":
            circle(c, x0 + 6, ym, 1.6, 0.3, DRAIN)
        elif kind in ("sew", "wm", "uge", "tel"):
            col = {"sew": SEWER, "wm": WATER, "uge": POWER, "tel": COMMS}[kind]
            circle(c, x0 + 6, ym, 1.2, 0.3, col)
        elif kind == "cad":
            pl(c, [(x0, ym), (x1, ym)], 0.2, CADASTRAL)
        elif kind == "proj":
            pl(c, [(x0, ym), (x1, ym)], 0.35, PROJECT, (3.0, 1.5))
        text(c, x + 31, ym - 0.9, label, F, 6.6, INK)
        y -= 5.4
    return y_top - h


def xs_sheet(c, n):
    key = n if isinstance(n, str) else "xs%d" % n
    name, chs = XS_SHEETS[key]
    al, vert = ALIGNMENTS[name]
    for i, ch in enumerate(chs):
        draw_xs(c, ch, i, al, vert)
    y = _legend(c, 530.0, 583.0) - 3.0
    h = 10 + 4 * 8.2
    rect(c, 530.0, y - h, 130.0, h, 0.25, INK, white)
    sheet_note_box(c, 534.0, y - 1.5, 124.0, "NOTES", [
        "FOR ROADWORKS ALIGNMENT CONTROL PLANS REFER TO DRAWINGS RW-DRG-000031 TO 000034.",
        "SECTIONS ARE VIEWED LOOKING UP CHAINAGE. LEFT IS ON THE LEFT.",
        "LEVELS ARE IN METRES AHD71. OFFSETS ARE FROM CONTROL LINE %s." % name,
    ], 6.6, 3.0)
    y -= h + 6.0
    scale_bar(c, 536.0, y - 12.0, SCALE, [0, 2, 4, 8], "m", "SCALE 1:100")
    y -= 24.0
    # key plan
    kh, kw = 76.0, 130.0
    rect(c, 530.0, y - kh, kw, kh, 0.25, INK, white)
    text(c, 534.0, y - 7.0, "KEY PLAN", FB, 9, INK)
    text(c, 530.0 + kw - 4, y - 7.0, "NOT TO SCALE", F, 5.5, INK, "r")
    k = (kw - 12) / 1010.0
    ox, oy = 536.0, y - kh + 4
    pl(c, [(ox + px * k, oy + py * k) for px, py in MC00.poly(0, step=6.0)], 0.4, INK)
    pl(c, [(ox + px * k, oy + py * k) for px, py in MC01.poly(0, step=6.0)], 0.3, INK)
    for other, (oname, ochs) in XS_SHEETS.items():
        oal = ALIGNMENTS[oname][0]
        for ch in ochs:
            x1, y1 = oal.pt(ch, -6.0)
            x2, y2 = oal.pt(ch, 6.0)
            cur = other == key
            pl(c, [(ox + x1 * k, oy + y1 * k), (ox + x2 * k, oy + y2 * k)], 0.9 if cur else 0.3,
               ORANGE if cur else EXIST)
    for ch in chs:
        x, yy = al.pt(ch, -10.0)
        text(c, ox + x * k, oy + yy * k + 1.2, "%d" % ch, F, 5.5, INK, "c")
