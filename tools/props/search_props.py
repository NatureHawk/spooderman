import bpy,sys,json,os
s=sys.modules['blender_mcp'].BlenderMCPServer();root=r'C:/Users/PRIYANSHU/Pictures/spooderman_props/source/props_search'
for q in ['wooden water tower','NYC newsstand','subway entrance','city bike dock','scaffolding','rooftop props']:
 r=s.search_sketchfab_models(q,count=6);json.dump(r,open(root+'/'+q.replace(' ','_')+'.json','w'))
 print(q,json.dumps([{'uid':x['uid'],'name':x['name'],'faces':x.get('faceCount'),'license':x.get('license',{}).get('label')} for x in r.get('results',[])]),flush=True)
