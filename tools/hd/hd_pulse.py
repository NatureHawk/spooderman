# THREADLINE HD: surface-routed lines + PULSE hero (run after bl_helpers, hd_char, hd_heroes)
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

def surface_line(body, name, proj, pts2d, radius=0.004, mat=None, offset=0.004, step=0.01):
    """Tube routed over the body surface: 2D polyline in proj space -> ray cast -> curve w/ bevel -> mesh.
    (hard-surface cable-routing technique; used for conductive glow lines)"""
    from mathutils.bvhtree import BVHTree
    src = bmesh.new(); src.from_mesh(body.data)
    tree = BVHTree.FromBMesh(src); src.free()
    pts3 = []
    def cast(u, v):
        o, d = proj.ray(u, v)
        hit, nrm, idx, dist = tree.ray_cast(o, d, 2.0)
        if hit is not None:
            pts3.append(hit + nrm * offset)
    for i in range(len(pts2d) - 1):
        (u0, v0), (u1, v1) = pts2d[i], pts2d[i + 1]
        if proj.kind == 'cyl':
            L = math.hypot(math.radians(u1 - u0) * 0.06, (v1 - v0) * proj.L)
        else:
            L = math.hypot(u1 - u0, v1 - v0)
        n = max(2, int(L / step))
        for k in range(n):
            t = k / n
            cast(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t)
    cast(*pts2d[-1])
    if len(pts3) < 2:
        return None
    cu = bpy.data.curves.new(name + "_cu", 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = radius; cu.bevel_resolution = 2; cu.use_fill_caps = True
    sp = cu.splines.new('POLY'); sp.points.add(len(pts3) - 1)
    for i, p in enumerate(pts3):
        sp.points[i].co = (p.x, p.y, p.z, 1)
    co = bpy.data.objects.new(name + "_c", cu); high_coll().objects.link(co)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(co.evaluated_get(dg))
    bpy.data.objects.remove(co, do_unlink=True); bpy.data.curves.remove(cu)
    if mat is not None:
        me.materials.clear(); me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); high_coll().objects.link(ob)
    for p_ in me.polygons: p_.use_smooth = True
    return ob

def bind_gear(gear):
    """Gear pieces: back items -> chest bone, forearm items -> farmL/farmR."""
    gear.vertex_groups.clear()
    vc = gear.vertex_groups.new(name='chest'); vl = gear.vertex_groups.new(name='farmL'); vr = gear.vertex_groups.new(name='farmR')
    for v in gear.data.vertices:
        if v.co.y > 0.05: vc.add([v.index], 1.0, 'REPLACE')
        elif v.co.x > 0: vl.add([v.index], 1.0, 'REPLACE')
        else: vr.add([v.index], 1.0, 'REPLACE')

