"""Fictional road geometry shared by every sheet of the demo set.

World coordinates are metres, x east and y north, origin at the lower-left of
the overall plan extents. Offsets from an alignment are positive to the right
looking up-chainage.
"""
import bisect
import math

import numpy as np

# ---------------------------------------------------------------- plan windows
PLAN_SCALE = 500
MM_PER_M = 1000.0 / PLAN_SCALE
WIN_W, WIN_H = 325.5, 287.0  # world metres covered by one A1 plan sheet
WORLD_W, WORLD_H = 1010.0, 574.0
E0, N0 = 318250.0, 6246900.0  # MGA zone 56 coordinates of the world origin


def bearing_dms(b):
    d = math.degrees(b) % 360.0
    deg = int(d)
    m = (d - deg) * 60
    mi = int(m)
    sec = round((m - mi) * 60)
    if sec == 60:
        sec, mi = 0, mi + 1
    if mi == 60:
        mi, deg = 0, deg + 1
    return "%d°%02d'%02d\"" % (deg % 360, mi, sec)


# ---------------------------------------------------------------- horizontal
class Alignment:
    """Tangent and circular-arc alignment.

    elems: ("S", length) or ("C", radius, turn, delta_deg) with turn +1 for a
    right-hand curve and -1 for left.
    """

    def __init__(self, name, start, bearing_deg, elems):
        self.name = name
        self.els = []
        x, y, b, s = start[0], start[1], math.radians(bearing_deg), 0.0
        for e in elems:
            if e[0] == "S":
                length = e[1]
                el = dict(kind="S", s0=s, s1=s + length, x0=x, y0=y, b0=b, R=0.0, k=0.0, turn=0)
                x += length * math.sin(b)
                y += length * math.cos(b)
            else:
                _, R, turn, delta = e
                length = R * math.radians(delta)
                k = turn / R
                el = dict(kind="C", s0=s, s1=s + length, x0=x, y0=y, b0=b, R=R, k=k, turn=turn)
                b1 = b + turn * math.radians(delta)
                x += (math.cos(b) - math.cos(b1)) / k
                y += (math.sin(b1) - math.sin(b)) / k
                b = b1
            s += length
            el["x1"], el["y1"], el["b1"] = x, y, b
            self.els.append(el)
        self.length = s
        self._starts = [e["s0"] for e in self.els]
        # dense table for nearest-point queries
        n = int(math.ceil(self.length)) + 1
        ss = np.linspace(0, self.length, n * 2)
        pts = np.array([self.at(v)[:2] for v in ss])
        self._ss, self._pts = ss, pts
        hb = [self.at(v)[2] for v in ss]
        self._hb = np.array(hb)

    def _el(self, s):
        i = bisect.bisect_right(self._starts, s) - 1
        return self.els[max(0, min(i, len(self.els) - 1))]

    def at(self, s):
        s = max(0.0, min(self.length, s))
        e = self._el(s)
        d = s - e["s0"]
        if e["kind"] == "S":
            return (e["x0"] + d * math.sin(e["b0"]), e["y0"] + d * math.cos(e["b0"]), e["b0"])
        b = e["b0"] + e["k"] * d
        x = e["x0"] + (math.cos(e["b0"]) - math.cos(b)) / e["k"]
        y = e["y0"] + (math.sin(b) - math.sin(e["b0"])) / e["k"]
        return (x, y, b)

    def pt(self, s, off=0.0):
        x, y, b = self.at(s)
        return (x + off * math.cos(b), y - off * math.sin(b))

    def poly(self, off, s0=0.0, s1=None, step=2.0):
        s1 = self.length if s1 is None else s1
        n = max(2, int(math.ceil((s1 - s0) / step)) + 1)
        return [self.pt(s0 + (s1 - s0) * i / (n - 1), off) for i in range(n)]

    def nearest(self, x, y):
        d2 = (self._pts[:, 0] - x) ** 2 + (self._pts[:, 1] - y) ** 2
        i = int(np.argmin(d2))
        b = self._hb[i]
        rx, ry = math.cos(b), -math.sin(b)
        off = (x - self._pts[i, 0]) * rx + (y - self._pts[i, 1]) * ry
        return self._ss[i], off, math.sqrt(float(d2[i]))

    def key_stations(self):
        """Chainages where the horizontal geometry changes, with a label."""
        out = [(0.0, "START")]
        for e in self.els:
            if e["s0"] > 0:
                out.append((e["s0"], "TC" if e["kind"] == "C" else "CT"))
        out.append((self.length, "END"))
        return out


