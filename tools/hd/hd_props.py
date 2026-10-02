# THREADLINE HD props (prop-artist + hard-surface): street furniture, rooftop kit, throwables.
# run after bl_helpers, hd_char, hd_heroes. Blender Z-up; origin at base center (or wall-attach point).
# Each builder returns an object named HD_P_<name>; colliders are reused from the low-poly assets.
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler, noise

def _m(k): return M[k]
PM = [M['steel_dk'], M['steel'], M['iron'], M['concrete'], M['concrete_dk'], M['paint_yellow'], M['paint_red'],
      M['paint_green'], M['wood'], M['wood_dk'], M['leaf'], M['leaf2'], M['trunk'], M['glass'], M['lamp_emit'],
      M['red_emit'], M['brick'], M['brick_dk'], M['chrome'], M['rubber'], M['white'], M['tar'], M['cloth_red'],
      M['container_a'], M['signal_box'], M['amberglow_emit'], M['taxi2'], M['glass_dk']]
(SD, ST, IR, CO, CD, PY, PRd, PG, WD, WK, LF, LF2, TK, GL_, LE, RE, BR, BK, CR, RB, WH, TA, CL, CA, SB, AE, T2, GD) = range(len(PM))

def hp(name, parts):
    remove_obj("HD_P_" + name)
    return piece("HD_P_" + name, parts, PM)

