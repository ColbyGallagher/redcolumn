"""Alignment control plans, sheets 1-4 at 1:500.

Each sheet is an exact window onto the same world model, so neighbouring sheets
meet edge to edge: the staircase layout is 1 -> 2 (across), 2 -> 3 (down),
3 -> 4 (across).
"""
import math

from reportlab.lib.colors import white
from reportlab.lib.units import mm

from .catalog import drg
from .draw import *  # noqa: F401,F403
from .geom import (CULVERT_CH, CULVERT_INV, JUNCTION_CH, MATCHLINES, MC00, MC01, MM_PER_M, WIN_H, WIN_W,
                   WINDOWS, WORLD_H, WORLD_W)
from .site import site
from .titleblock import F, FB, INK, text

DASHDOT = (8.0, 1.6, 1.0, 1.6)
DASH = (3.0, 2.0)
DOT = (0.6, 1.3)

PLAN_KEYS = {1: "plan1", 2: "plan2", 3: "plan3", 4: "plan4"}


_MATCH_EXTENT = {}


def _match_extent(ms, pad=6.0):
    """Offsets (m, right positive) of the cadastral linework where it crosses the matchline, plus a margin."""
    if ms not in _MATCH_EXTENT:
        x0, y0, b = MC00.at(ms)
        t = (math.sin(b), math.cos(b))
        nv = (math.cos(b), -math.sin(b))
        offs = []
        for line in site().cadastral:
            for (ax, ay), (bx, by) in zip(line, line[1:]):
                fa = (ax - x0) * t[0] + (ay - y0) * t[1]
                fb = (bx - x0) * t[0] + (by - y0) * t[1]
                if fa != fb and fa * fb <= 0:
                    u = fa / (fa - fb)
                    off = (ax + u * (bx - ax) - x0) * nv[0] + (ay + u * (by - ay) - y0) * nv[1]
                    if abs(off) < 120.0:  # ignore the side-road lots, which are far from this crossing
                        offs.append(off)
        _MATCH_EXTENT[ms] = (min(offs) - pad, max(offs) + pad)
    return _MATCH_EXTENT[ms]
RIGHT_COL_W = 130.0


