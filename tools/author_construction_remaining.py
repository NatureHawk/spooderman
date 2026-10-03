import json,math,copy,sys
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon,box,LineString,Point
from shapely.ops import unary_union
import author_construction_exact as E
R=E.ROOT
# Each line is an independent architectural brief in actual building-local metres:
# cores (primary / constrained-site alternative), courtyard, pour zones, casting bay,
# visible facade edges, column pitch, crown rise, and a one-off terrace cut.
SPECS={
147:('Liberty Dogleg Court',[(-22,15,5.5,7),(-6,4,4.5,5)],[-4,-6,4,9],[[-40,-30,-10,50],[-10,20,25,50]],[-7,12,10,19],'WN',6.6,3.2,[-40,-30,-24,-5]),
130:('Civic East Transfer Frame',[(55,-9,8,8),(25,12,6,6)],[-5,-9,4,10],[[28,-30,90,35],[-20,13,28,35]],[10,-16,26,-5],'ES',8.0,4.4,[65,12,100,40]),
169:('Pearl Corner Shearworks',[(12,19,5.5,6),(-6,4,4.5,5)],[-4,-6,3,8],[[4,-30,30,35],[-20,18,4,35]],[-10,-14,1,-5],'EN',6.1,3.8,[-25,22,2,40]),
499:('Stone Street Narrow Cast',[(-5,10,4.5,5),(-5,-10,4.5,5)],[-3,-7,3,7],[[-15,4,20,24],[3,-24,20,4]],[-8,-16,0,-8],'WS',5.4,3.0,[10,10,25,30]),
173:('Fulton Twin Transfer Hall',[(-24,5,6,7),(-6,5,4.5,5)],[-6,-5,5,7],[[-45,-25,-9,30],[10,-25,38,-2]],[-7,9,12,18],'NW',7.0,3.7,[20,14,40,30]),
598:('Hudson Longitudinal Core',[(-6,-35,6,8),(-6,-6,4.5,5)],[-4,-10,3,12],[[-35,-70,20,-8],[-35,35,20,70]],[-23,5,-5,25],'WE',7.3,4.1,[-40,42,-12,75]),
212:('Trinity West Casting Court',[(-16,10,6,6),(-6,3,4.5,5)],[-4,-8,3,8],[[-35,-50,-9,30],[12,-50,45,-4]],[-4,10,12,19],'SW',6.8,3.3,[25,5,50,30]),
205:('Mercer Double Shear Crown',[(31,-13,7,7),(-29,12,6,6)],[-7,-7,5,9],[[-55,-30,-10,30],[15,-30,55,5]],[-5,12,16,21],'NS',8.2,4.2,[30,12,60,35]),
92:('Canal Angled Formwork',[(-8,1,4.5,5),(-5,8,4.5,5)],[-3,-5,2,5],[[-20,-20,-3,20],[2,-20,20,-3]],[-1,7,9,14],'NW',5.2,3.4,[10,4,25,25]),
178:('Exchange Southern Shaft',[(-8,-33,5.5,7),(-6,-7,4.5,5)],[-4,-7,3,7],[[-30,-60,16,-12],[-30,2,-4,20]],[-18,-7,-5,8],'WE',6.3,4.0,[-30,-60,-15,-35]),
697:('Broadway Two-Wing Logistics',[(35,22,9,8),(-35,-25,8,8)],[-9,-11,7,10],[[-70,-65,-15,65],[15,5,70,65]],[0,-35,23,-15],'NE',9.0,4.3,[35,-65,75,-25]),
418:('Bowery Compact Wallworks',[(-12,0,4.5,5),(-6,0,4.5,5)],[-3,-4,2,5],[[-25,-15,-5,15],[3,-15,18,0]],[-3,6,8,10],'WS',5.2,3.1,[7,4,20,20]),
127:('Seaport North Gallery',[(-20,-10,5.5,6),(-6,-6,4.5,5)],[-5,-6,3,5],[[-38,-30,-8,20],[8,-30,36,-7]],[-4,-20,10,-11],'NS',6.7,3.5,[-40,4,-17,20]),
228:('Water Street Split Cores',[(-31,-25,7,8),(20,-10,6,7)],[-6,-8,4,8],[[-60,-50,-12,28],[12,-50,42,-8]],[-7,10,13,20],'SW',7.7,4.5,[15,10,45,35]),
425:('Tribeca North Casting Wing',[(17,-19,6,6),(-6,-7,4.5,5)],[-5,-7,4,8],[[-35,4,38,30],[12,-40,38,4]],[-19,-23,-5,-9],'EN',6.5,3.4,[-40,-40,-15,-15]),
472:('Worth Street Transfer Court',[(-32,-15,8,8),(32,20,6,7)],[-7,-8,5,9],[[-60,-45,-10,45],[15,1,60,45]],[-7,16,12,30],'NW',8.2,4.0,[25,-45,65,-20]),
242:('Chambers Linked Casting Halls',[(50,-10,7,8),(-5,8,4.5,5)],[-3,-8,3,8],[[25,-40,82,30],[-15,12,25,30]],[7,-25,24,-10],'ES',7.5,3.9,[55,10,90,35]),
124:('Riverfront Heavy Transfer Deck',[(-43,27,10,9),(17,-22,8,8)],[-8,-11,6,11],[[-90,-55,-25,80],[10,2,50,80]],[-17,-32,8,-12],'WN',9.2,4.8,[-90,45,-40,85]),
118:('Park Row Long West Crown',[(-54,14,8,8),(-6,12,4.5,5)],[-3,-5,3,7],[[-95,-20,-30,55],[-30,22,18,55]],[-24,2,-7,16],'NS',7.4,4.1,[-100,32,-60,65])}

