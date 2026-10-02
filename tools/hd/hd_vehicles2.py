# THREADLINE HD vehicles part 2: bus, truck, train car, motorcycle, boat, drones, catalog
# run after hd_vehicles.py
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

def build_bus(name="HD_VEH_bus"):
    S = CarSpec(L=12.0, W=2.55, wb=6.2, front_oh=2.4, hood_z=1.4, belt=1.25, roof=3.15, box=1.0, t_r1=0.965, t_ws=0.99,
                wheel_r=0.5, clear=0.3, tumble=0.97, nose_round=0.15, tail_round=0.12)
    def ex(p, S):
        for k in range(10):                       # window mullions
            x = -S.L / 2 + 0.9 + k * 1.05
            for sg in (1, -1):
                p.append((g_box((0.08, 0.03, 1.5), bevel=0.01), TR((x, sg * (S.W / 2 * 0.985), 2.05)), T_))
        for sg in (1, -1):
            p.append((g_box((S.L * 0.97, 0.03, 0.12), bevel=0.01), TR((0, sg * (S.W / 2 + 0.005), 1.2)), C_))
        for dx in (S.L / 2 - 1.2, -0.6):          # doors (curb side = -Y)
            p.append((g_box((1.1, 0.04, 2.3), bevel=0.02), TR((dx, -(S.W / 2 + 0.01), 1.55)), G_))
            p.append((g_box((0.04, 0.05, 2.3), bevel=0.0), TR((dx, -(S.W / 2 + 0.02), 1.55)), T_))
        p.append((g_box((0.06, 1.6, 0.28), bevel=0.02), TR((S.L / 2 + 0.01, 0, 2.95)), A_))   # route sign
        for x in (-2.5, 1.0):
            p.append((g_box((2.2, 1.6, 0.35), bevel=0.1, segs=3), TR((x, 0, S.roof + 0.15)), C_))  # roof AC pods
    return build_car(name, S, ex)

def build_truck(name="HD_VEH_truck"):
    S = CarSpec(L=8.6, W=2.45, wb=5.0, front_oh=1.3, hood_z=1.55, belt=1.55, roof=3.0, box=1.0, t_r1=0.86, t_ws=0.93,
                wheel_r=0.5, clear=0.32, tumble=0.95, nose_round=0.25, tail_round=0.05)
    def ex(p, S):
        bx = -S.L / 2 + S.L * 0.36
        p.append((g_box((S.L * 0.7, S.W + 0.06, 2.9), bevel=0.04), TR((bx, 0, 2.2)), C_))      # cargo box
        for k in range(9):
            x = bx - S.L * 0.35 + 0.3 + k * 0.7
            for sg in (1, -1):
                p.append((g_box((0.06, 0.04, 2.8), bevel=0.0), TR((x, sg * (S.W / 2 + 0.05), 2.2)), T_))
        for k in range(10):                        # roll door slats
            p.append((g_box((0.03, S.W * 0.9, 0.2), bevel=0.01), TR((-S.L / 2 - 0.02, 0, 0.95 + k * 0.26)), T_))
        for sg in (1, -1):
            p.append((g_cyl(0.28, 1.1, 20, bevel=0.02), TR((S.L / 2 - 2.6, sg * (S.W / 2 - 0.1), 0.72), (0, math.pi / 2, 0)), C_))
        p.append((g_cyl(0.07, 1.6, 12), TR((S.L / 2 - 2.05, -(S.W / 2 - 0.1), 1.6)), C_))
        p.append((g_box((0.05, 2.0, 0.5), bevel=0.02), TR((S.L / 2 + 0.03, 0, 0.9)), C_))
    return build_car(name, S, ex)

def build_train_car(name="HD_VEH_train"):
    S = CarSpec(L=17.6, W=2.9, wb=13.0, front_oh=2.3, hood_z=3.2, belt=1.9, roof=3.7, box=1.0, t_r1=0.985, t_ws=0.995,
                wheel_r=0.42, clear=0.9, tumble=0.97, nose_round=0.08, tail_round=0.08)
    def ex(p, S):
        for k in range(12):
            x = -S.L / 2 + 1.2 + k * 1.4
            for sg in (1, -1):
                p.append((g_box((0.1, 0.03, 1.1), bevel=0.01), TR((x, sg * (S.W / 2 * 0.99), 2.55)), C_))
        for dx in (-5.0, 0.0, 5.0):
            for sg in (1, -1):
                p.append((g_box((1.3, 0.04, 2.2), bevel=0.02), TR((dx, sg * (S.W / 2 + 0.01), 2.0)), C_))
                p.append((g_box((0.5, 0.05, 1.0), bevel=0.01), TR((dx - 0.3, sg * (S.W / 2 + 0.02), 2.5)), G_))
                p.append((g_box((0.5, 0.05, 1.0), bevel=0.01), TR((dx + 0.3, sg * (S.W / 2 + 0.02), 2.5)), G_))
        for x in (-6.5, 6.5):
            p.append((g_box((2.6, 2.3, 0.7), bevel=0.05), TR((x, 0, 0.55)), T_))
        for sg in (1, -1):
            p.append((g_box((S.L * 0.98, 0.03, 0.16), bevel=0.0), TR((0, sg * (S.W / 2 + 0.01), 1.55)), L_))
        p.append((g_box((0.05, 1.8, 0.25), bevel=0.02), TR((S.L / 2 + 0.02, 0, 3.4)), A_))
    return build_car(name, S, ex)

