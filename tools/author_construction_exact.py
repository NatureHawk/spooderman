import json,math,copy,sys
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon,box,LineString
from shapely.ops import unary_union
from shapely import constrained_delaunay_triangles,contains_xy,covers,box as geometry_boxes
ROOT=Path(r'C:/Users/PRIYANSHU/Pictures/spoodermanv2')
manifest=json.loads((ROOT/'evidence/construction/building_manifest.json').read_text())['sites']
footprints={p['bid']:p for p in json.loads((ROOT/'evidence/construction/footprints_exact.json').read_text())['sites']}
a=json.loads((ROOT/'evidence/construction/blueprints_0_9.json').read_text());b=json.loads((ROOT/'evidence/construction/blueprints_10_19.json').read_text())['sites'];previous={p['bid']:p for p in a+b}
def polygons(g):return [g] if g.geom_type=='Polygon' else [p for p in g.geoms if p.geom_type=='Polygon']
def extrude(poly,bottom,top):
 out=[]
 def tri(a,b,c):out.extend([*a,*b,*c])
 for p in polygons(poly):
  for t in constrained_delaunay_triangles(p).geoms:
   q=list(t.exterior.coords)[:3];signed=sum(q[i][0]*q[(i+1)%3][1]-q[(i+1)%3][0]*q[i][1] for i in range(3))
   if signed>0:q.reverse()
   tri(*[(x,top,z) for x,z in q]);tri(*[(x,bottom,z) for x,z in reversed(q)])
  for ring in [p.exterior,*p.interiors]:
   q=list(ring.coords)
   for (x,z),(X,Z) in zip(q,q[1:]):tri((x,bottom,z),(X,bottom,Z),(X,top,Z));tri((x,bottom,z),(X,top,Z),(x,top,z))
 return [round(v,5) for v in out]
def floor_boxes(poly,y,solids,step=.35):
 x0,z0,x1,z1=poly.bounds;nx=math.ceil((x1-x0)/step);nz=math.ceil((z1-z0)/step);sx=(x1-x0)/nx;sz=(z1-z0)/nz
 X,Z=np.meshgrid(x0+np.arange(nx)*sx,z0+np.arange(nz)*sz);q=poly.buffer(.00001)
 valid=covers(q,geometry_boxes(X,Z,X+sx,Z+sz))
 active={}
 def emit(key,j0,j1):
  i0,i1=key;rect=box(x0+i0*sx,z0+j0*sz,x0+i1*sx,z0+j1*sz)
  if not q.covers(rect) and rect.difference(q).area>1e-7:raise Exception('Invalid merged floor collider')
  solids.append(dict(x=x0+(i0+i1)*sx/2,y=y,z=z0+(j0+j1)*sz/2,hx=(i1-i0)*sx/2,hy=.19,hz=(j1-j0)*sz/2,kind='platform',mat='concrete'))
 for j,row in enumerate(valid):
  edges=np.diff(np.r_[False,row,False].astype(int));spans=[(int(i),int(k)) for i,k in zip(np.where(edges==1)[0],np.where(edges==-1)[0])];now=set(spans)
  for key,j0 in list(active.items()):
   if key not in now:emit(key,j0,j);del active[key]
  for key in spans:active.setdefault(key,j)
 for key,j0 in active.items():emit(key,j0,nz)
