"""A1 title block (full-height strip on the right edge) plus sheet frame.

The block is a full-height strip down the right-hand edge of the sheet. All
project, company and people names are fictional.

`draw_titleblock(c, D)` stamps one page from a data dict shaped like SAMPLE.
"""
import sys

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

# ---------------------------------------------------------------- sheet
SHEET_W, SHEET_H = 841, 594  # A1 landscape, mm
MARGIN = 10
STRIP_W = 170
X0 = SHEET_W - MARGIN - STRIP_W  # left edge of the title block strip
TOP = SHEET_H - MARGIN

NAVY = HexColor("#12263A")
ORANGE = HexColor("#E4572E")
INK = HexColor("#1B1F24")
GREY = HexColor("#6B7480")
PALE = HexColor("#F1F3F5")
RULE = HexColor("#9AA3AD")
RED = HexColor("#C8102E")

F = "Helvetica"
FB = "Helvetica-Bold"

# ---------------------------------------------------------------- data
SAMPLE = {
    "drg_no": "KRU2-MCC-0412-CV-DRG-003101",
    "client": ("NORTHGATE", "REGIONAL COUNCIL", "Infrastructure Delivery  |  Roads & Drainage"),
    "project": ("KESTREL ROAD", "UPGRADE", "STAGE 2",
                "Marlow Street to Ironbark Avenue", "Northgate NSW 2217"),
    "package": "DESIGN PACKAGE DP03  |  DRAINAGE & STORMWATER",
    "project_no": "25-0412",
    "company": ("MERIDIAN", "CIVIL CONSULTING"),
    "address": ("Level 9, 140 Harbour Street, Sydney NSW 2000",
                "Tel: +61 2 5550 0142",
                "meridiancivil.example"),
    "title": ("DRAINAGE LAYOUT", "CH 0+000 TO CH 0+640", "SHEET 1 OF 4"),
    "rev": "C",
    "status": "S3  FOR REVIEW AND COMMENT",
    "issue_date": "30.10.26",
    "edms": "DS2026/01877",
    "size": "A1",
    "scale": "1:500",
    "revisions": [
        ("A", "50% DETAILED DESIGN", "AN", "SI", "TM", "28.05.26"),
        ("B", "80% DETAILED DESIGN", "AN", "SI", "TM", "14.08.26"),
        ("C", "100% DETAILED DESIGN", "AN", "SI", "TM", "30.10.26"),
    ],
    "signoff": [
        ("DRAWN", "AMINA NGUYEN", "AN", "30.10.26"),
        ("DESIGNED", "RAFAEL OKAFOR", "RO", "30.10.26"),
        ("DRAWING CHECK", "LENA HARTMANN", "LH", "30.10.26"),
        ("DESIGN CHECK", "SANJAY IYER", "SI", "30.10.26"),
        ("PROJECT MANAGER", "DEIRDRE KOWALSKI", "DK", "30.10.26"),
        ("APPROVED", "TOBY McALLISTER", "TM", "30.10.26"),
    ],
    "meta": [
        ("COORDINATE SYSTEM", "GDA2020 / MGA ZONE 56", "HEIGHT DATUM", "AHD71"),
        ("DISCIPLINE", "CIVIL / STORMWATER", "DESIGN LOT CODE", "LOT-03"),
        ("CONTRACT No", "NRC-C-2026-014", "BRIDGE / ASSET No", "N/A"),
        ("REFERENCES", "KRU2-MCC-0412-CV-DRG-000001", "AMENDMENT No", "AMD-0006"),
    ],
    "disclaimer": (
        "This drawing and the related information have been prepared by, or at the request of, "
        "Northgate Regional Council for a specific purpose and may not be used for any purpose other "
        "than the purpose intended. Northgate Regional Council does not provide any warranties and "
        "accepts no liability arising out of the use of this drawing for any other purpose. This "
        "drawing is protected by copyright and no part may be reproduced in any form without the "
        "express written permission of Northgate Regional Council."
    ),
    "file": "KRU2-MCC-0412-CV-DRG-003101.dwg",
    "plot": "30/10/2026 4:12:05 PM",
}


