import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]
sites=json.loads((root/'evidence/construction/footprints_exact.json').read_text())['sites']
if '--top' in sys.argv:
 for q in json.loads((root/'evidence/construction/structural_blueprints_20.json').read_text())['sites']:
  s=next(s for s in sites if s['bid']==q['bid']);s['loops']=q['model']['floorRegions'][-1]['polygons']
im=Image.new('RGB',(1500,1200),'#171c24');d=ImageDraw.Draw(im)
for i,s in enumerate(sites):
 x0,z0,x1,z1=s['bounds']; scale=min(260/(x1-x0),190/(z1-z0));ox=(i%5)*300+150-(x0+x1)*scale/2;oy=(i//5)*300+150-(z0+z1)*scale/2
 for loop in s['loops']:
  d.polygon([(ox+x*scale,oy+z*scale)for x,z in loop['outer']],fill='#3f5564',outline='#a3cdda')
  for hole in loop['holes']:d.polygon([(ox+x*scale,oy+z*scale)for x,z in hole],fill='#171c24')
 for x in range(int(x0)//10*10,int(x1)+1,10):
  for z in range(int(z0)//10*10,int(z1)+1,10):d.text((ox+x*scale,oy+z*scale),f'{x},{z}',fill='#fff1b0',anchor='mm')
 d.text(((i%5)*300+12,(i//5)*300+8),f"{i}: building {s['bid']}",fill='white')
im.save(root/('evidence/construction/working_floors_grid.png'if '--top'in sys.argv else'evidence/construction/footprints_grid.png'))
