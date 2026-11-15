"""The 21-sheet drawing list: numbers, titles and per-sheet title block data."""
from .titleblock import SAMPLE

PREFIX = "KRU2-MCC-0412-RW-DRG-"

# (key, drawing suffix, title line 1, title line 2, series sheet, series total, scale, index title)
_ROWS = [
    ("cover", "000001", "COVER SHEET", "AND LOCALITY PLAN", 1, 1, "NTS", "COVER SHEET AND LOCALITY PLAN"),
    ("index", "000002", "DRAWING INDEX", "ROADWORKS", 1, 1, "NTS", "DRAWING INDEX"),
    ("legend", "000011", "GENERAL LEGEND", "AND NOTES", 1, 1, "NTS", "GENERAL LEGEND AND NOTES"),
    ("ts1", "000021", "TYPICAL SECTIONS", "KESTREL ROAD (MC00)", 1, 2, "1:50", "TYPICAL SECTIONS"),
    ("ts2", "000022", "TYPICAL SECTIONS", "SIDE ROAD AND DETAILS", 2, 2, "AS SHOWN", "TYPICAL SECTIONS"),
    ("plan1", "000031", "ALIGNMENT CONTROL PLAN", "CH 0 TO CH 280", 1, 4, "1:500", "ALIGNMENT CONTROL PLAN"),
    ("plan2", "000032", "ALIGNMENT CONTROL PLAN", "CH 280 TO CH 565", 2, 4, "1:500", "ALIGNMENT CONTROL PLAN"),
    ("plan3", "000033", "ALIGNMENT CONTROL PLAN", "CH 565 TO CH 830", 3, 4, "1:500", "ALIGNMENT CONTROL PLAN"),
    ("plan4", "000034", "ALIGNMENT CONTROL PLAN", "CH 830 TO CH 1040", 4, 4, "1:500", "ALIGNMENT CONTROL PLAN"),
    ("setout", "000056", "SETOUT TABLES", "CONTROL LINES MC00 AND MC01", 1, 1, "NTS", "MAIN CONTROL LINES SETOUT TABLES"),
    ("ls1", "000201", "LONGITUDINAL SECTION", "CONTROL LINE MC00 CH 0-260", 1, 4, "AS SHOWN", "LONGITUDINAL SECTIONS CONTROL LINE MC00"),
    ("ls2", "000202", "LONGITUDINAL SECTION", "CONTROL LINE MC00 CH 260-520", 2, 4, "AS SHOWN", "LONGITUDINAL SECTIONS CONTROL LINE MC00"),
    ("ls3", "000203", "LONGITUDINAL SECTION", "CONTROL LINE MC00 CH 520-780", 3, 4, "AS SHOWN", "LONGITUDINAL SECTIONS CONTROL LINE MC00"),
    ("ls4", "000204", "LONGITUDINAL SECTION", "CONTROL LINE MC00 CH 780-1040", 4, 4, "AS SHOWN", "LONGITUDINAL SECTIONS CONTROL LINE MC00"),
    ("ls01", "000221", "LONGITUDINAL SECTIONS", "MC01 AND DRAINAGE LINE D01", 1, 1, "AS SHOWN", "LONGITUDINAL SECTIONS CONTROL LINE MC01 AND DRAINAGE LINE D01"),
    ("xs1", "000301", "CROSS SECTIONS", "CONTROL LINE MC00 CH 0-150", 1, 5, "1:100", "CROSS SECTIONS CONTROL LINE MC00"),
    ("xs2", "000302", "CROSS SECTIONS", "CONTROL LINE MC00 CH 200-350", 2, 5, "1:100", "CROSS SECTIONS CONTROL LINE MC00"),
    ("xs3", "000303", "CROSS SECTIONS", "CONTROL LINE MC00 CH 400-550", 3, 5, "1:100", "CROSS SECTIONS CONTROL LINE MC00"),
    ("xs4", "000304", "CROSS SECTIONS", "CONTROL LINE MC00 CH 600-750", 4, 5, "1:100", "CROSS SECTIONS CONTROL LINE MC00"),
    ("xs5", "000305", "CROSS SECTIONS", "CONTROL LINE MC00 CH 800-950", 5, 5, "1:100", "CROSS SECTIONS CONTROL LINE MC00"),
    ("xs01", "000311", "CROSS SECTIONS", "CONTROL LINE MC01 CH 40-140", 1, 1, "1:100", "CROSS SECTIONS CONTROL LINE MC01"),
]

SHEETS = []
for i, (key, num, t1, t2, sn, st, scale, idx_title) in enumerate(_ROWS, 1):
    SHEETS.append(dict(page=i, key=key, num=num, drg=PREFIX + num, t1=t1, t2=t2, sn=sn, st=st,
                       scale=scale, index_title=idx_title))
BY_KEY = {s["key"]: s for s in SHEETS}
assert len(SHEETS) == 21


def drg(key):
    return BY_KEY[key]["drg"]


def title_block_data(sheet):
    D = dict(SAMPLE)
    D["drg_no"] = sheet["drg"]
    D["title"] = (sheet["t1"], sheet["t2"], "SHEET %d OF %d" % (sheet["sn"], sheet["st"]))
    D["scale"] = sheet["scale"]
    D["file"] = sheet["drg"] + ".dwg"
    D["discipline"] = "ROADWORKS"
    D["meta"] = [
        ("COORDINATE SYSTEM", "GDA2020 / MGA ZONE 56", "HEIGHT DATUM", "AHD71"),
        ("DISCIPLINE", "ROADWORKS", "DESIGN LOT CODE", "LOT-03"),
        ("CONTRACT No", "NRC-C-2026-014", "BRIDGE / ASSET No", "N/A"),
        ("REFERENCES", "KRU2-MCC-0412-GN-M2D-000001", "AMENDMENT No", "AMD-0006"),
    ]
    D["package"] = "DESIGN PACKAGE RW01  |  ROADWORKS"
    return D
