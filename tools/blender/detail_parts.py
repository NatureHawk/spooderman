"""Deterministic construction props, in game Y-up metres; no bpy dependency.

expand_details(model, tags=None) appends render parts and matching cargo solids.
Each tag has kind, unique id, x/y/z, yaw (radians). y is the supporting floor top.
No helper chooses a placement: worksite authors must explicitly name each zone.
Rotated boxes are baked to the existing footprint-triangle primitive, so the
Blender adapter needs no new shape or transform support.
"""
import copy
import json
import math
import sys

FACES = ((0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5))

class Parts:
    def __init__(self, tag):
        self.tag = tag
        self.parts, self.solids = [], []
        self.yaw = float(tag.get('yaw', 0))
        self.origin = [float(tag.get(k, 0)) for k in ('x','y','z')]
        self.id = tag['id']

    def point(self, p):
        c,s=math.cos(self.yaw),math.sin(self.yaw)
        return [self.origin[0]+c*p[0]+s*p[2], self.origin[1]+p[1], self.origin[2]-s*p[0]+c*p[2]]

    def box(self, mat, x,y,z,hx,hy,hz, name, lean=0, solid=False, bevel=.012):
        corners=[]
        for X,Y,Z in ((-hx,-hy,-hz),(hx,-hy,-hz),(hx,hy,-hz),(-hx,hy,-hz),(-hx,-hy,hz),(hx,-hy,hz),(hx,hy,hz),(-hx,hy,hz)):
            corners.append(self.point([x+X,y+Y*math.cos(lean)-Z*math.sin(lean),z+Y*math.sin(lean)+Z*math.cos(lean)]))
        if abs(self.yaw)+abs(lean)<1e-9:
            p=self.point([x,y,z]); part=dict(shape='box',mat=mat,x=p[0],y=p[1],z=p[2],hx=hx,hy=hy,hz=hz,bevel=bevel)
        else:
            positions=[]
            for a,b,c,d in FACES:
                for i in (a,b,c,a,c,d):positions.extend(corners[i])
            part=dict(shape='footprint',mat=mat,positions=positions)
        part.update(detailId=self.id,detailPart=name)
        self.parts.append(part)
        if solid:self.bounds(corners,mat,name)

    def bounds(self, points, mat, name):
        lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
        self.solids.append(dict(x=(lo[0]+hi[0])/2,y=(lo[1]+hi[1])/2,z=(lo[2]+hi[2])/2,hx=max(.008,(hi[0]-lo[0])/2),hy=max(.008,(hi[1]-lo[1])/2),hz=max(.008,(hi[2]-lo[2])/2),kind='cargo',mat=mat,detailId=self.id,detailPart=name))

    def envelope(self, x,y,z,hx,hy,hz,mat,name):
        self.bounds([self.point([x+sx*hx,y+sy*hy,z+sz*hz]) for sx in (-1,1) for sy in (-1,1) for sz in (-1,1)],mat,name)


    def sack(self,x,y,z):
        # Pinched sewn edges and a fuller middle give each paper bag a soft silhouette.
        outline=[(-.27,-.275),(.27,-.275),(.35,-.20),(.35,.20),(.27,.275),(-.27,.275),(-.35,.20),(-.35,-.20)]
        points=[]
        for yy,scale in ((-.095,.84),(0,1),(.095,.84)):
            points.extend(self.point([x+xx*scale,y+yy,z+zz*scale]) for xx,zz in outline)
        triangles=[]
        for ring in (0,1):
            for i in range(8):
                j=(i+1)%8;a=ring*8+i;b=ring*8+j;c=(ring+1)*8+j;d=(ring+1)*8+i
                triangles.extend((a,c,b,a,d,c))
        for i in range(1,7):triangles.extend((0,i,i+1,16,16+i+1,16+i))
        positions=[v for i in triangles for v in points[i]]
        self.parts.append(dict(shape='footprint',mat='concrete',positions=positions,detailId=self.id,detailPart='individual cement sack'))

    def beam(self, mat, a,b,r,name):
        self.parts.append(dict(shape='beam',mat=mat,a=self.point(a),b=self.point(b),r=r,detailId=self.id,detailPart=name))


