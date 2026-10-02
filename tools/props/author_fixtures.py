"""Authored NYC fixtures with bevels, open structures, trim, and legible signage."""
import bpy,os,json,math
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
exec(open(ROOT+'/tools/props/people_export.py').read().split('blob=Blob();man=')[0],globals())
man=json.load(open(OUT+'/props.json'));blob=Blob();data=open(OUT+'/props.bin','rb').read();blob.parts=[data];blob.size=len(data)
def start():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 global parts,mats
 parts=[];mats=[]
 for name,col,rough,metal in [('iron',(.09,.14,.115),.68,.45),('steel',(.35,.38,.38),.56,.65),('glass',(.075,.14,.18),.22,.35),('paper',(.82,.77,.65),.94,0),('yellow',(.9,.27,.055),.7,.2),('dark',(.055,.065,.07),.75,.3),('white',(.84,.85,.79),.6,.15)]:
  m=bpy.data.materials.new(name);m.diffuse_color=(*col,1);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*col,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal;mats.append(m)
 for name in ['mag_city','mag_sport','mag_style','mag_news']:
  m=mats[3].copy();m.name=name;mats.append(m)
def keep(o,mat):o.data.materials.append(mats[mat]);parts.append(o);return o
def box(size,at,mat=0,bevel=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=at);o=bpy.context.object;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  b=o.modifiers.new('Manufactured edge','BEVEL');b.width=bevel;b.segments=2;bpy.ops.object.modifier_apply(modifier=b.name)
 return keep(o,mat)
def tube(a,b,r=.025,mat=0,n=12):
 a,b=Vector(a),Vector(b);d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 return keep(o,mat)
def globe(at,r=.12,mat=6):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=r,location=at);o=bpy.context.object
 for p in o.data.polygons:p.use_smooth=True
 return keep(o,mat)
def letters(text,at,size=.12,mat=6):
 bpy.ops.object.text_add(location=at,rotation=(math.pi/2,0,0));o=bpy.context.object;o.data.body=text;o.data.size=size;o.data.extrude=.001;o.data.align_x='CENTER';bpy.ops.object.convert(target='MESH');return keep(bpy.context.object,mat)
