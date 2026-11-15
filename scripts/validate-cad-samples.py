"""Optional independent geometry oracle. Requires ezdxf, pypdf and pikepdf.
Run check-cad-samples.mjs first. No external fixtures are redistributed.
"""
from pathlib import Path
import argparse, json, math, hashlib, collections
import ezdxf, pypdf, pikepdf
from ezdxf.render.hatching import hatch_entity
from pypdf.generic import ContentStream
PT=72/25.4
def mul(a,b):
 A,B,C,D,E,F=a;g,h,i,j,k,l=b
 return(A*g+C*h,B*g+D*h,A*i+C*j,B*i+D*j,A*k+C*l+E,B*k+D*l+F)

def paths(stream,res,reader,m=(1,0,0,1,0,0),width=1):
 lines=[];nodes=[];cur=None;start=None;stack=[];clips=curves=fills=0
 def point(p):a,b,c,d,e,f=m;x,y=map(float,p);return(a*x+c*y+e,b*x+d*y+f)
 for args,op in ContentStream(stream,reader).operations:
  if op==b'q':stack.append((m,width))
  elif op==b'Q':m,width=stack.pop()
  elif op==b'cm':m=mul(m,tuple(map(float,args)))
  elif op==b'w':width=float(args[0])
  elif op==b'm':cur=point(args);start=cur;nodes.append(cur)
  elif op==b'l':
   end=point(args);lines.append({'a':cur,'b':end,'widthMm':width*math.hypot(m[0],m[1])/PT});cur=end;nodes.append(cur)
  elif op==b'h':
   if cur and start and math.dist(cur,start)>1e-9:lines.append({'a':cur,'b':start,'widthMm':width*math.hypot(m[0],m[1])/PT})
   cur=start
  elif op==b'c':curves+=1;cur=point(args[-2:]);nodes.append(cur)
  elif op in [b'W',b'W*']:clips+=1
  elif op in [b'f',b'f*',b'B',b'B*']:fills+=1
  elif op==b'Do':
   form=res.get('/XObject',{}).get(args[0]);form=form.get_object() if form else None
   if form and form.get('/Subtype')=='/Form':
    ls,cs,vs,fs,ns=paths(form,form.get('/Resources',res),reader,mul(m,tuple(map(float,form.get('/Matrix',[1,0,0,1,0,0])))),width);lines+=ls;clips+=cs;curves+=vs;fills+=fs;nodes+=ns
 return lines,clips,curves,fills,nodes

def inspect(path):
 with pikepdf.open(path) as doc:issues=doc.check_pdf_syntax()
 reader=pypdf.PdfReader(path,strict=True);assert len(reader.pages)==1,'Expected one A3 sheet'
 p=reader.pages[0];ls,cs,vs,fs,ns=paths(p.get_contents(),p.get('/Resources',{}),reader)
 return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'qpdfIssues':issues,'widthMm':float(p.mediabox.width)/PT,'heightMm':float(p.mediabox.height)/PT,'lines':ls,'nodes':ns,'clips':cs,'curves':vs,'fills':fs,'text':p.extract_text()}

def source_lines(entity):
 kind=entity.dxftype()
 if kind=='LINE':yield tuple(entity.dxf.start)[:2],tuple(entity.dxf.end)[:2]
 elif kind=='LWPOLYLINE':
  vertices=list(entity.get_points('xyb'));n=len(vertices)
  for i in range(n if entity.closed else n-1):
   a,b=vertices[i],vertices[(i+1)%n]
   if abs(a[2])<1e-12:yield a[:2],b[:2]
 elif kind in ('DIMENSION','INSERT'):
  for child in entity.virtual_entities():yield from source_lines(child)

def source_text(entity):
 kind=entity.dxftype()
 if kind in ('TEXT','MTEXT'):yield entity.plain_text()
 elif kind in ('DIMENSION','INSERT'):
  for child in entity.virtual_entities():yield from source_text(child)

def characters(text):return collections.Counter(c for c in text if not c.isspace())

def error(a,b):return min(max(math.dist(a[0],b['a']),math.dist(a[1],b['b'])),max(math.dist(a[0],b['b']),math.dist(a[1],b['a'])))

def point_segment_distance(p,line):
 a,b=line['a'],line['b'];dx=b[0]-a[0];dy=b[1]-a[1];length2=dx*dx+dy*dy
 if length2==0:return math.dist(p,a)
 t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2))
 return math.dist(p,(a[0]+t*dx,a[1]+t*dy))

