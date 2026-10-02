from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]/'tests/runtime_motion'
groups=[('swing',sorted(root.glob('swing_*.png'))),('release',sorted(root.glob('release_*.png')))]
names=sorted({p.stem.rsplit('_',1)[0] for p in root.glob('*.png') if not p.stem.startswith(('swing_','release_','sheet_','context_','fall_','single_','head_','zip_'))})
for j in range(0,len(names),4):
    groups.append(('moves_'+str(j),[root/(n+'_'+str(i)+'.png') for n in names[j:j+4] for i in range(6)]))
for name,paths in groups:
    sheet=Image.new('RGB',(1440,240*((len(paths)+5)//6)),(20,25,35))
    for i,p in enumerate(paths):sheet.paste(Image.open(p).convert('RGB').resize((240,240)),((i%6)*240,(i//6)*240))
    sheet.save(root/('sheet_'+name+'.jpg'),quality=92)
frames=[Image.open(p).convert('RGB').resize((480,480)) for _,paths in groups[:2] for p in paths]
frames[0].save(root/'swing-release.gif',save_all=True,append_images=frames[1:],duration=100,loop=0)
