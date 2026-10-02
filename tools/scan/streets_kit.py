"""THREADLINE streets — Blender side: pull the street-furniture props out of the user's NYC street set
(src/street/source/ZZ60c.zip: a SketchUp/Collada street with ~3,700 loose pieces) into plain triangle arrays.

Run headless (tools/scan/streets.py does this for you):
  blender -b --python tools/scan/streets_kit.py -- <model.dae> <out.npz>

Every prop is picked by its bounding box in the set (Blender units after the Collada import, Z up) and all pieces
lying fully inside that box are merged. SketchUp exports every face twice (front + back face with the default back
material); the back copies are dropped here so the runtime can render single sided where it wants.
Output npz: for each prop name P: P_pos (n,3,3) world Z-up, P_uv (n,3,2), P_mat (n,) material names (as an index into
'mats'), plus 'mats' (material -> image file or '' for a flat colour) and 'cols' (flat colours).
"""
import bpy, sys, numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
DAE, OUT = argv[0], argv[1]

# name: the set's pieces that make up that prop (Blender object names after the Collada import; deterministic)
PICKS = {
    'signal': ['group_0.1019', 'group_0.114', 'group_0.320', 'group_0.321', 'group_0.322', 'group_0.323', 'group_0.324', 'group_0.347', 'group_0.348', 'group_0.349', 'group_0.350', 'group_0.351', 'group_0.352', 'group_0.353', 'group_0.354', 'group_0.355', 'group_0.356', 'group_0.357', 'group_0.358', 'group_0.367', 'group_0.368', 'group_0.3763', 'group_0.5686', 'group_0.5687', 'group_0.5879', 'group_0.6058', 'group_0.6059', 'group_0.6060', 'group_0.6061', 'group_0.6062', 'group_0.6072', 'group_0.6073', 'group_0.6074', 'group_0.6075', 'group_0.699', 'group_0.759'],
    'light_a': ['group_0.316', 'group_0.317', 'group_0.340', 'group_0.341', 'group_0.343', 'group_0.4323', 'group_0.5876', 'group_0.6069'],
    'light_b': ['group_0.331', 'group_0.332', 'group_0.333', 'group_0.336', 'group_0.5694', 'group_0.5695', 'group_0.6064', 'group_0.6066'],
    'sign': ['group_0.3863', 'group_0.4344'],
    'lantern': ['group_0.3811', 'group_0.3813', 'group_0.3814', 'group_0.3815', 'group_0.4912', 'group_0.4914'],
    'meter': ['group_0.4881', 'group_0.865'],
    'mailbox': ['group_0.4354', 'group_0.4834'],
    'trash_a': ['group_0.6053'],
    'trash_b': ['group_0.6055'],
    'hydrant': ['group_0.163', 'group_0.4828'],
    'bollard': ['group_0.5691'],
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.collada_import(filepath=DAE)
bpy.context.view_layer.update()

mats, cols = [], []
def mat_index(m):
    name = m.name if m else '-'
    if name in mats: return mats.index(name)
    img = ''
    col = (0.0, 0.0, 0.0)
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image: img = bpy.path.abspath(n.image.filepath)
            if n.type == 'BSDF_PRINCIPLED': col = tuple(n.inputs['Base Color'].default_value[:3])
    mats.append(name); cols.append((img,) + tuple(col))
    return len(mats) - 1

objs = []
for o in bpy.data.objects:
    if o.type != 'MESH' or not o.data.vertices: continue
    M = o.matrix_world
    V = np.array([tuple(M @ v.co) for v in o.data.vertices])
    objs.append((o, V, V.min(0), V.max(0)))

out = {}
for name, names in PICKS.items():
    names = set(names)
    P, U, MI = [], [], []
    keys = {}
    for o, V, mn, mx in objs:
        if o.name not in names: continue
        me = o.data; uvl = me.uv_layers.active
        me.calc_loop_triangles()
        for t in me.loop_triangles:
            vi = list(t.vertices)
            tri = V[vi]
            uv = np.array([tuple(uvl.data[l].uv) for l in t.loops]) if uvl else np.zeros((3, 2))
            m = me.materials[t.material_index] if me.materials else None
            k = tuple(sorted(np.round(tri, 4).reshape(-1, 3).tolist()))
            k = tuple(map(tuple, k))
            mi = mat_index(m)
            # front/back duplicate: keep the textured, non-default copy
            if k in keys:
                j = keys[k]
                prev = mats[MI[j]]
                if prev in ('M0_0_0_38', 'proxy_2', '-') and mats[mi] not in ('M0_0_0_38', 'proxy_2', '-'):
                    P[j], U[j], MI[j] = tri, uv, mi
                continue
            keys[k] = len(P); P.append(tri); U.append(uv); MI.append(mi)
    print('PROP', name, len(P), 'tris')
    out[name + '_pos'] = np.array(P, np.float32)
    out[name + '_uv'] = np.array(U, np.float32)
    out[name + '_mat'] = np.array(MI, np.int32)
out['mats'] = np.array(mats)
out['cols'] = np.array([c[0] for c in cols])
out['colv'] = np.array([c[1:] for c in cols], np.float32)
np.savez(OUT, **out)
print('WROTE', OUT)
