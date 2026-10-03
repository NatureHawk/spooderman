import bpy,os,json,math
from mathutils import Vector
ROOT=r'C:/Users/PRIYANSHU/Pictures/spoodermanv2'
scene=bpy.data.scenes['THREADLINE — 20 construction buildings'];bpy.context.window.scene=scene
if 'threadlineRebuildIndices' in scene:del scene['threadlineRebuildIndices']
exec(compile(open(ROOT+'/tools/blender/author_buildings.py',encoding='utf8').read(),'author_buildings.py','exec'))
repair_path=ROOT+'/tools/blender/repair_facades.py'
if os.path.exists(repair_path):exec(compile(open(repair_path,encoding='utf8').read(),'repair_facades.py','exec'))
for col in scene.collection.children:
    if col.name.startswith(('TL_SITE_','TL_FINISHED_ROOF_')):col.hide_render=False;col.hide_viewport=False
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/source/construction/Manhattan_Construction_20.blend',copy=True)
print('ALL_TWENTY_EXPORTED_AND_SAVED')
