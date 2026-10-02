# THREADLINE: hero models supplied by the user (src/WEAVER = Iron Spider FBX + textures, src/PULSE = Spider-Man 2099 .blend)
# re-skinned onto the game's own skeleton (same bone names / hierarchy as hd_char.BONES) so every existing pose, IK and
# combat animation keeps working, then exported to build/heroes.bin + build/heroes.json (+ textures via tools/hd/hero_tex.py).
#
# Run inside Blender (MCP execute_blender_code):
#   T = r"C:/Users/PRIYANSHU/Pictures/spooderman/tools/"
#   exec(open(T + "hd/hd_import_heroes.py").read()); export_heroes()
#
# WEAVER: body -> skinned mesh (per-texture material groups); the model's own four claw arms -> rigid IK segments
#         WEAVER_arm_{UL,UR,LL,LR}_{1,2,3} (upper arm, forearm, claw) modelled in a local frame at their joint.
# PULSE : Mixamo-rigged body -> skinned mesh with palette slots (primary blue / accent orange, recolourable outfits).
import bpy, bmesh, json, math, os, re, struct, zipfile
import numpy as np
from mathutils import Vector

ROOT = r"C:/Users/PRIYANSHU/Pictures/spooderman"
OUT = ROOT + "/build"
_T = ROOT + "/tools/"
exec(open(_T + "hd/export_tla.py").read(), globals())      # Blob, encode(), conv()

# game skeleton (identical to hd_char.BONES): name, head joint, tail joint, parent
BONES = [('hips', 'pelvis', 'waist', None), ('spine', 'waist', 'chest', 'hips'), ('chest', 'chest', 'uchest', 'spine'),
         ('neck', 'uchest', 'head', 'chest'), ('head', 'head', None, 'neck')]
for _S in ('L', 'R'):
    BONES += [('clav' + _S, 'clav' + _S, 'sh' + _S, 'chest'), ('uarm' + _S, 'sh' + _S, 'el' + _S, 'clav' + _S),
              ('farm' + _S, 'el' + _S, 'wr' + _S, 'uarm' + _S), ('hand' + _S, 'wr' + _S, 'palm' + _S, 'farm' + _S),
              ('thigh' + _S, 'hip' + _S, 'kn' + _S, 'hips'), ('shin' + _S, 'kn' + _S, 'an' + _S, 'thigh' + _S),
              ('foot' + _S, 'an' + _S, 'toe' + _S, 'shin' + _S)]


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for b in list(blk):
            if b.users == 0:
                blk.remove(b)


# ---------------------------------------------------------------------------------------------- loading
def load_weaver():
    clear_scene()
    d = OUT + "/hero_src/weaver"
    if not os.path.exists(d + "/Spider-Man 4.fbx"):
        os.makedirs(d, exist_ok=True)
        zipfile.ZipFile(ROOT + "/src/WEAVER/source/Iron Spider.zip").extractall(d)
    bpy.ops.import_scene.fbx(filepath=d + "/Spider-Man 4.fbx")
    mo = next(o for o in bpy.data.objects if o.type == 'MESH')
    ao = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    ao.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    return mo, ao


def load_pulse():
    clear_scene()
    with bpy.data.libraries.load(ROOT + "/src/PULSE/source/Across the spider verse spiderman 2099.blend") as (src, dst):
        dst.objects = ['Armature', 'peter:ripeterhero_hi_cn_body1.001']
    for o in dst.objects:
        bpy.context.scene.collection.objects.link(o)
    ao = bpy.data.objects['Armature']; mo = bpy.data.objects['peter:ripeterhero_hi_cn_body1.001']
    ao.data.pose_position = 'REST'
    ao.animation_data_clear()
    bpy.context.view_layer.update()          # freshly linked objects have a stale matrix_world until the depsgraph runs
    return mo, ao


# ---------------------------------------------------------------------------------------------- specs
def side_map(prefix_l, prefix_r, names, out):
    pass


