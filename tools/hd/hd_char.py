# THREADLINE HD character toolkit (run inside Blender after bl_helpers.py)
# Pipeline (character-artist skill): proportion skeleton -> skin-modifier base mesh -> subsurf
#  -> anatomical shaping -> region-based suit materials -> conforming armor (duplicated body faces
#  + solidify) -> helmet -> armature + automatic weights -> weight transfer onto armor.
# Characters face -Y (game +Z). Rest pose = A-pose (arms 45 deg down). Units: meters.
import bpy, bmesh, math, json
from mathutils import Vector, Matrix, Euler, kdtree

HIGH = "TL_HIGH"

def high_coll():
    c = bpy.data.collections.get(HIGH)
    if c is None:
        c = bpy.data.collections.new(HIGH)
        bpy.context.scene.collection.children.link(c)
    return c

def remove_obj(name):
    o = bpy.data.objects.get(name)
    if o:
        for ch in list(o.children):
            remove_obj(ch.name)
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and getattr(data, 'users', 1) == 0:
            if isinstance(data, bpy.types.Mesh): bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Armature): bpy.data.armatures.remove(data)

def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)

# ---------------------------------------------------------------- skeleton definition
def skeleton(p):
    """Joint positions from proportion params. p: dict with 'height','shoulder','hip','bulk'."""
    H = p.get('height', 1.85)
    s = H / 1.85
    sh = p.get('shoulder', 0.2)
    hw = p.get('hip', 0.1)
    J = {}
    J['pelvis'] = Vector((0, 0.0, 1.0 * s))
    J['waist'] = Vector((0, 0.0, 1.13 * s))
    J['chest'] = Vector((0, -0.005, 1.31 * s))
    J['uchest'] = Vector((0, 0.0, 1.45 * s))
    J['neck'] = Vector((0, 0.01, 1.56 * s))
    J['head'] = Vector((0, 0.005, 1.635 * s))
    a45 = math.radians(p.get('arm_angle', 45))
    for side, sg in (('L', 1), ('R', -1)):
        # NOTE: 'L' is character-left = +X in Blender (character faces -Y)
        J['clav' + side] = Vector((sg * 0.05, 0.01, 1.47 * s))
        J['sh' + side] = Vector((sg * sh, 0.015, 1.465 * s))
        d = Vector((sg * math.cos(a45), 0.0, -math.sin(a45)))
        J['el' + side] = J['sh' + side] + d * 0.29 * s + Vector((0, 0.02, 0))
        J['wr' + side] = J['el' + side] + d * 0.265 * s + Vector((0, -0.02, 0))
        J['palm' + side] = J['wr' + side] + d * 0.075 * s
        J['hip' + side] = Vector((sg * hw, 0.0, 0.955 * s))
        J['kn' + side] = Vector((sg * (hw + 0.005), -0.012, 0.525 * s))
        J['an' + side] = Vector((sg * (hw + 0.01), 0.02, 0.09 * s))
        J['toe' + side] = Vector((sg * (hw + 0.018), -0.135 * s, 0.028 * s))
    return J

# Bone list: name, head joint, tail joint, parent
BONES = [
    ('hips', 'pelvis', 'waist', None),
    ('spine', 'waist', 'chest', 'hips'),
    ('chest', 'chest', 'uchest', 'spine'),
    ('neck', 'uchest', 'head', 'chest'),
    ('head', 'head', None, 'neck'),
]
for S_ in ('L', 'R'):
    BONES += [
        ('clav' + S_, 'clav' + S_, 'sh' + S_, 'chest'),
        ('uarm' + S_, 'sh' + S_, 'el' + S_, 'clav' + S_),
        ('farm' + S_, 'el' + S_, 'wr' + S_, 'uarm' + S_),
        ('hand' + S_, 'wr' + S_, 'palm' + S_, 'farm' + S_),
        ('thigh' + S_, 'hip' + S_, 'kn' + S_, 'hips'),
        ('shin' + S_, 'kn' + S_, 'an' + S_, 'thigh' + S_),
        ('foot' + S_, 'an' + S_, 'toe' + S_, 'shin' + S_),
    ]

