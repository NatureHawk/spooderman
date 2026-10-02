# THREADLINE HD heroes: WEAVER + PULSE (run after bl_helpers.py and hd_char.py)
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

PR, SE, AC, DK, GL = (M['slot_primary'], M['slot_secondary'], M['slot_accent'], M['slot_dark'], M['slot_glow'])

def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length, t

def limb(J, a, b, r, t0=0.0, t1=1.0):
    A, B = J[a], J[b]
    def fn(c, n):
        d, t = seg_dist(c, A, B)
        return d < r and t0 <= t <= t1
    return fn

def stripe(J, a, b, r, t0, t1, width):
    """Thin line along the top (+Z-facing side) of a limb segment."""
    A, B = J[a], J[b]
    def fn(c, n):
        d, t = seg_dist(c, A, B)
        if d > r or not (t0 < t < t1):
            return False
        axis = A + (B - A) * t
        return abs(c.y - axis.y) < width and c.z > axis.z
    return fn

def near(J, key, r, off=(0, 0, 0)):
    C = J[key] + Vector(off)
    return lambda c, n: (c - C).length < r

def both(fnL, fnR):
    return lambda c, n: fnL(c, n) or fnR(c, n)

def LR(maker):
    return both(maker('L'), maker('R'))

# ------------------------------------------------------------------ helmet
def _skull(name, hc, sx, sy, sz, mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=36, v_segments=24, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        if z < -0.05:                       # jaw taper + chin forward
            k = smoothstep(-0.05, -1.0, z)
            x *= 1 - 0.38 * k
            if y < 0: y = y * (1 - 0.1 * k) - 0.12 * k
            else: y *= 1 - 0.35 * k
        if y < -0.55:                       # flatter face plane
            y = -0.55 + (y + 0.55) * 0.5
        if y > 0.2 and z > -0.3:            # occipital fullness
            y *= 1.07
        if z > 0.6:                         # slightly flatter crown
            z = 0.6 + (z - 0.6) * 0.85
        v.co = Vector((x * sx, y * sy, z * sz)) + hc
    ob = bm_to_obj(bm, name, [mat])
    return ob

def build_helmet(name, J, style='weaver'):
    """Designed helmet: sculpted skull + projected plates (faceplate, visor band, crest, cheek vents, neck guard)."""
    hc = J['head'] + Vector((0, -0.012, 0.108))
    z = hc.z
    if style == 'weaver':
        sk = _skull(name + "_skull", hc, 0.106, 0.122, 0.132, PR)
    else:
        sk = _skull(name + "_skull", hc, 0.097, 0.116, 0.128, PR)
    FR = Proj('planar', origin=(0, 0, 0), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
    TOP = Proj('planar', origin=(0, 0, 0), dir=(0, 0, -1), u=(1, 0, 0), v=(0, 1, 0))
    BK = Proj('planar', origin=(0, 0, 0), dir=(0, -1, 0), u=(1, 0, 0), v=(0, 0, 1))
    parts = []
    if style == 'weaver':
        face = [(-0.058, z - 0.118), (0.058, z - 0.118), (0.098, z - 0.045), (0.1, z - 0.004), (0.024, z - 0.008),
                (0.0, z - 0.03), (-0.024, z - 0.008), (-0.1, z - 0.004), (-0.098, z - 0.045)]
        parts.append(plate(sk, name + "_face", FR, face, 0.008, 0.003, SE, 0.002))
        visor = [(-0.09, z + 0.03), (-0.074, z + 0.004), (-0.026, z + 0.0), (0.0, z - 0.014), (0.026, z + 0.0),
                 (0.074, z + 0.004), (0.09, z + 0.03), (0.05, z + 0.044), (-0.05, z + 0.044)]
        parts.append(plate(sk, name + "_visor", FR, visor, 0.004, 0.002, GL, 0.0012))
        parts.append(plate(sk, name + "_brow", FR, [(-0.085, z + 0.05), (0.085, z + 0.05), (0.07, z + 0.068), (-0.07, z + 0.068)], 0.006, 0.003, DK, 0.0015))
        parts.append(plate(sk, name + "_crest", TOP, chamfer_rect(-0.02, -0.11, 0.02, 0.1, 0.008, 0.02), 0.008, 0.003, AC, 0.002))
        parts.append(plate(sk, name + "_neckg", BK, chamfer_rect(-0.08, z - 0.12, 0.08, z - 0.04, 0.02, 0.02), 0.01, 0.003, SE, 0.002))
        for sgn in (1, -1):
            SD = Proj('planar', origin=(0, 0, 0), dir=(-sgn, 0, 0), u=(0, 1, 0), v=(0, 0, 1))
            parts.append(plate(sk, name + "_cheek%d" % sgn, SD, chamfer_rect(-0.075, z - 0.1, -0.02, z - 0.035, 0.012), 0.006, 0.003, DK, 0.0015))
    else:
        VB = Proj('cyl', a=(hc.x, hc.y + 0.02, z - 0.03), b=(hc.x, hc.y + 0.02, z + 0.07), ref=(0, -1, 0))
        parts.append(plate(sk, name + "_visor", VB, [(-78, 0.3), (78, 0.3), (84, 0.55), (70, 0.74), (-70, 0.74), (-84, 0.55)], 0.004, 0.002, GL, 0.0012))
        parts.append(plate(sk, name + "_chin", FR, [(-0.05, z - 0.115), (0.05, z - 0.115), (0.085, z - 0.05), (0.06, z - 0.02), (-0.06, z - 0.02), (-0.085, z - 0.05)], 0.007, 0.003, SE, 0.002))
        parts.append(plate(sk, name + "_seam", TOP, chamfer_rect(-0.006, -0.1, 0.006, 0.11, 0.003, 0.01), 0.004, 0.002, GL, 0.001))
        parts.append(plate(sk, name + "_neckg", BK, chamfer_rect(-0.07, z - 0.11, 0.07, z - 0.05, 0.02, 0.02), 0.008, 0.003, SE, 0.002))
        for sgn in (1, -1):
            SD = Proj('planar', origin=(0, 0, 0), dir=(-sgn, 0, 0), u=(0, 1, 0), v=(0, 0, 1))
            parts.append(plate(sk, name + "_side%d" % sgn, SD, [(-0.06, z + 0.06), (0.05, z + 0.01), (0.05, z - 0.02), (-0.07, z + 0.03)], 0.006, 0.003, SE, 0.0015))
    # ear pods + neck seal (hard surface)
    bm = bmesh.new()
    for sgn in (1, -1):
        ex = hc.x + sgn * (0.103 if style == 'weaver' else 0.094)
        mat = Matrix.Translation(Vector((ex, hc.y + 0.01, z - 0.005))) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4()
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.032, radius2=0.027, depth=0.022, matrix=mat)
        for f in {f for v in res['verts'] for f in v.link_faces}: f.material_index = 1
        mat2 = Matrix.Translation(Vector((ex + sgn * 0.012, hc.y + 0.01, z - 0.005))) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4()
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.014, radius2=0.012, depth=0.006, matrix=mat2)
        for f in {f for v in res['verts'] for f in v.link_faces}: f.material_index = 4 if style == 'pulse' else 2
    res = bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=0.054, radius2=0.048, depth=0.075,
                                matrix=Matrix.Translation(J['neck'] + Vector((0, 0.005, 0.045))))
    for f in {f for v in res['verts'] for f in v.link_faces}: f.material_index = 3
    hw = bm_to_obj(bm, name + "_hw", [PR, SE, AC, DK, GL])
    return join([sk, hw] + [x for x in parts if x is not None], name)

