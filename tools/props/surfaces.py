"""Small authored material tiles. Deterministic; no runtime canvas work or per-frame noise."""
from PIL import Image,ImageDraw,ImageFilter,ImageFont
import numpy as np,os,json,io,base64
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.abspath(os.environ.get('TL_BUILD_DIR') or ROOT+'/build');rng=np.random.default_rng(1842)
jp=OUT+'/props_tex.json';tex=json.load(open(jp)) if os.path.exists(jp) else {}
for name in ['galvanized','paint','wood','brick','tar']:
 n=512;y,x=np.mgrid[:n,:n];grain=rng.normal(0,1,(n,n));low=np.array(Image.fromarray(np.uint8(rng.random((32,32))*255)).resize((n,n),Image.Resampling.BICUBIC))/255
 if name=='wood':
  v=.69+.16*np.sin(x*.38+np.sin(y*.014)*1.5+np.sin(y*.043)*.8)+grain*.025+low*.13
  v*=np.where((x%64)<3,.36,1);base=np.array([131,105,76]);rough=.93
 elif name=='brick':
  seam=((y%48)<4)|(((x+((y//48)%2)*48)%96)<4);v=.7+low*.32+grain*.025;base=np.array([154,88,62]);v=np.where(seam,1.05,v);rough=.94
 elif name=='tar':v=.48+low*.45+grain*.1;base=np.array([75,77,76]);rough=.97
 else:
  v=.72+low*.26+grain*.018;base=np.array([179,181,172] if name=='galvanized' else [160,164,156]);rough=.65
 arr=np.clip(v[:,:,None]*base,0,255).astype('uint8');im=Image.fromarray(arr);d=ImageDraw.Draw(im)
 if name in ['paint','galvanized']:
  for i in range(280):
   xx=int(rng.integers(n));yy=int(rng.integers(n));d.line((xx,yy,xx+int(rng.integers(2,15)),yy+1),fill=(105,95,79),width=1)
  if name=='paint':
   d.rectangle((8,8,503,503),outline=(88,91,86),width=3)
   for xx in [18,493]:
    for yy in [18,493]:d.ellipse((xx-4,yy-4,xx+4,yy+4),fill=(74,76,72));d.line((xx-2,yy,xx+2,yy),fill=(173,179,179),width=1)
   for yy in range(330,443,8):d.line((105,yy,408,yy),fill=(75,78,74),width=3)
   d.rectangle((331,49,465,96),fill=(219,201,138));d.text((340,60),'CAUTION',fill=(37,35,28));d.text((340,77),'SERVICE PANEL',fill=(37,35,28))
 im.save(OUT+'/props_tex/surface_'+name+'.png');b=io.BytesIO();im.save(b,format='WEBP',quality=87,method=6);tex['surface_'+name]=base64.b64encode(b.getvalue()).decode()
 # Small height detail becomes a tangent normal. Avoid broad displacement of silhouette.
 h=np.asarray(im.convert('L'),dtype=float)/255;dy,dx=np.gradient(h);normal=np.stack([-dx*1.4,dy*1.4,np.ones_like(h)],2);normal/=np.linalg.norm(normal,axis=2)[:,:,None];nm=Image.fromarray(np.uint8(np.clip(normal*.5+.5,0,1)*255));b=io.BytesIO();nm.save(b,format='WEBP',lossless=True);tex['surface_'+name+'_n']=base64.b64encode(b.getvalue()).decode()
for k,title,col in [('city','CITY',(49,83,109)),('sport','MOTION',(168,61,42)),('style','STYLE',(100,61,105)),('news','DAILY',(197,184,153))]:
 im=Image.new('RGB',(256,384),col);d=ImageDraw.Draw(im);font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',45);small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16);d.text((12,9),title,font=font,fill=(239,233,213));d.text((14,65),'NEW YORK / OCTOBER',font=small,fill=(241,231,209))
 for i in range(8):
  xx=i*33;hh=80+(i*47)%125;d.rectangle((xx,300-hh,xx+25,300),fill=(25+i*8,37+i*7,53+i*6))
  for yy in range(310-hh,285,17):d.rectangle((xx+6,yy,xx+12,yy+7),fill=(195,177,112))
 d.text((14,318),'THE CITY AFTER DARK',font=small,fill=(249,243,233));d.text((14,344),'Culture  /  Life  /  People',font=small,fill=(239,233,223));im.save(OUT+'/props_tex/mag_'+k+'.png')
json.dump(tex,open(jp,'w'),separators=(',',':'));print('Surface textures added',len(tex))
