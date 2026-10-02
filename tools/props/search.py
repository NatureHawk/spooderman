import bpy,json,sys,os
m=sys.modules['blender_mcp']; server=m.BlenderMCPServer()
root=r'C:/Users/PRIYANSHU/Pictures/spooderman_props'
queries=['rigged people realistic','casual character rigged','construction worker rigged','new york water tower','rooftop HVAC','street props realistic']
for q in queries:
 r=server.search_sketchfab_models(q,count=12)
 rows=[dict(uid=x['uid'],name=x['name'],faces=x.get('faceCount'),license=x.get('license'),url=x.get('viewerUrl'),thumb=x.get('thumbnails',{}).get('images',[])[:1]) for x in r.get('results',[])]
 print(json.dumps({'query':q,'results':rows,'error':r.get('error')}))
 os.makedirs(root+'/source/props_search',exist_ok=True)
 json.dump(r,open(root+'/source/props_search/'+q.replace(' ','_')+'.json','w'))
