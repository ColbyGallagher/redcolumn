"""Plan-view linework for the whole demo site, in world metres.

Everything here is built once from the alignments in geom.py and then clipped
to each plan sheet's window by the sheet drawing code.
"""
import math
import random
from types import SimpleNamespace

from .geom import CREEK, JUNCTION_CH, MC00, MC01, _dist_to_polyline

KERB = 7.0
KERB_BACK = 7.45
JB0, JB1 = 97.5, 122.5  # MC00 chainage range cut by the side-road kerb returns
RETURN_R = 8.0
SIDE_HALF = 4.5


def _frame(al, s):
    x, y, b = al.at(s)
    return x, y, (math.sin(b), math.cos(b)), (math.cos(b), -math.sin(b))


def _rect(al, s, off, along, across):
    """Rectangle of size along x across centred at (s, off) on the alignment."""
    x, y, t, r = _frame(al, s)
    cx, cy = x + r[0] * off, y + r[1] * off
    pts = []
    for a, d in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        pts.append((cx + t[0] * a * along / 2 + r[0] * d * across / 2,
                    cy + t[1] * a * along / 2 + r[1] * d * across / 2))
    return pts


def _nearest_on_polyline(x, y, pl):
    best, bp = 1e9, pl[0]
    for (ax, ay), (bx, by) in zip(pl, pl[1:]):
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        px, py = ax + t * dx, ay + t * dy
        d = math.hypot(x - px, y - py)
        if d < best:
            best, bp = d, (px, py)
    return bp


def _break(al, off, ranges, s0=0.0, s1=None, step=2.0):
    """Offset polylines of al, skipping the given (a, b) chainage ranges."""
    s1 = al.length if s1 is None else s1
    cuts = [s0]
    for a, b in sorted(ranges):
        cuts += [a, b]
    cuts.append(s1)
    out = []
    for i in range(0, len(cuts), 2):
        a, b = cuts[i], cuts[i + 1]
        if b - a > 0.5:
            out.append(al.poly(off, a, b, step))
    return out


def _fillet(cx, cy, r, a0, a1, n=10):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n))
            for i in range(n + 1)]


