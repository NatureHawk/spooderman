# THREADLINE asset exporter (export-pipeline skill): Blender -> compact binary for the single-file game.
# Output: build/assets.bin (little-endian sections, 4-byte aligned) + build/assets.json (manifest).
# Per asset: positions int16x3 (quantized to bbox), normals int8x4 (split at hard-edge angle),
# material index uint8 per vertex, optional bones uint8x4 + weights uint8x4, indices uint16/uint32.
# Axis conversion: Blender (x, y, z) -> game (x, z, -y).
import bpy, bmesh, math, json, struct, os
from mathutils import Vector

OUT_DIR = r"C:/Users/PRIYANSHU/Pictures/spooderman/build"
SLOT_IDS = {'slot_primary': 1, 'slot_secondary': 2, 'slot_accent': 3, 'slot_dark': 4, 'slot_glow_emit': 5,
            'slot_glow': 5, 'slot_skin': 6, 'slot_body': 7}

def mat_entry(m):
    """Palette entry [r,g,b,slot,emissive,rough,metal] (colors in sRGB 0..1)."""
    if m is None:
        return [0.6, 0.6, 0.6, 0, 0, 0.8, 0.0]
    rgb = list(m.get('tl_rgb', list(m.diffuse_color)[:3]))
    emit = int(m.get('tl_emit', 1 if 'emit' in m.name else 0))
    slot = SLOT_IDS.get(m.name, 0)
    rough, metal = 0.8, 0.0
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
    if b:
        try:
            rough = float(b.inputs['Roughness'].default_value); metal = float(b.inputs['Metallic'].default_value)
            if 'tl_rgb' not in m:
                c = b.inputs['Base Color'].default_value
                rgb = [c[0], c[1], c[2]]
        except Exception:
            pass
    if 'glass' in m.name: rough = 0.1
    return [round(rgb[0], 4), round(rgb[1], 4), round(rgb[2], 4), slot, emit, round(rough, 3), round(metal, 3)]

class Blob:
    def __init__(self):
        self.parts = []; self.size = 0
    def add(self, data):
        off = self.size
        pad = (4 - len(data) % 4) % 4
        self.parts.append(data + b'\0' * pad)
        self.size += len(data) + pad
        return off
    def bytes(self):
        return b''.join(self.parts)

def mesh_arrays(ob, hard_angle=40.0, bones=None, decimate=None):
    """Evaluate mesh (modifiers applied), triangulate, split normals by angle, collect per-vertex data."""
    dg = bpy.context.evaluated_depsgraph_get()
    src = ob
    tmpmod = None
    if decimate:
        tmpmod = ob.modifiers.new("TL_DEC", 'DECIMATE'); tmpmod.ratio = decimate; tmpmod.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    if tmpmod:
        ob.modifiers.remove(tmpmod)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
    cos_t = math.cos(math.radians(hard_angle))
    deform = bm.verts.layers.deform.active if bones is not None else None
    vg_names = [g.name for g in ob.vertex_groups] if bones is not None else []
    mats = [s.material for s in ob.material_slots] or [None]
    fn = {f.index: f.normal.copy() for f in bm.faces}
    fa = {f.index: max(f.calc_area(), 1e-9) for f in bm.faces}
    verts = []; index = []; keymap = {}
    for f in bm.faces:
        n_f = fn[f.index]
        mi = min(f.material_index, len(mats) - 1)
        tri = []
        for v in f.verts:
            acc = Vector((0, 0, 0))
            for g in v.link_faces:
                if fn[g.index].dot(n_f) >= cos_t:
                    acc += fn[g.index] * fa[g.index]
            n = acc.normalized() if acc.length > 1e-12 else n_f
            key = (v.index, mi, round(n.x, 2), round(n.y, 2), round(n.z, 2))
            idx = keymap.get(key)
            if idx is None:
                idx = len(verts)
                keymap[key] = idx
                bw = None
                if deform is not None:
                    ws = []
                    for gi, w in v[deform].items():
                        if gi < len(vg_names) and vg_names[gi] in bones and w > 0.001:
                            ws.append((w, bones.index(vg_names[gi])))
                    ws.sort(reverse=True)
                    ws = ws[:4]
                    tot = sum(w for w, _ in ws) or 1.0
                    bi = [b for _, b in ws] + [0] * (4 - len(ws))
                    wi = [int(round(w / tot * 255)) for w, _ in ws] + [0] * (4 - len(ws))
                    if ws:
                        wi[0] += 255 - sum(wi)
                    else:
                        wi[0] = 255
                    bw = (bi, wi)
                co = ob.matrix_world @ v.co if bones is None else v.co.copy()
                nw = (ob.matrix_world.to_3x3() @ n).normalized() if bones is None else n
                verts.append((co, nw, mi, bw))
            tri.append(idx)
        index.extend(tri)
    bm.free(); bpy.data.meshes.remove(me)
    return verts, index, [mat_entry(m) for m in mats]