# ---------------------------------------------------------------- helpers
def mm_(v):
    return v * mm


def line_w(c, w_mm):
    c.setLineWidth(w_mm * mm)


def box(c, x, yt, w, h, fill=None, stroke=RULE, lw=0.18):
    """Rectangle given its left edge and TOP edge (mm)."""
    if fill is not None:
        c.setFillColor(fill)
    line_w(c, lw)
    c.setStrokeColor(stroke)
    c.rect(x * mm, (yt - h) * mm, w * mm, h * mm, fill=1 if fill is not None else 0,
           stroke=1 if stroke is not None else 0)


def hline(c, x1, x2, y, lw=0.18, color=RULE):
    line_w(c, lw)
    c.setStrokeColor(color)
    c.line(x1 * mm, y * mm, x2 * mm, y * mm)


def fit_size(text, font, size, max_w_mm):
    w = stringWidth(text, font, size) / mm
    return size if w <= max_w_mm else size * max_w_mm / w


def text(c, x, y, s, font=F, size=10, color=INK, align="l", max_w=None):
    """Draw text with its baseline at y (mm); shrinks to max_w if given."""
    if max_w:
        size = fit_size(s, font, size, max_w)
    c.setFont(font, size)
    c.setFillColor(color)
    if align == "l":
        c.drawString(x * mm, y * mm, s)
    elif align == "r":
        c.drawRightString(x * mm, y * mm, s)
    else:
        c.drawCentredString(x * mm, y * mm, s)


def pt_mm(pt):
    return pt / 2.835


def cell(c, x, yt, w, h, label, value, vsize=12, vfont=FB, vcolor=INK, align="l", fill=None):
    box(c, x, yt, w, h, fill=fill)
    text(c, x + 2.2, yt - 3.4, label, F, 6.2, GREY)
    area_mid = ((yt - 4.2) + (yt - h)) / 2
    base = area_mid - pt_mm(vsize) * 0.35
    pad = 2.2
    if align == "l":
        text(c, x + pad, base, value, vfont, vsize, vcolor, "l", max_w=w - 2 * pad)
    elif align == "c":
        text(c, x + w / 2, base, value, vfont, vsize, vcolor, "c", max_w=w - 2 * pad)
    else:
        text(c, x + w - pad, base, value, vfont, vsize, vcolor, "r", max_w=w - 2 * pad)


def poly(c, pts, fill):
    p = c.beginPath()
    p.moveTo(pts[0][0] * mm, pts[0][1] * mm)
    for px, py in pts[1:]:
        p.lineTo(px * mm, py * mm)
    p.close()
    c.setFillColor(fill)
    c.drawPath(p, fill=1, stroke=0)


# ---------------------------------------------------------------- logos (fictional)
def client_mark(c, cx, cy, r=9):
    c.setFillColor(NAVY)
    c.circle(cx * mm, cy * mm, r * mm, fill=1, stroke=0)
    # four-point star
    s, t = r * 0.72, r * 0.2
    poly(c, [(cx, cy + s), (cx + t, cy + t), (cx + s, cy), (cx + t, cy - t),
             (cx, cy - s), (cx - t, cy - t), (cx - s, cy), (cx - t, cy + t)], white)
    c.setFillColor(ORANGE)
    c.circle(cx * mm, cy * mm, r * 0.14 * mm, fill=1, stroke=0)


def company_mark(c, x, y, s=15):
    """Three rising bars, y is the bottom edge."""
    bw = s * 0.26
    gap = s * 0.11
    for i, (hh, col) in enumerate([(0.55, NAVY), (0.78, NAVY), (1.0, ORANGE)]):
        c.setFillColor(col)
        c.rect((x + i * (bw + gap)) * mm, y * mm, bw * mm, s * hh * mm, fill=1, stroke=0)


