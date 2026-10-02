import bpy,os,json,glob
root=r'C:/Users/PRIYANSHU/Pictures/spooderman_props'
for folder in glob.glob(root+'/source/props_external/*'):
 files=glob.glob(folder+'/scene.gl*')
 if not files:continue
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=files[0])
 meshes=[o for o in bpy.data.objects if o.type=='MESH'];rigs=[o for o in bpy.data.objects if o.type=='ARMATURE']
 data={'uid':os.path.basename(folder),'meshes':[{'name':o.name,'verts':len(o.data.vertices),'materials':[m.name for m in o.data.materials],'dimensions':list(o.dimensions)} for o in meshes], 'rigs':[{ 'name':o.name,'bones':[b.name for b in o.data.bones]} for o in rigs]}
 json.dump(data,open(folder+'/inspection.json','w'));print(json.dumps(data),flush=True)
