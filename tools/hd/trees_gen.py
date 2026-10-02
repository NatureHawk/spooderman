"""THREADLINE — procedural Lower Manhattan trees for the scan map (seed MAN).

Eight models of five species that actually line downtown streets and fill Battery Park:
  London plane (big park tree + pruned street tree), honey locust (vase + young), pin oak,
  American elm (tall vase), little-leaf linden (street tree + young).
Each model: a space-colonisation branch skeleton grown into a species crown envelope (clear bole,
scaffold limbs or a central leader, lumpy crown with gaps), pipe-model radii, a flared buttressed
trunk, tapered bark tubes and alpha-tested twig cards (photo leaves, tools/hd/trees_tex.py).
Per-vertex: ambient occlusion from a voxelised leaf-density field, wind weights (branch flex,
phase, leaf flutter) and 'crown normals' on the cards so the foliage lights as a volume.

LODs:  0 = full (<= ~12k tris)   1 = limbs + clump cards (~1.5k)   2 = trunk + a few clump cards (~150)

Writes into $TL_BUILD_DIR/extra (default build/extra):
  trees_models.bin.gz   geometry (layout in trees_models.json)
  trees_models.json     models, LODs, colliders, species -> textures
  trees_leaf.webp       leaf atlas (RGBA, 4x5 cells of 512)
  trees_bark_<sp>.webp / trees_barkn_<sp>.webp   bark albedo / normal (tiling)
Usage: python tools/hd/trees_gen.py [--preview DIR]
"""
import gzip, json, os, sys, time
import numpy as np
from scipy.spatial import cKDTree
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import trees_tex as TT

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
OUT = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
EXTRA = os.path.join(OUT, 'extra')


def log(*a):
    print('[trees]', *a, flush=True)


# ------------------------------------------------------------------ species models
# H height, R crown radius, bole clear trunk (m), rb trunk base radius, env crown envelope,
# limbs: scaffold limbs from the bole top (decurrent) or 0 = central leader (excurrent)
MODELS = [
    dict(name='plane_big', sp='plane', H=22.0, R=10.0, bole=3.6, rb=0.42, env='ellipsoid', cy=0.6, ry=0.4, limbs=3, limb_len=5.5, limb_up=0.55,
         pts=5200, di=4.5, dk=0.86, D=0.42, trop=0.1, holes=10, lump=0.3, lfreq=1.2, shell=0.25, sag=0.1, card=1.35, clump=1.9, cpc=15, seed=11),
    dict(name='plane_street', sp='plane', H=15.0, R=5.6, bole=3.4, rb=0.25, env='ellipsoid', cy=0.62, ry=0.38, limbs=2, limb_len=3.5, limb_up=0.72,
         pts=3000, di=3.6, dk=0.75, D=0.38, trop=0.18, holes=6, lump=0.26, lfreq=1.4, sag=0.06, card=1.15, clump=1.5, cpc=14, seed=12),
    dict(name='locust_vase', sp='locust', H=13.0, R=7.2, bole=2.6, rb=0.22, env='umbrella', cy=0.68, ry=0.32, limbs=4, limb_len=4.5, limb_up=0.6,
         pts=2400, di=4.0, dk=0.95, D=0.38, trop=0.03, holes=12, lump=0.34, lfreq=1.5, shell=0.45, sag=0.14, card=1.25, clump=1.6, cpc=9, spacing=1.25, seed=21),
    dict(name='locust_young', sp='locust', H=9.0, R=4.0, bole=2.3, rb=0.13, env='ellipsoid', cy=0.66, ry=0.34, limbs=3, limb_len=2.4, limb_up=0.66,
         pts=1600, di=3.2, dk=0.72, D=0.32, trop=0.1, holes=6, lump=0.3, lfreq=1.6, shell=0.3, sag=0.1, card=1.0, clump=1.2, cpc=9, spacing=1.2, seed=22),
    dict(name='oak_pin', sp='oak', H=18.0, R=6.2, bole=2.2, rb=0.3, env='cone', cy=0.5, ry=0.5, limbs=0, leader=0.93,
         pts=4000, di=3.8, dk=0.8, D=0.38, trop=-0.05, holes=7, lump=0.22, lfreq=1.6, sag=0.3, card=1.0, clump=1.3, cpc=14, seed=31),
    dict(name='elm_vase', sp='elm', H=21.0, R=10.5, bole=4.0, rb=0.38, env='vase', cy=0.7, ry=0.3, limbs=4, limb_len=8.0, limb_up=0.8,
         pts=4800, di=4.5, dk=0.86, D=0.42, trop=0.02, holes=10, lump=0.28, lfreq=1.3, shell=0.5, sag=0.16, card=1.25, clump=1.8, cpc=14, seed=41),
    dict(name='linden_street', sp='linden', H=11.5, R=4.4, bole=2.3, rb=0.19, env='ellipsoid', cy=0.56, ry=0.44, limbs=0, leader=0.88,
         pts=2600, di=3.2, dk=0.68, D=0.34, trop=0.1, holes=5, lump=0.22, lfreq=1.6, sag=0.08, card=0.95, clump=1.2, cpc=14, seed=51),
    dict(name='linden_young', sp='linden', H=7.5, R=3.1, bole=1.9, rb=0.11, env='ellipsoid', cy=0.58, ry=0.42, limbs=0, leader=0.85,
         pts=1600, di=2.7, dk=0.6, D=0.28, trop=0.12, holes=4, lump=0.2, lfreq=1.7, sag=0.06, card=0.8, clump=1.0, cpc=13, seed=52),
]
def variant(base, suffix, seed, **over):
    """a second / third individual of the same role: another seed (so another branch skeleton) and slightly different proportions"""
    m = dict(next(b for b in MODELS if b['name'] == base)); m.update(over); m['name'] = base + suffix; m['seed'] = seed
    return m