# ---------------------------------------------------------------- base body
def build_body_base(name, p):
    """Skin-modifier base mesh -> applied, subdivided. Returns mesh object."""
    J = skeleton(p)
    b = p.get('bulk', 1.0)
    lean = p.get('lean', 1.0)
    s = p.get('height', 1.85) / 1.85
    verts, radii, edges = [], [], []
    idx = {}
    K = p.get('shrink_comp', 1.38)   # subsurf volume-loss compensation
    def V(key, pos, rx, ry=None):
        idx[key] = len(verts)
        verts.append(pos.copy())
        radii.append((rx * K, (ry if ry is not None else rx) * K))
    def E(a, c):
        edges.append((idx[a], idx[c]))
    ch = p.get('chest', 1.0); lg = p.get('legs', 1.0); am = p.get('arms', 1.0)
    V('pelvis', J['pelvis'], 0.135 * b, 0.1 * b)
    V('waist', J['waist'], 0.112 * b * lean, 0.088 * b)
    V('chest', J['chest'], 0.165 * b * ch, 0.108 * b)
    V('uchest', J['uchest'], 0.2 * b * ch, 0.102 * b)
    V('neck', J['neck'], p.get('neck', 0.06) * b, p.get('neck', 0.06) * 1.03 * b)
    V('headb', J['head'] + Vector((0, 0, 0.02)), 0.04, 0.044)
    E('pelvis', 'waist'); E('waist', 'chest'); E('chest', 'uchest'); E('uchest', 'neck'); E('neck', 'headb')
    for S_ in ('L', 'R'):
        sg = 1 if S_ == 'L' else -1
        V('sh' + S_, J['sh' + S_], 0.062 * b * am)
        V('bic' + S_, J['sh' + S_].lerp(J['el' + S_], 0.45), 0.05 * b * am)
        V('el' + S_, J['el' + S_], 0.035 * b * am)
        V('fa' + S_, J['el' + S_].lerp(J['wr' + S_], 0.28), 0.041 * b * am)
        V('wr' + S_, J['wr' + S_], 0.026 * b * am)
        V('palm' + S_, J['wr' + S_].lerp(J['palm' + S_], 0.55), 0.03 * b, 0.016 * b)
        E('uchest', 'sh' + S_); E('sh' + S_, 'bic' + S_); E('bic' + S_, 'el' + S_); E('el' + S_, 'fa' + S_)
        E('fa' + S_, 'wr' + S_); E('wr' + S_, 'palm' + S_)
        # fingers are modeled separately (build_hand) for readable articulated gloves
        # legs (extra control points define knee / calf / ankle profile)
        V('hip' + S_, J['hip' + S_], 0.1 * b * lg)
        V('thm' + S_, J['hip' + S_].lerp(J['kn' + S_], 0.35), 0.088 * b * lg)
        V('thl' + S_, J['hip' + S_].lerp(J['kn' + S_], 0.78), 0.063 * b * lg)
        V('kn' + S_, J['kn' + S_], 0.048 * b * lg)
        V('calf' + S_, J['kn' + S_].lerp(J['an' + S_], 0.27) + Vector((0, 0.01, 0)), 0.056 * b * lg)
        V('shl' + S_, J['kn' + S_].lerp(J['an' + S_], 0.68), 0.038 * b * lg)
        V('an' + S_, J['an' + S_], 0.031 * b * lg)
        V('heel' + S_, J['an' + S_] + Vector((0, 0.035, -0.045)), 0.034 * b)
        V('ball' + S_, J['toe' + S_].lerp(J['an' + S_], 0.35) + Vector((0, 0, -0.012)), 0.042 * b, 0.026 * b)
        V('toe' + S_, J['toe' + S_], 0.034 * b, 0.02 * b)
        E('pelvis', 'hip' + S_); E('hip' + S_, 'thm' + S_); E('thm' + S_, 'thl' + S_); E('thl' + S_, 'kn' + S_)
        E('kn' + S_, 'calf' + S_); E('calf' + S_, 'shl' + S_); E('shl' + S_, 'an' + S_)
        E('an' + S_, 'heel' + S_); E('an' + S_, 'ball' + S_); E('ball' + S_, 'toe' + S_)
    me = bpy.data.meshes.new(name + "_skin")
    me.from_pydata([tuple(v) for v in verts], edges, [])
    ob = bpy.data.objects.new(name, me)
    high_coll().objects.link(ob)
    sk = ob.modifiers.new("Skin", 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for i, r in enumerate(radii):
        me.skin_vertices[0].data[i].radius = r
    me.skin_vertices[0].data[idx['pelvis']].use_root = True
    sub = ob.modifiers.new("Sub", 'SUBSURF')
    sub.levels = p.get('subdiv', 2)
    sub.render_levels = sub.levels
    # apply modifiers
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    newme = bpy.data.meshes.new_from_object(ev)
    ob.modifiers.clear()
    old = ob.data
    ob.data = newme
    bpy.data.meshes.remove(old)
    newme.name = name + "_mesh"
    return ob, J

def shape_body(ob, J, p):
    """Anatomical shaping by smooth displacement fields (pecs, lats, glutes, calves, shoulders)."""
    me = ob.data
    b = p.get('bulk', 1.0)
    mus = p.get('muscle', 1.0)
    bm = bmesh.new(); bm.from_mesh(me)
    bm.normal_update()
    def blob(center, radius, amount, v, n, dirv=None):
        d = (v.co - center).length
        if d < radius:
            f = (1 - (d / radius) ** 2) ** 2
            return (dirv if dirv is not None else n) * (amount * f)
        return Vector((0, 0, 0))
    chestC = J['chest']
    for v in bm.verts:
        n = v.normal
        off = Vector((0, 0, 0))
        # pectorals (front of chest, -Y)
        for sg in (1, -1):
            off += blob(Vector((sg * 0.085, chestC.y - 0.1 * b, chestC.z + 0.06)), 0.11 * b, 0.022 * mus, v, n)
            # deltoids
            sh = J['sh' + ('L' if sg > 0 else 'R')]
            off += blob(sh + Vector((sg * 0.02, 0, 0.03)), 0.1 * b, 0.02 * mus, v, n)
            # lats / back
            off += blob(Vector((sg * 0.12, chestC.y + 0.08, chestC.z - 0.02)), 0.13, 0.015 * mus, v, n)
            # glutes
            off += blob(Vector((sg * 0.08, 0.1, J['pelvis'].z - 0.05)), 0.12, 0.02 * mus, v, n)
            # quads
            S_ = 'L' if sg > 0 else 'R'
            q = J['hip' + S_].lerp(J['kn' + S_], 0.45) + Vector((0, -0.05, 0))
            off += blob(q, 0.14, 0.014 * mus, v, n)
            # calves
            c = J['kn' + S_].lerp(J['an' + S_], 0.25) + Vector((0, 0.05, 0))
            off += blob(c, 0.12, 0.016 * mus, v, n)
            # biceps / forearm
            bc = J['sh' + S_].lerp(J['el' + S_], 0.5)
            off += blob(bc, 0.08, 0.01 * mus, v, n)
        # abdomen flatten slightly, waist taper
        wz = J['waist'].z
        if abs(v.co.z - wz) < 0.12 and abs(v.co.x) < 0.2:
            t = 1 - abs(v.co.z - wz) / 0.12
            off += Vector((-v.co.x * 0.08 * t * p.get('taper', 1.0), 0, 0))
        # neck trapezius slope
        if J['uchest'].z < v.co.z < J['neck'].z + 0.02 and 0.04 < abs(v.co.x) < 0.2:
            off += Vector((0, 0, 0.015 * mus * (1 - abs(abs(v.co.x) - 0.1) / 0.1)))
        v.co += off
    bm.to_mesh(me); bm.free()
    for poly in me.polygons:
        poly.use_smooth = True

# ---------------------------------------------------------------- materials by region
def assign_regions(ob, rules, default_mat):
    """rules: list of (mat, fn(center, normal)->bool); first match wins."""
    me = ob.data
    mats = [default_mat] + [r[0] for r in rules if r[0] is not None]
    uniq = []
    for m in mats:
        if m not in uniq: uniq.append(m)
    me.materials.clear()
    for m in uniq: me.materials.append(m)
    for poly in me.polygons:
        c = poly.center; n = poly.normal
        mi = 0
        for (m, fn) in rules:
            if fn(c, n):
                mi = uniq.index(m); break
        poly.material_index = mi

# ---------------------------------------------------------------- armor from body regions
def armor_from_region(body, name, sel_fn, thickness=0.012, offset=0.006, mat=None, bevel=0.003, inset=0.0,
                      relax=8, grow=0):
    """Duplicate body faces matching sel_fn(center, normal); relax the jagged selection border along
    the loop, re-project onto the body surface, push out, solidify, bevel -> conforming armor plate."""
    from mathutils.bvhtree import BVHTree
    me = body.data
    src = bmesh.new(); src.from_mesh(me)
    tree = BVHTree.FromBMesh(src)
    src.free()
    bm = bmesh.new(); bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    keep = set(f for f in bm.faces if sel_fn(f.calc_center_median(), f.normal))
    for _ in range(grow):
        keep |= set(g for f in list(keep) for e in f.edges for g in e.link_faces)
    dels = [f for f in bm.faces if f not in keep]
    bmesh.ops.delete(bm, geom=dels, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    # drop tiny islands / single faces hanging off (reduces spikes)
    for _ in range(2):
        weak = [f for f in bm.faces if sum(1 for e in f.edges if len(e.link_faces) > 1) <= 1]
        if weak and len(weak) < len(bm.faces):
            bmesh.ops.delete(bm, geom=weak, context='FACES')
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # relax boundary loop
    for _ in range(relax):
        newpos = {}
        for v in bm.verts:
            if not v.is_boundary:
                continue
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                avg = (nb[0].co + nb[1].co) * 0.5
                newpos[v] = v.co.lerp(avg, 0.6)
        for v, c in newpos.items():
            v.co = c
        # smooth the first interior ring a little so the border does not fold
        inner = {}
        for v in bm.verts:
            if v.is_boundary:
                continue
            if any(e.other_vert(v).is_boundary for e in v.link_edges):
                nb = [e.other_vert(v) for e in v.link_edges]
                avg = sum((x.co for x in nb), Vector()) / len(nb)
                inner[v] = v.co.lerp(avg, 0.3)
        for v, c in inner.items():
            v.co = c
        for v in bm.verts:
            loc, nrm, idx, dist = tree.find_nearest(v.co)
            if loc is not None:
                v.co = loc
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    nm = bpy.data.meshes.new(name + "_me")
    bm.to_mesh(nm); bm.free()
    if mat is not None:
        nm.materials.clear(); nm.materials.append(mat)
        for poly in nm.polygons: poly.material_index = 0
    ob = bpy.data.objects.new(name, nm)
    high_coll().objects.link(ob)
    if len(nm.polygons) == 0:
        return ob
    so = ob.modifiers.new("Solid", 'SOLIDIFY'); so.thickness = thickness; so.offset = 1.0
    so.use_even_offset = False; so.use_quality_normals = True
    try: so.thickness_clamp = 1.5
    except Exception: pass
    if bevel > 0:
        bv = ob.modifiers.new("Bevel", 'BEVEL'); bv.width = bevel; bv.segments = 2; bv.limit_method = 'ANGLE'; bv.angle_limit = math.radians(40)
    apply_mods(ob)
    for poly in ob.data.polygons: poly.use_smooth = True
    return ob

def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    newme = bpy.data.meshes.new_from_object(ev)
    ob.modifiers.clear()
    old = ob.data
    ob.data = newme
    if old.users == 0: bpy.data.meshes.remove(old)

# ---------------------------------------------------------------- generic smooth primitives
def bm_to_obj(bm, name, mats, smooth=True):
    me = bpy.data.meshes.new(name + "_me")
    bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    for poly in me.polygons: poly.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    high_coll().objects.link(ob)
    return ob

def join(objs, name):
    objs = [o for o in objs if o is not None]
    base = objs[0]
    # merge meshes via bmesh to avoid operator context issues
    bm = bmesh.new()
    mats = []
    for o in objs:
        tmp = bmesh.new(); tmp.from_mesh(o.data)
        bmesh.ops.transform(tmp, matrix=o.matrix_world, verts=tmp.verts)
        remap = []
        for m in o.data.materials:
            if m not in mats: mats.append(m)
            remap.append(mats.index(m))
        for f in tmp.faces:
            if remap: f.material_index = remap[min(f.material_index, len(remap) - 1)]
        me_tmp = bpy.data.meshes.new("tmpj")
        tmp.to_mesh(me_tmp); tmp.free()
        bm.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
    for o in objs:
        remove_obj(o.name)
    me = bpy.data.meshes.new(name + "_me")
    bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    high_coll().objects.link(ob)
    return ob

# ---------------------------------------------------------------- armature + weights
def build_armature(name, J, extra_bones=()):
    arm = bpy.data.armatures.new(name + "_arm")
    ao = bpy.data.objects.new(name + "_rig", arm)
    high_coll().objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    for o in bpy.context.view_layer.objects: o.select_set(False)
    ao.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for (bn, h, t, par) in list(BONES) + list(extra_bones):
        e = arm.edit_bones.new(bn)
        e.head = J[h] if isinstance(h, str) else Vector(h)
        if t is None:
            e.tail = e.head + Vector((0, 0, 0.2))
        else:
            e.tail = J[t] if isinstance(t, str) else Vector(t)
        if (e.tail - e.head).length < 1e-3:
            e.tail = e.head + Vector((0, 0, 0.05))
        eb[bn] = e
    for (bn, h, t, par) in list(BONES) + list(extra_bones):
        if par: eb[bn].parent = eb[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ao

def auto_weight(body, rig):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    body.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

def rigid_weight(ob, rig, bone):
    """Bind a piece 100% to one bone."""
    ob.vertex_groups.clear()
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')

def transfer_weights(src, dst):
    """Copy skin weights from body to conforming armor via nearest surface (Data Transfer)."""
    dst.vertex_groups.clear()
    for vg in src.vertex_groups:
        dst.vertex_groups.new(name=vg.name)
    m = dst.modifiers.new("DT", 'DATA_TRANSFER')
    m.object = src
    m.use_vert_data = True
    m.data_types_verts = {'VGROUP_WEIGHTS'}
    m.vert_mapping = 'POLYINTERP_NEAREST'
    m.layers_vgroup_select_src = 'ALL'
    m.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = dst
    for o in bpy.context.view_layer.objects: o.select_set(False)
    dst.select_set(True)
    bpy.ops.object.modifier_apply(modifier=m.name)

def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

# ---------------------------------------------------------------- outline-projected armor
class Proj:
    """Maps 3D body points to 2D design space and back (ray cast onto the body)."""
    def __init__(self, kind, **kw):
        self.kind = kind
        self.kw = kw
        if kind == 'planar':
            self.O = Vector(kw['origin']); self.D = Vector(kw['dir']).normalized()
            self.U = Vector(kw['u']).normalized(); self.V = self.D.cross(self.U).normalized() * -1
            if 'v' in kw: self.V = Vector(kw['v']).normalized()
        elif kind == 'cyl':
            self.A = Vector(kw['a']); self.B = Vector(kw['b'])
            self.ax = (self.B - self.A).normalized()
            r0 = Vector(kw.get('ref', (0, -1, 0)))
            r0 = (r0 - self.ax * r0.dot(self.ax)).normalized()
            self.R0 = r0; self.R1 = self.ax.cross(r0).normalized()
            self.L = (self.B - self.A).length
            self.rmax = kw.get('rmax', 0.15)
            self.allfacing = kw.get('allfacing', False)
    def to2d(self, p):
        if self.kind == 'planar':
            d = p - self.O
            return (d.dot(self.U), d.dot(self.V))
        d = p - self.A
        t = d.dot(self.ax) / self.L
        r = d - self.ax * d.dot(self.ax)
        ang = math.degrees(math.atan2(r.dot(self.R1), r.dot(self.R0)))
        return (ang, t)
    def facing(self, c, n):
        if self.kind == 'planar':
            return n.dot(self.D) < -0.15
        d = c - self.A
        r = d - self.ax * d.dot(self.ax)
        if self.allfacing:
            return r.length < self.rmax
        return 1e-6 < r.length < self.rmax and n.dot(r.normalized()) > 0.1
    def ray(self, u, v):
        if self.kind == 'planar':
            start = self.O + self.U * u + self.V * v - self.D * 1.0
            return start, self.D
        ang = math.radians(u)
        axp = self.A + self.ax * (v * self.L)
        dirv = self.R0 * math.cos(ang) + self.R1 * math.sin(ang)
        return axp, dirv   # cast from inside the limb outward -> own surface only

def _pip(pt, poly):
    x, y = pt; ins = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1):
            ins = not ins
    return ins

def _closest_on_poly(pt, poly):
    best = None; bd = 1e9
    px, py = pt
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = 0 if L2 < 1e-12 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / L2))
        cx, cy = x1 + dx * t, y1 + dy * t
        d = (cx - px) ** 2 + (cy - py) ** 2
        if d < bd: bd = d; best = (cx, cy)
    return best

