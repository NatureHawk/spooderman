import json,math
from pathlib import Path
from shapely.geometry import LineString,Polygon,mapping
from shapely.ops import unary_union,polygonize
ROOT=Path(r'C:/Users/PRIYANSHU/Pictures/spoodermanv2');M=json.loads((ROOT/'evidence/construction/building_manifest.json').read_text())['sites'];out=[]
for s in M:
 P=s['original']['positions'];h=s['cutY'];segments=[];c=math.cos(s['yaw']);sn=math.sin(s['yaw'])
 def local(v):
  x,z=v[0]-s['x'],v[2]-s['z'];return (round(x*c-z*sn,4),round(x*sn+z*c,4))
 for k in range(0,len(P),9):
  tri=[P[k+j:k+j+3] for j in (0,3,6)];hits=[]
  for a,b in zip(tri,tri[1:]+tri[:1]):
   if (a[1]<=h<b[1])or(b[1]<=h<a[1]):
    t=(h-a[1])/(b[1]-a[1]);hits.append(local([a[j]+(b[j]-a[j])*t for j in range(3)]))
  if len(hits)==2 and hits[0]!=hits[1]:segments.append(LineString(hits))
 nodes=[];snapped=[]
 for line in segments:
  ends=[]
  for q in line.coords:
   near=next((n for n in nodes if math.dist(n,q)<.12),None)
   if near is None:near=q;nodes.append(q)
   ends.append(near)
  if ends[0]!=ends[1]:snapped.append(LineString(ends))
 from collections import Counter
 counts=Counter(tuple(q) for line in snapped for q in line.coords);ends=[q for q,n in counts.items() if n==1];repairs=[]
 # Some NYC buildings omit a shared party-wall face. Close only the matching
 # collinear boundary chain; keep the repair explicit in the authoring manifest.
 while len(ends)>=2:
  pairs=[(math.dist(a,b),i,j) for i,a in enumerate(ends) for j,b in enumerate(ends) if j>i and (abs(a[0]-b[0])<.15 or abs(a[1]-b[1])<.15)]
  if not pairs:break
  _,i,j=min(pairs);a,b=ends[i],ends[j];snapped.append(LineString([a,b]));repairs.append([a,b]);ends.pop(j);ends.pop(i)
 pieces=list(polygonize(unary_union(snapped)));poly=unary_union(pieces).buffer(0).simplify(.015,preserve_topology=True)
 method='triangle cross-section'
 if poly.is_empty or ends:
  roof=[]
  for k in range(0,len(P),9):
   tri=[P[k+j:k+j+3] for j in (0,3,6)]
   if min(v[1] for v in tri)<h-.05:continue
   ring=[local(v) for v in tri];q=Polygon(ring)
   if q.area>.01:roof.append(q)
  poly=unary_union(roof).buffer(0).simplify(.015,preserve_topology=True);method='cross-section completed by projected original upper roof triangles (source party walls omitted)'
  if poly.is_empty:raise Exception('No source footprint '+str(s['roofBid']))
 polygons=list(poly.geoms) if poly.geom_type=='MultiPolygon' else [poly]
 loops=[{'outer':list(p.exterior.coords)[:-1],'holes':[list(r.coords)[:-1] for r in p.interiors]} for p in polygons]
 out.append({'index':s['variant'],'bid':s['roofBid'],'cutY':h,'x':s['x'],'z':s['z'],'yaw':s['yaw'],'area':poly.area,'bounds':list(poly.bounds),'loops':loops,'sourceSegments':len(segments),'partyWallClosures':repairs,'source':method+'; local XZ metres'})
(ROOT/'evidence/construction/footprints_exact.json').write_text(json.dumps({'version':1,'sites':out},separators=(',',':')))
print([(s['bid'],round(s['area'],1),len(s['loops'])) for s in out])



