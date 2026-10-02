"""THREADLINE — pedestrian navigation data for the scan map (seed MAN).

The old sidewalk "loops" (scan.json nav.loops) hug the building walls, jitter at the 2 m scan resolution and teleport
between blocks. This tool builds what the crowd actually needs, from the real sidewalk geometry:

  * a roadmap over the walkable raster (raised slab = sidewalks / plazas / parks, minus NYC footprints, scan boxes,
    tree trunks and street poles): skeleton nodes + open-area lattice nodes; edges only where a body fits. Every node and
    edge carries its clearance (m) so walkers can spread out across the pavement without touching a wall.
  * the painted crosswalks (kind-2 bars in streets_data) as kerb-to-kerb edges between the two sidewalks, tied to the
    nearest signalised junction of the traffic graph and to the axis (ns / ew) the walker moves along.
  * seats (every street bench: two slots, facing), food-cart sites with a queue line, district weights + density field
  * extras merged from waterfront_meta.json when present (promenade benches, stoops, bus shelters, carts)

Inputs  (<build>): scan.json, scan.bin, nyc_mask.npz, extra/streets_meta.json, extra/streets_data.bin.gz,
                   extra/trees_layout.json, [extra/waterfront_meta.json]
Outputs (<build>/extra): crowd_nav.json (meta, crosswalks, seats, carts, districts) + crowd_nav.bin.gz (graph, density)
Usage: python tools/scan/crowd_nav.py [--preview DIR]      (TL_BUILD_DIR honoured)
"""
import gzip, json, math, os, sys, time
import numpy as np
import cv2
from scipy import ndimage as nd
from scipy.spatial import cKDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
OUT = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
EXTRA = os.path.join(OUT, 'extra')
RC = 0.5                 # raster cell (m): same frame as streets_meta.frame / nyc_mask.npz
BODY = 0.40              # shoulder half-width + margin kept clear of walls (m)


def log(*a): print('[crowd_nav]', *a, flush=True)


# ----------------------------------------------------------------------------------------------- inputs
class Ctx:
    def __init__(self):
        self.scan = json.load(open(os.path.join(OUT, 'scan.json')))
        self.sm = json.load(open(os.path.join(EXTRA, 'streets_meta.json')))
        self.buf = gzip.open(os.path.join(EXTRA, 'streets_data.bin.gz')).read()
        F = self.F = self.sm['frame']
        self.H, self.W = F['h'], F['w']
        p = self.sm['parts']['raised']
        self.raised = np.unpackbits(np.frombuffer(self.buf, np.uint8, p['n'], p['o']), bitorder='little')[:self.W * self.H].reshape(self.H, self.W).astype(bool)
        ids = np.load(os.path.join(OUT, 'nyc_mask.npz'))['ids']
        assert ids.shape == self.raised.shape, (ids.shape, self.raised.shape)
        self.bld = ids > 0

    def part(self, name):
        p = self.sm['parts'][name]
        dt = {'float32': np.float32, 'uint8': np.uint8, 'int16': np.int16}[p['t']]
        return np.frombuffer(self.buf, dt, p['n'], p['o'])

    def cell(self, x, z): return int((x - self.F['x0']) / RC), int((z - self.F['z0']) / RC)
    def world(self, c, r): return self.F['x0'] + (c + 0.5) * RC, self.F['z0'] + (r + 0.5) * RC


def obstacles(C):
    """cells a walker cannot enter beyond the NYC footprints: tall scan boxes, tree trunks, poles"""
    obs = np.zeros((C.H, C.W), np.uint8)
    sc = C.scan
    sbin = open(os.path.join(OUT, 'scan.bin'), 'rb').read()
    nb = sc['boxes']['n']
    rect = np.frombuffer(sbin, np.int16, nb * 4, sc['boxes']['rect']).reshape(nb, 4)
    hts = np.frombuffer(sbin, np.uint16, nb, sc['boxes']['h'])
    cs, n = sc['cell'], 0
    for (i0, j0, i1, j1), h in zip(rect, hts):
        if h / 10.0 < 2.5: continue
        c0, r0 = C.cell(sc['ox'] + i0 * cs, sc['oz'] + j0 * cs); c1, r1 = C.cell(sc['ox'] + (i1 + 1) * cs, sc['oz'] + (j1 + 1) * cs)
        obs[max(r0, 0):r1 + 1, max(c0, 0):c1 + 1] = 1; n += 1
    log('scan boxes: %d tall' % n)
    tl = os.path.join(EXTRA, 'trees_layout.json')
    if os.path.exists(tl):
        T = json.load(open(tl))['trees']
        for t in T:
            c, r = C.cell(t[0], t[1])
            if 0 <= r < C.H and 0 <= c < C.W: cv2.circle(obs, (c, r), 1, 1, -1)
        log('tree trunks: %d' % len(T))
    for k, v in C.sm['props'].items():
        if not v.get('col', 0): continue
        for x, y, z, yaw in v['inst']:
            c, r = C.cell(x, z)
            if 0 <= r < C.H and 0 <= c < C.W: cv2.circle(obs, (c, r), 1, 1, -1)
    return obs.astype(bool)


