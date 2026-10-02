"""Non-destructive local reference index; exact-cut clips and timestamped sheets."""
from pathlib import Path
import subprocess, json
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1]
FF=ROOT/'tools/.video-deps/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
VIDEO=next((ROOT/'video').glob('*.mp4'))
OUT=ROOT/'video/traversal_reference';OUT.mkdir(exist_ok=True)
MARKS=[('slingshot',0),('swing',23),('zip',140),('zip_point',170),('crane_pipe',214),('hvac',222),('water_tower',230),('pole_vault',238),('point_launch',245),('recovery',265),('dive',288),('loop',338),('corner',378),('wings_equip',408),('wings_turn',449),('wings_dodge',480),('wind_tunnel',497),('air_lift',531),('water_jump',545),('spider_jump',570),('spider_dash',600)]
def run(args): subprocess.run([str(FF),'-hide_banner','-loglevel','error','-y',*map(str,args)],check=True)
def sheet(name,times,crop=False):
    dest=OUT/name;dest.mkdir(exist_ok=True)
    result=Image.new('RGB',(1280,4*205),'#161b23');draw=ImageDraw.Draw(result)
    for i,t in enumerate(times):
        p=dest/f'{t:08.3f}.jpg'
        if not p.exists():run(['-ss',t,'-i',VIDEO,'-frames:v',1,'-q:v',2,p])
        im=Image.open(p)
        if crop:im=im.crop((180,65,460,345))
        im.thumbnail((320,180));x=(i%4)*320;y=(i//4)*205
        result.paste(im,(x+(320-im.width)//2,y+25));draw.text((x+5,y+5),f'{int(t)//60}:{t%60:06.3f}',fill='white')
    result.save(OUT/f'{name}.jpg',quality=92)
if __name__=='__main__':
    import sys
    if len(sys.argv)>1:
        start=float(sys.argv[2]);step=float(sys.argv[3]);sheet(sys.argv[1],[start+i*step for i in range(16)],True)
    else:
        index=[]
        for i,(name,start) in enumerate(MARKS):
            end=MARKS[i+1][1] if i+1<len(MARKS) else 630
            clip=OUT/f'{i+1:02d}_{name}.mp4'
            if not clip.exists():run(['-ss',start,'-i',VIDEO,'-t',end-start,'-c:v','libx264','-preset','fast','-crf',18,'-c:a','aac','-movflags','+faststart',clip])
            sheet(name,[start+.15+(end-start-.3)*j/15 for j in range(16)])
            index.append(dict(name=name,start=start,end=end,clip=clip.name));print(name,flush=True)
        # Remaining footage is not timestamp-labelled by the user; preserve it in the original.
        (OUT/'index.json').write_text(json.dumps(index,indent=2))
