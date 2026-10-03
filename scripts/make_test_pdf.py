"""Generate a heavy synthetic ARCH D (36x24in) drawing set for render benchmarking.

Usage: python scripts/make_test_pdf.py [out.pdf] [pages] [segments_per_page]
Writes a raw PDF (no dependencies) with dense line work, contour-like curves, and text.
"""
import math
import random
import sys
import zlib

W, H = 36 * 72, 24 * 72


def page_content(seed: int, segments: int) -> bytes:
    rnd = random.Random(seed)
    out = ["0.2 w 0 0 0 RG"]
    # Grid of "lots" / building outlines.
    for _ in range(segments // 4):
        x, y = rnd.uniform(72, W - 300), rnd.uniform(72, H - 300)
        w, h = rnd.uniform(10, 200), rnd.uniform(10, 200)
        out.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re S")
    # Contour-ish polylines.
    out.append("0.35 w 0.4 0.25 0.1 RG")
    for c in range(40):
        base = 100 + c * (H - 200) / 40
        pts = [
            (x, base + 40 * math.sin(x / 150 + c) + 15 * math.sin(x / 37 + seed))
            for x in range(72, W - 72, 8)
        ]
        out.append(f"{pts[0][0]:.2f} {pts[0][1]:.2f} m " + " ".join(f"{px:.2f} {py:.2f} l" for px, py in pts[1:]) + " S")
    # Random short segments (hatching / utilities).
    out.append("0.15 w 0 0 0.6 RG")
    for _ in range(segments):
        x, y = rnd.uniform(36, W - 36), rnd.uniform(36, H - 36)
        a = rnd.uniform(0, math.pi)
        l = rnd.uniform(2, 25)
        out.append(f"{x:.2f} {y:.2f} m {x + l * math.cos(a):.2f} {y + l * math.sin(a):.2f} l S")
    # Labels and a title block.
    out.append("BT /F1 6 Tf 0 0 0 rg")
    for _ in range(600):
        out.append(f"1 0 0 1 {rnd.uniform(72, W - 200):.2f} {rnd.uniform(72, H - 72):.2f} Tm (STA {rnd.randint(0, 99)}+{rnd.randint(0, 99):02d}) Tj")
    out.append("ET")
    titles = ["EXISTING CONDITIONS", "DEMOLITION PLAN", "GRADING AND DRAINAGE PLAN", "UTILITY PLAN", "EROSION CONTROL PLAN"]
    title = titles[seed % len(titles)]
    out.append(f"1 w 0 0 0 RG 36 36 {W - 72} {H - 72} re S {W - 400} 36 364 170 re S")
    out.append(
        f"BT /F1 7 Tf {W - 380} 190 Td (SHEET TITLE) Tj /F1 14 Tf 0 -20 Td ({title}) Tj "
        f"/F1 8 Tf 0 -20 Td (SCALE: 1\\\" = 20') Tj /F1 7 Tf 250 -14 Td (SHEET NO.) Tj ET"
    )
    out.append(f"BT /F1 28 Tf {W - 130} 80 Td (C-{101 + seed}) Tj /F1 8 Tf {-250} -30 Td (MATCH LINE STA {seed * 10}+00  SEE SHEET C-{102 + seed}) Tj ET")
    out.extend(callouts(seed))
    return "\n".join(out).encode()


def bubble(x: float, y: float, top: str, bottom: str, size: float) -> list[str]:
    """Detail/section bubble in PDF user space (y up): a circle split by a line, id over sheet."""
    r = size * 1.9
    k = 0.5523 * r
    return [
        "1 1 1 rg 0.8 w 0 0 0 RG",
        f"{x + r} {y} m {x + r} {y + k} {x + k} {y + r} {x} {y + r} c {x - k} {y + r} {x - r} {y + k} {x - r} {y} c "
        f"{x - r} {y - k} {x - k} {y - r} {x} {y - r} c {x + k} {y - r} {x + r} {y - k} {x + r} {y} c B",
        f"{x - r} {y} m {x + r} {y} l S",
        f"0 0 0 rg BT /F1 {size} Tf {x - len(top) * size * 0.28} {y + size * 0.35} Td ({top}) Tj ET",
        f"BT /F1 {size * 0.8} Tf {x - len(bottom) * size * 0.22} {y - size * 1.05} Td ({bottom}) Tj ET",
    ]


def callouts(seed: int) -> list[str]:
    """Cross-references for link testing: every sheet calls out details on C-104 (index 3)."""
    ops = bubble(900, 900, str(3), "C-104", 10) + bubble(1300, 700, "A", "C-104", 10)
    ops.append(f"0 0 0 rg BT /F1 9 Tf 700 500 Td (SEE DETAIL 4/C-104 FOR TRENCH BACKFILL) Tj ET")
    ops.append(f"BT /F1 9 Tf 700 470 Td (FOR PROFILE SEE SHEET C-10{5 if seed != 4 else 1}) Tj ET")
    if seed == 3:
        # Detail titles on C-104 itself: large bubbles naming this sheet, with titles alongside.
        for i, (tid, title) in enumerate([("3", "CURB AND GUTTER"), ("4", "TRENCH SECTION"), ("A", "STORM INLET")]):
            x = 400 + i * 700
            ops += bubble(x, 300, tid, "C-104", 16)
            ops.append(f"BT /F1 14 Tf {x + 45} 295 Td ({title}) Tj ET")
    return ops


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "test-heavy.pdf"
    pages = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    segments = int(sys.argv[3]) if len(sys.argv) > 3 else 200_000

    objs: list[bytes] = []

    def add(body: bytes) -> int:
        objs.append(body)
        return len(objs)

    catalog = add(b"")
    pages_obj = add(b"")
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids = []
    for i in range(pages):
        data = zlib.compress(page_content(i, segments), 6)
        content = add(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(data) + data + b"\nendstream")
        kids.append(
            add(
                f"<< /Type /Page /Parent {pages_obj} 0 R /MediaBox [0 0 {W} {H}] "
                f"/Resources << /Font << /F1 {font} 0 R >> >> /Contents {content} 0 R >>".encode()
            )
        )
    objs[catalog - 1] = f"<< /Type /Catalog /Pages {pages_obj} 0 R >>".encode()
    objs[pages_obj - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {pages} >>".encode()

    buf = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, body in enumerate(objs, 1):
        offsets.append(len(buf))
        buf += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(buf)
    buf += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    buf += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    buf += f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    with open(out_path, "wb") as f:
        f.write(buf)
    print(f"wrote {out_path}: {pages} pages, {len(buf) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