# ----------------------------------------------------------------------------------------------- roadmap
def corridor_clear(clr, p, q, step=2.0):
    """minimum clearance along the straight corridor p->q (cell coords)"""
    H, W = clr.shape
    L = float(np.hypot(q[0] - p[0], q[1] - p[1]))
    n = max(2, int(L / step))
    u = np.linspace(0, 1, n)
    xs_ = np.clip((p[0] + (q[0] - p[0]) * u).astype(int), 0, W - 1)
    zs_ = np.clip((p[1] + (q[1] - p[1]) * u).astype(int), 0, H - 1)
    return float(clr[zs_, xs_].min())


def link(nodes, clr, reach, need=BODY):
    """edges between nodes within `reach` m whose corridor stays clear, then thin out edges that a two-hop route replaces"""
    tree = cKDTree(nodes)
    pairs = tree.query_pairs(reach / RC, output_type='ndarray')
    edges, ec = [], []
    for a, b in pairs:
        c = corridor_clear(clr, nodes[a], nodes[b])
        if c < need: continue
        edges.append((a, b)); ec.append(c)
    edges = np.array(edges, np.int32).reshape(-1, 2); ec = np.array(ec, np.float32)
    adj = [[] for _ in nodes]
    for k, (a, b) in enumerate(edges): adj[a].append((b, k)); adj[b].append((a, k))
    L = np.linalg.norm(nodes[edges[:, 0]] - nodes[edges[:, 1]], axis=1) * RC
    drop = np.zeros(len(edges), bool)
    for k in np.argsort(-L):
        a, b = edges[k]; best = None
        for c, k1 in adj[a]:
            if drop[k1] or c == b: continue
            for d_, k2 in adj[c]:
                if d_ == b and not drop[k2]:
                    r = L[k1] + L[k2]
                    if best is None or r < best: best = r
        if best is not None and best < L[k] * 1.1: drop[k] = True
    return edges[~drop], ec[~drop]


