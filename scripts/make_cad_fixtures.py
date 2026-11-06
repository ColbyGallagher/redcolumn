"""Build the CAD fixtures for DWG/DXF import (issue #230).

    python scripts/make_cad_fixtures.py [--out DIR] [--dwg] [--ref DIR] [--check]

Writes DXF drawings with known sheet sizes, viewport scales and dimension values to
apps/web/test/fixtures/cad/ (default), with manifest.json listing what each one should convert
to. Every project and drawing is fictional; the plan drawing reuses the Kestrel Road model.

  --dwg    also write DWG twins of each fixture (R2000-R2018) with ODA File Converter, which
           must be installed (free from opendesign.com; dev-only, never shipped).
  --ref    render each layout with ezdxf's drawing add-on to PDF in DIR, as a second opinion
           for visual comparison (not committed).
  --check  read every DXF back and check it against the manifest.

Needs ezdxf (MIT): pip install --user ezdxf==1.4.5
"""
import argparse
import collections
import json
import math
import os
import subprocess
import sys

# ezdxf orders some objects by set iteration, which follows the string hash seed: fix it so
# reruns write the same bytes.
if os.environ.get("PYTHONHASHSEED") != "0" and __name__ == "__main__":
    sys.exit(subprocess.call([sys.executable, *sys.argv], env={**os.environ, "PYTHONHASHSEED": "0"}))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ezdxf  # noqa: E402
from ezdxf import bbox, units  # noqa: E402
from ezdxf.enums import TextEntityAlignment  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "apps", "web", "test", "fixtures", "cad")
DWG_VERSIONS = ["R2000", "R2004", "R2007", "R2010", "R2013", "R2018"]
PT_PER_MM = 72 / 25.4
PT_PER_IN = 72.0

# Fixed GUIDs and times so reruns write the same bytes.
ezdxf.options.write_fixed_meta_data_for_testing = True


def new_doc(unit):
    doc = ezdxf.new("R2018", setup=True, units=unit)
    doc.header["$MEASUREMENT"] = 0 if unit == units.IN else 1
    return doc


def layer(doc, name, color=7, linetype="CONTINUOUS", lineweight=-3, plot=True):
    lay = doc.layers.add(name, color=color, linetype=linetype, lineweight=lineweight)
    lay.dxf.plot = 1 if plot else 0
    return lay


def replace_default_layouts(doc, names):
    """Paper-space layouts in order, with ezdxf's default Layout1 removed."""
    # ezdxf puts each layout's own viewport on VIEWPORTS without declaring the layer; declare it
    # (not plotted) so the DWG twins carry the same layer table.
    if "VIEWPORTS" not in doc.layers:
        layer(doc, "VIEWPORTS", color=7, plot=False)
    made = [doc.layouts.new(n) for n in names]
    if "Layout1" in doc.layouts.names():
        doc.layouts.delete("Layout1")
    return made


def page(name, width, height, unit_pt, viewports=(), **extra):
    return {
        "name": name,
        "widthPt": round(width * unit_pt, 2),
        "heightPt": round(height * unit_pt, 2),
        "viewports": list(viewports),
        **extra,
    }


def viewport(layout, center, size, view_center, scale, model_per_paper, **dxf):
    """A viewport at a true 1:scale. model_per_paper converts one paper unit to model units at
    1:1 (0.001 for mm paper over a metre model, 1 for same units)."""
    view_height = size[1] * model_per_paper * scale
    vp = layout.add_viewport(center=center, size=size, view_center_point=view_center, view_height=view_height)
    for k, v in dxf.items():
        vp.dxf.set(k, v)
    return vp


