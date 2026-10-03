import bpy
ROOT=r'C:/Users/PRIYANSHU/Pictures/spoodermanv2'
scene=bpy.data.scenes['THREADLINE — 20 construction buildings']
scene['threadlineRebuildIndices']=[2,19]
exec(compile(open(ROOT+'/tools/blender/author_buildings.py',encoding='utf8').read(),'author_buildings.py','exec'))
del scene['threadlineRebuildIndices']
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/source/construction/Manhattan_Construction_20.blend',copy=True)
code=open(ROOT+'/tools/blender/render_all_construction.py',encoding='utf8').read().replace('for plan in plans:',"for plan in [p for p in plans if p['index'] in [2,19]]:")
exec(compile(code,'render_refined.py','exec'))
print('REFINED_TWO_BUILDINGS_EXPORTED')
