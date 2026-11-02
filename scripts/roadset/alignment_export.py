"""Georeferenced exports of the Kestrel Road alignments for the Geospatial panel.

LandXML 1.2 (grid coordinates, GDA2020 / MGA zone 56) carries the control lines with their
profiles, the kerb lines, key points and the D01 drainage network. GeoJSON (longitude and
latitude) carries the same linework for GIS tools. Both are built from the model in geom.py, so
they register exactly with the drawing set.
"""
import math
from datetime import date
from xml.sax.saxutils import quoteattr

from .geom import (CULVERT_CH, CULVERT_INV, E0, JUNCTION_CH, MATCHLINES, MC00, MC01, N0, V00, V01, bearing_dms)
from .site import site

EPSG = 7856  # GDA2020 / MGA zone 56
CRS_NAME = "GDA2020 / MGA zone 56"
ZONE_LON0 = 153.0
GRS80_A, GRS80_F = 6378137.0, 1 / 298.257222101


def grid(x, y):
    """World metres to MGA eastings and northings."""
    return E0 + x, N0 + y


def mga_to_lonlat(e, n):
    """Inverse transverse Mercator (Krueger series) for MGA zone 56 on GRS80."""
    f = GRS80_F
    nn = f / (2 - f)
    A = GRS80_A / (1 + nn) * (1 + nn ** 2 / 4 + nn ** 4 / 64)
    beta = [nn / 2 - 2 * nn ** 2 / 3 + 37 * nn ** 3 / 96 - nn ** 4 / 360,
            nn ** 2 / 48 + nn ** 3 / 15 - 437 * nn ** 4 / 1440,
            17 * nn ** 3 / 480 - 37 * nn ** 4 / 840,
            4397 * nn ** 4 / 161280]
    delta = [2 * nn - 2 * nn ** 2 / 3 - 2 * nn ** 3 + 116 * nn ** 4 / 45,
             7 * nn ** 2 / 3 - 8 * nn ** 3 / 5 - 227 * nn ** 4 / 45,
             56 * nn ** 3 / 15 - 136 * nn ** 4 / 35,
             4279 * nn ** 4 / 630]
    k0 = 0.9996
    xi = (n - 10000000.0) / (k0 * A)
    eta = (e - 500000.0) / (k0 * A)
    xi_p = xi - sum(b * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j, b in enumerate(beta))
    eta_p = eta - sum(b * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j, b in enumerate(beta))
    chi = math.asin(math.sin(xi_p) / math.cosh(eta_p))
    phi = chi + sum(d * math.sin(2 * (j + 1) * chi) for j, d in enumerate(delta))
    lam = math.radians(ZONE_LON0) + math.atan2(math.sinh(eta_p), math.cos(xi_p))
    return math.degrees(lam), math.degrees(phi)


def lonlat(x, y):
    return mga_to_lonlat(*grid(x, y))


# ---------------------------------------------------------------- LandXML
def _ne(x, y, z=None):
    e, n = grid(x, y)
    return "%.4f %.4f" % (n, e) + ("" if z is None else " %.4f" % z)  # northing first


def _geom_xml(al, off=0.0, indent="      "):
    """CoordGeom lines and curves for an alignment, or its offset (m, right positive)."""
    out = []
    for e in al.els:
        p0 = al.pt(e["s0"], off)
        p1 = al.pt(e["s1"], off)
        if e["kind"] == "S":
            out.append('%s<Line dir="%.8f" length="%.4f" staStart="%.4f"><Start>%s</Start><End>%s</End></Line>' % (
                indent, math.degrees(e["b0"]) % 360, math.hypot(p1[0] - p0[0], p1[1] - p0[1]), e["s0"],
                _ne(*p0), _ne(*p1)))
            continue
        turn = e["turn"]
        R = e["R"]
        a0 = al.pt(e["s0"])
        nx, ny = math.cos(e["b0"]), -math.sin(e["b0"])
        cx, cy = a0[0] + turn * R * nx, a0[1] + turn * R * ny
        r = R - turn * off
        delta = math.degrees(abs(e["b1"] - e["b0"]))
        tangent = r * math.tan(math.radians(delta) / 2)
        pi = (p0[0] + tangent * math.sin(e["b0"]), p0[1] + tangent * math.cos(e["b0"]))
        out.append(
            '%s<Curve rot="%s" crvType="arc" radius="%.4f" length="%.4f" delta="%.8f" tangent="%.4f" '
            'chord="%.4f" dirStart="%.8f" dirEnd="%.8f" staStart="%.4f">'
            "<Start>%s</Start><Center>%s</Center><End>%s</End><PI>%s</PI></Curve>" % (
                indent, "cw" if turn > 0 else "ccw", r, r * math.radians(delta), delta, tangent,
                math.hypot(p1[0] - p0[0], p1[1] - p0[1]), math.degrees(e["b0"]) % 360,
                math.degrees(e["b1"]) % 360, e["s0"], _ne(*p0), _ne(cx, cy), _ne(*p1), _ne(*pi)))
    return "\n".join(out)


