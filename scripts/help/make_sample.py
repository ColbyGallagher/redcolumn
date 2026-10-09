"""Make the sample drawings the help screenshots use.

Usage: python scripts/help/make_sample.py [out_dir]
Writes sample-plans.pdf (three sheets), sample-plans-rev1.pdf (the same set with changes, for
Compare and Overlay), sample-form.pdf (a blank inspection form, for the form tools),
sample-stitch.pdf (sheets joined at match lines), site-photo.png and specification.txt to out_dir
(default scripts/help/samples). Needs reportlab and Pillow.
"""
import os
import subprocess
import sys

from reportlab.lib.colors import Color, black
from reportlab.pdfgen.canvas import Canvas

# 24 x 18 in (ARCH C): big enough to look like a drawing, small enough to read in a screenshot.
W, H = 24 * 72, 18 * 72
FT = 72 / 4  # 1/4" = 1'-0": one foot is 18 pt.
GREY = Color(0.45, 0.45, 0.45)
WALL = 0.5 * FT  # 6" walls


def ft(x):
    return x * FT


def title_block(c, number, title, rev):
    x0 = W - 4.2 * 72
    c.setLineWidth(1.5)
    c.rect(36, 36, W - 72, H - 72)
    c.setLineWidth(1)
    c.line(x0, 36, x0, H - 36)
    c.setFont('Helvetica-Bold', 22)
    c.drawString(x0 + 18, H - 90, 'REDCOLUMN')
    c.setFont('Helvetica', 11)
    c.drawString(x0 + 18, H - 110, 'Sample Project')
    c.drawString(x0 + 18, H - 126, '12 Example Street')
    rows = [('PROJECT No.', '2026-014'), ('DRAWN', 'RC'), ('CHECKED', 'JS'), ('DATE', '09 OCT 2026'), ('REVISION', rev)]
    y = 380
    for label, value in rows:
        c.line(x0, y + 26, W - 36, y + 26)
        c.setFont('Helvetica', 8)
        c.drawString(x0 + 10, y + 14, label)
        c.setFont('Helvetica-Bold', 11)
        c.drawString(x0 + 110, y + 12, value)
        y -= 26
    c.line(x0, 200, W - 36, 200)
    c.setFont('Helvetica', 8)
    c.drawString(x0 + 10, 186, 'SHEET TITLE')
    c.setFont('Helvetica-Bold', 16)
    c.drawString(x0 + 10, 164, title)
    c.line(x0, 140, W - 36, 140)
    c.setFont('Helvetica', 8)
    c.drawString(x0 + 10, 126, 'SHEET No.')
    c.setFont('Helvetica-Bold', 40)
    c.drawString(x0 + 10, 66, number)
    c.setFont('Helvetica', 9)
    c.drawString(x0 + 160, 66, 'SCALE 1/4" = 1\'-0"')


def wall_rect(c, x, y, w, h):
    """A rectangle of walls with outside corner (x, y), in feet."""
    c.setLineWidth(1.2)
    c.rect(ft(x), ft(y), ft(w), ft(h))
    c.rect(ft(x) + WALL, ft(y) + WALL, ft(w) - 2 * WALL, ft(h) - 2 * WALL)


def wall_v(c, x, y0, y1):
    c.setLineWidth(1.2)
    c.line(ft(x), ft(y0), ft(x), ft(y1))
    c.line(ft(x) + WALL, ft(y0), ft(x) + WALL, ft(y1))


def wall_h(c, y, x0, x1):
    c.setLineWidth(1.2)
    c.line(ft(x0), ft(y), ft(x1), ft(y))
    c.line(ft(x0), ft(y) + WALL, ft(x1), ft(y) + WALL)


def door(c, x, y, size=3, flip=False):
    """A door swing: leaf and quarter arc, hinge at (x, y) in feet."""
    c.setLineWidth(0.6)
    s = ft(size)
    if flip:
        c.line(ft(x), ft(y), ft(x), ft(y) - s)
        c.arc(ft(x) - s, ft(y) - s, ft(x) + s, ft(y) + s, 270, 90)
    else:
        c.line(ft(x), ft(y), ft(x), ft(y) + s)
        c.arc(ft(x) - s, ft(y) - s, ft(x) + s, ft(y) + s, 0, 90)


def window(c, x, y, length):
    c.setLineWidth(0.5)
    for d in (0.15, 0.35):
        c.line(ft(x), ft(y + d), ft(x + length), ft(y + d))


def room(c, x, y, name, number, area):
    c.setFont('Helvetica-Bold', 10)
    c.drawCentredString(ft(x), ft(y) + 6, name)
    c.setFont('Helvetica', 8)
    c.drawCentredString(ft(x), ft(y) - 6, number)
    c.drawCentredString(ft(x), ft(y) - 16, area)


