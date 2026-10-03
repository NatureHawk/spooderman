"""Exact architectural floor regression: footprint, holes, mesh/collision alignment."""
import json, math
from pathlib import Path
from shapely.geometry import Polygon,box
from shapely.ops import unary_union
R=Path(__file__).resolve().parents[1]
sites=json.loads((R/'evidence/construction/structural_blueprints_20.json').read_text())['sites']
footprints={s['bid']:s for s in json.loads((R/'evidence/construction/footprints_exact.json').read_text())['sites']}
assert len(sites)==20 and len({s['bid'] for s in sites})==20
count=0;holes=0
for site in sites:
 m=site['model'];src=footprints[site['bid']];P=unary_union([Polygon(p['outer'],p['holes']) for p in src['loops']])
 assert m['tower'] is None and not m['legs'], 'Tank must be on a finished neighboring roof'
 assert all(0<=i<len(m['solids']) and m['solids'][i]['kind']=='pipe' for i in m['pipeSolids'])
 caps=[p for p in m['parts'] if p.get('shape')=='footprint' and p.get('positions') and abs(max(p['positions'][1::3]))<.00001 and abs(min(p['positions'][1::3])+.38)<.00001]
 assert len(caps)==1
 floorparts=[p for p in m['parts'] if 'floor ' in p.get('label','').lower()]
 assert len(floorparts)==len(m['floorRegions'])
 for region,part in zip(m['floorRegions'],floorparts):
  floor=unary_union([Polygon(p['outer'],p['holes']) for p in region['polygons']]);holes+=sum(len(p['holes']) for p in region['polygons'])
  assert floor.difference(P.buffer(.0001)).area<.0001
  area=0.;v=part['positions'];top=region['surface']
  for k in range(0,len(v),9):
   a,b,c=[v[k+j:k+j+3] for j in (0,3,6)]
   if max(abs(p[1]-top) for p in (a,b,c))<.00002:
    triangle=Polygon([(p[0],p[2]) for p in (a,b,c)])
    area+=triangle.area
    assert triangle.difference(floor.buffer(.0001)).area<.0001
  assert abs(area-floor.area)<.005,(site['bid'],area,floor.area)
  for index in region['colliderIndices']:
   b=m['solids'][index];rect=box(b['x']-b['hx'],b['z']-b['hz'],b['x']+b['hx'],b['z']+b['hz'])
   assert rect.difference(floor.buffer(.00002)).area<1e-7,(site['bid'],index,'collider bridges courtyard')
   assert abs(b['y']+b['hy']-top)<.00001
   count+=1
 caparea=0.;v=caps[0]['positions']
 for k in range(0,len(v),9):
  q=[v[k+j:k+j+3] for j in (0,3,6)]
  if all(abs(p[1])<.00001 for p in q):caparea+=Polygon([(p[0],p[2]) for p in q]).area
 assert abs(caparea-P.area)<.005,(site['bid'],'cut cap mismatches original outline')
 assert m['floorPolygons'][-1]['area'] <P.area*.90, 'Highest floor must read as incomplete'
print(f'PASS 20 exact cut caps, {count} contained floor colliders, {holes} preserved floor openings, triangulated mesh areas, pipe indices and no worksite tanks')

