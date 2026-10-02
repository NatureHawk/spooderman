"""THREADLINE — shared Blender helpers for the "life" props (carts, stoops, shelters, waterfront kit, boats).

Run inside Blender (`blender -b --python tools/hd/life_props.py`). Models are plain mesh objects grouped by a model name
(collection name == model name). `export(models, out_dir)` writes, into <out_dir> (= <build>/extra):
  life_models.bin.gz   geometry   per (model, material): pos f32x3 | nrm i8x4 | uv f32x2 | idx u16/u32 | col u8x4 (vertex colour, ao/tint)
  life_models.json     { models: { name: { bbox, parts: [{mat, n, i, i32, pos, nrm, uv, col, idx}] } }, mats: { name: {...} } }
  life_tex_<name>.webp textures referenced by a material's `map` (downscaled)
Conventions: model space is metres, game axes (x east, y up, z south); the Blender -> game conversion is (x, y, z) -> (x, z, -y).
Materials are read from the Principled BSDF (base colour / roughness / metallic / emission) or the image texture on it.
"""
import bpy, bmesh, gzip, json, math, os, sys
import numpy as np
from mathutils import Matrix, Vector


def log(*a): print('[life]', *a, flush=True)


# ------------------------------------------------------------------ material helpers
def mat_flat(name, rgb, rough=0.7, metal=0.0, emit=None, alpha=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    if emit:
        bs.inputs['Emission Color'].default_value = (emit[0], emit[1], emit[2], 1)
        bs.inputs['Emission Strength'].default_value = emit[3] if len(emit) > 3 else 1.0
    m['life_alpha'] = alpha if alpha is not None else 0
    m.diffuse_color = (rgb[0], rgb[1], rgb[2], 1)                      # workbench previews
    return m


def srgb(h):
    """0xRRGGBB -> linear rgb"""
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ------------------------------------------------------------------ primitive builders (model space: Blender Z-up, metres)
def add_obj(name, bm, mat, col, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if mat is not None: me.materials.append(mat)
    return ob


def box(bm, c, s, rot_z=0.0):
    """box centred at c=(x,y,z) with size s=(sx,sy,sz), optional rotation about Z"""
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(s), verts=r['verts'])
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_z, 3, 'Z'), verts=r['verts'])
    bmesh.ops.translate(bm, vec=Vector(c), verts=r['verts'])
    return r


def cyl(bm, c, r, h, seg=12, axis='Z', r2=None):
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    v = res['verts']
    if axis == 'X': bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=v)
    elif axis == 'Y': bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=v)
    bmesh.ops.translate(bm, vec=Vector(c), verts=v)
    return res


def prism(bm, pts, y0, y1):
    """polygon given as (x, height) points, extruded along Y between y0 and y1"""
    vs0 = [bm.verts.new((x, y0, z)) for x, z in pts]
    vs1 = [bm.verts.new((x, y1, z)) for x, z in pts]
    bm.faces.new(vs0[::-1]); bm.faces.new(vs1)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vs0[i], vs0[j], vs1[j], vs1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


# game-frame wrappers (x east, y up, z south) for the waterfront / boat builders: game (x, y, z) = Blender (x, z, -y)
def G(c): return (c[0], -c[2], c[1])


def box_g(bm, c, s, rot_y=0.0):
    return box(bm, G(c), (s[0], s[2], s[1]), -rot_y)


def cyl_g(bm, c, r, h, seg=12, axis='y', r2=None):
    ax = {'y': 'Z', 'x': 'X', 'z': 'Y'}[axis]
    return cyl(bm, G(c), r, h, seg, ax, r2)