WEAVER = dict(
    name='WEAVER', height=1.88,
    J={'pelvis': 'pelvis', 'waist': 'spine_02', 'chest': 'spine_04', 'uchest': 'neck_01', 'head': 'head',
       'clavL': 'clavicle_l', 'shL': 'upperarm_l', 'elL': 'lowerarm_l', 'wrL': 'hand_l', 'palmL': 'middle_01_l',
       'hipL': 'thigh_l', 'knL': 'calf_l', 'anL': 'foot_l', 'toeL': 'ball_l',
       'clavR': 'clavicle_r', 'shR': 'upperarm_r', 'elR': 'lowerarm_r', 'wrR': 'hand_r', 'palmR': 'middle_01_r',
       'hipR': 'thigh_r', 'knR': 'calf_r', 'anR': 'foot_r', 'toeR': 'ball_r'},
    table={'root': 'hips', 'pelvis': 'hips', 'spine_01': 'hips', 'spine_02': 'spine', 'spine_03': 'spine', 'spine_04': 'chest',
           'spine_05': 'chest', 'neck_01': 'neck', 'neck_02': 'neck', 'head': 'head',
           **{k + s: v + S for s, S in (('_l', 'L'), ('_r', 'R')) for k, v in
              (('clavicle', 'clav'), ('upperarm', 'uarm'), ('lowerarm', 'farm'), ('hand', 'hand'), ('thigh', 'thigh'), ('calf', 'shin'),
               ('foot', 'foot'), ('ball', 'foot'))}},
)
PULSE = dict(
    name='PULSE', height=1.85,
    J={'pelvis': 'peter:Hips', 'waist': 'peter:Spine', 'chest': 'peter:Spine1', 'uchest': 'peter:Neck', 'head': 'peter:Head',
       **{'clav' + S: 'peter:%sShoulder' % s for S, s in (('L', 'Left'), ('R', 'Right'))},
       **{'sh' + S: 'peter:%sArm' % s for S, s in (('L', 'Left'), ('R', 'Right'))},
       **{'el' + S: 'peter:%sForeArm' % s for S, s in (('L', 'Left'), ('R', 'Right'))},
       **{'wr' + S: 'peter:%sHand' % s for S, s in (('L', 'Left'), ('R', 'Right'))},
       **{'palm' + S: 'peter:%sHandMiddle1' % s for S, s in (('L', 'Left'), ('R', 'Right'))},
       **{'hip' + S: 'peter:%sUpLeg' % s for S, s in (('L', 'Left'), ('R', 'Right'))},
       **{'kn' + S: 'peter:%sLeg' % s for S, s in (('L', 'Left'), ('R', 'Right'))},
       **{'an' + S: 'peter:%sFoot' % s for S, s in (('L', 'Left'), ('R', 'Right'))},
       **{'toe' + S: 'peter:%sToeBase' % s for S, s in (('L', 'Left'), ('R', 'Right'))}},
    table={'peter:Hips': 'hips', 'peter:Spine': 'spine', 'peter:Spine1': 'chest', 'peter:Spine2': 'chest', 'peter:Neck': 'neck',
           'peter:Head': 'head',
           **{'peter:%s%s' % (s, k): v + S for s, S in (('Left', 'L'), ('Right', 'R')) for k, v in
              (('Shoulder', 'clav'), ('Arm', 'uarm'), ('ForeArm', 'farm'), ('Hand', 'hand'), ('UpLeg', 'thigh'), ('Leg', 'shin'),
               ('Foot', 'foot'), ('ToeBase', 'foot'))}},
)


# ---------------------------------------------------------------------------------------------- shared helpers
class Xform:
    """uniform scale about the origin + sole-to-z=0 + feet centred on y"""
    def __init__(self, s, z0, y0):
        self.s, self.z0, self.y0 = s, z0, y0
    def __call__(self, p):
        return Vector((p.x * self.s, (p.y - self.y0) * self.s, (p.z - self.z0) * self.s))
    def dir(self, n):
        return n.copy()