def roadmap(C, clr):
    t = time.time()
    H, W = clr.shape
    core = clr >= BODY
    small = cv2.resize(core.astype(np.uint8) * 255, (W // 2, H // 2), interpolation=cv2.INTER_AREA) > 127
    sk = cv2.ximgproc.thinning(small.astype(np.uint8) * 255) > 0
    zs, xs = np.nonzero(sk)
    pts = np.stack([xs * 2 + 1, zs * 2 + 1], 1)                 # full-res cell coords
    log('skeleton px: %d' % len(pts))
    bs = 5.0 / RC                                               # one node per ~5 m bucket of skeleton pixels
    key = (pts[:, 0] // bs).astype(np.int64) * 100000 + (pts[:, 1] // bs).astype(np.int64)
    order = np.argsort(key, kind='stable')
    pts, key = pts[order], key[order]
    _, start = np.unique(key, return_index=True)
    sel = []
    for a, b in zip(start, list(start[1:]) + [len(key)]):
        seg = pts[a:b]; m = seg.mean(0)
        sel.append(seg[np.argmin(np.linalg.norm(seg - m, axis=1))])
    sk_nodes = np.array(sel, float)
    gy, gx = np.mgrid[0:H:int(6 / RC), 0:W:int(6 / RC)]          # plazas / parks / promenades: a 6 m lattice where the pavement is wide
    gm = clr[gy, gx] >= 3.0
    open_nodes = np.stack([gx[gm], gy[gm]], 1).astype(float)
    nodes = np.concatenate([sk_nodes, open_nodes])
    cl = clr[np.clip(nodes[:, 1].astype(int), 0, H - 1), np.clip(nodes[:, 0].astype(int), 0, W - 1)]
    keep = np.ones(len(nodes), bool)
    tree = cKDTree(nodes)
    for i in np.argsort(-cl):
        if not keep[i]: continue
        for j in tree.query_ball_point(nodes[i], 2.8 / RC):
            if j != i and keep[j] and cl[j] <= cl[i]: keep[j] = False
    nodes = nodes[keep]
    log('roadmap nodes: %d (skeleton %d, open %d)' % (len(nodes), len(sk_nodes), len(open_nodes)))
    edges, ec = link(nodes, clr, 12.0)
    log('roadmap edges: %d %.1fs' % (len(edges), time.time() - t))
    return nodes, edges, ec


# ----------------------------------------------------------------------------------------------- crosswalks
def crosswalks(C):
    """cluster the painted high-visibility bars (kind 2) into crossings -> centre, walking direction, extent along it, width"""
    xz = C.part('paint_xz').reshape(-1, 2)
    k = C.part('paint_k')
    bars = xz[k == 2].reshape(-1, 6, 2)
    ctr = bars.mean(1)
    ax = np.zeros((len(bars), 2))
    for i, b in enumerate(bars):                                     # long axis of a bar = along the street
        d = b - b.mean(0)
        w, v = np.linalg.eigh(d.T @ d)
        ax[i] = v[:, 1]
    tree = cKDTree(ctr)
    par = list(range(len(bars)))
    def f(a):
        while par[a] != a: par[a] = par[par[a]]; a = par[a]
        return a
    for a, b in tree.query_pairs(1.7, output_type='ndarray'):
        if abs(ax[a] @ ax[b]) > 0.93: par[f(a)] = f(b)
    groups = {}
    for i in range(len(bars)): groups.setdefault(f(i), []).append(i)
    out = []
    for g in groups.values():
        if len(g) < 3: continue
        c = ctr[g]; m = c.mean(0)
        u = ax[g[0]]
        d = np.array([-u[1], u[0]])                                  # across the street = walking direction
        s = (c - m) @ d
        w = float(np.mean([np.ptp((bars[i] - ctr[i]) @ u) for i in g]))
        out.append(dict(c=m, d=d, lo=float(s.min()), hi=float(s.max()), w=w, n=len(g)))
    log('crosswalk bars %d -> crossings %d' % (len(bars), len(out)))
    return out


def snap_walkable(C, clr, p, d, need):
    """first position beyond the kerb (moving along d) that stands on clear pavement"""
    for s in np.arange(0.0, 4.5, 0.25):
        q = p + d * s
        c, r = C.cell(q[0], q[1])
        if 0 <= r < C.H and 0 <= c < C.W and clr[r, c] >= need: return q
    return None


def connect_crosswalks(C, clr, nodes, xw):
    """-> new node cell coords, edges (a, b), clearance, crossing index per edge (-1 for plain edges), records. Failed crossings roll back."""
    ptree = cKDTree(nodes)
    en, ee, ec, ex, rec = [], [], [], [], []
    miss = dict(snap=0, link=0)
    connect_crosswalks.dropped = []
    for q in xw:
        a0 = q['c'] + q['d'] * (q['lo'] - 0.5); b0 = q['c'] + q['d'] * (q['hi'] + 0.5)
        a = snap_walkable(C, clr, a0, -q['d'], BODY); b = snap_walkable(C, clr, b0, q['d'], BODY)
        if a is None or b is None:
            miss['snap'] += 1; connect_crosswalks.dropped.append((a0, b0)); continue
        mark = (len(en), len(ee))
        ids, ok = [], True
        for p in (a, b):
            c, r = C.cell(p[0], p[1])
            P = np.array([c, r], float)
            k0 = len(nodes) + len(en)
            en.append(P); ids.append(k0)
            cnt = 0
            for d, j in zip(*ptree.query(P, 10)):
                if d * RC > 16: break
                cc = corridor_clear(clr, P, nodes[j])
                if cc < 0.3: continue
                ee.append((k0, j)); ec.append(cc); ex.append(-1); cnt += 1
                if cnt >= 3: break
            if cnt == 0: ok = False; break
        if not ok:
            del en[mark[0]:]; del ee[mark[1]:]; del ec[mark[1]:]; del ex[mark[1]:]; miss['link'] += 1; connect_crosswalks.dropped.append((a0, b0)); continue
        ee.append((ids[0], ids[1])); ec.append(float(q['w'])); ex.append(len(rec)); rec.append(q)
    log('crossings linked: %d (dropped %s)' % (len(rec), miss))
    return en, ee, ec, ex, rec


# ----------------------------------------------------------------------------------------------- seats / carts
def bench_seats(C):
    """the street bench faces local -X (backrest at +X, long axis Z): two slots per bench"""
    seats = []
    for x, y, z, yaw in C.sm['props']['bench']['inst']:
        cy, sy = math.cos(yaw), math.sin(yaw)
        ax, az = sy, cy                                            # local +Z in world
        seats.append(dict(x=round(x, 2), z=round(z, 2), f=round(math.atan2(-cy, sy), 3), type='bench',
                          slots=[[round(x + ax * o + cy * 0.04, 2), round(z + az * o - sy * 0.04, 2)] for o in (-0.5, 0.5)]))
    log('bench seats: %d' % len(seats))
    return seats


def cart_sites(C, clr, xw, rng, limit=36):
    """kerb-side sites on wide pavement near crossings; the queue runs along the walking direction t, customers stand on n"""
    road = (~C.raised) & (~C.bld)
    d_road = nd.distance_transform_edt(~road) * RC           # distance to the roadbed
    d_bld = nd.distance_transform_edt(~C.bld) * RC
    cand = np.nonzero((clr >= 1.7) & (d_road > 0.6) & (d_road < 1.6) & (d_bld > 2.6))
    if not len(cand[0]): return []
    P = np.stack([cand[1], cand[0]], 1)
    xc = np.array([x['c'] for x in xw])
    xt = cKDTree(xc)
    sites, taken = [], []
    for i in rng.permutation(len(P)):
        c, r = P[i]
        x, z = C.world(c, r)
        if taken and np.min(np.hypot(np.array(taken)[:, 0] - x, np.array(taken)[:, 1] - z)) < 70: continue
        if xt.query([x, z])[0] > 40: continue                    # busy corners only
        r0, c0 = max(r - 3, 0), max(c - 3, 0)
        gy, gx = np.gradient(d_road[r0:r + 4, c0:c + 4])
        n = np.array([gx.mean(), gy.mean()])
        if np.linalg.norm(n) < 1e-3: continue
        n /= np.linalg.norm(n)
        t = np.array([-n[1], n[0]])
        ok = True
        for sgn in (1, -1):
            for s in (2, 4, 6):
                q = np.array([x, z]) + t * s * sgn + n * 1.4
                cc, rr = C.cell(q[0], q[1])
                if not (0 <= rr < C.H and 0 <= cc < C.W and clr[rr, cc] >= 0.5): ok = False
        if not ok: continue
        taken.append((x, z))
        sites.append(dict(x=round(float(x), 2), z=round(float(z), 2), n=[round(float(n[0]), 3), round(float(n[1]), 3)], t=[round(float(t[0]), 3), round(float(t[1]), 3)], kind=len(sites) % 3))
        if len(sites) >= limit: break
    log('cart sites: %d' % len(sites))
    return sites


def rect_blocker(C, obs, cx, cz, ax, az, hx, hz):
    """mark an oriented rectangle (centre, unit axis a, half extents hx along a / hz across) in the obstacle raster"""
    px, pz = -az, ax
    pts = np.array([[cx + ax * sx * hx + px * sz * hz, cz + az * sx * hx + pz * sz * hz] for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    cells = np.array([[(x - C.F['x0']) / RC, (z - C.F['z0']) / RC] for x, z in pts], np.int32)
    cv2.fillConvexPoly(obs, cells, 1)


def march(C, clr, x, z, dx, dz, need, maxd=8.0):
    """distance along (dx,dz) from (x,z) over pavement with clearance >= need"""
    d = 0.0
    while d < maxd:
        c, r = C.cell(x + dx * d, z + dz * d)
        if not (0 <= r < C.H and 0 <= c < C.W) or clr[r, c] < need: return d
        d += 0.25
    return maxd


def stoop_sites(C, clr, walk, rng, limit=80):
    """brownstone stoops against straight walls of low-rise buildings (< 24 m) with at least 5 m of pavement in front"""
    nj = json.load(open(os.path.join(OUT, 'nyc.json')))
    ids = np.load(os.path.join(OUT, 'nyc_mask.npz'))['ids']
    low_ids = [b['id'] for b in nj['buildings'] if b['h'] < 32]
    low = np.isin(ids, low_ids)
    d_low = nd.distance_transform_edt(~low) * RC
    cand = np.nonzero(walk & (d_low > 0.4) & (d_low < 1.0))
    log('stoop candidates: %d (low-rise buildings %d)' % (len(cand[0]), len(low_ids)))
    P = np.stack([cand[1], cand[0]], 1)
    sites, taken = [], []
    for i in rng.permutation(len(P)):
        c, r = P[i]
        x, z = C.world(c, r)
        if taken and np.min(np.hypot(np.array(taken)[:, 0] - x, np.array(taken)[:, 1] - z)) < 24: continue
        r0, c0 = max(r - 4, 0), max(c - 4, 0)
        gy, gx = np.gradient(d_low[r0:r + 5, c0:c0 + 9])
        n = np.array([gx.mean(), gy.mean()])
        if np.linalg.norm(n) < 1e-3: continue
        n /= np.linalg.norm(n)
        t = np.array([-n[1], n[0]])
        wx, wz = x - n[0] * d_low[r, c], z - n[1] * d_low[r, c]                       # contact point on the wall
        ok = True
        for s in (-1.2, 1.2):                                              # straight wall for +-1.4 m
            qx, qz = wx + t[0] * s, wz + t[1] * s
            cc, rr = C.cell(qx + n[0] * 0.7, qz + n[1] * 0.7)
            if not (0 <= rr < C.H and 0 <= cc < C.W) or d_low[rr, cc] < 0.3 or d_low[rr, cc] > 1.5 or not walk[rr, cc]: ok = False; break
        if not ok: continue
        if march(C, clr, wx + n[0] * 0.6, wz + n[1] * 0.6, n[0], n[1], 0.4) < 3.6: continue
        if march(C, clr, wx + n[0] * 2.2, wz + n[1] * 2.2, t[0], t[1], 0.3, 1.2) < 1.0 or march(C, clr, wx + n[0] * 2.2, wz + n[1] * 2.2, -t[0], -t[1], 0.3, 1.2) < 1.0: continue
        taken.append((wx, wz))
        sites.append(dict(x=round(float(wx) - float(n[0]) * 0.03, 2), z=round(float(wz) - float(n[1]) * 0.03, 2), n=[round(float(n[0]), 3), round(float(n[1]), 3)], t=[round(float(t[0]), 3), round(float(t[1]), 3)]))
        if len(sites) >= limit: break
    log('stoop sites: %d' % len(sites))
    return sites


def stoop_seats(sites):
    """mid step (0.45 m) and landing (0.9 m), two slots each; the sitters face away from the wall"""
    seats = []
    for s in sites:
        nx, nz = s['n']; tx, tz = s['t']
        f = round(math.atan2(nx, nz), 3)
        for dist, h in ((1.22, 0.45), (0.5, 0.9)):
            seats.append(dict(x=round(s['x'] + nx * dist, 2), z=round(s['z'] + nz * dist, 2), f=f, h=h, type='stoop',
                              slots=[[round(s['x'] + nx * dist + tx * o, 2), round(s['z'] + nz * dist + tz * o, 2)] for o in (-0.45, 0.45)]))
    return seats


def shelter_sites(C, clr, xw, rng, limit=16):
    """bus shelters at the kerb of wide streets, 14-80 m from a crossing, never in one"""
    road = (~C.raised) & (~C.bld)
    d_road = nd.distance_transform_edt(~road) * RC
    cand = np.nonzero((clr >= 2.6) & (d_road > 0.6) & (d_road < 1.5))
    P = np.stack([cand[1], cand[0]], 1)
    xt = cKDTree(np.array([x['c'] for x in xw]))
    sites, taken = [], []
    for i in rng.permutation(len(P)):
        c, r = P[i]
        x, z = C.world(c, r)
        if taken and np.min(np.hypot(np.array(taken)[:, 0] - x, np.array(taken)[:, 1] - z)) < 85: continue
        dx_ = xt.query([x, z])[0]
        if dx_ < 10 or dx_ > 110: continue
        r0, c0 = max(r - 3, 0), max(c - 3, 0)
        gy, gx = np.gradient(d_road[r0:r + 4, c0:c0 + 7])
        n = np.array([gx.mean(), gy.mean()])
        if np.linalg.norm(n) < 1e-3: continue
        n /= np.linalg.norm(n); t = np.array([-n[1], n[0]])
        cc, rr = C.cell(x - n[0] * 5.5, z - n[1] * 5.5)
        if not (0 <= rr < C.H and 0 <= cc < C.W) or not road[rr, cc]: continue            # a real street, not a service lane
        if min(march(C, clr, x, z, t[0], t[1], 0.5, 2.4), march(C, clr, x, z, -t[0], -t[1], 0.5, 2.4)) < 2.3: continue
        if march(C, clr, x + n[0] * 0.3, z + n[1] * 0.3, n[0], n[1], 0.5, 3.0) < 1.7: continue    # room behind for passers-by
        taken.append((x, z))
        sites.append(dict(x=round(float(x), 2), z=round(float(z), 2), n=[round(float(n[0]), 3), round(float(n[1]), 3)], out=[round(float(-n[0]), 3), round(float(-n[1]), 3)], t=[round(float(t[0]), 3), round(float(t[1]), 3)]))
        if len(sites) >= limit: break
    log('shelter sites: %d' % len(sites))
    return sites


def shelter_seats(sites):
    seats = []
    for s in sites:
        ox, oz = s['out']; tx, tz = -oz, ox                                       # model +Z in world
        cx, cz = s['x'] - ox * 0.45, s['z'] - oz * 0.45
        seats.append(dict(x=round(cx, 2), z=round(cz, 2), f=round(math.atan2(ox, oz), 3), h=0.45, type='shelter',
                          slots=[[round(cx + tx * (-0.35 + o), 2), round(cz + tz * (-0.35 + o), 2)] for o in (-0.5, 0.5)]))
    return seats


# ----------------------------------------------------------------------------------------------- districts
DISTRICTS = [
    # name, centre, radius, crowd weight and the pedestrian mix
    dict(name='Battery Park', c=[205, 700], r=170, crowd=1.0, mix=dict(tourist=0.52, suit=0.06, local=0.22, jogger=0.20)),
    dict(name='Bowling Green', c=[-11, 440], r=70, crowd=1.35, mix=dict(tourist=0.55, suit=0.25, local=0.15, jogger=0.05)),
    dict(name='Financial District', c=[60, 220], r=230, crowd=1.5, mix=dict(tourist=0.12, suit=0.62, local=0.20, jogger=0.06)),
    dict(name='South Street Seaport', c=[430, 330], r=140, crowd=1.1, mix=dict(tourist=0.45, suit=0.20, local=0.25, jogger=0.10)),
    dict(name='Civic Center', c=[60, -140], r=260, crowd=1.0, mix=dict(tourist=0.2, suit=0.45, local=0.30, jogger=0.05)),
    dict(name='Tribeca', c=[-250, -480], r=330, crowd=0.7, mix=dict(tourist=0.12, suit=0.28, local=0.52, jogger=0.08)),
]


def zone_raster(C):
    """0.5 m raster of the slab kind (1 sidewalk, 2 plaza, 3 park) from the streets slab triangles"""
    xz = C.part('slab_xz').reshape(-1, 3, 2)
    K = C.part('slab_k')
    Z = np.zeros((C.H, C.W), np.uint8)
    for kind in (1, 2, 3):
        tri = xz[K[::3] == kind - 1]
        for t in tri:
            pts = np.array([[(x - C.F['x0']) / RC, (z - C.F['z0']) / RC] for x, z in t], np.int32)
            cv2.fillConvexPoly(Z, pts, kind)
    return Z


def water_distance(C):
    """distance (m) to the water for the 2 m land mask, sampled by world position"""
    sc = C.scan
    sbin = open(os.path.join(OUT, 'scan.bin'), 'rb').read()
    land = np.frombuffer(sbin, np.uint8, sc['nx'] * sc['nz'], sc['land']).reshape(sc['nz'], sc['nx']) == 1
    dist = nd.distance_transform_edt(land) * sc['cell']
    def at(x, z):
        i = min(max(int((x - sc['ox']) / sc['cell']), 0), sc['nx'] - 1); j = min(max(int((z - sc['oz']) / sc['cell']), 0), sc['nz'] - 1)
        return dist[j, i]
    return at


def density_grid(C, clr, xw):
    """20 m grid, uint8: pavement area (people live where there is pavement) x crosswalk boost x district weight"""
    cell = 20.0
    x0, z0 = -640.0, -945.0
    nx, nz = int(1280 // cell) + 1, int(1890 // cell) + 1
    k = int(cell / RC)
    Hc, Wc = C.H // k, C.W // k
    area = (clr >= BODY).astype(np.float32)[:Hc * k, :Wc * k].reshape(Hc, k, Wc, k).mean((1, 3))
    D = np.zeros((nz, nx), np.float32)
    ox, oz = int(round((C.F['x0'] - x0) / cell)), int(round((C.F['z0'] - z0) / cell))
    D[oz:oz + Hc, ox:ox + Wc] = area[:min(Hc, nz - oz), :min(Wc, nx - ox)]
    for x in xw:
        gx = int((x['c'][0] - x0) / cell); gz = int((x['c'][1] - z0) / cell)
        if 0 <= gx < nx and 0 <= gz < nz: D[gz, gx] += 0.06
    D = nd.gaussian_filter(D, 1.2)
    Dn = D / max(np.percentile(D[D > 0], 95), 1e-6)
    gz_, gx_ = np.mgrid[0:nz, 0:nx]
    X = x0 + (gx_ + 0.5) * cell; Z = z0 + (gz_ + 0.5) * cell
    Wt = np.zeros_like(D) + 0.55
    for d in DISTRICTS:
        Wt = np.maximum(Wt, d['crowd'] * np.exp(-(((X - d['c'][0]) ** 2 + (Z - d['c'][1]) ** 2) / (2 * (d['r'] * 0.55) ** 2))))
    G = np.clip(Dn * Wt, 0, 1.6)
    return np.clip(G / 1.6 * 255, 0, 255).astype(np.uint8), dict(x0=x0, z0=z0, cell=cell, nx=nx, nz=nz)


# ----------------------------------------------------------------------------------------------- preview
def preview(C, clr, world, edges, cw, seats, sites, path, boxes, dropped=(), islands=()):
    from PIL import Image, ImageDraw
    for name, (xa, xb, za, zb, s) in boxes.items():
        xb = min(xb, C.F['x0'] + C.W * RC - 1); zb = min(zb, C.F['z0'] + C.H * RC - 1)
        c0, r0 = C.cell(xa, za); c1, r1 = C.cell(xb, zb)
        img = np.zeros((r1 - r0, c1 - c0, 3), np.uint8); img[:] = (38, 38, 44)
        img[C.raised[r0:r1, c0:c1]] = (110, 110, 110)
        img[C.bld[r0:r1, c0:c1]] = (70, 50, 50)
        img[(clr[r0:r1, c0:c1] >= BODY)] = (145, 155, 145)
        im = Image.fromarray(img).resize((int((xb - xa) * s), int((zb - za) * s)), Image.NEAREST); d = ImageDraw.Draw(im)
        P = lambda x, z: ((x - xa) * s, (z - za) * s)
        near = lambda p: xa - 15 < p[0] < xb + 15 and za - 15 < p[1] < zb + 15
        for a, b in edges:
            if near(world[a]): d.line([P(*world[a]), P(*world[b])], fill=(60, 160, 255), width=1)
        for q in cw:
            a, b = q['a'], q['b']
            if near(world[a]): d.line([P(*world[a]), P(*world[b])], fill=(255, 220, 40), width=2)
        for p in world:
            if xa < p[0] < xb and za < p[1] < zb: d.ellipse([P(p[0] - .35, p[1] - .35), P(p[0] + .35, p[1] + .35)], fill=(255, 255, 255))
        for p in islands:
            if xa < p[0] < xb and za < p[1] < zb: d.ellipse([P(p[0] - .8, p[1] - .8), P(p[0] + .8, p[1] + .8)], fill=(255, 40, 40))
        for q in dropped:
            if xa < q[0][0] < xb and za < q[0][1] < zb: d.line([P(*q[0]), P(*q[1])], fill=(255, 120, 0), width=3)
        for sd in seats:
            if xa < sd['x'] < xb and za < sd['z'] < zb: d.ellipse([P(sd['x'] - .6, sd['z'] - .6), P(sd['x'] + .6, sd['z'] + .6)], fill=(60, 255, 90))
        for c in sites:
            if xa < c['x'] < xb and za < c['z'] < zb: d.ellipse([P(c['x'] - 1.2, c['z'] - 1.2), P(c['x'] + 1.2, c['z'] + 1.2)], fill=(255, 60, 200))
        im.save(os.path.join(path, name + '.png'))


# ----------------------------------------------------------------------------------------------- main
def junctions(C):
    """signalised junctions of the traffic graph (degree >= 3): the nodes TrafficManager keys its signals on"""
    N = C.scan['nav']
    deg = np.zeros(len(N['nodes']), int)
    for a, b in N['edges']: deg[a] += 1; deg[b] += 1
    return np.array([[n[0], n[1]] for n, d in zip(N['nodes'], deg) if d >= 3])


def main():
    t0 = time.time()
    C = Ctx()
    rng = np.random.default_rng(77)
    obs = obstacles(C)
    walk = C.raised & ~C.bld & ~obs
    walk = nd.binary_closing(walk, iterations=1) & ~C.bld & ~obs      # 1-cell holes (pole stubs, paver gaps) do not split corridors
    clr = (nd.distance_transform_edt(walk) * RC).astype(np.float32)
    log('walkable %.1f%% of raster, max clearance %.1f m' % (100 * walk.mean(), clr.max()))
    xw = crosswalks(C)
    # props are placed on the open pavement first, then carved out of it before the roadmap is built
    seats = bench_seats(C)
    sites = cart_sites(C, clr, xw, rng)
    stoops = stoop_sites(C, clr, walk, rng)
    shelters = shelter_sites(C, clr, xw, rng)
    seats += stoop_seats(stoops) + shelter_seats(shelters)
    block = np.zeros((C.H, C.W), np.uint8)
    for c in sites: rect_blocker(C, block, c['x'], c['z'], c['n'][0], c['n'][1], 0.6, 1.15)
    for s_ in stoops: rect_blocker(C, block, s_['x'] + s_['n'][0] * 1.05, s_['z'] + s_['n'][1] * 1.05, s_['n'][0], s_['n'][1], 1.05, 1.05)
    for s_ in shelters: rect_blocker(C, block, s_['x'], s_['z'], s_['n'][0], s_['n'][1], 0.95, 2.0)
    for bn in C.sm['props']['bench']['inst']: rect_blocker(C, block, bn[0], bn[2], math.cos(bn[3]), -math.sin(bn[3]), 0.4, 1.05)
    wfm = os.path.join(EXTRA, 'waterfront_meta.json')
    if os.path.exists(wfm):                                          # keep walkers off the quay edge (railings, bollards, ladders) and the promenade benches
        W_ = json.load(open(wfm)).get('crowd', {})
        for line in W_.get('shore', []):
            pts = np.array([[(x - C.F['x0']) / RC, (z - C.F['z0']) / RC] for x, z in line], np.int32)
            cv2.polylines(block, [pts], False, 1, thickness=5)
        for sd in W_.get('seats', []):
            ax_, az_ = math.sin(sd['f']), math.cos(sd['f'])
            rect_blocker(C, block, sd['x'], sd['z'], ax_, az_, 0.4, 1.0)
        log('waterfront blockers: %d shore runs, %d seats' % (len(W_.get('shore', [])), len(W_.get('seats', []))))
    walk = nd.binary_closing(walk & (block == 0), iterations=1) & ~C.bld & ~obs & (block == 0)
    clr = (nd.distance_transform_edt(walk) * RC).astype(np.float32)
    nodes, edges, ec = roadmap(C, clr)
    en, ee, eec, eex, rec = connect_crosswalks(C, clr, nodes, xw)
    cells = np.concatenate([nodes, np.array(en).reshape(-1, 2)])
    edges = np.concatenate([edges, np.array(ee, np.int32).reshape(-1, 2)])
    ec = np.concatenate([ec, np.array(eec, np.float32)])
    exw = np.concatenate([-np.ones(len(ec) - len(eex), np.int32), np.array(eex, np.int32)])
    # largest connected component only (islands would strand walkers)
    par = list(range(len(cells)))
    def f(a):
        while par[a] != a: par[a] = par[par[a]]; a = par[a]
        return a
    for a, b in edges: par[f(a)] = f(b)
    roots = np.array([f(i) for i in range(len(cells))])
    keepn = roots == np.bincount(roots).argmax()
    island_pts = [C.world(c, r) for (c, r), k in zip(cells, keepn) if not k]
    log('largest component: %d of %d nodes' % (keepn.sum(), len(cells)))
    remap = -np.ones(len(cells), np.int32); remap[keepn] = np.arange(keepn.sum())
    ke = keepn[edges[:, 0]] & keepn[edges[:, 1]]
    cells = cells[keepn]; edges = remap[edges[ke]]; ec = ec[ke]; exw = exw[ke]
    world = np.array([C.world(c, r) for c, r in cells], np.float32)
    ncl = np.array([clr[min(max(int(r), 0), C.H - 1), min(max(int(c), 0), C.W - 1)] for c, r in cells], np.float32)
    # crossings that survived: reindex, tie to a signalised junction, walking axis
    J = junctions(C); jt = cKDTree(J)
    used = sorted(set(int(v) for v in exw if v >= 0))
    xmap = {v: i for i, v in enumerate(used)}
    cw = [None] * len(used)
    for k in range(len(edges)):
        if exw[k] < 0: continue
        q = rec[exw[k]]
        a, b = int(edges[k][0]), int(edges[k][1])
        c = (world[a] + world[b]) / 2
        dist, ji = jt.query(c)
        d = world[b] - world[a]; d = d / max(np.linalg.norm(d), 1e-6)
        cw[xmap[int(exw[k])]] = dict(e=k, a=a, b=b, w=round(float(q['w']), 2), sig=[round(float(J[ji][0]), 1), round(float(J[ji][1]), 1)] if dist < 70 else None,
                                     axis='ns' if abs(d[1]) > abs(d[0]) else 'ew')
    exw = np.array([xmap[int(v)] if v >= 0 else -1 for v in exw], np.int16)
    log('crossings: %d, signalised %d' % (len(cw), sum(1 for q in cw if q['sig'])))
    extras = {}
    wf = os.path.join(EXTRA, 'waterfront_meta.json')
    if os.path.exists(wf):
        extras = json.load(open(wf)).get('crowd', {})
        seats += extras.get('seats', []); sites += extras.get('carts', [])
        log('waterfront extras: %d seats, %d carts' % (len(extras.get('seats', [])), len(extras.get('carts', []))))
    dens, dgrid = density_grid(C, clr, xw)
    blob = b''
    parts = {}
    def put(name, arr):
        nonlocal blob
        blob += b'\0' * ((-len(blob)) % 4)
        parts[name] = dict(o=len(blob), n=int(arr.size), t=str(arr.dtype))
        blob += arr.tobytes()
    zone = zone_raster(C)
    dw = water_distance(C)
    flags = np.array([min(int(zone[min(max(int(r), 0), C.H - 1), min(max(int(c), 0), C.W - 1)]), 3) | (4 if dw(x, z) < 14 else 0) for (c, r), (x, z) in zip(cells, world)], np.uint8)
    log('nodes by zone: sidewalk %d plaza %d park %d, near water %d' % (tuple(int(((flags & 3) == k).sum()) for k in (1, 2, 3)) + (int(((flags & 4) > 0).sum()),)))
    put('nodes', np.column_stack([world, ncl]).astype(np.float32))
    put('nflag', flags)
    put('edges', edges.astype(np.uint32))
    put('eclr', ec.astype(np.float32))
    put('exw', exw)
    put('dens', dens)
    meta = dict(v=1, parts=parts, nodes=int(len(world)), edges=int(len(edges)), grid=dgrid, districts=DISTRICTS, crosswalks=cw, seats=seats, carts=sites,
                stoops=stoops, shelters=shelters, pois=extras.get('pois', []), body=BODY)
    os.makedirs(EXTRA, exist_ok=True)
    with gzip.open(os.path.join(EXTRA, 'crowd_nav.bin.gz'), 'wb', compresslevel=9) as fh: fh.write(blob)
    with open(os.path.join(EXTRA, 'crowd_nav.json'), 'w') as fh: json.dump(meta, fh, separators=(',', ':'))
    log('crowd_nav.bin.gz %.2f MB, crowd_nav.json %.2f MB' % (os.path.getsize(os.path.join(EXTRA, 'crowd_nav.bin.gz')) / 1048576, os.path.getsize(os.path.join(EXTRA, 'crowd_nav.json')) / 1048576))
    if '--preview' in sys.argv:
        pd = sys.argv[sys.argv.index('--preview') + 1]; os.makedirs(pd, exist_ok=True)
        preview(C, clr, world, [(int(a), int(b)) for a, b in edges], cw, seats, sites, pd,
                dict(wall=(-50, 250, 280, 520, 3), battery=(100, 400, 560, 800, 3), seaport=(330, 637, 200, 480, 3)),
                dropped=connect_crosswalks.dropped, islands=island_pts)
    log('done %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    main()
