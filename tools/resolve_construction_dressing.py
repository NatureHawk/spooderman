import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'tools'))
from validate_construction_dressing import valid
from detail_parts import make_detail
models=json.loads((root/'evidence/construction/structural_blueprints_20.json').read_text())['sites']
errors=[];sites=[]
# Authored arrangements follow each crown's remaining poured areas, leaving
# open courts and hoist openings unobstructed. Each coordinate is intentional.
layouts={
147:[('P',-28,25),('W',-22,25),('B',-22,30),('R',-16,25),('P',-16,36),('C',-11,25),('B',-11,30),('W',-16,9)],
130:[('P',60,-12),('P',66,-12),('W',68,-18),('R',57,-18),('B',-6,21),('B',0,21),('C',5,16),('R',16,21)],
169:[('P',7,-18),('W',13,-18),('R',13,-12),('B',13,-7),('C',13,-2),('P',13,4),('B',7,25),('W',13,25)],
499:[('P',-6,15),('B',-1,16),('C',5,16),('W',7,10),('R',7,-12,1.5708),('P',7,-17),('B',7,-5),('C',12,0)],
173:[('P',-35,12),('W',-30,13),('R',-30,18),('B',-35,2),('P',-25,-9),('B',-30,-9),('C',22,-10),('R',16,-10)],
598:[('P',-15,38),('W',-20,38),('R',-9,44),('B',-9,50),('C',-9,55),('P',-4,-50),('W',-9,-27),('B',-9,-22)],
212:[('P',24,-20),('W',24,-26),('R',18,-30),('C',18,-35),('B',-21,-7),('B',-21,3),('P',-15,-2),('W',-15,8)],
205:[('P',-40,-17),('W',-35,-17),('R',-29,-17),('C',-40,-7),('B',-40,15),('B',-35,15),('P',28,-17),('R',34,-17)],
92:[('P',-9,-6),('W',-5,-6),('B',-4,-1),('C',-5,4),('R',-5,10,1.5708),('P',6,-11),('B',8,-7),('C',5,-4)],
178:[('P',-8,-43),('W',-4,-43),('R',-8,-36),('B',-3,-36),('C',-12,-26),('P',-18,-25),('B',-10,10),('W',-16,10)],
697:[('P',-32,16),('P',-27,16),('W',-32,21),('R',-25,24),('B',-21,-5),('B',-27,-5),('C',-30,-10),('R',-35,-10)],
418:[('P',-16,-5),('W',-11,-5),('B',-16,4),('C',-12,4),('R',-3,-8),('P',-3,8),('B',2,-8),('C',1,8)],
127:[('P',-23,-18),('P',-18,-18),('W',-24,5),('C',-18,5),('R',19,-16),('R',24,-12),('B',14,-16),('P',23,-6)],
228:[('P',21,-28),('W',25,-27),('R',20,-34),('C',14,-33),('P',-34,4),('P',-29,4),('B',-34,9),('B',-23,9)],
425:[('P',21,-18),('W',21,-24),('R',20,-12,1.5708),('C',19,-5),('P',-15,14),('B',-9,15),('B',21,15),('R',14,15)],
472:[('P',-35,20),('P',-30,20),('W',-35,26),('B',-30,26),('C',-25,26),('R',29,20),('R',35,20),('B',34,26),('P',29,26)],
242:[('P',29,-27),('W',36,-27),('R',43,-27),('C',58,-24),('P',28,15),('P',35,15),('B',56,14),('R',63,14)],
124:[('P',-47,-17),('P',-42,-17),('W',-44,-10),('B',-47,-5),('C',-41,-5),('R',-41,22),('R',-35,25),('B',-38,16)],
118:[('P',-30,17),('P',-24,17),('W',-18,17),('R',-31,21),('C',-25,21),('P',2,29),('B',2,36),('R',2,41)],
}
kind={'P':'pallet_bundle','W':'panel_rack','R':'rebar_bundle','B':'cement_bags','C':'cable_coil'}
# Survey review corrections: move individual groups away from exact slab voids,
# perimeter columns and panel-wall ends, without changing their work-zone role.
corrections={130:{0:(62,-12)},169:{0:(7.2662,-18.8382),6:(5,25),7:(12.7662,25.1618)},499:{1:(-3,16)},205:{6:(26,-17)},92:{2:(-6,-3),3:(-5,2),4:(-9,8),6:(8,-9)},178:{2:(-8,-38)},697:{4:(-23,-5)},418:{4:(7,-8),5:(-7,6),6:(6,-10),7:(5,2)},127:{2:(-24,3),3:(-18,3),7:(23,-8)},228:{1:(23,-25)},425:{0:(19,-14),1:(19,-24),2:(20,-10)},472:{5:(25,20),6:(35,16)},242:{6:(52,14),7:(63,8)},124:{5:(-41,20)},118:{0:(-32,15),1:(-24,23),2:(-18,23),3:(-33,21),4:(-27,23)}}
for bid,edits in corrections.items():
 for i,(x,z)in edits.items():a=layouts[bid][i];layouts[bid][i]=(a[0],x,z,*a[3:])
for site in models:
 m=site['model'];tags=[]
 if site['bid']==117:tags=m['details']
 else:tags=[dict(kind=kind[a[0]],id=site['id']+'-working-stock-'+str(i+1),x=a[1],y=0,z=a[2],yaw=a[3]if len(a)>3 else 0)for i,a in enumerate(layouts[site['bid']])]
 occupied=[]
 for tag in tags:
  tag['y']=m['floorRegions'][-1]['surface']
  problem=valid(m,tag,occupied)
  if problem:
   errors.append((site['bid'],tag['id'],tag['kind'],tag['x'],tag['z'],problem))
   if '--suggest' in sys.argv:
    candidates=[(tag['x']+dx,tag['z']+dz)for dx in range(-12,13,2)for dz in range(-12,13,2)]+[(z['x'],z['z'])for z in m.get('stagingZones',[])]
    candidates.sort(key=lambda p:(p[0]-tag['x'])**2+(p[1]-tag['z'])**2)
    for x,z in candidates:
     attempt=dict(tag,x=x,z=z)
     if not valid(m,attempt,occupied):print('SUGGEST',site['bid'],tag['id'],round(x,3),round(z,3));tag=attempt;break
  occupied.extend(make_detail(tag)['solids'])
 sites.append(dict(bid=site['bid'],id=site['id'],details=tags))
print(json.dumps(errors,indent=2))
if not errors:
 out=dict(version=1,status='validated',note='Individually planned top working-floor stock; actual expanded solids supported and clear of architecture.',sites=sites)
 (root/'evidence/construction/dressing_20.json').write_text(json.dumps(out,indent=2))
 print('PASS',sum(len(s['details'])for s in sites),'visible working-floor stock groups')