def build(p):
 bid=p['roofBid'];F=footprints[bid];P=unary_union([Polygon(g['outer'],g['holes']) for g in F['loops']]);old=previous[bid];M=copy.deepcopy(old['model']);parts=[];solids=[];floors=[];floor_regions=[]
 def cub(mat,x,y,z,hx,hy,hz,kind='beam',solid=True):
  parts.append(dict(shape='box',mat=mat,x=x,y=y,z=z,hx=hx,hy=hy,hz=hz));
  if solid:solids.append(dict(x=x,y=y,z=z,hx=hx,hy=hy,hz=hz,kind=kind,mat=mat))
 def segment(mat,a,b,y,height,width,kind='beam'):
  length=math.dist(a,b)
  if length<.12:return
  poly=LineString([a,b]).buffer(width/2,cap_style='flat');parts.append(dict(shape='footprint',mat=mat,positions=extrude(poly,y-height/2,y+height/2)))
  solids.append(dict(x=(a[0]+b[0])/2,y=y,z=(a[1]+b[1])/2,hx=length/2,hy=height/2,hz=width/2,yaw=-math.atan2(b[1]-a[1],b[0]-a[0]),kind=kind,mat=mat))
 def rod(a,b,r=.024):parts.append(dict(shape='beam',mat='rust',a=a,b=b,r=r))
 # Building 117: true 66.8 by 51.6 metre footprint, not the old 33 by38 metre roof kit.
 openings=[box(-7,-8,6,9),box(-6,-6,8,10),box(-8,-7,5,12),box(-5,-5,8,9)]
 trims=[P,P.difference(box(-40,20,-15,40)),P.intersection(box(-26,-19,35,27)),P.intersection(box(-23,-17,32,25))]
 core=(25,-10,6.4,7.0)
 for l in range(p['stories']):
  plate=trims[min(l,3)].difference(openings[min(l,3)]).difference(box(15,14,19,19));
  if l==p['stories']-1:plate=plate.intersection(unary_union([box(8,-30,45,40),box(-30,14,8,40),box(-30,-30,-10,-7)]))
  if l==p['stories']-1:plate=plate.union(box(M['pipe'][0]-3.1,M['pipe'][2]-3.4,M['pipe'][0]+3.1,M['pipe'][2]+3.4).intersection(P))
  y=(l+1)*4.2;floors.append(plate)
  parts.append(dict(shape='footprint',mat='concrete',label='Floor %d exact building outline'%(l+1),positions=extrude(plate,y-.19,y+.19)));floor_start=len(solids);floor_boxes(plate,y,solids);floor_regions.append({'level':l,'surface':y+.19,'polygons':[{'outer':list(q.exterior.coords),'holes':[list(r.coords) for r in q.interiors]} for q in polygons(plate)],'colliderIndices':list(range(floor_start,len(solids)))})
  for poly in polygons(plate):
   for ring in [poly.exterior,*poly.interiors]:
    q=list(ring.coords)
    for A,B in zip(q,q[1:]):segment('concrete',A,B,y-.44,.42,.42)
  # Three exposed core walls; broad western door remains open.
  x,z,w,d=core
  for A,B in [((x-w/2,z-d/2),(x+w/2,z-d/2)),((x+w/2,z-d/2),(x+w/2,z+d/2)),((x-w/2,z+d/2),(x+w/2,z+d/2))]:segment('concrete',A,B,((l*4.2+(.19 if l else 0))+(y-.19))/2,(y-.19)-(l*4.2+(.19 if l else 0)),.28,'wall')
  # Staggered partial facade: real piers and lintels, with large unfinished windows.
  wallx=31.5 if l>1 else 37.35
  for z in [-17,-10,-3,4,11,18]:
   if plate.buffer(.2).contains(Polygon([(wallx-.3,z-.7),(wallx+.3,z-.7),(wallx+.3,z+.7),(wallx-.3,z+.7)])):
    cub('concrete',wallx,y-2.1,z,.24,1.9,.7,'wall');cub('concrete',wallx,y-.65,z+2.7,.24,.35,2.7,'wall')
 # Continuous bearing columns laid out on a 7m structural grid, plus actual perimeter corners.
 points=[]
 for x in np.arange(-25,36,7):
  for z in np.arange(-18,29,7):
   if P.contains(box(x-.32,z-.32,x+.32,z+.32)) and not any(h.buffer(.6).contains(box(x-.3,z-.3,x+.3,z+.3)) for h in openings):points.append((float(x),float(z)))
 for x,z in points:
  covered=[i for i,g in enumerate(floors) if g.buffer(.03).contains(box(x-.31,z-.31,x+.31,z+.31))]
  if not covered:continue
  height=(max(covered)+1)*4.2
  if trims[-1].buffer(.03).contains(box(x-.35,z-.35,x+.35,z+.35)) and not(abs(x-M['pipe'][0])<2.7 and abs(z-M['pipe'][2])<16):height=M['top']+2.8+(.8 if int(x+z)%3==0 else 0)
  cub('concrete',x,height/2,z,.31,height/2,.31,'column')
  for dx in [-.14,.14]:
   for dz in [-.14,.14]:rod([x+dx,height+.2,z+dz],[x+dx,height+1.35,z+dz])
 # Highest working storey is still being cast: open steel/RC beams and timber centering.
 crown=trims[-1].difference(openings[-1]);T=M['top']
 for z in [-18,-11,-4,3,10,17,24]:
  line=LineString([(-40,z),(45,z)]).intersection(crown)
  for q in ([line] if line.geom_type=='LineString' else list(line.geoms)):
   if q.geom_type=='LineString' and q.length>.3:segment('concrete',q.coords[0],q.coords[-1],T-.32,.48,.34)
 for x in [-25,-18,-11,-4,3,10,17,24,31]:
  line=LineString([(x,-30),(x,35)]).intersection(crown)
  for q in ([line] if line.geom_type=='LineString' else list(line.geoms)):
   if q.geom_type=='LineString' and q.length>.3:segment('concrete',q.coords[0],q.coords[-1],T-.32,.48,.34)
 # Formwork panels occupy a west casting bay; the adjacent central bay stays open to below.
 for x in [-21,-17.9,-14.8,-11.7]:
  for z in [-4.8,-3.55,-2.3,-1.05,.2,1.45,2.7,3.95]:cub('timber',x,T-.08,z,1.48,.07,.56,'platform')
 for x in [-22.5,-19.4,-16.3,-13.2,-10.2]:segment('timber',(x,-5.5),(x,4.6),T-.25,.22,.16)
 for x in [-20,-18,-16,-14,-12]:
  for z in [7,9,11]:rod([x,T+.1,z],[x+1.7,T+.1,z],.025)
 # Projecting concrete core and incomplete crown walls make the active work visible from outside.
 x,z,w,d=core
 for A,B in [((x-w/2,z-d/2),(x+w/2,z-d/2)),((x+w/2,z-d/2),(x+w/2,z+d/2)),((x-w/2,z+d/2),(x+w/2,z+d/2))]:segment('concrete',A,B,T+2.0,3.62,.3,'wall')
 for z in [-14,-7,0,7,14,21]:
  cub('concrete',31.45,T+1.6,z,.27,1.41,.65,'wall')
  if z in [-14,0,14]:cub('concrete',31.45,T+2.72,z+2.9,.27,.3,2.9,'wall')
 # Plywood column forms and tie bands on selected rising columns, all grounded on their stems.
 for x,z in [(-18,-18),(-18,17),(-11,17),(17,22),(24,17),(31,10)]:
  cub('concrete',x,(T+3.3)/2,z,.32,(T+3.3)/2,.32,'column')
  for dx,dz,hx,hz in [(-.38,0,.055,.44),(.38,0,.055,.44),(0,-.38,.44,.055),(0,.38,.44,.055)]:cub('timber',x+dx,T+1.3,z+dz,hx,1.25,hz,solid=False)
  for h in [.35,1.15,1.95,2.7]:cub('steel',x,T+h,z,.46,.035,.46,solid=False)
 # Two substantial covered material stacks are deliberately readable in the top-down skyline.
 for x,z in [(-20,18),(20,22)]:cub('timber',x,T+.5,z,1.9,.31,1.2,'cargo');cub('tarp',x,T+.84,z,2.05,.025,1.34,solid=False)
 # The original footprint forms a closed cut datum; no original finished roof remains above it.
 parts.append(dict(shape='footprint',mat='concrete',positions=extrude(P,-.38,0)))
 # Preserve only the individually positioned pipe and its real gantry; all worksite tanks are removed.
 oldsol=old['model']['solids'];pipeindices=old['model']['pipeSolids'];kept=[]
 for i,v in enumerate(oldsol):
  if i in pipeindices or(v['mat']=='orange' and v['y']>M['top']+1):kept.append(i)
 mapping={oldi:len(solids)+j for j,oldi in enumerate(kept)};solids.extend(copy.deepcopy(oldsol[i]) for i in kept)
 pipeX=M['pipe'][0]
 for v in old['model']['parts']:
  keep=v['shape']=='pipe' or(v['shape']=='ring' and abs(v['x']-pipeX)<.02) or(v['shape']=='box' and v['mat']=='orange' and v['y']>M['top']+1)
  if v['shape']=='beam':keep=v['a'][1]>M['top']+1 and v['b'][1]>M['top']+1 and abs(v['a'][0]-pipeX)<2 and abs(v['b'][0]-pipeX)<2
  if keep:parts.append(copy.deepcopy(v))
 x0,z0,x1,z1=P.bounds;M['start']=[2.5+(M['hx']-2.5)/2,.025,-M['hz']+2];M['craneLocal']=[-M['hx']-3,-M['hz']+3];M['bounds']={'minX':x0,'minZ':z0,'maxX':x1,'maxZ':z1,'centerX':(x0+x1)/2,'centerZ':(z0+z1)/2};M['hx']=(x1-x0)/2;M['hz']=(z1-z0)/2
 M.update(parts=parts,solids=solids,pipeSolids=[mapping[i] for i in pipeindices],tower=None,legs=[],floorRegions=floor_regions,floorPolygons=[{'outer':[list(q.exterior.coords) for q in polygons(g)],'area':g.area} for g in floors],decks=[],finish=[12,4.39,1],authoredBuilding=bid)
 M['details']=[dict(kind=kind,id=name,x=x,y=M['top']+.19,z=z,yaw=yaw) for kind,name,x,z,yaw in [
 ('pallet_bundle','east-loading-pallets',16,21,0),('panel_rack','crown-shutter-rack',27,12,.3),('rebar_bundle','core-rebar-stock',19,4,0),('cement_bags','rear-pour-bags',13,-12,0),('cable_coil','east-rigging-coil',28,21,0),('panel_rack','west-front-panels',-15,21,-.3),('pallet_bundle','west-pour-stock',-9,20,0),('rebar_bundle','west-rebar-casting',-18,-12,0),('cement_bags','west-casting-bags',-20,-9,0),('cable_coil','formwork-rigging',-12,-13,0)]]
 return dict(index=p['variant'],id=p['id'],bid=bid,name='Dockside Courtyard and Core',designNotes='Original 3445m2 footprint with courtyard, lift void, western setbacks, three-sided shear core, east unfinished facade and continuous structural grid.',model=M)
if __name__=='__main__':
 proof=build(manifest[0]);(ROOT/'evidence/construction/structural_proof_117.json').write_text(json.dumps(proof,separators=(',',':')));print('PROOF',len(proof['model']['parts']),len(proof['model']['solids']),[round(g['area']) for g in proof['model']['floorPolygons']])