# life pass: individuals per role so a park does not read as clones (the layout still names the 8 base roles; 03c_trees.js picks a variant per tree)
MODELS += [
    variant('plane_big', '_v2', 15, H=23.5, R=10.8, limbs=4, limb_len=6.0, pts=5400, holes=12),
    variant('plane_big', '_v3', 16, H=20.5, R=9.2, limbs=3, limb_up=0.62, lump=0.34, pts=5000),
    variant('plane_street', '_v2', 17, H=16.0, R=6.0, limbs=3, limb_len=3.2, pts=3100),
    variant('locust_vase', '_v2', 24, H=14.0, R=7.8, limbs=3, limb_len=5.0, holes=14),
    variant('locust_young', '_v2', 25, H=9.6, R=4.4, limbs=4, limb_len=2.2),
    variant('oak_pin', '_v2', 33, H=19.5, R=6.6, leader=0.95, pts=4200),
    variant('elm_vase', '_v2', 43, H=20.0, R=9.6, limbs=3, limb_len=7.4, pts=4600),
    variant('linden_street', '_v2', 54, H=12.2, R=4.7, leader=0.9, pts=2700),
]
SPECIES = TT.SPECIES                        # atlas row order


# ------------------------------------------------------------------ crown envelope
def envelope_radius(m, y):
    """horizontal crown radius at height y (m), 0 outside the crown"""
    H, R = m['H'], m['R']
    y0 = m['bole'] + 0.4
    c = m['cy'] * H; ry = m['ry'] * H
    lo, hi = max(y0, c - ry), min(H, c + ry)
    if y < lo or y > hi: return 0.0
    t = (y - c) / ry                                        # -1..1
    if m['env'] == 'ellipsoid':
        return R * np.sqrt(max(0.0, 1 - t * t))
    if m['env'] == 'cone':                                  # pin oak: pyramidal with a rounded base, pointed top
        f = (y - lo) / (hi - lo)
        return R * min(1.0, 1.6 * np.sqrt(f)) * (1 - f) ** 0.85 * 1.25
    if m['env'] == 'vase':                                  # elm: narrow at the fork, spreading into an umbrella
        f = (y - lo) / (hi - lo)
        return R * (0.28 + 0.72 * np.sin(min(1.0, f * 1.25) * np.pi / 2) ** 1.2) * np.sqrt(max(0.0, 1 - max(0.0, (f - 0.72) / 0.28) ** 2))
    if m['env'] == 'umbrella':                              # honey locust: flat-topped, wide
        f = (y - lo) / (hi - lo)
        return R * (0.45 + 0.55 * np.sin(min(1.0, f * 1.6) * np.pi / 2)) * np.sqrt(max(0.0, 1 - max(0.0, (f - 0.6) / 0.4) ** 2))
    raise ValueError(m['env'])


def value_noise3(p, freq, seed):
    """smooth 3D value noise at points p (n,3) — cheap trilinear lattice noise"""
    rng = np.random.default_rng(seed)
    G = rng.random((17, 17, 17))
    q = p * freq + 8.0
    i = np.floor(q).astype(int); f = q - i
    f = f * f * (3 - 2 * f)
    i = np.clip(i, 0, 15)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out = out + w * G[i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz]
    return out


def sample_crown(m, rng):
    """attraction points: uniform in the lumpy envelope, minus a few spherical gaps (sky holes / clumps)"""
    H, R, n = m['H'], m['R'], m['pts']
    out = []
    holes = []
    for _ in range(m['holes']):
        y = rng.uniform(m['bole'] + 1, H * 0.95); rr = envelope_radius(m, y)
        a = rng.uniform(0, 2 * np.pi); d = rr * rng.uniform(0.45, 1.0)
        holes.append((np.array([np.cos(a) * d, y, np.sin(a) * d]), rng.uniform(0.18, 0.32) * R))
    ry = m['ry'] * H; cy = m['cy'] * H
    fq = m.get('lfreq', 1.3)
    while sum(len(o) for o in out) < n:
        p = rng.uniform([-R * 1.4, m['bole'], -R * 1.4], [R * 1.4, H * 1.08, R * 1.4], (n * 3, 3))
        n1 = value_noise3(p / max(R, 1), fq, m['seed']) - 0.5
        n2 = value_noise3(p / max(R, 1), fq * 0.8, m['seed'] + 7) - 0.5
        # lumpy in 3D: the horizontal radius and the height profile both wobble (lobes, bumps on top)
        yq = p[:, 1] - m['lump'] * ry * n2 * 1.6
        rr = np.array([envelope_radius(m, y) for y in yq])
        ok = np.hypot(p[:, 0], p[:, 2]) < rr * (1 + m['lump'] * n1 * 2)
        if m.get('shell'):                       # hollow crowns (vase / umbrella): leaves live on the outside
            q = (p - [0, cy, 0]) / [R, ry, R]
            ok &= np.linalg.norm(q, axis=1) > m['shell']
        for c, r in holes: ok &= np.linalg.norm(p - c, axis=1) > r
        out.append(p[ok])
    return np.concatenate(out)[:n]