def sphere(bm, c, r, seg=10):
    res = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(4, seg // 2), radius=r)
    bmesh.ops.translate(bm, vec=Vector(c), verts=res['verts'])
    return res


# ------------------------------------------------------------------ export
def to_game(v):
    return (v[0], v[2], -v[1])


def collect(col_name):
    col = bpy.data.collections.get(col_name)
    return [o for o in col.all_objects if o.type == 'MESH'] if col else []


def part_arrays(objs, mat_name, tex_name=None):
    P, N, UV, C = [], [], [], []
    for ob in objs:
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        try: me.calc_normals_split()
        except Exception: pass
        uv = me.uv_layers.active.data if me.uv_layers.active else None
        vc = me.color_attributes.active if me.color_attributes else None
        W = ob.matrix_world
        Wn = W.to_3x3().inverted_safe().transposed()
        for t in me.loop_triangles:
            if me.materials[t.material_index].name != mat_name if len(me.materials) else False: continue
            for k in range(3):
                li = t.loops[k]; vi = t.vertices[k]
                p = W @ me.vertices[vi].co
                n = (Wn @ (me.corner_normals[li].vector if hasattr(me, 'corner_normals') else me.vertices[vi].normal)).normalized()
                P.append(to_game(p)); N.append(to_game(n))
                UV.append((uv[li].uv[0], uv[li].uv[1]) if uv else (0.0, 0.0))
                if vc is not None and vc.domain == 'CORNER': c = vc.data[li].color
                elif vc is not None: c = vc.data[vi].color
                else: c = (1, 1, 1, 1)
                C.append(c)
        ev.to_mesh_clear()
    return np.array(P, np.float32), np.array(N, np.float32), np.array(UV, np.float32), np.array(C, np.float32)


def weld(P, N, UV, C):
    """merge identical vertices -> (P, N, UV, C, idx)"""
    key = np.concatenate([np.round(P * 1000).astype(np.int64), np.round(N * 60).astype(np.int64), np.round(UV * 4000).astype(np.int64), np.round(C * 30).astype(np.int64)], 1)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return P[first], N[first], UV[first], C[first], inv.reshape(-1).astype(np.uint32)


def mat_info(m, out_dir, tex_px):
    bs = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
    d = dict(color=[1, 1, 1], rough=0.7, metal=0.0)
    if bs:
        c = bs.inputs['Base Color']
        lin = lambda v: v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        d['color'] = [round(lin(float(x)), 4) for x in c.default_value[:3]]          # stored as sRGB: the game sets material colours in display space
        d['rough'] = round(float(bs.inputs['Roughness'].default_value), 3)
        d['metal'] = round(float(bs.inputs['Metallic'].default_value), 3)
        e = bs.inputs['Emission Strength'].default_value if 'Emission Strength' in bs.inputs else 0
        if e > 0 and any(x > 0.01 for x in bs.inputs['Emission Color'].default_value[:3]):
            d['emit'] = [round(lin(float(x)), 3) for x in bs.inputs['Emission Color'].default_value[:3]] + [round(float(e), 2)]
        for lk in c.links:
            if lk.from_node.type == 'TEX_IMAGE' and lk.from_node.image:
                img = lk.from_node.image
                d['map'] = save_tex(img, 'life_tex_%s.webp' % m.name, out_dir, tex_px)
        for key in ('Alpha',):
            for lk in bs.inputs[key].links:
                if lk.from_node.type == 'TEX_IMAGE' and lk.from_node.image:
                    d['alphaMap'] = save_tex(lk.from_node.image, 'life_alpha_%s.webp' % m.name, out_dir, tex_px)
    if m.get('life_alpha'): d['alpha'] = float(m['life_alpha'])
    return d


def save_tex(img, fname, out_dir, px):
    """downscale a copy of the image and write it as WEBP through Blender (no PIL inside Blender's Python)"""
    w, h = img.size
    cp = img.copy()
    s = min(1.0, px / max(w, h))
    if s < 1: cp.scale(max(1, int(w * s)), max(1, int(h * s)))
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = 'WEBP'; st.quality = 88; st.color_mode = 'RGBA' if cp.channels == 4 else 'RGB'
    cp.save_render(os.path.join(out_dir, fname), scene=sc)
    bpy.data.images.remove(cp)
    return fname


def export(models, out_dir, tex_px=1024):
    """models: list of collection names"""
    os.makedirs(out_dir, exist_ok=True)
    parts_b, off = [], 0

    def put(a):
        nonlocal off
        b = a.tobytes(); pad = (-len(b)) % 4
        parts_b.append(b + b'\0' * pad); o = off; off += len(b) + pad; return o

    meta = dict(v=1, models={}, mats={})
    for name in models:
        objs = collect(name)
        if not objs: log('empty model', name); continue
        mats = []
        for ob in objs:
            for m in ob.data.materials:
                if m and m.name not in mats: mats.append(m.name)
        ent = dict(parts=[], tris=0)
        mn = np.array([1e9] * 3); mx = np.array([-1e9] * 3)
        for mname in mats:
            P, N, UV, C = part_arrays(objs, mname)
            if not len(P): continue
            P, N, UV, C, I = weld(P, N, UV, C)
            mn = np.minimum(mn, P.min(0)); mx = np.maximum(mx, P.max(0))
            Nq = np.zeros((len(P), 4), np.int8); Nq[:, :3] = np.round(np.clip(N, -1, 1) * 127)
            Cq = np.round(np.clip(C, 0, 1) * 255).astype(np.uint8)
            Iq = I.astype(np.uint16 if len(P) < 65536 else np.uint32)
            ent['parts'].append(dict(mat=mname, n=int(len(P)), i=int(len(Iq)), i32=int(Iq.dtype == np.uint32), pos=put(P.astype(np.float32)), nrm=put(Nq), uv=put(UV.astype(np.float32)), col=put(Cq), idx=put(Iq)))
            ent['tris'] += len(Iq) // 3
            if mname not in meta['mats']: meta['mats'][mname] = mat_info(bpy.data.materials[mname], out_dir, tex_px)
        ent['bbox'] = [np.round(mn, 3).tolist(), np.round(mx, 3).tolist()]
        meta['models'][name] = ent
        log('%-18s %6d tris, %d materials, bbox %s -> %s' % (name, ent['tris'], len(ent['parts']), ent['bbox'][0], ent['bbox'][1]))
    blob = b''.join(parts_b)
    with gzip.open(os.path.join(out_dir, 'life_models.bin.gz'), 'wb', compresslevel=9) as f: f.write(blob)
    meta['bytes'] = len(blob)
    with open(os.path.join(out_dir, 'life_models.json'), 'w') as f: json.dump(meta, f, separators=(',', ':'))
    log('life_models.bin.gz %.2f MB' % (os.path.getsize(os.path.join(out_dir, 'life_models.bin.gz')) / 1048576))
    return meta
