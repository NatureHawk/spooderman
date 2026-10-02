# THREADLINE HD boss: THE WARDEN municipal-construction exoskeleton (rigid parts, pivots at joints)
# run after bl_helpers, hd_char, hd_heroes. Pilot = HD_MER_base skinned mesh posed seated in-engine.
# Parts face -Y, limbs extend along -Z from their pivot. Scale: ~5.5 m tall.
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

WY = tl_mat('tl_warden', hexc('c89a2a'), rough=0.55, metal=0.2)
WK = tl_mat('tl_warden_dk', hexc('2d2a27'))
CH = tl_mat('tl_chrome2', hexc('c4c9ce'), rough=0.25, metal=1.0)
HZ = tl_mat('tl_hazard_blk', hexc('151515'))
GLS = tl_mat('tl_glass_cab', hexc('3a5566'))
EMO = M['orange_emit']
RED = M['red_emit']
MATS = [WY, WK, CH, HZ, GLS, EMO, RED]
Y_, K_, C_, H_, G_, E_, R_ = range(7)

def hazard_panel(parts, w, h, center, rot=(0, 0, 0), n=6, depth=0.02):
    """Diagonal-read hazard stripes: alternating yellow/black slats."""
    M4 = TR(center, rot)
    sw = w / n
    for i in range(n):
        parts.append((g_box((sw * 0.98, depth, h), bevel=0.0), M4 @ TR((-w / 2 + sw * (i + 0.5), 0, 0)), Y_ if i % 2 == 0 else H_))

def bolts(parts, pts, r=0.025, axis_rot=(math.pi / 2, 0, 0)):
    for p in pts:
        parts.append((g_cyl(r, 0.03, 6), TR(p, axis_rot), C_))

def vent(parts, center, w, h, n=5, rot=(0, 0, 0)):
    M4 = TR(center, rot)
    parts.append((g_box((w + 0.04, 0.03, h + 0.04), bevel=0.005), M4, K_))
    for i in range(n):
        parts.append((g_box((w, 0.04, h / n * 0.45), bevel=0.0), M4 @ TR((0, -0.02, -h / 2 + h / n * (i + 0.5)), (0.5, 0, 0)), K_))