def _legend(c, x, y_top, w):
    """Boxed legend; returns the y of its bottom edge."""
    rows = [
        ("CADASTRAL BOUNDARY", "cad"), ("PROJECT BOUNDARY", "proj"), ("CONSTRUCTION BOUNDARY", "con"),
        ("LIMIT OF WORKS", "low"), ("EXISTING ROAD", "ex"), ("NEW ROAD DESIGN", "new"),
        ("SHARED PATH / FOOTPATH", "path"), ("CONTROL LINE ALIGNMENT", "cl"),
        ("CONTROL LINE ALIGNMENT LABEL", "lab"), ("PROPOSED STORMWATER DRAINAGE", "dr"),
        ("NEW CROSS DRAINAGE CULVERT", "cul"), ("STREET LIGHT", "light"),
        ("EXISTING SEWER (SEW)", "sew"), ("EXISTING WATER MAIN (WM)", "wm"),
        ("EXISTING UNDERGROUND POWER (UGE)", "uge"), ("EXISTING TELECOMMUNICATIONS (TEL)", "tel"),
        ("EXISTING TREE / BUILDING", "tree"),
    ]
    h = 12 + len(rows) * 5.2
    rect(c, x, y_top - h, w, h, 0.25, INK, white)
    text(c, x + 4, y_top - 7.5, "LEGEND", FB, 10, INK)
    y = y_top - 14.5
    for label, kind in rows:
        x0, x1, ym = x + 4, x + 26, y + 1.0
        if kind == "cad":
            pl(c, [(x0, ym), (x1, ym)], 0.2, CADASTRAL)
        elif kind == "proj":
            pl(c, [(x0, ym), (x1, ym)], 0.35, PROJECT, DASHDOT)
        elif kind == "con":
            pl(c, [(x0, ym), (x1, ym)], 0.35, CONSTR, DASHDOT)
        elif kind == "low":
            pl(c, [(x0, ym), (x1, ym)], 0.7, INK)
        elif kind == "ex":
            pl(c, [(x0, ym), (x1, ym)], 0.2, EXIST, DASH)
        elif kind == "new":
            rect(c, x0, ym - 1.6, x1 - x0, 3.2, 0, PAVE, PAVE)
            pl(c, [(x0, ym - 1.6), (x1, ym - 1.6)], 0.3, INK)
            pl(c, [(x0, ym + 1.6), (x1, ym + 1.6)], 0.3, INK)
        elif kind == "path":
            pl(c, [(x0, ym - 0.8), (x1, ym - 0.8)], 0.15, INK)
            pl(c, [(x0, ym + 0.8), (x1, ym + 0.8)], 0.15, INK)
        elif kind == "cl":
            pl(c, [(x0, ym), (x1, ym)], 0.3, INK, DASHDOT)
        elif kind == "lab":
            label_box(c, x0 + 6, ym, "MCX", 7)
            arrow(c, x0 + 11, ym, x1, ym, 1.4, 0.15)
        elif kind == "dr":
            rect(c, x0, ym - 1.0, 2.0, 2.0, 0.2, DRAIN, white)
            pl(c, [(x0 + 2.0, ym), (x1, ym)], 0.3, DRAIN)
        elif kind == "cul":
            rect(c, x0, ym - 1.6, x1 - x0, 3.2, 0.25, DRAIN, CREEKC)
        elif kind == "light":
            circle(c, (x0 + x1) / 2, ym, 1.1, 0.25, INK, white)
            circle(c, (x0 + x1) / 2, ym, 0.25, 0.1, INK, INK)
        elif kind in ("sew", "wm", "uge", "tel"):
            col = {"sew": SEWER, "wm": WATER, "uge": POWER, "tel": COMMS}[kind]
            pl(c, [(x0, ym), (x1, ym)], 0.3, col, DASH if kind in ("sew", "wm") else DOT)
        elif kind == "tree":
            circle(c, x0 + 3.0, ym, 1.8, 0.15, EXIST, TREE)
            rect(c, x0 + 9.0, ym - 1.4, 5.0, 2.8, 0.15, EXIST, BLDG)
        text(c, x + 31, ym - 0.9, label, F, 6.4, INK)
        y -= 5.2
    return y_top - h


def _keyplan(c, x, y_top, w, current):
    k = 0.105
    h = 14.0 + WORLD_H * k + 9.0
    rect(c, x, y_top - h, w, h, 0.25, INK, white)
    text(c, x + 4, y_top - 7.5, "KEY PLAN", FB, 10, INK)
    text(c, x + w - 4, y_top - 7.5, "NOT TO SCALE", F, 6, INK, "r")
    ox, oy = x + (w - WORLD_W * k) / 2, y_top - h + 4.5
    for n, (wx, wy) in WINDOWS.items():
        fill = HexFill if n == current else None
        rect(c, ox + wx * k, oy + wy * k, WIN_W * k, WIN_H * k, 0.3, INK, fill)
        text(c, ox + (wx + WIN_W / 2) * k, oy + (wy + WIN_H / 2 - 12) * k, "SHEET %d" % n, F, 6.5, INK, "c")
    pl(c, [(ox + px * k, oy + py * k) for px, py in MC00.poly(0, step=6.0)], 0.5, INK)
    pl(c, [(ox + px * k, oy + py * k) for px, py in MC01.poly(0, step=6.0)], 0.4, INK)
    s = site()
    pl(c, [(ox + px * k, oy + py * k) for px, py in s.creek], 0.5, DRAIN)
    return y_top - h


from reportlab.lib.colors import HexColor  # noqa: E402

HexFill = HexColor("#F6D7B8")


