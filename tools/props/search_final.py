import bpy,sys,json
s=sys.modules['blender_mcp'].BlenderMCPServer();root=r'C:/Users/PRIYANSHU/Pictures/spooderman_props/source/props_search'
for q in ['realistic rigged casual woman','realistic rigged casual man','rigged scanned human','newsstand','bike station']:
 r=s.search_sketchfab_models(q,count=8);json.dump(r,open(root+'/'+q.replace(' ','_')+'.json','w'));print(q,json.dumps([{'uid':x['uid'],'name':x['name'],'faces':x.get('faceCount'),'license':x.get('license',{}).get('label')} for x in r.get('results',[])]),flush=True)