# ------------------------------------------------------------------ hard-surface helpers (bmesh)
def hs_add(bm, build_fn, matrix, mi):
    """Build geometry into a temp bmesh, transform, tag material, merge into bm."""
    t = bmesh.new()
    build_fn(t)
    bmesh.ops.transform(t, matrix=matrix, verts=t.verts)
    for f in t.faces:
        f.material_index = mi if f.material_index == 0 else f.material_index
    me = bpy.data.meshes.new("_tmp_hs")
    t.to_mesh(me); t.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)

def g_box(size, bevel=0.004, segs=2, taper=None):
    def fn(t):
        r = bmesh.ops.create_cube(t, size=1.0)
        for v in r['verts']:
            v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
            if taper and v.co.z > 0:
                v.co.x *= taper[0]; v.co.y *= taper[1]
        if bevel > 0:
            bmesh.ops.bevel(t, geom=list(t.edges), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    return fn

def g_cyl(r1, depth, segs=24, r2=None, bevel=0.0, caps=True):
    def fn(t):
        bmesh.ops.create_cone(t, cap_ends=caps, segments=segs, radius1=r1, radius2=(r1 if r2 is None else r2), depth=depth)
        if bevel > 0:
            ed = [e for e in t.edges if e.calc_face_angle(0) > 0.6]
            bmesh.ops.bevel(t, geom=ed, offset=bevel, segments=2, affect='EDGES', profile=0.5)
    return fn

def g_sph(r, u=20, v=14, scale=(1, 1, 1)):
    def fn(t):
        bmesh.ops.create_uvsphere(t, u_segments=u, v_segments=v, radius=r)
        for vv in t.verts:
            vv.co.x *= scale[0]; vv.co.y *= scale[1]; vv.co.z *= scale[2]
    return fn

def pauldron_shell(name, sh, sg, r, mats, layers=2):
    """Layered spherical-cap shoulder armor (hard surface), tilted outward over the deltoid."""
    bm = bmesh.new()
    for li in range(layers):
        t = bmesh.new()
        rr = r * (1.0 - 0.16 * li)
        bmesh.ops.create_uvsphere(t, u_segments=28, v_segments=16, radius=rr)
        cut = -0.25 + 0.35 * li
        bmesh.ops.delete(t, geom=[v for v in t.verts if v.co.z < cut * rr], context='VERTS')
        for v in t.verts:
            v.co.y *= 1.12; v.co.z *= 0.72
        # solidify manually: extrude inward
        faces = list(t.faces)
        ext = bmesh.ops.extrude_face_region(t, geom=faces)
        nv = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
        for v in nv:
            v.co *= 0.9
        bmesh.ops.reverse_faces(t, faces=faces)
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        for f in t.faces: f.material_index = li
        me = bpy.data.meshes.new("_p"); t.to_mesh(me); t.free()
        tmp = bmesh.new(); tmp.from_mesh(me); bpy.data.meshes.remove(me)
        bmesh.ops.transform(tmp, matrix=Matrix.Translation((0, 0, 0.012 * li)), verts=tmp.verts)
        me = bpy.data.meshes.new("_p2"); tmp.to_mesh(me); tmp.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    mx = Matrix.Translation(sh + Vector((sg * 0.035, 0.0, 0.035))) @ Euler((0, sg * math.radians(38), 0)).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=mx, verts=bm.verts)
    return bm_to_obj(bm, name, mats)

