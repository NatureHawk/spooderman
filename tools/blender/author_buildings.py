import bpy, json, os, math, gzip, bmesh, copy, sys
from mathutils import Vector
ROOT=r'C:/Users/PRIYANSHU/Pictures/spoodermanv2'
manifest=json.load(open(ROOT+'/evidence/construction/building_manifest.json',encoding='utf8'))['sites']
first=json.load(open(ROOT+'/evidence/construction/blueprints_0_9.json',encoding='utf8'))
second=json.load(open(ROOT+'/evidence/construction/blueprints_10_19.json',encoding='utf8'))['sites']
blueprints={p['index']:p for p in first+second}
exact_path=ROOT+'/evidence/construction/structural_blueprints_20.json'
if os.path.exists(exact_path):
    exact=json.load(open(exact_path,encoding='utf8'))
    exact=exact.get('sites',[]) if isinstance(exact,dict) else exact
    if len(exact)==20:blueprints={p['index']:p for p in exact}
sys.path.insert(0,ROOT+'/tools/blender')
try:
    from detail_parts import expand_details
except ImportError:
    expand_details=lambda model:model
scene=bpy.data.scenes['THREADLINE — 20 construction buildings'];bpy.context.window.scene=scene
palette={'concrete':(.34,.33,.30),'steel':(.12,.14,.15),'wood':(.30,.18,.08),'timber':(.53,.33,.15),'rust':(.25,.105,.042),'orange':(.76,.36,.035),'lamp':(.9,.72,.35),'net':(.36,.20,.075),'tarp':(.035,.13,.28),'glass':(.09,.15,.19),'teal':(.11,.22,.20)}
mats={}
for name,color in palette.items():
    mat=bpy.data.materials.get('TL construction '+name) or bpy.data.materials.new('TL construction '+name)
    mat.diffuse_color=(*color,1);mat.use_nodes=True
    bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=.88 if name not in ['steel','rust'] else .6
    bs.inputs['Metallic'].default_value=.5 if name in ['steel','rust'] else 0
    mats[name]=mat
def xyz(p):return (p[0],-p[2],p[1])
def add_box(V,F,p):
    n=len(V);x,y,z=p['x'],p['y'],p['z'];a,b,c=p['hx'],p['hy'],p['hz']
    V.extend([(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),(x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)])
    F.extend([tuple(n+j for j in q) for q in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]])
def add_rod(V,F,a,b,r,segments=8):
    a,b=Vector(a),Vector(b);d=(b-a).normalized();u=d.cross(Vector((0,1,0)) if abs(d.y)<.9 else Vector((1,0,0))).normalized();v=d.cross(u);n=len(V)
    for p in [a,b]:
        for i in range(segments):V.append(tuple(p+r*(math.cos(i*math.tau/segments)*u+math.sin(i*math.tau/segments)*v)))
    F.append(tuple(n+i for i in reversed(range(segments))));F.append(tuple(n+segments+i for i in range(segments)))
    for i in range(segments):j=(i+1)%segments;F.append((n+i,n+j,n+segments+j,n+segments+i))