# ---------------------------------------------------------------- vertical
class Vertical:
    def __init__(self, pvis):
        """pvis: list of (chainage, RL, curve length)."""
        self.pvis = pvis
        self.grades = [
            (pvis[i + 1][1] - pvis[i][1]) / (pvis[i + 1][0] - pvis[i][0])
            for i in range(len(pvis) - 1)
        ]
        self.curves = []
        for i in range(1, len(pvis) - 1):
            s, rl, L = pvis[i]
            if L <= 0:
                continue
            g1, g2 = self.grades[i - 1], self.grades[i]
            A = (g2 - g1) * 100.0
            self.curves.append(dict(
                s=s, rl=rl, L=L, g1=g1, g2=g2, A=A, K=L / abs(A),
                vs=s - L / 2, ve=s + L / 2, kind="CREST" if g2 < g1 else "SAG",
            ))

    def grade(self, s):
        for c in self.curves:
            if c["vs"] <= s <= c["ve"]:
                return c["g1"] + (c["g2"] - c["g1"]) * (s - c["vs"]) / c["L"]
        i = self._tangent(s)
        return self.grades[i]

    def _tangent(self, s):
        for i in range(len(self.grades)):
            if s <= self.pvis[i + 1][0]:
                return i
        return len(self.grades) - 1

    def level(self, s):
        for c in self.curves:
            if c["vs"] <= s <= c["ve"]:
                x = s - c["vs"]
                y0 = c["rl"] - c["g1"] * c["L"] / 2
                return y0 + c["g1"] * x + (c["g2"] - c["g1"]) * x * x / (2 * c["L"])
        i = self._tangent(s)
        s0, r0, _ = self.pvis[i]
        return r0 + self.grades[i] * (s - s0)


# ---------------------------------------------------------------- the road
# 330 m tangent, right-hand curve, 35 m tangent, left-hand curve, then a straight
# long enough to make the control line exactly 1040 m
_ARC = 140.0 * math.pi / 2
MC00 = Alignment("MC00", (60.0, 445.0), 90.0, [
    ("S", 330.0), ("C", 140.0, +1, 90.0), ("S", 35.0), ("C", 140.0, -1, 90.0),
    ("S", 1040.0 - (330.0 + 35.0 + 2 * _ARC)),
])

JUNCTION_CH = 110.0  # MC01 leaves MC00 here
_jx, _jy, _ = MC00.at(JUNCTION_CH)
MC01 = Alignment("MC01", (_jx, _jy), 180.0, [
    ("S", 60.0), ("C", 120.0, -1, 35.0), ("S", 20.0),
])

# ---- plan sheet windows and matchlines
# A matchline is the line perpendicular to MC00 at a fixed chainage. Both sheets it joins draw
# the same line, and each window runs MATCH_INSET metres past it, so the matchline sits inside
# the frame and the two sheets overlap by that margin.
MATCH_INSET = 18.0
MATCHLINES = [(280.0, 1, 2), (565.0, 2, 3), (830.0, 3, 4)]  # chainage, sheet before, sheet after
_m1 = MC00.at(MATCHLINES[0][0])
_m2 = MC00.at(MATCHLINES[1][0])
_m3 = MC00.at(MATCHLINES[2][0])
# sheet number -> world coordinates of the window's lower-left corner
WINDOWS = {
    1: (_m1[0] + MATCH_INSET - WIN_W, WIN_H),
    2: (_m1[0] - MATCH_INSET, _m2[1] - MATCH_INSET),
    3: (_m3[0] + MATCH_INSET - WIN_W, _m2[1] + MATCH_INSET - WIN_H),
    4: (_m3[0] - MATCH_INSET, _m2[1] + MATCH_INSET - WIN_H),
}

# existing ground ------------------------------------------------------------
CREEK = [(745.0, 0.0), (765.0, 70.0), (780.0, 130.0), (805.0, 200.0), (820.0, 287.0), (835.0, 330.0)]


def _dist_to_polyline(x, y, pl):
    best = 1e9
    for (ax, ay), (bx, by) in zip(pl, pl[1:]):
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
    return best


def ground_base(x, y):
    return (12.4 + 3.0 * math.sin(x / 95.0 + 0.6) + 1.6 * math.cos(y / 70.0 - 0.3)
            + 1.0 * math.sin((x + y) / 45.0) - 0.0028 * (y - 300.0))


def ground(x, y):
    """Existing surface level (m AHD)."""
    d = _dist_to_polyline(x, y, CREEK)
    return ground_base(x, y) - 3.0 * math.exp(-(d / 14.0) ** 2)


def _smooth_base(al, s, half=30.0):
    vals = []
    for k in range(-6, 7):
        sv = max(0.0, min(al.length, s + half * k / 6.0))
        x, y, _ = al.at(sv)
        vals.append(ground_base(x, y))
    return sum(vals) / len(vals)


def _pvis(al, stations, curves, bias):
    return [(s, round(_smooth_base(al, s) + b, 3), L) for s, L, b in zip(stations, curves, bias)]


