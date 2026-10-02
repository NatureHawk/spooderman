"""Inspect the actual runtime-posed meshes in a separate Blender scene; leave the user's scene intact."""
import bpy, json, os
from mathutils import Vector
root = r'C:/Users/PRIYANSHU/Pictures/spooderman'
data = json.load(open(root + '/tests/animation_preview.json'))
scene = bpy.data.scenes.new('THREADLINE Motion Inspection')
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'OBJECT'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.background_type = 'WORLD'
scene.world = bpy.data.worlds.new('Motion inspection background')
scene.world.color = (.055, .065, .085)
cam_data = bpy.data.cameras.new('Motion inspection camera')
cam = bpy.data.objects.new('Motion inspection camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 3.8
cam.location = (3.8, -6, 2.5)
cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z','Y').to_euler()
os.makedirs(root+'/tests/motion_preview', exist_ok=True)
for i, pose in enumerate(data):
    collection = bpy.data.collections.new('Motion - '+pose['label'])
    scene.collection.children.link(collection)
    for j, part in enumerate(pose['meshes']):
        mesh = bpy.data.meshes.new('Pose mesh')
        vertices = [(x,z,y) for x,y,z in part['vertices']]
        ix = part['indices']
        mesh.from_pydata(vertices, [], [ix[k:k+3] for k in range(0,len(ix),3)])
        mesh.update()
        ob = bpy.data.objects.new('Mechanical arm' if part['mechanical'] else pose['label'], mesh)
        collection.objects.link(ob)
        ob.color = (.75,.42,.09,1) if part['mechanical'] else (.45,.055,.075,1)
        for face in mesh.polygons: face.use_smooth = True
    for c in scene.collection.children: c.hide_render = c != collection
    scene.render.filepath = root+'/tests/motion_preview/%02d.png'%i
    bpy.ops.render.render(write_still=True, scene=scene.name)
print('Rendered six motion previews; original scene unchanged')
