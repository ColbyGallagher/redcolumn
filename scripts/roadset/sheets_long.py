"""Longitudinal sections (MC00 x4, MC01) and the D01 drainage long section.

Horizontal 1:500 (2 mm per metre), vertical 1:100 (10 mm per metre).
"""
import math

from reportlab.lib.colors import white

from .draw import *  # noqa: F401,F403
from .geom import CULVERT_CH, CULVERT_INV, MC00, MC01, V00, V01, crossfall, ground
from .site import site
from .titleblock import F, FB, INK, text

HS, VS = 2.0, 10.0
XL = 100.0  # page x of the chainage start (right of the label column)
LABEL_X = 12.0
LINE = HexColor("#D5D9DD")
GREYTXT = HexColor("#555B63")

ROWS = [("VERTICAL ALIGNMENT", 22.0, "va"), ("HORIZONTAL ALIGNMENT", 17.0, "ha"),
        ("CROSSFALL", 12.0, "cf"), ("DESIGN LEVELS", 25.0, "dl"),
        ("EXISTING LEVELS", 25.0, "el"), ("CHAINAGE", 25.0, "ch")]

UTIL = [  # chainage, depth below ground to centre, diameter, label, colour
    (95.0, 1.5, 0.225, "225 SEW", SEWER), (212.0, 1.1, 0.100, "TEL DUCT", COMMS),
    (388.0, 1.2, 0.150, "150 WM", WATER), (602.0, 1.6, 0.225, "225 SEW", SEWER),
    (745.0, 0.9, 0.100, "11kV UGE", POWER), (853.0, 1.3, 0.150, "150 WM", WATER),
]


def _stations(s0, s1, step=10.0):
    out = [s0]
    s = math.floor(s0 / step) * step + step
    while s < s1 - 0.01:
        out.append(s)
        s += step
    out.append(s1)
    return out


def _legend(c, x, y_top, w=130.0):
    rows = [("DESIGN SURFACE", "des"), ("EXISTING SURFACE", "ex"), ("PROPOSED DRAINAGE", "dr"),
            ("EXISTING SEWER / WATER MAIN", "sew"), ("EXISTING UNDERGROUND POWER", "uge"),
            ("EXISTING TELECOMMUNICATIONS", "tel"), ("STRUCTURE (SHOWN INDICATIVELY)", "st")]
    h = 12 + len(rows) * 5.4
    rect(c, x, y_top - h, w, h, 0.25, INK, white)
    text(c, x + 4, y_top - 7.5, "LEGEND", FB, 10, INK)
    y = y_top - 14.5
    for label, kind in rows:
        x0, x1, ym = x + 4, x + 26, y + 1.0
        if kind == "des":
            pl(c, [(x0, ym), (x1, ym)], 0.5, DESIGN_RED)
        elif kind == "ex":
            pl(c, [(x0, ym), (x1, ym)], 0.25, INK, (2.0, 1.2))
        elif kind == "dr":
            circle(c, x0 + 3, ym, 1.4, 0.3, DRAIN)
            circle(c, x0 + 8, ym, 1.4, 0.3, DRAIN)
        elif kind == "sew":
            circle(c, x0 + 3, ym, 1.4, 0.3, SEWER)
            circle(c, x0 + 8, ym, 1.4, 0.3, WATER)
        elif kind == "uge":
            circle(c, x0 + 3, ym, 1.4, 0.3, POWER)
        elif kind == "tel":
            circle(c, x0 + 3, ym, 1.4, 0.3, COMMS)
        elif kind == "st":
            rect(c, x0, ym - 1.8, 12, 3.6, 0.3, DRAIN, CREEKC)
        text(c, x + 31, ym - 0.9, label, F, 6.6, INK)
        y -= 5.4
    return y_top - h


def _notes(c, x, y_top, w, lines):
    h = 10 + len(lines) * 8.2
    rect(c, x, y_top - h, w, h, 0.25, INK, white)
    sheet_note_box(c, x + 4, y_top - 1.5, w - 6, "NOTES", lines, 6.6, 3.0)
    return y_top - h