def TR(loc, rot=(0, 0, 0)):
    return Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()

def piece(name, parts, mats):
    """parts: list of (build_fn, matrix, material_index)."""
    bm = bmesh.new()
    for (fn, mx, mi) in parts:
        hs_add(bm, fn, mx, mi)
    for f in bm.faces:
        pass
    ob = bm_to_obj(bm, name, mats)
    # auto smooth look: keep smooth shading; hard edges come from bevels
    return ob

def set_mi(ob, mi_map_fn):
    for poly in ob.data.polygons:
        poly.material_index = mi_map_fn(poly)

# ------------------------------------------------------------------ WEAVER
def build_weaver():
    name = "HD_WEAVER"
    for n in [o.name for o in bpy.data.objects if o.name.startswith(name)]:
        remove_obj(n)
    p = dict(height=1.88, shoulder=0.228, hip=0.098, bulk=1.13, muscle=1.3, chest=1.14, subdiv=2)
    body, J = build_body_base(name + "_body", p)
    shape_body(body, J, p)
    # --- suit regions on the body
    rules = [
        (DK, LR(lambda s: near(J, 'el' + s, 0.06))),
        (DK, LR(lambda s: near(J, 'kn' + s, 0.075, (0, 0.02, 0)))),
        (DK, LR(lambda s: limb(J, 'wr' + s, 'palm' + s, 0.16, 0.0, 1.0))),          # gloves
        (DK, lambda c, n: c.z < 0.2),                                                  # boots base
        (GL, LR(lambda s: stripe(J, 'sh' + s, 'el' + s, 0.1, 0.12, 0.9, 0.012))),      # amber arm lines
        (GL, LR(lambda s: stripe(J, 'el' + s, 'wr' + s, 0.1, 0.1, 0.5, 0.01))),
        (SE, lambda c, n: abs(n.x) > 0.75 and J['waist'].z - 0.05 < c.z < J['uchest'].z),   # flank panels
    ]
    assign_regions(body, rules, PR)
    # --- armor plates from designed outlines (projected onto the body)
    arm = []
    FRONT = Proj('planar', origin=(0, 0, 0), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
    BACK = Proj('planar', origin=(0, 0, 0), dir=(0, -1, 0), u=(1, 0, 0), v=(0, 0, 1))
    cz, uz = J['chest'].z, J['uchest'].z
    chestL = [(0.013, cz - 0.075), (0.013, uz + 0.03), (0.07, uz + 0.05), (0.15, uz + 0.02), (0.178, uz - 0.05),
              (0.165, cz + 0.0), (0.115, cz - 0.065), (0.05, cz - 0.09)]
    arm.append(plate(body, name + "_chestL", FRONT, chestL, 0.017, 0.005, SE, 0.003))
    arm.append(plate(body, name + "_chestR", FRONT, mirror_poly(chestL), 0.017, 0.005, SE, 0.003))
    # sternum core housing (amber)
    arm.append(plate(body, name + "_core", FRONT, chamfer_rect(-0.011, cz - 0.06, 0.011, uz - 0.01, 0.004, 0.01), 0.01, 0.009, GL, 0.0015))
    wz = J['waist'].z
    for k in range(3):
        z0 = wz - 0.085 + k * 0.056
        for sgn in (1, -1):
            pl = chamfer_rect(0.012, z0, 0.088 - k * 0.004, z0 + 0.046, 0.012, 0.01)
            arm.append(plate(body, name + "_ab%d%s" % (k, 'L' if sgn > 0 else 'R'), FRONT,
                             pl if sgn > 0 else mirror_poly(pl), 0.011, 0.004, PR, 0.002))
    backpl = [(-0.14, cz - 0.1), (0.14, cz - 0.1), (0.175, uz - 0.02), (0.11, uz + 0.05), (-0.11, uz + 0.05), (-0.175, uz - 0.02)]
    arm.append(plate(body, name + "_back", BACK, backpl, 0.014, 0.005, SE, 0.003,
                     extra=lambda c, n: abs(c.x) < 0.17 and c.y > 0.0))
    pz = J['pelvis'].z
    BELT = Proj('cyl', a=(0, 0, pz + 0.02), b=(0, 0, pz + 0.1), ref=(0, -1, 0), rmax=0.32)
    arm.append(plate(body, name + "_belt", BELT, [(-181, 0.12), (181, 0.12), (181, 0.88), (-181, 0.88)], 0.02, 0.005, AC, 0.003,
                     extra=lambda c, n: abs(c.x) < 0.24))
    for s in ('L', 'R'):
        sg = 1 if s == 'L' else -1
        sh = J['sh' + s]
        arm.append(pauldron_shell(name + "_paul" + s, J['sh' + s], sg, 0.105, [SE, AC]))
        FA = Proj('cyl', a=tuple(J['el' + s]), b=tuple(J['wr' + s]), ref=(0, 0, 1), rmax=0.09)
        arm.append(plate(body, name + "_bracer" + s, FA, chamfer_rect(-105, 0.3, 105, 0.93, 18, 0.06), 0.015, 0.004, SE, 0.003))
        UA = Proj('cyl', a=tuple(J['sh' + s]), b=tuple(J['el' + s]), ref=(0, 0, 1), rmax=0.1)
        arm.append(plate(body, name + "_upa" + s, UA, chamfer_rect(-70, 0.45, 70, 0.82, 14, 0.05), 0.01, 0.004, PR, 0.002))
        TH = Proj('cyl', a=tuple(J['hip' + s]), b=tuple(J['kn' + s]), ref=(0, -1, 0), rmax=0.15)
        arm.append(plate(body, name + "_thigh" + s, TH, [(-62, 0.2), (62, 0.2), (72, 0.5), (55, 0.74), (-55, 0.74), (-72, 0.5)], 0.013, 0.004, SE, 0.003))
        KN = Proj('planar', origin=tuple(J['kn' + s] + Vector((0, 0, 0.005))), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
        arm.append(plate(body, name + "_knee" + s, KN, [(0.0, -0.06), (0.05, -0.03), (0.055, 0.03), (0.0, 0.065), (-0.055, 0.03), (-0.05, -0.03)], 0.02, 0.008, AC, 0.004))
        SH = Proj('cyl', a=tuple(J['kn' + s]), b=tuple(J['an' + s]), ref=(0, -1, 0), rmax=0.11)
        arm.append(plate(body, name + "_shin" + s, SH, [(-50, 0.15), (0, 0.1), (50, 0.15), (58, 0.6), (42, 0.84), (-42, 0.84), (-58, 0.6)], 0.014, 0.004, SE, 0.003))
        an = J['an' + s]
        BOOT = Proj('cyl', a=(an.x, an.y - 0.02, 0.0), b=(an.x, an.y - 0.02, 0.2), ref=(0, -1, 0), rmax=0.2)
        arm.append(plate(body, name + "_boot" + s, BOOT, [(-181, -2.0), (181, -2.0), (181, 0.86), (-181, 0.86)], 0.012, 0.006, DK, 0.003,
                         extra=lambda c, n, an=an: abs(c.x - an.x) < 0.12))
    arm = [a_ for a_ in arm if a_ is not None]
    # --- helmet + gloved hands
    helm = build_helmet(name + "_helmet", J, 'weaver')
    hands = {}
    for s_ in ('L', 'R'):
        hands[s_] = bm_to_obj(build_hand(name + "_hand" + s_, J, s_, (0, 1, 2), 1.1, 0.3, 1.1), name + "_hand" + s_, [DK, SE, AC])
    # --- reel pack (hard surface) on the back + launchers on bracers
    back = J['chest'] + Vector((0, 0.135, 0.05))
    pack_parts = [
        (g_box((0.26, 0.11, 0.3), bevel=0.012, segs=3, taper=(0.9, 0.85)), TR(back), 3),
        (g_box((0.2, 0.03, 0.22), bevel=0.006), TR(back + Vector((0, 0.06, 0.0))), 1),
        (g_cyl(0.06, 0.05, 28, bevel=0.004), TR(back + Vector((-0.07, 0.07, 0.06)), (math.pi / 2, 0, 0)), 2),
        (g_cyl(0.06, 0.05, 28, bevel=0.004), TR(back + Vector((0.07, 0.07, 0.06)), (math.pi / 2, 0, 0)), 2),
        (g_cyl(0.025, 0.056, 16), TR(back + Vector((-0.07, 0.073, 0.06)), (math.pi / 2, 0, 0)), 4),
        (g_cyl(0.025, 0.056, 16), TR(back + Vector((0.07, 0.073, 0.06)), (math.pi / 2, 0, 0)), 4),
        (g_box((0.05, 0.02, 0.12), bevel=0.004), TR(back + Vector((0, 0.065, -0.08))), 4),
    ]
    # tension-arm shoulder mounts (4 sockets)
    for (x, z) in ((-0.1, 0.12), (0.1, 0.12), (-0.11, -0.08), (0.11, -0.08)):
        pack_parts.append((g_sph(0.03, 16, 12), TR(back + Vector((x, 0.04, z))), 3))
        pack_parts.append((g_cyl(0.034, 0.02, 20, bevel=0.003), TR(back + Vector((x, 0.03, z)), (math.pi / 2, 0, 0)), 2))
    for s in ('L', 'R'):
        wr, el = J['wr' + s], J['el' + s]
        d = (wr - el).normalized()
        mid = el.lerp(wr, 0.62) + Vector((0, -0.045, 0))
        q = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
        pack_parts.append((g_box((0.05, 0.045, 0.12), bevel=0.006, segs=2), Matrix.Translation(mid) @ q, 1))
        pack_parts.append((g_cyl(0.012, 0.03, 12), Matrix.Translation(mid + d * 0.07) @ q, 4))
        pack_parts.append((g_box((0.012, 0.047, 0.07), bevel=0.0), Matrix.Translation(mid + Vector((0, -0.001, 0))) @ q, 4))
    pack = piece(name + "_gear", pack_parts, [PR, SE, AC, DK, GL])
    # --- armature + weights
    rig = build_armature(name, J)
    auto_weight(body, rig)
    for a_ in arm:
        if len(a_.data.polygons):
            transfer_weights(body, a_)
    rigid_weight(helm, rig, 'head')
    for s_ in ('L', 'R'):
        rigid_weight(hands[s_], rig, 'hand' + s_)
    arm += [hands['L'], hands['R']]
    # gear: pack -> chest, launchers -> forearms (split by x side / height)
    pack.vertex_groups.clear()
    vc = pack.vertex_groups.new(name='chest'); vl = pack.vertex_groups.new(name='farmL'); vr = pack.vertex_groups.new(name='farmR')
    for v in pack.data.vertices:
        if v.co.y > 0.05: vc.add([v.index], 1.0, 'REPLACE')
        elif v.co.x > 0: vl.add([v.index], 1.0, 'REPLACE')
        else: vr.add([v.index], 1.0, 'REPLACE')
    return body, arm, helm, pack, rig, J

def finalize_character(name, body, pieces, rig):
    """Join body + pieces into one skinned mesh (vertex groups preserved by bmesh deform layer)."""
    objs = [body] + [o for o in pieces if o is not None and len(o.data.polygons)]
    # use operator join to preserve vertex groups
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs:
        o.select_set(True)
        if o.parent is None:
            pass
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = name + "_skin"
    # make sure armature modifier exists
    if not any(m.type == 'ARMATURE' for m in body.modifiers):
        m = body.modifiers.new("Armature", 'ARMATURE'); m.object = rig
    body.parent = rig
    return body

# ------------------------------------------------------------------ WEAVER tension arms (rigid parts)
def build_tension_arm_parts():
    """Three rigid parts; each origin = its proximal joint pivot, extending along -Z.
    tarm1: shoulder mount -> elbow (0.55 m), tarm2: elbow -> wrist (0.5 m), tclaw: 3-finger gripper."""
    out = {}
    mats = [PR, SE, AC, DK, GL]
    # segment 1: armored sleeve + hydraulic piston + knuckles
    p1 = [
        (g_sph(0.045, 20, 14), TR((0, 0, 0)), 3),
        (g_cyl(0.05, 0.05, 24, bevel=0.004), TR((0, -0.025, 0), (math.pi / 2, 0, 0)), 1),
        (g_cyl(0.034, 0.36, 20, r2=0.03, bevel=0.003), TR((0, 0, -0.42)), 0),
        (g_box((0.052, 0.03, 0.26), bevel=0.006, taper=(0.85, 1.0)), TR((0, -0.03, -0.24)), 1),
        (g_cyl(0.011, 0.3, 12), TR((0, 0.036, -0.46)), 4),
        (g_cyl(0.016, 0.16, 14), TR((0, 0.036, -0.2)), 3),
        (g_box((0.02, 0.012, 0.18), bevel=0.003), TR((0, -0.047, -0.24)), 2),
        (g_cyl(0.04, 0.05, 24, bevel=0.004), TR((0.025, 0, -0.55), (0, math.pi / 2, 0)), 1),
        (g_sph(0.034, 18, 12), TR((0, 0, -0.55)), 3),
    ]
    out['tarm1'] = piece("HD_WEAVER_tarm1", p1, mats)
    p2 = [
        (g_sph(0.036, 18, 12), TR((0, 0, 0)), 3),
        (g_cyl(0.028, 0.34, 18, r2=0.022, bevel=0.003), TR((0, 0, -0.4)), 0),
        (g_box((0.042, 0.026, 0.22), bevel=0.005, taper=(0.8, 1.0)), TR((0, -0.026, -0.2)), 1),
        (g_cyl(0.009, 0.28, 10), TR((0, 0.03, -0.42)), 4),
        (g_box((0.014, 0.01, 0.16), bevel=0.002), TR((0, -0.04, -0.2)), 2),
        (g_cyl(0.03, 0.04, 20, bevel=0.003), TR((0.02, 0, -0.5), (0, math.pi / 2, 0)), 1),
    ]
    out['tarm2'] = piece("HD_WEAVER_tarm2", p2, mats)
    p3 = [(g_cyl(0.03, 0.05, 20, r2=0.034, bevel=0.003), TR((0, 0, -0.05)), 1),
          (g_cyl(0.012, 0.02, 12), TR((0, 0, -0.062)), 4)]
    for k in range(3):
        ang = k * 2 * math.pi / 3
        R = Euler((0, 0, ang)).to_matrix().to_4x4()
        base = Matrix.Translation((0, 0, -0.05)) @ R
        p3.append((g_box((0.016, 0.012, 0.07), bevel=0.003), base @ TR((0.025, 0, -0.03), (0, 0.35, 0)), 0))
        p3.append((g_box((0.013, 0.01, 0.06), bevel=0.003, taper=(0.5, 0.8)), base @ TR((0.04, 0, -0.085), (0, -0.25, 0)), 2))
        p3.append((g_sph(0.009, 10, 8), base @ TR((0.034, 0, -0.058)), 3))
    out['tclaw'] = piece("HD_WEAVER_tclaw", p3, mats)
    return out