# ---------------------------------------------------------------- blocks
def block_client(c, D, yt, h):
    d = D["client"]
    box(c, X0, yt, STRIP_W, h)
    text(c, X0 + 2.2, yt - 3.4, "CLIENT", F, 6.2, GREY)
    cy = yt - h / 2 - 1.5
    client_mark(c, X0 + 14, cy)
    text(c, X0 + 28, cy + 2.2, d[0], FB, 22, NAVY)
    text(c, X0 + 28, cy - 3.8, d[1], F, 12.5, NAVY)
    text(c, X0 + 28, cy - 9.0, d[2], F, 7.2, GREY, max_w=STRIP_W - 32)
    return yt - h


def block_project(c, D, yt, h):
    d = D["project"]
    box(c, X0, yt, STRIP_W, h, fill=NAVY, stroke=NAVY)
    text(c, X0 + 3, yt - 4.5, "PROJECT", F, 6.5, HexColor("#9FB3C8"))
    text(c, X0 + STRIP_W - 3, yt - 4.5, "PROJECT No  " + D["project_no"], FB, 7.5,
         HexColor("#9FB3C8"), "r")
    text(c, X0 + 3, yt - 23, d[0], FB, 38, white, max_w=STRIP_W - 6)
    text(c, X0 + 3, yt - 38, d[1], FB, 38, white, max_w=STRIP_W - 6)
    # accent bar + stage
    c.setFillColor(ORANGE)
    c.rect(X0 * mm, (yt - 55) * mm, 3 * mm, 11 * mm, fill=1, stroke=0)
    text(c, X0 + 7, yt - 52, d[2], FB, 24, ORANGE)
    text(c, X0 + 3, yt - 69, d[3], F, 14, white, max_w=STRIP_W - 6)
    text(c, X0 + 3, yt - 76, d[4], F, 14, white, max_w=STRIP_W - 6)
    # package band
    band_h = 11
    box(c, X0, yt - h + band_h, STRIP_W, band_h, fill=HexColor("#1D3956"), stroke=HexColor("#1D3956"))
    text(c, X0 + 3, yt - h + 3.9, D["package"], FB, 9.5, white, max_w=STRIP_W - 6)
    return yt - h


def block_company(c, D, yt, h):
    box(c, X0, yt, STRIP_W, h)
    text(c, X0 + 2.2, yt - 3.4, "PREPARED BY", F, 6.2, GREY)
    mid = yt - h / 2 - 1.5
    company_mark(c, X0 + 4, mid - 7.5, 15)
    a, b = D["company"]
    text(c, X0 + 26, mid + 0.5, a, FB, 21, NAVY)
    text(c, X0 + 26, mid - 6.5, b, F, 10.5, ORANGE)
    lines = D["address"]
    for i, s in enumerate(lines):
        text(c, X0 + STRIP_W - 3, mid + 4.5 - i * 4.6, s, F, 7.8, GREY, "r")
    return yt - h


def block_title(c, D, yt, h):
    t = D["title"]
    box(c, X0, yt, STRIP_W, h)
    text(c, X0 + 2.2, yt - 3.4, "DRAWING TITLE", F, 6.2, GREY)
    text(c, X0 + 3, yt - 20, t[0], FB, 30, INK, max_w=STRIP_W - 6)
    text(c, X0 + 3, yt - 34, t[1], F, 17, INK, max_w=STRIP_W - 6)
    hline(c, X0 + 3, X0 + STRIP_W - 3, yt - 41, 0.18)
    text(c, X0 + 3, yt - 52, t[2], FB, 14, NAVY)
    return yt - h