# ------------------------------------------------------------------ skeleton (space colonisation)
class Skel:
    def __init__(self):
        self.P = []; self.par = []; self.grow = []; self.kind = []      # kind 0 trunk 1 limb 2 crown

    def add(self, p, parent, grow, kind):
        self.P.append(np.asarray(p, float)); self.par.append(parent); self.grow.append(grow); self.kind.append(kind)
        return len(self.P) - 1


def grow_skeleton(m, rng):
    H, R, D = m['H'], m['R'], m['D']
    S = Skel()
    # trunk: slight lean and wander
    lean = rng.normal(0, 0.035, 2)
    top = m['bole'] if m['limbs'] else m.get('leader', 0.85) * H
    n = max(3, int(np.ceil((top + 0.5) / D)))
    prev = -1
    wob = rng.normal(0, 1, (4, 2))
    for i in range(n + 1):
        y = -0.5 + (top + 0.5) * i / n
        f = y / H
        off = lean * y + 0.12 * np.array([np.sin(f * 5 + wob[0, 0]) * wob[1, 0], np.sin(f * 4 + wob[0, 1]) * wob[1, 1]]) * min(1, y / 3)
        prev = S.add([off[0], y, off[1]], prev, y > m['bole'] - 0.2 and not m['limbs'], 0)
    trunk_top = prev
    # scaffold limbs (decurrent species): arcs out from the bole top
    if m['limbs']:
        k = m['limbs']
        a0 = rng.uniform(0, 2 * np.pi)
        for j in range(k):
            a = a0 + 2 * np.pi * j / k + rng.normal(0, 0.25)
            up = m['limb_up'] + rng.normal(0, 0.06)
            d = np.array([np.cos(a) * np.sqrt(1 - up * up), up, np.sin(a) * np.sqrt(1 - up * up)])
            L = m['limb_len'] * rng.uniform(0.8, 1.15)
            p = S.P[trunk_top].copy(); prev = trunk_top
            steps = int(L / D)
            for s in range(steps):
                # limbs bend outward (vase) as they rise
                bend = np.array([np.cos(a), 0, np.sin(a)]) * 0.04 * (1 if m['env'] in ('vase', 'umbrella') else 0.5)
                d = d + bend + rng.normal(0, 0.03, 3); d /= np.linalg.norm(d)
                p = p + d * D
                prev = S.add(p, prev, s > steps * 0.4, 1)
    # colonise
    pts = sample_crown(m, rng)
    alive = np.ones(len(pts), bool)
    di, dk = m['di'], m['dk']
    trop = np.array([0, m['trop'], 0])
    nch = {}
    for it in range(400):
        P = np.array(S.P); G = np.array(S.grow)
        gi = np.nonzero(G)[0]
        if not len(gi) or not alive.any(): break
        tree = cKDTree(P[gi])
        ap = pts[alive]
        d, j = tree.query(ap, distance_upper_bound=di)
        ok = np.isfinite(d)
        if not ok.any(): break
        nodes = gi[j[ok]]
        v = ap[ok] - P[nodes]; v /= np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
        acc = {}
        for nd_, vv in zip(nodes, v): acc.setdefault(nd_, []).append(vv)
        new = []
        for nd_, vs in acc.items():
            if nch.get(nd_, 0) >= 3: continue
            dirv = np.mean(vs, 0)
            nrm = np.linalg.norm(dirv)
            if nrm < 1e-3: dirv = rng.normal(0, 1, 3); nrm = np.linalg.norm(dirv)
            dirv = dirv / nrm + trop + rng.normal(0, 0.12, 3)
            # continuation bias: keep some of the parent direction
            par = S.par[nd_]
            if par >= 0:
                pd = P[nd_] - P[par]; pd /= max(np.linalg.norm(pd), 1e-9)
                dirv = dirv + 0.35 * pd
            dirv /= np.linalg.norm(dirv)
            q = P[nd_] + dirv * D
            new.append((q, nd_))
        if not new: break
        added = []
        for q, nd_ in new:
            nch[nd_] = nch.get(nd_, 0) + 1
            added.append(S.add(q, nd_, True, 2))
        # kill reached attraction points
        nt = cKDTree(np.array([S.P[a] for a in added]))
        dd, _ = nt.query(pts, distance_upper_bound=dk)
        alive &= ~np.isfinite(dd)
    P = np.array(S.P); par = np.array(S.par); kind = np.array(S.kind)
    return P, par, kind