def build_motorcycle(name="HD_VEH_moto"):
    for n in [o.name for o in bpy.data.objects if o.name.startswith(name)]: remove_obj(n)
    p = [(g_box((0.75, 0.32, 0.3), bevel=0.08, segs=3, taper=(0.8, 0.9)), TR((0.1, 0, 0.78)), B_),
         (g_box((0.6, 0.28, 0.1), bevel=0.04, segs=2), TR((-0.35, 0, 0.83)), I_),
         (g_box((0.5, 0.26, 0.2), bevel=0.06, segs=2), TR((-0.72, 0, 0.8), (0, -0.25, 0)), B_),
         (g_box((0.45, 0.3, 0.35), bevel=0.05), TR((0.05, 0, 0.48)), T_),
         (g_cyl(0.045, 0.9, 12), TR((-0.1, 0.16, 0.35), (0, math.pi / 2 + 0.2, 0)), C_),
         (g_cyl(0.03, 0.75, 10), TR((0.72, 0.1, 0.35), (0, -0.4, 0)), C_),
         (g_cyl(0.03, 0.75, 10), TR((0.72, -0.1, 0.35), (0, -0.4, 0)), C_),
         (g_cyl(0.022, 0.7, 10), TR((0.45, -0.35, 1.05), (math.pi / 2, 0, 0)), C_),
         (g_box((0.16, 0.2, 0.16), bevel=0.05), TR((0.62, 0, 0.98)), T_),
         (g_cyl(0.07, 0.04, 16), TR((0.7, 0, 0.98), (0, math.pi / 2, 0)), H_),
         (g_box((0.08, 0.14, 0.06), bevel=0.02), TR((-0.95, 0, 0.8)), L_)]
    for k in range(4):
        p.append((g_box((0.35, 0.34, 0.02), bevel=0.0), TR((0.05, 0, 0.36 + k * 0.07)), C_))
    for x in (0.75, -0.75):
        p.append((g_cyl(0.3, 0.12, 28, bevel=0.03), TR((x, 0.06, 0.32), (math.pi / 2, 0, 0)), TI_))
        p.append((g_cyl(0.2, 0.13, 24), TR((x, 0.065, 0.32), (math.pi / 2, 0, 0)), R_))
        p.append((g_cyl(0.13, 0.14, 20), TR((x, 0.07, 0.32), (math.pi / 2, 0, 0)), C_))
    return piece(name, p, VM)

def build_boat(name="HD_VEH_boat"):
    """Runabout: lofted V hull + cabin + windscreen + rails."""
    for n in [o.name for o in bpy.data.objects if o.name.startswith(name)]: remove_obj(n)
    bm = bmesh.new()
    L, W = 9.0, 3.0
    N = 40
    rings = []
    for i in range(N + 1):
        t = i / N
        x = -L / 2 + t * L
        hw = W / 2 * (1.0 if t < 0.6 else max(0.02, math.cos((t - 0.6) / 0.4 * math.pi / 2)) ** 0.7)
        keel = -0.6 + 0.5 * max(0.0, t - 0.7) / 0.3
        sheer = 1.0 + 0.4 * max(0.0, t - 0.6) / 0.4
        pts = _resample([(0.0, keel), (hw * 0.55, keel + 0.35), (hw * 0.95, 0.35), (hw, sheer)], 8)
        rings.append([bm.verts.new((x, -y, z)) for (y, z) in reversed(pts)] + [bm.verts.new((x, y, z)) for (y, z) in pts[1:]])
    for i in range(N):
        a, b = rings[i], rings[i + 1]
        for k in range(len(a) - 1):
            f = bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
            f.material_index = 2 if a[k].co.z < 0.3 else 0
        f = bm.faces.new((a[0], a[-1], b[-1], b[0])); f.material_index = 9
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmats = [M['white'], GLASS, BODYM, CHROME, HEAD, TAIL, AMBER, TIRE, RIM, M['wood']]
    hull = bm_to_obj(bm, name + "_hull", bmats)
    p = [(g_box((2.8, 2.2, 1.4), bevel=0.12, segs=3, taper=(0.85, 0.9)), TR((-0.8, 0, 1.7)), 0),
         (g_box((2.9, 2.3, 0.55), bevel=0.05, taper=(0.85, 0.9)), TR((-0.8, 0, 2.05)), 1),
         (g_box((0.1, 2.0, 0.6), bevel=0.02), TR((1.0, 0, 1.6), (0, -0.5, 0)), 1),
         (g_cyl(0.05, 1.2, 8), TR((-0.8, 0, 2.4)), 3), (g_sph(0.08, 8, 6), TR((-0.8, 0, 3.0)), 5)]
    for sg in (1, -1):
        p.append((g_cyl(0.025, L * 0.8, 8), TR((0.0, sg * (W / 2 - 0.08), 1.6), (0, math.pi / 2, 0)), 3))
    det = piece(name + "_det", p, bmats)
    return join([hull, det], name)

