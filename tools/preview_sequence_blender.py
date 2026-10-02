from pathlib import Path
root=Path(r'C:/Users/PRIYANSHU/Pictures/spooderman')
code=(root/'tools/preview_motion_blender.py').read_text()
code=code.replace('animation_preview.json','sequence_poses.json').replace('motion_preview','sequence_preview')
code=code.replace('640','360').replace('(3.8, -6, 2.5)','(6, -2, 1.8)')
exec(compile(code,'sequence_preview','exec'))
