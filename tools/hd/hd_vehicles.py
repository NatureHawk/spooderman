# THREADLINE HD vehicles (vehicle-artist workflow): lofted bodies from profile curves, separate wheels,
# glass/lights/trim/interior. Run after bl_helpers, hd_char, hd_heroes.
# Convention: length along +X (front = +X), width Y, up Z, origin at ground center.
# Body paint = slot_body (tinted per instance at runtime).
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler

BODYM = M['slot_body']
GLASS = tl_mat('tl_car_glass', hexc('1d2a33'), rough=0.1)
TRIM = tl_mat('tl_car_trim', hexc('1a1b1d'))
CHROME = tl_mat('tl_car_chrome', hexc('b8bec4'), rough=0.2, metal=1.0)
HEAD = M['lamp_emit']
TAIL = M['red_emit']
AMBER = M['amberglow_emit']
TIRE = tl_mat('tl_tire', hexc('161617'))
RIM = tl_mat('tl_rim', hexc('9aa0a6'), rough=0.3, metal=0.9)
INT = tl_mat('tl_interior', hexc('2a2622'))
PLATE = tl_mat('tl_plate', hexc('e8e4d4'))
BLUE = M['blue_emit']
VM = [BODYM, GLASS, TRIM, CHROME, HEAD, TAIL, AMBER, TIRE, RIM, INT, PLATE, BLUE]
B_, G_, T_, C_, H_, L_, A_, TI_, R_, I_, P_, BL_ = range(12)

def lerp(a, b, t): return a + (b - a) * t

def interp(keys, x):
    """Piecewise smooth (cosine) interpolation over [(x, y), ...] sorted by x."""
    if x <= keys[0][0]: return keys[0][1]
    for i in range(len(keys) - 1):
        x0, y0 = keys[i]; x1, y1 = keys[i + 1]
        if x <= x1:
            t = (x - x0) / max(1e-9, x1 - x0)
            t = 0.5 - 0.5 * math.cos(t * math.pi)
            return lerp(y0, y1, t)
    return keys[-1][1]

