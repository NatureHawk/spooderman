"""Add UVs and authored weathered finishes to traversal-compatible hard-surface props.
Existing silhouettes and collider/socket metadata remain the source of truth.
Run after props_export.py, before atlas_pack.py. Does not regenerate base assets.
"""
import bpy,os,json,struct,math
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
exec(open(ROOT+'/tools/props/people_export.py').read().split('blob=Blob();man=')[0],globals())
raw=open(ROOT+'/build/assets.bin','rb').read();man=json.load(open(OUT+'/props.json'));blob=Blob();data=open(OUT+'/props.bin','rb').read();blob.parts=[data];blob.size=len(data)
names=['P_antenna','P_chimney','P_fire_escape','P_roof_hut','P_vent_stack','P_pipe_piece','P_pipe_rack','P_railing','P_traffic_light','P_street_sign','P_bus_stop','P_vendor_cart','P_market_stall']
for name in names:
 bpy.ops.wm.read_factory_settings(use_empty=True);original=BASE.get(name)
 if not original:continue
 e=original.get('hi',original.get('lo'));ps=struct.unpack_from('<%dh'%(e['vc']*3),raw,e['pos']);idx=struct.unpack_from('<%d%s'%(e['ic'],'I' if e['big'] else 'H'),raw,e['idx']);mi=raw[e['mat']:e['mat']+e['vc']]
 pos=[game_to_bl([e['ctr'][k]+ps[i*3+k]/32767*e['half'][k] for k in range(3)]) for i in range(e['vc'])];faces=[idx[i:i+3] for i in range(0,len(idx),3)]
 me=bpy.data.meshes.new(name);me.from_pydata(pos,[],faces);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);uv=me.uv_layers.new(name='UVMap')
 for i,pal in enumerate(e['pal']):
  m=bpy.data.materials.new('Weathered_'+str(i));m.diffuse_color=(*pal[:3],1);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*pal[:3],1);bs.inputs['Roughness'].default_value=pal[5];bs.inputs['Metallic'].default_value=pal[6]
  kind='wood' if pal[0]>pal[1]*1.2 and pal[1]>pal[2]*1.2 else 'paint' if pal[6]<.2 else 'galvanized'
  if 'chimney' in name and pal[0]>pal[1]*1.2:kind='brick'
  file=OUT+'/props_tex/surface_'+kind+'.png'
  if os.path.exists(file):
   image=bpy.data.images.load(file,check_existing=True);node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;m.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
  ob.data.materials.append(m)
 for poly in me.polygons:
  poly.material_index=mi[poly.vertices[0]];axis=max(range(3),key=lambda k:abs(poly.normal[k]));axes=[k for k in range(3) if k!=axis];ranges=[(min(v[k] for v in pos),max(v[k] for v in pos)) for k in axes]
  for li in poly.loop_indices:
   v=pos[me.loops[li].vertex_index];uv.data[li].uv=[(v[k]-ranges[j][0])/max(ranges[j][1]-ranges[j][0],.001)*.998+.001 for j,k in enumerate(axes)]
 specs=[]
 for i,pal in enumerate(e['pal']):
  # Use colour multiplication in the atlas generator, retaining recognizable paint and metal.
  kind='wood' if pal[0]>pal[1]*1.2 and pal[1]>pal[2]*1.2 else 'paint' if pal[6]<.2 else 'galvanized'
  if 'chimney' in name and pal[0]>pal[1]*1.2:kind='brick'
  specs.append({'d':'surface_'+kind,'tint':pal[:3],'rough':pal[5],'metal':pal[6]})
 # Every modified asset gets a viewport record before compact export.
 s=bpy.context.scene;s.render.engine='BLENDER_WORKBENCH';s.display.shading.light='STUDIO';s.display.shading.color_type='MATERIAL';s.display.shading.show_cavity=True;s.world=bpy.data.worlds.new('Preview');s.world.color=(.16,.16,.16)
 center=sum(pos,Vector())/len(pos);reach=max(e['half'])*2;bpy.ops.object.camera_add(location=center+Vector((1.2,-1.8,.7))*reach);cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=reach*1.5;s.camera=cam;s.render.resolution_x=700;s.render.resolution_y=700;s.render.resolution_percentage=100;s.render.filepath=ROOT+'/evidence/props/'+name+'_authored.png';bpy.ops.render.render(write_still=True)
 lods={}
 for lod,budget in [('hi',5000),('mid',1800),('lo',500)]:
  v=export_geo(ob,[],name,lod,blob,specs,budget,False);v['hb']=4;v['cat']='prop';v.pop('bones',None)
  for k in ['cols','socks','extra']:
   if k in original.get('lo',e):v[k]=original.get('lo',e)[k]
  lods[lod]=v
 man['assets'][name]=lods;print('REFINISHED',name,flush=True)
open(OUT+'/props.bin','wb').write(blob.bytes());json.dump(man,open(OUT+'/props.json','w'),separators=(',',':'))
