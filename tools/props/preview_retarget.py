import bpy,glob,os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for file in glob.glob(ROOT+'/build/props_tex/*.blend'):
 bpy.ops.wm.open_mainfile(filepath=file);ob=bpy.data.objects['SM_Ped'];s=bpy.context.scene
 for o in bpy.data.objects:
  if o.type=='MESH':o.hide_render=o!=ob
 s.render.engine='BLENDER_WORKBENCH';s.display.shading.light='STUDIO';s.display.shading.color_type='TEXTURE';s.display.shading.show_shadows=True;s.display.shading.show_cavity=True;s.world=bpy.data.worlds.new('Preview');s.world.color=(.14,.14,.14)
 bpy.ops.object.camera_add(location=(2,-4,2));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.9))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.1;s.camera=cam
 s.render.resolution_x=700;s.render.resolution_y=800;s.render.resolution_percentage=100;s.render.filepath=ROOT+'/evidence/props/'+os.path.basename(file)+'.png';bpy.ops.render.render(write_still=True)
