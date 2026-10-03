"""Refresh specified structural recipes while preserving reviewed expanded stock assets."""
import json,sys
from pathlib import Path
import author_construction_remaining as A
path=A.R/'evidence/construction/structural_blueprints_20.json'
data=json.loads(path.read_text());bids={int(v)for v in sys.argv[1:]}
for i,old in enumerate(data['sites']):
 if old['bid']not in bids:continue
 new=A.build(next(p for p in A.E.manifest if p['roofBid']==old['bid']))
 new['model']['details']=old['model'].get('details',[])
 for key in ['parts','solids']:new['model'][key].extend(p for p in old['model'][key]if p.get('detailId'))
 data['sites'][i]=new
 print('Refreshed',old['bid'],'crown',round(old['model']['floorPolygons'][-1]['area']), '->',round(new['model']['floorPolygons'][-1]['area']))
path.write_text(json.dumps(data,separators=(',',':')))
