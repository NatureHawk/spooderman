# THREADLINE HD structures + tower crowns + facade kit (environment-artist modular kit, 4 m grid)
# run after bl_helpers, hd_char, hd_heroes, hd_props
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

def beam_between(parts, a, b, t, mi, t2=None):
    a, b = Vector(a), Vector(b)
    d = b - a
    q = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    parts.append((g_box((t, t2 or t, d.length), bevel=0.0), Matrix.Translation((a + b) / 2) @ q, mi))

def build_structures():
    out = {}
    # ---------------- crane mast: lattice + ladder + rest platforms + climbing frame
    p = [(g_box((6, 6, 1.2), bevel=0.05), TR((0, 0, 0.6)), CO)]
    H = 62.0; w = 1.1
    for (x, y) in ((-w, -w), (w, -w), (w, w), (-w, w)):
        p.append((g_box((0.24, 0.24, H), bevel=0.02), TR((x, y, H / 2 + 1.2)), PY))
    z = 1.2; k = 0
    while z < H:
        z2 = min(z + 4.0, H + 1.2)
        for (a_, b_) in (((-w, -w), (w, -w)), ((w, -w), (w, w)), ((w, w), (-w, w)), ((-w, w), (-w, -w))):
            beam_between(p, (a_[0], a_[1], z2), (b_[0], b_[1], z2), 0.12, PY)
            if k % 2 == 0: beam_between(p, (a_[0], a_[1], z), (b_[0], b_[1], z2), 0.08, PY)
            else: beam_between(p, (b_[0], b_[1], z), (a_[0], a_[1], z2), 0.08, PY)
        if k % 5 == 4:
            p.append((g_box((2.6, 2.6, 0.06), bevel=0.0), TR((0, 0, z2)), IR))
        z = z2; k += 1
    for kk in range(int(H / 0.35)):
        p.append((g_box((0.4, 0.03, 0.03), bevel=0.0), TR((0, -w + 0.15, 1.5 + kk * 0.35)), IR))
    p.append((g_box((3.4, 3.4, 1.1), bevel=0.05), TR((0, 0, H + 1.7)), SD))
    p.append((g_cyl(1.5, 0.4, 32, bevel=0.03), TR((0, 0, H + 2.4)), IR))
    remove_obj("HD_S_crane_mast"); out['crane_mast'] = piece("HD_S_crane_mast", p, PM)
    # ---------------- crane jib (+X), counter-jib, cab w/ windows, apex, pendants, trolley
    p = []
    L = 50.0; CL = 14.0
    p.append((g_box((3.0, 2.6, 3.0), bevel=0.06), TR((0, 0, 1.5)), PY))
    p.append((g_box((2.2, 2.0, 2.4), bevel=0.08, segs=2), TR((1.2, -2.4, 1.2)), PY))
    p.append((g_box((2.0, 0.08, 1.4), bevel=0.02), TR((1.2, -3.42, 1.5)), GD))
    p.append((g_box((0.08, 1.6, 1.2), bevel=0.02), TR((2.32, -2.4, 1.5)), GD))
    for (x, y) in ((-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)):
        beam_between(p, (x * 3, y * 3, 3.0), (x * 0.3, y * 0.3, 12.0), 0.14, PY)
    for yy in (-0.9, 0.9):
        p.append((g_box((L, 0.18, 0.18), bevel=0.0), TR((L / 2, yy, 3.2)), PY))
    p.append((g_box((L, 0.18, 0.18), bevel=0.0), TR((L / 2, 0, 5.0)), PY))
    x = 0.0; k = 0
    while x < L - 0.5:
        x2 = min(x + 2.5, L)
        for yy in (-0.9, 0.9):
            beam_between(p, (x, yy, 3.2), (x2, 0, 5.0) if k % 2 == 0 else (x, 0, 5.0), 0.07, PY)
        beam_between(p, (x2, -0.9, 3.2), (x2, 0.9, 3.2), 0.07, PY)
        x = x2; k += 1
    for yy in (-1.0, 1.0):
        p.append((g_box((CL, 0.3, 0.45), bevel=0.02), TR((-CL / 2, yy, 3.2)), PY))
    for kk in range(4):
        p.append((g_box((1.0, 2.8, 2.6), bevel=0.04), TR((-CL + 1.0 + kk * 1.05, 0, 2.4)), CO))
    beam_between(p, (0, 0, 12.0), (L * 0.7, 0, 5.0), 0.06, SD)
    beam_between(p, (0, 0, 12.0), (-CL + 1, 0, 3.4), 0.06, SD)
    p.append((g_box((L * 0.95, 0.6, 0.04), bevel=0.0), TR((L / 2, 0, 3.12)), IR))
    for kk in range(int(L / 2)):
        p.append((g_box((0.03, 0.03, 0.9), bevel=0.0), TR((1 + kk * 2, -1.05, 3.6)), IR))
    p.append((g_box((1.6, 1.0, 0.8), bevel=0.05), TR((L * 0.8, 0, 2.8)), SD))
    for x_ in (L * 0.8 - 0.5, L * 0.8 + 0.5):
        p.append((g_cyl(0.18, 0.12, 12), TR((x_, 0, 3.15), (math.pi / 2, 0, 0)), IR))
    p.append((g_sph(0.18, 10, 8), TR((L, 0, 5.2)), RE))
    remove_obj("HD_S_crane_jib"); out['crane_jib'] = piece("HD_S_crane_jib", p, PM)
    p = [(g_box((1.0, 0.6, 1.2), bevel=0.06), TR((0, 0, 0.9)), PY), (g_box((1.05, 0.2, 0.3), bevel=0.02), TR((0, -0.35, 1.2)), SD)]
    for x_ in (-0.25, 0.25):
        p.append((g_cyl(0.22, 0.12, 16), TR((x_, 0, 1.4), (math.pi / 2, 0, 0)), IR))
    p.append((g_cyl(0.1, 0.5, 12), TR((0, 0, 0.1)), SD))
    bmh = bmesh.new()
    bmesh.ops.create_circle(bmh, cap_ends=False, segments=16, radius=0.22)
    remove_obj("HD_S_crane_hook"); out['crane_hook'] = piece("HD_S_crane_hook", p + [(g_box((0.1, 0.1, 0.35), bevel=0.02), TR((0.18, 0, -0.25), (0, 0.5, 0)), SD)], PM)
    # ---------------- suspension bridge tower (art-deco steps, recessed panels, portal arches)
    p = []
    TH = 112.0
    for y in (-13.0, 13.0):
        for (z0, z1, sx, sy) in ((-10, 40, 5.2, 4.2), (40, 80, 4.6, 3.8), (80, 104, 4.1, 3.4)):
            p.append((g_box((sx, sy, z1 - z0), bevel=0.15, segs=2), TR((0, y, (z0 + z1) / 2)), ST))
            p.append((g_box((sx + 0.5, sy + 0.5, 1.2), bevel=0.1), TR((0, y, z1)), SD))
            for zz in range(int(z0) + 4, int(z1) - 2, 6):
                for sgx in (1, -1):
                    p.append((g_box((0.06, sy * 0.6, 3.5), bevel=0.0), TR((sgx * sx / 2, y, zz)), SD))
        p.append((g_box((3.0, 2.6, 6.0), bevel=0.3, segs=3, taper=(0.5, 0.5)), TR((0, y, 107.0)), ST))
        p.append((g_box((7.0, 6.0, 10.0), bevel=0.2), TR((0, y, -15)), CO))
        p.append((g_box((2.4, 1.8, 1.8), bevel=0.1), TR((0, y, TH - 7.5)), SD))
        p.append((g_sph(0.6, 10, 8), TR((0, y, 110.8)), RE))
    for (z, hgt) in ((6.0, 3.0), (48.0, 4.0), (84.0, 4.0), (100.0, 5.0)):
        p.append((g_box((3.6, 22.0, hgt), bevel=0.12), TR((0, 0, z)), ST))
        for yy in range(-9, 10, 3):
            p.append((g_box((3.7, 1.8, hgt * 0.5), bevel=0.0), TR((0, yy, z)), SD))
        bmA = bmesh.new()
        # portal arch under each crossbeam (half-ring)
        for kk in range(16):
            a0 = math.pi * kk / 16; a1 = math.pi * (kk + 1) / 16
            beam_between(p, (0, 9.0 * math.cos(a0), z - hgt / 2 - 1.2 * math.sin(a0) * 2), (0, 9.0 * math.cos(a1), z - hgt / 2 - 1.2 * math.sin(a1) * 2), 1.0, SD, 3.0)
    remove_obj("HD_S_bridge_tower"); out['bridge_tower'] = piece("HD_S_bridge_tower", p, PM)
    # ---------------- bridge deck segment 20 m
    p = [(g_box((20.0, 26.0, 0.6), bevel=0.02), TR((0, 0, -0.3)), TA),
         (g_box((20.0, 1.8, 0.28), bevel=0.03), TR((0, -12.1, 0.14)), CO),
         (g_box((20.0, 1.8, 0.28), bevel=0.03), TR((0, 12.1, 0.14)), CO),
         (g_box((20.0, 0.5, 0.3), bevel=0.05), TR((0, 0, 0.15)), CO)]
    for y in (-12.9, 12.9):
        p.append((g_box((20.0, 0.14, 0.12), bevel=0.02), TR((0, y, 1.2)), SD))
        p.append((g_box((20.0, 0.06, 0.06), bevel=0.0), TR((0, y, 0.65)), SD))
        for x in range(-10, 11):
            p.append((g_box((0.07, 0.07, 1.2), bevel=0.0), TR((x, y, 0.6)), SD))
    for y in (-12.5, -4.2, 4.2, 12.5):
        p.append((g_box((20.0, 0.4, 3.2), bevel=0.03), TR((0, y, -2.2)), SD))
    for x in (-9.5, -4.75, 0, 4.75, 9.5):
        p.append((g_box((0.4, 25.0, 0.5), bevel=0.02), TR((x, 0, -3.6)), SD))
    for x in (-10, -5, 0, 5):
        for y in (-12.5, 12.5):
            beam_between(p, (x, y, -0.6), (x + 5, y, -3.8), 0.18, SD)
    for x in (-5, 5):
        for sg in (1, -1):
            p.append((g_box((0.4, 4.0, 0.02), bevel=0.0), TR((x, sg * 5.5, 0.005)), WH))
    p.append((g_cyl(0.12, 7.0, 10), TR((0, -12.0, 3.5)), SD)); p.append((g_box((1.6, 0.3, 0.2), bevel=0.03), TR((0, -11.3, 7.0)), SD)); p.append((g_box((0.5, 0.3, 0.06), bevel=0.01), TR((0, -10.7, 6.9)), LE))
    remove_obj("HD_S_bridge_deck"); out['bridge_deck'] = piece("HD_S_bridge_deck", p, PM)
    # ---------------- elevated rail 20 m (riveted girders)
    p = []
    for x in (-9.0, 9.0):
        for y in (-3.2, 3.2):
            p.append((g_box((0.6, 0.6, 10.0), bevel=0.03), TR((x, y, 5.0)), SD))
            p.append((g_box((0.9, 0.9, 0.3), bevel=0.02), TR((x, y, 0.15)), CO))
        p.append((g_box((0.8, 7.4, 1.0), bevel=0.03), TR((x, 0, 10.0)), SD))
        beam_between(p, (x, -3.2, 6.5), (x, 0, 9.5), 0.3, SD); beam_between(p, (x, 3.2, 6.5), (x, 0, 9.5), 0.3, SD)
    for y in (-2.6, 2.6):
        p.append((g_box((20.0, 0.5, 1.4), bevel=0.02), TR((0, y, 10.2)), IR))
        for xx in range(-9, 10):
            beam_between(p, (xx, y - 0.26, 9.6), (xx + 1, y - 0.26, 10.8) if xx % 2 else (xx + 1, y - 0.26, 9.6), 0.06, SD)
            p.append((g_cyl(0.03, 0.03, 6), TR((xx, y - 0.27, 10.8), (math.pi / 2, 0, 0)), ST))
    p.append((g_box((20.0, 7.0, 0.4), bevel=0.02), TR((0, 0, 11.0)), CD))
    for y in (-1.5, -0.3, 0.3, 1.5):
        p.append((g_box((20.0, 0.1, 0.15), bevel=0.0), TR((0, y, 11.27)), CR))
    for x in range(-10, 10):
        p.append((g_box((0.25, 5.0, 0.15), bevel=0.0), TR((x + 0.5, 0, 11.22)), WK))
    remove_obj("HD_S_rail_el"); out['rail_el'] = piece("HD_S_rail_el", p, PM)
    # ---------------- elevated highway 20 m
    p = [(g_box((20.0, 20.0, 1.4), bevel=0.05), TR((0, 0, 13.0)), CO),
         (g_box((20.0, 0.5, 1.1), bevel=0.08, segs=2, taper=(1.0, 0.6)), TR((0, -9.8, 14.2)), CO),
         (g_box((20.0, 0.5, 1.1), bevel=0.08, segs=2, taper=(1.0, 0.6)), TR((0, 9.8, 14.2)), CO),
         (g_box((20.0, 0.4, 0.8), bevel=0.05, taper=(1.0, 0.5)), TR((0, 0, 14.1)), CO),
         (g_box((3.0, 14.0, 1.6), bevel=0.05), TR((0, 0, 11.5)), CD),
         (g_box((2.6, 2.6, 11.0), bevel=0.1, segs=2), TR((0, 0, 5.5)), CO)]
    for y in (-8.0, -3.0, 3.0, 8.0):
        for x in (-7.5, -2.5, 2.5, 7.5):
            p.append((g_box((3.0, 0.15, 0.02), bevel=0.0), TR((x, y + (1 if y > 0 else -1) * 0.0, 13.71)), WH))
    for x in range(-10, 10, 2):
        p.append((g_box((0.1, 20.0, 0.8), bevel=0.0), TR((x, 0, 12.0)), CD))
    p.append((g_cyl(0.12, 6.0, 10), TR((0, -9.4, 16.7)), SD)); p.append((g_box((1.6, 0.3, 0.2), bevel=0.03), TR((0, -8.7, 19.6)), SD)); p.append((g_box((0.5, 0.3, 0.06), bevel=0.01), TR((0, -8.1, 19.5)), LE))
    remove_obj("HD_S_highway_el"); out['highway_el'] = piece("HD_S_highway_el", p, PM)
    # ---------------- pier 10 m
    p = []
    for k in range(20):
        p.append((g_box((0.48, 8.0, 0.2), bevel=0.02), TR((-4.75 + k * 0.5, 0, -0.1)), WD))
    for x in (-4.5, 0, 4.5):
        for y in (-3.6, 3.6):
            p.append((g_cyl(0.25, 6.4, 12), TR((x, y, -3.0)), WK))
            p.append((g_cyl(0.28, 0.2, 12), TR((x, y, 0.1)), IR))
    p.append((g_box((10.0, 0.2, 0.2), bevel=0.02), TR((0, 3.9, 1.0)), WK))
    for x in range(-5, 6, 2):
        p.append((g_box((0.15, 0.15, 1.0), bevel=0.02), TR((x, 3.9, 0.5)), WK))
    remove_obj("HD_S_pier"); out['pier'] = piece("HD_S_pier", p, PM)
    return out