def catmull(pts, n_per):
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n_per):
            t = k / n_per
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
                                    (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(pts[-1])
    return out

class CarSpec:
    """t-breakpoints along the length (0 = rear bumper, 1 = front bumper):
    t_deck: trunk-lid start, t_rw: rear-window base, t_r0/t_r1: roof, t_ws: windshield base (hood rear), t_nose: front bumper top."""
    def __init__(self, **k):
        self.__dict__.update(dict(L=4.6, W=1.84, clear=0.16, wheel_r=0.33, wb=2.75, front_oh=0.95,
                                  hood_z=0.92, deck_z=0.98, belt=0.98, roof=1.45,
                                  t_deck=0.05, t_rw=0.22, t_r0=0.36, t_r1=0.61, t_ws=0.77, t_bp=0.49,
                                  tumble=0.8, nose_round=0.55, tail_round=0.45, box=0.0))
        self.__dict__.update(k)

def _resample(pts, n):
    dense = catmull(pts, 6)
    seg = [0.0]
    for a, b in zip(dense[:-1], dense[1:]):
        seg.append(seg[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    tot = max(seg[-1], 1e-6)
    out = []; j = 0
    for k in range(n + 1):
        d = tot * k / n
        while j < len(seg) - 2 and seg[j + 1] < d: j += 1
        a, b = dense[j], dense[j + 1]
        f = (d - seg[j]) / max(1e-9, seg[j + 1] - seg[j])
        out.append((lerp(a[0], b[0], f), lerp(a[1], b[1], f)))
    return out

def loft_body(spec):
    """Car shell lofted from a side profile, plan rounding and a 3-region cross-section
    (lower body / greenhouse / roof) with fixed point counts, so window borders are clean iso-lines."""
    S = spec
    L, W = S.L, S.W
    x0 = -L / 2
    if S.box > 0:
        top = [(0.0, S.roof - 0.05), (0.02, S.roof), (S.t_r1, S.roof), (S.t_ws, S.hood_z + 0.05), (0.95, S.hood_z), (1.0, S.hood_z - 0.2)]
        t_r0 = 0.02; t_rw = 0.0
    else:
        top = [(0.0, S.deck_z - 0.14), (S.t_deck, S.deck_z), (S.t_rw, S.deck_z + 0.03), (S.t_r0, S.roof), (S.t_r1, S.roof),
               (S.t_ws, S.hood_z + 0.03), (0.95, S.hood_z - 0.03), (1.0, S.hood_z - 0.2)]
        t_r0, t_rw = S.t_r0, S.t_rw
    bot = S.clear
    def half_w(t):
        e = 1.0
        if t > 0.88: e = math.sqrt(max(0.0, 1 - ((t - 0.88) / 0.12) ** 2 * S.nose_round))
        if t < 0.1: e = math.sqrt(max(0.0, 1 - ((0.1 - t) / 0.1) ** 2 * S.tail_round))
        return W / 2 * max(0.55, e)
    # stations: dense, with exact breakpoints at every profile/pillar key
    brk = sorted(set([0.0, S.t_deck, t_rw, t_r0, S.t_bp - 0.012, S.t_bp + 0.012, S.t_r1, S.t_ws, 0.95, 1.0] +
                     ([t_r0 + 0.018, S.t_r1 - 0.018, t_rw + 0.012, S.t_ws - 0.012] if S.box <= 0 else [0.06, S.t_r1 - 0.018])))
    ts = []
    for a_, b_ in zip(brk[:-1], brk[1:]):
        n = max(1, int(round((b_ - a_) * 60)))
        for k in range(n): ts.append(a_ + (b_ - a_) * k / n)
    ts.append(1.0)
    N1, N2, N3 = 9, 6, 6
    bm = bmesh.new()
    grid = []
    for t in ts:
        x = x0 + t * L
        zt = interp(top, t)
        hw = half_w(t)
        belt = min(S.belt, zt - 0.03)
        cab = zt > belt + 0.1
        gw = S.tumble if cab else 0.97
        lower = _resample([(0.0, bot), (hw * 0.9, bot), (hw, bot + 0.12), (hw, lerp(bot, belt, 0.55)), (hw * 0.99, belt)], N1)
        if cab:
            gh = _resample([(hw * 0.99, belt), (hw * lerp(0.99, gw, 0.55), lerp(belt, zt, 0.5)), (hw * gw * 0.9, zt - 0.05)], N2)
            rf = _resample([(hw * gw * 0.9, zt - 0.05), (hw * gw * 0.6, zt - 0.005), (0.0, zt)], N3)
        else:
            gh = _resample([(hw * 0.99, belt), (hw * 0.97, lerp(belt, zt, 0.5)), (hw * 0.93, zt - 0.02)], N2)
            rf = _resample([(hw * 0.93, zt - 0.02), (hw * 0.6, zt), (0.0, zt + 0.004)], N3)
        sec = lower + gh[1:] + rf[1:]
        ring = [bm.verts.new((x, -y, z)) for (y, z) in reversed(sec)] + [bm.verts.new((x, y, z)) for (y, z) in sec[1:]]
        grid.append((ring, t, len(sec)))
    nsec = grid[0][2]
    g0, g1 = N1, N1 + N2            # greenhouse index band [g0, g1), roof band [g1, nsec-1)
    def region(k):
        kk = k - (nsec - 1) if k >= nsec - 1 else (nsec - 2 - k)   # mirrored index from center-bottom
        return kk
    for i in range(len(grid) - 1):
        ra, ta, n_ = grid[i]; rb, tb, _ = grid[i + 1]
        tm = (ta + tb) / 2
        for k in range(len(ra) - 1):
            f = bm.faces.new((ra[k], rb[k], rb[k + 1], ra[k + 1]))
            kk = region(k)
            f.material_index = B_
            if kk < 2:
                f.material_index = T_
            elif S.box <= 0:
                side_glass = g0 + 1 <= kk < g1 - 1 and (t_r0 + 0.018) < tm < (S.t_r1 - 0.018) and not (abs(tm - S.t_bp) < 0.012)
                ws = kk >= g0 + 2 and (S.t_r1) < tm < (S.t_ws - 0.012) and kk < nsec - 1
                rw = kk >= g0 + 2 and (t_rw + 0.012) < tm < t_r0 and kk < nsec - 1
                if side_glass or ws or rw:
                    f.material_index = G_
            else:
                side_glass = g0 + 1 <= kk < g1 - 1 and 0.06 < tm < (S.t_r1 - 0.018)
                ws = kk >= g0 + 2 and S.t_r1 < tm < S.t_ws and kk < nsec - 1
                if side_glass or ws:
                    f.material_index = G_
    for (ring, t, _n) in (grid[0], grid[-1]):
        c = Vector((sum(v.co.x for v in ring) / len(ring), 0, sum(v.co.z for v in ring) / len(ring)))
        cv = bm.verts.new(c)
        for k in range(len(ring) - 1):
            f = bm.faces.new((ring[k], ring[k + 1], cv) if t == 0 else (ring[k + 1], ring[k], cv))
            f.material_index = B_
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def cut_wheel_arches(bm, spec, xs):
    """Delete side faces inside the wheel arch circle; add dark wheel-well liners."""
    r = spec.wheel_r + 0.07
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        for wx in xs:
            if (c.x - wx) ** 2 + (c.z - spec.wheel_r) ** 2 < r * r and abs(c.y) > spec.W * 0.2:
                kill.append(f); break
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    for wx in xs:
        for sg in (1, -1):
            res = bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=r, radius2=r, depth=spec.W * 0.34,
                                        matrix=Matrix.Translation((wx, sg * (spec.W / 2 - spec.W * 0.17), spec.wheel_r)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4())
            vs = res['verts']
            dels = [v for v in vs if v.co.z < spec.wheel_r - 0.05]
            fs = list({f for v in vs for f in v.link_faces})
            for f in fs: f.material_index = T_
            bmesh.ops.delete(bm, geom=dels, context='VERTS')
            # flip liner normals inward
            live = [f for f in fs if f.is_valid]
            bmesh.ops.reverse_faces(bm, faces=live)

def wheel_asset(name, r=0.33, w=0.23, spokes=5, truck=False):
    """Tire (rounded profile lathe, tread grooves) + rim w/ spokes + hub + lugs + brake disc. Axis = Y."""
    bm = bmesh.new()
    seg = 36
    prof = []
    rr = r
    # tire cross-section (radius, y) loop
    for k in range(13):
        a = math.pi * k / 12
        prof.append((rr - 0.04 + 0.04 * math.sin(a), -w / 2 + w * (1 - math.cos(a)) / 2 * 1.0))
    rings = []
    for i in range(seg):
        ang = 2 * math.pi * i / seg
        groove = 0.006 if (i % 3 == 0) else 0.0
        ring = []
        for (pr, py) in prof:
            rad = pr - (groove if abs(py) < w * 0.35 and pr > rr - 0.01 else 0.0)
            ring.append(bm.verts.new((rad * math.cos(ang), py, rad * math.sin(ang))))
        rings.append(ring)
    for i in range(seg):
        a, b = rings[i], rings[(i + 1) % seg]
        for k in range(len(prof) - 1):
            f = bm.faces.new((a[k], b[k], b[k + 1], a[k + 1])); f.material_index = TI_
    # inner sidewall discs (close tire)
    for side in (0, len(prof) - 1):
        ring = [rings[i][side] for i in range(seg)]
        inner = []
        for v in ring:
            d = Vector((v.co.x, 0, v.co.z)).normalized()
            inner.append(bm.verts.new((d.x * (rr * 0.66), v.co.y, d.z * (rr * 0.66))))
        for i in range(seg):
            f = bm.faces.new((ring[i], ring[(i + 1) % seg], inner[(i + 1) % seg], inner[i]) if side == 0 else (ring[(i + 1) % seg], ring[i], inner[i], inner[(i + 1) % seg]))
            f.material_index = TI_
    ob = bm_to_obj(bm, name + "_tire", VM)
    rim_r = rr * 0.66
    # outward face = -Y. Open barrel, recessed spokes, brake disc + caliper visible behind the spokes.
    p = [(g_cyl(rim_r, w * 0.8, 36, caps=False), TR((0, 0.0, 0), (math.pi / 2, 0, 0)), R_),
         (g_cyl(rim_r * 1.02, 0.03, 36, caps=False), TR((0, -w * 0.4, 0), (math.pi / 2, 0, 0)), C_),
         (g_cyl(rim_r * 0.97, 0.01, 36), TR((0, w * 0.25, 0), (math.pi / 2, 0, 0)), T_),
         (g_cyl(rim_r * 0.78, 0.018, 32), TR((0, w * 0.05, 0), (math.pi / 2, 0, 0)), C_),
         (g_box((0.08, 0.05, 0.12), bevel=0.012), TR((0, w * 0.0, rim_r * 0.62)), L_ if truck else T_),
         (g_cyl(rim_r * 0.26, 0.06, 20, bevel=0.006), TR((0, -w * 0.33, 0), (math.pi / 2, 0, 0)), R_),
         (g_cyl(rim_r * 0.11, 0.03, 12), TR((0, -w * 0.38, 0), (math.pi / 2, 0, 0)), C_)]
    n = spokes if not truck else 8
    for k in range(n):
        a = 2 * math.pi * k / n
        c, s_ = math.cos(a), math.sin(a)
        p.append((g_box((0.045 if not truck else 0.03, 0.035, rim_r * 0.74), bevel=0.008), TR((c * rim_r * 0.56, -w * 0.34, s_ * rim_r * 0.56), (0, -a + math.pi / 2, 0)), R_))
        p.append((g_cyl(0.012, 0.03, 6), TR((math.cos(a + 0.6) * rim_r * 0.19, -w * 0.37, math.sin(a + 0.6) * rim_r * 0.19), (math.pi / 2, 0, 0)), C_))
    rim = piece(name + "_rim", p, VM)
    return join([ob, rim], name)

def lamp(parts, center, size, mi, rot=(0, 0, 0)):
    parts.append((g_box(size, bevel=min(size) * 0.3, segs=2), TR(center, rot), mi))

def mirror_part(parts, x, y, z, sg):
    parts.append((g_box((0.07, 0.05, 0.05), bevel=0.01), TR((x, sg * (y + 0.04), z)), T_))
    parts.append((g_box((0.1, 0.12, 0.09), bevel=0.02), TR((x - 0.03, sg * (y + 0.12), z + 0.02)), B_))
    parts.append((g_box((0.02, 0.1, 0.07), bevel=0.005), TR((x - 0.08, sg * (y + 0.12), z + 0.02)), C_))

def interior(parts, spec, x_front_seat, x_rear_seat=None):
    for sg in (1, -1):
        parts.append((g_box((0.5, 0.48, 0.12), bevel=0.03), TR((x_front_seat, sg * 0.38, 0.5)), I_))
        parts.append((g_box((0.12, 0.48, 0.6), bevel=0.03), TR((x_front_seat - 0.28, sg * 0.38, 0.8), (0, -0.2, 0)), I_))
        parts.append((g_box((0.1, 0.2, 0.14), bevel=0.02), TR((x_front_seat - 0.34, sg * 0.38, 1.15)), I_))
    if x_rear_seat is not None:
        parts.append((g_box((0.45, spec.W * 0.8, 0.14), bevel=0.03), TR((x_rear_seat, 0, 0.5)), I_))
        parts.append((g_box((0.12, spec.W * 0.8, 0.55), bevel=0.03), TR((x_rear_seat - 0.26, 0, 0.78), (0, -0.2, 0)), I_))
    parts.append((g_box((0.3, spec.W * 0.85, 0.25), bevel=0.04), TR((x_front_seat + 0.75, 0, 0.9)), I_))    # dashboard
    parts.append((g_cyl(0.18, 0.03, 20, bevel=0.005, caps=False), TR((x_front_seat + 0.5, 0.38, 1.0), (0, 1.1, 0)), T_))  # steering wheel

def build_car(name, spec, extras=None):
    for n in [o.name for o in bpy.data.objects if o.name.startswith(name)]:
        remove_obj(n)
    S = spec
    bm = loft_body(S)
    xf = S.L / 2 - S.front_oh
    xs = (xf, xf - S.wb)
    cut_wheel_arches(bm, S, xs)
    body = bm_to_obj(bm, name + "_shell", VM)
    p = []
    fx, rx = S.L / 2, -S.L / 2
    hl_z = S.hood_z - 0.16
    for sg in (1, -1):
        lamp(p, (fx - 0.1, sg * (S.W / 2 - 0.25), hl_z), (0.16, 0.42, 0.13), T_, (0, 0.25, sg * 0.18))
        lamp(p, (fx - 0.04, sg * (S.W / 2 - 0.25), hl_z), (0.08, 0.36, 0.09), H_, (0, 0.25, sg * 0.18))
        lamp(p, (fx - 0.12, sg * (S.W / 2 - 0.08), hl_z - 0.02), (0.1, 0.1, 0.07), A_, (0, 0, sg * 0.5))
        lamp(p, (rx + 0.06, sg * (S.W / 2 - 0.2), S.deck_z - 0.1), (0.1, 0.34, 0.12), L_, (0, -0.2, -sg * 0.15))
        mirror_part(p, -S.L / 2 + S.L * S.t_ws - 0.25, S.W / 2 * 0.95, S.belt + 0.06, sg)
        # door handles + side trim strip
        for dx in (0.25, -0.75):
            p.append((g_box((0.16, 0.03, 0.035), bevel=0.01), TR((dx, sg * (S.W / 2 + 0.005), S.belt - 0.08)), C_))
        xm = (xs[0] + xs[1]) / 2
        p.append((g_box((S.wb - 2 * S.wheel_r - 0.25, 0.03, 0.06), bevel=0.012), TR((xm, sg * (S.W / 2 - 0.005), S.clear + 0.2)), T_))
        if S.box <= 0:
            for xs_ in (-S.L / 2 + S.L * S.t_bp, -S.L / 2 + S.L * S.t_ws - 0.05, -S.L / 2 + S.L * S.t_r0 - 0.1):
                p.append((g_box((0.012, 0.012, S.belt - S.clear - 0.12), bevel=0.0), TR((xs_, sg * (S.W / 2 + 0.003), (S.belt + S.clear) / 2 + 0.02)), T_))
    # grille + bumpers + plates + exhaust
    p.append((g_box((0.08, S.W * 0.52, 0.2), bevel=0.02), TR((fx - 0.03, 0, hl_z - 0.06)), T_))
    for k in range(5):
        p.append((g_box((0.02, S.W * 0.5, 0.018), bevel=0.0), TR((fx + 0.005, 0, hl_z - 0.14 + k * 0.04)), C_))
    p.append((g_box((0.18, S.W * 0.98, 0.18), bevel=0.06, segs=3), TR((fx - 0.05, 0, S.clear + 0.12)), T_))
    p.append((g_box((0.18, S.W * 0.98, 0.18), bevel=0.06, segs=3), TR((rx + 0.05, 0, S.clear + 0.14)), T_))
    p.append((g_box((0.01, 0.42, 0.1), bevel=0.005), TR((fx + 0.045, 0, S.clear + 0.14)), P_))
    p.append((g_box((0.01, 0.42, 0.1), bevel=0.005), TR((rx - 0.045, 0, S.deck_z - 0.28)), P_))
    p.append((g_cyl(0.035, 0.15, 12), TR((rx - 0.02, 0.45, S.clear + 0.05), (0, -math.pi / 2, 0)), C_))
    interior(p, S, 0.05 if S.box <= 0 else S.L / 2 - S.front_oh - 0.8, -0.8 if S.box <= 0 else None)
    if extras: extras(p, S)
    details = piece(name + "_det", p, VM)
    car = join([body, details], name)
    for poly in car.data.polygons: poly.use_smooth = True
    car["tl_wheels"] = str([[x, S.W / 2 - 0.12, S.wheel_r] for x in xs])
    return car

# ------------------------------------------------------------------ vehicle catalog
def spec_sedan(): return CarSpec(L=4.7, W=1.84, wb=2.8, front_oh=0.95, hood_z=0.9, deck_z=0.97, belt=0.96, roof=1.45)
def spec_van(): return CarSpec(L=5.3, W=2.0, wb=3.3, front_oh=0.9, hood_z=1.05, belt=1.1, roof=2.25, box=1.0, t_r1=0.74, t_ws=0.86, wheel_r=0.36, clear=0.2, tumble=0.93)
def spec_ambulance(): return CarSpec(L=6.1, W=2.15, wb=3.6, front_oh=0.95, hood_z=1.1, belt=1.15, roof=2.6, box=1.0, t_r1=0.77, t_ws=0.88, wheel_r=0.38, clear=0.22, tumble=0.95)

def taxi_extras(p, S):
    p.append((g_box((0.5, 0.26, 0.2), bevel=0.05, segs=2, taper=(0.8, 0.9)), TR((-0.2, 0, S.roof + 0.1)), A_))
    p.append((g_box((0.6, 0.3, 0.04), bevel=0.01), TR((-0.2, 0, S.roof + 0.01)), T_))
    for sg in (1, -1):
        p.append((g_box((1.9, 0.012, 0.09), bevel=0.0), TR((0.05, sg * (S.W / 2 + 0.006), S.belt - 0.22)), T_))

def police_extras(p, S):
    p.append((g_box((0.3, 1.2, 0.08), bevel=0.02), TR((-0.1, 0, S.roof + 0.03)), T_))
    p.append((g_box((0.26, 0.5, 0.1), bevel=0.03), TR((-0.1, 0.3, S.roof + 0.1)), BL_))
    p.append((g_box((0.26, 0.5, 0.1), bevel=0.03), TR((-0.1, -0.3, S.roof + 0.1)), L_))
    p.append((g_box((0.3, 1.5, 0.3), bevel=0.05), TR((S.L / 2 + 0.05, 0, S.clear + 0.25)), T_))     # push bar
    for sg in (1, -1):
        p.append((g_box((2.2, 0.012, 0.32), bevel=0.0), TR((-0.1, sg * (S.W / 2 + 0.006), S.belt - 0.2)), P_))

def ambulance_extras(p, S):
    for sg in (1, -1):
        p.append((g_box((S.L * 0.6, 0.012, 0.22), bevel=0.0), TR((-0.6, sg * (S.W / 2 + 0.006), 1.2)), L_))
        p.append((g_box((0.12, 0.3, 0.12), bevel=0.03), TR((S.L / 2 - 1.4, sg * 0.55, S.roof + 0.06)), L_))
        p.append((g_box((0.12, 0.3, 0.12), bevel=0.03), TR((-S.L / 2 + 0.2, sg * 0.8, S.roof - 0.1)), L_))
    p.append((g_box((0.02, 1.4, 1.5), bevel=0.01), TR((-S.L / 2 - 0.01, 0, 1.4)), T_))                # rear doors seam panel
    p.append((g_box((0.012, 0.012, 1.4), bevel=0.0), TR((-S.L / 2 - 0.022, 0, 1.4)), C_))

def van_extras(p, S):
    for sg in (1, -1):
        p.append((g_box((1.2, 0.012, 1.25), bevel=0.0), TR((0.1, sg * (S.W / 2 + 0.006), 1.35)), T_ if sg < 0 else B_))
        p.append((g_box((0.02, 0.02, 1.2), bevel=0.0), TR((0.72, sg * (S.W / 2 + 0.008), 1.3)), T_))
    p.append((g_box((0.8, 1.6, 0.06), bevel=0.01), TR((-0.8, 0, S.roof + 0.03)), C_))                  # roof rack
    for x in (-1.1, -0.5):
        p.append((g_box((0.04, 1.7, 0.08), bevel=0.01), TR((x, 0, S.roof + 0.06)), C_))