def fit_xform(spec, mo, ao, keep_faces):
    me = mo.data
    zs = [(mo.matrix_world @ me.vertices[i].co).z for i in keep_faces]
    z0, ztop = min(zs), max(zs)
    heads = {n: (ao.matrix_world @ ao.data.bones[b].head_local) for n, b in spec['J'].items()}
    y0 = (heads['anL'].y + heads['anR'].y) / 2 - 0.02 / (spec['height'] / (ztop - z0))
    return Xform(spec['height'] / (ztop - z0), z0, y0)


def skeleton(spec, ao, X):
    J = {n: X(ao.matrix_world @ ao.data.bones[b].head_local) for n, b in spec['J'].items()}
    bones = []
    for bn, h, t, par in BONES:
        head = J[h]
        tail = J[t] if t else head + Vector((0, 0, 0.2))
        if (tail - head).length < 1e-3:
            tail = head + Vector((0, 0, 0.05))
        bones.append(dict(name=bn, parent=par, head=conv(head), tail=conv(tail)))
    return bones, J


def make_mapper(spec, ao):
    table, cache = spec['table'], {}
    def m(name):
        if name in cache:
            return cache[name]
        n = name
        while n and n not in table:
            b = ao.data.bones.get(n)
            n = b.parent.name if b and b.parent else None
        cache[name] = table.get(n) if n else None
        return cache[name]
    return m


def vertex_skin(mo, mapper, names):
    """per-vertex (bone index list, weight bytes) on the 24 game bones"""
    vg = [g.name for g in mo.vertex_groups]
    out = []
    for v in mo.data.vertices:
        acc = {}
        for g in v.groups:
            b = mapper(vg[g.group])
            if b and g.weight > 1e-4:
                acc[b] = acc.get(b, 0) + g.weight
        ws = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(w for _, w in ws)
        if not ws:
            ws, tot = [('hips', 1.0)], 1.0
        bi = [names.index(b) for b, _ in ws] + [0] * (4 - len(ws))
        wi = [int(round(w / tot * 255)) for _, w in ws] + [0] * (4 - len(ws))
        wi[0] += 255 - sum(wi)
        out.append((bi, wi))
    return out


def build_mesh(mo, tris_filter, X, skin, matmap, uv_name=None, xf=None, nxf=None):
    """triangles -> (verts[(co, n, mat, bw)], index, uvs, groups). matmap: material index -> output material id"""
    me = mo.data
    me.calc_loop_triangles()
    nrm = me.corner_normals
    uvl = me.uv_layers[uv_name] if uv_name else (me.uv_layers[0] if len(me.uv_layers) else None)
    W = mo.matrix_world; R = W.to_3x3()
    tri_list = [t for t in me.loop_triangles if tris_filter(t)]
    tri_list.sort(key=lambda t: matmap(t.material_index))
    verts, uvs, index, keymap, groups = [], [], [], {}, []
    for t in tri_list:
        mid = matmap(t.material_index)
        if not groups or groups[-1][2] != mid:
            groups.append([len(index), 0, mid])
        for li, vi in zip(t.loops, t.vertices):
            n = (R @ nrm[li].vector).normalized()
            uv = tuple(uvl.data[li].uv) if uvl else (0.0, 0.0)
            key = (vi, mid, round(n.x, 2), round(n.y, 2), round(n.z, 2), round(uv[0], 5), round(uv[1], 5))
            k = keymap.get(key)
            if k is None:
                k = len(verts); keymap[key] = k
                co = W @ me.vertices[vi].co
                if xf:
                    co, n = xf(co, n)
                else:
                    co = X(co)
                verts.append((co, n, mid, skin[vi] if skin else None))
                uvs.append(uv)
            index.append(k)
        groups[-1][1] += 3
    return verts, index, uvs, groups


