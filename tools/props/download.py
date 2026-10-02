import bpy,sys,requests,json,os,zipfile,io
root=r'C:/Users/PRIYANSHU/Pictures/spooderman_props/source/props_external'
s=sys.modules['blender_mcp'].BlenderMCPServer(); key=s._get_sketchfab_api_key()
ids=['c659bd0accab47c6bbe390cf822a2b92','acf520f450d14dd799f98a6fede3edf5','a46bc9f67aaa415bb4f3241eef900e7f','05d9dd5bdddd4157bd46dc179781ee6e','9034a1acc95e494592441a057d319953','7b62e6e1b58c476f8b421dd007a4ff90','c6d330c59f6c41eea41c71e00e39334b','60cca77799e249e39ef53e3112baa4a7','c9ded09156c244a6b0c3a29820e7f42a','5d8dbd0d8975404886e1cfe119117c0a','0bf1acaa6f1d4a9bb38cfc91fd115f9c','53535fc3005741758c35a4b7227aaff5','8013d8e6af4645d1a7c3d5b24054bfc8','220e6f951bd144edad865e0a6f26d602']
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