def build_drones():
    out = {}
    for n in [o.name for o in bpy.data.objects if o.name.startswith("HD_VEH_drone")]: remove_obj(n)
    mats = [M['slot_primary'], M['slot_accent'], M['visor_emit'], CHROME, TRIM]
    p = [(g_sph(0.32, 24, 14, (1.3, 1.0, 0.55)), TR((0, 0, 0)), 0),
         (g_box((0.5, 0.2, 0.06), bevel=0.02), TR((0.05, 0, 0.16)), 1),
         (g_sph(0.1, 16, 10), TR((0.38, 0, -0.03)), 2),
         (g_cyl(0.05, 0.25, 12), TR((0.2, 0, -0.26), (0, math.pi / 2, 0)), 4),
         (g_sph(0.035, 10, 8), TR((0.33, 0, -0.26)), 2)]
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, y = 0.55 * math.cos(a), 0.55 * math.sin(a)
        p.append((g_box((0.42, 0.06, 0.05), bevel=0.015), TR((x / 2, y / 2, 0.02), (0, 0, a)), 0))
        p.append((g_cyl(0.23, 0.08, 28, caps=False), TR((x, y, 0.05)), 0))
        p.append((g_cyl(0.2, 0.01, 20), TR((x, y, 0.06)), 4))
        p.append((g_cyl(0.03, 0.06, 10), TR((x, y, 0.04)), 3))
    out['sup'] = piece("HD_VEH_drone_sup", p, mats)
    p = [(g_box((1.6, 1.0, 0.5), bevel=0.14, segs=3), TR((0, 0, 0)), 0),
         (g_box((1.1, 0.8, 0.55), bevel=0.06), TR((0, 0, -0.55)), 1),
         (g_sph(0.14, 14, 10), TR((0.82, 0, 0)), 2)]
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, y = 1.25 * math.cos(a), 0.95 * math.sin(a)
        p.append((g_box((0.9, 0.1, 0.08), bevel=0.02), TR((x / 2, y / 2, 0.15), (0, 0, math.atan2(y, x))), 0))
        p.append((g_cyl(0.5, 0.12, 32, caps=False), TR((x, y, 0.2)), 0))
        p.append((g_cyl(0.46, 0.01, 24), TR((x, y, 0.22)), 4))
    out['carrier'] = piece("HD_VEH_drone_carrier", p, mats)
    return out

def build_all_vehicles():
    out = {}
    out['sedan'] = build_car("HD_VEH_sedan", spec_sedan())
    out['taxi'] = build_car("HD_VEH_taxi", spec_sedan(), taxi_extras)
    out['police'] = build_car("HD_VEH_police", spec_sedan(), police_extras)
    out['van'] = build_car("HD_VEH_van", spec_van(), van_extras)
    out['ambulance'] = build_car("HD_VEH_ambulance", spec_ambulance(), ambulance_extras)
    out['bus'] = build_bus()
    out['truck'] = build_truck()
    out['train'] = build_train_car()
    out['moto'] = build_motorcycle()
    out['boat'] = build_boat()
    out.update({('drone_' + k): v for k, v in build_drones().items()})
    out['wheel_car'] = wheel_asset("HD_VEH_wheel_car", 0.33, 0.23)
    out['wheel_van'] = wheel_asset("HD_VEH_wheel_van", 0.37, 0.25)
    out['wheel_big'] = wheel_asset("HD_VEH_wheel_big", 0.5, 0.32, truck=True)
    return out
