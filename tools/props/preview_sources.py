"""Inspect downloaded assets in Blender's viewport renderer before conversion/export."""
import bpy,glob,os,json,math
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for folder in glob.glob(ROOT+'/source/props_external/*'):
 files=glob.glob(folder+'/scene.gl*'); out=ROOT+'/evidence/props/'+os.path.basename(folder)+'_source.png'
 if not files or os.path.exists(out):continue
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=files[0])
 meshes=[o for o in bpy.data.objects if o.type=='MESH' and o.data.materials]
 for o in bpy.data.objects:
  if o.type=='MESH' and o not in meshes:o.hide_render=True
 for o in bpy.data.objects:
  if o.type=='ARMATURE':o.animation_data_clear();o.data.pose_position='REST'
 bpy.context.view_layer.update()
 points=[o.matrix_world@Vector(p) for o in meshes for p in o.bound_box]
 lo=Vector(tuple(min(p[k] for p in points) for k in range(3)));hi=Vector(tuple(max(p[k] for p in points) for k in range(3)))
 center=(lo+hi)/2;size=max(hi-lo)
 scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='TEXTURE';scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
 scene.display.shading.background_type='WORLD';scene.world=bpy.data.worlds.new('Preview World');scene.world.color=(.16,.16,.16)
 bpy.ops.object.camera_add(location=center+Vector((.9,-1.8,.55))*size);cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.clip_end=max(1000,size*20);cam.data.type='ORTHO';cam.data.ortho_scale=size*1.25;scene.camera=cam
 scene.render.resolution_x=700;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.render.filepath=out
 bpy.ops.render.render(write_still=True)
 data={'uid':os.path.basename(folder),'size':list(hi-lo),'meshes':[{'name':o.name,'verts':len(o.data.vertices),'materials':[m.name for m in o.data.materials]} for o in meshes], 'rigs':[{ 'name':o.name,'bones':[b.name for b in o.data.bones]} for o in bpy.data.objects if o.type=='ARMATURE']}
 json.dump(data,open(folder+'/inspection.json','w'));print('PREVIEW',out,flush=True)
