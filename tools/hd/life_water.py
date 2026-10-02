"""THREADLINE — waterfront kit + harbour boats for the life props (called from life_props.py: life_water.build(new_col)).

Game-frame builders (x east, y up, z south; boats: bow +Z, waterline y = 0, centred on the length; props: long axis Z, facing +X).
Each builder returns the collection name; life_export.export() writes them into life_models.{json,bin.gz}.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
import life_export as LX

M = {}


def mat(name, hexcol, rough=0.6, metal=0.0, emit=None, alpha=None):
    if name not in M: M[name] = LX.mat_flat(name, LX.srgb(hexcol), rough, metal, emit, alpha)
    return M[name]


class Parts:
    """geometry grouped by material; one object per material in the model's collection"""
    def __init__(self, col, name):
        self.col, self.name, self.bm = col, name, {}

    def b(self, m):
        if m.name not in self.bm: self.bm[m.name] = (bmesh.new(), m)
        return self.bm[m.name][0]

    def box(self, m, c, s, rot_y=0.0): LX.box_g(self.b(m), c, s, rot_y)
    def cyl(self, m, c, r, h, axis='y', seg=10, r2=None): LX.cyl_g(self.b(m), c, r, h, seg, axis, r2)
    def sph(self, m, c, r, seg=8): LX.sphere(self.b(m), LX.G(c), r, seg)

    def tri(self, m, a, b, c):
        bm = self.b(m)
        bm.faces.new([bm.verts.new(LX.G(p)) for p in (a, b, c)]); bm.faces.new([bm.verts.new(LX.G(p)) for p in (c, b, a)])      # two-sided

    def quad(self, m, a, b, c, d):
        bm = self.b(m)
        bm.faces.new([bm.verts.new(LX.G(p)) for p in (a, b, c, d)]); bm.faces.new([bm.verts.new(LX.G(p)) for p in (d, c, b, a)])

    def torus(self, m, c, R, r, axis='x', seg=16, rseg=6):
        """ring with its hole along the game axis"""
        bm = self.b(m)
        rows = []
        for i in range(seg):
            a = 2 * math.pi * i / seg; ca, sa = math.cos(a), math.sin(a)
            row = []
            for j in range(rseg):
                bb = 2 * math.pi * j / rseg; rr = R + r * math.cos(bb); hh = r * math.sin(bb)
                if axis == 'x': p = (c[0] + hh, c[1] + rr * ca, c[2] + rr * sa)
                elif axis == 'y': p = (c[0] + rr * ca, c[1] + hh, c[2] + rr * sa)
                else: p = (c[0] + rr * ca, c[1] + rr * sa, c[2] + hh)
                row.append(bm.verts.new(LX.G(p)))
            rows.append(row)
        for i in range(seg):
            for j in range(rseg):
                bm.faces.new((rows[i][j], rows[(i + 1) % seg][j], rows[(i + 1) % seg][(j + 1) % rseg], rows[i][(j + 1) % rseg]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    def done(self):
        for k, (bm, m) in self.bm.items():
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.002)          # shared vertices: smooth hulls average their normals, boxes keep hard edges
            LX.add_obj(self.name + '_' + k, bm, m, self.col)
        return self.name


# ------------------------------------------------------------------ hull
def hull(P, mats, L, B, D, fb, z0=0.0, bow=0.5, sheer=0.0, stern=0.22, n=26, tumble=0.0):
    """lofted displacement hull. mats = (topsides, bottom, deck). Sections run stern (-L/2) to bow (+L/2)."""
    bm = P.b(mats[0]); bmB = P.b(mats[1]); bmD = P.b(mats[2])
    # one bmesh per material would split shared vertices: build rings per material with their own verts (edges meet at the waterline)
    def wid(t):
        if t > bow: u = (t - bow) / (1 - bow); return B / 2 * (1 - u ** 2.3) ** 0.85
        u = (bow - t) / bow; return B / 2 * (1 - stern * u ** 4)
    def prof(t):
        w = max(wid(t), 0.03)
        draft = D * (1 - 0.55 * max(0, (t - 0.8) / 0.2) ** 2 - 0.25 * max(0, (0.12 - t) / 0.12) ** 2)
        top = fb + sheer * max(0, (t - 0.6) / 0.4) ** 2 + 0.3 * max(0, (0.12 - t) / 0.12)
        flare = 1.0 + 0.08 * max(0, (t - 0.65) / 0.35)
        return [(w * flare, top), (w, 0.0), (w * 0.8, -draft * 0.55), (w * 0.38, -draft * 0.92), (0.0, -draft)]
    secs = []
    for i in range(n + 1):
        t = i / n
        z = z0 - L / 2 + t * L
        secs.append((z, prof(t)))
    def ring(z, pr, side): return [(side * p[0], p[1], z) for p in pr]
    # topsides (deck edge -> waterline) on both sides
    def strip(bmx, idx_a, idx_b):
        for side in (-1, 1):
            for i in range(n):
                za, pa = secs[i]; zb, pb = secs[i + 1]
                a0 = (side * pa[idx_a][0], pa[idx_a][1], za); a1 = (side * pa[idx_b][0], pa[idx_b][1], za)
                b0 = (side * pb[idx_a][0], pb[idx_a][1], zb); b1 = (side * pb[idx_b][0], pb[idx_b][1], zb)
                vs = [bmx.verts.new(LX.G(p)) for p in (a0, b0, b1, a1)]
                f = bmx.faces.new(vs); f.smooth = True
    strip(bm, 0, 1)
    for k in range(1, 4): strip(bmB, k, k + 1)

    # keel line to keel on the centre (close the bottom): connect the two keel-side rings through the centre
    for side in (-1, 1):
        for i in range(n):
            za, pa = secs[i]; zb, pb = secs[i + 1]
            a0 = (side * pa[3][0], pa[3][1], za); a1 = (0.0, pa[4][1], za); b0 = (side * pb[3][0], pb[3][1], zb); b1 = (0.0, pb[4][1], zb)
            vs = [bmB.verts.new(LX.G(p)) for p in (a0, b0, b1, a1)]
            bmB.faces.new(vs).smooth = True
    # deck: flat strip between the two deck edges
    for i in range(n):
        za, pa = secs[i]; zb, pb = secs[i + 1]
        vs = [bmD.verts.new(LX.G(p)) for p in ((-pa[0][0], pa[0][1], za), (pa[0][0], pa[0][1], za), (pb[0][0], pb[0][1], zb), (-pb[0][0], pb[0][1], zb))]
        bmD.faces.new(vs)
    # transom
    z, pr = secs[0]
    pts = [(-pr[0][0], pr[0][1], z), (pr[0][0], pr[0][1], z), (pr[1][0], pr[1][1], z), (pr[2][0], pr[2][1], z), (pr[3][0], pr[3][1], z), (0, pr[4][1], z), (-pr[3][0], pr[3][1], z), (-pr[2][0], pr[2][1], z), (-pr[1][0], pr[1][1], z)]
    vs = [bm.verts.new(LX.G(p)) for p in pts]
    bm.faces.new(vs[::-1])
    # make sure every face looks outward: normals are fixed per bmesh below (done() calls recalc)
    for b in (bm, bmB, bmD): bmesh.ops.recalc_face_normals(b, faces=b.faces[:])
    return secs


def rails(P, m, hw_fn, z_a, z_b, y, h=0.95, step=1.4, posts=True):
    """deck-edge railing from z_a to z_b: posts every `step` m + two rails; hw_fn(z) = half width of the deck edge"""
    n = max(2, int(abs(z_b - z_a) / step))
    zs = np.linspace(z_a, z_b, n + 1)
    for side in (-1, 1):
        for i, z in enumerate(zs):
            x = side * (hw_fn(z) - 0.08)
            if posts: P.box(m, (x, y + h / 2, z), (0.04, h, 0.04))
            if i:
                z0 = zs[i - 1]; x0 = side * (hw_fn(z0) - 0.08)
                for yy in (h, h * 0.5):
                    xm, zm = (x + x0) / 2, (z + z0) / 2
                    ang = math.atan2(x - x0, z - z0)
                    P.box(m, (xm, y + yy, zm), (0.03, 0.03, math.hypot(x - x0, z - z0) + 0.02), ang)


def windows(P, m, x, y, z0, z1, h, n, side_w=0.05):
    """a row of dark window panes on a vertical face at x (both faces if x symmetric): panes between z0 and z1"""
    step = (z1 - z0) / n
    for i in range(n):
        zc = z0 + step * (i + 0.5)
        for s in (-1, 1): P.box(m, (s * x, y, zc), (side_w, h, step * 0.72))


# ------------------------------------------------------------------ props
def b_rail_iron(new_col):
    c = new_col('rail_iron'); P = Parts(c, 'rail_iron')
    iron = mat('wf_iron', 0x16181a, 0.5, 0.65)
    for z in (-1.0, 1.0):
        P.box(iron, (0, 0.57, z), (0.07, 1.14, 0.07)); P.sph(iron, (0, 1.17, z), 0.05, 6)
    P.box(iron, (0, 1.07, 0), (0.05, 0.05, 2.0)); P.box(iron, (0, 0.55, 0), (0.035, 0.035, 2.0)); P.box(iron, (0, 0.14, 0), (0.035, 0.035, 2.0))
    for k in range(15): P.cyl(iron, (0, 0.6, -0.9 + k * 0.128), 0.011, 0.95, 'y', 5)
    return P.done()


def b_rail_cable(new_col):
    c = new_col('rail_cable'); P = Parts(c, 'rail_cable')
    steel = mat('wf_steel', 0x9aa3a8, 0.35, 0.85); wood = mat('wf_timber', 0x6a4a30, 0.75)
    for z in (-1.0, 0.0, 1.0): P.box(steel, (0, 0.55, z), (0.06, 1.1, 0.06))
    for y in (0.3, 0.52, 0.74, 0.94): P.cyl(steel, (0, y, 0), 0.007, 2.0, 'z', 4)
    P.box(wood, (0, 1.13, 0), (0.12, 0.05, 2.04))
    return P.done()


def b_bollard(new_col):
    c = new_col('bollard'); P = Parts(c, 'bollard'); iron = mat('wf_iron', 0x16181a, 0.5, 0.65)
    P.cyl(iron, (0, 0.03, 0), 0.24, 0.06, 'y', 12); P.cyl(iron, (0, 0.24, 0), 0.12, 0.4, 'y', 12, 0.1); P.cyl(iron, (0, 0.46, 0), 0.17, 0.08, 'y', 12)
    return P.done()


def b_lamp(new_col):
    c = new_col('lamp'); P = Parts(c, 'lamp'); iron = mat('wf_lampiron', 0x1d2022, 0.45, 0.6)
    glow = mat('wf_lampglow', 0xfff0c0, 0.4, 0.0, emit=(1.0, 0.9, 0.62, 2.2))
    P.cyl(iron, (0, 0.35, 0), 0.2, 0.7, 'y', 10, 0.12); P.cyl(iron, (0, 2.5, 0), 0.055, 3.8, 'y', 8, 0.045)
    P.cyl(iron, (-0.4, 4.35, 0), 0.03, 0.9, 'x', 6); P.box(iron, (-0.85, 4.28, 0), (0.42, 0.05, 0.3)); P.box(glow, (-0.85, 4.18, 0), (0.34, 0.12, 0.22))
    P.sph(iron, (0, 4.45, 0), 0.07, 6)
    return P.done()


def b_ring(new_col):
    c = new_col('ring'); P = Parts(c, 'ring'); iron = mat('wf_lampiron', 0x1d2022, 0.45, 0.6)
    org = mat('wf_ringred', 0xd8531f, 0.6); wht = mat('wf_ringwhite', 0xf0eee8, 0.6)
    P.box(iron, (0, 0.6, 0), (0.07, 1.2, 0.07)); P.box(iron, (0.06, 1.05, 0), (0.12, 0.05, 0.09))
    P.torus(org, (0.12, 1.0, 0), 0.26, 0.055, 'x', 18, 6)
    for a in (0, 90, 180, 270):
        ang = math.radians(a); P.box(wht, (0.16, 1.0 + math.cos(ang) * 0.26, math.sin(ang) * 0.26), (0.03, 0.09, 0.09))
    return P.done()


def b_ladder(new_col):
    c = new_col('ladder'); P = Parts(c, 'ladder'); steel = mat('wf_galv', 0x8d9498, 0.4, 0.8)
    for z in (-0.22, 0.22): P.cyl(steel, (0.07, -1.1, z), 0.022, 3.4, 'y', 6)
    for k in range(11): P.cyl(steel, (0.07, -2.5 + k * 0.3, 0), 0.016, 0.44, 'z', 5)
    for z in (-0.22, 0.22):                                              # grab bars above the coping
        P.cyl(steel, (-0.02, 0.62, z), 0.022, 0.9, 'y', 6); P.cyl(steel, (0.03, 1.0, z), 0.022, 0.1, 'x', 6)
    return P.done()


def b_bench(new_col):
    c = new_col('wf_bench'); P = Parts(c, 'wf_bench'); iron = mat('wf_lampiron', 0x1d2022, 0.45, 0.6); wood = mat('wf_timber', 0x6a4a30, 0.75)
    for z in (-0.82, 0.82):
        P.box(iron, (0, 0.22, z), (0.5, 0.44, 0.06)); P.box(iron, (-0.24, 0.62, z), (0.05, 0.84, 0.06))
    for k in range(4): P.box(wood, (0.0 - 0.1 + k * 0.13 - 0.05, 0.46, 0), (0.1, 0.04, 1.8))
    for k in range(3): P.box(wood, (-0.26 - k * 0.03, 0.64 + k * 0.14, 0), (0.035, 0.11, 1.8))
    return P.done()


# ------------------------------------------------------------------ boats
def b_sailboat(new_col):
    c = new_col('sailboat'); P = Parts(c, 'sailboat'); L, B = 15.0, 4.6
    hw, hb, dk = mat('sb_white', 0xf4f4f0, 0.35), mat('sb_bottom', 0x233a52, 0.5), mat('sb_deck', 0xc9b48a, 0.7)
    hull(P, (hw, hb, dk), L, B, 1.9, 0.85, bow=0.55, sheer=0.35, stern=0.28)
    cab = mat('sb_cabin', 0xf8f8f4, 0.4); win = mat('sb_glass', 0x15202a, 0.15); sail = mat('sb_sail', 0xf2eedd, 0.8); alu = mat('sb_alu', 0xb0b8bd, 0.35, 0.8)
    P.box(cab, (0, 1.2, -0.8), (2.3, 0.7, 4.6)); P.box(win, (0, 1.32, -0.8), (2.34, 0.22, 3.2)); P.box(cab, (0, 1.58, -0.9), (2.0, 0.12, 4.2))
    P.cyl(alu, (0, 9.8, 1.2), 0.07, 18.5, 'y', 6)                                      # mast
    P.cyl(alu, (0, 2.0, -1.8), 0.05, 5.6, 'z', 6)                                      # boom
    P.tri(sail, (0, 1.9, 1.15), (0, 18.4, 1.1), (0.15, 2.0, -4.5)); P.tri(sail, (0, 1.9, 1.15), (0.15, 2.0, -4.5), (0.12, 3.0, -4.4))
    P.tri(sail, (0, 1.4, 7.2), (0, 16.0, 1.3), (0.1, 1.5, 1.6))                         # jib
    P.box(alu, (0, 1.05, -7.4), (0.05, 0.9, 0.05))                                      # backstay post
    return P.done()


def b_yacht(new_col):
    c = new_col('yacht'); P = Parts(c, 'yacht'); L, B = 22.0, 6.0
    hw, hb, dk = mat('y_white', 0xf6f6f2, 0.3), mat('y_bottom', 0x1c2a3e, 0.5), mat('y_deck', 0xd9cfae, 0.7)
    hull(P, (hw, hb, dk), L, B, 1.5, 1.35, bow=0.6, sheer=0.45, stern=0.18)
    win = mat('y_glass', 0x131c26, 0.12, 0.3); wh = mat('y_house', 0xfafaf7, 0.35)
    P.box(wh, (0, 2.1, -1.5), (4.4, 1.5, 10)); P.box(win, (0, 2.3, -1.5), (4.46, 0.55, 9.2)); P.box(wh, (0, 3.0, -1.5), (4.7, 0.14, 10.4))
    P.box(wh, (0, 3.7, -3.0), (3.2, 1.3, 5.0)); P.box(win, (0, 3.85, -3.0), (3.26, 0.5, 4.4)); P.box(wh, (0, 4.4, -3.0), (3.5, 0.12, 5.4))
    P.cyl(wh, (0, 5.6, -3.3), 0.06, 2.4, 'y', 6)
    rails(P, mat('y_rail', 0xcfd4d8, 0.3, 0.8), lambda z: 3.0 * max(0.2, 1 - ((z + 11) / 22) ** 3), -9.5, 8, 1.35, 0.7, 2.0)
    return P.done()


def b_taxi(new_col):
    c = new_col('taxi'); P = Parts(c, 'taxi'); L, B = 14.0, 4.2
    hy, hb, dk = mat('t_yellow', 0xf1b40e, 0.4), mat('t_bottom', 0x1b1d20, 0.5), mat('t_deck', 0x6d7276, 0.7)
    hull(P, (hy, hb, dk), L, B, 0.9, 0.9, bow=0.62, sheer=0.3, stern=0.1)
    win = mat('t_glass', 0x11181e, 0.12, 0.3)
    P.box(hy, (0, 1.9, -1.0), (3.4, 1.9, 6.4)); P.box(win, (0, 2.1, -1.0), (3.46, 0.85, 5.6)); P.box(win, (0, 2.1, 2.22), (2.8, 0.85, 0.06)); P.box(hy, (0, 3.0, -1.0), (3.6, 0.1, 6.6))
    P.box(mat('t_black', 0x15171a, 0.5), (0, 1.0, 6.6), (2.2, 0.6, 0.4))
    return P.done()


def b_tour(new_col):
    c = new_col('tour'); P = Parts(c, 'tour'); L, B = 30.0, 8.0
    hw, hb, dk = mat('to_white', 0xf4f5f4, 0.35), mat('to_bottom', 0x233f66, 0.5), mat('to_deck', 0xb7b2a6, 0.7)
    hull(P, (hw, hb, dk), L, B, 1.6, 1.6, bow=0.62, sheer=0.5, stern=0.14)
    win = mat('to_glass', 0x131c26, 0.12, 0.3); blue = mat('to_blue', 0x2a5ea8, 0.5); wh = hw
    P.box(wh, (0, 2.6, -1), (6.4, 2.0, 17)); windows(P, win, 3.22, 2.7, -8.8, 6.6, 0.95, 12); P.box(blue, (0, 1.9, -1), (6.5, 0.28, 17.1)); P.box(wh, (0, 3.7, -1), (6.8, 0.14, 17.4))
    P.box(wh, (0, 4.4, 5.0), (3.6, 1.4, 4.6)); P.box(win, (0, 4.6, 5.0), (3.66, 0.7, 4.0)); P.box(wh, (0, 5.2, 5.0), (3.9, 0.12, 5.0))
    for z in (-8.5, -2, 4.5):
        for s in (-1, 1): P.cyl(mat('to_post', 0xcfd4d8, 0.3, 0.8), (s * 3.1, 4.6, z), 0.04, 1.8, 'y', 5)
    rails(P, mat('to_rail', 0xcfd4d8, 0.3, 0.8), lambda z: 4.0 * max(0.25, 1 - ((z + 15) / 30) ** 3), -13, 12.5, 3.77, 0.9, 1.4)
    P.cyl(wh, (0, 7.0, 5.0), 0.07, 3.6, 'y', 6)
    return P.done()


def tug_parts(P, oz=0.0, name='tug'):
    L, B = 24.0, 8.0
    hr, hb, dk = mat('tg_red', 0xa3262a, 0.45), mat('tg_bottom', 0x16181a, 0.5), mat('tg_deck', 0x555a5e, 0.7)
    secs = hull(P, (hr, hb, dk), L, B, 2.4, 1.9, z0=oz, bow=0.6, sheer=0.55, stern=0.15)
    wh, win, blk = mat('tg_white', 0xf0f0ec, 0.4), mat('tg_glass', 0x11181e, 0.12, 0.3), mat('tg_black', 0x16181a, 0.5)
    P.box(wh, (0, 3.2, oz + 2.5), (5.6, 2.6, 9.0)); windows(P, win, 2.82, 3.4, oz - 1.5, oz + 6.3, 0.8, 5)
    P.box(wh, (0, 5.2, oz + 3.5), (4.4, 1.9, 5.0)); P.box(win, (0, 5.35, oz + 3.5), (4.46, 0.9, 4.4)); P.box(win, (0, 5.35, oz + 6.04), (3.8, 0.9, 0.06)); P.box(blk, (0, 6.3, oz + 3.5), (4.6, 0.14, 5.4))
    P.cyl(blk, (0, 6.0, oz - 0.8), 0.9, 3.4, 'y', 12, 0.75); P.cyl(hr, (0, 5.6, oz - 0.8), 0.93, 0.5, 'y', 12)
    for z in np.linspace(oz - 6, oz + 11, 9):                                     # tyre fenders
        for s in (-1, 1): P.cyl(blk, (s * (4.05), 1.4, z), 0.34, 0.45, 'x', 8)
    P.box(blk, (0, 2.1, oz - 9.5), (0.5, 0.9, 0.5))                                 # towing bitt
    return L


def b_tug(new_col):
    c = new_col('tug'); P = Parts(c, 'tug'); tug_parts(P); return P.done()


def barge_parts(P, oz=0.0, L=40.0, B=12.0):
    hb, hd, dk = mat('bg_hull', 0x3b3f44, 0.8), mat('bg_bottom', 0x1b1d20, 0.8), mat('bg_deck', 0x6b4a38, 0.8)
    hull(P, (hb, hd, dk), L, B, 1.4, 1.0, z0=oz, bow=0.9, sheer=0.0, stern=0.0, n=12)
    cont = [0x2f6e8c, 0x9a3b2c, 0x5a7a3a, 0xb8962e, 0x44484c, 0xc8c8c4]
    for i, z in enumerate((-8, 0, 8)):
        for j, x in enumerate((-2.6, 0.0, 2.6)):
            m = mat('bg_c%d' % ((i * 3 + j) % 6), cont[(i * 3 + j) % 6], 0.55)
            P.box(m, (x, 2.2, oz + z), (2.4, 2.6, 6.0))
            if (i + j) % 2 == 0: P.box(mat('bg_c%d' % ((i + 2 * j) % 6), cont[(i + 2 * j) % 6], 0.55), (x, 4.8, oz + z), (2.4, 2.6, 6.0))


def b_barge(new_col):
    c = new_col('barge'); P = Parts(c, 'barge'); barge_parts(P); return P.done()


def b_tug_tow(new_col):
    c = new_col('tug_tow'); P = Parts(c, 'tug_tow')
    tug_parts(P, oz=18.0); barge_parts(P, oz=-18.0, L=36.0, B=11.0)
    P.box(mat('tg_black', 0x16181a, 0.5), (0, 1.6, -0.8), (0.12, 0.12, 8.5))      # hawser
    return P.done()


def ferry_parts(P, L, B, tiers, colors, funnels=1, orange_hull=False):
    hw = mat('fy_top%d' % colors[0], colors[0], 0.4); hb = mat('fy_bottom', 0x1a1c1f, 0.5); dk = mat('fy_deck', 0x7b8084, 0.7)
    hull(P, (hw, hb, dk), L, B, 2.6, 2.0 if L < 50 else 2.8, bow=0.6, sheer=0.7, stern=0.14)
    wh, win, acc = mat('fy_white', 0xf4f4f1, 0.4), mat('fy_glass', 0x11181e, 0.12, 0.3), mat('fy_acc%d' % colors[1], colors[1], 0.45)
    y = 2.0 if L < 50 else 2.8
    zlen = L * 0.66
    for t in range(tiers):
        w = B * (0.9 - 0.12 * t)
        h = 2.0 if L < 50 else 2.6
        P.box(wh, (0, y + h / 2, -L * 0.04), (w, h, zlen - t * L * 0.08))
        windows(P, win, w / 2 + 0.03, y + h * 0.58, -L * 0.04 - (zlen - t * L * 0.08) / 2 + 1.0, -L * 0.04 + (zlen - t * L * 0.08) / 2 - 1.0, h * 0.42, int(zlen / 2.2))
        P.box(wh, (0, y + h + 0.06, -L * 0.04), (w + 0.2, 0.12, zlen - t * L * 0.08 + 0.3))
        y += h + 0.12
    P.box(acc, (0, 2.0 + (2.0 if L < 50 else 2.6) * 0.15, -L * 0.04), (B * 0.9 + 0.12, 0.3, zlen + 0.1))
    P.box(wh, (0, y + 0.8, L * 0.2), (B * 0.6, 1.6, 6.0)); P.box(win, (0, y + 1.0, L * 0.2), (B * 0.6 + 0.06, 0.8, 5.4)); P.box(win, (0, y + 1.0, L * 0.2 + 3.03), (B * 0.54, 0.8, 0.06)); P.box(mat('fy_roof', 0x4c5258, 0.5), (0, y + 1.65, L * 0.2), (B * 0.64, 0.12, 6.4))
    for k in range(funnels):
        fz = -L * 0.2 - k * L * 0.18
        P.cyl(acc, (0, y + 1.2, fz), B * 0.17, 2.8, 'y', 12, B * 0.15); P.cyl(mat('fy_black', 0x16181a, 0.5), (0, y + 2.75, fz), B * 0.17, 0.5, 'y', 12)
    return y


def b_ferry_nyw(new_col):
    c = new_col('ferry_nyw'); P = Parts(c, 'ferry_nyw'); ferry_parts(P, 36.0, 9.0, 2, (0xf1f1ee, 0x1f6aa8), 1)
    rails(P, mat('fy_rail', 0xcfd4d8, 0.3, 0.8), lambda z: 4.5 * max(0.25, 1 - ((z + 18) / 36) ** 3), -17, 16, 2.6, 0.9, 1.6)
    return P.done()


def b_ferry_si(new_col):
    c = new_col('ferry_si'); P = Parts(c, 'ferry_si'); ferry_parts(P, 78.0, 18.0, 3, (0xe8731a, 0xe8731a), 2)
    rails(P, mat('fy_rail', 0xcfd4d8, 0.3, 0.8), lambda z: 9.0 * max(0.25, 1 - ((z + 39) / 78) ** 3), -37, 36, 2.8, 1.0, 2.4)
    for z in np.linspace(-20, 14, 6):
        for s in (-1, 1): P.box(mat('fy_boat', 0xe8731a, 0.5), (s * 7.6, 6.2, z), (1.4, 1.2, 4.0))
    return P.done()


def b_tallship(new_col):
    c = new_col('tallship'); P = Parts(c, 'tallship'); L, B = 62.0, 11.0
    hb, hr, dk = mat('ts_hull', 0x17191c, 0.55), mat('ts_bottom', 0x6e1f1a, 0.6), mat('ts_deck', 0x8a6a40, 0.8)
    hull(P, (hb, hr, dk), L, B, 4.2, 3.6, bow=0.65, sheer=1.4, stern=0.22)
    band, wood, spar, sailm = mat('ts_band', 0xe9e4d4, 0.6), mat('ts_wood', 0x6b4a2c, 0.8), mat('ts_spar', 0x3d3326, 0.8), mat('ts_sail', 0xdad3bd, 0.9)
    wid = lambda z: 5.5 * max(0.05, 1 - ((z + 31) / 62 - 0.45) ** 2 * 3.0)
    for s in (-1, 1):                                                       # white gun-port band
        for k in range(14): P.box(band, (s * 5.45, 3.0, -24 + k * 3.4), (0.06, 0.55, 2.2))
    P.box(wood, (0, 3.2, -22), (7.5, 2.4, 9)); P.box(mat('ts_glass', 0x151b22, 0.15), (0, 3.6, -22), (7.56, 0.7, 7.6)); P.box(wood, (0, 4.5, -22), (8, 0.14, 9.6))     # poop deckhouse
    P.box(wood, (0, 3.0, 8), (5.0, 1.7, 5.0)); P.box(wood, (0, 3.0, -4), (4.5, 1.5, 4.0))
    for i, (z, hgt) in enumerate(((-17.0, 36.0), (-3.0, 41.0), (11.0, 42.0), (23.0, 33.0))):
        P.cyl(spar, (0, 4.0 + hgt / 2, z), 0.32, hgt, 'y', 8, 0.2)                    # mast
        for j in range(4):
            yy = 11.0 + j * (hgt - 14) / 3.2
            span = (15.5 - j * 2.2) * (0.85 if i == 3 else 1)
            P.cyl(spar, (0, yy, z + 0.4), 0.13, span, 'x', 6)                           # yard
            P.cyl(sailm, (0, yy - 0.5, z + 0.8), 0.46, span * 0.92, 'x', 8)             # furled sail
    P.cyl(spar, (0, 7.0, 36), 0.22, 13, 'z', 6)                                          # bowsprit pointing slightly up
    for z, hgt in ((-17.0, 36.0), (-3.0, 41.0), (11.0, 42.0), (23.0, 33.0)):
        for s in (-1, 1): P.box(spar, (s * 3.1, 4.0 + hgt * 0.38, z), (0.04, hgt * 0.7, 0.04), 0)
    return P.done()


def b_dock(new_col):
    """floating finger dock + gangway: starts at the quay face (x = 0), runs out along +X; deck 0.35 m above the waterline (y = -2.65 in the world)"""
    c = new_col('dock_finger'); P = Parts(c, 'dock_finger')
    wood, steel, tyre = mat('dk_deck', 0x56402a, 0.9), mat('dk_steel', 0x8d9498, 0.4, 0.8), mat('wf_tyre', 0x131416, 0.9)
    pile = mat('dk_pile', 0x4a3b2c, 0.9)
    top = -2.65 - 0.15                                                    # model y is relative to the deck-level instance at y = 0.15 : world = 0.15 + y
    P.box(wood, (8.5, top - 0.15, 0), (14.0, 0.3, 2.4))                   # floating deck x 1.5 .. 15.5
    for k in range(8): P.box(mat('dk_plank', 0x4a3622, 0.9), (2.1 + k * 1.75, top + 0.005, 0), (0.05, 0.01, 2.4))
    for z in (-1.22, 1.22):
        for x in np.linspace(2.0, 15.0, 9): P.cyl(tyre, (x, top - 0.1, z), 0.28, 0.4, 'z', 10)   # fender tyres
    for x in (3.5, 9.0, 15.2):
        for z in (-1.35, 1.35): P.cyl(pile, (x, top - 0.3, z), 0.16, 4.2, 'y', 8)                                  # guide piles
    P.box(steel, (-0.1, 0.5, 0), (0.1, 1.0, 0.1))
    # gangway: quay edge (x = 0, y = 0.15 -> model y 0) down to the deck, 5.6 m long, hand rails on both sides
    L = 5.6; drop = 0.0 - top
    LX.prism(P.b(steel), [(0.2, 0.0), (0.2 + L, -drop), (0.2 + L, -drop - 0.08), (0.2, -0.08)], -0.75, 0.75)
    for z in (-0.78, 0.78):
        for hgt in (0.55, 1.0): LX.prism(P.b(steel), [(0.2, hgt), (0.2 + L, -drop + hgt), (0.2 + L, -drop + hgt + 0.045), (0.2, hgt + 0.045)], -z - 0.02, -z + 0.02)
        for k in range(5):
            t0 = k / 4; P.cyl(steel, (0.2 + L * t0, -drop * t0 + 0.5, z), 0.022, 1.0, 'y', 5)
    return P.done()


def build(new_col):
    names = []
    for f in (b_rail_iron, b_rail_cable, b_dock, b_bollard, b_lamp, b_ring, b_ladder, b_bench, b_sailboat, b_yacht, b_taxi, b_tour, b_tug, b_barge, b_tug_tow, b_ferry_nyw, b_ferry_si, b_tallship):
        names.append(f(new_col))
    return names