def piston(parts, a, b, r=0.08):
    """Hydraulic piston from a to b: sleeve (dark) + chrome rod + end eyes."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    q = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    parts.append((g_cyl(r, L * 0.55, 16, bevel=0.01), Matrix.Translation(a) @ q, K_))
    parts.append((g_cyl(r * 0.55, L * 0.5, 14), Matrix.Translation(a + d * 0.5) @ q, C_))
    for p in (a, b):
        parts.append((g_sph(r * 0.9, 12, 8), Matrix.Translation(p), K_))

def build_warden():
    out = {}
    for n in [o.name for o in bpy.data.objects if o.name.startswith("HD_WD_")]:
        remove_obj(n)
    # ---------------- pelvis (origin = hip center)
    p = []
    p.append((g_box((1.3, 0.95, 0.62), bevel=0.06, segs=3), TR((0, 0, 0)), K_))
    p.append((g_box((1.45, 1.0, 0.22), bevel=0.04), TR((0, 0, 0.32)), Y_))
    for sg in (1, -1):
        p.append((g_cyl(0.3, 0.3, 24, bevel=0.03), TR((sg * 0.72, 0, 0), (0, math.pi / 2, 0)), Y_))
        p.append((g_cyl(0.18, 0.34, 20, bevel=0.02), TR((sg * 0.72, 0, 0), (0, math.pi / 2, 0)), C_))
    hazard_panel(p, 0.9, 0.18, (0, -0.52, 0.05))
    bolts(p, [(x, -0.49, 0.26) for x in (-0.55, -0.3, 0.3, 0.55)])
    out['pelvis'] = piece("HD_WD_pelvis", p, MATS)
    # ---------------- torso / cab (origin = waist pivot): tapered abdomen, rounded armored chest,
    # bubble canopy over the seated pilot, dome shoulder housings -> humanoid silhouette
    p = []
    p.append((g_box((1.1, 0.95, 0.8), bevel=0.12, segs=4, taper=(1.35, 1.2)), TR((0, 0.05, 0.4)), K_))       # abdomen
    for k in range(3):
        p.append((g_box((1.2 + k * 0.12, 1.0, 0.16), bevel=0.05, segs=2), TR((0, 0.02, 0.18 + k * 0.24)), Y_))  # ab armor bands
    p.append((g_box((2.3, 1.45, 1.25), bevel=0.32, segs=5, taper=(1.12, 1.0)), TR((0, 0.12, 1.45)), Y_))       # chest mass
    for sg in (1, -1):
        p.append((g_box((0.95, 0.35, 0.8), bevel=0.2, segs=4), TR((sg * 0.62, -0.55, 1.62)), Y_))              # pectoral armor
        # dome shoulder housings
        p.append((g_sph(0.62, 28, 18, (1.0, 1.05, 0.85)), TR((sg * 1.32, 0.05, 1.9)), Y_))
        p.append((g_cyl(0.64, 0.18, 28, bevel=0.03), TR((sg * 1.32, 0.05, 1.55)), K_))
        vent(p, (sg * 1.32, -0.62, 1.78), 0.42, 0.3, 4)
        p.append((g_cyl(0.11, 0.55, 16, bevel=0.02), TR((sg * 0.62, 0.72, 2.0)), K_))                         # exhaust stacks
        p.append((g_cyl(0.13, 0.08, 16, bevel=0.01), TR((sg * 0.62, 0.72, 2.55)), C_))
        p.append((g_cyl(0.08, 0.07, 14), TR((sg * 0.62, -0.74, 2.05), (math.pi / 2, 0, 0)), E_))              # work lights
        p.append((g_box((0.22, 0.1, 0.18), bevel=0.02), TR((sg * 0.62, -0.7, 2.05)), K_))
    # recessed cockpit bay (dark) inside the chest, seat + controls
    p.append((g_box((1.0, 0.5, 0.95), bevel=0.08, segs=2), TR((0, -0.45, 1.35)), K_))
    p.append((g_box((0.55, 0.3, 0.55), bevel=0.05), TR((0, -0.25, 1.35)), K_))
    p.append((g_box((0.55, 0.45, 0.1), bevel=0.03), TR((0, -0.45, 1.02)), K_))
    for sg in (1, -1):
        p.append((g_cyl(0.025, 0.25, 8), TR((sg * 0.33, -0.6, 1.1)), C_))
    # roll bars framing the canopy
    for x in (-0.52, 0.52):
        p.append((g_cyl(0.05, 1.0, 10), TR((x, -0.78, 0.9)), C_))
    p.append((g_cyl(0.05, 1.04, 10), TR((-0.52, -0.78, 1.9), (0, math.pi / 2, 0)), C_))
    # collar / neck ring
    p.append((g_cyl(0.42, 0.22, 28, bevel=0.04), TR((0, 0.05, 2.02)), K_))
    hazard_panel(p, 1.0, 0.16, (0, -0.64, 0.66))
    bolts(p, [(x, -0.7, 0.84) for x in (-0.45, -0.15, 0.15, 0.45)])
    p.append((g_sph(0.13, 16, 10), TR((0, -0.62, 0.3)), E_))                           # reactor (phase-1 weak point)
    torso = piece("HD_WD_torso_s", p, MATS)
    # bubble canopy (open-backed dome) over the pilot bay
    bm_g = bmesh.new()
    bmesh.ops.create_uvsphere(bm_g, u_segments=24, v_segments=14, radius=1.0)
    bmesh.ops.delete(bm_g, geom=[v for v in bm_g.verts if v.co.y > 0.05], context='VERTS')
    for v in bm_g.verts:
        v.co = Vector((v.co.x * 0.5, v.co.y * 0.32 - 0.72, v.co.z * 0.5 + 1.38))
    g_ob = bm_to_obj(bm_g, "HD_WD_glass", MATS)
    for poly in g_ob.data.polygons: poly.material_index = G_
    out['torso'] = join([torso, g_ob], "HD_WD_torso")
    # ---------------- back hydraulic pack (origin = waist pivot, like torso)
    p = []
    p.append((g_box((1.4, 0.7, 1.2), bevel=0.06, segs=3), TR((0, 1.05, 1.35)), K_))
    for x in (-0.4, 0.0, 0.4):
        p.append((g_cyl(0.13, 1.1, 18, bevel=0.015), TR((x, 1.45, 0.8)), Y_))
        p.append((g_cyl(0.14, 0.06, 18), TR((x, 1.45, 1.3)), C_))
    vent(p, (0, 1.41, 1.9), 0.9, 0.3, 4, (0, 0, math.pi))
    p.append((g_sph(0.18, 16, 10), TR((0, 1.42, 1.35)), R_))                          # core (phase 3 weak point)
    out['back'] = piece("HD_WD_back", p, MATS)
    # ---------------- sensor head (origin = neck on the collar): helmet dome + visor band + sensor lenses
    p = []
    p.append((g_cyl(0.3, 0.2, 24, bevel=0.03), TR((0, 0, 0)), K_))
    p.append((g_sph(0.42, 28, 18, (0.95, 1.05, 0.9)), TR((0, 0.0, 0.42)), Y_))
    p.append((g_box((0.7, 0.3, 0.16), bevel=0.06, segs=3), TR((0, -0.3, 0.44)), K_))
    p.append((g_box((0.6, 0.08, 0.08), bevel=0.02), TR((0, -0.44, 0.46)), E_))
    for x in (-0.18, 0.0, 0.18):
        p.append((g_cyl(0.045, 0.06, 12), TR((x, -0.44, 0.33), (math.pi / 2, 0, 0)), R_))
    p.append((g_box((0.1, 0.7, 0.14), bevel=0.04), TR((0, 0.05, 0.84)), H_))
    p.append((g_cyl(0.015, 0.5, 6), TR((0.28, 0.15, 0.7)), C_))
    p.append((g_sph(0.03, 8, 6), TR((0.28, 0.15, 1.2)), R_))
    for sg in (1, -1):
        p.append((g_cyl(0.16, 0.14, 20, bevel=0.02), TR((sg * 0.4, 0.0, 0.42), (0, math.pi / 2, 0)), K_))
    out['head'] = piece("HD_WD_head", p, MATS)
    # ---------------- upper arm (origin = shoulder pivot)
    p = []
    p.append((g_sph(0.34, 20, 14), TR((0, 0, 0)), K_))
    p.append((g_box((0.55, 0.58, 1.25), bevel=0.06, segs=3, taper=(0.85, 0.85)), TR((0, 0, -0.75)), Y_))
    p.append((g_box((0.58, 0.3, 0.5), bevel=0.04), TR((0, -0.16, -0.5)), K_))
    piston(p, (0, -0.36, -0.2), (0, -0.36, -1.25), 0.08)
    hazard_panel(p, 0.42, 0.16, (0, 0.3, -0.35), (0, 0, math.pi), 5)
    bolts(p, [(0.2, -0.3, z) for z in (-0.3, -0.7, -1.1)] + [(-0.2, -0.3, z) for z in (-0.3, -0.7, -1.1)])
    p.append((g_cyl(0.26, 0.64, 20, bevel=0.03), TR((-0.32, 0, -1.4), (0, math.pi / 2, 0)), C_))
    out['uarm'] = piece("HD_WD_uarm", p, MATS)
    # ---------------- forearm + claw base (origin = elbow pivot)
    p = []
    p.append((g_box((0.62, 0.64, 1.2), bevel=0.06, segs=3, taper=(1.15, 1.15)), TR((0, 0, -0.62)), Y_))
    p.append((g_box((0.66, 0.2, 0.9), bevel=0.04), TR((0, -0.3, -0.65)), K_))
    piston(p, (0.36, 0, -0.1), (0.36, 0, -1.1), 0.07)
    piston(p, (-0.36, 0, -0.1), (-0.36, 0, -1.1), 0.07)
    p.append((g_cyl(0.36, 0.3, 24, bevel=0.03), TR((0, 0, -1.4)), K_))
    p.append((g_cyl(0.2, 0.14, 20, bevel=0.02), TR((0, 0, -1.5)), C_))
    hazard_panel(p, 0.5, 0.2, (0, -0.33, -0.2), n=5)
    out['farm'] = piece("HD_WD_farm", p, MATS)
    # ---------------- claw finger (origin = knuckle; extends -Z; 3 instances at runtime)
    p = []
    p.append((g_cyl(0.1, 0.24, 14, bevel=0.015), TR((-0.12, 0, 0), (0, math.pi / 2, 0)), C_))
    p.append((g_box((0.16, 0.2, 0.55), bevel=0.03, taper=(0.8, 0.7)), TR((0, 0, -0.3)), K_))
    p.append((g_box((0.13, 0.16, 0.4), bevel=0.025, taper=(0.3, 0.5)), TR((0, -0.05, -0.72), (0.35, 0, 0)), Y_))
    p.append((g_box((0.06, 0.04, 0.2), bevel=0.0), TR((0, -0.11, -0.5)), H_))
    out['finger'] = piece("HD_WD_finger", p, MATS)
    # ---------------- thigh (origin = hip pivot)
    p = []
    p.append((g_sph(0.3, 18, 12), TR((0, 0, 0)), K_))
    p.append((g_box((0.64, 0.72, 1.25), bevel=0.06, segs=3, taper=(0.85, 0.9)), TR((0, 0, -0.72)), Y_))
    piston(p, (0, 0.42, -0.15), (0, 0.42, -1.2), 0.09)
    p.append((g_box((0.66, 0.2, 0.6), bevel=0.04), TR((0, -0.33, -0.6)), K_))
    hazard_panel(p, 0.5, 0.18, (0, -0.44, -0.6), n=5)
    p.append((g_cyl(0.28, 0.7, 22, bevel=0.03), TR((-0.35, 0, -1.35), (0, math.pi / 2, 0)), C_))
    out['thigh'] = piece("HD_WD_thigh", p, MATS)
    # ---------------- shin (origin = knee pivot)
    p = []
    p.append((g_box((0.6, 0.66, 1.2), bevel=0.06, segs=3, taper=(1.2, 1.1)), TR((0, 0.02, -0.65)), Y_))
    p.append((g_box((0.64, 0.24, 0.8), bevel=0.05), TR((0, -0.34, -0.6), (0.08, 0, 0)), K_))
    piston(p, (0, 0.4, -0.1), (0, 0.4, -1.15), 0.08)
    vent(p, (0, -0.47, -0.6), 0.36, 0.5, 5)
    bolts(p, [(x, -0.47, -0.2) for x in (-0.2, 0.2)])
    out['shin'] = piece("HD_WD_shin", p, MATS)
    # ---------------- foot (origin = ankle pivot)
    p = []
    p.append((g_cyl(0.22, 0.62, 20, bevel=0.02), TR((-0.31, 0, 0), (0, math.pi / 2, 0)), C_))
    p.append((g_box((0.9, 1.5, 0.34), bevel=0.05, segs=3), TR((0, -0.25, -0.18)), K_))
    p.append((g_box((0.95, 0.5, 0.24), bevel=0.05), TR((0, -0.85, -0.22)), Y_))
    for x in (-0.3, 0.0, 0.3):
        p.append((g_box((0.24, 0.3, 0.2), bevel=0.04), TR((x, -1.1, -0.26)), K_))
    hazard_panel(p, 0.7, 0.14, (0, -1.02, -0.1), (0.4, 0, 0), 6)
    out['foot'] = piece("HD_WD_foot", p, MATS)
    return out
