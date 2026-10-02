# THREADLINE HD NPCs: pedestrians (3 body types, faces, hair, clothing) + MERIDIAN soldiers + gear
# run after bl_helpers, hd_char, hd_heroes, hd_pulse
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

SKIN, BODY = M['slot_skin'], M['slot_body']
HAIR = M['hair']
SHOE = M['rubber']
EYEW = tl_mat('tl_eyewhite', (0.92, 0.9, 0.86))
EYED = tl_mat('tl_iris', (0.12, 0.09, 0.07))
LIP = tl_mat('tl_lip', (0.55, 0.33, 0.3))

def blob_disp(v, center, radii, amount, dirv):
    d = Vector(((v.x - center[0]) / radii[0], (v.y - center[1]) / radii[1], (v.z - center[2]) / radii[2])).length
    if d < 1.0:
        f = (1 - d * d) ** 2
        return dirv * (amount * f)
    return Vector((0, 0, 0))

def build_face_head(name, J, sx=0.078, sy=0.094, sz=0.106, female=False):
    """Stylized-realistic human head: sculpted sphere (jaw, cheekbones, brow, sockets, nose, lips),
    eyes, ears. Returns object; material slots [skin, eyewhite, iris, lip]."""
    hc = J['head'] + Vector((0, -0.012, 0.086))
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=24, radius=1.0)
    fwd = Vector((0, -1, 0))
    for v in bm.verts:
        p = v.co.copy()
        x, y, z = p
        # cranium/jaw
        if z < -0.05:
            k = smoothstep(-0.05, -1.0, z)
            x *= 1 - (0.3 if not female else 0.36) * k
            if y < 0: y = y * (1 - 0.12 * k) - 0.1 * k
            else: y *= 1 - 0.42 * k
        if y > 0.3 and z > -0.2: y *= 1.05
        p = Vector((x, y, z))
        off = Vector((0, 0, 0))
        off += blob_disp(p, (0.0, -1.0, -0.12), (0.13, 0.45, 0.36), 0.3, fwd)            # nose
        off += blob_disp(p, (0.0, -1.0, -0.36), (0.2, 0.3, 0.1), 0.06, fwd)             # nostrils/tip
        off += blob_disp(p, (0.0, -1.0, -0.35), (0.12, 0.3, 0.08), -0.02, fwd)          # nose base shadow
        for sg in (1, -1):
            off += blob_disp(p, (sg * 0.36, -0.9, 0.06), (0.2, 0.3, 0.14), -0.12, fwd)  # eye sockets
            off += blob_disp(p, (sg * 0.55, -0.75, -0.18), (0.25, 0.3, 0.2), 0.05, fwd)  # cheekbones
            off += blob_disp(p, (sg * 0.35, -0.95, 0.24), (0.27, 0.3, 0.08), 0.06, fwd)  # brow
        off += blob_disp(p, (0.0, -0.95, -0.52), (0.26, 0.3, 0.07), 0.04, fwd)          # upper lip
        off += blob_disp(p, (0.0, -0.95, -0.64), (0.22, 0.3, 0.06), 0.035, fwd)         # lower lip
        off += blob_disp(p, (0.0, -0.9, -0.85), (0.22, 0.3, 0.12), 0.05, fwd)           # chin
        p += off
        v.co = Vector((p.x * sx, p.y * sy, p.z * sz)) + hc
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median() - hc
        f.material_index = 0
    # eyes
    for sg in (1, -1):
        ec = hc + Vector((sg * 0.03, -sy * 0.82, 0.008))
        r = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.0135)
        for v in r['verts']: v.co += ec
        for f in {f for v in r['verts'] for f in v.link_faces}:
            f.material_index = 2 if (f.calc_center_median() - ec).normalized().y < -0.75 else 1
        # ears
        r = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        for v in r['verts']:
            v.co = Vector((v.co.x * 0.012, v.co.y * 0.022, v.co.z * 0.03)) + hc + Vector((sg * sx * 0.98, 0.005, -0.004))
        for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = 0
    return bm_to_obj(bm, name, [SKIN, EYEW, EYED, LIP]), hc

