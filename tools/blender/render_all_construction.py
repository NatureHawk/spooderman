import bpy,os,json,math
from mathutils import Vector
ROOT=r'C:/Users/PRIYANSHU/Pictures/spoodermanv2'
scene=bpy.data.scenes['THREADLINE — 20 construction buildings'];bpy.context.window.scene=scene
plans=json.load(open(ROOT+'/evidence/construction/structural_blueprints_20.json',encoding='utf8'))
plans=plans['sites'] if isinstance(plans,dict) else plans
camera=bpy.data.objects['TL proof camera'];scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=8
scene.render.resolution_x=1000;scene.render.resolution_y=750;scene.render.resolution_percentage=100
out=ROOT+'/evidence/construction/blender_final';os.makedirs(out,exist_ok=True)
for plan in plans:
    bid=plan['bid'];col=bpy.data.collections['TL_SITE_%02d_BID_%s'%(plan['index']+1,bid)]
    for c in scene.collection.children:
        if c.name.startswith(('TL_SITE_','TL_FINISHED_ROOF_')):c.hide_render=c!=col
    origin=bpy.data.objects['AUTHORING ORIGIN %s'%bid];M=plan['model'];B=M['bounds']
    center=Vector(((B['minX']+B['maxX'])/2,-(B['minZ']+B['maxZ'])/2,M['top']*.4))
    target=origin.matrix_world@center
    size=max(B['maxX']-B['minX'],B['maxZ']-B['minZ']);radius=max(40,size*1.1)
    camera.location=target+Vector((radius*.7,-radius,radius*.6));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=size*1.45
    scene.render.filepath=out+'/building_%02d_%s.png'%(plan['index'],bid);bpy.ops.render.render(write_still=True)
    with open(out+'/progress.json','w') as f:json.dump({'index':plan['index'],'bid':bid},f)
for c in scene.collection.children:
    if c.name.startswith(('TL_SITE_','TL_FINISHED_ROOF_')):c.hide_render=False;c.hide_viewport=False
print('TWENTY_VISUAL_REVIEWS_READY')