def encode(name, verts, index, palette, blob, origin=None, meta=None, skinned=False):
    # game-space conversion
    P = [(c.x, c.z, -c.y) for (c, n, m, b) in verts]
    if origin is not None:
        ox, oy, oz = origin
        P = [(x - ox, y - oy, z - oz) for (x, y, z) in P]
    N = [(n.x, n.z, -n.y) for (c, n, m, b) in verts]
    mn = [min(p[i] for p in P) for i in range(3)]
    mx = [max(p[i] for p in P) for i in range(3)]
    ctr = [(mn[i] + mx[i]) / 2 for i in range(3)]
    half = [max((mx[i] - mn[i]) / 2, 1e-5) for i in range(3)]
    pos = bytearray()
    for p in P:
        pos += struct.pack('<3h', *[int(round((p[i] - ctr[i]) / half[i] * 32767)) for i in range(3)])
    nor = bytearray()
    for n in N:
        nor += struct.pack('<4b', *[max(-127, min(127, int(round(n[i] * 127)))) for i in range(3)], 0)
    mat = bytes(bytearray([m for (c, n, m, b) in verts]))
    big = len(verts) > 65535
    idx = struct.pack('<%d%s' % (len(index), 'I' if big else 'H'), *index)
    e = dict(name=name, vc=len(verts), ic=len(index), big=big, ctr=[round(x, 5) for x in ctr], half=[round(x, 5) for x in half],
             pos=blob.add(bytes(pos)), nor=blob.add(bytes(nor)), mat=blob.add(mat), idx=blob.add(idx), pal=palette)
    if skinned:
        bi = bytearray(); bw = bytearray()
        for (c, n, m, b) in verts:
            bi += bytes(bytearray(b[0])); bw += bytes(bytearray(b[1]))
        e['bi'] = blob.add(bytes(bi)); e['bw'] = blob.add(bytes(bw))
    if meta: e.update(meta)
    return e

def conv(v):
    return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]

def rig_bones(rig):
    out = []
    for b in rig.data.bones:
        out.append(dict(name=b.name, parent=b.parent.name if b.parent else None, head=conv(rig.matrix_world @ b.head_local),
                        tail=conv(rig.matrix_world @ b.tail_local)))
    return out

def export_all(which=None, lod1=True):
    os.makedirs(OUT_DIR, exist_ok=True)
    blob = Blob(); man = dict(version=2, assets={})
    count = 0
    # ---- LOW set: A_* objects (static, colliders + sockets in asset-local space)
    for ob in bpy.data.objects:
        if not ob.name.startswith("A_") or ob.type != 'MESH':
            continue
        nm = ob.name[2:]
        verts, index, pal = mesh_arrays(ob, 30.0)
        loc = ob.matrix_world.translation
        cols = json.loads(ob.get('tl_cols', '[]'))
        socks = json.loads(ob.get('tl_socks', '{}'))
        extra = json.loads(ob.get('tl_extra', '{}'))
        meta = dict(lod='lo', cat=ob.get('tl_cat', 'prop'),
                    cols=[[round(c[0], 3), round(c[2], 3), round(-c[1], 3), round(c[3], 3), round(c[5], 3), round(c[4], 3)] for c in cols],
                    socks={k: conv(v) for k, v in socks.items()}, extra=extra)
        man['assets'].setdefault(nm, {})['lo'] = encode(nm, verts, index, pal, blob, origin=(loc.x, loc.z, -loc.y), meta=meta)
        count += 1
    # ---- HIGH set
    for ob in bpy.data.objects:
        if not ob.name.startswith("HD_") or ob.type != 'MESH':
            continue
        if ob.get('tl_skip'):
            continue
        nm = ob.get('tl_name') or ob.name[3:]
        skinned = ob.get('tl_skinned', 0)
        loc = ob.matrix_world.translation
        if skinned:
            rig = ob.parent
            bnames = [b.name for b in rig.data.bones]
            verts, index, pal = mesh_arrays(ob, 60.0, bones=bnames)
            meta = dict(lod='hi', cat='char', skinned=True, bones=rig_bones(rig))
            if 'tl_socks' in rig.keys():
                meta['socks'] = {k: conv(v) for k, v in json.loads(rig['tl_socks']).items()}
            e = encode(nm, verts, index, pal, blob, origin=None, meta=meta, skinned=True)
        else:
            verts, index, pal = mesh_arrays(ob, 40.0)
            meta = dict(lod='hi', cat=ob.get('tl_cat', 'prop'))
            for k in ('tl_wheels',):
                if k in ob.keys():
                    meta['wheels'] = [conv(w) for w in json.loads(str(ob[k]).replace("'", '"'))]
            e = encode(nm, verts, index, pal, blob, origin=(loc.x, loc.z, -loc.y), meta=meta)
        man['assets'].setdefault(nm, {})['hi'] = e
        count += 1
        tris = len(index) // 3
        if lod1 and tris > 2500:
            try:
                if skinned:
                    v2, i2, p2 = mesh_arrays(ob, 60.0, bones=bnames, decimate=0.35)
                    e2 = encode(nm, v2, i2, p2, blob, meta=dict(lod='mid', cat='char', skinned=True, bones=meta['bones']), skinned=True)
                else:
                    v2, i2, p2 = mesh_arrays(ob, 40.0, decimate=0.35)
                    e2 = encode(nm, v2, i2, p2, blob, origin=(loc.x, loc.z, -loc.y), meta=dict(lod='mid', cat=meta['cat']))
                man['assets'][nm]['mid'] = e2
            except Exception as ex:
                print("lod1 fail", nm, ex)
    data = blob.bytes()
    with open(os.path.join(OUT_DIR, "assets.bin"), "wb") as f:
        f.write(data)
    with open(os.path.join(OUT_DIR, "assets.json"), "w") as f:
        json.dump(man, f, separators=(',', ':'))
    return count, len(data)