def finish(name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in parts:o.select_set(True)
 bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();ob=parts[0];bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);ob.name=name
 if name=='RK_skylight':
  for v in ob.data.vertices:v.co.z*=.365/.305
 # Source bevels and trim are real mesh; one atlas at runtime.
 specs=[{'d':'surface_paint','tint':list(m.diffuse_color[:3]),'c':list(m.diffuse_color[:3]),'rough':m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value,'metal':m.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value} for m in ob.data.materials]
 for spec,m in zip(specs,ob.data.materials):
  if m.name.startswith('mag_'):spec['d']=m.name.split('.')[0];spec['tint']=[1,1,1]
  elif m.name.startswith('glass'):spec.pop('d',None);spec.pop('tint',None)
 scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL';scene.display.shading.show_cavity=True;scene.world=bpy.data.worlds.new('Preview');scene.world.color=(.16,.16,.16)
 points=[v.co for v in ob.data.vertices];lo=Vector([min(v[k] for v in points) for k in range(3)]);hi=Vector([max(v[k] for v in points) for k in range(3)]);c=(lo+hi)/2;reach=max(hi-lo);bpy.ops.object.camera_add(location=c+Vector((1.1,-1.6,.85))*reach);cam=bpy.context.object;cam.rotation_euler=(c-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=reach*1.3;scene.camera=cam;scene.render.resolution_x=800;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.render.filepath=ROOT+'/evidence/props/'+name+'_authored.png';bpy.ops.render.render(write_still=True)
 lods={}
 for lod,budget in [('hi',6000),('mid',2600),('lo',750)]:
  e=export_geo(ob,[],name,lod,blob,specs,budget,False);e['hb']=4;e['cat']='prop';e.pop('bones',None);lods[lod]=e
 man['assets'][name]=lods;print('AUTHORED',name,flush=True)
start()
# Cast iron subway guard: opening kept visibly open, a dark stair well below street level.
for x in [-1.05,1.05]:
 for y in [-1.7,-.55,.55,1.7]:
  tube((x,y,0),(x,y,1.12),.045);box((.17,.17,.09),(x,y,.05),1);globe((x,y,1.15),.055,0)
 for z in [.18,1.05]:tube((x,-1.7,z),(x,1.7,z),.035)
 for y in [i*.23-1.6 for i in range(15)]:tube((x,y,.18),(x,y,1.05),.012,0,8)
 tube((x,-1.72,0),(x,-1.72,2.35),.05);globe((x,-1.72,2.42),.15,0);globe((x,-1.72,2.50),.115,6)
box((2.15,.13,.42),(0,-1.72,2.07),5);letters('Downtown Subway',(0,-1.795,2.13),.145);letters('1   2   3     A   C   E',(0,-1.795,1.93),.09,4)
box((2.05,3.4,.06),(0,0,-.05),5)
finish('P_subway_entrance')
start()
# Manhattan kiosk: chamfered metal shell, inset glazing, canopy, shutters, counter and magazine racks.
box((2.7,1.42,.12),(0,0,.08),1);box((2.65,1.3,.88),(0,0,.57),0);box((2.83,1.65,.14),(0,0,2.48),1);box((2.76,1.5,.3),(0,0,2.31),0)
for x in [-1.26,1.26]:box((.07,1.34,1.38),(x,0,1.64),1);box((.05,1.18,1.18),(x,0,1.62),2)
box((2.5,.04,1.15),(0,.64,1.62),2);box((2.83,.43,.08),(0,-.73,1.03),1)
letters('NEWS  •  MAGAZINES',(0,-.758,2.26),.16,6)
for x in [-.81,0,.81]:
 box((.75,.1,.025),(x,-.715,1.46),1);box((.75,.1,.025),(x,-.715,1.88),1)
 for z in [1.29,1.71]:
  for i in range(4):
   ob=box((.165,.038,.27),(x+(i-1.5)*.18,-.70,z),7+i,.004)
   # Printed cover supplies the fine detail without extra draw calls.
for y in [i*.065-.5 for i in range(16)]:box((.015,.014,1.1),(1.305,y,1.65),1,.003)
finish('P_newsstand')
start()
# NYC steam stack: striped shroud, reinforcing rings, bolted ground plate.
box((.72,.72,.07),(0,0,.04),1)
for i in range(7):tube((0,0,.07+i*.27),(0,0,.07+(i+1)*.27),.225,4 if i%2 else 6,24)
for z in [.11,.98,1.94]:tube((0,0,z),(0,0,z+.045),.242,1,24)
for x in [-.28,.28]:
 for y in [-.28,.28]:tube((x,y,.07),(x,y,.105),.035,1,6)
finish('P_steam_vent')
start()
# Shallow skylight fits the existing roof hatch envelope.
box((1.65,2.05,.16),(0,0,.08),1);box((1.48,1.88,.12),(0,0,.2),2)
for x in [-.77,0,.77]:box((.045,1.96,.05),(x,0,.28),1)
for y in [-.97,0,.97]:box((1.59,.045,.05),(0,y,.28),1)
finish('RK_skylight')
start()
# Concave dish with feed arm and a braced mast.
box((.7,.7,.1),(0,0,.05),1);tube((0,0,.1),(0,0,.65),.055,1)
verts=[];faces=[]
for j in range(7):
 r=j/6*.5
 for i in range(24):a=i/24*2*math.pi;verts.append((r*math.cos(a),.12-r*r*.55,.9+r*math.sin(a)))
for j in range(6):
 for i in range(24):a=j*24+i;b=j*24+(i+1)%24;faces.append((a,b,b+24,a+24))
me=bpy.data.meshes.new('Dish');me.from_pydata(verts,[],faces)
for p in me.polygons:p.use_smooth=True
ob=bpy.data.objects.new('Dish',me);bpy.context.collection.objects.link(ob);keep(ob,6)
tube((0,.1,.48),(0,-.5,.8),.018,1);box((.075,.12,.065),(0,-.48,.81),5)
finish('RK_dish')
open(OUT+'/props.bin','wb').write(blob.bytes());json.dump(man,open(OUT+'/props.json','w'),separators=(',',':'))