def structure(P, par):
    n = len(P)
    ch = [[] for _ in range(n)]
    for i in range(n):
        if par[i] >= 0: ch[par[i]].append(i)
    return ch


def radii(m, P, par, ch):
    """pipe model from tips (exponent solved so the trunk base hits the species radius)"""
    n = len(P)
    tips = np.zeros(n)
    for i in range(n - 1, -1, -1):           # children always have larger indices
        tips[i] = 1.0 if not ch[i] else sum(tips[c] for c in ch[i])
    r_tip = 0.011
    e = np.clip(np.log(tips[0]) / np.log(m['rb'] / r_tip), 1.9, 3.2)
    r = np.zeros(n)
    for i in range(n - 1, -1, -1):
        r[i] = r_tip if not ch[i] else sum(r[c] ** e for c in ch[i]) ** (1 / e)
    r *= m['rb'] / r[0]
    return np.maximum(r, 0.008), tips


def smooth(P, par, ch, it=3):
    P = P.copy()
    fixed = np.array([par[i] < 0 or len(ch[i]) == 0 for i in range(len(P))])
    for _ in range(it):
        Q = P.copy()
        for i in range(len(P)):
            if fixed[i] or len(ch[i]) == 0: continue
            main = max(ch[i], key=lambda c: len(ch[c]) + 1)
            Q[i] = 0.5 * P[i] + 0.25 * (P[par[i]] + P[main])
        P = Q
    return P


def chains(P, par, ch, r):
    """split the node tree into branches: each node continues into its thickest child"""
    out = []
    stack = [0]
    while stack:
        s = stack.pop()
        chain = [s] if par[s] < 0 else [par[s], s]
        cur = s
        while ch[cur]:
            kids = sorted(ch[cur], key=lambda c: -r[c])
            for k in kids[1:]: stack.append(k)
            cur = kids[0]; chain.append(cur)
        out.append(chain)
    return out


# ------------------------------------------------------------------ meshing
class Mesh:
    def __init__(self):
        self.P = []; self.N = []; self.UV = []; self.C = []; self.I = []; self.n = 0

    def verts(self, P, N, UV, C):
        o = self.n
        self.P.append(np.asarray(P, np.float32)); self.N.append(np.asarray(N, np.float32))
        self.UV.append(np.asarray(UV, np.float32)); self.C.append(np.asarray(C, np.float32))
        self.n += len(P)
        return o

    def tris(self, I):
        self.I.append(np.asarray(I, np.int64))

    def done(self):
        if not self.n: return None
        return dict(P=np.concatenate(self.P), N=np.concatenate(self.N), UV=np.concatenate(self.UV), C=np.concatenate(self.C), I=np.concatenate(self.I).reshape(-1))