# ---------------------------------------------------------------------------------------------- WEAVER
CLAW_RE = re.compile(r'claw_(0[12])_(\d\d)(_mid)?_([lr])$')
TEXSETS = ['body', 'equip1', 'equip2', 'head', 'weapon', 'arm']
MAT2SET = {'Body': 0, 'Equip_01': 1, 'Equip_02': 2, 'Head': 3, 'Punches': 4, 'Rim': 2, 'Hide': 5}


def matset(me, mi):
    name = me.materials[mi].name if me.materials[mi] else ''
    for k, v in MAT2SET.items():
        if k in name:
            return v
    return 0


def tex_entries(used):
    out = []
    for s in used:
        n = TEXSETS[s]
        e = dict(d='w_%s_d' % n)
        if n != 'arm':
            e.update(n='w_%s_n' % n, o='w_%s_o' % n)
        out.append(e)
    return out


def frame(d1, d2):
    n = d1.cross(d2)
    if n.length < 1e-3:
        n = d1.cross(Vector((0, 1, 0)))
    n.normalize()
    return n


def export_weaver(blob, man):
    mo, ao = load_weaver()
    me = mo.data
    hide = {i for i, m in enumerate(me.materials) if m and 'Hide' in m.name}
    claw_v = set(); body_v = set()
    for p in me.polygons:
        (claw_v if p.material_index in hide else body_v).update(p.vertices)
    X = fit_xform(WEAVER, mo, ao, body_v)
    bones, J = skeleton(WEAVER, ao, X)
    names = [b['name'] for b in bones]
    skin = vertex_skin(mo, make_mapper(WEAVER, ao), names)
    # ---- body (all non-Hide materials), grouped by texture set
    verts, index, uvs, groups = build_mesh(mo, lambda t: t.material_index not in hide, X, skin, lambda mi: matset(me, mi))
    used = sorted({g[2] for g in groups})
    remap = {s: i for i, s in enumerate(used)}
    verts = [(c, n, remap[m], b) for (c, n, m, b) in verts]
    groups = [[a, b, remap[m]] for a, b, m in groups]
    # ---- sockets = where each claw chain leaves the back
    socks = {}; arm_geo = {}
    vg = [g.name for g in mo.vertex_groups]
    def arm_of(v):
        best = None
        for g in v.groups:
            m = CLAW_RE.match(vg[g.group])
            if m and g.weight > 0.05 and (best is None or g.weight > best[0]):
                best = (g.weight, m.group(1), int(m.group(2)), m.group(4))
        return best
    vinfo = {i: arm_of(mo.data.vertices[i]) for i in claw_v}
    for c, ch in (('01', 'U'), ('02', 'L')):
        for sd, S in (('l', 'L'), ('r', 'R')):
            jn = [X(ao.matrix_world @ ao.data.bones['claw_%s_%02d_%s' % (c, k, sd)].head_local) for k in range(5)]
            key = 'arm' + ch + S
            socks[key] = conv(jn[0])
            gj = [Vector((p.x, p.z, -p.y)) for p in jn]                      # game space
            d1 = (gj[2] - gj[0]).normalized(); d2 = (gj[3] - gj[2]).normalized(); nn = frame(d1, d2)
            L1, L2 = (gj[2] - gj[0]).length, (gj[3] - gj[2]).length
            def basis(d):
                return (nn, d, nn.cross(d))
            segdef = {1: (gj[0], basis(d1)), 2: (gj[2], basis(d2)), 3: (gj[3], basis(d2))}
            def seg_of(k):
                return 1 if k <= 1 else 2 if k == 2 else 3
            def tri_ok(t, c=c, sd=sd, sg=None):
                return True
            for sg in (1, 2, 3):
                def filt(t, c=c, sd=sd, sg=sg):
                    if t.material_index not in hide:
                        return False
                    infos = [vinfo.get(v) for v in t.vertices]
                    if any(i is None for i in infos):
                        return False
                    votes = {}
                    for i in infos:
                        votes[(i[1], i[3], seg_of(i[2]))] = votes.get((i[1], i[3], seg_of(i[2])), 0) + 1
                    top = max(votes.items(), key=lambda kv: kv[1])[0]
                    return top == (c, sd, sg)
                org, (bx, by, bz) = segdef[sg]
                def xf(co, n, org=org, bx=bx, by=by, bz=bz, X=X):
                    p = X(co); g = Vector((p.x, p.z, -p.y)) - org
                    ng = Vector((n.x, n.z, -n.y))
                    lg = Vector((g.dot(bx), g.dot(by), g.dot(bz))); ln = Vector((ng.dot(bx), ng.dot(by), ng.dot(bz)))
                    return Vector((lg.x, -lg.z, lg.y)), Vector((ln.x, -ln.z, ln.y))
                av, ai, au, _ = build_mesh(mo, filt, X, None, lambda mi: 0, xf=xf)
                arm_geo[(key, sg)] = (av, ai, au, dict(L1=round(L1, 4), L2=round(L2, 4)))
    # ---- encode
    pal = [[0.6, 0.6, 0.6, 0, 0, 0.6, 0.0]]
    meta = dict(lod='hi', cat='char', skinned=True, bones=bones, socks=socks, hb=1, tex=tex_entries(used), groups=groups)
    e = encode('WEAVER', verts, index, pal, blob, meta=meta, skinned=True)
    e['uv'] = blob.add(struct.pack('<%df' % (len(uvs) * 2), *[c for uv in uvs for c in uv]))
    man['assets']['WEAVER'] = dict(hi=e)
    for (key, sg), (av, ai, au, ex) in arm_geo.items():
        nm = 'WEAVER_%s_%d' % (key.replace('arm', 'arm_'), sg)
        if not av:
            print('EMPTY', nm); continue
        m2 = dict(lod='hi', cat='char', hb=1, tex=tex_entries([5]), groups=[[0, len(ai), 0]], extra=ex)
        e2 = encode(nm, av, ai, pal, blob, meta=m2)
        e2['uv'] = blob.add(struct.pack('<%df' % (len(au) * 2), *[c for uv in au for c in uv]))
        man['assets'][nm] = dict(hi=e2)
    print('WEAVER verts', len(verts), 'tris', len(index) // 3, 'groups', groups, {k: len(v[1]) // 3 for k, v in arm_geo.items()})


# ---------------------------------------------------------------------------------------------- PULSE
def export_pulse(blob, man):
    mo, ao = load_pulse()
    me = mo.data
    X = fit_xform(PULSE, mo, ao, range(len(me.vertices)))
    bones, J = skeleton(PULSE, ao, X)
    names = [b['name'] for b in bones]
    skin = vertex_skin(mo, make_mapper(PULSE, ao), names)
    verts, index, uvs, groups = build_mesh(mo, lambda t: True, X, skin, lambda mi: min(mi, 1))
    # palette: 0 = suit blue (slot primary), 1 = spider-red accent (slot accent)
    pal = [[0.078, 0.141, 0.584, 1, 0, 0.55, 0.0], [0.90, 0.28, 0.13, 3, 0, 0.5, 0.0]]
    meta = dict(lod='hi', cat='char', skinned=True, bones=bones, hb=1)
    e = encode('PULSE', verts, index, pal, blob, meta=meta, skinned=True)
    man['assets']['PULSE'] = dict(hi=e)
    print('PULSE verts', len(verts), 'tris', len(index) // 3, 'mat groups', [(g[2], g[1] // 3) for g in groups])


def export_heroes():
    blob = Blob(); man = dict(version=2, assets={})
    export_weaver(blob, man)
    export_pulse(blob, man)
    with open(OUT + "/heroes.bin", "wb") as f:
        f.write(blob.bytes())
    with open(OUT + "/heroes.json", "w") as f:
        json.dump(man, f, separators=(',', ':'))
    return len(blob.bytes())
