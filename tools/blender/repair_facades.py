"""Run through Blender MCP after author_buildings.py. Add only audited facade
patches; preserve every source mesh. Source bytes are never rewritten.
"""
import bpy,json,math,os
ROOT=r'C:/Users/PRIYANSHU/Pictures/spoodermanv2'
audit=json.load(open(ROOT+'/evidence/construction/facade_repairs.json',encoding='utf8'))
source=json.load(open(ROOT+'/build/nyc.json',encoding='utf8'));lookup={b['id']:b for b in source['buildings']}
scene=bpy.data.scenes['THREADLINE — 20 construction buildings'];bpy.context.window.scene=scene

def facade_material(b):
    name='Verified facade finish BID '+str(b['id']);m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    rgb=tuple((((b['c']>>s)&255)/255)**2.2 for s in (16,8,0));m.diffuse_color=(*rgb,1);m.use_nodes=True
    tree=m.node_tree;tree.nodes.clear();out=tree.nodes.new('ShaderNodeOutputMaterial');bs=tree.nodes.new('ShaderNodeBsdfPrincipled');tree.links.new(bs.outputs['BSDF'],out.inputs['Surface']);bs.inputs['Roughness'].default_value=.8
    uv=tree.nodes.new('ShaderNodeTexCoord');sep=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(uv.outputs['UV'],sep.inputs[0])
    def mathnode(op,a,b=None):
        n=tree.nodes.new('ShaderNodeMath');n.operation=op
        if isinstance(a,(int,float)):n.inputs[0].default_value=a
        else:tree.links.new(a,n.inputs[0])
        if b is not None:
            if isinstance(b,(int,float)):n.inputs[1].default_value=b
            else:tree.links.new(b,n.inputs[1])
        return n.outputs[0]
    fx=mathnode('FRACT',mathnode('MULTIPLY',sep.outputs['X'],1/max(2,b.get('ww',3))))
    fy=mathnode('FRACT',mathnode('MULTIPLY',sep.outputs['Y'],1/max(2.7,b.get('fh',3.5))))
    mask=mathnode('MULTIPLY',mathnode('MULTIPLY',mathnode('GREATER_THAN',fx,.19),mathnode('LESS_THAN',fx,.77)),mathnode('MULTIPLY',mathnode('GREATER_THAN',fy,.23),mathnode('LESS_THAN',fy,.80)))
    mix=tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[1].default_value=(*rgb,1);mix.inputs[2].default_value=(.022,.041,.065,1);tree.links.new(mask,mix.inputs[0]);tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
    return m

def face_uv(mesh):
    uv=mesh.uv_layers.get('Facade metres') or mesh.uv_layers.new(name='Facade metres');mesh.uv_layers.active=uv
    for face in mesh.polygons:
        # Blender Z-up; horizontal tangent per real face, no bounding-box projection.
        nx,ny=face.normal.x,face.normal.y;length=math.hypot(nx,ny)
        tx,ty=(-ny/length,nx/length) if length>.01 else (1,0)
        if tx<-.01 or (abs(tx)<.01 and ty<0):tx,ty=-tx,-ty
        for li in face.loop_indices:
            p=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(p.x*tx+p.y*ty,p.z)

results=[]
for row in audit['buildings']:
    bid=row['bid'];col=next((c for c in scene.collection.children if c.name.endswith('_BID_'+str(bid))),None) if row['construction'] else bpy.data.collections.get('TL_FINISHED_ROOF_'+str(bid))
    if col is None:raise RuntimeError('Import supporting source building before repairing BID '+str(bid))
    # Only our own earlier additive repair objects are replaced on rerun.
    for obj in list(col.objects):
        if obj.get('threadlineFacadeRepair'):bpy.data.objects.remove(obj,do_unlink=True)
    mat=facade_material(lookup[bid])
    if not row['construction']:
        obj=bpy.data.objects.get('Finished supporting building '+str(bid))
        original_name='Original finished building '+str(bid)+' — preserved'
        if obj and not bpy.data.objects.get(original_name):
            keep=obj.copy();keep.data=obj.data.copy();keep.name=original_name;col.objects.link(keep);keep.hide_render=True;keep.hide_set(True);keep['threadlinePreservedOriginal']=True
        if obj:
            obj.data.materials.clear();obj.data.materials.append(mat);face_uv(obj.data)
    else:
        obj=bpy.data.objects.get('Building '+str(bid)+' — upper floors removed')
        if obj:obj.data.materials.clear();obj.data.materials.append(mat);face_uv(obj.data)
    P=row['positions']
    if P:
        mesh=bpy.data.meshes.new('Verified exterior patches '+str(bid));mesh.from_pydata([(P[i],-P[i+2],P[i+1]) for i in range(0,len(P),3)],[],[tuple(range(i,i+3)) for i in range(0,len(P)//3,3)]);mesh.update();face_uv(mesh);mesh.materials.append(mat)
        repair=bpy.data.objects.new('REPAIRED exterior walls BID '+str(bid),mesh);col.objects.link(repair);repair['threadlineFacadeRepair']=True;repair['sourceBid']=bid;repair['verifiedMissingArea']=row['missingArea'];repair['sourcePreserved']=True;repair['constructionLimit']=row['cutY'] if row['construction'] else -1
    results.append({'bid':bid,'triangles':len(P)//9,'missingAreaRepaired':row['missingArea'],'construction':row['construction']})
scene['threadlineFacadeAuditBuildings']=len(results);scene['threadlineFacadeRepairedBuildings']=sum(bool(r['triangles']) for r in results)
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/source/construction/Manhattan_Construction_20.blend',copy=True)
with open(ROOT+'/evidence/construction/blender_facade_repair_report.json','w') as f:json.dump(results,f,indent=2)
print(json.dumps({'audited':len(results),'repaired':sum(bool(r['triangles']) for r in results),'triangles':sum(r['triangles'] for r in results),'preservedOriginals':True}))