def geometry(p):
    V=[];F=[];shape=p['shape'];mat=p['mat']
    if shape=='footprint':
        P=p['positions'];V=[tuple(P[i:i+3]) for i in range(0,len(P),3)];F=[tuple(range(i,i+3)) for i in range(0,len(V),3)]
    elif shape=='beam':add_rod(V,F,p['a'],p['b'],p['r'])
    elif shape=='box' and mat=='tarp':
        hs=[p['hx'],p['hy'],p['hz']];thin=min(range(3),key=lambda k:hs[k]);axes=[k for k in range(3) if k!=thin];center=[p['x'],p['y'],p['z']];nu,nv=18,14
        for j in range(nv+1):
            for i in range(nu+1):
                u,v=i/nu,j/nv;q=center.copy();q[axes[0]]+=(u*2-1)*hs[axes[0]];q[axes[1]]+=(v*2-1)*hs[axes[1]]
                q[thin]+=.045*math.sin(u*47+v*6)*math.sin(math.pi*v)+.023*math.sin(v*39-u*5);V.append(tuple(q))
        for j in range(nv):
            for i in range(nu):k=j*(nu+1)+i;F.append((k,k+1,k+nu+2,k+nu+1))
    elif shape=='box' and mat=='net':
        hs=[p['hx'],p['hy'],p['hz']];thin=min(range(3),key=lambda k:hs[k]);axes=[k for k in range(3) if k!=thin];center=[p['x'],p['y'],p['z']]
        for axis in axes:
            other=axes[1] if axis==axes[0] else axes[0];num=max(2,math.ceil(hs[axis]*2/.22))
            for i in range(num+1):
                a=center.copy();b=center.copy();a[axis]+=hs[axis]*(i/num*2-1);b[axis]=a[axis];a[other]-=hs[other];b[other]+=hs[other];add_rod(V,F,a,b,.013,4)
    elif shape=='box':add_box(V,F,p)
    elif shape in ['ring','hoop']:
        N,K=32,6;n=len(V)
        for i in range(N):
            a=i*math.tau/N
            for j in range(K):
                b=j*math.tau/K;r=p['radius']+p['r']*math.cos(b);v=[r*math.cos(a),r*math.sin(a),p['r']*math.sin(b)]
                if shape=='hoop':v=[v[0],v[2],v[1]]
                V.append((v[0]+p['x'],v[1]+p['y'],v[2]+p['z']))
        for i in range(N):
            for j in range(K):F.append((i*K+j,((i+1)%N)*K+j,((i+1)%N)*K+(j+1)%K,i*K+(j+1)%K))
    elif shape=='pipe':
        N=40
        for r,z in [(p['inner'],-p['half']),(p['radius'],-p['half']),(p['radius'],p['half']),(p['inner'],p['half'])]:
            for i in range(N):a=i*math.tau/N;V.append((p['x']+r*math.cos(a),p['y']+r*math.sin(a),p['z']+z))
        for j in range(4):
            for i in range(N):k=(i+1)%N;F.append((j*N+i,j*N+k,((j+1)%4)*N+k,((j+1)%4)*N+i))
    elif shape in ['tank','cap']:
        N=32
        for y,r in [(-p['height']/2,p['radius']),(p['height']/2,0 if shape=='cap' else p['radius'])]:
            for i in range(N):a=i*math.tau/N;V.append((p['x']+r*math.cos(a),p['y']+y,p['z']+r*math.sin(a)))
        for i in range(N):k=(i+1)%N;F.append((i,k,N+k,N+i))
        F.extend([tuple(reversed(range(N))),tuple(range(N,N*2))])
    else:raise Exception('Unsupported authored part '+shape)
    return V,F
def export_model(model,collection,origin,bid,name,notes):
    global objects,triangles
    buckets={}
    for k,p in enumerate(model['parts']):
        V,F=geometry(p)
        if not V:continue
        mesh=bpy.data.meshes.new('%s part%03d'%(name,k));mesh.from_pydata([xyz(v) for v in V],[],F);mesh.update()
        if p['shape']!='footprint':
            bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free()
        mesh.materials.append(mats[p['mat']]);obj=bpy.data.objects.new('%s | %s %03d'%(name,p['mat'],k),mesh);collection.objects.link(obj);obj.parent=origin
        obj['threadlineAuthoredUpper']=True;obj['sourceBid']=bid;obj['partIndex']=k;obj['designNotes']=notes;objects+=1
        if p['shape']=='box' and p['mat'] not in ['net','tarp']:
            width=min(p.get('bevel',.025 if p['mat']=='concrete' else .014),min(p['hx'],p['hy'],p['hz'])*.18)
            if width>.002:
                bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.bevel(bm,geom=list(bm.edges),offset=width,segments=1,affect='EDGES',clamp_overlap=True);bm.to_mesh(mesh);bm.free();mesh.update()
        if p['shape'] in ['pipe','tank','ring','hoop','cap']:
            for polygon in mesh.polygons:polygon.use_smooth=True
        m=mesh;m.calc_loop_triangles()
        B=buckets.setdefault(p['mat'],{'mat':p['mat'],'position':[],'normal':[],'uv':[]})
        for tri in m.loop_triangles:
            triangles+=1
            for vi,li in zip(tri.vertices,tri.loops):
                v=m.vertices[vi].co
                normal=m.corner_normals[li].vector if hasattr(m,'corner_normals') else tri.normal
                B['position'].extend([round(v.x,6),round(v.z,6),round(-v.y,6)])
                B['normal'].extend([round(normal.x,6),round(normal.z,6),round(-normal.y,6)])
                B['uv'].extend([round(v.x*.25,5),round(v.z*.25,5)])
    return list(buckets.values())

export=[];objects=0;triangles=0
only=list(scene.get('threadlineRebuildIndices',[]))
if not only and ('exact' not in globals() or len(exact)!=20):
    raise RuntimeError('Full export requires twenty completed exact-footprint structural blueprints')
