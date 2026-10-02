import bpy,sys,requests,json,os,zipfile,io
root=r'C:/Users/PRIYANSHU/Pictures/spooderman_props/source/props_external'
s=sys.modules['blender_mcp'].BlenderMCPServer(); key=s._get_sketchfab_api_key()
ids=['600d4d4aa71c4181b2567a3605ce8c57','5e06a1a408b4405ab3555a2eeeffb36f','f58e929a6fc34c589140ccdb2a0083e8']
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