def draw_ls(c, al, vert, s0, s1, yb, datum, structures=(), util=True, xl=XL, name="MC00",
            continued=None):
    """Profile with data bands. yb is the page y of the bottom of the chainage row."""
    total = sum(h for _, h, _ in ROWS)
    ytop = yb + total
    xr = xl + (s1 - s0) * HS

    def X(s):
        return xl + (s - s0) * HS

    def Y(rl):
        return ytop + (rl - datum) * VS

    # ---- table frame
    rect(c, LABEL_X, yb, xr - LABEL_X, total, 0.35, INK)
    pl(c, [(xl, yb), (xl, ytop)], 0.35, INK)
    y = ytop
    bands = {}
    for label, h, key in ROWS:
        bands[key] = (y - h, y)
        if y != ytop:
            pl(c, [(LABEL_X, y), (xr, y)], 0.25, INK)
        text(c, LABEL_X + 3, y - h / 2 - 1.2, label, F, 9, INK)
        y -= h
    text(c, LABEL_X + 3, ytop + 4.0, "DATUM R.L. %.3f" % datum, F, 9, INK)
    pl(c, [(LABEL_X, ytop), (xr, ytop)], 0.25, INK)

    sts = _stations(s0, s1)
    # light vertical guides through the three numeric rows, and up to the profile
    for s in sts:
        pl(c, [(X(s), bands["dl"][1]), (X(s), bands["ch"][0])], 0.1, LINE)
    for s in [v for v in sts if abs(v / 20.0 - round(v / 20.0)) < 1e-6]:
        g = ground(*al.pt(s))
        pl(c, [(X(s), ytop), (X(s), Y(g))], 0.1, LINE)
        pl(c, [(X(s), ytop), (X(s), ytop - 1.5)], 0.25, INK)

    # ---- numeric rows (rotated)
    for s in sts:
        x = X(s) + 1.0
        dl = vert.level(s)
        gl = ground(*al.pt(s))
        yc = (bands["dl"][0] + bands["dl"][1]) / 2
        rtext(c, x, yc, "%.3f" % dl, 90, F, 7, INK, "c")
        yc = (bands["el"][0] + bands["el"][1]) / 2
        rtext(c, x, yc, "%.3f" % gl, 90, F, 7, INK, "c")
        yc = (bands["ch"][0] + bands["ch"][1]) / 2
        rtext(c, x, yc, "%.3f" % s, 90, F, 7, INK, "c")

    # ---- vertical alignment schematic
    y0, y1 = bands["va"]
    lv = [vert.level(s) for s in sts]
    lo, hi = min(lv), max(lv)
    span = max(hi - lo, 0.5)

    def VY(rl):
        return y0 + 6 + (rl - lo) / span * (y1 - y0 - 12)

    pts = [(X(s), VY(vert.level(s))) for s in [s0 + (s1 - s0) * i / 260.0 for i in range(261)]]
    pl(c, pts, 0.3, INK)
    cuts = [s0]
    for cv in vert.curves:
        if cv["ve"] > s0 and cv["vs"] < s1:
            for v in (cv["vs"], cv["ve"]):
                if s0 < v < s1:
                    pl(c, [(X(v), y0), (X(v), y1)], 0.2, INK)
                    cuts.append(v)
    cuts.append(s1)
    cuts = sorted(set(cuts))
    for a, b in zip(cuts, cuts[1:]):
        mid = (a + b) / 2
        in_curve = [cv for cv in vert.curves if cv["vs"] <= mid <= cv["ve"]]
        if (b - a) * HS < 38:
            continue
        if in_curve:
            cv = in_curve[0]
            text(c, X(mid), y0 + 1.3, "K=%.3f  L=%.3f" % (cv["K"], cv["L"]), F, 6.6, INK, "c")
        else:
            g = vert.grade(mid) * 100
            text(c, X(mid), y1 - 3.8, "G=%+.3f%%" % g, F, 6.6, INK, "c")

    # ---- horizontal alignment
    y0, y1 = bands["ha"]
    ym = (y0 + y1) / 2
    for e in al.els:
        a, b = max(e["s0"], s0), min(e["s1"], s1)
        if b <= a:
            continue
        if e["s0"] > s0:
            pl(c, [(X(e["s0"]), y0), (X(e["s0"]), y1)], 0.2, INK)
        yl = ym if e["kind"] == "S" else (ym - 3.2 if e["turn"] > 0 else ym + 3.2)
        pl(c, [(X(a), yl), (X(b), yl)], 0.3, INK)
        if e["kind"] == "S":
            lab = ["L=%.3f" % (e["s1"] - e["s0"])]
        else:
            lab = ["R=%.3f" % e["R"], "L=%.3f  %s" % (e["s1"] - e["s0"], "RIGHT" if e["turn"] > 0 else "LEFT")]
        if (b - a) * HS > 30:
            xm = X((a + b) / 2)
            if e["kind"] == "S":
                text(c, xm, y1 - 3.8, lab[0], F, 6.6, INK, "c")
            else:
                text(c, xm, y1 - 3.0, lab[0], F, 6.6, INK, "c")
                text(c, xm, y0 + 1.2, lab[1], F, 6.6, INK, "c")

    # ---- crossfall
    y0, y1 = bands["cf"]
    if al is MC00:
        knots = [s for s in (270.0, 340.0, 530.0, 600.0, 790.0, 840.0) if s0 < s < s1]
        for s in knots:
            pl(c, [(X(s), y0), (X(s), y1)], 0.2, INK)
        edges = [s0] + knots + [s1]
        for a, b in zip(edges, edges[1:]):
            mid = (a + b) / 2
            if (b - a) * HS < 36:
                continue
            sl, sr = crossfall(mid)
            ramp = (270 < mid < 340) or (530 < mid < 600) or (790 < mid < 840)
            lab = "TRANSITION" if ramp else "LHS %+.1f%%   RHS %+.1f%%" % (sl * 100, sr * 100)
            text(c, X(mid), (y0 + y1) / 2 - 1.2, lab, F, 6.6, INK, "c")
    else:
        text(c, X((s0 + s1) / 2), (y0 + y1) / 2 - 1.2, "LHS -3.0%   RHS -3.0%", F, 6.6, INK, "c")

    # ---- profile
    n = int((s1 - s0) / 2) + 1
    ex = [(X(s0 + (s1 - s0) * i / (n - 1)), Y(ground(*al.pt(s0 + (s1 - s0) * i / (n - 1))))) for i in range(n)]
    pl(c, ex, 0.25, INK, (2.0, 1.2))
    des = [(X(s0 + (s1 - s0) * i / 400.0), Y(vert.level(s0 + (s1 - s0) * i / 400.0))) for i in range(401)]
    pl(c, des, 0.5, DESIGN_RED)

    if util:
        for s, depth, dia, lab, col in UTIL:
            if al is MC00 and s0 + 4 < s < s1 - 4:
                rl = ground(*al.pt(s)) - depth
                r = max(1.0, dia * VS / 2)
                circle(c, X(s), Y(rl), r, 0.3, col)
                rtext(c, X(s) + 1.0, Y(rl) - r - 1.0, "%s IL %.3f" % (lab, rl - dia / 2), 90, F, 6.2, col, "r")
    for (a, b, inv, h, lab) in structures:
        if s0 <= a and b <= s1:
            pts = [(X(a), Y(inv)), (X(b), Y(inv)), (X(b), Y(inv + h)), (X(a), Y(inv + h))]
            pl(c, pts, 0.35, DRAIN, close=True, fill=CREEKC)
            w3 = (b - a) / 3.0
            for k in (1, 2):
                pl(c, [(X(a + w3 * k), Y(inv)), (X(a + w3 * k), Y(inv + h))], 0.25, DRAIN)
            rtext(c, X((a + b) / 2) + 1.0, Y(inv) - 1.5, lab, 90, FB, 6.8, DRAIN, "r")

    # ---- profile annotations
    def tag(s, rl, label):
        pl(c, [(X(s), Y(rl) + 0.8), (X(s), Y(rl) + 5.0)], 0.2, INK)
        circle(c, X(s), Y(rl), 0.9, 0.25, INK, white)
        rtext(c, X(s) + 1.1, Y(rl) + 6.0, label, 90, F, 6.4, INK, "l")

    for s, rl, L in vert.pvis:
        if s0 < s < s1:
            tag(s, rl, "CH.%.3f  RL.%.3fm" % (s, rl))
    for cv in vert.curves:
        if s0 < cv["s"] < s1:
            sv = cv["vs"] - cv["g1"] * cv["L"] / (cv["g2"] - cv["g1"])
            if s0 < sv < s1:
                tag(sv, vert.level(sv), "%s CH.%.3f  RL.%.3fm" % (cv["kind"], sv, vert.level(sv)))
    tag(s0, vert.level(s0), "CH.%.3f  RL.%.3fm" % (s0, vert.level(s0)))
    tag(s1, vert.level(s1), "CH.%.3f  RL.%.3fm" % (s1, vert.level(s1)))

    # ---- sheet continuation lines
    for s, lab in ((s0, continued[0] if continued else None), (s1, continued[1] if continued else None)):
        if lab:
            pl(c, [(X(s), ytop), (X(s), ytop + 118.0)], 0.4, PROJECT, (8.0, 2.0, 1.0, 2.0))
            side = 1 if s == s0 else -1
            rtext(c, X(s) + side * 3.0, ytop + 118.0, lab, 90, FB, 6.8, INK, "r" if side < 0 else "l")
    return ytop, X, Y


