import bpy, os
root=r'C:/Users/PRIYANSHU/Pictures/spooderman/tests'
out=root+'/reference_frames'
os.makedirs(out,exist_ok=True)
scene=bpy.data.scenes.new('Reference video inspection')
scene.render.engine='BLENDER_WORKBENCH'
scene.render.resolution_x=854
scene.render.resolution_y=480
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='JPEG'
scene.render.image_settings.quality=85
scene.view_settings.view_transform='Standard'
scene.render.fps=30
editor=scene.sequence_editor_create()
strip=editor.sequences.new_movie('Reference gameplay',root+'/reference_gameplay.webm',1,1)
scene.render.use_sequencer=True
for second in range(398):
    scene.frame_set(1+second*30)
    scene.render.filepath=out+'/%04d.jpg'%second
    bpy.ops.render.render(write_still=True,scene=scene.name)
print('Extracted every second of the full reference')