def block_drawing_no(c, D, yt):
    # row 1: drawing number
    h1, h2, h3 = 24, 28, 22
    box(c, X0, yt, STRIP_W, h1, fill=PALE)
    text(c, X0 + 2.2, yt - 3.4, "DRAWING No.", F, 6.2, GREY)
    text(c, X0 + 3, yt - h1 + 6.5, D["drg_no"], FB, 22, INK, max_w=STRIP_W - 6)
    y = yt - h1
    # row 2: rev | status | issue date
    box(c, X0, y, 36, h2)
    text(c, X0 + 2.2, y - 3.4, "REV", F, 6.2, GREY)
    text(c, X0 + 18, y - h2 + 6.5, D["rev"], FB, 38, NAVY, "c")
    box(c, X0 + 36, y, 88, h2)
    text(c, X0 + 38.2, y - 3.4, "STATUS / SUITABILITY", F, 6.2, GREY)
    chip_h = 11
    chip_y = y - 6.8
    box(c, X0 + 39, chip_y, 82, chip_h, fill=ORANGE, stroke=ORANGE)
    text(c, X0 + 80, chip_y - chip_h + 3.5, D["status"], FB, 11, white, "c", max_w=78)
    text(c, X0 + 39, y - h2 + 2.8, "Not for construction", F, 7.2, GREY)
    cell(c, X0 + 124, y, 46, h2, "ISSUE DATE", D["issue_date"], 17)
    y -= h2
    # row 3
    cell(c, X0, y, 74, h3, "EDMS No", D["edms"], 13)
    cell(c, X0 + 74, y, 36, h3, "SHEET SIZE", D["size"], 13)
    cell(c, X0 + 110, y, 60, h3, "SCALE @ A1", D["scale"], 13)
    return y - h3


def table_header(c, yt, h, cols, titles):
    x = X0
    for w, t in zip(cols, titles):
        box(c, x, yt, w, h, fill=NAVY, stroke=NAVY)
        text(c, x + w / 2, yt - h + 2.1, t, FB, 6.6, white, "c")
        x += w


def block_revisions(c, D, yt):
    cols = [12, 84, 14, 14, 14, 32]
    hh, rh, n = 7, 9, 6
    table_header(c, yt, hh, cols, ["REV", "DESCRIPTION", "BY", "CHK", "APP", "DATE"])
    y = yt - hh
    revs = D["revisions"]
    for i in range(n):
        row = revs[i] if i < len(revs) else ("", "", "", "", "", "")
        x = X0
        for j, (w, v) in enumerate(zip(cols, row)):
            box(c, x, y, w, rh)
            if v:
                text(c, x + (2.2 if j == 1 else w / 2), y - rh + 3.2, v,
                     FB if j == 0 else F, 8.5, INK, "l" if j == 1 else "c", max_w=w - 3)
            x += w
        y -= rh
    return y


def block_signoff(c, D, yt):
    cols = [40, 68, 26, 36]
    hh, rh = 7, 9
    table_header(c, yt, hh, cols, ["ROLE", "NAME", "INITIALS", "DATE"])
    y = yt - hh
    for role, name, ini, date in D["signoff"]:
        x = X0
        for j, (w, v) in enumerate(zip(cols, (role, name, ini, date))):
            box(c, x, y, w, rh, fill=PALE if j == 0 else None)
            text(c, x + (2.2 if j < 2 else w / 2), y - rh + 3.2, v,
                 FB if j == 0 else F, 8.2 if j == 0 else 9, GREY if j == 0 else INK,
                 "l" if j < 2 else "c", max_w=w - 3)
            x += w
        y -= rh
    return y


def block_meta(c, D, yt, rh=18):
    y = yt
    for l1, v1, l2, v2 in D["meta"]:
        cell(c, X0, y, 85, rh, l1, v1, 10.5, FB)
        cell(c, X0 + 85, y, 85, rh, l2, v2, 10.5, FB)
        y -= rh
    return y


