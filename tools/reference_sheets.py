from PIL import Image,ImageDraw
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'tests'
out=root/'reference_sheets';out.mkdir(exist_ok=True)
for start in range(0,398,30):
    sheet=Image.new('RGB',(1560,1315),(20,20,24));draw=ImageDraw.Draw(sheet)
    for j,t in enumerate(range(start,min(start+30,398))):
        im=Image.open(root/'reference_frames'/('%04d.jpg'%(t*2+1)))
        im=im.crop((245,115,610,465)).resize((260,240))
        x=(j%6)*260;y=(j//6)*263
        sheet.paste(im,(x,y+23));draw.text((x+5,y+5),'%d:%02d'%(t//60,t%60),fill='white')
    sheet.save(out/('%03d.jpg'%start),quality=90)