V00 = Vertical(_pvis(
    MC00,
    [0, 110, 220, 330, 440, 540, 640, 740, 840, 940, 1040],
    [0, 70, 80, 90, 90, 90, 90, 90, 90, 80, 0],
    [0.15, -0.20, 0.25, -0.10, 0.20, 0.15, -0.15, 0.20, 0.35, 0.10, 0.10],
))
_r01 = V00.level(JUNCTION_CH) - 0.12
V01 = Vertical([(0.0, _r01, 0), (45.0, _r01 - 1.1, 40.0), (MC01.length, _r01 - 4.2, 0)])

# crossfall knots: (chainage, left grade, right grade) -- grades are outward from the
# crown, so a normal section is -3% each side and superelevation tilts both
CROSSFALL = [
    (-1e9, -0.03, -0.03), (270.0, -0.03, -0.03), (340.0, +0.04, -0.04), (530.0, +0.04, -0.04),
    (600.0, -0.04, +0.04), (790.0, -0.04, +0.04), (840.0, -0.03, -0.03), (1e9, -0.03, -0.03),
]


def crossfall(s):
    for (s0, l0, r0), (s1, l1, r1) in zip(CROSSFALL, CROSSFALL[1:]):
        if s0 <= s <= s1:
            t = 0.0 if s1 == s0 else (s - s0) / (s1 - s0)
            return l0 + (l1 - l0) * t, r0 + (r1 - r0) * t
    return -0.03, -0.03


# ---------------------------------------------------------------- cross-section build-up
HALF_W = 7.0  # kerb line offset, both sides of the control line
KERB_W = 0.45
VERGE_L = 1.75
PATH_L = 3.0  # shared path on the left
PATH_R = 1.5  # footpath on the right
CUT_BATTER = 2.0  # H per 1V
FILL_BATTER = 3.0


def design_section(al, vert, s):
    """Design string points for the cross-section at chainage s.

    Returns ([(offset, level, code), ...] left to right, centre RL).
    """
    rl = vert.level(s)
    sl, sr = crossfall(s) if al is MC00 else (-0.03, -0.03)

    def lv(off):
        return rl + (sl if off < 0 else sr) * abs(off)

    path_in = HALF_W + KERB_W + VERGE_L
    spec = [(-(path_in + PATH_L), 0.02, "PATH-OUT"), (-path_in, 0.02, "PATH-IN"),
            (-(HALF_W + KERB_W), 0.15, "BOK"), (-HALF_W, 0.0, "KERB"), (-3.5, 0.0, "LANE"),
            (0.0, 0.0, "CL"), (3.5, 0.0, "LANE"), (HALF_W, 0.0, "KERB"),
            (HALF_W + KERB_W, 0.15, "BOK"), (path_in, 0.02, "PATH-IN"),
            (path_in + PATH_R, 0.02, "PATH-OUT")]
    return [(o, (rl if o == 0 else lv(o)) + d, code) for o, d, code in spec], rl


def daylight(al, s, side, off0, lvl0):
    """Offset/level where a batter from (off0, lvl0) meets existing ground."""
    sign = -1 if side < 0 else 1
    best = (off0 + sign * 8.0, ground(*al.pt(s, off0 + sign * 8.0)))
    for i in range(1, 80):
        d = i * 0.25
        o = off0 + sign * d
        g = ground(*al.pt(s, o))
        # batter level at this distance
        cut = g > lvl0
        lb = lvl0 + (d / CUT_BATTER if cut else -d / FILL_BATTER)
        if (cut and lb >= g) or ((not cut) and lb <= g):
            return o, lb
        best = (o, g)
    return best


# the new culvert under MC00 where the creek crosses
CULVERT_CH = 914.82
CULVERT_INV = round(ground(*MC00.pt(CULVERT_CH)) - 0.6, 2)


if __name__ == "__main__":
    print("MC00 length", MC00.length, "MC01 length", MC01.length)
    for e in MC00.els:
        print(e["kind"], round(e["s0"], 3), round(e["s1"], 3), "end", round(e["x1"], 1), round(e["y1"], 1))
    # plan-sheet chainage ranges
    for n, (wx, wy) in WINDOWS.items():
        ins = [s for s in np.arange(0, MC00.length, 1.0)
               if wx <= MC00.at(s)[0] <= wx + WIN_W and wy <= MC00.at(s)[1] <= wy + WIN_H]
        print("sheet", n, "CH", min(ins), "-", max(ins))
    print("PVIs", V00.pvis)
    mx = 0
    for s in range(0, 1041, 10):
        x, y, _ = MC00.at(s)
        d = V00.level(s) - ground(x, y)
        mx = max(mx, abs(d))
        if s % 80 == 0:
            print(s, round(V00.level(s), 3), round(ground(x, y), 3), round(d, 2))
    print("max |design-existing|", round(mx, 2))
    print("curves", [(c["s"], round(c["K"], 1), c["kind"]) for c in V00.curves])
    print("MC01 rl", V01.pvis)
    print("MC01 end", MC01.at(MC01.length))
