import bpy,json
from mathutils import Vector
ROOT=r'C:/Users/PRIYANSHU/Pictures/spoodermanv2'
scene=bpy.data.scenes['THREADLINE — 20 construction buildings']
scene['threadlineRebuildIndices']=[0]
code=open(ROOT+'/tools/blender/author_buildings.py',encoding='utf8').read()
code=code.replace("blueprints={p['index']:p for p in first+second}","blueprints={p['index']:p for p in first+second}\nblueprints[0]=json.load(open(ROOT+'/evidence/construction/structural_proof_117.json'))")
exec(compile(code,'author_buildings.py','exec'))
for col in scene.collection.children:
    col.hide_render=col.name.startswith('TL_SITE_') and 'BID_117' not in col.name
    col.hide_viewport=col.hide_render
camera=bpy.data.objects.get('TL proof camera')
if not camera:
    camera=bpy.data.objects.new('TL proof camera',bpy.data.cameras.new('TL proof camera'));scene.collection.objects.link(camera)
origin=bpy.data.objects['AUTHORING ORIGIN 117']
target=origin.location+Vector((0,0,8))
camera.location=target+Vector((72,-86,53));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=107;scene.camera=camera
light=bpy.data.objects.get('TL proof sun')
if not light:
    light=bpy.data.objects.new('TL proof sun',bpy.data.lights.new('TL proof sun','SUN'));scene.collection.objects.link(light)
light.data.energy=3;light.rotation_euler=(.4,-.5,-.3)
scene.world=bpy.data.worlds.new('TL proof world') if not scene.world else scene.world
scene.world.color=(.25,.25,.25)
scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.filepath=ROOT+'/evidence/construction/proof117.png'
bpy.ops.render.render(write_still=True)
print('PROOF_RENDER_READY')