def _title(c, x, y, line1, line2):
    text(c, x, y, line1, FB, 13, INK)
    text(c, x, y - 6.0, line2, F, 9, INK)


def _keyline(c, x, y, w, h, al, s0, s1, name):
    """Small key plan highlighting the chainage range."""
    rect(c, x, y, w, h, 0.25, INK, white)
    text(c, x + 3, y + h - 6.0, "KEY PLAN", FB, 8, INK)
    text(c, x + w - 3, y + h - 6.0, "NOT TO SCALE", F, 5.5, INK, "r")
    k = (w - 12) / 1010.0
    ox, oy = x + 6, y + 4
    pl(c, [(ox + px * k, oy + py * k) for px, py in MC00.poly(0, step=6.0)], 0.4, INK)
    pl(c, [(ox + px * k, oy + py * k) for px, py in MC01.poly(0, step=6.0)], 0.3, INK)
    sel = al.poly(0, s0, s1, 3.0)
    pl(c, [(ox + px * k, oy + py * k) for px, py in sel], 1.2, ORANGE, cap=1, join=1)
    x1, y1 = al.pt(s0)
    x2, y2 = al.pt(s1)
    text(c, ox + x1 * k, oy + y1 * k + 2.0, "CH %d" % s0, F, 5.5, INK, "c")
    text(c, ox + x2 * k, oy + y2 * k + 2.0, "CH %d" % s1, F, 5.5, INK, "c")