def pallet_bundle(out, tag):
    """Separate deck boards, bottom runners, fork pockets, blocks and nail heads."""
    stacks=max(1,min(4,int(tag.get('pallets',2))))
    for level in range(stacks):
        y=level*.25
        for z in (-.48,0,.48):out.box('wood',0,y+.025,z,1.2,.025,.07,'bottom runner')
        for x in (-1.02,0,1.02):
            for z in (-.48,0,.48):out.box('wood',x,y+.105,z,.10,.055,.075,'fork pocket spacer')
            out.box('timber',x,y+.18,0,.065,.025,.64,'cross bearer')
        for board in range(7):
            z=-.555+board*.185
            out.box('timber' if board%3 else 'wood',0,y+.225,z,1.2,.025,.075,'separate deck plank')
            for x in (-1.02,1.02):out.beam('steel',[x,y+.251,z],[x,y+.257,z],.012,'exposed nail head')
        out.envelope(0,y+.125,0,1.2,.125,.65,'timber','pallet collision')
    base=stacks*.25
    # Bundled cut lumber retains visible air gaps and individual end grain faces.
    for layer in range(4):
        for board in range(4):
            out.box('timber' if (layer+board)%3 else 'wood',0,base+.045+layer*.092,-.45+board*.3,1.13-(layer%2)*.06,.042,.13,'stock plank')
    for x in (-.72,.72):
        out.box('steel',x,base+.37,0,.022,.012,.60,'bundle strap top')
        for z in (-.59,.59):out.box('steel',x,base+.19,z,.022,.19,.009,'bundle strap side')
    out.envelope(0,base+.188,0,1.13,.188,.6,'timber','bundled lumber collision')


def panel_rack(out, tag):
    """Leaning wall/form panels, visible frame ribs, steel A rack and toe stops."""
    for x in (-1.12,1.12):
        out.box('steel',x,.07,0,.08,.07,.75,'rack foot',solid=True)
        out.beam('rust',[x,.14,-.62],[x,2.35,.22],.045,'rack leaning support')
        out.beam('rust',[x,.14,.67],[x,2.35,.22],.045,'rack backstay')
    out.beam('steel',[-1.12,2.35,.22],[1.12,2.35,.22],.045,'rack header')
    for i in range(4):
        z=-.42+i*.17
        out.box('timber' if i%2 else 'wood',0,1.35,z,1.27,1.17,.035,'separate leaning wall panel',lean=-.16,solid=True)
        # Frame members follow the panel lean, rather than appearing to float.
        def rib(x,local_y,hx,hy):
            yy=1.35+local_y*math.cos(-.16);zz=z+local_y*math.sin(-.16)-.06
            out.box('timber',x,yy,zz,hx,hy,.025,'panel reinforcing rib',lean=-.16)
        for x in (-1.15,0,1.15):rib(x,0,.045,1.13)
        for y in (-1.08,0,1.08):rib(0,y,1.23,.045)
        for x in (-1.10,1.10):
            for y in (-1.04,1.04):
                yy=1.35+y*math.cos(-.16);zz=z+y*math.sin(-.16)-.10
                out.beam('steel',[x,yy,zz],[x,yy,zz-.009],.013,'panel bolt head')
    for x in (-1,1):out.box('orange',x,.20,-.72,.09,.16,.07,'panel toe stop',solid=True)


