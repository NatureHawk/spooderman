import bpy, bmesh, json, os, math
from mathutils import Vector
ROOT = r'C:/Users/PRIYANSHU/Pictures/spoodermanv2'
manifest = json.load(open(ROOT+'/evidence/construction/building_manifest.json', encoding='utf8'))
scene = bpy.data.scenes.get('THREADLINE — 20 construction buildings')
if scene is None:
    scene = bpy.data.scenes.new('THREADLINE — 20 construction buildings')
bpy.context.window.scene = scene
def xyz(p): return (p[0], -p[2], p[1])
for index, site in enumerate(manifest['sites']):
    bid = site['roofBid']
    name = 'TL_SITE_%02d_BID_%s' % (index+1, bid)
    col = bpy.data.collections.get(name)
    if col is not None: continue
    col = bpy.data.collections.new(name); scene.collection.children.link(col)
    p = site['original']['positions']; uv = site['original']['uv']
    mesh = bpy.data.meshes.new('Original scan building %s' % bid)
    mesh.from_pydata([xyz(p[i:i+3]) for i in range(0,len(p),3)], [], [tuple(range(i,i+3)) for i in range(0,len(p)//3,3)])
    mesh.update()
    layer = mesh.uv_layers.new(name='Original scan UV')
    if len(uv)==len(p)//3*2:
        for loop in mesh.loops: layer.data[loop.index].uv = uv[loop.vertex_index*2:loop.vertex_index*2+2]
    color = site['original'].get('color', 0x8b8e93)
    mat = bpy.data.materials.new('Existing facade %s' % bid);mat.diffuse_color=tuple((((color>>s)&255)/255)**2.2 for s in [16,8,0])+(1,)
    mat.roughness=.85;mesh.materials.append(mat)
    original=bpy.data.objects.new('Original complete building %s — preserved' % bid,mesh);col.objects.link(original)
    original['threadlineConstruction']=True;original['sourceBid']=bid
    retained=bpy.data.objects.new('Building %s — upper floors removed' % bid,mesh.copy());col.objects.link(retained)
    retained['threadlineConstruction']=True;retained['sourceBid']=bid;retained['cutY']=site['cutY']
    bm=bmesh.new();bm.from_mesh(retained.data)
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,site['cutY']),plane_no=(0,0,1),clear_outer=True,clear_inner=False)
    bm.to_mesh(retained.data);bm.free();retained.data.update()
    original.hide_render=True;original.hide_set(True)
    marker=bpy.data.objects.new('AUTHORING ORIGIN %s' % bid,None);col.objects.link(marker)
    marker.location=(site['x'],-site['z'],site['baseY']);marker.rotation_euler.z=site['yaw'];marker.empty_display_size=1
    marker['threadlineConstruction']=True;marker['sourceBid']=bid
os.makedirs(ROOT+'/source/construction',exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/source/construction/Manhattan_Construction_20.blend',copy=True)
print(json.dumps({'importedBuildings':len(manifest['sites']),'scene':scene.name,'collections':len(scene.collection.children),'preservedOriginalScene':bpy.data.scenes.get('Scene') is not None,'blend':ROOT+'/source/construction/Manhattan_Construction_20.blend'}))
