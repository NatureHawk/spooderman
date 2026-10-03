import importlib.util, json, math, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('detail_parts',root/'tools/blender/detail_parts.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
tags=[dict(kind=k,id=k,x=(i%3)*5,y=0,z=(i//3)*5,yaw=0) for i,k in enumerate(m.BUILDERS)]
model={'parts':[],'solids':[],'details':tags};m.expand_details(model)
original=json.dumps(model,sort_keys=True);m.expand_details(model);assert original==json.dumps(model,sort_keys=True),'Repeated Blender exports cannot duplicate details'
for tag in tags:
 p=[p for p in model['parts'] if p['detailId']==tag['id']];s=[p for p in model['solids'] if p['detailId']==tag['id']]
 assert len(p)>20 and s,'Props must retain visible separate pieces and real collision bounds'
 for yaw in (0,.63,math.pi/2):
  data=m.make_detail(dict(tag,yaw=yaw))
  for p in data['parts']:
   vals=p.get('positions',p.get('a',[])+p.get('b',[]))
   assert all(math.isfinite(v) for v in vals)
   if p['shape']=='footprint':assert len(vals)%9==0
  for p in data['solids']:assert all(p[k]>0 for k in ('hx','hy','hz'))
assert any(p.get('detailPart')=='exposed nail head' for p in model['parts'])
assert any(p.get('detailPart')=='separate leaning wall panel' and p['shape']=='footprint' for p in model['parts'])
assert sum(p.get('detailPart')=='individual cement sack' for p in model['parts'])==18
out=root/'evidence/construction';out.mkdir(exist_ok=True,parents=True);(out/'detail_preview.json').write_text(json.dumps(model),encoding='utf8')
print('PASS five distinct detailed props, three orientations, real collision bounds, explicit placement, idempotent expansion')