def rebar_bundle(out, tag):
    for z in (-.30,.30):out.box('timber',0,.05,z,2.25,.05,.055,'rebar timber support')
    for layer in range(3):
        for col in range(5-layer):
            z=(col-(4-layer)/2)*.12
            out.beam('rust',[-2.3,.145+layer*.095,z],[2.3-(col%2)*.12,.145+layer*.095,z],.033,'individual rebar rod')
    # Two closed metal ties across the bundled rods.
    for x in (-1.35,1.35):
        pts=[[x,.105,-.32],[x,.39,-.12],[x,.39,.12],[x,.105,.32],[x,.105,-.32]]
        for a,b in zip(pts,pts[1:]):out.beam('steel',a,b,.014,'rebar bundle tie')
    out.envelope(0,.205,0,2.3,.195,.35,'rust','rebar bundle collision')


def cement_bags(out, tag):
    for z in (-.46,0,.46):out.box('wood',0,.05,z,1.15,.05,.055,'bag pallet runner')
    for x in (-1,-.5,0,.5,1):out.box('timber',x,.125,0,.09,.025,.61,'bag pallet board')
    for layer in range(3):
        for row in range(2):
            for col in range(3):
                x=(col-1)*.74+(layer%2)*.05;z=(row-.5)*.59;y=.25+layer*.205
                out.sack(x,y,z)
                out.beam('timber',[x-.29,y+.072,z+.24],[x+.29,y+.072,z+.24],.012,'folded paper sack seam')
                out.box('wood',x,y+.097,z,.14,.002,.08,'sack printed mark',bevel=0)
    out.envelope(.025,.425,0,1.17,.425,.61,'concrete','bag stack collision')


def cable_coil(out, tag):
    turns=3;steps=24
    previous=None
    for i in range(turns*steps+1):
        a=i*math.tau/steps;r=.69-i/(turns*steps)*.075
        point=[r*math.cos(a),.065+i/(turns*steps)*.13,r*math.sin(a)]
        if previous:out.beam('steel',previous,point,.038,'continuous cable winding')
        previous=point
    lead=[previous,[.36,.08,-.7],[.10,.05,-.78],[-.28,.045,-.73]]
    for a,b in zip(lead,lead[1:]):out.beam('steel',a,b,.038,'loose cable lead')
    for x in (-.35,.35):out.box('orange',x,.19,0,.025,.016,.63,'coil retaining strap')
    out.envelope(0,.135,-.015,.76,.135,.805,'steel','coil collision')


BUILDERS={'pallet_bundle':pallet_bundle,'panel_rack':panel_rack,'rebar_bundle':rebar_bundle,'cement_bags':cement_bags,'cable_coil':cable_coil}

def make_detail(tag):
    if not tag.get('id'):raise ValueError('Explicit unique detail id is required')
    if tag.get('kind') not in BUILDERS:raise ValueError('Unknown construction detail: '+str(tag.get('kind')))
    out=Parts(tag);BUILDERS[tag['kind']](out,tag)
    return {'parts':out.parts,'solids':out.solids}

def expand_details(model, tags=None):
    tags=model.get('details',[]) if tags is None else tags
    ids=[tag['id'] for tag in tags]
    if len(set(ids))!=len(ids):raise ValueError('Duplicate detail zone id in one building')
    # Appended props leave pipeSolids / support indices unchanged.
    model['parts']=[p for p in model.get('parts',[]) if not p.get('detailId')]
    model['solids']=[p for p in model.get('solids',[]) if not p.get('detailId')]
    for tag in tags:
        built=make_detail(tag);model['parts'].extend(built['parts']);model['solids'].extend(built['solids'])
    model['details']=copy.deepcopy(tags)
    return model

if __name__=='__main__':
    # Supports authoring scripts and non-Blender geometry regression fixtures.
    data=json.load(open(sys.argv[1],encoding='utf-8-sig'))
    if 'model' in data:expand_details(data['model'])
    elif 'parts' in data:expand_details(data)
    else:
        for site in data.get('sites',[]) if isinstance(data,dict) else data:expand_details(site['model'])
    text=json.dumps(data,separators=(',',':'))
    if len(sys.argv)>2:open(sys.argv[2],'w',encoding='utf8').write(text)
    else:print(text)
