"""Embed public CC-BY attribution, never API credentials or signed download URLs."""
import os,json,glob,ast
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.abspath(os.environ.get('TL_BUILD_DIR') or ROOT+'/build');people=json.load(open(OUT+'/people.json'))['people'];props=json.load(open(OUT+'/props_audit.json'));uids={p['uid'] for p in people}|{p['uid'] for p in props if p['name']!='P_subway_entrance'};rows=[]
for uid in sorted(uids):
 m=json.load(open(ROOT+'/source/props_external/'+uid+'/metadata.json'));rows.append({'name':m['name'],'author':m['user'].get('displayName') or m['user']['username'],'url':m.get('viewerUrl') or 'https://sketchfab.com/3d-models/'+uid,'license':m['license']['label'],'licenseUrl':m['license'].get('url','https://creativecommons.org/licenses/by/4.0/'),'changes':'Retargeted where applicable; geometry fitted, reduced and repacked; textures resized and atlased.'})
json.dump(rows,open(OUT+'/props_credits.json','w'),ensure_ascii=False,separators=(',',':'))
text='# Third-party asset credits\n\nThese CC-BY assets were adapted for THREADLINE. Geometry was fitted/retargeted and reduced; textures resized/atlased. Original authors retain copyright.\n\n'
for r in rows:text+='- ['+r['name']+']('+r['url']+') — '+r['author']+'; ['+r['license']+']('+r['licenseUrl']+').\n'
text+='\nThe subway guard, kiosk, steam stack, skylight, dish, and small weathered material tiles are authored for this worktree. Other retained procedural silhouettes come from THREADLINE’s baseline.\n';open(ROOT+'/THIRD_PARTY_ASSETS.md','w',encoding='utf-8').write(text)