def build():
    S = SimpleNamespace()
    rng = random.Random(11)
    jx, jy, _ = MC00.at(JUNCTION_CH)

    # ---- existing road (grey) incl. approaches to the limits of works
    def wob(s):
        return 0.5 * math.sin(s / 17.0) + 0.3 * math.sin(s / 7.3)

    S.existing_edges = []
    for side in (-1, 1):
        S.existing_edges.append([MC00.pt(s, side * (5.6 + wob(s))) for s in
                                 [i * 2.0 for i in range(0, 521)]])
    x_start, x_end = MC00.at(0)[0], MC00.at(MC00.length)[0]
    S.existing_edges += [[(0.0, 445.0 + 5.6 * k), (x_start, 445.0 + 5.6 * k)] for k in (-1, 1)]
    S.existing_edges += [[(x_end, 130.0 + 5.6 * k), (1010.0, 130.0 + 5.6 * k)] for k in (-1, 1)]
    S.existing_pave = [
        [(0.0, 439.4), (x_start, 439.4), (x_start, 450.6), (0.0, 450.6)],
        [(x_end, 124.4), (1010.0, 124.4), (1010.0, 135.6), (x_end, 135.6)],
    ]

    # ---- new pavement
    left = MC00.poly(-KERB, 0, MC00.length)
    right = MC00.poly(KERB, 0, MC00.length)
    S.pave = [left + right[::-1]]
    side_l = MC01.poly(-SIDE_HALF, 0, MC01.length)
    side_r = MC01.poly(SIDE_HALF, 0, MC01.length)
    S.pave.append(side_l + side_r[::-1])
    ky = jy - KERB
    kx_w, kx_e = jx - SIDE_HALF, jx + SIDE_HALF
    ret_w = _fillet(kx_w - RETURN_R, ky - RETURN_R, RETURN_R, math.pi / 2, 0.0)
    ret_e = _fillet(kx_e + RETURN_R, ky - RETURN_R, RETURN_R, math.pi / 2, math.pi)
    S.pave.append(ret_w + [(kx_w, ky)])
    S.pave.append(ret_e + [(kx_e, ky)])

    S.kerbs = _break(MC00, -KERB, [])
    S.kerbs += _break(MC00, KERB, [(JB0, JB1)])
    S.kerbs += [ret_w, ret_e]
    S.kerbs += [MC01.poly(-SIDE_HALF, RETURN_R + 7.0, MC01.length),
                MC01.poly(SIDE_HALF, RETURN_R + 7.0, MC01.length)]
    S.kerbs_back = _break(MC00, -KERB_BACK, []) + _break(MC00, KERB_BACK, [(JB0, JB1)])
    S.lane_lines = []
    for off in (-5.0, -3.5, 3.5, 5.0):
        S.lane_lines += _break(MC00, off, [(JB0, JB1)] if off > 0 else [])
    S.paths = []
    for off in (-9.2, -12.2):
        S.paths += _break(MC00, off, [])
    for off in (9.2, 10.7):
        S.paths += _break(MC00, off, [(92.0, 128.0)])
    S.paths += [MC01.poly(-5.4, 20.0, MC01.length), MC01.poly(-6.9, 20.0, MC01.length)]

    # ---- boundaries
    S.constr = _break(MC00, -19.0, []) + _break(MC00, 19.0, [(84.0, 136.0)])
    S.constr += [MC01.poly(-11.5, 22.0, MC01.length), MC01.poly(11.5, 22.0, MC01.length)]
    S.project = _break(MC00, -22.0, []) + _break(MC00, 22.0, [(78.0, 142.0)])
    S.project += [MC01.poly(-14.0, 28.0, MC01.length), MC01.poly(14.0, 28.0, MC01.length)]
    ex, ey, et, er = _frame(MC01, MC01.length)
    S.project.append([(ex - er[0] * 14.0, ey - er[1] * 14.0), (ex + er[0] * 14.0, ey + er[1] * 14.0)])
    S.limit_of_works = [
        ("MC01", [(ex - er[0] * 14.0, ey - er[1] * 14.0), (ex + er[0] * 14.0, ey + er[1] * 14.0)]),
        ("MC00s", [MC00.pt(0.0, -22.0), MC00.pt(0.0, 22.0)]),
        ("MC00e", [MC00.pt(MC00.length, -22.0), MC00.pt(MC00.length, 22.0)]),
    ]

    # ---- cadastre, houses, trees
    S.cadastral, S.buildings = [], []
    for side in (-1, 1):
        stations, s = [], 0.0
        while s < MC00.length:
            stations.append(s)
            s += rng.choice((26.0, 30.0, 34.0, 38.0))
        stations.append(MC00.length)
        front, rear = 16.0 * side, 68.0 * side
        skip = (side > 0)
        S.cadastral += _break(MC00, front, [(99.0, 121.0)] if skip else [])
        S.cadastral += _break(MC00, rear, [(99.0, 121.0)] if skip else [])
        for i, st in enumerate(stations):
            if skip and 99.0 <= st <= 121.0:
                continue
            S.cadastral.append([MC00.pt(st, front), MC00.pt(st, rear)])
        for a, b in zip(stations, stations[1:]):
            mid = (a + b) / 2
            px, py = MC00.pt(mid, side * 32.0)
            if skip and 85.0 <= mid <= 135.0:
                continue
            if _dist_to_polyline(px, py, CREEK) < 28.0:
                continue
            S.buildings.append(_rect(MC00, mid, side * rng.uniform(27.0, 33.0), 11.0, 9.0))
    for side in (-1, 1):
        sts = [16.0, 44.0, 70.0, 96.0, 124.0, MC01.length]
        front, rear = 11.0 * side, 55.0 * side
        S.cadastral.append(MC01.poly(front, 16.0, MC01.length))
        S.cadastral.append(MC01.poly(rear, 16.0, MC01.length))
        for st in sts:
            S.cadastral.append([MC01.pt(st, front), MC01.pt(st, rear)])
        for a, b in zip(sts, sts[1:-1]):
            S.buildings.append(_rect(MC01, (a + b) / 2, side * 24.0, 10.0, 8.0))
    S.cadastral.append([MC01.pt(16.0, 11.0), MC00.pt(JUNCTION_CH + 11.0, 16.0)])
    S.cadastral.append([MC01.pt(16.0, -11.0), MC00.pt(JUNCTION_CH - 11.0, 16.0)])

    S.trees = []
    tries = 0
    while len(S.trees) < 170 and tries < 6000:
        tries += 1
        s = rng.uniform(0, MC00.length)
        off = rng.choice((-1, 1)) * rng.uniform(19.0, 64.0)
        x, y = MC00.pt(s, off)
        if not (0 < x < 1010.0 and 0 < y < 574):
            continue
        if MC00.nearest(x, y)[2] < 18.5 or MC01.nearest(x, y)[2] < 15.0:
            continue
        if _dist_to_polyline(x, y, CREEK) < 12.0:
            continue
        if any(math.hypot(x - bx, y - by) < 9.0 for bx, by in
               ((sum(p[0] for p in b) / 4, sum(p[1] for p in b) / 4) for b in S.buildings)):
            continue
        S.trees.append((x, y, rng.uniform(2.0, 4.2)))
    # a few trees outside the lots (open ground beyond the rear boundaries)
    for _ in range(60):
        x, y = rng.uniform(0, 1010.0), rng.uniform(0, 574)
        if MC00.nearest(x, y)[2] > 75.0 and MC01.nearest(x, y)[2] > 70.0 and \
                _dist_to_polyline(x, y, CREEK) > 14.0:
            S.trees.append((x, y, rng.uniform(2.5, 5.0)))

    # ---- park south-west of the S-bend
    S.park = [(396.0, 62.0), (452.0, 62.0), (452.0, 252.0), (396.0, 252.0)]
    S.pond = [(424.0 + 17.0 * math.cos(a / 24.0 * 2 * math.pi), 118.0 + 15.0 * math.sin(a / 24.0 * 2 * math.pi) + 3.0 * math.sin(a / 24.0 * 6 * math.pi))
              for a in range(25)]
    S.park_paths = [[(396.0, 200.0), (418.0, 190.0), (438.0, 196.0), (452.0, 175.0)],
                    [(424.0, 62.0), (426.0, 100.0), (438.0, 150.0), (440.0, 252.0)]]
    for _ in range(26):
        S.trees.append((rng.uniform(402.0, 446.0), rng.uniform(150.0, 248.0), rng.uniform(2.5, 4.5)))
    for _ in range(10):
        S.trees.append((rng.uniform(402.0, 446.0), rng.uniform(66.0, 96.0), rng.uniform(2.5, 4.5)))

    # ---- drainage, lighting, services
    S.pits, S.pipes, S.lights = [], [], []
    stations = [20.0 + 40.0 * k for k in range(26)]
    for st in stations:
        if 85.0 <= st <= 135.0 or 895.0 <= st <= 935.0 or st > MC00.length:
            continue
        S.pits.append(MC00.pt(st, 7.9))
        if int(round((st - 20) / 40)) % 2 == 0:
            S.pits.append(MC00.pt(st + 4.0, -7.9))
    S.pipes += _break(MC00, 8.6, [], 20.0, 900.0, 4.0)
    S.pipes += _break(MC00, 8.6, [], 936.0, 1020.0, 4.0)
    ox, oy = MC00.pt(900.0, 8.6)
    cx, cy = _nearest_on_polyline(ox, oy, CREEK)
    S.pipes.append([(ox, oy), (cx, cy)])
    S.headwall = (cx, cy)
    S.pipes.append([MC01.pt(24.0, 5.6), MC01.pt(MC01.length - 8.0, 5.6)])
    for k in range(0, 26):
        st = 40.0 * k + 6.0
        if st > MC00.length - 8:
            continue
        if not (90.0 <= st <= 130.0):
            S.lights.append(MC00.pt(st, 8.3))
    S.sewer = _break(MC00, -15.0, [])
    S.water = _break(MC00, 12.4, [(80.0, 140.0)])
    S.power = _break(MC00, -13.4, [])
    S.comms = _break(MC00, 13.6, [(80.0, 140.0)])

    # ---- creek and culvert
    S.creek = CREEK
    cxm, cym = 780.0, 130.0
    d = (15.0, 60.0)
    n = math.hypot(*d)
    t = (d[0] / n, d[1] / n)
    r = (t[1], -t[0])
    S.culvert = [(cxm - t[0] * 20 - r[0] * 3.2, cym - t[1] * 20 - r[1] * 3.2),
                 (cxm + t[0] * 20 - r[0] * 3.2, cym + t[1] * 20 - r[1] * 3.2),
                 (cxm + t[0] * 20 + r[0] * 3.2, cym + t[1] * 20 + r[1] * 3.2),
                 (cxm - t[0] * 20 + r[0] * 3.2, cym - t[1] * 20 + r[1] * 3.2)]
    S.culvert_mid = (cxm, cym)
    S.culvert_dir = math.degrees(math.atan2(t[1], t[0]))

    # ---- junction details for annotation
    S.junction = (jx, jy)
    return S


_SITE = None


def site():
    global _SITE
    if _SITE is None:
        _SITE = build()
    return _SITE
