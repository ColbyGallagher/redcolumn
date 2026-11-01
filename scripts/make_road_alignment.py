"""Write the georeferenced Kestrel Road alignment files.

    python scripts/make_road_alignment.py [output-folder]

Writes kestrel-road-alignment.xml (LandXML 1.2, GDA2020 / MGA zone 56) and
kestrel-road-alignment.geojson (longitude and latitude). All data is fictional.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from roadset.alignment_export import geojson, landxml  # noqa: E402

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "kestrel-road-alignment.xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write(landxml())
    with open(os.path.join(out, "kestrel-road-alignment.geojson"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(geojson(), f, separators=(",", ":"))
    print("wrote", out)