cached={}
if only and os.path.exists(ROOT+'/build/extra/construction_authored.json.gz'):
    cached={s['roofBid']:s for s in json.load(gzip.open(ROOT+'/build/extra/construction_authored.json.gz','rt',encoding='utf8'))['sites']}
for index,site in enumerate(manifest):
    if only and index not in only:export.append(cached[site['roofBid']]);continue
    plan=copy.deepcopy(blueprints[index]);plan['model']=expand_details(plan['model']);bid=site['roofBid'];collection=bpy.data.collections['TL_SITE_%02d_BID_%s'%(index+1,bid)];origin=bpy.data.objects['AUTHORING ORIGIN %s'%bid]
    # Idempotently replace only objects created by this authoring script.
    for obj in list(collection.objects):
        if obj.get('threadlineAuthoredUpper'):bpy.data.objects.remove(obj,do_unlink=True)
    model=plan['model']
    if model.get('tower') or any(p['shape'] in ['tank','cap'] for p in model['parts']):raise RuntimeError('Water tank remains on unfinished building %s'%bid)
    if any(i<0 or i>=len(model['solids']) or model['solids'][i].get('kind')!='pipe' for i in model.get('pipeSolids',[])):raise RuntimeError('Invalid pipe solid indices on building %s'%bid)
    meshes=export_model(model,collection,origin,bid,plan['name'],plan['designNotes'])
    record={k:v for k,v in site.items() if k not in ['original','clipped']};record.update(name=plan['name'],designNotes=plan['designNotes'],model=plan['model'],meshes=meshes)
    export.append(record);print('Authored building %d/20: %s'%(index+1,plan['name']))
    with open(ROOT+'/evidence/construction/blender_progress.json','w') as progress:json.dump({'completedIndex':index,'name':plan['name'],'objects':objects,'triangles':triangles},progress)
# Finished roof tanks are separately authored and never parented to unfinished sites.
relocated=json.load(open(ROOT+'/evidence/construction/relocated_towers.json',encoding='utf8'))
towers=[]
import struct
nyc=json.load(open(ROOT+'/build/nyc.json',encoding='utf8'))
with open(ROOT+'/build/nyc.bin','rb') as source:nyc_bytes=source.read()
for t in relocated['towers']:
    bid=t['roofBid'];cname='TL_FINISHED_ROOF_%s'%bid
    collection=bpy.data.collections.get(cname)
    if collection is None:
        collection=bpy.data.collections.new(cname);scene.collection.children.link(collection)
        b=next(b for b in nyc['buildings'] if b['id']==bid)
        positions=struct.unpack_from('<%sf'%(b['n']*9),nyc_bytes,b['o'])
        mesh=bpy.data.meshes.new('Finished building %s original'%bid)
        mesh.from_pydata([xyz(positions[i:i+3]) for i in range(0,len(positions),3)],[],[tuple(range(i,i+3)) for i in range(0,len(positions)//3,3)])
        mesh.update();obj=bpy.data.objects.new('Finished supporting building %s'%bid,mesh);collection.objects.link(obj)
        marker=bpy.data.objects.new('FINISHED TOWER ORIGIN %s'%bid,None);collection.objects.link(marker)
    origin=bpy.data.objects['FINISHED TOWER ORIGIN %s'%bid]
    origin.location=(t['x'],-t['z'],t['y']);origin.rotation_euler.z=t['yaw']
    for obj in list(collection.objects):
        if obj.get('threadlineAuthoredUpper'):bpy.data.objects.remove(obj,do_unlink=True)
    record=copy.deepcopy(t)
    record['meshes']=export_model(record['model'],collection,origin,bid,'Finished roof tank %s'%bid,'Tank supported on a completed neighbouring roof')
    towers.append(record)
os.makedirs(ROOT+'/build/extra',exist_ok=True)
with gzip.open(ROOT+'/build/extra/construction_authored.json.gz','wt',encoding='utf8',compresslevel=9) as f:json.dump({'version':3,'authoring':'Blender: twenty imported buildings with individually specified construction plans','sites':export,'towers':towers,'siteLinks':relocated['siteLinks']},f,separators=(',',':'))
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/source/construction/Manhattan_Construction_20.blend',copy=True)
print(json.dumps({'buildings':len(export),'authoredObjects':objects,'triangles':triangles,'assetBytes':os.path.getsize(ROOT+'/build/extra/construction_authored.json.gz')}))