def _profile_xml(vert, name, indent="      "):
    rows = []
    curve_at = {c["s"]: c for c in vert.curves}
    for s, rl, L in vert.pvis:
        if s in curve_at:
            rows.append('%s  <ParaCurve length="%.4f">%.4f %.4f</ParaCurve>' % (indent, curve_at[s]["L"], s, rl))
        else:
            rows.append("%s  <PVI>%.4f %.4f</PVI>" % (indent, s, rl))
    return '%s<Profile name=%s>\n%s<ProfAlign name=%s staStart="0.0000">\n%s\n%s</ProfAlign>\n%s</Profile>' % (
        indent, quoteattr(name), indent, quoteattr(name + " design"), "\n".join(rows), indent, indent)


def landxml():
    S = site()
    pts = []  # (name, x, y, z, desc)
    for al, vert in ((MC00, V00), (MC01, V01)):
        for s, lab in al.key_stations():
            x, y, _ = al.at(s)
            pts.append(("%s-%s-%.3f" % (al.name, lab, s), x, y, vert.level(s),
                        "%s %s" % (al.name, {"START": "start of works", "END": "end of works",
                                             "TC": "tangent to curve", "CT": "curve to tangent"}[lab])))
    for ms, a, b in MATCHLINES:
        x, y, _ = MC00.at(ms)
        pts.append(("MATCHLINE-CH%d" % ms, x, y, V00.level(ms), "Matchline between plan sheets %d and %d" % (a, b)))
    x, y, _ = MC00.at(JUNCTION_CH)
    pts.append(("JUNCTION-MC01", x, y, V00.level(JUNCTION_CH), "Hartley Street junction"))
    x, y, _ = MC00.at(CULVERT_CH)
    pts.append(("CULVERT-CH%.2f" % CULVERT_CH, x, y, CULVERT_INV, "New 3/2400x1200 RCBC, invert level"))
    for s in range(100, int(MC00.length) + 1, 100):
        x, y, _ = MC00.at(s)
        pts.append(("MC00-CH%d" % s, x, y, V00.level(s), "Chainage %d" % s))

    L = []
    w = L.append
    w('<?xml version="1.0" encoding="UTF-8"?>')
    w('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="%s" time="12:00:00" language="English">' % date(2026, 11, 1).isoformat())
    w('  <Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" '
      'pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>')
    w('  <Project name="Kestrel Road Upgrade Stage 2" desc="Fictional sample design for demonstrating georeferencing"/>')
    w('  <Application name="Kestrel sample generator" desc="Fictional data - not for construction" version="1.0"/>')
    w('  <CoordinateSystem name=%s desc="Coordinates are northing then easting, metres" horizontalDatum="GDA2020" '
      'verticalDatum="AHD71" horizontalCoordinateSystemName=%s epsgCode="%d"/>' % (quoteattr(CRS_NAME), quoteattr(CRS_NAME), EPSG))
    w("  <CgPoints>")
    for name, x, y, z, desc in pts:
        w("    <CgPoint name=%s desc=%s>%s</CgPoint>" % (quoteattr(name), quoteattr(desc), _ne(x, y, z)))
    w("  </CgPoints>")

    w('  <Alignments name="Kestrel Road Upgrade control lines">')
    for al, vert, desc in ((MC00, V00, "Kestrel Road control line (crown)"), (MC01, V01, "Hartley Street control line (crown)")):
        w('    <Alignment name=%s desc=%s length="%.4f" staStart="0.0000">' % (quoteattr(al.name), quoteattr(desc), al.length))
        w("      <CoordGeom>")
        w(_geom_xml(al, indent="        "))
        w("      </CoordGeom>")
        w(_profile_xml(vert, al.name))
        w("    </Alignment>")
    w("  </Alignments>")

    w('  <PlanFeatures name="Kestrel Road kerb and reserve lines">')
    for name, al, off, desc in (
            ("MC00 kerb left", MC00, -7.0, "Face of kerb, left of MC00"), ("MC00 kerb right", MC00, 7.0, "Face of kerb, right of MC00"),
            ("MC00 construction boundary left", MC00, -19.0, "Construction boundary"),
            ("MC00 construction boundary right", MC00, 19.0, "Construction boundary"),
            ("MC00 project boundary left", MC00, -22.0, "Project boundary"), ("MC00 project boundary right", MC00, 22.0, "Project boundary"),
            ("MC01 kerb left", MC01, -4.5, "Face of kerb, left of MC01"), ("MC01 kerb right", MC01, 4.5, "Face of kerb, right of MC01")):
        w("    <PlanFeature name=%s desc=%s>" % (quoteattr(name), quoteattr(desc)))
        w("      <CoordGeom>")
        w(_geom_xml(al, off, "        "))
        w("      </CoordGeom>")
        w("    </PlanFeature>")
    w("  </PlanFeatures>")

    # drainage line D01 along the right kerb
    right = []
    for px, py in S.pits:
        s, off, _ = MC00.nearest(px, py)
        if off > 0:
            right.append(s)
    right = sorted(set(round(s, 1) for s in right))
    w('  <PipeNetworks>')
    w('    <PipeNetwork name="D01" desc="Stormwater along the right kerb of MC00" pipeNetType="storm">')
    w("      <Structs>")
    names = []
    for i, s in enumerate(right, 1):
        x, y = MC00.pt(s, 8.6)
        nm = "D01-%02d" % i
        names.append((nm, x, y))
        w('        <Struct name=%s desc="Stormwater pit, CH %.1f"><Center>%s</Center></Struct>' % (quoteattr(nm), s, _ne(x, y)))
    hx, hy = S.headwall
    names.append(("D01-OUTFALL", hx, hy))
    w('        <Struct name="D01-OUTFALL" desc="Headwall to Corella Creek"><Center>%s</Center></Struct>' % _ne(hx, hy))
    w("      </Structs>")
    w("      <Pipes>")
    for i, ((a, *_), (b, *_)) in enumerate(zip(names, names[1:]), 1):
        w('        <Pipe name="D01-P%02d" refStart=%s refEnd=%s/>' % (i, quoteattr(a), quoteattr(b)))
    w("      </Pipes>")
    w("    </PipeNetwork>")
    w("  </PipeNetworks>")
    w("</LandXML>")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- GeoJSON
