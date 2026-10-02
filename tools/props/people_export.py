"""External CC-BY pedestrians -> existing NPC rig and compact TLA pack. Run in Blender."""
import bpy,os,json,glob,math,re,struct
from mathutils import Vector,Matrix
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.abspath(os.environ.get('TL_BUILD_DIR') or ROOT+'/build')
exec(open(ROOT+'/tools/hd/export_tla.py').read(),globals())
OUT_DIR=OUT  # Never inherit the old exporter's main-folder output path.
BASE=json.load(open(ROOT+'/build/assets.json'))['assets']
CONFIG=[('c659bd0accab47c6bbe390cf822a2b92','office_blouse','f'),('acf520f450d14dd799f98a6fede3edf5','office_jacket','f'),('a46bc9f67aaa415bb4f3241eef900e7f','business','m'),('9034a1acc95e494592441a057d319953','casual','m'),('7b62e6e1b58c476f8b421dd007a4ff90','worker','h'),('c6d330c59f6c41eea41c71e00e39334b','police','m'),('60cca77799e249e39ef53e3112baa4a7','elder','h'),('143a2b1ea5eb4385ae90a73657aca3bc','weekend','m'),('dc448c3be0e74f96a55fb475a13433cf','casual_woman','f'),('e65e0fef4e0743868c8d5bff36d61116','student','m')]
os.makedirs(OUT+'/props_tex',exist_ok=True)

def game_to_bl(v):return Vector((v[0],-v[2],v[1]))
def clean(n):
 n=n.lower().replace('up arm','upperarm').replace('low arm','lowerarm').replace('up leg','upperleg').replace('low leg','lowerleg').replace('buttom','hips').replace(' ','_').split(':')[-1].replace('base_humanl','left').replace('base_humanr','right');n=re.sub(r'_0\d+$','',n);return n

def classify(n):
 n=clean(n);side='L' if ('left' in n or re.search(r'(^|[_.])l($|[_.])',n)) else 'R' if ('right' in n or re.search(r'(^|[_.])r($|[_.])',n)) else ''
 if side:
  for words,out in [(['shoulder','clavicle','collarbone'],'clav'),(['forearm','lowerarm'],'farm'),(['upperarm','arm'],'uarm'),(['upleg','upperleg','thigh'],'thigh'),(['lowerleg','calf','leg'],'shin'),(['foot','toe','ball'],'foot'),(['hand','palm','thumb','index','middle','ring','pinky'],'hand')]:
   if any(w in n for w in words):return out+side
 if 'head' in n or any(w in n for w in ['jaw','eye','mouth']):return 'head'
 if 'neck' in n:return 'neck'
 if 'waist' in n:return 'spine'
 if 'spine' in n:
  return 'chest' if any(s in n for s in ['spine2','spine3','spine02','spine03','up_spine','spine_02','spine_03']) else 'spine'
 if any(w in n for w in ['hip','pelvis']):return 'hips'
 return None