def plate(body, name, proj, poly, thickness=0.012, offset=0.005, mat=None, bevel=0.0025, extra=None, uscale=1.0):
    """Armor plate from a 2D outline (poly in proj design space). extra(c,n)->bool additional filter."""
    from mathutils.bvhtree import BVHTree
    src = bmesh.new(); src.from_mesh(body.data)
    tree = BVHTree.FromBMesh(src); src.free()
    bm = bmesh.new(); bm.from_mesh(body.data)
    keep = set()
    for f in bm.faces:
        c = f.calc_center_median()
        if not proj.facing(c, f.normal): continue
        if extra and not extra(c, f.normal): continue
        u, v = proj.to2d(c)
        if _pip((u * uscale, v), poly): keep.add(f)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    if len(bm.faces) == 0:
        bm.free(); return None
    # snap boundary to the outline, re-project onto the body
    for it in range(3):
        for v in bm.verts:
            if not v.is_boundary: continue
            u, w = proj.to2d(v.co)
            cu, cw = _closest_on_poly((u * uscale, w), poly)
            o, d = proj.ray(cu / uscale, cw)
            hit, nrm, idx, dist = tree.ray_cast(o, d, 2.0)
            if hit is not None: v.co = hit
        # relax interior ring to avoid folds
        for v in bm.verts:
            if v.is_boundary: continue
            nb = [e.other_vert(v) for e in v.link_edges]
            if any(x.is_boundary for x in nb):
                avg = sum((x.co for x in nb), Vector()) / len(nb)
                v.co = v.co.lerp(avg, 0.5)
                loc, nr, ix, ds = tree.find_nearest(v.co)
                if loc is not None: v.co = loc
    bm.normal_update()
    for v in bm.verts: v.co += v.normal * offset
    nm = bpy.data.meshes.new(name + "_me"); bm.to_mesh(nm); bm.free()
    if mat is not None:
        nm.materials.clear(); nm.materials.append(mat)
    ob = bpy.data.objects.new(name, nm); high_coll().objects.link(ob)
    so = ob.modifiers.new("Solid", 'SOLIDIFY'); so.thickness = thickness; so.offset = 1.0
    so.use_even_offset = False; so.use_quality_normals = True; so.use_rim = True
    if bevel > 0:
        bv = ob.modifiers.new("Bevel", 'BEVEL'); bv.width = bevel; bv.segments = 2
        bv.limit_method = 'ANGLE'; bv.angle_limit = math.radians(35)
    apply_mods(ob)
    for poly_ in ob.data.polygons: poly_.use_smooth = True
    return ob