def safe_body(solids,x,y,z):
 for b in solids:
  c=math.cos(b.get('yaw',0));s=math.sin(b.get('yaw',0));dx=x-b['x'];dz=z-b['z'];X=dx*c-dz*s;Z=dx*s+dz*c
  for off in [-.57,-.08,.42]:
   ds=max(abs(X)-b['hx'],0)**2+max(abs(y+off-b['y'])-b['hy'],0)**2+max(abs(Z)-b['hz'],0)**2
   if ds<.40**2:return False
 return True

def build(p):
 bid=p['roofBid'];spec=SPECS[bid];name,core_candidates,hole,pours,form,facades,pitch,rise,notch=spec;F=E.footprints[bid];P=unary_union([Polygon(q['outer'],q['holes']) for q in F['loops']]);old=E.previous[bid];M=copy.deepcopy(old['model']);T=M['top'];parts=[];solids=[];regions=[];floors=[];pipeX,pipeY,pipeZ=M['pipe'];x0,z0,x1,z1=P.bounds
 def cub(mat,x,y,z,hx,hy,hz,kind='beam',solid=True):
  parts.append(dict(shape='box',mat=mat,x=x,y=y,z=z,hx=hx,hy=hy,hz=hz))
  if solid:solids.append(dict(x=x,y=y,z=z,hx=hx,hy=hy,hz=hz,kind=kind,mat=mat))
 def seg(mat,A,B,y,height,width,kind='beam'):
  length=math.dist(A,B)
  if length<.15:return
  poly=LineString([A,B]).buffer(width/2,cap_style='flat');parts.append(dict(shape='footprint',mat=mat,positions=E.extrude(poly,y-height/2,y+height/2)));solids.append(dict(x=(A[0]+B[0])/2,y=y,z=(A[1]+B[1])/2,hx=length/2,hy=height/2,hz=width/2,yaw=-math.atan2(B[1]-A[1],B[0]-A[0]),kind=kind,mat=mat))
 def rod(A,B,r=.024):parts.append(dict(shape='beam',mat='rust',a=A,b=B,r=r))
 cores=[]
 for cx,cz,w,d in core_candidates:
  if P.buffer(.02).covers(box(cx-w/2-.15,cz-d/2-.15,cx+w/2+.15,cz+d/2+.15)) and (abs(cx-pipeX)>w/2+3 or abs(cz-pipeZ)>d/2+17):cores.append((cx,cz,w,d))
 if not cores:
  for cx,cz in [(-6,0),(-6,4),(-6,-4),(6,-7)]:
   if P.covers(box(cx-2.3,cz-2.7,cx+2.3,cz+2.7)) and abs(cx-pipeX)>5:cores=[(cx,cz,4.6,5.4)];break
 if not cores:raise Exception('No supported authored core '+str(bid))
 # A separate lift void follows each core's real wall, in addition to the main courtyard.
 core_outer=unary_union([box(cx-w/2-.35,cz-d/2-.35,cx+w/2+.35,cz+d/2+.35) for cx,cz,w,d in cores]);core_void=unary_union([box(cx-w/2+.34,cz-d/2+.34,cx+w/2-.34,cz+d/2-.34) for cx,cz,w,d in cores])
 main_hole=box(*hole);station=box(pipeX-3.15,pipeZ-3.5,pipeX+3.15,pipeZ+3.5).intersection(P)
 for l in range(M['stories']):
  plate=P
  if l>=max(1,M['stories']-2):plate=plate.difference(box(*notch))
  # Each brief has an independent courtyard and a different stepped exterior cut.
  opening=main_hole.buffer((l%2)*.65,join_style='mitre');plate=plate.difference(opening).difference(core_void)
  if l==M['stories']-1:plate=plate.intersection(unary_union([box(*r) for r in pours])).union(station).union(core_outer.intersection(P)).difference(core_void)
  if l==M['stories']-1 and bid==130:plate=plate.difference(box(35,-16,48,12))
  if l==M['stories']-1 and bid==118:plate=plate.difference(box(-56,29,-42,42))
  if plate.area<P.area*.20:raise Exception('Insufficient poured crown '+str(bid))
  y=(l+1)*4.2;floors.append(plate);parts.append(dict(shape='footprint',mat='concrete',label=f'{name}: exact floor {l+1}',positions=E.extrude(plate,y-.19,y+.19)));first=len(solids);E.floor_boxes(plate,y,solids);regions.append(dict(level=l,surface=y+.19,polygons=[dict(outer=list(q.exterior.coords),holes=[list(r.coords) for r in q.interiors]) for q in E.polygons(plate)],colliderIndices=list(range(first,len(solids)))))
  for poly in E.polygons(plate):
   for ring in [poly.exterior,*poly.interiors]:
    q=list(ring.coords)
    for A,B in zip(q,q[1:]):seg('concrete',A,B,y-.43,.42,.4)
 # Actual footprint columns; poured-floor voids remain open all the way down.
 columns=[];offx=2.4+(p['variant']%3)*.8;offz=2.7+(p['variant']%4)*.6
 for x in np.arange(x0+offx,x1-1.0,pitch):
  for z in np.arange(z0+offz,z1-1.0,pitch):
   if not P.covers(box(x-.35,z-.35,x+.35,z+.35)) or(abs(x)<2.1 and abs(z)<6) or main_hole.buffer(.5).contains(Point(x,z)) or core_outer.buffer(.4).contains(Point(x,z)):continue
   bearing=[j for j,g in enumerate(floors) if g.covers(box(x-.34,z-.34,x+.34,z+.34))]
   h=(max(bearing)+1)*4.2 if bearing else T
   if not(abs(x-pipeX)<2.8 and abs(z-pipeZ)<17):h=T+rise*.8
   cub('concrete',float(x),h/2,float(z),.32,h/2,.32,'column');columns.append((float(x),float(z),h))
   for dx in [-.14,.14]:
    for dz in [-.14,.14]:rod([float(x+dx),h+.12,float(z+dz)],[float(x+dx),h+1.05,float(z+dz)])
 # Concrete cores project above the active level and leave one open service face.
 for k,(cx,cz,w,d) in enumerate(cores):
  corners=[(cx-w/2,cz-d/2),(cx+w/2,cz-d/2),(cx+w/2,cz+d/2),(cx-w/2,cz+d/2)];omitted=(p['variant']+k)%4
  for side in range(4):
   if side==omitted:continue
   seg('concrete',corners[side],corners[(side+1)%4],(T+rise)/2,T+rise,.32,'wall')
 # Exposed cross-beams span the unpoured crown; they follow the real outline.
 beam_region=P.difference(main_hole).difference(core_void)
 for horizontal in [True,False]:
  lower,upper=(z0,z1) if horizontal else (x0,x1)
  for v in np.arange(lower+2.5,upper-1,pitch):
   line=LineString([(x0-1,v),(x1+1,v)] if horizontal else [(v,z0-1),(v,z1+1)]).intersection(beam_region)
   for q in ([line] if line.geom_type=='LineString' else list(line.geoms)):
    if q.geom_type=='LineString' and q.length>.2:seg('concrete',q.coords[0],q.coords[-1],T-.33,.46,.34)
 # Individually located timber centering bay, with open gaps between planks.
 form_poly=box(*form).intersection(P).difference(core_outer).difference(main_hole)
 for x in np.arange(form[0]+1.4,form[2]-1.2,3.0):
  for z in np.arange(form[1]+.55,form[3]-.4,1.2):
   if form_poly.covers(box(x-1.4,z-.5,x+1.4,z+.5)):cub('timber',float(x),T-.07,float(z),1.4,.07,.5,'platform')
 # Visually distinct active casting bays on the two broadest blank crown wings.
 # Open cuts remain real gaps; timber decking covers only staged portions on beams.
 casting={130:[(35,-16,48,-5),(35,2,48,12)],118:[(-56,29,-48,42)]}.get(bid,[])
 for xa,za,xb,zb in casting:
  for z in np.arange(za+.34,zb-.30,.70):
   for x in np.arange(xa+1.45,xb-1.35,3.0):
    cub('timber',float(x),T+.055,float(z),1.43,.105,.31,'platform')
  for x in np.arange(xa+1.4,xb-1.2,3.0):seg('timber',(x,za),(x,zb),T-.24,.30,.18)
  # Rust-colored reinforcement is supported on the actual shuttering panels.
  for z in np.arange(za+.5,zb-.4,1.0):rod([xa+.3,T+.22,float(z)],[xb-.3,T+.22,float(z)],.035)
  for x in np.arange(xa+.6,xb-.5,1.2):rod([float(x),T+.23,za+.3],[float(x),T+.23,zb-.3],.03)
 # Partial original-perimeter facades: two selected street fronts, open window bays.
 for poly in E.polygons(P):
  q=list(poly.exterior.coords)
  for A,B in zip(q,q[1:]):
   length=math.dist(A,B)
   if length<5:continue
   mid=((A[0]+B[0])/2,(A[1]+B[1])/2);dx=B[0]-A[0];dz=B[1]-A[1];side=('E' if mid[0]>(x0+x1)/2 else 'W') if abs(dz)>abs(dx) else ('N' if mid[1]>(z0+z1)/2 else 'S')
   if side not in facades:continue
   ux,uz=dx/length,dz/length
   for u in np.arange(1.0,length-1,6.0):
    x,z=A[0]+ux*u,A[1]+uz*u
    for level in range(M['stories']+1):
     if level==M['stories'] and LineString([(x-ux*.6,z-uz*.6),(x+ux*4.9,z+uz*4.9)]).buffer(.2).intersects(box(pipeX-3.2,pipeZ-17,pipeX+3.2,pipeZ+17)):continue
     y0=level*4.2+(.19 if level else 0);h=3.2 if level==M['stories'] else 3.8
     seg('concrete',(x-ux*.6,z-uz*.6),(x+ux*.6,z+uz*.6),y0+h/2,h,.32,'wall')
     if int(u)%3!=0:seg('concrete',(x,z),(x+ux*4.9,z+uz*4.9),y0+h-.26,.52,.32,'wall')
 # Curated column-form sets rise from the actual continuous stems.
 form_columns=[c for c in columns if c[2]>T+1 and floors[-1].distance(Point(c[0],c[1]))<3]
 for x,z,h in form_columns[::max(1,len(form_columns)//8)][:8]:
  for dx,dz,xx,zz in [(-.39,0,.045,.44),(.39,0,.045,.44),(0,-.39,.44,.045),(0,.39,.44,.045)]:cub('timber',x+dx,T+1.2,z+dz,xx,1.13,zz,solid=False)
  for H in [.35,1.1,1.9,2.5]:cub('steel',x,T+H,z,.46,.03,.46,solid=False)
 # Closed exact cut datum, not a substitute rectangular roof.
 parts.append(dict(shape='footprint',mat='concrete',label='Exact original cut datum',positions=E.extrude(P,-.38,0)))
 oldsol=old['model']['solids'];ids=M['pipeSolids'];kept=[i for i,v in enumerate(oldsol) if i in ids or(v['mat']=='orange' and v['y']>T+1)];remap={i:len(solids)+j for j,i in enumerate(kept)};solids.extend(copy.deepcopy(oldsol[i]) for i in kept)
 for v in old['model']['parts']:
  keep=v['shape']=='pipe' or(v['shape']=='ring' and abs(v['x']-pipeX)<.02) or(v['shape']=='box' and v['mat']=='orange' and v['y']>T+1)
  if v['shape']=='beam':keep=v['a'][1]>T+1 and v['b'][1]>T+1 and abs(v['a'][0]-pipeX)<2 and abs(v['b'][0]-pipeX)<2
  if keep:parts.append(copy.deepcopy(v))
 # Explicit safe starting and ending surfaces are picked within this floor geometry.
 oldstart=[2.5+(M['hx']-2.5)/2,.025,-M['hz']+2]
 def landing(poly,surface,preferred):
  options=[preferred]+[(float(x),float(z)) for x in np.arange(x0+2,x1-2,2.5) for z in np.arange(z0+2,z1-2,2.5)]
  for x,z in options:
   if poly.covers(box(x-.65,z-.65,x+.65,z+.65)) and safe_body(solids,x,surface+1,z):return[x,surface,z]
  raise Exception('No clear landing '+str(bid))
 start=landing(P,.025,(oldstart[0],oldstart[2]));finish=landing(floors[0],4.39,(pipeX+4,3))
 # Staging rectangles are independently named and keep the pipe corridor clear.
 staging=[]
 for x in np.arange(x0+3,x1-3,5.5):
  for z in np.arange(z0+3,z1-3,5.5):
   if len(staging)>=14:break
   if abs(x-pipeX)<3.2 and abs(z-pipeZ)<17:continue
   zone=box(x-1.8,z-1.25,x+1.8,z+1.25)
   if floors[-1].covers(zone) and not core_outer.buffer(1).intersects(zone) and safe_body(solids,x,T+1.9,z):staging.append(dict(id=f'{name.lower().replace(" ","-")}-crown-stock-{len(staging)+1}',x=float(x),z=float(z),y=T+.19,hx=1.8,hz=1.25))
 M.update(parts=parts,solids=solids,tower=None,legs=[],pipeSolids=[remap[i] for i in ids],bounds=dict(minX=x0,minZ=z0,maxX=x1,maxZ=z1,centerX=(x0+x1)/2,centerZ=(z0+z1)/2),hx=(x1-x0)/2,hz=(z1-z0)/2,start=start,craneLocal=[-old['model']['hx']-3,-old['model']['hz']+3],finish=finish,floorRegions=regions,floorPolygons=[dict(area=g.area) for g in floors],decks=[],stagingZones=staging,details=[],authoredBuilding=bid)
 return dict(index=p['variant'],id=p['id'],bid=bid,name=name,designNotes=f'Exact {round(P.area)}m2 source footprint; independently placed {len(cores)} shear cores, {facades} incomplete street facades, stepped courtyard plates, {round(floors[-1].area/P.area*100)}% poured crown, timber centering and rising formwork.',model=M)

if __name__=='__main__':
 sites=[json.loads((R/'evidence/construction/structural_proof_117.json').read_text())]
 limit=int(sys.argv[1]) if len(sys.argv)>1 else 20
 for p in E.manifest[1:limit]:
  q=build(p);sites.append(q);print(q['bid'],q['name'],'parts',len(q['model']['parts']),'colliders',len(q['model']['solids']),'staging',len(q['model']['stagingZones']))
 (R/'evidence/construction/structural_blueprints_20.json').write_text(json.dumps(dict(version=4,authoring='Exact original cut footprints with individual architectural briefs',sites=sites),separators=(',',':')))
 print('EXPORTED',len(sites))