def frames(pts):
    T = np.gradient(pts, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    N = np.zeros_like(T); B = np.zeros_like(T)
    a = np.array([1.0, 0, 0]) if abs(T[0, 0]) < 0.9 else np.array([0, 0, 1.0])
    n0 = np.cross(T[0], a); n0 /= np.linalg.norm(n0)
    N[0] = n0
    for i in range(1, len(pts)):
        v = np.cross(T[i - 1], T[i]); s = np.linalg.norm(v)
        if s < 1e-8: N[i] = N[i - 1]
        else:
            v /= s; ang = np.arccos(np.clip(np.dot(T[i - 1], T[i]), -1, 1))
            n = N[i - 1]
            N[i] = n * np.cos(ang) + np.cross(v, n) * np.sin(ang) + v * np.dot(v, n) * (1 - np.cos(ang))
        N[i] -= T[i] * np.dot(N[i], T[i]); N[i] /= max(np.linalg.norm(N[i]), 1e-9)
    B = np.cross(T, N)
    return T, N, B


def segs_for(r, lod):
    if lod == 0: return 14 if r > 0.3 else 10 if r > 0.16 else 7 if r > 0.07 else 5 if r > 0.035 else 3
    if lod == 1: return 8 if r > 0.2 else 6 if r > 0.09 else 4
    return 6 if r > 0.2 else 4


def tube(mesh, pts, rad, lod, attr, trunk=False, rng=None, vstart=0.0):
    """tapered generalised cylinder; attr(pts)-> per-ring (sway, phase) ; returns nothing"""
    pts = np.asarray(pts, float); rad = np.asarray(rad, float)
    if len(pts) < 2: return
    segs = segs_for(rad[min(1, len(rad) - 1)], lod)
    T, Nn, B = frames(pts)
    circ = 2 * np.pi * max(rad[min(1, len(rad) - 1)], 0.02)
    urep = max(1, int(round(circ / 0.9)))
    tile = max(circ / urep, 0.3)                             # bark tile edge (m): square texels on the trunk
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    th = np.linspace(0, 2 * np.pi, segs + 1)
    ring_P, ring_N, ring_UV = [], [], []
    lobes = rng.uniform(0, 2 * np.pi) if trunk else 0
    for i in range(len(pts)):
        r = rad[i]
        cs, sn = np.cos(th), np.sin(th)
        rr = np.full(segs + 1, r)
        if trunk:
            y = pts[i, 1]
            fl = np.exp(-max(y, 0) / 0.45)
            rr = r * (1 + 0.75 * fl) * (1 + 0.16 * fl * np.sin(5 * th + lobes) + 0.06 * np.sin(3 * th + 2 * lobes) * np.exp(-max(y, 0) / 2.5))
        d = cs[:, None] * Nn[i] + sn[:, None] * B[i]
        ring_P.append(pts[i] + d * rr[:, None]); ring_N.append(d)
        ring_UV.append(np.stack([th / (2 * np.pi) * urep, np.full(segs + 1, vstart + L[i] / tile)], 1))
    sw, ph = attr(pts)
    Pv = np.concatenate(ring_P); Nv = np.concatenate(ring_N); UVv = np.concatenate(ring_UV)
    Cv = np.zeros((len(Pv), 4), np.float32)
    Cv[:, 1] = np.repeat(sw, segs + 1); Cv[:, 2] = np.repeat(ph, segs + 1)
    o = mesh.verts(Pv, Nv, UVv, Cv)
    I = []
    for i in range(len(pts) - 1):
        a = o + i * (segs + 1); b = a + segs + 1
        for k in range(segs):
            I += [a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1]
    # cap the tip with a short cone
    tipP = pts[-1] + T[-1] * rad[-1] * 1.5
    t = mesh.verts([tipP], [T[-1]], [[0.5 * urep, vstart + (L[-1] + rad[-1]) / tile]], [[0, sw[-1], ph[-1], 0]])
    a = o + (len(pts) - 1) * (segs + 1)
    for k in range(segs): I += [a + k, t, a + k + 1]
    mesh.tris(I)


# ------------------------------------------------------------------ the model
def build_model(m):
    t0 = time.time()
    rng = np.random.default_rng(m['seed'])
    P, par, kind = grow_skeleton(m, rng)
    ch = structure(P, par)
    P = smooth(P, par, ch)
    # branch sag: outer parts of the lower crown bend down (weight), tips arch
    if m.get('sag'):
        hd = np.hypot(P[:, 0], P[:, 2])
        wy = np.clip(1 - (P[:, 1] - m['bole']) / max(1.0, m['H'] - m['bole']), 0, 1) ** 1.2
        dy = m['sag'] * m['R'] * (hd / m['R']) ** 2 * (0.3 + 0.7 * wy)
        dy[kind == 0] = 0
        P[:, 1] -= dy
    r, tips = radii(m, P, par, ch)
    CH = chains(P, par, ch, r)
    log('%s: %d nodes, %d tips, %d chains, %.1fs' % (m['name'], len(P), int(tips[0]), len(CH), time.time() - t0))
    H, R = m['H'], m['R']
    # per-node wind: flexibility grows away from the trunk and with thinness; phase per chain
    chain_of = np.zeros(len(P), int)
    for ci, c in enumerate(CH):
        for k in c[1:] if par[c[0]] >= 0 and len(c) > 1 else c: chain_of[k] = ci
    cphase = rng.random(len(CH))
    flex = np.clip(1 - r / 0.16, 0, 1) ** 1.4 * 0.75 + 0.25 * np.clip(np.hypot(P[:, 0], P[:, 2]) / R, 0, 1)
    flex[kind == 0] = 0
    node_phase = cphase[chain_of]

    # ---- foliage clusters: billowy leaf masses at the branch ends (greedy spacing, tips and outer twigs first)
    cc = np.array([0, m['cy'] * H, 0])
    ell = np.array([R, m['ry'] * H, R])
    rc, cpc = m['clump'], m['cpc']
    cand = np.nonzero((r < 0.035) & (P[:, 1] > m['bole'] + 0.4))[0]
    tipf = np.array([len(ch[i]) == 0 for i in cand], float)
    dout = np.linalg.norm((P[cand] - cc) / ell, axis=1)
    order = cand[np.argsort(-(tipf * 0.6 + dout + rng.random(len(cand)) * 0.35))]
    centres = []
    spc = rc * m.get('spacing', 1.05)
    for nd_ in order:
        p = P[nd_]
        if centres and np.min(np.linalg.norm(P[centres] - p, axis=1)) < spc: continue
        centres.append(nd_)
    centres = np.array(centres)
    cards, clusters = [], []
    droop = {'plane': -0.3, 'linden': -0.25, 'locust': -0.2, 'oak': 0.0, 'elm': -0.1}[m['sp']]
    for nd_ in centres:
        core = P[nd_].copy()
        o = (core - cc) / ell; o /= max(np.linalg.norm(o), 1e-9)
        bd = P[nd_] - P[par[nd_]]; bd /= max(np.linalg.norm(bd), 1e-9)
        ax = o * 0.65 + bd * 0.35 + np.array([0, 0.15, 0]); ax /= np.linalg.norm(ax)
        core = core + ax * rc * 0.15
        clusters.append((core, ax, nd_))
        for k in range(cpc):
            d = rng.normal(0, 1, 3); d /= np.linalg.norm(d); d = d + ax * 0.9; d /= np.linalg.norm(d)
            attach = core + d * rc * rng.uniform(0.0, 0.45) - ax * rc * 0.25
            up = d + rng.normal(0, 0.25, 3) + np.array([0, droop, 0]); up /= np.linalg.norm(up)
            size = m['card'] * rng.uniform(0.85, 1.15)
            cards.append((attach, up, rng.uniform(0, np.pi), size, int(rng.integers(3)), nd_, core))
    log('  %d foliage clusters, %d cards' % (len(clusters), len(cards)))

    # ---- AO density field from the cards
    lo = np.array([-R * 1.6, -1.0, -R * 1.6]); hi = np.array([R * 1.6, H + 2, R * 1.6]); vs = 0.6
    dims = np.ceil((hi - lo) / vs).astype(int)
    dens = np.zeros(dims)
    cp = np.array([c[0] + c[1] * c[3] * 0.5 for c in cards]); ca = np.array([c[3] ** 2 * 0.45 for c in cards])
    ci_ = np.clip(((cp - lo) / vs).astype(int), 0, dims - 1)
    np.add.at(dens, (ci_[:, 0], ci_[:, 1], ci_[:, 2]), ca)
    from scipy.ndimage import gaussian_filter
    dens = gaussian_filter(dens / vs ** 3, 0.8)            # leaf area density (m^2/m^3)

    def ao_at(X):
        dirs = []
        g = np.random.default_rng(5)
        for i in range(14):
            v = g.normal(0, 1, 3); v[1] = abs(v[1]) + 0.25; dirs.append(v / np.linalg.norm(v))
        acc = np.zeros(len(X))
        for d in dirs:
            od = np.zeros(len(X))
            for s in range(1, 22):
                q = X + d * (s * 0.55)
                qi = ((q - lo) / vs).astype(int)
                ok = np.all((qi >= 0) & (qi < dims), axis=1)
                v = np.zeros(len(X)); qi = np.clip(qi, 0, dims - 1)
                v[ok] = dens[qi[ok, 0], qi[ok, 1], qi[ok, 2]]
                od += v * 0.55 * 0.5                         # G-function ~0.5 for random leaf angles
            acc += np.exp(-od) * max(d[1], 0.2)
        a = acc / sum(max(d[1], 0.2) for d in dirs)
        return np.clip(a, 0, 1)

    lods = []
    for lod in range(3):
        bark, leaf = Mesh(), Mesh()
        rmin = [0.035, 0.07, min(0.16, m['rb'] * 0.55)][lod]
        stride = [2, 3, 5][lod]
        for c in CH:
            base_r = r[c[1]] if len(c) > 1 and par[c[0]] >= 0 else r[c[0]]
            if base_r < rmin: continue
            idx = [c[0]] + [q for q in c[1:] if r[q] >= rmin]
            if len(idx) < 2: continue
            # subsample thin branches
            keep = [idx[0]] + [q for j, q in enumerate(idx[1:-1]) if (j % (stride if r[q] < 0.12 else max(1, stride // 2))) == 0 or r[q] > 0.25 and lod == 0] + [idx[-1]]
            keep = list(dict.fromkeys(keep))
            if len(keep) < 2: continue
            pts = P[keep]; rad = r[keep].copy()
            is_trunk = kind[c[0]] == 0 and par[c[0]] < 0
            if par[c[0]] >= 0: rad[0] = rad[1]          # child starts inside the parent at its own radius
            def attr(pp, keep=keep):
                return flex[keep], node_phase[keep]
            tube(bark, pts, rad, lod, attr, trunk=is_trunk, rng=rng)
        # leaves
        row = SPECIES.index(m['sp'])
        if lod == 0:
            for (p, up, rot, size, cell, nd_, core) in cards:
                card(leaf, p, up, rot, size, row, cell, flex[nd_], node_phase[nd_], rng, core, cc, ell, fold=0.0)
        elif lod == 1:
            for (core, ax, nd_) in clusters:
                size = (rc * 0.55 + m['card']) * 2.0
                clump_card(leaf, core, ax, rng.uniform(0, 2 * np.pi), size, row, flex[nd_], node_phase[nd_], rng, cc, ell)
        else:
            cp2 = np.array([c[0] for c in clusters])
            K = max(16, len(clusters) // 5)
            cl = kmeans(cp2, K, rng)
            for c_ in range(K):
                mem = cp2[cl == c_]
                if not len(mem): continue
                ctr = mem.mean(0)
                spread = np.sqrt(((mem - ctr) ** 2).sum(1).mean()) if len(mem) > 1 else rc
                size = 1.5 * spread + (rc * 0.55 + m['card']) * 2.0
                o = (ctr - cc) / ell; o /= max(np.linalg.norm(o), 1e-9)
                nd_ = clusters[int(np.argmin(np.linalg.norm(cp2 - ctr, axis=1)))][2]
                clump_card(leaf, ctr, o, rng.uniform(0, 2 * np.pi), size, row, flex[nd_], node_phase[nd_], rng, cc, ell)
        B, Lf = bark.done(), leaf.done()
        # crown normals + AO
        for part, isleaf in ((B, False), (Lf, True)):
            if part is None: continue
            X = part['P']
            part['C'][:, 0] = ao_at(X) if lod < 2 else ao_at(X) * 0.9 + 0.1
        lods.append((B, Lf))
        log('  lod%d: bark %d tris, leaves %d tris' % (lod, len(B['I']) // 3 if B else 0, len(Lf['I']) // 3 if Lf else 0))
    # colliders: trunk up to the first fork
    tr = [i for i in range(len(P)) if kind[i] == 0]
    top = P[tr[-1]]
    col = dict(r=round(float(r[int(np.searchsorted(P[tr, 1], 1.2))]), 3), h=round(float(top[1]), 2), x=round(float(top[0]) / 2, 3), z=round(float(top[2]) / 2, 3))
    return dict(lods=lods, col=col, cards=len(cards))


def foliage_normals(V, Nc, core, cc, ell, wc=0.45, wg=0.4):
    """blend the card normal with the leaf-cluster normal and the crown (ellipsoid) normal: foliage shades as a volume"""
    V = np.asarray(V, float)
    nc = V - core; nc /= np.maximum(np.linalg.norm(nc, axis=1, keepdims=True), 1e-9)
    ng = (V - cc) / ell ** 2; ng /= np.maximum(np.linalg.norm(ng, axis=1, keepdims=True), 1e-9)
    n = np.asarray(Nc, float) * (1 - wc - wg) + nc * wc + ng * wg
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)


def card(mesh, p, up, rot, size, row, cell, sway, phase, rng, core, cc, ell, fold=0.4):
    """folded twig card: attached at its bottom centre, growing along `up`"""
    a = np.array([1.0, 0, 0]) if abs(up[0]) < 0.9 else np.array([0, 0, 1.0])
    s = np.cross(up, a); s /= np.linalg.norm(s); t = np.cross(up, s)
    side = s * np.cos(rot) + t * np.sin(rot)
    nrm = np.cross(side, up)
    if nrm[1] < -0.2: side, nrm = -side, -nrm
    h, w = size, size
    # fold: both halves tilt back along the normal
    sl = (-side * np.cos(fold) + nrm * np.sin(fold)) * w / 2
    sr = (side * np.cos(fold) + nrm * np.sin(fold)) * w / 2
    P0 = p; P1 = p + up * h
    V = [P0, P1, P0 + sl, P1 + sl, P0 + sr, P1 + sr]
    u0, v0 = cell / 4.0, 1 - (row + 1) / 5.0
    du, dv = 1 / 4.0, 1 / 5.0
    UV = [[u0 + du * 0.5, v0], [u0 + du * 0.5, v0 + dv], [u0, v0], [u0, v0 + dv], [u0 + du, v0], [u0 + du, v0 + dv]]
    nl = np.cross(up, sl); nl /= max(np.linalg.norm(nl), 1e-9)
    nr = np.cross(sr, up); nr /= max(np.linalg.norm(nr), 1e-9)
    if np.dot(nl, nrm) < 0: nl = -nl
    if np.dot(nr, nrm) < 0: nr = -nr
    ph = (phase + rng.random() * 0.15) % 1
    if fold == 0:
        V, UV = V[2:], UV[2:]
        N = foliage_normals(V, [nrm] * 4, core, cc, ell)
        C = [[0, sway, ph, f] for f in (0.3, 1.0, 0.3, 1.0)]
        o = mesh.verts(V, N, UV, C)
        mesh.tris([o, o + 2, o + 1, o + 1, o + 2, o + 3])
        return
    N = foliage_normals(V, [nrm, nrm, nl, nl, nr, nr], core, cc, ell)
    fl = [0.0, 1.0, 0.3, 1.0, 0.3, 1.0]
    C = [[0, sway, ph, f] for f in fl]
    o = mesh.verts(V, N, UV, C)
    mesh.tris([o, o + 2, o + 1, o + 1, o + 2, o + 3, o, o + 1, o + 4, o + 1, o + 5, o + 4])


def clump_card(mesh, c, out, rot, size, row, sway, phase, rng, cc, ell):
    """centred clump card facing outward from the crown (slightly folded)"""
    n = out + rng.normal(0, 0.35, 3); n /= np.linalg.norm(n)
    a = np.array([0, 1.0, 0]) if abs(n[1]) < 0.9 else np.array([1.0, 0, 0])
    s = np.cross(a, n); s /= np.linalg.norm(s); t = np.cross(n, s)
    u = s * np.cos(rot) + t * np.sin(rot); v = np.cross(n, u)
    h = size / 2; f = 0.3
    ul = (-u * np.cos(f) - n * np.sin(f)) * h; ur = (u * np.cos(f) - n * np.sin(f)) * h
    V = [c - v * h, c + v * h, c + ul - v * h, c + ul + v * h, c + ur - v * h, c + ur + v * h]
    u0, v0 = 3 / 4.0, 1 - (row + 1) / 5.0
    du, dv = 1 / 4.0, 1 / 5.0
    UV = [[u0 + du * 0.5, v0], [u0 + du * 0.5, v0 + dv], [u0, v0], [u0, v0 + dv], [u0 + du, v0], [u0 + du, v0 + dv]]
    N = foliage_normals(V, [n] * 6, c - out * size * 0.3, cc, ell, 0.35, 0.45)
    C = [[0, sway, phase, 0.5]] * 6
    o = mesh.verts(V, N, UV, C)
    mesh.tris([o, o + 2, o + 1, o + 1, o + 2, o + 3, o, o + 1, o + 4, o + 1, o + 5, o + 4])


def kmeans(X, K, rng, it=12):
    C = X[rng.choice(len(X), K, replace=False)]
    for _ in range(it):
        lab = cKDTree(C).query(X)[1]
        for k in range(K):
            m = lab == k
            if m.any(): C[k] = X[m].mean(0)
    return cKDTree(C).query(X)[1]


# ------------------------------------------------------------------ export
def pack(models):
    """-> bytes, json. Per part: pos i16x3 (mm) | nrm i8x4 | uv i16x2 (1/2048) | col u8x4 | idx u16/u32"""
    parts, off = [], 0

    def put(a):
        nonlocal off
        b = a.tobytes(); pad = (-len(b)) % 4
        parts.append(b + b'\0' * pad); o = off; off += len(b) + pad; return o

    meta = []
    for m, res in models:
        ent = dict(name=m['name'], sp=m['sp'], H=m['H'], R=m['R'], bole=m['bole'], cy=m['cy'], ry=m['ry'], col=res['col'], lods=[])
        for (B, L) in res['lods']:
            lod = {}
            for key, part in (('bark', B), ('leaf', L)):
                if part is None: continue
                P = np.round(part['P'] * 1000).astype(np.int16)
                assert np.abs(part['P']).max() < 32.0
                N = np.zeros((len(P), 4), np.int8); N[:, :3] = np.round(np.clip(part['N'], -1, 1) * 127)
                us = 65535 if key == 'leaf' else 1024
                UV = np.round(part['UV'] * us).astype(np.int64)
                assert UV.min() >= 0 and UV.max() <= 65535, ('uv range', UV.min(), UV.max())
                C = np.round(np.clip(part['C'], 0, 1) * 255).astype(np.uint8)
                I = part['I'].astype(np.uint16 if len(P) < 65536 else np.uint32)
                lod[key] = dict(n=int(len(P)), i=int(len(I)), i32=int(I.dtype == np.uint32), pos=put(P), nrm=put(N), uv=put(UV.astype(np.uint16)), col=put(C), idx=put(I))
            ent['lods'].append(lod)
        meta.append(ent)
    return b''.join(parts), meta


def main():
    preview = None
    if '--preview' in sys.argv: preview = sys.argv[sys.argv.index('--preview') + 1]
    os.makedirs(EXTRA, exist_ok=True)
    only = [a for a in sys.argv[1:] if not a.startswith('--') and a != preview]
    t = time.time()
    res = [(m, build_model(m)) for m in MODELS if not only or m['name'] in only]
    blob, meta = pack(res)
    with gzip.open(os.path.join(EXTRA, 'trees_models.bin.gz'), 'wb', compresslevel=9) as f: f.write(blob)
    if not only or not os.path.exists(os.path.join(EXTRA, 'trees_leaf.webp')) or '--tex' in sys.argv:
        atlas = TT.build_atlas()
        Image.fromarray(atlas, 'RGBA').save(os.path.join(EXTRA, 'trees_leaf.webp'), 'WEBP', quality=88, method=6)
        for sp, (d, n) in TT.bark_maps().items():
            Image.fromarray(d).save(os.path.join(EXTRA, 'trees_bark_%s.webp' % sp), 'WEBP', quality=85, method=6)
            Image.fromarray(n).save(os.path.join(EXTRA, 'trees_barkn_%s.webp' % sp), 'WEBP', quality=90, method=6)
    J = dict(v=1, species=SPECIES, atlas=dict(file='trees_leaf.webp', cols=4, rows=5), bark={sp: ['trees_bark_%s.webp' % sp, 'trees_barkn_%s.webp' % sp] for sp in SPECIES},
             models=meta, bytes=len(blob))
    with open(os.path.join(EXTRA, 'trees_models.json'), 'w') as f: json.dump(J, f, separators=(',', ':'))
    for fn in sorted(os.listdir(EXTRA)):
        if fn.startswith('trees_'): log('%-26s %.2f MB' % (fn, os.path.getsize(os.path.join(EXTRA, fn)) / 1048576))
    log('done %.1fs' % (time.time() - t))


if __name__ == '__main__':
    main()