def build_hair(head_ob, name, hc, style='short'):
    """Hair shell: cylindrical projection around the head axis; the outline is a hairline curve
    (front forehead -> temples -> above ears -> nape) so the border is clean on every side."""
    HP = Proj('cyl', a=(hc.x, hc.y, hc.z - 0.14), b=(hc.x, hc.y, hc.z + 0.2), ref=(0, -1, 0), rmax=0.2, allfacing=True)
    def tz(z): return (z - (hc.z - 0.14)) / 0.34
    nape = {'short': -0.045, 'buzz': -0.03, 'bob': -0.1, 'long': -0.16, 'pony': -0.05}[style]
    front = 0.062 if style != 'bob' else 0.05
    line = [(0, front), (35, front - 0.004), (65, 0.045), (95, 0.028), (115, 0.0), (140, nape * 0.6), (180, nape)]
    pos = [(a_, tz(hc.z + z_)) for (a_, z_) in line]                  # 0 .. 180 (front -> back)
    neg = [(-a_, v) for (a_, v) in reversed(pos) if a_ > 0]           # -180 .. -35
    ordered = neg + pos                                                 # monotonic -180 .. 180
    nz = tz(hc.z + nape)
    outline = [(-181, nz)] + [p_ for p_ in ordered if -180 < p_[0] < 180] + [(181, nz), (181, 2.0), (-181, 2.0)]
    parts = [plate(head_ob, name + "_cap", HP, outline, 0.013 if style != 'buzz' else 0.005, 0.003, HAIR, 0.0)]
    objs = [p_ for p_ in parts if p_ is not None]
    if style == 'pony':
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.024, radius2=0.01, depth=0.17,
                              matrix=Matrix.Translation(hc + Vector((0, 0.105, -0.035))) @ Euler((0.45, 0, 0)).to_matrix().to_4x4())
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=0.026, matrix=Matrix.Translation(hc + Vector((0, 0.095, 0.0))))
        objs.append(bm_to_obj(bm, name + "_pony", [HAIR]))
    if style == 'long':
        bm = bmesh.new()
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r['verts']:
            v.co = Vector((v.co.x * 0.16, v.co.y * 0.045, v.co.z * 0.18)) + hc + Vector((0, 0.08, -0.14))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.02, segments=3, affect='EDGES')
        objs.append(bm_to_obj(bm, name + "_long", [HAIR]))
    return objs

def clothing_rules(J, top='tee', bottom='pants'):
    """Region materials on the body: shirt/jacket (slot_body), pants (slot_secondary), skin, shoes."""
    SE_ = M['slot_secondary']; AC_ = M['slot_accent']
    sleeve_t = {'tee': 0.45, 'long': 1.1, 'jacket': 1.1, 'tank': -1}[top]
    rules = [
        (SHOE, lambda c, n: c.z < 0.1),
        (SKIN, LR(lambda s: limb(J, 'wr' + s, 'palm' + s, 0.15, 0.0, 1.0))),
    ]
    if sleeve_t < 1.0:
        rules.append((SKIN, LR(lambda s: (lambda c, n, s=s: (lambda dt: dt[0] < 0.1 and dt[1] > sleeve_t)(seg_dist(c, J['sh' + s], J['el' + s])) or
                                                        limb(J, 'el' + s, 'wr' + s, 0.1)(c, n)))))
    if bottom == 'shorts':
        rules.append((SKIN, lambda c, n: 0.1 <= c.z < J['kn' + 'L'].z + 0.07))
    elif bottom == 'skirt':
        rules.append((SKIN, lambda c, n: 0.1 <= c.z < J['kn' + 'L'].z + 0.02))
    rules.append((SKIN, lambda c, n: c.z > J['uchest'].z + 0.055 and abs(c.x) < 0.09))          # neck
    rules.append((SE_, lambda c, n: 0.1 <= c.z < J['pelvis'].z + 0.07 and not (abs(c.x) > 0.2 and c.z > J['pelvis'].z - 0.1)))  # pants
    return rules

