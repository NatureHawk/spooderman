"""Textured external props, fitted to the existing prop bounds; physics metadata retained."""
import bpy,os,json,glob,math,struct
from mathutils import Vector,Matrix
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Reuse compact mesh encoder and texture conversion without running the pedestrian build.
code=open(ROOT+'/tools/props/people_export.py').read().split("blob=Blob();man=")[0];exec(code,globals())
CONFIG=[
 ('8013d8e6af4645d1a7c3d5b24054bfc8','P_trash_bin',['Red Trash Can_40'],None),
 ('f58e929a6fc34c589140ccdb2a0083e8','P_newsbox',None,[.65,1.15,.6]),
 ('043de147beed442ca55f6eb9d566d33d','P_bike',None,[.64,1.15,1.88]),
 ('6f2f5c73c05148b6b56baf5b0cd66787','P_bikedock',None,[6.5,.92,.4]),
 ('0bf1acaa6f1d4a9bb38cfc91fd115f9c','P_hvac',None,None),
 ('0bf1acaa6f1d4a9bb38cfc91fd115f9c','RK_hvac',None,[3.7,1.52,2.8]),
 ('ce4de11b50164c3abf65de2d6c51b872','P_water_tower',None,None),
 ('ce4de11b50164c3abf65de2d6c51b872','RK_tank',None,[3.5,6.17,3.5]),
 ('220e6f951bd144edad865e0a6f26d602','P_hydrant',None,None),
 ('56c63eb16e5b479883cf3189932b38c9','P_scaffold',None,None),
 ('35c02eee93ea4a2f80af8acb84351d8c','P_subway_entrance',None,[3.4,2.4,5.4]),
 ('8013d8e6af4645d1a7c3d5b24054bfc8','P_streetlamp',['Street Light'],None),
 ('8013d8e6af4645d1a7c3d5b24054bfc8','P_bench',['Wood Bench','Bench Support'],None),
 ('8013d8e6af4645d1a7c3d5b24054bfc8','P_bollard',['Metal Bolard'],None),
 ('8013d8e6af4645d1a7c3d5b24054bfc8','P_mailbox',['Post Box'],[.66,1.25,.56]),
 ('8013d8e6af4645d1a7c3d5b24054bfc8','P_dumpster',['Big Bin Body','Big Bin Lid'],[2.1,1.55,1.1]),
]
blob=Blob();man={'version':2,'assets':{}};report=[]
only=os.environ.get('TL_PROP_ONLY')
if only:
 man=json.load(open(OUT+'/props.json'));data=open(OUT+'/props.bin','rb').read();blob.parts=[data];blob.size=len(data)
 report=json.load(open(OUT+'/props_audit.json'))
for uid,name,selectors,size in CONFIG:
 if only and name!=only:continue
 folder=ROOT+'/source/props_external/'+uid
 if not glob.glob(folder+'/scene.gl*'):continue
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=glob.glob(folder+'/scene.gl*')[0]);bpy.context.view_layer.update()
 meshes=[o for o in bpy.data.objects if o.type=='MESH' and o.data.materials and (not selectors or any(s in (o.parent.name if o.parent else o.name) for s in selectors))]
 if name=='P_subway_entrance':meshes=[o for o in meshes if not any(m.name=='Ground' for m in o.data.materials)]
 assert meshes,name
 # Freeze imported transforms/skin at its authored default, then combine selected parts.
 obs=[]
 for source in meshes:
  dg=bpy.context.evaluated_depsgraph_get();ev=source.evaluated_get(dg);me=bpy.data.meshes.new_from_object(ev);ob=bpy.data.objects.new('PropPart',me);bpy.context.collection.objects.link(ob);me.transform(source.matrix_world);obs.append(ob)
 for o in list(bpy.data.objects):
  if o not in obs:bpy.data.objects.remove(o,do_unlink=True)
 bpy.ops.object.select_all(action='DESELECT')
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0]
 if len(obs)>1:bpy.ops.object.join()
 ob=obs[0];ob.name='SM_'+name
 ps=[v.co for v in ob.data.vertices];lo=Vector([min(v[k] for v in ps) for k in range(3)]);hi=Vector([max(v[k] for v in ps) for k in range(3)])
 original=BASE.get(name);entry=original.get('hi',original.get('lo')) if original else None
 if size:target=Vector((size[0],size[2],size[1]));center=Vector((0,0,size[1]/2))
 elif entry:target=Vector((entry['half'][0]*2,entry['half'][2]*2,entry['half'][1]*2));center=game_to_bl(entry['ctr'])
 else:target=Vector((2,1,1));center=Vector((0,0,.5))
 scale=Vector([target[k]/max(hi[k]-lo[k],1e-5) for k in range(3)])
 for v in ob.data.vertices:v.co=Vector([(v.co[k]-(lo[k]+hi[k])/2)*scale[k]+center[k] for k in range(3)])
 # Viewport-render inspection at fitted scale, with source textures.
 scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='TEXTURE';scene.display.shading.show_cavity=True;scene.world=bpy.data.worlds.new('Preview');scene.world.color=(.16,.16,.16)
 reach=max(target);bpy.ops.object.camera_add(location=center+Vector((1.2,-1.8,.8))*reach);cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=reach*1.4;cam.data.clip_end=reach*20;scene.camera=cam
 scene.render.resolution_x=800;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.render.filepath=ROOT+'/evidence/props/'+name+'_fitted.png';bpy.ops.render.render(write_still=True)
 specs=textures(ob,name);lods={}
 for lod,budget in [('hi',5000),('mid',1800),('lo',500)]:
  e=export_geo(ob,[],name,lod,blob,specs,budget,False);e['hb']=4;e['cat']='prop';e.pop('bones',None)
  for k in ['cols','socks','extra']:
   if original:
    src=original.get('lo',entry)
    if k in src:e[k]=src[k]
  lods[lod]=e
 man['assets'][name]=lods;report.append({'name':name,'uid':uid,'triangles':{k:v['ic']//3 for k,v in lods.items()}});print('PROP',report[-1],flush=True)
open(OUT+'/props.bin','wb').write(blob.bytes());json.dump(man,open(OUT+'/props.json','w'),separators=(',',':'));json.dump(report,open(OUT+'/props_audit.json','w'),indent=2)
