"""Generate a civil plan set cut into rotated sheets along match lines, for stitching tests.

Usage: python scripts/make_stitch_test_pdf.py [out.pdf]

A road corridor (edges, centreline, utilities, cross streets, street names) is drawn in "world"
coordinates, then cut at stations 10+00 and 20+00 onto three 36x24 sheets, each rotated
differently, with labelled dashed match lines and title blocks. Stitching should put them back
together exactly.
"""
import math
import sys
import zlib

W, H = 36 * 72, 24 * 72

SHEETS = [
    # number, title, world x-range, rotation (radians, counter-clockwise on paper)
    ("C-101", "ROADWAY PLAN STA 0+00 TO 10+00", (-100, 1000), 0.2),
    ("C-102", "ROADWAY PLAN STA 10+00 TO 20+00", (1000, 2000), -0.45),
    ("C-103", "ROADWAY PLAN STA 20+00 TO 31+00", (2000, 3100), math.pi / 2),
]
MATCH = [(1000, "10+00"), (2000, "20+00")]


def world_lines():
    for y in (-20, 0, 20, 35, -52, 88, -130):
        yield (-100, y, 3100, y)
    for x in (230, 610, 980, 1015, 1333, 1720, 1985, 2040, 2480):
        yield (x, -300, x, 300)
    for x in (400, 995, 1500, 2010):
        yield (x - 60, -200, x + 60, 200)


def clip_x(seg, x0, x1):
    ax, ay, bx, by = seg
    if max(ax, bx) < x0 or min(ax, bx) > x1:
        return None

    def at(x):
        return (x, ay) if bx == ax else (x, ay + (by - ay) * (x - ax) / (bx - ax))

    s = at(x0) if ax < x0 else at(x1) if ax > x1 else (ax, ay)
    e = at(x0) if bx < x0 else at(x1) if bx > x1 else (bx, by)
    return (*s, *e)


def page_ops(number, title, x_range, angle):
    x0, x1 = x_range
    cx = (x0 + x1) / 2
    c, s = math.cos(angle), math.sin(angle)

    # World (y up on paper, like PDF) -> PDF user space: rotate about the slice centre, centre on sheet.
    def tf(x, y):
        x -= cx
        return (W / 2 + c * x - s * y, H / 2 + s * x + c * y)

    ops = ["0.6 w 0 0 0 RG"]
    for seg in world_lines():
        clipped = clip_x(seg, x0, x1)
        if clipped:
            a, b = tf(clipped[0], clipped[1]), tf(clipped[2], clipped[3])
            ops.append(f"{a[0]:.3f} {a[1]:.3f} m {b[0]:.3f} {b[1]:.3f} l S")

    def text(t, x, y, size, rot=0.0):
        px, py = tf(x, y)
        a = angle + rot
        return f"BT /F1 {size} Tf {math.cos(a):.5f} {math.sin(a):.5f} {-math.sin(a):.5f} {math.cos(a):.5f} {px:.3f} {py:.3f} Tm ({t}) Tj ET"

    # Street names and station ticks along the road, so a misalignment is visible.
    ops.append("0 0 0 rg")
    for x in range(0, 3100, 100):
        if x0 <= x <= x1:
            ops.append(text(f"{x // 100}+00", x - 12, -40, 7))
    for x, name in ((500, "MAIN STREET"), (1300, "MAIN STREET"), (2600, "MAIN STREET")):
        if x0 <= x - 60 and x + 60 <= x1:
            ops.append(text(name, x - 50, 5, 9))

    # Match lines: heavy dashed lines, labels running along them on this sheet's side.
    ops.append("1.8 w 0.2 0.2 0.2 RG")
    for mx, station in MATCH:
        if mx not in (x0, x1):
            continue
        for y in range(-320, 320, 30):
            a, b = tf(mx, y), tf(mx, y + 18)
            ops.append(f"{a[0]:.3f} {a[1]:.3f} m {b[0]:.3f} {b[1]:.3f} l S")
        side = -1 if mx == x1 else 1
        target = next(n for n, _, (a0, a1), _ in SHEETS if (a0 == mx if mx == x1 else a1 == mx))
        # Text runs up the match line, set just inside this sheet's side.
        ops.append(text(f"MATCH LINE STA {station} SEE SHEET {target}", mx + side * 14 - (8 if side < 0 else 0), -250, 10, math.pi / 2))

    # Title block (unrotated, bottom right) and border.
    ops.append("1 w 0 0 0 RG 36 36 {} {} re S {} 36 364 170 re S".format(W - 72, H - 72, W - 400))
    ops.append(f"BT /F1 7 Tf {W - 380} 190 Td (SHEET TITLE) Tj /F1 12 Tf 0 -20 Td ({title}) Tj /F1 8 Tf 0 -20 Td (SCALE: 1\\\" = 20') Tj ET")
    ops.append(f"BT /F1 28 Tf {W - 130} 80 Td ({number}) Tj ET")
    return "\n".join(ops).encode()


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "stitch-test.pdf"
    objs = []

    def add(body):
        objs.append(body)
        return len(objs)

    catalog, pages_obj = add(b""), add(b"")
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids = []
    for number, title, rng, angle in SHEETS:
        data = zlib.compress(page_ops(number, title, rng, angle))
        content = add(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(data) + data + b"\nendstream")
        kids.append(add(f"<< /Type /Page /Parent {pages_obj} 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 {font} 0 R >> >> /Contents {content} 0 R >>".encode()))
    objs[catalog - 1] = f"<< /Type /Catalog /Pages {pages_obj} 0 R >>".encode()
    objs[pages_obj - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()
    buf = bytearray(b"%PDF-1.7\n")
    offsets = []
    for n, body in enumerate(objs, 1):
        offsets.append(len(buf))
        buf += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(buf)
    buf += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    buf += f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    open(out_path, "wb").write(buf)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