# ================= TOWER CROWNS (20x20 footprint, base z=0; slot colors match building) =================
def build_crowns():
    out = {}
    CP, CS = PM.index(M['concrete']), PM.index(M['steel'])
    mats = PM + [M['slot_primary'], M['slot_secondary']]
    SP, SS = len(PM), len(PM) + 1
    # art deco: 4 stepped tiers with fins, window slits, spire with rings
    p = []
    for i, (s, h, z) in enumerate(((19, 6, 0), (15, 6, 6), (11, 5, 12), (7, 4, 17))):
        p.append((g_box((s, s, h), bevel=0.15, segs=2), TR((0, 0, z + h / 2)), SP))
        p.append((g_box((s + 0.7, s + 0.7, 0.5), bevel=0.1), TR((0, 0, z + h)), SS))
        n = int(s / 1.6)
        for k in range(n):
            for side in range(4):
                a = side * math.pi / 2
                off = -s / 2 + (k + 0.5) * s / n
                c = Vector((math.cos(a) * s / 2, math.sin(a) * s / 2, z + h / 2))
                t = Vector((-math.sin(a), math.cos(a), 0))
                p.append((g_box((0.5, 0.12, h * 0.7), bevel=0.0), Matrix.Translation(c + t * off) @ Euler((0, 0, a + math.pi / 2)).to_matrix().to_4x4(), GD))
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        p.append((g_box((0.7, 3.4, 9.0), bevel=0.1, taper=(0.6, 0.3)), TR((9.9 * math.cos(a), 9.9 * math.sin(a), 4.5), (0, 0, a)), SS))
    p.append((g_cyl(1.7, 16.0, 16, r2=0.1), TR((0, 0, 29)), SS))
    for z in (23, 27, 31):
        p.append((g_cyl(1.7 - (z - 21) * 0.1 + 0.2, 0.4, 16), TR((0, 0, z)), SS))
    p.append((g_sph(0.4, 8, 6), TR((0, 0, 37.2)), RE))
    remove_obj("HD_C_crown_deco"); out['crown_deco'] = piece("HD_C_crown_deco", p, mats)
    # copper pyramid with dormers
    p = [(g_box((20, 20, 2.0), bevel=0.1), TR((0, 0, 1.0)), SS),
         (g_box((20, 20, 12), bevel=0.0, taper=(0.04, 0.04)), TR((0, 0, 8)), PG),
         (g_cyl(0.3, 10, 8, r2=0.05), TR((0, 0, 19)), ST)]
    for side in range(4):
        a = side * math.pi / 2
        for off in (-4, 4):
            c = Vector((math.cos(a) * 6.8, math.sin(a) * 6.8, 5.0)) + Vector((-math.sin(a), math.cos(a), 0)) * off
            p.append((g_box((2.0, 1.4, 2.2), bevel=0.1, taper=(1.0, 0.2)), Matrix.Translation(c) @ Euler((0, 0, a + math.pi / 2)).to_matrix().to_4x4(), PG))
            p.append((g_box((1.2, 0.3, 1.2), bevel=0.0), Matrix.Translation(c + Vector((math.cos(a), math.sin(a), 0)) * 0.6) @ Euler((0, 0, a + math.pi / 2)).to_matrix().to_4x4(), GD))
    remove_obj("HD_C_crown_pyramid"); out['crown_pyramid'] = piece("HD_C_crown_pyramid", p, mats)
    # slanted glass top with mullions
    p = []
    bm = bmesh.new()
    pts = [(-10, 0), (10, 0), (10, 4), (-10, 14)]
    ob_w = None
    p.append((g_box((20.4, 20.4, 0.6), bevel=0.05), TR((0, 0, 0.3)), SS))
    for k in range(11):
        x = -10 + k * 2
        ztop = 14 - (x + 10) / 20 * 10
        p.append((g_box((0.15, 20.2, ztop), bevel=0.0), TR((x, 0, ztop / 2)), SD))
    for zz in range(2, 14, 2):
        xe = -10 + (14 - zz) / 10 * 20 if zz > 4 else 10
        xe = min(10, xe)
        p.append((g_box((xe + 10, 0.15, 0.12), bevel=0.0), TR(((xe - 10) / 2, -10.05, zz)), SD))
        p.append((g_box((xe + 10, 0.15, 0.12), bevel=0.0), TR(((xe - 10) / 2, 10.05, zz)), SD))
    cm = piece("HD_C_crown_slant_f", p, mats)
    vs = [(-10, -10, 0), (10, -10, 0), (10, -10, 4), (-10, -10, 14), (-10, 10, 0), (10, 10, 0), (10, 10, 4), (-10, 10, 14)]
    bmv = [bm.verts.new(v) for v in vs]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (3, 2, 6, 7), (1, 5, 6, 2), (0, 3, 7, 4)):
        face = bm.faces.new([bmv[i] for i in f]); face.material_index = PM.index(M['glass'])
    gl = bm_to_obj(bm, "HD_C_crown_slant_g", mats)
    remove_obj("HD_C_crown_slant"); out['crown_slant'] = join([cm, gl], "HD_C_crown_slant")
    # mechanical penthouse + steel crown frame with lights
    p = [(g_box((12, 9, 4.5), bevel=0.08), TR((-2, 1, 2.25)), CD), (g_box((6, 6, 3), bevel=0.08), TR((5, -5, 1.5)), CO)]
    for k in range(8):
        p.append((g_box((10, 0.05, 0.12), bevel=0.0), TR((-2, -3.53, 0.6 + k * 0.45), (0.5, 0, 0)), SD))
    for (x, y) in ((-9.5, -9.5), (9.5, -9.5), (9.5, 9.5), (-9.5, 9.5)):
        p.append((g_box((0.5, 0.5, 9), bevel=0.03), TR((x, y, 4.5)), SD))
    for zz in (4.5, 9.0):
        for (a_, b_) in (((-9.5, -9.5), (9.5, -9.5)), ((9.5, -9.5), (9.5, 9.5)), ((9.5, 9.5), (-9.5, 9.5)), ((-9.5, 9.5), (-9.5, -9.5))):
            beam_between(p, (a_[0], a_[1], zz), (b_[0], b_[1], zz), 0.4, SD)
            beam_between(p, (a_[0], a_[1], zz - 4.5), (b_[0], b_[1], zz), 0.15, SD)
    for x in (-6, -2, 2, 6):
        for y in (-9.8, 9.8):
            p.append((g_box((0.6, 0.3, 0.3), bevel=0.05), TR((x, y, 9.3)), LE))
    p.append((g_cyl(3.0, 0.3, 24), TR((5, -5, 3.15)), WH))
    p.append((g_box((1.6, 0.2, 0.02), bevel=0.0), TR((5, -5, 3.31)), PY))
    remove_obj("HD_C_crown_mech"); out['crown_mech'] = piece("HD_C_crown_mech", p, mats)
    # dome (drum w/ columns, ribs, lantern)
    p = [(g_cyl(9.0, 5.0, 40), TR((0, 0, 2.5)), SP), (g_cyl(9.5, 0.6, 40, bevel=0.1), TR((0, 0, 5.3)), SS),
         (g_sph(8.2, 40, 16, (1, 1, 0.8)), TR((0, 0, 5.6)), PG), (g_cyl(1.4, 2.0, 12), TR((0, 0, 12.8)), SS),
         (g_sph(1.5, 12, 8, (1, 1, 0.6)), TR((0, 0, 13.9)), PG), (g_cyl(0.3, 3, 8, r2=0.05), TR((0, 0, 15.6)), SS)]
    for k in range(20):
        a = k * 2 * math.pi / 20
        p.append((g_cyl(0.3, 4.4, 10), TR((9.2 * math.cos(a), 9.2 * math.sin(a), 2.6)), SS))
        p.append((g_box((0.25, 0.3, 6.0), bevel=0.0), TR((7.3 * math.cos(a), 7.3 * math.sin(a), 8.5), (0, -0.7, a)), SS))
    remove_obj("HD_C_crown_dome"); out['crown_dome'] = piece("HD_C_crown_dome", p, mats)
    p = [(g_box((6.0, 3.0, 0.8), bevel=0.05), TR((0, 0, 0.4)), CO), (g_box((5.6, 2.6, 0.3), bevel=0.0), TR((0, 0, 0.9)), TK)]
    for i, x in enumerate((-2, -1, 0, 1, 2)):
        res = (g_sph(0.6, 10, 8, (1, 1, 1.1)), TR((x, (i % 2) * 0.4 - 0.2, 1.5)), LF if i % 2 else LF2)
        p.append(res)
    remove_obj("HD_C_roof_garden"); out['roof_garden'] = piece("HD_C_roof_garden", p, mats)
    return out