def build_pulse():
    name = "HD_PULSE"
    for n in [o.name for o in bpy.data.objects if o.name.startswith(name)]:
        remove_obj(n)
    p = dict(height=1.8, shoulder=0.2, hip=0.094, bulk=0.97, muscle=1.05, chest=1.02, legs=1.02, subdiv=2, lean=0.95)
    body, J = build_body_base(name + "_body", p)
    shape_body(body, J, p)
    rules = [
        (DK, LR(lambda s: near(J, 'el' + s, 0.05))),
        (DK, LR(lambda s: near(J, 'kn' + s, 0.065, (0, 0.02, 0)))),
        (DK, LR(lambda s: limb(J, 'wr' + s, 'palm' + s, 0.16, 0.0, 1.0))),
        (DK, lambda c, n: c.z < 0.2),
    ]
    assign_regions(body, rules, PR)
    arm = []
    FRONT = Proj('planar', origin=(0, 0, 0), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
    BACK = Proj('planar', origin=(0, 0, 0), dir=(0, -1, 0), u=(1, 0, 0), v=(0, 0, 1))
    cz, uz, wz, pz = J['chest'].z, J['uchest'].z, J['waist'].z, J['pelvis'].z
    pec = [(0.02, cz - 0.02), (0.03, uz + 0.02), (0.1, uz + 0.035), (0.15, uz - 0.03), (0.12, cz - 0.03), (0.06, cz - 0.07)]
    arm.append(plate(body, name + "_pecL", FRONT, pec, 0.01, 0.004, SE, 0.0025))
    arm.append(plate(body, name + "_pecR", FRONT, mirror_poly(pec), 0.01, 0.004, SE, 0.0025))
    arm.append(plate(body, name + "_abs", FRONT, [(-0.045, wz - 0.07), (0.045, wz - 0.07), (0.06, wz + 0.05), (0.0, cz - 0.07), (-0.06, wz + 0.05)], 0.009, 0.003, PR, 0.002))
    arm.append(plate(body, name + "_collar", FRONT, chamfer_rect(-0.07, uz + 0.03, 0.07, uz + 0.07, 0.02, 0.015), 0.008, 0.004, AC, 0.002))
    arm.append(plate(body, name + "_spine", BACK, [(-0.05, wz - 0.02), (0.05, wz - 0.02), (0.1, uz), (0.07, uz + 0.05), (-0.07, uz + 0.05), (-0.1, uz)], 0.011, 0.004, SE, 0.0025,
                     extra=lambda c, n: abs(c.x) < 0.14))
    BELT = Proj('cyl', a=(0, 0, pz + 0.03), b=(0, 0, pz + 0.085), ref=(0, -1, 0), rmax=0.32)
    arm.append(plate(body, name + "_belt", BELT, [(-181, 0.15), (181, 0.15), (181, 0.85), (-181, 0.85)], 0.012, 0.004, DK, 0.002,
                     extra=lambda c, n: abs(c.x) < 0.22))
    lines = []
    for s in ('L', 'R'):
        sg = 1 if s == 'L' else -1
        FA = Proj('cyl', a=tuple(J['el' + s]), b=tuple(J['wr' + s]), ref=(0, 0, 1), rmax=0.09)
        arm.append(plate(body, name + "_bracer" + s, FA, chamfer_rect(-181, 0.55, 181, 0.9, 0.1, 0.02), 0.012, 0.004, SE, 0.0025))
        UA = Proj('cyl', a=tuple(J['sh' + s]), b=tuple(J['el' + s]), ref=(0, 0, 1), rmax=0.1)
        arm.append(plate(body, name + "_delt" + s, UA, [(-80, 0.0), (80, 0.0), (70, 0.3), (0, 0.38), (-70, 0.3)], 0.009, 0.004, SE, 0.0025))
        TH = Proj('cyl', a=tuple(J['hip' + s]), b=tuple(J['kn' + s]), ref=(0, -1, 0), rmax=0.15)
        SH = Proj('cyl', a=tuple(J['kn' + s]), b=tuple(J['an' + s]), ref=(0, -1, 0), rmax=0.11)
        arm.append(plate(body, name + "_shin" + s, SH, [(-38, 0.18), (0, 0.12), (38, 0.18), (42, 0.7), (0, 0.84), (-42, 0.7)], 0.011, 0.004, SE, 0.0025))
        KN = Proj('planar', origin=tuple(J['kn' + s]), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
        arm.append(plate(body, name + "_knee" + s, KN, [(0, -0.045), (0.04, -0.015), (0.035, 0.035), (-0.035, 0.035), (-0.04, -0.015)], 0.012, 0.006, AC, 0.003))
        an = J['an' + s]
        BOOT = Proj('cyl', a=(an.x, an.y - 0.02, 0.0), b=(an.x, an.y - 0.02, 0.2), ref=(0, -1, 0), rmax=0.2)
        arm.append(plate(body, name + "_boot" + s, BOOT, [(-181, -2.0), (181, -2.0), (181, 0.8), (-181, 0.8)], 0.01, 0.005, DK, 0.003,
                         extra=lambda c, n, an=an: abs(c.x - an.x) < 0.12))
        # conductive glow lines routed over the suit
        out = -sg * 90
        lines.append(surface_line(body, name + "_lnA" + s, UA, [(0, 0.38), (0, 1.0)], 0.0032, GL))
        lines.append(surface_line(body, name + "_lnF" + s, FA, [(0, 0.0), (0, 0.55)], 0.0032, GL))
        lines.append(surface_line(body, name + "_lnT" + s, TH, [(out, 0.05), (out * 0.8, 0.5), (out * 0.9, 0.95)], 0.0036, GL))
        lines.append(surface_line(body, name + "_lnS" + s, SH, [(out * 0.9, 0.05), (out, 0.5), (out * 0.9, 0.9)], 0.0036, GL))
        lines.append(surface_line(body, name + "_lnC" + s, FRONT, [(sg * 0.17, uz), (sg * 0.06, cz - 0.08), (sg * 0.012, wz - 0.05)], 0.0034, GL))
    lines.append(surface_line(body, name + "_lnSp", BACK, [(0, pz + 0.1), (0, uz + 0.04)], 0.0036, GL))
    arm += [l for l in lines if l is not None]
    arm = [a_ for a_ in arm if a_ is not None]
    helm = build_helmet(name + "_helmet", J, 'pulse')
    hands = {}
    for s_ in ('L', 'R'):
        hands[s_] = bm_to_obj(build_hand(name + "_hand" + s_, J, s_, (0, 1, 2), 1.0, 0.3, 0.98), name + "_hand" + s_, [DK, SE, GL])
    back = J['chest'] + Vector((0, 0.115, 0.03))
    gp = [
        (g_box((0.17, 0.06, 0.2), bevel=0.012, segs=3, taper=(0.8, 0.9)), TR(back), 1),
        (g_cyl(0.026, 0.19, 20, bevel=0.003), TR(back + Vector((-0.055, 0.045, -0.095))), 4),
        (g_cyl(0.026, 0.19, 20, bevel=0.003), TR(back + Vector((0.055, 0.045, -0.095))), 4),
        (g_box((0.05, 0.02, 0.12), bevel=0.004), TR(back + Vector((0, 0.04, 0.0))), 2),
    ]
    for (x, z) in ((-0.055, 0.1), (0.055, 0.1), (-0.055, -0.115), (0.055, -0.115)):
        gp.append((g_cyl(0.03, 0.02, 20, bevel=0.003), TR(back + Vector((x, 0.045, z))), 3))
    for s in ('L', 'R'):
        wr, el = J['wr' + s], J['el' + s]
        d = (wr - el).normalized()
        q = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
        for tt in (0.62, 0.86):
            gp.append((g_cyl(0.047, 0.012, 28, bevel=0.002, caps=False), Matrix.Translation(el.lerp(wr, tt)) @ q, 4))
    gear = piece(name + "_gear", gp, [PR, SE, AC, DK, GL])
    rig = build_armature(name, J)
    auto_weight(body, rig)
    for a_ in arm:
        if len(a_.data.polygons): transfer_weights(body, a_)
    rigid_weight(helm, rig, 'head')
    for s_ in ('L', 'R'):
        rigid_weight(hands[s_], rig, 'hand' + s_)
    arm += [hands['L'], hands['R']]
    bind_gear(gear)
    return body, arm, helm, gear, rig, J