def build_ped(kind='m', variant=0):
    """kind m/f/h (male, female, heavy). Returns skinned parts."""
    name = "HD_PED_" + kind
    for n in [o.name for o in bpy.data.objects if o.name.startswith(name)]:
        remove_obj(n)
    if kind == 'm':
        p = dict(neck=0.048, height=1.78, shoulder=0.19, hip=0.092, bulk=1.0, muscle=0.7, chest=0.98, subdiv=2, taper=0.6)
    elif kind == 'f':
        p = dict(neck=0.048, height=1.66, shoulder=0.165, hip=0.1, bulk=0.9, muscle=0.4, chest=0.9, lean=0.86, legs=1.05, subdiv=2, taper=1.3)
    else:
        p = dict(neck=0.048, height=1.76, shoulder=0.2, hip=0.105, bulk=1.2, muscle=0.3, chest=1.08, lean=1.25, subdiv=2, taper=0.0)
    body, J = build_body_base(name + "_body", p)
    shape_body(body, J, p)
    if kind == 'f':
        me = body.data
        for v in me.vertices:
            for sg in (1, -1):
                c = Vector((sg * 0.07, J['chest'].y - 0.07, J['chest'].z + 0.02))
                d = (v.co - c).length
                if d < 0.085 and v.co.y < J['chest'].y:
                    v.co += Vector((0, -1, -0.2)).normalized() * 0.03 * (1 - (d / 0.085) ** 2) ** 2
    top = ('tee', 'long', 'tank')[variant % 3] if kind != 'h' else 'long'
    bottom = 'skirt' if kind == 'f' and variant == 1 else 'pants'
    assign_regions(body, clothing_rules(J, top, bottom), BODY)
    extra = []
    # jacket collar / hoodie trim as plates (secondary detail)
    FRONT = Proj('planar', origin=(0, 0, 0), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
    uz, pz = J['uchest'].z, J['pelvis'].z
    NECK = Proj('cyl', a=(0, 0.0, uz + 0.0), b=(0, 0.0, uz + 0.14), ref=(0, -1, 0), rmax=0.12, allfacing=True)
    extra.append(plate(body, name + "_crew", NECK, [(-181, 0.34), (181, 0.34), (181, 0.52), (-181, 0.52)], 0.007, 0.002, BODY, 0.0))
    if top in ('tee', 'tank'):
        for s_ in ('L', 'R'):
            UA = Proj('cyl', a=tuple(J['sh' + s_]), b=tuple(J['el' + s_]), ref=(0, 0, 1), rmax=0.1, allfacing=True)
            t0 = 0.45 if top == 'tee' else 0.0
            if top == 'tee':
                extra.append(plate(body, name + "_cuff" + s_, UA, [(-181, t0 - 0.06), (181, t0 - 0.06), (181, t0 + 0.02), (-181, t0 + 0.02)], 0.006, 0.002, BODY, 0.0))
    BELT = Proj('cyl', a=(0, 0, pz + 0.035), b=(0, 0, pz + 0.07), ref=(0, -1, 0), rmax=0.3)
    extra.append(plate(body, name + "_belt", BELT, [(-181, 0.1), (181, 0.1), (181, 0.9), (-181, 0.9)], 0.006, 0.003, M['iron'], 0.0015,
                       extra=lambda c, n: abs(c.x) < 0.22))
    if bottom == 'skirt':
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=0.21, radius2=0.155, depth=0.36,
                              matrix=Matrix.Translation((0, 0.005, pz - 0.12)))
        extra.append(bm_to_obj(bm, name + "_skirt", [M['slot_secondary']]))
    for s in ('L', 'R'):
        an = J['an' + s]
        BOOT = Proj('cyl', a=(an.x, an.y - 0.02, 0.0), b=(an.x, an.y - 0.02, 0.2), ref=(0, -1, 0), rmax=0.2)
        extra.append(plate(body, name + "_shoe" + s, BOOT, [(-181, -2.0), (181, -2.0), (181, 0.45), (-181, 0.45)], 0.01, 0.004, SHOE, 0.0,
                           extra=lambda c, n, an=an: abs(c.x - an.x) < 0.12))
    extra = [e for e in extra if e is not None]
    head, hc = build_face_head(name + "_head", J, *( (0.074, 0.09, 0.101) if kind == 'f' else (0.079, 0.095, 0.105)), female=(kind == 'f'))
    hair = build_hair(head, name + "_hair", hc, {'m': 'short', 'f': ('pony', 'bob', 'long')[variant % 3], 'h': 'buzz'}[kind])
    hands = []
    for s_ in ('L', 'R'):
        hands.append(bm_to_obj(build_hand(name + "_hand" + s_, J, s_, (0, 0, 0), 0.92 if kind == 'f' else 1.0, 0.45, 0.95, (8, 6)), name + "_hand" + s_, [SKIN]))
    rig = build_armature(name, J)
    auto_weight(body, rig)
    for e in extra: transfer_weights(body, e)
    rigid_weight(head, rig, 'head')
    for h in hair: rigid_weight(h, rig, 'head')
    for s_, h in zip(('L', 'R'), hands): rigid_weight(h, rig, 'hand' + s_)
    return body, extra + [head] + hair + hands, rig, J