def light(c, x, y):
    """The repeated light fixture symbol (for Count and Symbol Search)."""
    c.setLineWidth(0.6)
    r = 6
    c.circle(ft(x), ft(y), r)
    c.line(ft(x) - r, ft(y) - r, ft(x) + r, ft(y) + r)
    c.line(ft(x) - r, ft(y) + r, ft(x) + r, ft(y) - r)


def grid_bubble(c, x, y, label):
    c.setLineWidth(0.6)
    c.circle(x, y, 12)
    c.setFont('Helvetica-Bold', 11)
    c.drawCentredString(x, y - 4, label)


def dim_string(c, y, xs):
    """Dimension string along y (pt) through x positions in feet."""
    c.setLineWidth(0.4)
    c.line(ft(xs[0]), y, ft(xs[-1]), y)
    for x in xs:
        c.line(ft(x) - 4, y - 4, ft(x) + 4, y + 4)
        c.line(ft(x), y - 8, ft(x), y + 8)
    c.setFont('Helvetica', 8)
    for a, b in zip(xs, xs[1:]):
        feet = b - a
        c.drawCentredString(ft((a + b) / 2), y + 4, f"{int(feet)}'-0\"")


def floor_plan(c, rev, upper=False):
    ox, oy = 8, 12  # building origin, feet
    w, h = 56, 36
    wall_rect(c, ox, oy, w, h)
    split = 30 if not rev else 34  # rev 1 moves the corridor wall
    wall_v(c, ox + split, oy, oy + h)
    wall_h(c, oy + 18, ox, ox + split)
    wall_v(c, ox + 14, oy + 18, oy + h)
    if rev:
        wall_h(c, oy + 14, ox + split, ox + w)  # rev 1 adds a store room
    door(c, ox + 6, oy + 18.5)
    door(c, ox + 20, oy + 18.5)
    door(c, ox + split + 0.5, oy + 8, flip=False)
    door(c, ox + 24, oy, 3.5)
    for x in (ox + 4, ox + 18, ox + 38, ox + 46):
        window(c, x, oy + h - 0.5, 6)
    for x in (ox + 8, ox + 40):
        window(c, x, oy, 6)
    names = [('BEDROOM 2', '1.03', ox + 7, oy + 27), ('BEDROOM 1', '1.02', ox + 22, oy + 27), ('LIVING', '1.01', ox + 15, oy + 9)]
    if upper:
        names = [('OFFICE', '2.03', ox + 7, oy + 27), ('STUDY', '2.02', ox + 22, oy + 27), ('LOUNGE', '2.01', ox + 15, oy + 9)]
    for name, num, x, y in names:
        room(c, x, y, name, num, '')
    room(c, ox + split + (w - split) / 2, oy + 25, 'KITCHEN' if not upper else 'MEETING', '1.04' if not upper else '2.04', '')
    if rev:
        room(c, ox + split + (w - split) / 2, oy + 7, 'STORE', '1.05', '')
    for x, y in [(ox + 7, oy + 31), (ox + 22, oy + 31), (ox + 8, oy + 13), (ox + 22, oy + 13), (ox + 40, oy + 30), (ox + 50, oy + 30), (ox + 40, oy + 22), (ox + 50, oy + 22)]:
        light(c, x, y)
    # Grid lines and bubbles.
    c.setStrokeColor(GREY)
    c.setDash([12, 4, 2, 4])
    c.setLineWidth(0.4)
    for i, x in enumerate((ox, ox + split, ox + w)):
        c.line(ft(x), ft(oy - 3), ft(x), ft(oy + h + 3))
    c.setDash()
    c.setStrokeColor(black)
    for i, x in enumerate((ox, ox + split, ox + w)):
        grid_bubble(c, ft(x), ft(oy + h + 3) + 14, str(i + 1))
    dim_string(c, ft(oy - 5), [ox, ox + split, ox + w])
    # Notes and references (for links, search and text markup).
    c.setFont('Helvetica-Bold', 11)
    c.drawString(ft(8), ft(62), 'GENERAL NOTES')
    c.setFont('Helvetica', 9)
    notes = [
        '1. ALL DIMENSIONS ARE TO FACE OF STUD UNLESS NOTED OTHERWISE.',
        '2. CONTRACTOR TO VERIFY ALL DIMENSIONS ON SITE BEFORE STARTING WORK.',
        '3. FOR ELEVATIONS SEE A-201. FOR UPPER FLOOR SEE A-102.',
        '4. SMOKE ALARMS TO BE INTERCONNECTED.',
    ]
    for i, line in enumerate(notes):
        c.drawString(ft(8), ft(62) - 16 - 13 * i, line)
    c.setFont('Helvetica-Bold', 14)
    title = 'FIRST FLOOR PLAN' if upper else 'GROUND FLOOR PLAN'
    c.drawString(ft(8), ft(6), title)
    c.setFont('Helvetica', 9)
    c.drawString(ft(8), ft(6) - 14, 'SCALE 1/4" = 1\'-0"')