def source_curve_anchors(entity):
 kind=entity.dxftype()
 if kind=='CIRCLE':
  x,y=tuple(entity.dxf.center)[:2];r=entity.dxf.radius
  for dx,dy in [(r,0),(0,r),(-r,0),(0,-r)]:yield(x+dx,y+dy)
 elif kind=='ARC':
  for p in [entity.start_point,entity.end_point]:yield tuple(p)[:2]
 elif kind=='LWPOLYLINE':
  vertices=list(entity.get_points('xyb'))
  for i,a in enumerate(vertices):
   if abs(a[2])>1e-12:
    yield a[:2];yield vertices[(i+1)%len(vertices)][:2]
 elif kind in ('DIMENSION','INSERT'):
  for child in entity.virtual_entities():yield from source_curve_anchors(child)

def source_solid_primitives(entity):
 if entity.dxftype()=='SOLID' or entity.dxftype()=='HATCH' and entity.dxf.solid_fill:return 1
 if entity.dxftype()=='LEADER' and entity.dxf.has_arrowhead:return 1
 if entity.dxftype() in ('DIMENSION','INSERT'):return sum(source_solid_primitives(child) for child in entity.virtual_entities())
 return 0


parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fixtures',type=Path,default=Path('reference-data/cad-sample-tests'))
parser.add_argument('--output',type=Path)
a=parser.parse_args(); output=a.output or a.fixtures/'output'
manifest=json.loads(Path(__file__).with_name('cad-public-samples.json').read_text())
for f in manifest['files']:
 assert hashlib.sha256((a.fixtures/f['path']).read_bytes()).hexdigest()==f['sha256'], f['path']
rows=[]
for case in manifest['cases']:
 source=a.fixtures/(case['stem']+'.dxf');doc=ezdxf.readfile(source)
 # Pinned source coordinates; never infer plotting scale from the converter report.
 unit_mm=25.4 if doc.units==1 else 1; scale=unit_mm/case['ratio']
 origin=(-8.4,-5.3) if source.parent.name=='bai_c' else (0,0)
 def transform(p): return tuple((p[i]-origin[i])*scale*PT for i in (0,1))
 expected=[(transform(x),transform(y)) for e in doc.modelspace() for x,y in source_lines(e)]
 anchors=[transform(x) for e in doc.modelspace() for x in source_curve_anchors(e)]
 text=''.join(t for e in doc.modelspace() for t in source_text(e))
 hatch_points=[]
 for e in doc.modelspace():
  if e.dxftype()=='HATCH' and not e.dxf.solid_fill:
   segments=list(hatch_entity(e,jiggle_origin=False))
   for x,y in segments[::max(1,math.ceil(len(segments)/50))]:hatch_points.append(transform((x+y)/2))
 for extension in ('dwg','dxf'):
  name=Path(case['stem']).name+'.'+extension;pdf=inspect(output/(name+'.pdf'))
  straight=max(min(error(x,y) for y in pdf['lines'])/PT for x in expected)
  curve=max(min(math.dist(x,y) for y in pdf['nodes'])/PT for x in anchors)
  hatch=max((min(point_segment_distance(x,y) for y in pdf['lines'])/PT for x in hatch_points),default=0)
  widths=sorted(set(round(x['widthMm'],4) for x in pdf['lines']))
  assert not pdf['qpdfIssues'],name
  assert all(abs(pdf[k]-v)<.001 for k,v in zip(('widthMm','heightMm'),case['paperMm'])),name
  assert straight<.02 and curve<.02 and hatch<.02,name
  assert characters(text)==characters(pdf['text']),name
  assert all(any(abs(w-v)<.001 for w in widths) for v in (.18,.25,.35,.5,.7)),name
  row=dict(file=name,ratio=case['ratio'],intendedRatio=case['intendedRatio'],paperMm=case['paperMm'],straightSegments=len(expected),dimensions=case['dimensions'],maxEndpointErrorMm=straight,maxCurveAnchorErrorMm=curve,hatchSamples=len(hatch_points),maxHatchMidpointErrorMm=hatch,lineweightsMm=widths)
  rows.append(row); print(name, 'PASS',straight,curve,hatch)
(output/'numeric-results.json').write_text(json.dumps(dict(rows=rows,limitations=['DWG geometry compared with paired DXF, not independently decoded by a second DWG reader.','Curve anchors and sampled hatch strokes do not certify every curve interior or glyph outline.','Two mounting-plate DWG leader arrowheads remain explicitly unsupported.']),indent=2),encoding='utf8')