def _line(pts):
    return {"type": "LineString", "coordinates": [[round(v, 9) for v in lonlat(x, y)] for x, y in pts]}


def _point(x, y):
    return {"type": "Point", "coordinates": [round(v, 9) for v in lonlat(x, y)]}


def _feature(geom, **props):
    return {"type": "Feature", "properties": props, "geometry": geom}


def geojson():
    S = site()
    feats = []
    feats.append(_feature(_line(MC00.poly(0, step=2.0)), name="MC00", kind="control line", length_m=round(MC00.length, 3),
                          desc="Kestrel Road control line"))
    feats.append(_feature(_line(MC01.poly(0, step=2.0)), name="MC01", kind="control line", length_m=round(MC01.length, 3),
                          desc="Hartley Street control line"))
    for name, al, off in (("MC00 kerb left", MC00, -7.0), ("MC00 kerb right", MC00, 7.0), ("MC01 kerb left", MC01, -4.5),
                          ("MC01 kerb right", MC01, 4.5), ("MC00 construction boundary left", MC00, -19.0),
                          ("MC00 construction boundary right", MC00, 19.0), ("MC00 project boundary left", MC00, -22.0),
                          ("MC00 project boundary right", MC00, 22.0)):
        feats.append(_feature(_line(al.poly(off, step=2.0)), name=name, kind=name.split(" ", 1)[1]))
    for i, line in enumerate(S.cadastral, 1):
        feats.append(_feature(_line(line), name="cadastral %d" % i, kind="cadastral boundary"))
    feats.append(_feature(_line(S.creek), name="Corella Creek", kind="watercourse"))
    feats.append(_feature(_line(S.culvert + [S.culvert[0]]), name="Culvert CH %.2f" % CULVERT_CH, kind="culvert"))
    for ms, a, b in MATCHLINES:
        lo, hi = -74.0, 74.0
        feats.append(_feature(_line([MC00.pt(ms, lo), MC00.pt(ms, hi)]), name="Matchline CH %d" % ms,
                              kind="matchline", sheets="%d and %d" % (a, b)))
    for s in range(0, int(MC00.length) + 1, 100):
        x, y, _ = MC00.at(s)
        feats.append(_feature(_point(x, y), name="MC00 CH %d" % s, kind="chainage", chainage=s, rl=round(V00.level(s), 3)))
    for s, lab in MC00.key_stations():
        x, y, b = MC00.at(s)
        feats.append(_feature(_point(x, y), name="MC00 %s" % lab, kind="key point", chainage=round(s, 3),
                              bearing=bearing_dms(b)))
    for px, py in S.pits:
        feats.append(_feature(_point(px, py), name="Pit", kind="stormwater pit"))
    return {"type": "FeatureCollection", "name": "Kestrel Road Upgrade Stage 2",
            "description": "Fictional sample. Longitude and latitude (CRS84), from GDA2020 / MGA zone 56 grid coordinates.",
            "features": feats}