def ls_sheet(c, n):
    """Sheets 1-4: MC00 long sections, 260 m each."""
    s0, s1 = 260.0 * (n - 1), 260.0 * n
    datum = 8.000
    yb = 118.0
    cont = ("CHAINAGE %d CONTINUED FROM SHEET %d" % (s0, n - 1) if n > 1 else "START OF WORKS CH 0.000",
            "CHAINAGE %d CONTINUED ON SHEET %d" % (s1, n + 1) if n < 4 else "END OF WORKS CH 1040.000")
    structures = [(CULVERT_CH - 4.2, CULVERT_CH + 4.2, CULVERT_INV, 1.8, "NEW 3/2400x1200 RCBC")] if n == 4 else []
    ytop, X, Y = draw_ls(c, MC00, V00, s0, s1, yb, datum, structures, True, continued=cont)
    _title(c, XL, yb - 11.0, "DESIGN CONTROL - MC00 - KESTREL ROAD",
           "CHAINAGE %.3f TO %.3f" % (s0, s1))
    scale_bar(c, XL + 300.0, 56.0, 2.0, [0, 10, 20, 40], "m", "HORIZONTAL SCALE 1:500")
    scale_bar(c, XL + 300.0, 36.0, 10.0, [0, 1, 2, 4], "m", "VERTICAL SCALE 1:100")
    _keyline(c, 490.0, 16.0, 168.0, 78.0, MC00, s0, s1, "MC00")
    y = _legend(c, 530.0, 583.0) - 3.0
    _notes(c, 530.0, y, 130.0, [
        "FOR ROADWORKS ALIGNMENT CONTROL PLANS REFER TO DRAWINGS RW-DRG-000031 TO 000034.",
        "FOR CROSS SECTIONS REFER TO DRAWINGS RW-DRG-000301 TO 000305.",
        "VERTICAL EXAGGERATION 5:1. LEVELS ARE IN METRES AHD71.",
    ])