def build_props():
    out = {}
    # ---------------- streetlamp: fluted cast base, tapered pole, curved arm, cobra head w/ lens
    p = [(g_cyl(0.26, 0.5, 24, r2=0.2, bevel=0.02), TR((0, 0, 0.25)), SD),
         (g_cyl(0.3, 0.08, 24, bevel=0.015), TR((0, 0, 0.04)), SD),
         (g_cyl(0.14, 6.4, 16, r2=0.085, bevel=0.0), TR((0, 0, 3.7)), SD),
         (g_cyl(0.17, 0.12, 16, bevel=0.01), TR((0, 0, 0.56)), IR),
         (g_cyl(0.1, 0.1, 16, bevel=0.01), TR((0, 0, 6.9)), IR)]
    for k in range(12):
        a = k * math.pi / 6
        p.append((g_box((0.03, 0.03, 0.42), bevel=0.008), TR((0.23 * math.cos(a), 0.23 * math.sin(a), 0.27), (0, 0, a)), IR))
    prev = Vector((0, 0, 6.9))
    for k in range(1, 9):
        t = k / 8
        cur = Vector((1.9 * t, 0, 6.9 + 0.55 * math.sin(t * math.pi * 0.8)))
        d = cur - prev
        q = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        p.append((g_cyl(0.055 - 0.015 * t, d.length * 1.05, 12), Matrix.Translation(prev) @ q @ Matrix.Translation((0, 0, d.length / 2)), SD))
        prev = cur
    p.append((g_box((0.85, 0.36, 0.2), bevel=0.08, segs=3, taper=(0.9, 0.85)), TR((2.1, 0, 7.28)), SD))
    p.append((g_box((0.62, 0.26, 0.05), bevel=0.02), TR((2.1, 0, 7.16)), LE))
    p.append((g_cyl(0.05, 0.12, 8), TR((2.3, 0, 7.42)), IR))
    p.append((g_box((0.35, 0.03, 0.55), bevel=0.01), TR((0.0, -0.15, 3.2)), T2))   # banner
    out['streetlamp'] = hp('streetlamp', p)
    # ---------------- traffic light: mast pole, arm, two 3-lamp heads with visors + backplates, ped signal
    p = [(g_cyl(0.18, 0.4, 20, bevel=0.02), TR((0, 0, 0.2)), SD),
         (g_cyl(0.13, 6.0, 16, r2=0.11), TR((0, 0, 3.4)), SD),
         (g_cyl(0.09, 5.6, 14, r2=0.06), TR((2.8, 0, 6.2), (0, math.pi / 2, 0)), SD),
         (g_cyl(0.05, 3.2, 10), TR((1.4, 0, 6.9), (0, 1.35, 0)), SD)]
    for hx in (3.2, 5.2):
        p.append((g_box((0.06, 0.02, 0.1), bevel=0.0), TR((hx, 0, 6.0)), IR))
        p.append((g_box((0.4, 0.32, 1.1), bevel=0.04, segs=2), TR((hx, 0, 5.4)), SB))
        p.append((g_box((0.55, 0.04, 1.25), bevel=0.02), TR((hx, 0.18, 5.4)), IR))
        for k, z in enumerate((5.75, 5.4, 5.05)):
            p.append((g_cyl(0.12, 0.03, 20), TR((hx, -0.17, z), (math.pi / 2, 0, 0)), IR))
            p.append((g_cyl(0.14, 0.2, 20, caps=False), TR((hx, -0.26, z + 0.02), (math.pi / 2 + 0.15, 0, 0)), SB))
    p.append((g_box((0.35, 0.28, 0.7), bevel=0.03), TR((0, -0.28, 3.1)), SB))
    p.append((g_box((0.28, 0.02, 0.28), bevel=0.0), TR((0, -0.43, 3.25)), IR))
    p.append((g_box((0.28, 0.02, 0.28), bevel=0.0), TR((0, -0.43, 2.95)), IR))
    p.append((g_box((0.9, 0.03, 0.22), bevel=0.01), TR((1.2, 0, 6.55)), PG))       # street name sign
    out['traffic_light'] = hp('traffic_light', p)
    # ---------------- trees: branching trunk + noise-displaced leaf clusters
    for tn, (h, crown, nclu, lmats) in (('tree_a', (3.2, 2.2, 9, (LF, LF2))), ('tree_b', (2.4, 1.7, 7, (LF2, LF)))):
        rnd = random.Random(7 if tn == 'tree_a' else 11)
        p = [(g_cyl(0.2, h, 12, r2=0.13), TR((0, 0, h / 2)), TK),
             (g_cyl(0.32, 0.25, 12, r2=0.2), TR((0, 0, 0.12)), TK)]
        tips = []
        for k in range(5):
            a = k * 2 * math.pi / 5 + rnd.uniform(-0.3, 0.3)
            base = Vector((0, 0, h * rnd.uniform(0.75, 0.95)))
            tip = base + Vector((math.cos(a) * crown * 0.6, math.sin(a) * crown * 0.6, crown * rnd.uniform(0.4, 0.8)))
            d = tip - base
            q = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
            p.append((g_cyl(0.08, d.length, 8, r2=0.035), Matrix.Translation(base + d / 2) @ q, TK))
            tips.append(tip)
        tree_trunk = hp(tn + "_t", p)
        bm = bmesh.new()
        centers = tips + [Vector((0, 0, h + crown * 0.6))] + [Vector((rnd.uniform(-1, 1) * crown * 0.5, rnd.uniform(-1, 1) * crown * 0.5, h + crown * rnd.uniform(0.2, 1.0))) for _ in range(nclu - 6)]
        for ci, c in enumerate(centers):
            r = crown * rnd.uniform(0.42, 0.6)
            res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
            for v in res['verts']:
                n = noise.noise(v.co * 2.2 + Vector((ci * 3.1, 0, 0)))
                v.co = v.co * (1 + 0.25 * n) * Vector((1, 1, 0.8)) + c
            for f in {f for v in res['verts'] for f in v.link_faces}:
                f.material_index = lmats[ci % 2]
        leaves = bm_to_obj(bm, "HD_P_" + tn + "_l", PM)
        out[tn] = join([tree_trunk, leaves], "HD_P_" + tn)
    # ---------------- bench: cast-iron sides + wooden slats
    p = []
    for x in (-0.85, 0.85):
        p.append((g_box((0.07, 0.55, 0.06), bevel=0.02), TR((x, 0.0, 0.05)), IR))
        p.append((g_box((0.06, 0.06, 0.45), bevel=0.02), TR((x, -0.2, 0.25)), IR))
        p.append((g_box((0.06, 0.06, 0.85), bevel=0.02), TR((x, 0.2, 0.45), (0.22, 0, 0)), IR))
        p.append((g_box((0.06, 0.5, 0.05), bevel=0.02), TR((x, 0.0, 0.45)), IR))
        p.append((g_box((0.06, 0.4, 0.05), bevel=0.02), TR((x, -0.05, 0.66)), IR))
    for k in range(4):
        p.append((g_box((1.95, 0.09, 0.04), bevel=0.012), TR((0, -0.2 + k * 0.105, 0.49)), WD))
    for k in range(3):
        p.append((g_box((1.95, 0.08, 0.035), bevel=0.012), TR((0, 0.24 + k * 0.02, 0.62 + k * 0.13), (0.22, 0, 0)), WD))
    out['bench'] = hp('bench', p)
    # ---------------- hydrant
    p = [(g_cyl(0.2, 0.08, 16, bevel=0.015), TR((0, 0, 0.04)), PRd),
         (g_cyl(0.15, 0.55, 20, bevel=0.0), TR((0, 0, 0.36)), PRd),
         (g_cyl(0.18, 0.06, 20, bevel=0.01), TR((0, 0, 0.62)), PRd),
         (g_sph(0.15, 18, 10, (1, 1, 0.7)), TR((0, 0, 0.66)), PRd),
         (g_cyl(0.04, 0.1, 6, bevel=0.005), TR((0, 0, 0.8)), CR)]
    for sg in (1, -1):
        p.append((g_cyl(0.065, 0.14, 14, bevel=0.01), TR((sg * 0.2, 0, 0.45), (0, math.pi / 2, 0)), PRd))
        p.append((g_cyl(0.075, 0.03, 6, bevel=0.005), TR((sg * 0.27, 0, 0.45), (0, math.pi / 2, 0)), CR))
    p.append((g_cyl(0.09, 0.14, 14, bevel=0.01), TR((0, -0.2, 0.42), (math.pi / 2, 0, 0)), PRd))
    for k in range(6):
        a = k * math.pi / 3
        p.append((g_cyl(0.015, 0.03, 6), TR((0.17 * math.cos(a), 0.17 * math.sin(a), 0.1)), CR))
    out['hydrant'] = hp('hydrant', p)
    # ---------------- trash bin (ribbed)
    p = [(g_cyl(0.3, 0.88, 24, r2=0.33), TR((0, 0, 0.44)), PG),
         (g_cyl(0.36, 0.1, 24, bevel=0.02), TR((0, 0, 0.93)), IR),
         (g_cyl(0.2, 0.04, 20), TR((0, 0, 0.99)), RB)]
    for k in range(16):
        a = k * math.pi / 8
        p.append((g_box((0.03, 0.03, 0.84), bevel=0.008), TR((0.325 * math.cos(a), 0.325 * math.sin(a), 0.44), (0, 0, a)), IR))
    out['trash_bin'] = hp('trash_bin', p)
    # ---------------- water tower: staves, hoops, braced legs, ladder, cone roof + finial
    p = []
    for (x, y) in ((-1.4, -1.4), (1.4, -1.4), (1.4, 1.4), (-1.4, 1.4)):
        p.append((g_box((0.18, 0.18, 3.3), bevel=0.02), TR((x * 0.9, y * 0.9, 1.65), (y * -0.03, x * 0.03, 0)), IR))
    for z in (1.0, 2.2):
        for (a_, b_) in (((-1.3, -1.3), (1.3, -1.3)), ((1.3, -1.3), (1.3, 1.3)), ((1.3, 1.3), (-1.3, 1.3)), ((-1.3, 1.3), (-1.3, -1.3))):
            d = Vector((b_[0] - a_[0], b_[1] - a_[1], 0))
            p.append((g_box((0.08, 0.08, d.length), bevel=0.0), Matrix.Translation(((a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2, z)) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), IR))
    p.append((g_box((3.4, 3.4, 0.2), bevel=0.02), TR((0, 0, 3.35)), IR))
    for k in range(28):
        a = k * 2 * math.pi / 28
        p.append((g_box((0.4, 0.09, 3.7), bevel=0.01), TR((1.92 * math.cos(a), 1.92 * math.sin(a), 5.3), (0, 0, a + math.pi / 2)), WD if k % 3 else WK))
    for z in (3.8, 4.6, 5.4, 6.2, 6.9):
        p.append((g_cyl(2.0, 0.07, 32, caps=False), TR((0, 0, z)), IR))
    p.append((g_cyl(1.9, 0.1, 28), TR((0, 0, 3.47)), WK))
    p.append((g_cyl(2.1, 1.7, 28, r2=0.12), TR((0, 0, 8.0)), WK))
    p.append((g_sph(0.14, 10, 8), TR((0, 0, 8.9)), IR))
    for k in range(10):
        p.append((g_box((0.45, 0.04, 0.03), bevel=0.0), TR((0, -2.05, 3.6 + k * 0.4)), IR))
    p.append((g_box((0.03, 0.04, 4.0), bevel=0.0), TR((0.22, -2.05, 5.4)), IR))
    p.append((g_box((0.03, 0.04, 4.0), bevel=0.0), TR((-0.22, -2.05, 5.4)), IR))
    out['water_tower'] = hp('water_tower', p)
    # ---------------- HVAC: housing, grille fans with blades, louvers, pipes
    p = [(g_box((3.0, 1.8, 1.3), bevel=0.05, segs=2), TR((0, 0, 0.75)), CO),
         (g_box((3.1, 1.9, 0.1), bevel=0.02), TR((0, 0, 1.45)), ST),
         (g_box((3.2, 2.0, 0.12), bevel=0.02), TR((0, 0, 0.06)), SD)]
    for x in (-0.75, 0.75):
        p.append((g_cyl(0.62, 0.1, 32, caps=False), TR((x, 0, 1.5)), ST))
        p.append((g_cyl(0.1, 0.12, 12), TR((x, 0, 1.46)), SD))
        for k in range(5):
            a = k * 2 * math.pi / 5
            p.append((g_box((0.5, 0.14, 0.015), bevel=0.0), TR((x + 0.28 * math.cos(a), 0.28 * math.sin(a), 1.47), (0.3, 0, a)), SD))
        for k in range(7):
            p.append((g_box((1.2, 0.015, 0.02), bevel=0.0), TR((x, -0.54 + k * 0.18, 1.56)), IR))
    for k in range(9):
        p.append((g_box((2.6, 0.04, 0.06), bevel=0.0), TR((0, -0.91, 0.25 + k * 0.12), (0.5, 0, 0)), CD))
    p.append((g_cyl(0.08, 1.0, 12), TR((1.55, 0.4, 0.5), (0, math.pi / 2, 0)), CR))
    p.append((g_cyl(0.06, 1.0, 12), TR((1.55, 0.6, 0.35), (0, math.pi / 2, 0)), CR))
    out['hvac'] = hp('hvac', p)
    # ---------------- rooftop access hut
    p = [(g_box((3.2, 4.0, 3.0), bevel=0.03), TR((0, 0, 1.5)), CD),
         (g_box((3.5, 4.3, 0.22), bevel=0.03), TR((0, 0, 3.1)), TA),
         (g_box((1.2, 0.12, 2.2), bevel=0.02), TR((0, -2.03, 1.1)), SD),
         (g_box((1.0, 0.06, 2.0), bevel=0.01), TR((0, -2.08, 1.05)), IR),
         (g_cyl(0.03, 0.06, 8), TR((0.35, -2.13, 1.05), (math.pi / 2, 0, 0)), CR),
         (g_box((0.4, 0.2, 0.2), bevel=0.02), TR((0, -2.1, 2.45)), SD),
         (g_box((0.25, 0.05, 0.1), bevel=0.01), TR((0, -2.2, 2.4)), LE),
         (g_box((0.6, 0.6, 0.45), bevel=0.04), TR((0.8, 1.0, 3.4)), ST),
         (g_cyl(0.15, 0.6, 12), TR((-0.9, 1.2, 3.5)), ST),
         (g_cyl(0.22, 0.1, 12), TR((-0.9, 1.2, 3.85)), SD)]
    out['roof_hut'] = hp('roof_hut', p)
    # ---------------- antenna mast (lattice)
    p = [(g_box((0.9, 0.9, 0.3), bevel=0.02), TR((0, 0, 0.15)), CO)]
    H = 11.0
    for (x, y) in ((-0.15, -0.15), (0.15, -0.15), (0.15, 0.15), (-0.15, 0.15)):
        p.append((g_box((0.04, 0.04, H), bevel=0.0), TR((x, y, H / 2 + 0.3)), ST))
    for k in range(int(H / 0.8)):
        z = 0.3 + k * 0.8
        for (a_, b_) in (((-0.15, -0.15), (0.15, 0.15)), ((0.15, -0.15), (-0.15, 0.15))):
            d = Vector((b_[0] - a_[0], b_[1] - a_[1], 0.8))
            p.append((g_box((0.02, 0.02, d.length), bevel=0.0), Matrix.Translation(((a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2, z + 0.4)) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), ST))
    for z, w in ((5, 1.6), (7.5, 1.2), (10, 0.8)):
        p.append((g_box((w * 2, 0.05, 0.05), bevel=0.0), TR((0, 0, z)), ST))
        p.append((g_cyl(0.18, 0.35, 12), TR((w, 0, z)), WH))
    p.append((g_sph(0.12, 10, 8), TR((0, 0, H + 0.5)), RE))
    out['antenna'] = hp('antenna', p)
    # ---------------- billboard: truss legs, catwalk, frame, lamps (panel face textured at runtime)
    p = []
    for x in (-3.0, 3.0):
        p.append((g_box((0.25, 0.25, 4.3), bevel=0.02), TR((x, 0.4, 2.15)), IR))
        for k in range(4):
            p.append((g_box((0.05, 0.05, 1.3), bevel=0.0), TR((x, 0.55, 0.5 + k * 1.0), (0.7 if k % 2 else -0.7, 0, 0)), IR))
    p.append((g_box((8.6, 0.3, 4.2), bevel=0.03), TR((0, 0.05, 6.2)), IR))
    p.append((g_box((8.9, 0.1, 0.18), bevel=0.02), TR((0, -0.12, 8.35)), SD))
    p.append((g_box((8.9, 0.1, 0.18), bevel=0.02), TR((0, -0.12, 4.05)), SD))
    p.append((g_box((8.8, 1.0, 0.06), bevel=0.01), TR((0, -0.6, 4.0)), SD))
    for k in range(29):
        p.append((g_box((0.02, 0.02, 0.9), bevel=0.0), TR((-4.35 + k * 0.31, -1.08, 4.45)), IR))
    p.append((g_box((8.8, 0.03, 0.03), bevel=0.0), TR((0, -1.08, 4.9)), IR))
    for x in (-3, -1, 1, 3):
        p.append((g_cyl(0.025, 1.0, 6), TR((x, -0.6, 8.6), (1.2, 0, 0)), SD))
        p.append((g_box((0.3, 0.25, 0.14), bevel=0.03), TR((x, -1.05, 8.9)), SD))
        p.append((g_box((0.24, 0.02, 0.1), bevel=0.0), TR((x, -1.17, 8.87)), LE))
    out['billboard'] = hp('billboard', p)
    # ---------------- fire escape module (grate platform, balusters, stair w/ treads, ladder)
    p = [(g_box((4.0, 1.3, 0.05), bevel=0.0), TR((0, -0.65, 0)), IR)]
    for k in range(13):
        p.append((g_box((0.02, 1.28, 0.04), bevel=0.0), TR((-1.98 + k * 0.33, -0.65, 0.03)), IR))
    for z in (0.5, 1.0):
        p.append((g_box((4.0, 0.04, 0.04), bevel=0.0), TR((0, -1.28, z)), IR))
        p.append((g_box((0.04, 1.3, 0.04), bevel=0.0), TR((-1.98, -0.65, z)), IR))
        p.append((g_box((0.04, 1.3, 0.04), bevel=0.0), TR((1.98, -0.65, z)), IR))
    for k in range(21):
        p.append((g_box((0.02, 0.02, 1.0), bevel=0.0), TR((-1.98 + k * 0.198, -1.28, 0.5)), IR))
    for k in range(10):
        t = k / 9
        p.append((g_box((0.8, 0.22, 0.03), bevel=0.0), TR((-1.3 + 2.4 * t, -0.72, -3.3 + t * 3.3)), IR))
    for y in (-1.12, -0.32):
        d = Vector((2.9, 0, 3.4))
        p.append((g_box((0.05, 0.04, d.length), bevel=0.0), Matrix.Translation((-0.25, y, -1.7)) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), IR))
    for k in range(8):
        p.append((g_box((0.4, 0.02, 0.02), bevel=0.0), TR((1.6, -1.25, -0.4 - k * 0.3)), IR))
    for x in (1.4, 1.8):
        p.append((g_box((0.025, 0.025, 2.6), bevel=0.0), TR((x, -1.25, -1.4)), IR))
    for x in (-1.9, 1.9):
        d = Vector((0, 1.2, -0.8))
        p.append((g_box((0.04, 0.04, d.length), bevel=0.0), Matrix.Translation((x, -0.6, -0.4)) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), IR))
    out['fire_escape'] = hp('fire_escape', p)
    # ---------------- turbine vent stack
    p = [(g_box((1.6, 1.6, 1.7), bevel=0.04), TR((0, 0, 0.85)), ST),
         (g_cyl(0.55, 1.2, 24), TR((0, 0, 2.3)), SD),
         (g_cyl(0.6, 0.08, 24, bevel=0.01), TR((0, 0, 2.9)), ST)]
    for k in range(18):
        a = k * 2 * math.pi / 18
        p.append((g_box((0.06, 0.25, 0.6), bevel=0.0), TR((0.5 * math.cos(a), 0.5 * math.sin(a), 3.25), (0, 0.25, a)), ST))
    p.append((g_sph(0.55, 20, 10, (1, 1, 0.5)), TR((0, 0, 3.55)), ST))
    for k in range(6):
        p.append((g_box((1.5, 0.04, 0.08), bevel=0.0), TR((0, -0.81, 0.4 + k * 0.2), (0.5, 0, 0)), SD))
    out['vent_stack'] = hp('vent_stack', p)
    # ---------------- scaffold bay: tubes, couplers, planks, toe boards, braces
    p = []
    for x in (-2, 2):
        for y in (0, -1.2):
            p.append((g_cyl(0.024, 4.1, 8), TR((x, y, 2.05)), ST))
            for z in (0.05, 1.0, 2.0, 3.0, 4.0):
                p.append((g_box((0.07, 0.07, 0.07), bevel=0.01), TR((x, y, z)), SD))
    for z in (0.05, 1.0, 2.0, 3.0, 4.0):
        for y in (0, -1.2):
            p.append((g_cyl(0.022, 4.0, 8), TR((0, y, z), (0, math.pi / 2, 0)), ST))
        for x in (-2, 2):
            p.append((g_cyl(0.022, 1.2, 8), TR((x, -0.6, z), (math.pi / 2, 0, 0)), ST))
    for k in range(5):
        p.append((g_box((4.0, 0.22, 0.05), bevel=0.008), TR((0, -0.12 - k * 0.24, 3.05)), WD))
    p.append((g_box((4.0, 0.03, 0.18), bevel=0.0), TR((0, -1.22, 3.12)), WK))
    d = Vector((4, 0, 3))
    p.append((g_cyl(0.02, d.length, 8), Matrix.Translation((0, -1.2, 1.55)) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), ST))
    out['scaffold'] = hp('scaffold', p)
    # ---------------- shipping container: corrugation, door locking bars, corner castings
    p = [(g_box((12.2, 2.44, 2.6), bevel=0.02), TR((0, 0, 1.3)), CA)]
    for k in range(46):
        x = -5.9 + k * 0.26
        for sg in (1, -1):
            p.append((g_box((0.12, 0.05, 2.4), bevel=0.0), TR((x, sg * 1.22, 1.3)), CA))
    for (x, y, z) in [(sx * 6.0, sy * 1.12, sz) for sx in (1, -1) for sy in (1, -1) for sz in (0.1, 2.5)]:
        p.append((g_box((0.2, 0.2, 0.2), bevel=0.01), TR((x, y, z)), SD))
    for k in range(4):
        p.append((g_cyl(0.025, 2.4, 8), TR((6.13, -0.9 + k * 0.6, 1.3)), CR))
        p.append((g_box((0.05, 0.1, 0.12), bevel=0.01), TR((6.15, -0.9 + k * 0.6, 1.0)), SD))
    out['container'] = hp('container', p)
    # ---------------- chimney (brick bands + ladder rungs)
    p = [(g_cyl(2.0, 36, 24, r2=1.3), TR((0, 0, 18)), BR),
         (g_cyl(2.4, 1.5, 24, bevel=0.03), TR((0, 0, 0.75)), CO)]
    for z in (6, 12, 18, 24, 30, 34):
        r = 2.0 - (z / 36) * 0.7
        p.append((g_cyl(r + 0.08, 0.4, 24), TR((0, 0, z)), BK))
    p.append((g_cyl(1.45, 1.4, 24, bevel=0.03), TR((0, 0, 36.5)), IR))
    for k in range(40):
        z = 2 + k * 0.85
        r = 2.0 - (z / 36) * 0.7
        p.append((g_box((0.4, 0.04, 0.04), bevel=0.0), TR((0, -(r + 0.15), z)), IR))
    out['chimney'] = hp('chimney', p)
    # ---------------- market stall (scalloped awning)
    p = []
    for (x, y) in ((-1.4, -0.9), (1.4, -0.9), (-1.4, 0.9), (1.4, 0.9)):
        p.append((g_cyl(0.04, 2.4, 8), TR((x, y, 1.2)), WK))
    p.append((g_box((3.0, 1.6, 0.9), bevel=0.03), TR((0, 0.1, 0.45)), WD))
    p.append((g_box((3.4, 2.4, 0.06), bevel=0.01), TR((0, 0, 2.45), (0.18, 0, 0)), CL))
    for k in range(9):
        p.append((g_box((0.36, 0.02, 0.22), bevel=0.0), TR((-1.5 + k * 0.375, -1.18, 2.15)), CL if k % 2 else WH))
    for k in range(10):
        p.append((g_sph(0.12, 8, 6), TR((-1.2 + (k % 5) * 0.6, -0.1 + (k // 5) * 0.4, 1.02)), (PRd, PY, LF2)[k % 3]))
    out['market_stall'] = hp('market_stall', p)
    # ---------------- bus stop shelter
    p = [(g_box((3.6, 1.5, 0.1), bevel=0.02), TR((0, 0, 2.55)), SD)]
    for x in (-1.75, 1.75):
        p.append((g_box((0.08, 0.08, 2.5), bevel=0.01), TR((x, 0.65, 1.25)), SD))
        p.append((g_box((0.08, 0.08, 2.5), bevel=0.01), TR((x, -0.65, 1.25)), SD))
    p.append((g_box((3.4, 0.03, 2.0), bevel=0.0), TR((0, 0.66, 1.4)), GL_))
    p.append((g_box((0.03, 1.2, 2.0), bevel=0.0), TR((1.74, 0.0, 1.4)), GL_))
    p.append((g_box((0.12, 1.3, 1.9), bevel=0.02), TR((-1.75, 0.0, 1.35)), SD))
    p.append((g_box((0.04, 1.1, 1.6), bevel=0.0), TR((-1.68, 0.0, 1.4)), AE))
    p.append((g_box((2.4, 0.4, 0.06), bevel=0.01), TR((0, 0.4, 0.48)), ST))
    for x in (-1.0, 1.0):
        p.append((g_box((0.05, 0.3, 0.45), bevel=0.0), TR((x, 0.4, 0.23)), SD))
    out['bus_stop'] = hp('bus_stop', p)
    # ---------------- throwables: crate, barrier, sign, pipe
    p = [(g_box((1.0, 1.0, 1.0), bevel=0.02), TR((0, 0, 0.5)), WD)]
    for sg in (1, -1):
        for axis in range(3):
            for s2 in (1, -1):
                if axis == 0: p.append((g_box((1.04, 0.1, 0.1), bevel=0.01), TR((0, sg * 0.46, 0.5 + s2 * 0.46)), WK))
                if axis == 1: p.append((g_box((0.1, 1.04, 0.1), bevel=0.01), TR((sg * 0.46, 0, 0.5 + s2 * 0.46)), WK))
                if axis == 2: p.append((g_box((0.1, 0.1, 1.04), bevel=0.01), TR((sg * 0.46, s2 * 0.46, 0.5)), WK))
        d = Vector((0.9, 0, 0.9))
        p.append((g_box((0.08, 0.05, d.length), bevel=0.0), Matrix.Translation((0, sg * 0.5, 0.5)) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), WK))
    out['crate'] = hp('crate', p)
    p = [(g_box((2.0, 0.6, 0.35), bevel=0.04), TR((0, 0, 0.18)), WH),
         (g_box((2.0, 0.6, 0.6), bevel=0.04, taper=(1.0, 0.35)), TR((0, 0, 0.62)), WH),
         (g_box((2.02, 0.28, 0.1), bevel=0.01), TR((0, 0, 0.72)), PRd),
         (g_box((2.02, 0.3, 0.1), bevel=0.01), TR((0, 0, 0.5)), PRd)]
    out['barrier'] = hp('barrier', p)
    p = [(g_cyl(0.035, 3.0, 8), TR((0, 0, 1.5)), ST), (g_box((0.8, 0.04, 0.8), bevel=0.02), TR((0, 0, 2.6), (0, math.pi / 4, 0)), PG),
         (g_box((0.7, 0.045, 0.7), bevel=0.0), TR((0, -0.005, 2.6), (0, math.pi / 4, 0)), WH), (g_box((0.6, 0.05, 0.6), bevel=0.0), TR((0, -0.01, 2.6), (0, math.pi / 4, 0)), PG)]
    out['street_sign'] = hp('street_sign', p)
    p = [(g_cyl(0.18, 3.0, 20), TR((0, 0, 0.18), (0, math.pi / 2, 0)), ST),
         (g_cyl(0.22, 0.12, 20, bevel=0.01), TR((1.45, 0, 0.18), (0, math.pi / 2, 0)), SD),
         (g_cyl(0.22, 0.12, 20, bevel=0.01), TR((-1.45, 0, 0.18), (0, math.pi / 2, 0)), SD)]
    out['pipe_piece'] = hp('pipe_piece', p)
    # ---------------- vendor cart, park lamp, railing, bollard, pipe rack
    p = [(g_box((1.8, 1.0, 1.0), bevel=0.05, segs=2), TR((0, 0, 0.65)), CR),
         (g_box((1.82, 1.02, 0.08), bevel=0.02), TR((0, 0, 1.16)), SD),
         (g_cyl(0.05, 1.4, 8), TR((0, 0, 1.9)), ST),
         (g_cyl(1.25, 0.45, 16, r2=0.05), TR((0, 0, 2.7)), T2),
         (g_box((1.0, 0.02, 0.5), bevel=0.0), TR((0, -0.52, 0.7)), AE)]
    for x in (-0.6, 0.6):
        p.append((g_cyl(0.2, 0.08, 16, bevel=0.01), TR((x, -0.52, 0.2), (math.pi / 2, 0, 0)), RB))
    out['vendor_cart'] = hp('vendor_cart', p)
    p = [(g_cyl(0.14, 0.35, 12, r2=0.09, bevel=0.01), TR((0, 0, 0.17)), IR), (g_cyl(0.06, 3.3, 10), TR((0, 0, 1.95)), IR),
         (g_cyl(0.18, 0.1, 12), TR((0, 0, 3.6)), IR), (g_sph(0.26, 14, 10), TR((0, 0, 3.88)), LE),
         (g_cyl(0.3, 0.15, 12, r2=0.06), TR((0, 0, 4.18)), IR), (g_sph(0.05, 8, 6), TR((0, 0, 4.3)), IR)]
    out['park_lamp'] = hp('park_lamp', p)
    p = []
    for x in (-2, -1, 0, 1, 2):
        p.append((g_box((0.1, 0.1, 1.1), bevel=0.02), TR((x, 0, 0.55)), WK))
    p.append((g_box((4.1, 0.14, 0.08), bevel=0.02), TR((0, 0, 1.12)), WD))
    p.append((g_box((4.1, 0.06, 0.06), bevel=0.01), TR((0, 0, 0.6)), WD))
    for k in range(20):
        p.append((g_box((0.025, 0.025, 0.5), bevel=0.0), TR((-1.9 + k * 0.2, 0, 0.85)), IR))
    out['railing'] = hp('railing', p)
    p = [(g_cyl(0.13, 0.85, 16, bevel=0.0), TR((0, 0, 0.43)), IR), (g_sph(0.13, 16, 8, (1, 1, 0.6)), TR((0, 0, 0.86)), IR),
         (g_cyl(0.14, 0.05, 16), TR((0, 0, 0.7)), PY)]
    out['bollard'] = hp('bollard', p)
    p = []
    for x in (-5, 0, 5):
        for y in (-1.5, 1.5):
            p.append((g_box((0.3, 0.3, 5), bevel=0.02), TR((x, y, 2.5)), SD))
        p.append((g_box((0.3, 3.3, 0.3), bevel=0.02), TR((x, 0, 5)), SD))
        d = Vector((0, 3.0, 3.0))
        p.append((g_box((0.12, 0.12, d.length), bevel=0.0), Matrix.Translation((x, 0, 2.5)) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4(), SD))
    for y, r, m in ((-1, 0.35, PY), (0, 0.45, ST), (1, 0.3, PRd)):
        p.append((g_cyl(r, 12, 20), TR((0, y, 5.2 + r), (0, math.pi / 2, 0)), m))
        for x in (-4.5, -1.5, 1.5, 4.5):
            p.append((g_cyl(r + 0.03, 0.1, 20), TR((x, y, 5.2 + r), (0, math.pi / 2, 0)), SD))
    out['pipe_rack'] = hp('pipe_rack', p)
    return out
