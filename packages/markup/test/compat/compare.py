"""Compares a saved PDF with the Bluebeam source: catalog, page keys, every annotation key, links
between annotations (IRT, Popup/Parent), and a render diff. Usage: compare.py <source> <saved> [--edited]"""
import json
import sys

import pypdf
from pypdf.generic import IndirectObject

src, out = sys.argv[1], sys.argv[2]
edited = '--edited' in sys.argv
A, B = pypdf.PdfReader(src), pypdf.PdfReader(out)
problems = []


def obj(a):
    """An /Annots entry as its dictionary. A null entry (Revu leaves some in its files) stays in place as None."""
    o = a.get_object() if hasattr(a, 'get_object') else a
    return o if isinstance(o, dict) else None


def plain(o, d=0):
    if isinstance(o, IndirectObject):
        if d > 0:
            return '<ref>'
        o = o.get_object()
    if isinstance(o, dict):
        return {k: plain(v, d + 1) for k, v in o.items() if k not in ('/AP',)}
    if isinstance(o, list):
        return [plain(v, d + 1) for v in o]
    if isinstance(o, float):
        return round(o, 3)
    return str(o) if not isinstance(o, (int, bool)) or o is None else o


ra, rb = A.trailer['/Root'], B.trailer['/Root']
for k in ra:
    if k == '/Pages':
        continue
    if k not in rb:
        problems.append(f'catalog {k} lost')
    elif json.dumps(plain(ra[k]), sort_keys=True) != json.dumps(plain(rb[k]), sort_keys=True) and k not in ('/Outlines',):
        problems.append(f'catalog {k} changed')
for o1, o2 in zip(A.outline, B.outline):
    if o1.title != o2.title or A.get_destination_page_number(o1) != B.get_destination_page_number(o2):
        problems.append(f'bookmark {o1.title} changed')
    for attr in ('left', 'top', 'zoom'):
        if round(float(getattr(o1, attr) or 0), 2) != round(float(getattr(o2, attr) or 0), 2):
            problems.append(f'bookmark {o1.title} {attr} {getattr(o1, attr)} -> {getattr(o2, attr)}')

for i, (pa, pb) in enumerate(zip(A.pages, B.pages)):
    for k in ('/VP', '/BSISpaces'):
        if k in pa and (k not in pb or json.dumps(plain(pa[k]), sort_keys=True) != json.dumps(plain(pb[k]), sort_keys=True)):
            problems.append(f'page {i + 1} {k} ' + ('lost' if k not in pb else 'changed'))
    sa = [obj(a) for a in pa.get('/Annots', [])]
    sb = [obj(a) for a in pb.get('/Annots', [])]
    nm = lambda d: str(d.get('/NM', ''))
    by_nm = {nm(d): d for d in sb if d is not None and nm(d)}
    ids_b = {r.idnum for r in pb.get('/Annots', []) if isinstance(r, IndirectObject)}
    for j, a in enumerate(sa):
        if a is None:
            continue
        b = by_nm.get(nm(a)) if nm(a) else (sb[j] if j < len(sb) else None)
        label = f"p{i + 1}#{j} {a.get('/Subtype')} {a.get('/Subj', '')}"
        if b is None:
            problems.append(f'{label}: missing')
            continue
        lost = [k for k in a if k not in b and k != '/AP']
        changed = [k for k in a if k in b and k not in ('/AP', '/P', '/Parent', '/IRT', '/Popup') and json.dumps(plain(a[k]), sort_keys=True) != json.dumps(plain(b[k]), sort_keys=True)]
        if lost:
            problems.append(f'{label}: keys lost {lost}')
        if changed and not edited:
            problems.append(f'{label}: keys changed {changed}')
        if changed and edited:
            print(f'  (edited) {label}: changed {changed}')
    # Links between annotations must point at annotations still on the page.
    for j, r in enumerate(pb.get('/Annots', [])):
        d = obj(r)
        if d is None:
            continue
        for key in ('/IRT', '/Popup', '/Parent'):
            ref = d.raw_get(key) if key in d else None
            if isinstance(ref, IndirectObject) and ref.idnum not in ids_b and d.get('/Subtype') != '/Widget':
                problems.append(f'p{i + 1}#{j} {d.get("/Subtype")} {key} points at an annotation not on the page')
    print(f'page {i + 1}: {len(sa)} annotations in source, {len(sb)} saved')

try:
    import fitz
    import numpy as np

    fa, fb = fitz.open(src), fitz.open(out)
    for i in range(len(fa)):
        pa = fa[i].get_pixmap(matrix=fitz.Matrix(2, 2))
        pb = fb[i].get_pixmap(matrix=fitz.Matrix(2, 2))
        x = np.frombuffer(pa.samples, np.uint8).reshape(pa.h, pa.w, pa.n).astype(int)
        y = np.frombuffer(pb.samples, np.uint8).reshape(pb.h, pb.w, pb.n).astype(int)
        diff = (abs(x - y).sum(2) > 60).mean() * 100
        print(f'page {i + 1}: {diff:.2f}% of pixels differ when rendered')
        if diff > 0.05 and not edited:
            problems.append(f'page {i + 1} renders differently ({diff:.2f}%)')
except ImportError:
    pass

print('\n'.join(['PROBLEMS:'] + problems) if problems else 'NO PROBLEMS')
