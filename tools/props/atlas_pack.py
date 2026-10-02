"""Pack diffuse material islands into one atlas/draw per resident. Run after people_export.py."""
import os,json,math,struct,base64,io
from PIL import Image,ImageChops
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.abspath(os.environ.get('TL_BUILD_DIR') or ROOT+'/build')
for pack in ['people','props']:
 jp=OUT+'/'+pack+'.json'
 if not os.path.exists(jp):continue
 man=json.load(open(jp));buf=bytearray(open(OUT+'/'+pack+'.bin','rb').read());textures=json.load(open(OUT+'/'+pack+'_tex.json')) if os.path.exists(OUT+'/'+pack+'_tex.json') else {};cache={};processed={};serial=max([int(k.rsplit('_',1)[-1]) for k in textures if k.startswith(pack+'_atlas_') and k.rsplit('_',1)[-1].isdigit()]+[-1])+1
 if all(e.get('tex') and e['tex'][0].get('atlas') for lods in man['assets'].values() for e in lods.values()):print(pack,'already packed');continue
 for name,lods in man['assets'].items():
  for lod,e in lods.items():
   signature=(e['pos'],e.get('uv'))
   if signature in processed:
    e.update(processed[signature]);continue
   specs=e.get('tex',[])
   if not specs or (len(specs)==1 and specs[0].get('atlas')):continue
   key=json.dumps(specs,sort_keys=True)
   if key not in cache:
    cols=math.ceil(math.sqrt(len(specs)));size=1024;cell=size//cols;atlas=Image.new('RGBA',(size,size),(128,128,128,255));orm=Image.new('RGB',(size,size),(255,200,0))
    for i,spec in enumerate(specs):
     file=OUT+'/props_tex/'+spec.get('d','')+'.png'
     color=tuple(round(min(1,max(0,c))*255) for c in spec.get('c',[.65,.65,.65]))+(255,)
     im=Image.open(file).convert('RGBA') if os.path.exists(file) else Image.new('RGBA',(8,8),color)
     if 'tint' in spec:im=ImageChops.multiply(im,Image.new('RGBA',im.size,tuple(round(min(1,c*1.45)*255) for c in spec['tint'])+(255,)))
     im=im.resize((cell-8,cell-8),Image.Resampling.LANCZOS);x=(i%cols)*cell;y=(i//cols)*cell
     atlas.paste(im,(x+4,y+4));atlas.paste(im.crop((0,0,1,im.height)).resize((4,im.height)),(x,y+4));atlas.paste(im.crop((im.width-1,0,im.width,im.height)).resize((4,im.height)),(x+cell-4,y+4));atlas.paste(atlas.crop((x,y+4,x+cell,y+5)).resize((cell,4)),(x,y));atlas.paste(atlas.crop((x,y+cell-5,x+cell,y+cell-4)).resize((cell,4)),(x,y+cell-4))
     orm.paste((255,round(spec.get('rough',.78)*255),round(spec.get('metal',0)*255)),(x,y,x+cell,y+cell))
    texname=pack+'_atlas_'+str(serial+len(cache));out=io.BytesIO();atlas.save(out,format='WEBP',quality=88,method=6);textures[texname]=base64.b64encode(out.getvalue()).decode();ormout=io.BytesIO();orm.save(ormout,format='WEBP',lossless=True);textures[texname+'_orm']=base64.b64encode(ormout.getvalue()).decode();cache[key]=(texname,cols,cell,size)
   texname,cols,cell,size=cache[key]
   for i in range(e['vc']):
    mi=buf[e['mat']+i];u,v=struct.unpack_from('<2f',buf,e['uv']+i*8)
    # Image atlas uses top-down rows; UVs are bottom-up.
    u=((mi%cols)*cell+4+(u%1.000001)*(cell-8))/size;v=1-((mi//cols)*cell+4+(1-v%1.000001)*(cell-8))/size
    struct.pack_into('<2f',buf,e['uv']+i*8,u,v);buf[e['mat']+i]=0
   e['tex']=[{'d':texname,'o':texname+'_orm','rough':1,'metal':1,'a':.3,'atlas':True}];e['pal']=[[1,1,1,0,0,.78,0]];e['groups']=[[0,e['ic'],0]];processed[signature]={k:e[k] for k in ['tex','pal','groups']}
 open(OUT+'/'+pack+'.bin','wb').write(buf);json.dump(man,open(jp,'w'),separators=(',',':'));json.dump({k:v for k,v in textures.items() if k in {s.get(k) for vv in man['assets'].values() for e in vv.values() for s in e.get('tex',[]) for k in ['d','n','o','e']}},open(OUT+'/'+pack+'_tex.json','w'),separators=(',',':'))
 print(pack,len(cache),'atlases',sum(len(v)*3//4 for v in textures.values()),'compressed texture bytes')