def prepare(folder,variant):
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=glob.glob(folder+'/scene.gl*')[0])
 rigs=[o for o in bpy.data.objects if o.type=='ARMATURE'];assert rigs,'No rig'
 rig=max(rigs,key=lambda o:len(o.data.bones));rig.animation_data_clear();rig.data.pose_position='REST';bpy.context.view_layer.update()
 meshes=[o for o in bpy.data.objects if o.type=='MESH' and len(o.vertex_groups)>0 and len(o.data.materials)>0 and any(g.weight>.001 for v in o.data.vertices for g in v.groups)]
 meshes=[o for o in meshes if not all('hammer' in o.vertex_groups[i].name.lower() for i in {g.group for v in o.data.vertices for g in v.groups if g.weight>.001})]
 assert meshes,'No skinned meshes'
 defs=BASE['PED_'+variant]['hi']['bones'];names=[d['name'] for d in defs]
 mapping={b.name:classify(b.name) for b in rig.data.bones}
 for b in rig.data.bones:
  if not mapping[b.name]:
   parent=b.parent
   while parent and not mapping.get(parent.name):parent=parent.parent
   mapping[b.name]=mapping.get(parent.name) if parent else 'hips'
 canonical={}
 for b in rig.data.bones:
  target=mapping[b.name]
  # Prefer main joints over twist, fingers, end bones, facial controls.
  priority=('ik_' in b.name.lower())*1000+('twist' in b.name.lower())*100+('end' in b.name.lower())*100+('compensation' in b.name.lower())*100+len(b.name)+(1000 if classify(b.name) is None else 0)
  if target=='head' and 'head' not in clean(b.name):priority+=100
  if target not in canonical or priority<canonical[target][0]:canonical[target]=(priority,b)
 assert all(n in canonical for n in ['hips','head','uarmL','uarmR','thighL','thighR','shinL','shinR']),(folder,list(canonical))
 # World scale from source head/hips separation, keeping realistic facial proportions.
 hips=rig.matrix_world@canonical['hips'][1].head_local;head=rig.matrix_world@canonical['head'][1].head_local
 up=(head-hips).normalized();across=(rig.matrix_world@canonical['uarmL'][1].head_local-rig.matrix_world@canonical['uarmR'][1].head_local).normalized()
 back=up.cross(across).normalized();across=back.cross(up).normalized();orientation=Matrix((across,back,up))
 hips=orientation@hips;head=orientation@head
 dh=game_to_bl(next(d for d in defs if d['name']=='head')['head'])-game_to_bl(defs[0]['head'])
 scale=dh.length/max((head-hips).length,1e-4)
 transforms={}
 for d in defs:
  b=canonical.get(d['name'],canonical['hips'])[1];a=orientation@(rig.matrix_world@b.head_local);v=orientation@rig.matrix_world.to_3x3()@(b.tail_local-b.head_local)
  next_name={'clavL':'uarmL','clavR':'uarmR','uarmL':'farmL','uarmR':'farmR','farmL':'handL','farmR':'handR','thighL':'shinL','thighR':'shinR','shinL':'footL','shinR':'footR'}.get(d['name'])
  if next_name and next_name in canonical:v=orientation@(rig.matrix_world@canonical[next_name][1].head_local)-a
  elif d['name'].startswith('hand'):
   v=a-orientation@(rig.matrix_world@canonical['farm'+d['name'][-1]][1].head_local)
  elif d['name'].startswith('foot'):
   toe=next((child for child in b.children if any(n in child.name.lower() for n in ['ball','toe'])),None)
   v=orientation@(rig.matrix_world@toe.head_local)-a if toe else Vector((0,-.15,-.05))
  t=game_to_bl(d['tail'])-game_to_bl(d['head']);rot=v.normalized().rotation_difference(t.normalized()).to_matrix()
  # Head/hips/spine use world orientation, preventing exporter-generated glTF tails from twisting faces.
  if d['name'] in ['hips','spine','chest','neck','head','footL','footR']:rot=Matrix.Identity(3)
  transforms[d['name']]=(a,game_to_bl(d['head']),rot)
 for ob in meshes:
  dg=bpy.context.evaluated_depsgraph_get();ev=ob.evaluated_get(dg);me=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=dg);ob.data=me
  ob.shape_key_clear();W=ob.matrix_world.copy();vg=[g.name for g in ob.vertex_groups];weights=[]
  for vertex in ob.data.vertices:
   acc={}
   for group in vertex.groups:
    target=mapping.get(vg[group.group],'hips');acc[target]=acc.get(target,0)+group.weight
   ranked=sorted(acc.items(),key=lambda x:-x[1])[:4];total=sum(w for _,w in ranked)
   ranked=[(n,w/total) for n,w in ranked] if total else [('hips',1)]
   p=orientation@(W@vertex.co);co=Vector()
   for n,w in ranked:
    a,b,rot=transforms[n];co+=(b+rot@((p-a)*scale))*w
   vertex.co=co;weights.append(ranked)
  ob.parent=None;ob.matrix_world=Matrix.Identity(4);ob.modifiers.clear();ob.vertex_groups.clear()
  groups={n:ob.vertex_groups.new(name=n) for n in names}
  for i,weights_i in enumerate(weights):
   for n,w in weights_i:groups[n].add([i],w,'REPLACE')
 bpy.ops.object.select_all(action='DESELECT')
 for ob in meshes:ob.select_set(True)
 bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();ob=bpy.context.object
 ob.name='SM_Ped'
 for other in bpy.data.objects:
  if other.type=='MESH' and other!=ob:other.hide_render=True
 return ob,defs

def textures(ob,key):
 specs=[]
 for i,m in enumerate(ob.data.materials):
  bs=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None) if m.use_nodes else None
  spec={'rough':.82,'metal':0}
  if bs:
   inp=bs.inputs['Base Color'];spec['c']=list(inp.default_value[:3])
   if inp.links:
    node=inp.links[0].from_node
    if node.type=='TEX_IMAGE' and node.image:
     im=node.image.copy();im.scale(1024,1024);name=key+'_'+str(i)+'_d';im.filepath_raw=OUT+'/props_tex/'+name+'.png';im.file_format='PNG';im.save();spec['d']=name;bpy.data.images.remove(im)
  specs.append(spec)
 return specs