def _drain_run():
    """Pit schedule for drainage line D01 along the right kerb of MC00."""
    pits = [20.0, 60.0, 140.0, 180.0, 220.0, 260.0]
    sizes = [375, 375, 450, 450, 525]
    inv, rows = [], []
    prev = None
    for i, s in enumerate(pits):
        target = V00.level(s) - 1.55
        v = target if prev is None else min(prev[1] - 0.006 * (s - prev[0]), target)
        inv.append(v)
        prev = (s, v)
    for i in range(len(pits) - 1):
        d = pits[i + 1] - pits[i]
        rows.append((pits[i], pits[i + 1], sizes[i], (inv[i] - inv[i + 1]) / d * 100))
    return pits, inv, sizes, rows


def ls01_sheet(c):
    """MC01 side road long section plus drainage line D01."""
    yb = 345.0
    ytop, X, Y = draw_ls(c, MC01, V01, 0.0, MC01.length, yb, 8.0, util=False,
                         continued=("START OF MC01  CH 0.000  (MC00 CH 110.000)", "END OF WORKS CH %.3f" % MC01.length))
    _title(c, XL, yb - 11.0, "DESIGN CONTROL - MC01 - HARTLEY STREET", "CHAINAGE 0.000 TO %.3f" % MC01.length)
    # tie-in note
    rtext(c, X(0) - 3.0, ytop + 4, "TIE IN TO MC00 CH 110.000", 90, F, 6.8, INK, "l")

    # ---- drainage long section D01
    pits, inv, sizes, rows = _drain_run()
    s0d, s1d = 10.0, 270.0
    rows_d = [("PIT No", 14.0), ("PIPE SIZE / GRADE", 16.0), ("PIPE INVERT LEVEL", 24.0),
              ("KERB / EXISTING LEVEL", 24.0), ("CHAINAGE", 24.0)]
    total = sum(h for _, h in rows_d)
    yb2 = 38.0
    yt2 = yb2 + total
    xr = XL + (s1d - s0d) * HS
    datum2 = 9.0

    def XD(s):
        return XL + (s - s0d) * HS

    def YD(rl):
        return yt2 + (rl - datum2) * VS

    rect(c, LABEL_X, yb2, xr - LABEL_X, total, 0.35, INK)
    pl(c, [(XL, yb2), (XL, yt2)], 0.35, INK)
    y = yt2
    band = {}
    for label, h in rows_d:
        band[label] = (y - h, y)
        if y != yt2:
            pl(c, [(LABEL_X, y), (xr, y)], 0.25, INK)
        text(c, LABEL_X + 3, y - h / 2 - 1.2, label, F, 9, INK)
        y -= h
    text(c, LABEL_X + 3, yt2 + 4.0, "DATUM R.L. %.3f" % datum2, F, 9, INK)
    # ground at the kerb and the road design level at the kerb
    def kerb(s):
        return V00.level(s) - 0.03 * 7.0 + 0.0

    stn = [s for s in range(20, 271, 10)]
    g_pts = [(XD(s), YD(ground(*MC00.pt(s, 8.6)))) for s in range(10, 271, 2)]
    k_pts = [(XD(s), YD(kerb(s) + 0.15)) for s in range(10, 271, 2)]
    pl(c, g_pts, 0.25, INK, (2.0, 1.2))
    pl(c, k_pts, 0.5, DESIGN_RED)
    for s in stn:
        pl(c, [(XD(s), band["CHAINAGE"][0]), (XD(s), band["KERB / EXISTING LEVEL"][1])], 0.1, LINE)
        rtext(c, XD(s) + 1.0, sum(band["CHAINAGE"]) / 2, "%.3f" % s, 90, F, 7, INK, "c")
        rtext(c, XD(s) + 1.0, sum(band["KERB / EXISTING LEVEL"]) / 2,
              "%.3f / %.3f" % (kerb(s) + 0.15, ground(*MC00.pt(s, 8.6))), 90, F, 6.4, INK, "c")
    # pits and pipes
    for i, s in enumerate(pits):
        top = kerb(s) + 0.15
        w = 1.2
        pl(c, [(XD(s) - w * HS / 2, YD(inv[i] - 0.25)), (XD(s) + w * HS / 2, YD(inv[i] - 0.25)),
               (XD(s) + w * HS / 2, YD(top)), (XD(s) - w * HS / 2, YD(top))], 0.35, DRAIN, close=True, fill=white)
        pl(c, [(XD(s), band["PIT No"][0]), (XD(s), band["PIT No"][1])], 0.15, LINE)
        text(c, XD(s), sum(band["PIT No"]) / 2 - 1.2, "D01-%02d" % (i + 1), FB, 7, DRAIN, "c")
        rtext(c, XD(s) + 1.0, sum(band["PIPE INVERT LEVEL"]) / 2, "%.3f" % inv[i], 90, F, 7, INK, "c")
    for i, (a, b, size, grade) in enumerate(rows):
        ia, ib = inv[i], inv[i + 1]
        dia = size / 1000.0
        pl(c, [(XD(a), YD(ia)), (XD(b), YD(ib)), (XD(b), YD(ib + dia)), (XD(a), YD(ia + dia))], 0.3, DRAIN,
           close=True, fill=CREEKC)
        text(c, XD((a + b) / 2), sum(band["PIPE SIZE / GRADE"]) / 2 + 1.0, "%d dia RCP" % size, F, 6.8, INK, "c")
        text(c, XD((a + b) / 2), sum(band["PIPE SIZE / GRADE"]) / 2 - 3.2, "%.2f%% / L=%.1f" % (grade, b - a),
             F, 6.8, INK, "c")
    # the junction crossing
    xj0, xj1 = XD(97.0), XD(123.0)
    pl(c, [(xj0, band["CHAINAGE"][0]), (xj0, yt2 + 40)], 0.2, PROJECT, (3.0, 2.0))
    pl(c, [(xj1, band["CHAINAGE"][0]), (xj1, yt2 + 40)], 0.2, PROJECT, (3.0, 2.0))
    text(c, (xj0 + xj1) / 2, yt2 + 42.0, "MC01 CROSSING", FB, 6.8, PROJECT, "c")
    _title(c, XL, yb2 - 9.0, "DRAINAGE LONGITUDINAL SECTION - LINE D01", "RIGHT KERB MC00  CH 20 TO CH 260")
    y = _legend(c, 530.0, 583.0) - 3.0
    _notes(c, 530.0, y, 130.0, [
        "FOR ROADWORKS GENERAL ARRANGEMENT PLANS REFER TO DRAWINGS RW-DRG-000031 TO 000034.",
        "FOR MC00 LONGITUDINAL SECTIONS REFER TO DRAWINGS RW-DRG-000201 TO 000204.",
        "PIPE INVERT LEVELS ARE TO THE PIT WALL.",
    ])
    scale_bar(c, 430.0, 440.0, 2.0, [0, 10, 20, 40], "m", "HORIZONTAL SCALE 1:500")
    scale_bar(c, 430.0, 415.0, 10.0, [0, 1, 2, 4], "m", "VERTICAL SCALE 1:100")

