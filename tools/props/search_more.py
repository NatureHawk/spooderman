import bpy,json,sys,os
server=sys.modules['blender_mcp'].BlenderMCPServer(); root=r'C:/Users/PRIYANSHU/Pictures/spooderman_props/source/props_search'
for q in ['rigged man scan','rigged woman scan','rigged child','rigged police officer','rigged elderly','rigged jogger']:
 r=server.search_sketchfab_models(q,count=12); json.dump(r,open(root+'/'+q.replace(' ','_')+'.json','w'))
 print(q,json.dumps([{'uid':x['uid'],'name':x['name'],'faces':x.get('faceCount'),'license':x.get('license',{}).get('label')} for x in r.get('results',[]) if x.get('license',{}).get('label')=='CC Attribution']))