def export_geo(ob,defs,name,lod,blob,specs,target,skin=True):
 dup=ob.copy();dup.data=ob.data.copy();bpy.context.collection.objects.link(dup);bpy.context.view_layer.objects.active=dup
 dup.data.calc_loop_triangles();n=len(dup.data.loop_triangles)
 if n>target:
  mod=dup.modifiers.new('LOD silhouette reduction','DECIMATE');mod.ratio=target/n;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
 me=dup.data;me.calc_loop_triangles();norm=me.corner_normals;uv=me.uv_layers.active;names=[d['name'] for d in defs];vg=[g.name for g in dup.vertex_groups]
 verts=[];indices=[];uvs=[];groups=[];cache={}
 for tri in sorted(me.loop_triangles,key=lambda t:t.material_index):
  mi=tri.material_index
  if not groups or groups[-1][2]!=mi:groups.append([len(indices),0,mi])
  for vi,li in zip(tri.vertices,tri.loops):
   v=me.vertices[vi];normal=norm[li].vector;u=tuple(uv.data[li].uv) if uv else (0,0);k=(vi,mi,tuple(round(c,3) for c in normal),u)
   if k not in cache:
    weights=sorted([(names.index(vg[g.group]),g.weight) for g in v.groups if vg[g.group] in names],key=lambda x:-x[1])[:4];total=sum(w for _,w in weights)
    if not total:weights=[(0,1)];total=1
    bi=[b for b,w in weights]+[0]*(4-len(weights));bw=[round(w/total*255) for b,w in weights]+[0]*(4-len(weights));bw[0]+=255-sum(bw)
    cache[k]=len(verts);verts.append((v.co.copy(),normal.copy(),mi,(bi,bw)));uvs.extend(u)
   indices.append(cache[k]);groups[-1][1]+=1
 meta={'hb':3,'lod':lod,'cat':'char','bones':defs,'tex':specs,'groups':groups,'skinned':skin}
 e=encode(name,verts,indices,[[1,1,1,0,0,.8,0] for _ in specs],blob,meta=meta,skinned=skin)
 e['uv']=blob.add(struct.pack('<%df'%len(uvs),*uvs));bpy.data.objects.remove(dup,do_unlink=True)
 return e

blob=Blob();man={'version':2,'assets':{},'people':[]};report=[]
for uid,key,variant in CONFIG:
 folder=ROOT+'/source/props_external/'+uid
 if not glob.glob(folder+'/scene.gl*') or not os.path.exists(ROOT+'/evidence/props/'+uid+'_source.png'):continue
 try:
  ob,defs=prepare(folder,variant);specs=textures(ob,key);name='PED_'+key
  man['assets'][name]={lod:export_geo(ob,defs,name,lod,blob,specs,target) for lod,target in [('hi',7000),('mid',3000),('lo',1300)]}
  # Far geometry derives from the same textured mesh; preserve the lower-detail full body.
  far=name+'_far';far_ob=ob.copy();far_ob.data=ob.data.copy();bpy.context.collection.objects.link(far_ob)
  joints={d['name']:game_to_bl(d['head']) for d in defs};vg=[g.name for g in far_ob.vertex_groups]
  for v in far_ob.data.vertices:
   out=v.co.copy()
   for side in ['L','R']:
    w=sum(g.weight for g in v.groups if vg[g.group] in ['uarm'+side,'farm'+side,'hand'+side]);pivot=joints['uarm'+side];direction=(joints['hand'+side]-pivot).normalized();rot=direction.rotation_difference(Vector((.13 if side=='L' else -.13,0,-1)).normalized())
    out+=(pivot+rot@(v.co-pivot)-v.co)*w
   v.co=out
  man['assets'][far]={'lo':export_geo(far_ob,defs,far,'lo',blob,specs,350,False)};bpy.data.objects.remove(far_ob,do_unlink=True)
  man['people'].append({'name':name,'variant':variant,'far':far,'uid':uid});report.append({'name':name,'tris':{l:e['ic']//3 for l,e in man['assets'][name].items()},'far':man['assets'][far]['lo']['ic']//3})
  bpy.ops.wm.save_as_mainfile(filepath=OUT+'/props_tex/'+key+'.blend');print('EXPORTED',report[-1],flush=True)
 except Exception as e:print('REJECTED',uid,str(e),flush=True)
for alias,key in [('PED_m','PED_business'),('PED_f','PED_office_blouse'),('PED_h','PED_worker'),('ped_lod','PED_business_far')]:
 if key in man['assets']:man['assets'][alias]=man['assets'][key]
open(OUT+'/people.bin','wb').write(blob.bytes());json.dump(man,open(OUT+'/people.json','w'),separators=(',',':'));json.dump(report,open(OUT+'/people_audit.json','w'),indent=2)
