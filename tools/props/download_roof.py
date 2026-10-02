import bpy,sys,requests,json,os,zipfile,io
root=r'C:/Users/PRIYANSHU/Pictures/spooderman_props/source/props_external'
s=sys.modules['blender_mcp'].BlenderMCPServer(); key=s._get_sketchfab_api_key()
ids=['ce4de11b50164c3abf65de2d6c51b872','35c02eee93ea4a2f80af8acb84351d8c','56c63eb16e5b479883cf3189932b38c9','6dfa32e7ec614362a29fd950b87212ca']
for uid in ids:
 try:
  folder=root+'/'+uid;os.makedirs(folder,exist_ok=True)
  meta=requests.get('https://api.sketchfab.com/v3/models/'+uid,timeout=30).json()
  if meta.get('license',{}).get('label')!='CC Attribution':print('SKIP LICENSE',uid,flush=True);continue
  json.dump(meta,open(folder+'/metadata.json','w'))
  if os.path.exists(folder+'/scene.gltf') or os.path.exists(folder+'/scene.glb'):print('EXISTS',uid,flush=True);continue
  r=requests.get('https://api.sketchfab.com/v3/models/'+uid+'/download',headers={'Authorization':'Token '+key},timeout=45)
  if r.status_code!=200:print('DOWNLOAD FAILED',uid,r.status_code,flush=True);continue
  d=r.json();item=d.get('gltf') or d.get('glb')
  if not item:print('NO GLTF',uid,flush=True);continue
  body=requests.get(item['url'],timeout=180);body.raise_for_status()
  if body.content[:2]==b'PK':
   with zipfile.ZipFile(io.BytesIO(body.content)) as z:
    for entry in z.infolist():
     dest=os.path.abspath(os.path.join(folder,entry.filename))
     if os.path.commonpath([os.path.abspath(folder),dest])!=os.path.abspath(folder):raise ValueError('unsafe archive')
    z.extractall(folder)
  else:open(folder+'/scene.glb','wb').write(body.content)
  print('SAVED',uid,meta.get('name'),len(body.content),flush=True)
 except Exception as e:print('FAILED',uid,type(e).__name__,flush=True)