def plan_sheet(c, n):
    S = site()
    wx0, wy0 = WINDOWS[n]
    k = MM_PER_M

    def P(x, y):
        return (FX0 + (x - wx0) * k, FY0 + (y - wy0) * k)

    def PP(pts):
        return [P(x, y) for x, y in pts]

    def inwin(x, y, m=0.0):
        return wx0 - m <= x <= wx0 + WIN_W + m and wy0 - m <= y <= wy0 + WIN_H + m

    c.saveState()
    clip = c.beginPath()
    clip.rect(FX0 * mm, FY0 * mm, (FX1 - FX0) * mm, (FY1 - FY0) * mm)
    c.clipPath(clip, stroke=0, fill=0)

    # ---- ground cover and existing features
    for poly in S.existing_pave:
        pl(c, PP(poly), 0, PAVE, close=True, fill=HexColor("#F1F2F3"))
    pl(c, PP(S.park), 0.2, CADASTRAL, close=True, fill=HexColor("#EAF4E3"))
    pl(c, PP(S.pond), 0.2, DRAIN, close=True, fill=CREEKC)
    for pth in S.park_paths:
        pl(c, PP(pth), 1.0 * k, white, cap=1, join=1)
        pl(c, PP(pth), 0.15, EXIST)
    # creek
    pl(c, PP(S.creek), 5.0 * k, CREEKC, cap=1, join=1)
    pl(c, PP(S.creek), 0.2, DRAIN, DASH)
    for tx, ty, r in S.trees:
        if inwin(tx, ty, 6):
            circle(c, *P(tx, ty), r * k, 0.12, HexColor("#9CC48F"), TREE)
    for b in S.buildings:
        pl(c, PP(b), 0.15, EXIST, close=True, fill=BLDG)
    for line in S.cadastral:
        pl(c, PP(line), 0.15, CADASTRAL)
    for line in S.existing_edges:
        pl(c, PP(line), 0.2, EXIST, DASH)

    # ---- new road
    for poly in S.pave:
        pl(c, PP(poly), 0, PAVE, close=True, fill=PAVE)
    cx, cy = S.culvert_mid
    pl(c, PP(S.culvert), 0.3, DRAIN, close=True, fill=CREEKC)
    for line in S.lane_lines:
        pl(c, PP(line), 0.12, EXIST, DASH)
    for line in S.kerbs_back:
        pl(c, PP(line), 0.12, EXIST)
    for line in S.kerbs:
        pl(c, PP(line), 0.3, INK)
    for line in S.paths:
        pl(c, PP(line), 0.15, INK)

    # ---- boundaries
    for line in S.constr:
        pl(c, PP(line), 0.3, CONSTR, DASHDOT)
    for line in S.project:
        pl(c, PP(line), 0.35, PROJECT, DASHDOT)
    for name, line in S.limit_of_works:
        pl(c, PP(line), 0.7, INK)

    # ---- services and drainage
    for lines, col, dash in ((S.sewer, SEWER, DASH), (S.water, WATER, DASH),
                             (S.power, POWER, DOT), (S.comms, COMMS, DOT)):
        for line in lines:
            pl(c, PP(line), 0.25, col, dash)
    for line in S.pipes:
        pl(c, PP(line), 0.3, DRAIN)
    for px, py in S.pits:
        if inwin(px, py, 4):
            x, y = P(px, py)
            rect(c, x - 1.2, y - 1.2, 2.4, 2.4, 0.2, DRAIN, white)
    hx, hy = S.headwall
    x, y = P(hx, hy)
    rect(c, x - 1.6, y - 1.6, 3.2, 3.2, 0.3, DRAIN, DRAIN)
    for px, py in S.lights:
        if inwin(px, py, 4):
            x, y = P(px, py)
            circle(c, x, y, 1.1, 0.25, INK, white)
            circle(c, x, y, 0.25, 0.1, INK, INK)

    # ---- control lines, ticks and chainage
    for al, step in ((MC00, 10.0), (MC01, 10.0)):
        pl(c, PP(al.poly(0, step=2.0)), 0.3, INK, DASHDOT)
        s = 0.0
        while s <= al.length + 0.01:
            x, y, b = al.at(s)
            if inwin(x, y, 4):
                big = abs(s / 50.0 - round(s / 50.0)) < 1e-6
                half = 2.2 if big else 1.2
                pl(c, [P(*al.pt(s, -half)), P(*al.pt(s, half))], 0.2, INK)
            s += step
    for s in range(0, int(MC00.length) + 1, 20):
        for side, lab in ((-1, True), (1, True)):
            x1, y1 = MC00.pt(s, side * 22.0)
            x2, y2 = MC00.pt(s, side * 24.5)
            if not inwin(x1, y1, 2):
                continue
            if side > 0 and 78.0 <= s <= 142.0:
                continue
            pl(c, [P(x1, y1), P(x2, y2)], 0.2, PROJECT)
            tx, ty = MC00.pt(s, side * 29.0)
            b = MC00.at(s)[2]
            ang = math.degrees(math.atan2(math.sin(b) * 1.0, -math.cos(b) * side * -1.0))
            # text runs along the outward normal, reading upright
            nx, ny = (math.cos(b) * side, -math.sin(b) * side)
            ang = readable(math.degrees(math.atan2(ny, nx)))
            X, Y = P(tx, ty)
            rtext(c, X, Y - 1.0 * (0 if abs(ang) > 45 else 1), "%d" % s, ang, F, 8, INK, "c")
    for s in range(0, int(MC01.length) + 1, 20):
        x1, y1 = MC01.pt(s, 14.0)
        if s < 28 or not inwin(x1, y1, 2):
            continue
        b = MC01.at(s)[2]
        nx, ny = (math.cos(b), -math.sin(b))
        ang = readable(math.degrees(math.atan2(ny, nx)))
        X, Y = P(*MC01.pt(s, 18.5))
        pl(c, [P(*MC01.pt(s, 14.0)), P(*MC01.pt(s, 16.5))], 0.2, PROJECT)
        rtext(c, X, Y - 1.0 * (0 if abs(ang) > 45 else 1), "%d" % s, ang, F, 7.5, INK, "c")

    # key stations: tangent/curve points
    for s, lab in MC00.key_stations():
        if lab in ("START", "END"):
            continue
        x, y, b = MC00.at(s)
        if inwin(x, y, 0):
            nx, ny = (-math.cos(b), math.sin(b))
            X, Y = P(*MC00.pt(s, -42.0))
            ang = readable(math.degrees(math.atan2(ny, nx)))
            pl(c, [P(*MC00.pt(s, -22.0)), P(*MC00.pt(s, -37.0))], 0.2, INK)
            rtext(c, X, Y - 1.0, "%s %.3f" % (lab if lab == "TC" else "CT", s), ang, FB, 7.5, INK, "c")
    for e in MC00.els:
        if e["kind"] == "C":
            sm = (e["s0"] + e["s1"]) / 2
            x, y, b = MC00.at(sm)
            if inwin(x, y, 0):
                X, Y = P(*MC00.pt(sm, e["turn"] * 11.0))
                dirang = math.degrees(math.atan2(math.cos(b), math.sin(b)))
                rtext(c, X, Y - 1.0, "R=%.3f" % e["R"], readable(dirang), F, 7.5, INK, "c")
    x, y = S.junction
    if inwin(x, y, 0):
        X, Y = P(*MC01.pt(70.0, 5.9))
        rtext(c, X, Y, "R=120.000", readable(math.degrees(math.atan2(math.cos(MC01.at(70)[2]), math.sin(MC01.at(70)[2])))),
              F, 6.5, INK, "c")

    # ---- names and annotations
    def along(al, s, off, txt, size, font=FB, color=EXIST):
        x, y, b = al.at(s)
        if inwin(x, y, -15):
            X, Y = P(*al.pt(s, off))
            ang = readable(math.degrees(math.atan2(math.cos(b), math.sin(b))))
            rtext(c, X, Y - 1.0, txt, ang, font, size, color, "c")

    for s in (120.0, 330.0, 560.0, 800.0, 980.0):
        along(MC00, s, 3.2 if s != 330.0 else -3.0, "KESTREL ROAD", 8, FB, HexColor("#8C9199"))
    along(MC01, 100.0, 2.2, "HARTLEY STREET", 6.5, FB, HexColor("#8C9199"))
    if n == 3:
        X, Y = P(424.0, 215.0)
        text(c, X, Y, "KESTREL PARK", FB, 13, HexColor("#7FA06E"), "c")
        X, Y = P(424.0, 118.0)
        text(c, X, Y - 1.0, "POND", F, 7.5, DRAIN, "c")

    if n == 1:
        X, Y = P(wx0 + 9.0, 459.0)
        text(c, X, Y, "TO MARLOW STREET", FB, 8.5, INK)
        arrow(c, X, Y - 3.0, X - 6.0, Y - 3.0, 2.0, 0.25)
        X, Y = P(*MC01.pt(MC01.length - 1.0, 0.0))
        text(c, X + 14, Y - 2, "HARTLEY STREET (EXISTING)", F, 7, INK)
        text(c, X + 14, Y - 6, "LIMIT OF WORKS CH 153.304", F, 6.5, INK)
        x, y, _ = MC00.at(0)
        X, Y = P(x, y)
        rtext(c, X - 2.0, Y + 28.0, "START OF WORKS  CH 0.000", 90, FB, 7.5, INK, "c")
    if n == 4:
        x, y, _ = MC00.at(MC00.length)
        X, Y = P(x, y)
        rtext(c, X - 2.0, Y + 28.0, "END OF WORKS  CH 1040.000", 90, FB, 7.5, INK, "c")
        text(c, X + 8, Y + 9.0, "TO IRONBARK AVENUE", FB, 8.5, INK)
        arrow(c, X + 8, Y + 6.0, X + 46, Y + 6.0, 2.0, 0.25)
        # culvert callout
        mx, my = S.culvert_mid
        X, Y = P(mx, my)
        pl(c, [(X + 4, Y + 6), (X + 22, Y + 40)], 0.2, INK)
        text(c, X + 24, Y + 41, "NEW 3/2400 x 1200 RCBC", FB, 7.5, INK)
        text(c, X + 24, Y + 37, "CH %.2f  INV RL %.2f" % (CULVERT_CH, CULVERT_INV), F, 7, INK)
        mid = P(790.0, 168.0)
        rtext(c, mid[0], mid[1], "CORELLA CREEK", 75, F, 8.5, HexColor("#1D6FE0"), "c")
        text(c, P(*S.headwall)[0] + 3, P(*S.headwall)[1] + 4, "D01 OUTFALL", F, 6.5, DRAIN)

    # alignment labels with leaders
    labels = {1: [(MC00, 70.0, -30.0, "MC00"), (MC01, 95.0, 20.0, "MC01")],
              2: [(MC00, 420.0, -36.0, "MC00")],
              3: [(MC00, 640.0, 34.0, "MC00")],
              4: [(MC00, 960.0, -34.0, "MC00")]}[n]
    for al, s, off, name in labels:
        bx, by = P(*al.pt(s, off))
        px, py = P(*al.pt(s, 0.0))
        pl(c, [(bx, by), (px, py)], 0.2, INK)
        arrow(c, bx, by, px, py, 1.8, 0.2)
        label_box(c, bx, by, name, 8)
    # services tags
    for s, off, tag, col in ((60.0, -15.0, "SEW", SEWER), (180.0, 12.4, "WM", WATER),
                             (260.0, -13.4, "UGE", POWER), (400.0, 13.6, "TEL", COMMS),
                             (620.0, -15.0, "SEW", SEWER), (700.0, 12.4, "WM", WATER),
                             (840.0, -13.4, "UGE", POWER), (990.0, 13.6, "TEL", COMMS),
                             (310.0, 12.4, "WM", WATER), (540.0, -15.0, "SEW", SEWER)):
        x, y, b = MC00.at(s)
        if inwin(x, y, -8):
            X, Y = P(*MC00.pt(s, off))
            ang = readable(math.degrees(math.atan2(math.cos(b), math.sin(b))))
            rtext(c, X, Y + (1.0 if off < 0 else -2.4), tag, ang, FB, 5.8, col, "c")
    # ---- matchlines: perpendicular to MC00 at a fixed chainage, shared by both sheets, and
    # running only just past the drawn elements they cross
    for ms, before, after in MATCHLINES:
        if n not in (before, after):
            continue
        other = after if n == before else before
        bm = MC00.at(ms)[2]
        lo, hi = _match_extent(ms)
        pl(c, [P(*MC00.pt(ms, lo)), P(*MC00.pt(ms, hi))], 0.8, INK, (12.0, 3.0, 2.0, 3.0), cap=0)
        for end in (lo, hi):  # short end caps along the chainage direction
            ex, ey = P(*MC00.pt(ms, end))
            tx, ty = math.sin(bm), math.cos(bm)
            pl(c, [(ex - tx * 2.5, ey - ty * 2.5), (ex + tx * 2.5, ey + ty * 2.5)], 0.8, INK)
        lines = ["MATCH LINE CH %.3f" % ms, "ADJOINS DRG " + drg(PLAN_KEYS[other])]
        ang = readable(math.degrees(math.atan2(-math.sin(bm), math.cos(bm))))
        ar = math.radians(ang)
        ax, ay = math.cos(ar), math.sin(ar)  # along the text
        ux, uy = -ay, ax  # up from the baseline
        side = 1.0 if other > n else -1.0  # the overlap zone lies towards the neighbouring sheet
        dx, dy = math.sin(bm) * side, math.cos(bm) * side
        lx, ly = P(*MC00.pt(ms, (hi + 22.0) / 2))  # centred on the stretch beyond the road
        half = max(twidth(t, FB, 8) for t in lines) / 2 + 2.0
        pl(c, [(lx + dx * 0.9 - ax * half, ly + dy * 0.9 - ay * half), (lx + dx * 8.7 - ax * half, ly + dy * 8.7 - ay * half),
               (lx + dx * 8.7 + ax * half, ly + dy * 8.7 + ay * half), (lx + dx * 0.9 + ax * half, ly + dy * 0.9 + ay * half)],
           0, white, close=True, fill=white)
        toward = (ux * dx + uy * dy) > 0
        for j, t in enumerate(lines):
            base = (1.5 if toward else 4.5) + 3.6 * j
            rtext(c, lx + dx * base, ly + dy * base, t, ang, FB, 8, INK, "c")
    c.restoreState()

    # ---- frame furniture (not clipped)
    north_arrow(c, FX0 + 22, FY1 - 28, 9)
    scale_bar(c, FX0 + 18, FY0 + 12, k, [0, 10, 20, 40], "m", "SCALE 1:500")

    # right-hand column: legend, notes, key plan
    xr = FX1 - RIGHT_COL_W - 1.0
    for ms, before, after in MATCHLINES:
        if before == n:  # a matchline runs down the right-hand side of this sheet: keep clear of it
            xr = P(*MC00.pt(ms))[0] - 3.0 - RIGHT_COL_W
    y = FY1 - 1.0
    y = _legend(c, xr, y, RIGHT_COL_W) - 2.0
    rect(c, xr, y - 26.0, RIGHT_COL_W, 26.0, 0.25, INK, white)
    sheet_note_box(c, xr + 4, y - 2, RIGHT_COL_W - 6, "NOTES", [
        "ALL DIMENSIONS ARE IN METRES UNLESS NOTED OTHERWISE.",
        "FOR SETOUT SCHEDULES REFER TO DRG " + drg("setout") + ".",
    ], 6.4, 3.0)
    y -= 28.0
    _keyplan(c, xr, y, RIGHT_COL_W, n)