def elevations(c):
    c.setLineWidth(1.2)
    base = ft(14)
    c.line(ft(6), base, ft(70), base)
    c.rect(ft(8), base, ft(56), ft(10))
    c.line(ft(8), base + ft(10), ft(36), base + ft(20))
    c.line(ft(36), base + ft(20), ft(64), base + ft(10))
    for x in (12, 26, 44, 54):
        c.rect(ft(x), base + ft(3), ft(6), ft(4))
    c.rect(ft(32), base, ft(3.5), ft(7))
    c.setFont('Helvetica-Bold', 14)
    c.drawString(ft(8), ft(6), 'NORTH ELEVATION')
    c.setFont('Helvetica', 9)
    c.drawString(ft(8), ft(6) - 14, 'SCALE 1/4" = 1\'-0"   SEE A-101 FOR PLAN')
    base2 = ft(44)
    c.line(ft(6), base2, ft(70), base2)
    c.rect(ft(8), base2, ft(36), ft(10))
    c.line(ft(8), base2 + ft(10), ft(26), base2 + ft(18))
    c.line(ft(26), base2 + ft(18), ft(44), base2 + ft(10))
    c.rect(ft(16), base2 + ft(3), ft(8), ft(4))
    c.setFont('Helvetica-Bold', 14)
    c.drawString(ft(8), ft(38), 'EAST ELEVATION')


def plans(path, rev):
    c = Canvas(path, pagesize=(W, H))
    c.setTitle('Sample Project drawings' + (' (Rev 1)' if rev else ''))
    c.setAuthor('redcolumn')
    floor_plan(c, rev)
    title_block(c, 'A-101', 'GROUND FLOOR PLAN', 'B' if rev else 'A')
    c.showPage()
    floor_plan(c, rev, upper=True)
    title_block(c, 'A-102', 'FIRST FLOOR PLAN', 'B' if rev else 'A')
    c.showPage()
    elevations(c)
    title_block(c, 'A-201', 'ELEVATIONS', 'B' if rev else 'A')
    c.showPage()
    c.save()


def form(path):
    c = Canvas(path, pagesize=(612, 792))
    c.setTitle('Site inspection form')
    c.setFont('Helvetica-Bold', 18)
    c.drawString(54, 730, 'SITE INSPECTION FORM')
    c.setFont('Helvetica', 11)
    y = 680
    for label in ('Project:', 'Inspector:', 'Date:', 'Location:'):
        c.drawString(54, y, label)
        c.line(140, y - 2, 540, y - 2)
        y -= 34
    c.setFont('Helvetica-Bold', 12)
    c.drawString(54, y - 6, 'Checklist')
    y -= 34
    c.setFont('Helvetica', 11)
    for item in ('Site access clear', 'Scaffolding tagged', 'Fire extinguishers in place', 'First aid kit stocked'):
        c.rect(54, y - 2, 12, 12)
        c.drawString(76, y, item)
        y -= 26
    c.drawString(54, y - 10, 'Comments:')
    c.rect(54, y - 130, 486, 110)
    c.drawString(54, y - 170, 'Signature:')
    c.line(140, y - 172, 360, y - 172)
    c.save()


def photo(path):
    """A simple picture to place with the Image tool."""
    from PIL import Image, ImageDraw

    im = Image.new('RGB', (480, 320), (235, 242, 250))
    d = ImageDraw.Draw(im)
    blue = (40, 70, 120)
    d.rectangle([10, 10, 470, 310], outline=blue, width=6)
    d.polygon([(60, 260), (240, 90), (420, 260)], outline=blue, width=8)
    d.rectangle([150, 180, 330, 300], outline=blue, width=6)
    d.text((200, 30), 'SITE PHOTO', fill=blue)
    im.save(path)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'samples')
    os.makedirs(out, exist_ok=True)
    plans(os.path.join(out, 'sample-plans.pdf'), rev=False)
    plans(os.path.join(out, 'sample-plans-rev1.pdf'), rev=True)
    form(os.path.join(out, 'sample-form.pdf'))
    stitch = os.path.join(os.path.dirname(__file__), '..', 'make_stitch_test_pdf.py')
    subprocess.run([sys.executable, stitch, os.path.join(out, 'sample-stitch.pdf')], check=True)
    photo(os.path.join(out, 'site-photo.png'))
    with open(os.path.join(out, 'specification.txt'), 'w', encoding='utf8') as f:
        f.write('Door hardware specification' + chr(10) * 2 + 'Lever handles, satin stainless steel.' + chr(10))
    print('wrote', out)
