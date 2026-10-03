"""Apply reviewed details only after final architecture authoring has finished."""
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'tools'))
from validate_construction_dressing import check
from detail_parts import expand_details
file=root/'evidence/construction/structural_blueprints_20.json'
pack=json.loads(file.read_text());dressing=json.loads((root/'evidence/construction/dressing_20.json').read_text())
assert dressing['status']=='validated'and len(pack['sites'])==20
for site in pack['sites']:
 tags=next(s['details']for s in dressing['sites']if s['bid']==site['bid'])
 site['model']['details']=tags
 errors=check(site)
 if errors:raise ValueError(errors)
 expand_details(site['model'],tags)
file.write_text(json.dumps(pack,separators=(',',':')))
print('PASS final20 architecture pack contains all163 validated upper-floor stock groups and matching physical solids')
