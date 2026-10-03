"""Validate actual prop solids against poured floors and authored architecture."""
import json, sys, math
from pathlib import Path
from shapely.geometry import Polygon,box
from shapely.affinity import rotate,translate
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'tools/blender'))
from detail_parts import make_detail
def footprint(b):
 return translate(rotate(box(-b['hx'], -b['hz'], b['hx'], b['hz']),-math.degrees(b.get('yaw',0)),origin=(0,0)),b['x'],b['z'])
def valid(model,tag,occupied=()):
 built=make_detail(tag);solids=built['solids'];y=tag['y']
 region=next((r for r in model['floorRegions']if abs(r['surface']-y)<.001),None)
 if not region:return 'no floor at proposed height'
 floor=[Polygon(p['outer'],p['holes'])for p in region['polygons']]
 for b in solids:
  fp=footprint(b)
  if not any(p.buffer(-.025).covers(fp)for p in floor):return 'stock extends over floor edge or opening'
  for a in [s for s in model['solids']if not s.get('detailId')]+list(occupied):
   if a['y']+a['hy']<=b['y']-b['hy']+.025 or a['y']-a['hy']>=b['y']+b['hy']-.025:continue
   if fp.intersection(footprint(a)).area>.003:return 'intersects '+str(a.get('detailId')or a.get('kind'))
 return None
def check(site):
 model=site['model'];occupied=[];errors=[]
 for tag in model.get('details',[]):
  problem=valid(model,tag,occupied)
  if problem:errors.append((site['bid'],tag['id'],problem))
  occupied.extend(make_detail(tag)['solids'])
 return errors
if __name__=='__main__':
 data=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'));sites=data.get('sites',[data]);errors=[e for s in sites for e in check(s)]
 print(json.dumps(errors,indent=2)if errors else f'PASS {len(sites)} sites: all detailed stock props supported and clear of architecture')
 sys.exit(bool(errors))