def block_notes(c, D, yt, yb):
    h = yt - yb
    box(c, X0, yt, STRIP_W, h)
    # QR
    size = min(34, h - 8)
    w = qr.QrCodeWidget(D["drg_no"], barLevel="M", barBorder=0)
    bx = w.getBounds()
    bw, bh = bx[2] - bx[0], bx[3] - bx[1]
    d = Drawing(size * mm, size * mm,
                transform=[size * mm / bw, 0, 0, size * mm / bh, 0, 0])
    d.add(w)
    qx, qy = X0 + 4, yt - 4 - size
    renderPDF.draw(d, c, qx * mm, qy * mm)
    text(c, qx + size / 2, qy - 3.2, "SCAN FOR LATEST REV", F, 5.6, GREY, "c")
    # disclaimer
    tx = X0 + size + 10
    tw = STRIP_W - size - 14
    text(c, tx, yt - 5.2, "COPYRIGHT AND DISCLAIMER", FB, 6.4, NAVY)
    lines = simpleSplit(D["disclaimer"], F, 6.1, tw * mm)
    ty = yt - 9.6
    for ln in lines:
        text(c, tx, ty, ln, F, 6.1, GREY)
        ty -= 2.7
    # colour-coded warning
    wy = yb + 3
    box(c, tx, wy + 7.5, tw, 7.5, stroke=RED, lw=0.3)
    text(c, tx + tw / 2, wy + 7.5 - 5.2, "DRAWING COLOUR CODED - PRINT ALL COPIES IN COLOUR", FB, 7.2,
         RED, "c", max_w=tw - 4)
    return yb


def block_file(c, D, yt, h):
    box(c, X0, yt, 108, h, fill=PALE)
    box(c, X0 + 108, yt, 62, h, fill=PALE)
    text(c, X0 + 2.2, yt - 3.2, "FILE NAME", F, 5.8, GREY)
    text(c, X0 + 2.2, yt - 9.4, D["file"], F, 8.5, INK, max_w=104)
    text(c, X0 + 110.2, yt - 3.2, "PLOT DATE & TIME", F, 5.8, GREY)
    text(c, X0 + 110.2, yt - 9.4, D["plot"], F, 8.5, INK, max_w=58)


# ---------------------------------------------------------------- sheet
def border(c):
    # inner drawing frame (drawing area + strip)
    line_w(c, 0.5)
    c.setStrokeColor(INK)
    c.rect(MARGIN * mm, MARGIN * mm, (SHEET_W - 2 * MARGIN) * mm, (SHEET_H - 2 * MARGIN) * mm)
    # strip outline, heavier than the cell lines
    c.rect(X0 * mm, MARGIN * mm, STRIP_W * mm, (SHEET_H - 2 * MARGIN) * mm)
    # centring marks on the trim edge
    line_w(c, 0.35)
    for x in (SHEET_W / 2,):
        c.line(x * mm, 0, x * mm, 5 * mm)
        c.line(x * mm, (SHEET_H - 5) * mm, x * mm, SHEET_H * mm)
    c.line(0, (SHEET_H / 2) * mm, 5 * mm, (SHEET_H / 2) * mm)
    c.line((SHEET_W - 5) * mm, (SHEET_H / 2) * mm, SHEET_W * mm, (SHEET_H / 2) * mm)


def draw_titleblock(c, D):
    """Draw the full-height title block strip and sheet frame for one page."""
    y = TOP
    y = block_client(c, D, y, 44)
    y = block_project(c, D, y, 92)
    y = block_company(c, D, y, 44)
    y = block_title(c, D, y, 62)
    y = block_drawing_no(c, D, y)
    y = block_revisions(c, D, y)
    y = block_signoff(c, D, y)
    y = block_meta(c, D, y)
    file_h, bottom = 13, MARGIN
    notes_bottom = bottom + file_h
    block_notes(c, D, y, notes_bottom)
    block_file(c, D, notes_bottom, file_h)
    border(c)


def build(path, D=None):
    D = D or SAMPLE
    c = canvas.Canvas(path, pagesize=(SHEET_W * mm, SHEET_H * mm))
    c.setTitle("Title block sample - " + D["drg_no"])
    c.setAuthor("Meridian Civil Consulting (fictional)")
    c.setSubject("A1 title block template with example data")
    draw_titleblock(c, D)
    c.showPage()
    c.save()
