from pathlib import Path
import importlib.util,json,struct,math
root=Path(__file__).resolve().parents[1];spec=importlib.util.spec_from_file_location('audit',root/'tools/audit_repair_facades.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
data=json.loads((root/'evidence/construction/facade_repairs.json').read_text());source=json.loads((root/'build/nyc.json').read_text());binary=(root/'build/nyc.bin').read_bytes();lookup={b['id']:b for b in source['buildings']};summary=[];preview=[]
assert len(data['buildings'])==40 and len({b['bid'] for b in data['buildings']})==40
for row in data['buildings']:
 b=lookup[row['bid']];original=list(struct.unpack_from('<%sf'%(b['n']*9),binary,b['o']));after=a.analyse(b,original+row['positions'],row['cutY']);assert after['missingArea']<.001,(row['bid'],after['missingArea'])
 assert len(row['positions'])//9==len(row['donorTriangles'])
 for i in range(0,len(row['positions']),9):
  t=[row['positions'][i+j:i+j+3] for j in (0,3,6)];u=[t[1][j]-t[0][j] for j in range(3)];v=[t[2][j]-t[0][j] for j in range(3)];n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];length=math.sqrt(sum(x*x for x in n));assert length>1e-8;n=[x/length for x in n];assert abs(n[1])<1e-6
  midpoint=[sum(p[j] for p in t)/3 for j in range(3)]
  matches=[e for e in row['segments'] if e['bottom']-.001<=midpoint[1]<=e['top']+.001 and abs((midpoint[0]-e['a'][0])*e['normal'][0]+(midpoint[2]-e['a'][1])*e['normal'][2])<.001]
  assert any(sum(n[j]*e['normal'][j] for j in range(3))>.99999 for e in matches),'Wrong outward normal'
  if row['construction']:assert max(p[1] for p in t)<=row['cutY']+.002,'Closes intentional unfinished structure'
 summary.append({'bid':row['bid'],'construction':row['construction'],'repairedArea':row['missingArea'],'residualMissingArea':after['missingArea'],'triangles':len(row['positions'])//9,'profiles':len(row['profiles'])})
 # Clip visible original triangles at the same construction cut used by the game.
 shown=[]
 for i in range(0,len(original),9):
  poly=[original[i+j:i+j+3] for j in (0,3,6)]
  if row['construction']:
   out=[];cut=row['cutY']
   for p,q in zip(poly,poly[1:]+poly[:1]):
    if p[1]<=cut:out.append(p)
    if (p[1]<=cut)!=(q[1]<=cut):
     t=(cut-p[1])/(q[1]-p[1]);out.append([p[j]+(q[j]-p[j])*t for j in range(3)])
   poly=out
  for k in range(1,len(poly)-1):shown.extend(poly[0]+poly[k]+poly[k+1])
 preview.append({'bid':row['bid'],'construction':row['construction'],'original':shown,'repairs':row['positions'],'area':row['missingArea']})
(root/'evidence/construction/facade_audit_metrics.json').write_text(json.dumps(summary,indent=2));(root/'evidence/construction/facade_preview.json').write_text(json.dumps(preview,separators=(',',':')))
print('PASS40 exact roof-profile exterior audits, post-repair0 missing area, outward normals, original data preserved, upper construction openings untouched')
