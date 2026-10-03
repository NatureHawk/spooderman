"""Named, individually laid-out work zones on the surveyed building footprints.
No random placement: each row is an authored site plan, in local X/Z metres.
"""
import json, math
from pathlib import Path
from shapely.geometry import Polygon, box
from shapely.affinity import rotate, translate
root=Path(__file__).resolve().parents[1]
survey=json.loads((root/'evidence/construction/footprints_exact.json').read_text())['sites']
# Each zone explicitly specifies its intended stocks, position and orientation.
# P=pallet stack, W=leaning formwork panels, R=steel stock, B=cement, C=cable.
plans=[
 [('east-hoist','PPWB',26,18,0),('west-casting','RBCP',-19,-15,0)],
 [('north-formwork','PWCB',-2,-9,.55),('south-concrete','PBRP',-17,24,.55)],
 [('long-east-loading','PPWR',66,14,0),('west-pour-stock','BBCR',-3,-16,0)],
 [('south-deck-stock','PPBC',6,21,0),('north-wall-forms','WRBP',1,-14,0)],
 [('south-materials','PPBC',0,12,0),('north-shuttering','WRB',0,-12,0)],
 [('west-service-bay','PWRC',-27,10,0),('east-casting-bay','PPBB',20,10,0),('north-steel','RP',2,-10,0)],
 [('north-spine-stock','PWBC',-6,-39,0),('south-spine-stock','PRBC',-6,41,0)],
 [('east-hoist-landing','PPWC',23,-18,.3),('south-pour-zone','BRBP',7,11,.3)],
 [('north-west-formwork','PWRP',-33,-17,0),('south-east-materials','PBBC',28,14,0)],
 [('west-formwork','PWBC',-8,-4,.4),('east-pour-stock','PRB',7,5,.4)],
 [('north-return-loading','PPWR',-6,-41,0),('south-narrow-bay','BBCP',-6,4,0)],
 [('west-hoist-yard','PPPWR',-29,18,0),('east-casting-yard','BBRCP',37,-31,0)],
 [('west-service-niche','PWBC',-14,0,0),('east-pour-stock','PRBP',5,4,0)],
 [('west-timber-staging','PPWC',-21,-13,0),('east-rebar-staging','RRBP',20,2,0)],
 [('north-angled-wall','PWRC',12,-26,.2),('south-delivery-bay','PPBB',-32,7,.2)],
 [('north-formwork-yard','PPWR',-6,-21,-.1),('east-concrete-bay','PBBC',21,9,0)],
 [('west-wide-bay','PPWBC',-32,21,0),('east-services-bay','PRRBC',32,-1,0)],
 [('west-block-pour','PWBCR',4,5,0),('east-wing-storage','PPBR',58,-16,0)],
 [('north-west-casting','PPWBC',-47,-15,0),('south-long-stock','RRBP',-18,47,0)],
 [('west-long-wing','PPWRC',-65,33,0),('east-return-stock','PBBR',2,31,0)],
]
kind={'P':'pallet_bundle','W':'panel_rack','R':'rebar_bundle','B':'cement_bags','C':'cable_coil'}
extent={'P':(1.2,.65),'W':(1.27,.98),'R':(2.3,.35),'B':(1.15,.61),'C':(.82,.82)}
sites=[];errors=[]
for s,zones in zip(survey,plans):
 polygons=[Polygon(p['outer'],p['holes'])for p in s['loops']]; tags=[]
 for name,stocks,x,z,yaw in zones:
  # A named zone's stocks occupy two deliberate rows, leaving a 2m aisle.
  for j,ch in enumerate(stocks):
   dx=(-2.3 if j%2==0 else 2.3);dz=(j//2)*3.1-1.55
   X=x+math.cos(yaw)*dx+math.sin(yaw)*dz;Z=z-math.sin(yaw)*dx+math.cos(yaw)*dz
   tag=dict(kind=kind[ch],id=f'{name}-{j+1}',x=round(X,3),y=0,z=round(Z,3),yaw=yaw)
   hx,hz=extent[ch]; footprint=translate(rotate(box(-hx,-hz,hx,hz),-math.degrees(yaw),origin=(0,0)),X,Z)
   if not any(p.buffer(-.25).covers(footprint)for p in polygons): errors.append((s['index'],s['bid'],tag))
   tags.append(tag)
  
 sites.append(dict(index=s['index'],bid=s['bid'],id=f"construction-{s['index']}",details=tags))
if errors:
 print(json.dumps(errors,indent=2));raise SystemExit('Authored stock footprint outside support: revise the named zone')
out=dict(version=1,status='placement_proposal_do_not_export',note='Named XY staging proposals pending highest-working-floor selection and final architecture clearance. y=0 is provisional. Detailed mesh/collider expansion uses tools/blender/detail_parts.py.',sites=sites)
(root/'evidence/construction/dressing_proposals_20.json').write_text(json.dumps(out,indent=2))
print('PASS',len(sites),'individually planned sites;',sum(len(s['details'])for s in sites),'supported stock props')