def chamfer_rect(u0, v0, u1, v1, cu, cv=None):
    """Rectangle with chamfered corners (cu in u units, cv in v units)."""
    cv = cu if cv is None else cv
    return [(u0 + cu, v0), (u1 - cu, v0), (u1, v0 + cv), (u1, v1 - cv), (u1 - cu, v1), (u0 + cu, v1), (u0, v1 - cv), (u0, v0 + cv)]

def mirror_poly(poly):
    return [(-u, v) for (u, v) in reversed(poly)]


# ---------------------------------------------------------------- articulated glove hands
def build_hand(name, J, side, mats_idx=(0, 1, 2), scale=1.0, curl=0.35, bulk=1.0, res=(10, 8)):
    """Glove hand: beveled palm block + 3-segment fingers + thumb, relaxed curl.
    Built in a local frame (x=across palm, y=palm normal, z=finger direction) then aligned to the forearm."""
    import bmesh
    bm = bmesh.new()
    sg = 1 if side == 'L' else -1
    def add(fn, mx, mi):
        t = bmesh.new(); fn(t)
        bmesh.ops.transform(t, matrix=mx, verts=t.verts)
        for f in t.faces: f.material_index = mi
        me = bpy.data.meshes.new("_h"); t.to_mesh(me); t.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    def box(size, bev):
        def fn(t):
            r = bmesh.ops.create_cube(t, size=1.0)
            for v in r['verts']:
                v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
            bmesh.ops.bevel(t, geom=list(t.edges), offset=bev, segments=2, affect='EDGES', profile=0.6)
        return fn
    def capsule(r, L):
        def fn(t):
            bmesh.ops.create_uvsphere(t, u_segments=res[0], v_segments=res[1], radius=r)
            for v in t.verts:
                if v.co.z > 0: v.co.z += L
        return fn
    s_ = scale
    # palm (knuckle guard on back of hand = +y? we treat -y as palm side facing forward/down)
    add(box((0.085 * s_ * bulk, 0.032 * s_ * bulk, 0.09 * s_), 0.008), Matrix.Translation((0, 0, 0.045 * s_)), mats_idx[0])
    add(box((0.078 * s_, 0.012 * s_, 0.05 * s_), 0.004), Matrix.Translation((0, 0.018 * s_, 0.058 * s_)), mats_idx[1])  # knuckle plate
    fingers = [(-0.029, 0.078, 0.97), (-0.0095, 0.086, 1.0), (0.0095, 0.081, 0.97), (0.028, 0.066, 0.88)]
    for (fx, flen, fs) in fingers:
        base = Vector((fx * s_ * bulk, 0.0, 0.09 * s_))
        ang = 0.0
        pos = base.copy()
        segl = [flen * 0.45, flen * 0.32, flen * 0.26]
        for k, L in enumerate(segl):
            ang += curl * (0.6 + 0.4 * k)
            R = Matrix.Rotation(ang, 4, 'X')
            mx = Matrix.Translation(pos) @ R
            add(capsule(0.0098 * s_ * fs * bulk * (1 - 0.1 * k), L * s_), mx, mats_idx[0])
            pos = pos + (R.to_3x3() @ Vector((0, 0, L * s_)))
    # thumb: root on the index side, angled along the palm and toward the palm side (-y)
    tb = Vector((-0.04 * s_ * bulk, -0.01 * s_, 0.022 * s_))
    d0 = Vector((-0.42, -0.38, 0.82)).normalized()
    R0 = Vector((0, 0, 1)).rotation_difference(d0).to_matrix().to_4x4()
    add(capsule(0.0125 * s_ * bulk, 0.034 * s_), Matrix.Translation(tb) @ R0, mats_idx[0])
    tb2 = tb + d0 * 0.034 * s_
    d1 = Vector((-0.12, -0.5, 0.86)).normalized()
    R1 = Vector((0, 0, 1)).rotation_difference(d1).to_matrix().to_4x4()
    add(capsule(0.011 * s_ * bulk, 0.03 * s_), Matrix.Translation(tb2) @ R1, mats_idx[0])
    add(box((0.03 * s_, 0.028 * s_, 0.04 * s_), 0.008), Matrix.Translation(tb * 0.6 + Vector((0.004, 0, 0.004))), mats_idx[0])  # thenar pad
    # mirror for right hand (thumb must be toward the body front); local x mirrored
    if sg < 0:
        bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    # align: local z -> forearm direction, local -y -> forward (-Y world) projected
    wr, palm = J['wr' + side], J['palm' + side]
    d = (palm - wr).normalized()
    fwd = Vector((0, -1, 0))
    yv = -(fwd - d * fwd.dot(d)).normalized()   # local +y = back of hand
    xv = yv.cross(d).normalized()
    M3 = Matrix((xv, yv, d)).transposed()
    mx = Matrix.Translation(wr + d * 0.004) @ M3.to_4x4()
    bmesh.ops.transform(bm, matrix=mx, verts=bm.verts)
    return bm