# ------------------------------------------------------------------ MERIDIAN soldier
def build_meridian(heavy=False):
    name = "HD_MER_" + ("heavy" if heavy else "base")
    for n in [o.name for o in bpy.data.objects if o.name.startswith(name)]:
        remove_obj(n)
    p = dict(height=1.84, shoulder=0.21, hip=0.1, bulk=1.25 if heavy else 1.08, muscle=1.0, chest=1.1, subdiv=2)
    body, J = build_body_base(name + "_body", p)
    shape_body(body, J, p)
    MR, ML, MA = PR, SE, AC      # recolor slots: primary = armor graphite, secondary = fabric, accent = faction red
    rules = [
        (DK, LR(lambda s: limb(J, 'wr' + s, 'palm' + s, 0.16))),
        (DK, lambda c, n: c.z < 0.2),
        (DK, LR(lambda s: near(J, 'kn' + s, 0.07))),
    ]
    assign_regions(body, rules, ML)
    arm = []
    FRONT = Proj('planar', origin=(0, 0, 0), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
    BACK = Proj('planar', origin=(0, 0, 0), dir=(0, -1, 0), u=(1, 0, 0), v=(0, 0, 1))
    cz, uz, wz, pz = J['chest'].z, J['uchest'].z, J['waist'].z, J['pelvis'].z
    vest = [(-0.16, wz - 0.06), (0.16, wz - 0.06), (0.19, cz + 0.02), (0.14, uz + 0.04), (0.06, uz + 0.06), (0.0, uz + 0.03),
            (-0.06, uz + 0.06), (-0.14, uz + 0.04), (-0.19, cz + 0.02)]
    arm.append(plate(body, name + "_vest", FRONT, vest, 0.03 if heavy else 0.022, 0.006, MR, 0.004))
    arm.append(plate(body, name + "_vestb", BACK, [(-0.17, wz - 0.05), (0.17, wz - 0.05), (0.18, uz + 0.04), (-0.18, uz + 0.04)],
                     0.022, 0.006, MR, 0.004, extra=lambda c, n: abs(c.x) < 0.19 and c.y > 0))
    arm.append(plate(body, name + "_chev", FRONT, [(-0.06, uz - 0.03), (0.06, uz - 0.03), (0.0, uz - 0.1)], 0.006, 0.03 if heavy else 0.024, MA, 0.0015))
    BELT = Proj('cyl', a=(0, 0, pz + 0.02), b=(0, 0, pz + 0.09), ref=(0, -1, 0), rmax=0.32)
    arm.append(plate(body, name + "_belt", BELT, [(-181, 0.1), (181, 0.1), (181, 0.9), (-181, 0.9)], 0.018, 0.005, DK, 0.003,
                     extra=lambda c, n: abs(c.x) < 0.25))
    for s in ('L', 'R'):
        sg = 1 if s == 'L' else -1
        arm.append(pauldron_shell(name + "_paul" + s, J['sh' + s], sg, 0.1 if not heavy else 0.13, [MR, MA], 2 if heavy else 1))
        FA = Proj('cyl', a=tuple(J['el' + s]), b=tuple(J['wr' + s]), ref=(0, 0, 1), rmax=0.09)
        arm.append(plate(body, name + "_bracer" + s, FA, chamfer_rect(-110, 0.35, 110, 0.9, 18, 0.06), 0.014, 0.004, MR, 0.003))
        TH = Proj('cyl', a=tuple(J['hip' + s]), b=tuple(J['kn' + s]), ref=(0, -1, 0), rmax=0.15)
        arm.append(plate(body, name + "_thigh" + s, TH, [(-60, 0.15), (60, 0.15), (65, 0.55), (-65, 0.55)], 0.012, 0.004, MR, 0.003))
        KN = Proj('planar', origin=tuple(J['kn' + s]), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
        arm.append(plate(body, name + "_knee" + s, KN, [(0, -0.06), (0.055, -0.02), (0.05, 0.045), (-0.05, 0.045), (-0.055, -0.02)], 0.024, 0.008, MR, 0.004))
        SH = Proj('cyl', a=tuple(J['kn' + s]), b=tuple(J['an' + s]), ref=(0, -1, 0), rmax=0.11)
        arm.append(plate(body, name + "_shin" + s, SH, [(-55, 0.15), (55, 0.15), (60, 0.8), (-60, 0.8)], 0.014, 0.004, MR, 0.003))
        an = J['an' + s]
        BOOT = Proj('cyl', a=(an.x, an.y - 0.02, 0.0), b=(an.x, an.y - 0.02, 0.2), ref=(0, -1, 0), rmax=0.2)
        arm.append(plate(body, name + "_boot" + s, BOOT, [(-181, -2.0), (181, -2.0), (181, 0.9), (-181, 0.9)], 0.014, 0.006, DK, 0.003,
                         extra=lambda c, n, an=an: abs(c.x - an.x) < 0.12))
    arm = [a_ for a_ in arm if a_ is not None]
    # pouches on the vest (hard surface)
    gp = []
    for x in (-0.1, -0.035, 0.035, 0.1):
        gp.append((g_box((0.055, 0.035, 0.07), bevel=0.006), TR((x, J['waist'].y - 0.13 - (0.01 if heavy else 0), wz + 0.02)), 1))
    gp.append((g_box((0.22, 0.09, 0.26), bevel=0.012, segs=2), TR(J['chest'] + Vector((0, 0.16, 0.0))), 0))   # back plate carrier
    gp.append((g_box((0.05, 0.02, 0.1), bevel=0.004), TR(J['chest'] + Vector((0.08, 0.21, 0.0))), 2))
    for s in ('L', 'R'):
        sg = 1 if s == 'L' else -1
        gp.append((g_box((0.05, 0.08, 0.12), bevel=0.006), TR((sg * 0.19, 0.0, pz - 0.06)), 1))   # thigh holster
    gear = piece(name + "_gear", gp, [PR, SE, AC, DK, GL])
    # tactical helmet w/ full mask + triangular visor
    hc = J['head'] + Vector((0, -0.012, 0.105))
    sk = _skull(name + "_skull", hc, 0.108, 0.124, 0.13, PR)
    FR = Proj('planar', origin=(0, 0, 0), dir=(0, 1, 0), u=(1, 0, 0), v=(0, 0, 1))
    z = hc.z
    hp = [plate(sk, name + "_mask", FR, [(-0.08, z - 0.115), (0.08, z - 0.115), (0.1, z - 0.02), (0.08, z + 0.035), (-0.08, z + 0.035), (-0.1, z - 0.02)], 0.01, 0.003, SE, 0.002),
          plate(sk, name + "_visor", FR, [(-0.075, z + 0.028), (0.075, z + 0.028), (0.0, z - 0.03)], 0.004, 0.012, GL, 0.0012),
          plate(sk, name + "_rim", FR, chamfer_rect(-0.1, z + 0.04, 0.1, z + 0.06, 0.02, 0.008), 0.012, 0.004, AC, 0.002)]
    bmh = bmesh.new()
    for sg in (1, -1):
        r = bmesh.ops.create_cone(bmh, cap_ends=True, segments=20, radius1=0.03, radius2=0.024, depth=0.03,
                                  matrix=Matrix.Translation(hc + Vector((sg * 0.105, 0.01, -0.01))) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4())
        for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = 3
    r = bmesh.ops.create_cone(bmh, cap_ends=False, segments=24, radius1=0.056, radius2=0.05, depth=0.07,
                              matrix=Matrix.Translation(J['neck'] + Vector((0, 0.005, 0.045))))
    for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = 3
    helm = join([sk, bm_to_obj(bmh, name + "_hw", [PR, SE, AC, DK, GL])] + [x for x in hp if x is not None], name + "_helmet")
    hands = {}
    for s_ in ('L', 'R'):
        hands[s_] = bm_to_obj(build_hand(name + "_hand" + s_, J, s_, (0, 1, 0), 1.05, 0.5, 1.1), name + "_hand" + s_, [DK, PR])
    rig = build_armature(name, J)
    auto_weight(body, rig)
    for a_ in arm:
        if len(a_.data.polygons): transfer_weights(body, a_)
    rigid_weight(helm, rig, 'head')
    for s_ in ('L', 'R'): rigid_weight(hands[s_], rig, 'hand' + s_)
    bind_gear(gear)
    gear.vertex_groups.clear()
    vc = gear.vertex_groups.new(name='chest'); vh = gear.vertex_groups.new(name='hips')
    for v in gear.data.vertices:
        (vc if v.co.z > wz - 0.05 else vh).add([v.index], 1.0, 'REPLACE')
    return body, arm + [hands['L'], hands['R'], gear], helm, rig, J

# ------------------------------------------------------------------ MERIDIAN gear (rigid; origin = grip)
def build_meridian_gear():
    out = {}
    mats = [PR, SE, AC, DK, GL]
    # riot shield: curved panel
    bm = bmesh.new()
    res = bmesh.ops.create_grid(bm, x_segments=10, y_segments=16, size=0.5)
    for v in bm.verts:
        x, y = v.co.x * 1.2, v.co.y * 2.0
        v.co = Vector((x * 0.5, -0.12 + 0.12 * (x * x) * 1.2, y * 0.5))
    ext = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    for e in ext['geom']:
        if isinstance(e, bmesh.types.BMVert): e.co.y += 0.02
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.material_index = 1
    sh = bm_to_obj(bm, "HD_GEAR_shield", [PR, SE, AC, DK, GL])
    rim = piece("HD_GEAR_shield_rim", [(g_box((0.62, 0.05, 0.05), 0.01), TR((0, -0.1, 0.5)), 2), (g_box((0.62, 0.05, 0.05), 0.01), TR((0, -0.1, -0.5)), 2),
                                        (g_box((0.2, 0.03, 0.06), 0.005), TR((0, -0.1, 0.3)), 4), (g_box((0.04, 0.08, 0.12), 0.006), TR((0, 0.0, 0.0)), 3)], mats)
    out['shield'] = join([sh, rim], "HD_GEAR_shield")
    # marksman rifle (barrel along -Y)
    rp = [(g_box((0.05, 0.42, 0.08), 0.006), TR((0, -0.12, 0.02)), 3), (g_box((0.04, 0.24, 0.1), 0.01, taper=(0.9, 0.8)), TR((0, 0.2, -0.01)), 0),
          (g_cyl(0.012, 0.5, 14), TR((0, -0.3, 0.03), (math.pi / 2, 0, 0)), 3), (g_cyl(0.02, 0.1, 14, bevel=0.003), TR((0, -0.78, 0.03), (math.pi / 2, 0, 0)), 3),
          (g_cyl(0.022, 0.18, 16, bevel=0.003), TR((0, -0.04, 0.1), (math.pi / 2, 0, 0)), 1), (g_box((0.03, 0.05, 0.1), 0.005), TR((0, 0.03, -0.07)), 3),
          (g_box((0.035, 0.06, 0.12), 0.005), TR((0, -0.1, -0.06)), 1), (g_sph(0.01, 8, 6), TR((0, -0.13, 0.1)), 4)]
    out['rifle'] = piece("HD_GEAR_rifle", rp, mats)
    bp = [(g_cyl(0.018, 0.45, 12, bevel=0.002), TR((0, 0, -0.5)), 3), (g_cyl(0.022, 0.12, 12, bevel=0.003), TR((0, 0, -0.08)), 1),
          (g_box((0.028, 0.028, 0.18), 0.004), TR((0, 0, -0.4)), 4), (g_cyl(0.028, 0.02, 12, bevel=0.003), TR((0, 0, -0.02)), 2)]
    out['baton'] = piece("HD_GEAR_baton", bp, mats)
    pp = [(g_box((0.3, 0.16, 0.38), 0.02, segs=3), TR((0, 0.26, 0.28)), 1), (g_cyl(0.008, 0.45, 8), TR((0.1, 0.3, 0.45)), 3),
          (g_sph(0.02, 10, 8), TR((0.1, 0.3, 0.92)), 4), (g_box((0.2, 0.03, 0.2), 0.005), TR((0, 0.35, 0.3)), 2)]
    out['pack'] = piece("HD_GEAR_pack", pp, mats)
    # captain cape (mantle + draped cloth panel, origin at neck)
    bm = bmesh.new()
    res = bmesh.ops.create_grid(bm, x_segments=10, y_segments=14, size=0.5)
    for v in bm.verts:
        u, w = v.co.x * 2, v.co.y * 2      # -1..1
        x = u * (0.22 + 0.08 * (1 - w) * 0.5)
        yy = 0.14 + 0.05 * (1 - u * u) + 0.02 * math.sin(u * 6) * (1 - w) * 0.5
        zz = -0.05 - (1 - w) * 0.45
        v.co = Vector((x, yy, zz))
    for f in bm.faces: f.material_index = 2
    cape = bm_to_obj(bm, "HD_GEAR_cape_c", mats)
    mant = piece("HD_GEAR_cape_m", [(g_box((0.5, 0.26, 0.08), 0.02, segs=3), TR((0, 0.03, -0.04)), 2), (g_box((0.12, 0.03, 0.05), 0.005), TR((0, -0.1, -0.03)), 4)], mats)
    out['cape'] = join([cape, mant], "HD_GEAR_cape")
    return out