# ---------------------------------------------------------------- 1. basic entities
def basic_entities():
    """Model space only, millimetres: one of each common 2D entity, colour, linetype and weight."""
    doc = new_doc(units.MM)
    msp = doc.modelspace()
    layer(doc, "GEOM", color=7)
    layer(doc, "DASHED", color=1, linetype="DASHED")
    layer(doc, "WEIGHTS", color=5)
    layer(doc, "TEXT", color=3)
    layer(doc, "HATCH", color=8)
    layer(doc, "NOPLOT", color=6, plot=False)

    g = {"layer": "GEOM"}
    msp.add_line((0, 0), (100, 0), dxfattribs=g)
    msp.add_lwpolyline([(0, 20, 0), (40, 20, 0.5), (60, 40, 0), (0, 40, 0)], format="xyb", close=True, dxfattribs=g)
    msp.add_polyline2d([(80, 20), (120, 20), (120, 40)], dxfattribs=g)
    msp.add_circle((150, 30), 10, dxfattribs=g)
    msp.add_arc((190, 30), 10, 0, 135, dxfattribs=g)
    msp.add_ellipse((230, 30), major_axis=(15, 0), ratio=0.5, start_param=0, end_param=math.pi * 1.5, dxfattribs=g)
    msp.add_spline([(260, 20), (270, 40), (285, 25), (300, 40)], dxfattribs=g)
    msp.add_point((320, 30), dxfattribs=g)
    msp.add_solid([(340, 20), (360, 20), (340, 40), (360, 40)], dxfattribs=g)

    msp.add_line((0, 60), (100, 60), dxfattribs={"layer": "DASHED"})
    msp.add_line((0, 65), (100, 65), dxfattribs={"layer": "DASHED", "linetype": "CENTER", "ltscale": 0.5})
    for i, lw in enumerate([13, 25, 50, 100, 200]):
        msp.add_line((0, 75 + 5 * i), (100, 75 + 5 * i), dxfattribs={"layer": "WEIGHTS", "lineweight": lw})
    msp.add_line((120, 60), (220, 60), dxfattribs={"layer": "GEOM", "color": 1})
    msp.add_line((120, 65), (220, 65), dxfattribs={"layer": "GEOM", "true_color": ezdxf.rgb2int((255, 128, 0))})
    msp.add_line((120, 70), (220, 70), dxfattribs={"layer": "NOPLOT"})

    t = {"layer": "TEXT", "height": 5, "style": "OpenSans"}
    msp.add_text("LEFT", dxfattribs=t).set_placement((0, 120))
    msp.add_text("CENTRE", dxfattribs=t).set_placement((100, 120), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_text("ROTATED 30", dxfattribs={**t, "rotation": 30}).set_placement((160, 110))
    msp.add_text("Ø25 ±0.5 50°", dxfattribs=t).set_placement((0, 135))
    mt = msp.add_mtext("MTEXT line one\\Pline two {\\fArial|b1;bold}", dxfattribs={"layer": "TEXT", "char_height": 4, "width": 80})
    mt.set_location((120, 145))

    h = msp.add_hatch(color=8, dxfattribs={"layer": "HATCH"})
    h.paths.add_polyline_path([(0, 160), (40, 160), (40, 190), (0, 190)], is_closed=True)
    h = msp.add_hatch(dxfattribs={"layer": "HATCH"})
    h.set_pattern_fill("ANSI31", scale=2)
    h.paths.add_polyline_path([(60, 160), (100, 160), (100, 190), (60, 190)], is_closed=True)
    h.paths.add_polyline_path([(70, 170), (90, 170), (90, 180), (70, 180)], is_closed=True)

    expected = {
        "units": "mm",
        "pages": [page("Model", 0, 0, PT_PER_MM, note="no layouts: one page around the model extents, 1:1; size filled in by main()")],
        "layers": ["0", "GEOM", "DASHED", "WEIGHTS", "TEXT", "HATCH", "NOPLOT"],
        "nonPlotLayers": ["NOPLOT"],
        "entityTypes": ["LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "ELLIPSE", "SPLINE", "POINT", "SOLID", "TEXT", "MTEXT", "HATCH"],
        "text": ["LEFT", "CENTRE", "ROTATED 30", "Ø25 ±0.5 50°", "MTEXT line one", "line two", "bold"],
    }
    # A drawing with no paper-space layouts: drop the default layout's page setup, leaving only Model.
    return doc, expected


# ---------------------------------------------------------------- 2. blocks
def blocks():
    """Nested, scaled, rotated and mirrored INSERTs, MINSERT, attributes and BYBLOCK colour."""
    doc = new_doc(units.MM)
    msp = doc.modelspace()
    layer(doc, "BLOCKS", color=7)

    bolt = doc.blocks.new("BOLT")
    bolt.add_circle((0, 0), 2, dxfattribs={"color": 0})  # BYBLOCK
    bolt.add_line((-3, 0), (3, 0))
    plate = doc.blocks.new("PLATE")
    plate.add_lwpolyline([(0, 0), (40, 0), (40, 20), (0, 20)], close=True)
    for x, y in [(5, 5), (35, 5), (5, 15), (35, 15)]:
        plate.add_blockref("BOLT", (x, y))
    plate.add_attdef("MARK", (2, 22), dxfattribs={"height": 3})

    b = {"layer": "BLOCKS"}
    msp.add_blockref("PLATE", (0, 0), dxfattribs=b).add_auto_attribs({"MARK": "P1"})
    msp.add_blockref("PLATE", (60, 0), dxfattribs={**b, "xscale": 2, "yscale": 2, "color": 1}).add_auto_attribs({"MARK": "P2"})
    msp.add_blockref("PLATE", (180, 0), dxfattribs={**b, "rotation": 45}).add_auto_attribs({"MARK": "P3"})
    msp.add_blockref("PLATE", (260, 0), dxfattribs={**b, "xscale": -1}).add_auto_attribs({"MARK": "P4"})
    grid = msp.add_blockref("BOLT", (0, 80), dxfattribs={**b, "color": 5})
    grid.grid(size=(3, 4), spacing=(10, 15))

    expected = {
        "units": "mm",
        "pages": [page("Model", 0, 0, PT_PER_MM, note="no layouts: one page around the model extents, 1:1; size filled in by main()")],
        "blocks": {"PLATE": 4, "BOLT": 4 * 4 + 12},
        "text": ["P1", "P2", "P3", "P4"],
    }
    return doc, expected


# ---------------------------------------------------------------- 3. layouts and scales
def kestrel_plan():
    """Kestrel Road plan model in metres, two A1/A3 layouts with known viewport scales."""
    from roadset import geom
    from roadset.site import site

    S = site()
    doc = new_doc(units.M)
    msp = doc.modelspace()
    for name, color, lt in [
        ("C-ROAD-CL", 1, "CENTER"), ("C-ROAD-KERB", 7, "CONTINUOUS"), ("C-ROAD-PAVE", 8, "CONTINUOUS"),
        ("C-PROP-CADASTRE", 4, "CONTINUOUS"), ("C-BLDG", 9, "CONTINUOUS"), ("C-VEG-TREE", 3, "CONTINUOUS"),
        ("C-DRAIN", 5, "CONTINUOUS"), ("C-WATR", 140, "DASHED"), ("C-CREEK", 150, "CONTINUOUS"),
        ("C-DIMS", 2, "CONTINUOUS"), ("C-ANNO", 7, "CONTINUOUS"), ("G-TBLK", 7, "CONTINUOUS"), ("G-VPORT", 6, "CONTINUOUS"),
    ]:
        layer(doc, name, color=color, linetype=lt, plot=name != "G-VPORT")

    def poly(pts, lay, close=False):
        if len(pts) > 1:
            msp.add_lwpolyline([(x, y) for x, y in pts], close=close, dxfattribs={"layer": lay})

    poly(geom.MC00.poly(0.0), "C-ROAD-CL")
    poly(geom.MC01.poly(0.0), "C-ROAD-CL")
    for pl_ in S.kerbs + S.kerbs_back:
        poly(pl_, "C-ROAD-KERB")
    for pl_ in S.pave:
        poly(pl_, "C-ROAD-PAVE", close=True)
    for pl_ in S.cadastral:
        poly(pl_, "C-PROP-CADASTRE")
    for pl_ in S.buildings:
        poly(pl_, "C-BLDG", close=True)
    tree = doc.blocks.new("TREE")
    tree.add_circle((0, 0), 1.0)
    tree.add_line((-0.7, -0.7), (0.7, 0.7))
    tree.add_line((-0.7, 0.7), (0.7, -0.7))
    for x, y, r in S.trees:
        msp.add_blockref("TREE", (x, y), dxfattribs={"layer": "C-VEG-TREE", "xscale": r, "yscale": r})
    for pl_ in S.pipes:
        poly(pl_, "C-DRAIN")
    for pl_ in S.water:
        poly(pl_, "C-WATR")
    poly(S.creek, "C-CREEK")
    for i, (x, y) in enumerate(S.pits):
        msp.add_circle((x, y), 0.6, dxfattribs={"layer": "C-DRAIN"})

    # Chainage labels along MC00 and two dimensions with known lengths for the scale self-check.
    for ch in range(0, 1041, 100):
        x, y, _ = geom.MC00.at(float(ch))
        msp.add_text("CH %d" % ch, dxfattribs={"layer": "C-ANNO", "height": 2.5, "style": "OpenSans"}).set_placement((x, y + 4))
    dims = []
    for (a, b, off) in [((60.0, 445.0), (160.0, 445.0), 20.0), ((60.0, 445.0), (60.0, 395.0), -15.0)]:
        d = msp.add_aligned_dim(p1=a, p2=b, distance=off, dimstyle="EZ_M_100_H25_CM", dxfattribs={"layer": "C-DIMS"})
        d.render()
        dims.append({"p1": a, "p2": b, "measurement": round(math.dist(a, b), 4), "unit": "m"})

    # ---- layouts
    a1, a3 = replace_default_layouts(doc, ["C-101 PLAN", "C-501 DETAIL"])
    a1.page_setup(size=(841, 594), margins=(0, 0, 0, 0), units="mm")
    a3.page_setup(size=(420, 297), margins=(0, 0, 0, 0), units="mm")

    def titleblock(lay, w, h, number):
        lay.add_lwpolyline([(10, 10), (w - 10, 10), (w - 10, h - 10), (10, h - 10)], close=True, dxfattribs={"layer": "G-TBLK", "lineweight": 50})
        lay.add_lwpolyline([(w - 190, 10), (w - 10, 10), (w - 10, 50), (w - 190, 50)], close=True, dxfattribs={"layer": "G-TBLK"})
        lay.add_text("KESTREL ROAD UPGRADE", dxfattribs={"layer": "G-TBLK", "height": 5, "style": "OpenSans"}).set_placement((w - 185, 38))
        lay.add_text(number, dxfattribs={"layer": "G-TBLK", "height": 8, "style": "OpenSans"}).set_placement((w - 185, 18))

    titleblock(a1, 841, 594, "C-101")
    titleblock(a3, 420, 297, "C-501")
    vp_attrs = {"layer": "G-VPORT"}

    win = geom.WINDOWS[1]
    main = viewport(a1, (330, 312), (620, 564), (win[0] + 155, win[1] + 141), 500, 0.001, **vp_attrs)
    inset = viewport(a1, (740, 400), (160, 120), (505, 287), 2000, 0.001, view_twist_angle=30, **vp_attrs)
    inset.frozen_layers = ["C-VEG-TREE", "C-ANNO"]
    detail = viewport(a3, (180, 160), (320, 260), (110, 440), 100, 0.001, **vp_attrs)
    _ = (main, detail)

    expected = {
        "units": "m",
        "pages": [
            page("C-101 PLAN", 841, 594, PT_PER_MM, viewports=[
                {"ratio": "1:500", "centerMm": [330, 312], "sizeMm": [620, 564]},
                {"ratio": "1:2000", "centerMm": [740, 400], "sizeMm": [160, 120], "twistDeg": 30, "frozen": ["C-VEG-TREE", "C-ANNO"]},
            ]),
            page("C-501 DETAIL", 420, 297, PT_PER_MM, viewports=[
                {"ratio": "1:100", "centerMm": [180, 160], "sizeMm": [320, 260]},
            ]),
        ],
        "modelSpacePage": "opt-in only (layouts exist)",
        "nonPlotLayers": ["G-VPORT"],
        "dimensions": dims,
        "text": ["KESTREL ROAD UPGRADE", "C-101", "C-501", "CH 100"],
    }
    return doc, expected


# ---------------------------------------------------------------- 4. missing references
def missing_refs():
    """An xref, a raster image and an SHX text style that will not be found: three warnings."""
    doc = new_doc(units.MM)
    msp = doc.modelspace()
    doc.styles.new("ROMANS", dxfattribs={"font": "romans.shx"})
    doc.add_xref_def("survey-base.dwg", "SURVEY-BASE")
    msp.add_blockref("SURVEY-BASE", (0, 0))
    img = doc.add_image_def(filename="aerial-2026.png", size_in_pixel=(1000, 800))
    msp.add_image(img, insert=(0, 0), size_in_units=(100, 80))
    msp.add_text("SHX TEXT", dxfattribs={"style": "ROMANS", "height": 5}).set_placement((0, 90))
    msp.add_lwpolyline([(0, 0), (100, 0), (100, 100), (0, 100)], close=True)
    expected = {
        "units": "mm",
        "pages": [page("Model", 0, 0, PT_PER_MM, note="no layouts: one page around the model extents, 1:1; size filled in by main()")],
        "warnings": [
            {"kind": "missing-xref", "name": "SURVEY-BASE", "path": "survey-base.dwg"},
            {"kind": "missing-image", "path": "aerial-2026.png"},
            {"kind": "font-substituted", "font": "romans.shx"},
        ],
        "text": ["SHX TEXT"],
    }
    return doc, expected


# ---------------------------------------------------------------- 5. imperial
def imperial():
    """Inches; ANSI D (34 x 22 in) layout with a 1/8" = 1'-0" (1:96) viewport."""
    doc = new_doc(units.IN)
    msp = doc.modelspace()
    layer(doc, "A-WALL", color=7, lineweight=50)
    layer(doc, "A-DIMS", color=2)
    w, d = 200 * 12, 120 * 12  # a 200 ft x 120 ft building, inches
    msp.add_lwpolyline([(0, 0), (w, 0), (w, d), (0, d)], close=True, dxfattribs={"layer": "A-WALL"})
    msp.add_lwpolyline([(6, 6), (w - 6, 6), (w - 6, d - 6), (6, d - 6)], close=True, dxfattribs={"layer": "A-WALL"})
    dim = msp.add_linear_dim(base=(0, -36), p1=(0, 0), p2=(w, 0), dimstyle="EZ_INCH_2_H25", dxfattribs={"layer": "A-DIMS"})
    dim.render()
    (sheet,) = replace_default_layouts(doc, ["A-101"])
    sheet.page_setup(size=(34, 22), margins=(0, 0, 0, 0), units="inch")
    sheet.add_lwpolyline([(0.5, 0.5), (33.5, 0.5), (33.5, 21.5), (0.5, 21.5)], close=True)
    viewport(sheet, (15, 11), (28, 20), (w / 2, d / 2), 96, 1.0)
    expected = {
        "units": "in",
        "pages": [page("A-101", 34, 22, PT_PER_IN, viewports=[{"ratio": "1:96", "label": "1/8\" = 1'-0\"", "centerIn": [15, 11], "sizeIn": [28, 20]}])],
        "dimensions": [{"p1": (0, 0), "p2": (w, 0), "measurement": float(w), "unit": "in"}],
    }
    return doc, expected


# ---------------------------------------------------------------- 6. masks and leaders
def masks():
    """Wipeouts over linework (rectangular and polygonal), mm."""
    doc = new_doc(units.MM)
    msp = doc.modelspace()
    layer(doc, "LINES", color=7)
    layer(doc, "MASKS", color=7)
    for i in range(11):
        msp.add_line((0, i * 10), (100, i * 10), dxfattribs={"layer": "LINES"})
    # Drawn after the lines, so they hide them.
    msp.add_wipeout([(20, 20), (50, 50)], dxfattribs={"layer": "MASKS"})
    msp.add_wipeout([(60, 60), (90, 60), (75, 90)], dxfattribs={"layer": "MASKS"})
    # A polyface mesh of two squares side by side, on its own layer.
    layer(doc, "MESH", color=3)
    mesh = msp.add_polyface(dxfattribs={"layer": "MESH"})
    mesh.append_faces([[(120, 0, 0), (140, 0, 0), (140, 20, 0), (120, 20, 0)], [(140, 0, 0), (160, 0, 0), (160, 20, 0), (140, 20, 0)]])
    mesh.optimize()
    expected = {
        "units": "mm",
        "pages": [page("Model", 0, 0, PT_PER_MM, note="no layouts: one page around the model extents, 1:1; size filled in by main()")],
        "wipeouts": [
            {"box": [20, 20, 50, 50]},
            {"box": [60, 60, 90, 90]},
        ],
        # Each square's four edges, the shared one drawn by both.
        "meshEdges": {"layer": "MESH", "count": 8, "box": [120, 0, 160, 20]},
    }
    return doc, expected


def leaders():
    """Multileaders, mm: one with text, one with a block (a tag circle)."""
    from ezdxf.math import Vec2
    from ezdxf.render.mleader import ConnectionSide

    doc = new_doc(units.MM)
    msp = doc.modelspace()
    layer(doc, "NOTES", color=7)
    tag = doc.blocks.new("TAG")
    tag.add_circle((0, 0), 3)
    ml = msp.add_multileader_mtext("Standard", dxfattribs={"layer": "NOTES"})
    ml.set_content("NOTE ONE", char_height=2.5)
    ml.add_leader_line(ConnectionSide.left, [Vec2(0, 0), Vec2(10, 10)])
    ml.build(insert=Vec2(30, 20))
    mb = msp.add_multileader_block("Standard", dxfattribs={"layer": "NOTES"})
    mb.set_content(name="TAG", scale=1)
    mb.add_leader_line(ConnectionSide.left, [Vec2(0, 40)])
    mb.build(insert=Vec2(30, 50))
    expected = {
        "units": "mm",
        "pages": [page("Model", 0, 0, PT_PER_MM, note="no layouts: one page around the model extents, 1:1; size filled in by main()")],
        "text": ["NOTE ONE"],
        "leaders": 2,
        # ezdxf measures text with its own fonts: the page can differ by a few millimetres.
        "sizeTolerancePt": 20,
    }
    return doc, expected


FIXTURES = {
    "basic-entities": basic_entities,
    "blocks": blocks,
    "kestrel-plan": kestrel_plan,
    "missing-refs": missing_refs,
    "imperial": imperial,
    "masks": masks,
    "leaders": leaders,
}


# ---------------------------------------------------------------- checks
def paper_layouts(doc):
    """Paper-space layouts that hold something besides their own overall viewport. An empty
    default layout is not a sheet; a drawing with none converts its model space instead."""
    return [lay for lay in doc.layouts if not lay.is_modelspace and any(not (e.dxftype() == "VIEWPORT" and e.dxf.id == 1) for e in lay)]


def check(out, manifest):
    """Read each DXF back: layouts, page sizes and viewport scales must match the manifest."""
    problems = []
    for name, exp in manifest["fixtures"].items():
        doc = ezdxf.readfile(os.path.join(out, name + ".dxf"))
        auditor = doc.audit()
        if auditor.has_errors:
            problems.append("%s: audit errors %s" % (name, [str(e.message) for e in auditor.errors]))
        paper = paper_layouts(doc)
        pages = [p for p in exp["pages"] if p["name"] != "Model"]
        if [lay.name for lay in paper] != [p["name"] for p in pages]:
            problems.append("%s: layouts %s" % (name, [lay.name for lay in paper]))
        for lay, p in zip(paper, pages):
            vps = [v for v in lay.viewports() if v.dxf.id > 1]
            model_per_paper = {"m": 0.001, "mm": 1.0, "in": 1.0}[exp["units"]]
            if len(vps) != len(p["viewports"]):
                problems.append("%s/%s: %d viewports" % (name, lay.name, len(vps)))
            for v, ev in zip(vps, p["viewports"]):
                ratio = v.dxf.view_height / (v.dxf.height * model_per_paper)
                if abs(ratio - int(ev["ratio"].split(":")[1])) > 1e-6:
                    problems.append("%s/%s: viewport ratio 1:%g" % (name, lay.name, ratio))
            size = lay.dxf.paper_width, lay.dxf.paper_height
            # paper_width/height are stored in mm whatever the plot units.
            got = [round(s * PT_PER_MM, 2) for s in size]
            if abs(got[0] - p["widthPt"]) > 0.5 or abs(got[1] - p["heightPt"]) > 0.5:
                problems.append("%s/%s: paper %s pt, expected %s" % (name, lay.name, got, (p["widthPt"], p["heightPt"])))
    return problems


def render_refs(out, ref_dir):
    from ezdxf.addons.drawing import Frontend, RenderContext, layout as dlayout, pymupdf

    os.makedirs(ref_dir, exist_ok=True)
    for name in FIXTURES:
        doc = ezdxf.readfile(os.path.join(out, name + ".dxf"))
        lays = paper_layouts(doc) or [doc.modelspace()]
        for lay in lays:
            backend = pymupdf.PyMuPdfBackend()
            Frontend(RenderContext(doc), backend).draw_layout(lay)
            pg = dlayout.Page(0, 0, dlayout.Units.mm) if lay.is_modelspace else dlayout.Page(lay.dxf.paper_width, lay.dxf.paper_height, dlayout.Units.mm)
            pdf = backend.get_pdf_bytes(pg)
            safe = lay.name.replace(" ", "_")
            with open(os.path.join(ref_dir, "%s.%s.pdf" % (name, safe)), "wb") as f:
                f.write(pdf)


def find_odafc():
    """ODA File Converter, or None. Recent installers use a versioned folder ezdxf does not search."""
    import glob

    from ezdxf.addons import odafc

    found = sorted(glob.glob(os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "ODA", "ODAFileConverter*", "ODAFileConverter.exe")))
    if found and not odafc.is_installed():
        ezdxf.options.set("odafc-addon", "win_exec_path", found[-1])
    return odafc if odafc.is_installed() else None


def summary(doc):
    """What a DWG twin must agree with its DXF on: entity counts per space, layers, layouts."""
    counts = collections.Counter(e.dxftype() for e in doc.modelspace())
    for lay in doc.layouts:
        if not lay.is_modelspace:
            counts.update("%s:%s" % (lay.name, e.dxftype()) for e in lay)
    return counts, sorted(lay.dxf.name for lay in doc.layers), sorted(lay.name for lay in doc.layouts)


def check_twins(out):
    """Read each DWG twin back through the converter and compare it with its DXF."""
    odafc = find_odafc()
    folder = os.path.join(out, "dwg")
    if not odafc or not os.path.isdir(folder):
        print("skipping DWG twins (no converter or no dwg folder)")
        return []
    problems = []
    for name in FIXTURES:
        ref = summary(ezdxf.readfile(os.path.join(out, name + ".dxf")))
        for ver in DWG_VERSIONS:
            path = os.path.join(folder, "%s.%s.dwg" % (name, ver))
            with open(path, "rb") as f:
                magic = f.read(6).decode("ascii", "replace")
            if magic != ezdxf.const.acad_release_to_dxf_version[ver]:
                problems.append("%s: version %s" % (os.path.basename(path), magic))
            got = summary(odafc.readfile(path))
            if got != ref:
                diff = {k: (ref[0][k], got[0][k]) for k in set(ref[0]) | set(got[0]) if ref[0][k] != got[0][k]}
                problems.append("%s: differs from DXF %s %s %s" % (os.path.basename(path), diff, set(ref[1]) ^ set(got[1]), set(ref[2]) ^ set(got[2])))
    return problems


def write_dwg(out):
    odafc = find_odafc()
    if not odafc:
        sys.exit("ODA File Converter not found. Install it from opendesign.com, then run again with --dwg.")
    for name in FIXTURES:
        src = os.path.join(out, name + ".dxf")
        for ver in DWG_VERSIONS:
            # Twins are written once: ODA's output differs on every run (timestamps).
            if os.path.exists(os.path.join(out, "dwg", "%s.%s.dwg" % (name, ver))) and os.environ.get("CAD_FIXTURES_REWRITE") != "1":
                continue
            odafc.convert(src, os.path.join(out, "dwg", "%s.%s.dwg" % (name, ver)), version=ver, replace=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--dwg", action="store_true")
    ap.add_argument("--ref")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    manifest = {"generator": "scripts/make_cad_fixtures.py", "ezdxf": ezdxf.__version__, "fixtures": {}}
    for name, build in FIXTURES.items():
        doc, expected = build()
        for pg in expected["pages"]:
            if pg["name"] == "Model":
                # Model-only drawings convert to one page around the plotted extents, at 1:1.
                box = bbox.extents(doc.modelspace(), fast=False)
                unit_pt = PT_PER_IN if expected["units"] == "in" else PT_PER_MM
                pg["extents"] = [round(v, 3) for v in (box.extmin.x, box.extmin.y, box.extmax.x, box.extmax.y)]
                pg["widthPt"] = round(box.size.x * unit_pt, 2)
                pg["heightPt"] = round(box.size.y * unit_pt, 2)
        doc.saveas(os.path.join(args.out, name + ".dxf"))
        manifest["fixtures"][name] = expected
        print("wrote %s.dxf" % name)
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    if args.dwg:
        os.makedirs(os.path.join(args.out, "dwg"), exist_ok=True)
        write_dwg(args.out)
    if args.ref:
        render_refs(args.out, args.ref)
    if args.check:
        problems = check(args.out, manifest) + check_twins(args.out)
        for p in problems:
            print("FAIL", p)
        if problems:
            sys.exit(1)
        print("check ok")


if __name__ == "__main__":
    main()