# ================= FACADE KIT (modules 4 m wide; origin = bottom-center on the wall plane; facing -Y) =================
# slot_primary = wall material color (per building), slot_secondary = trim color, glass per module.
def build_facade_kit():
    out = {}
    mats = PM + [M['slot_primary'], M['slot_secondary']]
    SP, SS = len(PM), len(PM) + 1
    def K(name, parts):
        remove_obj("HD_F_" + name)
        out[name] = piece("HD_F_" + name, parts, mats)
    FH = 3.6
    # stone window bay: recessed window, frame, sill, lintel, mullion
    p = [(g_box((4.0, 0.3, FH), bevel=0.0), TR((0, 0.15, FH / 2)), SP),
         (g_box((1.9, 0.05, 2.0), bevel=0.0), TR((0, 0.02, 1.75)), GD),
         (g_box((2.1, 0.18, 0.12), bevel=0.02), TR((0, -0.06, 0.7)), SS),
         (g_box((2.2, 0.16, 0.22), bevel=0.02), TR((0, -0.05, 2.87)), SS),
         (g_box((0.08, 0.1, 2.0), bevel=0.0), TR((0, -0.0, 1.75)), SS)]
    for sg in (1, -1):
        p.append((g_box((0.1, 0.22, 2.1), bevel=0.01), TR((sg * 1.0, -0.02, 1.75)), SS))
    p.append((g_box((1.9, 0.08, 0.06), bevel=0.0), TR((0, -0.0, 2.2)), SS))
    K('win_stone', p)
    # brick window bay with arched lintel + keystone
    p = [(g_box((4.0, 0.3, FH), bevel=0.0), TR((0, 0.15, FH / 2)), SP),
         (g_box((1.6, 0.05, 2.1), bevel=0.0), TR((0, 0.03, 1.7)), GD),
         (g_box((1.9, 0.2, 0.1), bevel=0.02), TR((0, -0.07, 0.6)), SS)]
    for kk in range(9):
        a = math.pi * kk / 8
        p.append((g_box((0.24, 0.16, 0.2), bevel=0.01), TR((math.cos(a) * 0.95, -0.03, 2.75 + math.sin(a) * 0.35), (0, -a + math.pi / 2, 0)), SS))
    p.append((g_box((0.24, 0.2, 0.34), bevel=0.02, taper=(1.3, 1.0)), TR((0, -0.05, 3.12)), SS))
    for sg in (1, -1):
        p.append((g_box((0.08, 0.14, 2.1), bevel=0.0), TR((sg * 0.84, 0.0, 1.7)), SS))
    p.append((g_box((0.06, 0.08, 2.1), bevel=0.0), TR((0, 0.0, 1.7)), SS))
    K('win_brick', p)
    # glass curtain wall bay: mullion grid + spandrel
    p = [(g_box((4.0, 0.12, FH), bevel=0.0), TR((0, 0.08, FH / 2)), GL_),
         (g_box((4.0, 0.14, 0.7), bevel=0.0), TR((0, 0.05, 0.35)), SS)]
    for x in (-2.0, -1.0, 0.0, 1.0, 2.0):
        p.append((g_box((0.08, 0.2, FH), bevel=0.01), TR((x, -0.02, FH / 2)), SS))
    for z in (0.7, 2.2, FH):
        p.append((g_box((4.0, 0.18, 0.07), bevel=0.0), TR((0, -0.01, z)), SS))
    K('win_curtain', p)
    # office ribbon window band
    p = [(g_box((4.0, 0.3, FH), bevel=0.0), TR((0, 0.15, FH / 2)), SP),
         (g_box((4.0, 0.08, 1.6), bevel=0.0), TR((0, 0.02, 2.0)), GD),
         (g_box((4.0, 0.2, 0.12), bevel=0.02), TR((0, -0.05, 1.15)), SS),
         (g_box((4.0, 0.15, 0.1), bevel=0.01), TR((0, -0.03, 2.85)), SS)]
    for x in (-1.33, 0.0, 1.33):
        p.append((g_box((0.06, 0.1, 1.6), bevel=0.0), TR((x, -0.0, 2.0)), SS))
    K('win_ribbon', p)
    # storefront: big glass, door, sign band, awning, kick plate
    p = [(g_box((4.0, 0.3, 4.4), bevel=0.0), TR((0, 0.15, 2.2)), SP),
         (g_box((2.5, 0.05, 2.6), bevel=0.0), TR((-0.55, 0.0, 1.7)), GL_),
         (g_box((1.0, 0.06, 2.3), bevel=0.0), TR((1.35, 0.0, 1.15)), GD),
         (g_box((4.0, 0.25, 0.7), bevel=0.02), TR((0, -0.1, 3.5)), SS),
         (g_box((3.2, 0.05, 0.45), bevel=0.0), TR((0, -0.23, 3.5)), AE),
         (g_box((2.6, 0.12, 0.4), bevel=0.01), TR((-0.55, -0.04, 0.2)), SS),
         (g_box((4.0, 1.2, 0.08), bevel=0.02), TR((0, -0.62, 3.0), (-0.3, 0, 0)), CL)]
    for x in (-1.8, 0.7, 2.0):
        p.append((g_box((0.1, 0.14, 3.0), bevel=0.01), TR((x, -0.03, 1.5)), SS))
    for kk in range(8):
        p.append((g_box((0.5, 0.02, 0.18), bevel=0.0), TR((-1.75 + kk * 0.5, -1.18, 2.78)), CL if kk % 2 else WH))
    K('storefront', p)
    # cornice segment (4 m): stepped profile + dentils + brackets
    p = [(g_box((4.0, 0.5, 0.25), bevel=0.02), TR((0, -0.1, 0.12)), SS),
         (g_box((4.0, 0.8, 0.2), bevel=0.02), TR((0, -0.25, 0.35)), SS),
         (g_box((4.0, 1.1, 0.25), bevel=0.04), TR((0, -0.4, 0.58)), SS)]
    for kk in range(16):
        p.append((g_box((0.12, 0.15, 0.12), bevel=0.0), TR((-1.9 + kk * 0.25, -0.43, 0.2)), SS))
    for x in (-1.5, 0.0, 1.5):
        p.append((g_box((0.2, 0.6, 0.45), bevel=0.03, taper=(1.0, 0.4)), TR((x, -0.5, 0.1)), SS))
    K('cornice', p)
    # floor band / belt course
    K('band', [(g_box((4.0, 0.25, 0.3), bevel=0.03), TR((0, -0.1, 0.15)), SS), (g_box((4.0, 0.3, 0.08), bevel=0.01), TR((0, -0.13, 0.32)), SS)])
    # corner pilaster (per floor)
    K('pilaster', [(g_box((0.7, 0.7, FH), bevel=0.04), TR((0, 0, FH / 2)), SS)] + [(g_box((0.75, 0.75, 0.1), bevel=0.01), TR((0, 0, z)), SS) for z in (0.1, FH - 0.1)])
    # parapet segment w/ coping
    K('parapet', [(g_box((4.0, 0.3, 1.0), bevel=0.0), TR((0, 0.15, 0.5)), SP), (g_box((4.1, 0.45, 0.12), bevel=0.02), TR((0, 0.15, 1.05)), SS)])
    # balcony (steel + glass rail)
    p = [(g_box((3.2, 1.2, 0.18), bevel=0.02), TR((0, -0.6, 0.0)), CO), (g_box((3.2, 0.03, 0.9), bevel=0.0), TR((0, -1.18, 0.55)), GL_),
         (g_box((3.2, 0.06, 0.06), bevel=0.01), TR((0, -1.19, 1.02)), CR)]
    for x in (-1.55, 1.55):
        p.append((g_box((0.05, 1.2, 0.06), bevel=0.0), TR((x, -0.6, 1.02)), CR))
    K('balcony', p)
    # brownstone stoop (steps + rails), placed at street level
    p = []
    for kk in range(6):
        p.append((g_box((1.8, 0.35, 0.2 * (kk + 1)), bevel=0.02), TR((0, -2.0 + kk * 0.35, 0.1 * (kk + 1))), SP))
    for sg in (1, -1):
        beam_between(p, (sg * 0.95, -2.2, 0.9), (sg * 0.95, -0.1, 2.2), 0.05, IR)
        p.append((g_box((0.06, 0.06, 1.0), bevel=0.0), TR((sg * 0.95, -2.2, 0.5)), IR))
    K('stoop', p)
    return out
