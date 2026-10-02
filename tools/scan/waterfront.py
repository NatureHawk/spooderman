"""THREADLINE — waterfront for the scan map (seed MAN): smooth quay edge, bulkhead wall, railings, bollards, piers, moorings.

The scan's land mask (2 m cells) ends in a stair-stepped edge with nothing below it. This tool
  1. closes the notches of the land edge by a small smooth apron (<= 2 m) so the quay line is a clean curve,
  2. traces that curve (closed contours, smoothed, resampled every 1 m),
  3. builds the quay wall (granite blocks from the deck down to 3.8 m below the water, coping band on top) and the apron deck,
  4. lays out railings / bollards / lamps / life rings / ladders / benches along it (placements only: models come from life_water.py),
  5. picks mooring berths for the boats and the floating finger docks, harbour routes for the moving ferries and tugs.
Writes <build>/extra/waterfront_meta.json (placements, routes, crowd extras, ...) + waterfront_data.bin.gz (wall + apron meshes, apron bit raster)
+ waterfront_wall.webp / waterfront_deck.webp.  Usage: python tools/scan/waterfront.py [--preview DIR]    (TL_BUILD_DIR honoured)
"""
import gzip, json, math, os, sys, time
import numpy as np
import cv2
from scipy import ndimage as nd
from scipy.spatial import Delaunay, cKDTree
from PIL import Image
import shapely
from shapely.geometry import Polygon, Point, MultiPolygon

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
OUT = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
EXTRA = os.path.join(OUT, 'extra')
RC = 0.5                    # raster step (m)
WATER_Y = -3.0
DECK_Y = 0.15               # sidewalk slab top; the roadbed is -0.02
WALL_BOTTOM = -3.9


def log(*a): print('[waterfront]', *a, flush=True)


class Ctx:
    def __init__(self):
        self.sc = json.load(open(os.path.join(OUT, 'scan.json')))
        sc = self.sc
        sbin = open(os.path.join(OUT, 'scan.bin'), 'rb').read()
        self.land2 = np.frombuffer(sbin, np.uint8, sc['nx'] * sc['nz'], sc['land']).reshape(sc['nz'], sc['nx']) == 1
        sm = json.load(open(os.path.join(EXTRA, 'streets_meta.json')))
        buf = gzip.open(os.path.join(EXTRA, 'streets_data.bin.gz')).read()
        F = self.F = sm['frame']
        p = sm['parts']['raised']
        self.raised = np.unpackbits(np.frombuffer(buf, np.uint8, p['n'], p['o']), bitorder='little')[:F['w'] * F['h']].reshape(F['h'], F['w']).astype(bool)
        self.H, self.W = F['h'], F['w']
        k = int(round(sc['cell'] / RC))
        # land at 0.5 m, aligned with the streets frame (both start at the scan origin)
        land = np.kron(self.land2, np.ones((k, k), bool))
        self.land = np.zeros((self.H, self.W), bool)
        h, w = min(self.H, land.shape[0]), min(self.W, land.shape[1])
        self.land[:h, :w] = land[:h, :w]
        self.x0, self.z0 = F['x0'], F['z0']

    def px(self, x, z): return (x - self.x0) / RC, (z - self.z0) / RC
    def wd(self, c, r): return self.x0 + c * RC, self.z0 + r * RC


# ------------------------------------------------------------------ the smooth quay line
def apron_mask(C):
    """land + a smooth apron that fills the stair-steps (never more than 2 m beyond the land)"""
    L = C.land
    S = nd.gaussian_filter(L.astype(np.float32), 2.6)
    A = (S > 0.30) & ~L
    near = nd.distance_transform_edt(~L) * RC <= 2.0
    A &= near
    # drop the apron where the stair-step is really a slip / gap wider than 6 m: keep only cells with land on two sides within 3 m
    A = nd.binary_opening(A, iterations=1) | (A & (nd.distance_transform_edt(~L) * RC <= 0.6))
    return A


def contours(mask):
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c, h in zip(cs, hier[0]):
        if len(c) < 40: continue
        out.append((c.reshape(-1, 2).astype(np.float64), h[3] >= 0))        # (points col,row), is_hole
    return out


def smooth_closed(P, win=9, it=2):
    n = len(P)
    Q = P.copy()
    for _ in range(it):
        acc = np.zeros_like(Q)
        for k in range(-win // 2, win // 2 + 1): acc += np.roll(Q, k, axis=0)
        Q = acc / (win + 1 - (win % 2 == 0))
    return Q


def resample_closed(P, step):
    d = np.linalg.norm(np.diff(np.vstack([P, P[:1]]), axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(d)])
    L = s[-1]
    n = max(8, int(L / step))
    t = np.linspace(0, L, n, endpoint=False)
    Pc = np.vstack([P, P[:1]])
    return np.stack([np.interp(t, s, Pc[:, 0]), np.interp(t, s, Pc[:, 1])], 1), L


def quay_lines(C, A):
    """closed smooth polylines (world metres) around the land+apron mask. Returns list of dict(P, N, T, L, hole)"""
    M = (C.land | A)
    M = nd.binary_fill_holes(M) if False else M
    out = []
    for pts, hole in contours(M):
        if len(pts) < 80: continue                               # tiny lagoons / specks
        P = smooth_closed(pts, 11, 2)
        P, L = resample_closed(P, 1.0)
        if L < 25: continue
        W = np.array([C.wd(c + 0.5, r + 0.5) for c, r in P])
        T = np.roll(W, -1, 0) - np.roll(W, 1, 0); T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
        N = np.stack([T[:, 1], -T[:, 0]], 1)                     # candidate outward normal; flipped below so it points to water
        # decide orientation: sample a point 2 m out along N; majority must be water
        q = W + N * 2.0
        cc = np.clip(((q[:, 0] - C.x0) / RC).astype(int), 0, C.W - 1); rr = np.clip(((q[:, 1] - C.z0) / RC).astype(int), 0, C.H - 1)
        if (~M[rr, cc]).mean() < 0.5: N = -N; T = -T
        x1, z1 = C.x0 + C.W * RC, C.z0 + C.H * RC
        valid = (W[:, 0] > C.x0 + 4) & (W[:, 1] > C.z0 + 4) & (W[:, 0] < x1 - 4) & (W[:, 1] < z1 - 4)      # the scan's own cut-off edges are not shorelines
        out.append(dict(P=W, N=N, T=T, L=L, hole=bool(hole), valid=valid))
    log('quay lines: %d, %.0f m total' % (len(out), sum(o['L'] for o in out)))
    return out


# ------------------------------------------------------------------ meshes
def wall_mesh(C, lines):
    """vertical granite wall: per segment a quad from the deck to WALL_BOTTOM; coping lip on top. uv.x = along (4 m tile), uv.y = height (4 m tile)"""
    P, N, UV = [], [], []
    for ln in lines:
        W, Nn = ln['P'], ln['N']
        s = 0.0
        n = len(W)
        # deck height per vertex: slab top where the pavement behind is raised, roadbed elsewhere
        top = np.empty(n)
        for i in range(n):
            q = W[i] - Nn[i] * 1.0
            c, r = int((q[0] - C.x0) / RC), int((q[1] - C.z0) / RC)
            top[i] = DECK_Y if (0 <= r < C.H and 0 <= c < C.W and C.raised[r, c]) else -0.02
        top = nd.uniform_filter1d(top, 5, mode='wrap')
        ln['top'] = top
        for i in range(n):
            j = (i + 1) % n
            seg = float(np.hypot(*(W[j] - W[i])))
            if not (ln['valid'][i] and ln['valid'][j]): s += seg; continue
            u0, u1 = s / 4.0, (s + seg) / 4.0
            s += seg
            for (a, b, ua, ub) in ((i, j, u0, u1),):
                ya, yb = top[a], top[b]
                a0 = (W[a][0], W[a][1]); b0 = (W[b][0], W[b][1])
                na = (Nn[a][0], Nn[a][1]); nb = (Nn[b][0], Nn[b][1])
                # two triangles: (a_top, b_top, b_bot), (a_top, b_bot, a_bot); winding so the face looks outward (towards the water)
                quad = [(a0, ya, ua, na), (b0, yb, ub, nb), (b0, WALL_BOTTOM, ub, nb), (a0, WALL_BOTTOM, ua, na)]
                for k in (0, 1, 2, 0, 2, 3):
                    (x, z), y, u, nn = quad[k]
                    P.append((x, y, z)); N.append((nn[0], 0.0, nn[1])); UV.append((u, (y - WALL_BOTTOM) / 4.0))
    P = np.array(P, np.float32); N = np.array(N, np.float32); UV = np.array(UV, np.float32)
    # winding check on the first triangle: normal must agree with N
    e1, e2 = P[1] - P[0], P[2] - P[0]
    if np.dot(np.cross(e1, e2), N[0]) < 0:
        idx = np.arange(len(P)).reshape(-1, 3)[:, [0, 2, 1]].reshape(-1)
        P, N, UV = P[idx], N[idx], UV[idx]
    return P, N, UV


def apron_mesh(C, lines, A):
    """flat deck between the land edge and the quay line"""
    # polygon of the whole quay (outer contour minus holes) minus the raw land
    polys = []
    for ln in lines:
        if len(ln['P']) >= 4: polys.append(Polygon(ln['P']).buffer(0))
    if not polys: return np.zeros((0, 3), np.float32), np.zeros((0, 2), np.float32)
    # build apron cells from the mask directly: triangulate boundary + interior samples of the apron band
    ys, xs = np.nonzero(A)
    if not len(ys): return np.zeros((0, 3), np.float32), np.zeros((0, 2), np.float32)
    # 1 m lattice of apron points plus the quay line and the land edge
    pts = [C.wd(c + 0.5, r + 0.5) for c, r in zip(xs[::2], ys[::2])]
    pts = np.array(pts)
    for ln in lines: pts = np.vstack([pts, ln['P']])
    tri = Delaunay(pts)
    sim = tri.simplices
    cen = pts[sim].mean(1)
    cc = np.clip(((cen[:, 0] - C.x0) / RC).astype(int), 0, C.W - 1); rr = np.clip(((cen[:, 1] - C.z0) / RC).astype(int), 0, C.H - 1)
    keep = A[rr, cc]
    e = np.linalg.norm(pts[sim[:, [0, 1, 2]]] - pts[sim[:, [1, 2, 0]]], axis=2).max(1)
    keep &= e < 3.2
    sim = sim[keep]
    # deck height: raised neighbourhood -> slab top
    P3 = []
    for t in sim:
        a, b, c = pts[t]
        if np.cross(b - a, c - a) > 0: b, c = c, b                       # y-up winding (x right, z down the map)
        cx, cz = (a + b + c) / 3
        ci, ri = int((cx - C.x0) / RC), int((cz - C.z0) / RC)
        y = DECK_Y
        rad = 6
        sub = C.raised[max(ri - rad, 0):ri + rad, max(ci - rad, 0):ci + rad]
        if sub.size and sub.mean() < 0.25: y = -0.02
        for p in (a, b, c): P3.append((p[0], y, p[1]))
    P3 = np.array(P3, np.float32)
    UV = (P3[:, [0, 2]] / 3.0).astype(np.float32)
    log('apron: %d triangles' % (len(P3) // 3))
    return P3, UV


# ------------------------------------------------------------------ textures
def make_textures():
    rng = np.random.default_rng(5)
    # granite ashlar wall: 4 m x 4 m tile, courses 0.5 m high, blocks 1.0-1.6 m long, dark staining low, coping band on the top 0.25 m of the tile
    S = 512
    img = np.zeros((S, S, 3), np.float32)
    base = np.array([152, 148, 140], np.float32)
    ch = S // 8
    for row in range(8):
        x = int(rng.integers(0, 60))
        while x < S + 200:
            w = int(rng.uniform(0.25, 0.4) * S)
            tone = rng.normal(0, 7, 3).mean()
            blk = base + tone + rng.normal(0, 3, 3)
            y0 = row * ch
            img[y0:y0 + ch, max(0, x):min(S, x + w)] = blk
            img[y0:y0 + ch, max(0, x):min(S, x + 2)] *= 0.74               # vertical joint
            x += w
        img[row * ch:row * ch + 2] *= 0.72
    noise = nd.gaussian_filter(rng.normal(0, 1, (S, S)), 1.5) * 9
    img += noise[..., None]
    # waterline staining: darker + greener toward the bottom (v = 0 is the bottom of the tile)
    v = np.linspace(1, 0, S)[:, None]
    stain = np.clip((0.55 - v) / 0.55, 0, 1) ** 1.3
    img *= (1 - 0.22 * stain)[..., None]; img[..., 1] += 5 * stain
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(EXTRA, 'waterfront_wall.webp'), 'WEBP', quality=88, method=6)
    # deck: granite pavers 0.6 x 0.6 m with joints, tile 3 m
    img = np.zeros((S, S, 3), np.float32) + np.array([138, 134, 126], np.float32)
    cs = S // 5
    for i in range(5):
        for j in range(5):
            img[i * cs:(i + 1) * cs, j * cs:(j + 1) * cs] += rng.normal(0, 6)
    img += nd.gaussian_filter(rng.normal(0, 1, (S, S)), 1.2)[..., None] * 8
    for i in range(5):
        img[i * cs:i * cs + 2] *= 0.7; img[:, i * cs:i * cs + 2] *= 0.7
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(EXTRA, 'waterfront_deck.webp'), 'WEBP', quality=88, method=6)


# ------------------------------------------------------------------ placements along the quay
def runs(valid):
    """contiguous index runs of a closed polyline where valid, as lists of indices (wrap-aware)"""
    n = len(valid)
    if valid.all(): return [list(range(n))]
    start = next(i for i in range(n) if not valid[i])
    out, cur = [], []
    for k in range(1, n + 1):
        i = (start + k) % n
        if valid[i]: cur.append(i)
        elif cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return [r for r in out if len(r) > 8]


def behind_width(C, bld, x, z, nx, nz, maxd=14.0):
    """pavement depth behind the quay (towards the land): raised, not a building"""
    d = 0.9
    while d < maxd:
        c, r = int((x - nx * d - C.x0) / RC), int((z - nz * d - C.z0) / RC)
        if not (0 <= r < C.H and 0 <= c < C.W) or not C.raised[r, c] or bld[r, c]: return d
        d += 0.5
    return maxd


def open_water(C, x, z, nx, nz, dist=45.0):
    """fraction of water cells straight out from the quay"""
    k = n = 0
    d = 3.0
    while d < dist:
        c, r = int((x + nx * d - C.x0) / RC), int((z + nz * d - C.z0) / RC)
        if 0 <= r < C.H and 0 <= c < C.W: n += 1; k += 0 if C.land[r, c] else 1
        d += 1.5
    return k / max(n, 1)


def yaw_out(n):
    """yaw that maps a model's +X onto the outward (water) normal n"""
    return round(math.atan2(-n[1], n[0]), 3)


def place(C, lines, rng):
    ids = np.load(os.path.join(OUT, 'nyc_mask.npz'))['ids'] > 0
    P = dict(rail_iron=[], rail_cable=[], bollard=[], lamp=[], ring=[], ladder=[], bench=[])
    seats, berths, shore = [], [], []
    for li, ln in enumerate(lines):
        W, N, T = ln['P'], ln['N'], ln['T']
        for run in runs(ln['valid']):
            idx = np.array(run)
            w = np.array([behind_width(C, ids, W[i][0], W[i][1], N[i][0], N[i][1]) for i in idx])
            walk = w >= 2.2                                          # pavement behind: people can stand here
            shore.append([[round(float(W[i][0]), 1), round(float(W[i][1]), 1)] for i in idx[::2]])
            L = len(idx)
            # ladders first: the railing leaves a 3 m opening at each
            ladders = list(range(40, L, 90))
            for k in ladders:
                i = idx[k]
                P['ladder'].append([round(float(W[i][0]), 2), round(float(W[i][1]), 2), yaw_out(N[i])])
            for k in range(0, L - 2, 2):
                i, j = idx[k], idx[min(k + 2, L - 1)]
                if not walk[k] or any(abs(k - m) < 3 for m in ladders): continue
                seg = W[j] - W[i]; ln_ = float(np.hypot(*seg))
                if ln_ < 0.5: continue
                mid = (W[i] + W[j]) / 2 - N[i] * 0.42
                yaw = round(math.atan2(-seg[1] / ln_, seg[0] / ln_) + math.pi / 2, 3)             # model long axis is Z
                south = mid[1] > 640                                                              # Battery: black iron fence, Seaport/FDR: steel + timber
                (P['rail_iron'] if south else P['rail_cable']).append([round(float(mid[0]), 2), round(float(mid[1]), 2), yaw, round(ln_ / 2.0, 3)])
            for k in range(6, L, int(rng.integers(17, 25))):         # bollards on the edge
                i = idx[k]
                if w[k] < 1.5: continue
                P['bollard'].append([round(float(W[i][0] - N[i][0] * 0.55), 2), round(float(W[i][1] - N[i][1] * 0.55), 2), yaw_out(N[i])])
            for k in range(10, L, 32):                               # lamps on wide promenades
                i = idx[k]
                if w[k] < 5.0: continue
                P['lamp'].append([round(float(W[i][0] - N[i][0] * 1.6), 2), round(float(W[i][1] - N[i][1] * 1.6), 2), yaw_out(N[i])])
            for k in range(25, L, 72):                               # life rings
                i = idx[k]
                if w[k] < 2.2 or any(abs(k - m) < 4 for m in ladders): continue
                P['ring'].append([round(float(W[i][0] - N[i][0] * 0.42), 2), round(float(W[i][1] - N[i][1] * 0.42), 2), yaw_out(N[i])])
            for k in range(18, L, 40):                               # benches facing the water on promenades >= 6 m deep
                i = idx[k]
                if w[k] < 6.0: continue
                bx, bz = W[i][0] - N[i][0] * 1.9, W[i][1] - N[i][1] * 1.9
                P['bench'].append([round(float(bx), 2), round(float(bz), 2), yaw_out(N[i])])
                tx, tz = -N[i][1], N[i][0]                           # model +Z in world
                seats.append(dict(x=round(float(bx), 2), z=round(float(bz), 2), f=round(math.atan2(N[i][0], N[i][1]), 3), type='wfbench',
                                  slots=[[round(float(bx + tx * o), 2), round(float(bz + tz * o), 2)] for o in (-0.5, 0.5)]))
            k = 12                                                   # mooring berths: straight stretches with open water and pavement behind
            while k < L - 12:
                seg = idx[k:k + 40] if k + 40 <= L else idx[k:]
                if len(seg) < 30: break
                ang = np.arctan2(T[seg][:, 1], T[seg][:, 0]); dev = np.abs(np.angle(np.exp(1j * (ang - ang[0])))).max()
                i = idx[k + len(seg) // 2]
                if dev < 0.12 and w[k:k + len(seg)].min() >= 2.5 and open_water(C, W[i][0], W[i][1], N[i][0], N[i][1]) > 0.97:
                    berths.append(dict(x=float(W[i][0]), z=float(W[i][1]), nx=float(N[i][0]), nz=float(N[i][1]), len=float(len(seg))))
                    k += 70
                else: k += 6
    log('railings iron %d cable %d, bollards %d, lamps %d, rings %d, ladders %d, benches %d, berth stretches %d' % (
        len(P['rail_iron']), len(P['rail_cable']), len(P['bollard']), len(P['lamp']), len(P['ring']), len(P['ladder']), len(P['bench']), len(berths)))
    return P, seats, berths, shore


# boat roster: type -> (length, beam). Moored boats are picked per berth; the same models sail the harbour routes.
BOATS = {'tug_tow': (66.0, 11.5), 'tallship': (62.0, 11.0), 'ferry_nyw': (36.0, 9.0), 'tug': (24.0, 8.0), 'barge': (40.0, 12.0), 'yacht': (22.0, 6.0), 'sailboat': (15.0, 4.6), 'tour': (30.0, 8.0), 'taxi': (14.0, 4.2)}


def assign_berths(berths, rng):
    out = []
    order = rng.permutation(len(berths))
    cycle = ['ferry_nyw', 'tug', 'barge', 'yacht', 'sailboat', 'tour', 'taxi', 'tug_tow']
    hero = min(range(len(berths)), key=lambda i: math.hypot(berths[i]['x'] - 600, berths[i]['z'] - 436)) if berths else -1   # the scan's own tall-ship hull stood here
    for n, i in enumerate(order):
        b = berths[i]
        kind = 'tallship' if i == hero else cycle[n % len(cycle)]
        L, B = BOATS[kind]
        if L > b['len'] + 8 and kind != 'tallship': kind = ['taxi', 'sailboat', 'yacht'][n % 3]; L, B = BOATS[kind]
        off = B / 2 + 0.9
        out.append(dict(type=kind, x=round(b['x'] + b['nx'] * off, 2), z=round(b['z'] + b['nz'] * off, 2), yaw=round(math.atan2(-b['nz'], b['nx']), 3), len=L, beam=B))
    return out


def preview(C, lines, A, path, boxes):
    from PIL import ImageDraw
    for name, (xa, xb, za, zb, sc) in boxes.items():
        xb = min(xb, C.x0 + C.W * RC - 1); zb = min(zb, C.z0 + C.H * RC - 1)
        c0, r0 = int((xa - C.x0) / RC), int((za - C.z0) / RC); c1, r1 = int((xb - C.x0) / RC), int((zb - C.z0) / RC)
        img = np.zeros((r1 - r0, c1 - c0, 3), np.uint8); img[:] = (20, 60, 90)
        img[A[r0:r1, c0:c1]] = (200, 160, 60); img[C.land[r0:r1, c0:c1]] = (90, 90, 90); img[(C.raised & C.land)[r0:r1, c0:c1]] = (140, 140, 130)
        im = Image.fromarray(img).resize((int((xb - xa) * sc), int((zb - za) * sc)), Image.NEAREST); d = ImageDraw.Draw(im)
        P = lambda x, z: ((x - xa) * sc, (z - za) * sc)
        for ln in lines:
            W = ln['P']
            for i in range(len(W) - 1):
                if ln['valid'][i] and xa < W[i][0] < xb and za < W[i][1] < zb: d.line([P(*W[i]), P(*W[i + 1])], fill=(255, 60, 60), width=2)
        for kind, col in (('bollards', (255, 255, 0)), ('lamps', (0, 255, 255)), ('benches', (60, 255, 90)), ('rings', (255, 120, 0))):
            for q in preview.extra.get(kind, []):
                if xa < q[0] < xb and za < q[1] < zb: d.ellipse([P(q[0] - .5, q[1] - .5), P(q[0] + .5, q[1] + .5)], fill=col)
        for m in preview.extra.get('berths', []):
            if xa < m['x'] < xb and za < m['z'] < zb: d.line([P(m['x'] - math.sin(m['yaw']) * m['len'] / 2, m['z'] - math.cos(m['yaw']) * m['len'] / 2), P(m['x'] + math.sin(m['yaw']) * m['len'] / 2, m['z'] + math.cos(m['yaw']) * m['len'] / 2)], fill=(255, 0, 255), width=4)
        im.save(os.path.join(path, name + '.png'))


preview.extra = {}


# leftover photogrammetry shards in the water / on the piers (the Peking's hull, mooring lines): triangles whose centroid lies in these boxes (x0, x1, z0, z1) and above 0.3 m are dropped at load
SCAN_CLEAN = [[558, 642, 408, 456], [545, 612, 310, 356]]


# ------------------------------------------------------------------ harbour routes (world metres, x east, z south). All in open water.
ROUTES = {
    # name: (boat types, speed m/s, closed loop?, waypoints)
    'si_ferry_out': dict(types=['ferry_si'], speed=7.5, loop=False, pts=[[205, 905], [260, 1060], [400, 1400], [250, 2100]], period=420),
    'si_ferry_in': dict(types=['ferry_si'], speed=7.5, loop=False, pts=[[250, 2100], [420, 1400], [280, 1060], [215, 912]], period=420),
    'nyw_east': dict(types=['ferry_nyw'], speed=9.5, loop=False, pts=[[655, 505], [900, 380], [1200, 150], [1700, -100]], period=300),
    'nyw_west': dict(types=['ferry_nyw'], speed=9.5, loop=False, pts=[[1700, -80], [1200, 170], [900, 400], [668, 520]], period=300),
    'tug_barge': dict(types=['tug_tow'], speed=2.6, loop=False, pts=[[1500, 300], [1000, 330], [760, 380], [1000, 330], [1500, 300]], period=600),
    'tour_loop': dict(types=['tour'], speed=6.0, loop=True, pts=[[420, 900], [520, 780], [700, 690], [760, 560], [700, 690], [520, 780]], period=0),
    'sail_loop': dict(types=['sailboat', 'yacht'], speed=2.6, loop=True, pts=[[330, 960], [480, 1040], [620, 960], [560, 840], [420, 860]], period=0),
    'taxi_run': dict(types=['taxi'], speed=11.0, loop=True, pts=[[660, 500], [900, 360], [700, 640], [450, 880], [700, 640], [900, 360]], period=0),
}


def dock_sites(C, berths, rng):
    """floating finger docks at the end of berthing stretches: 16 m out from the quay, 2.4 m wide, all-water check"""
    out = []
    for b in berths:
        tx, tz = -b['nz'], b['nx']
        for sgn in (1, -1):
            if rng.random() < 0.45: continue
            qx = b['x'] + tx * sgn * (b['len'] / 2 - 3); qz = b['z'] + tz * sgn * (b['len'] / 2 - 3)
            ok = True
            for d in (1.5, 5.0, 10.0, 16.0):
                for w in (-1.5, 0.0, 1.5):
                    x = qx + b['nx'] * d + tx * w; z = qz + b['nz'] * d + tz * w
                    c, r = int((x - C.x0) / RC), int((z - C.z0) / RC)
                    if not (0 <= r < C.H and 0 <= c < C.W) or C.land[r, c]: ok = False
            if ok:
                out.append([round(qx, 2), round(qz, 2), round(math.atan2(-b['nz'], b['nx']), 3)])
                break
    log('finger docks: %d' % len(out))
    return out


def check_routes(C):
    bad = 0
    for name, r in ROUTES.items():
        P = np.array(r['pts'], float)
        for a, b in zip(P[:-1], P[1:]):
            for t in np.linspace(0, 1, int(np.linalg.norm(b - a) / 6) + 2):
                x, z = a + (b - a) * t
                c, rr = int((x - C.x0) / RC), int((z - C.z0) / RC)
                if 0 <= rr < C.H and 0 <= c < C.W and C.land[rr, c]:
                    log('ROUTE %s crosses land near (%.0f, %.0f)' % (name, x, z)); bad += 1; break
    return bad


def main():
    t0 = time.time()
    C = Ctx()
    rng = np.random.default_rng(404)
    os.makedirs(EXTRA, exist_ok=True)
    A = apron_mask(C)
    log('apron cells: %d (%.0f m2)' % (A.sum(), A.sum() * RC * RC))
    lines = quay_lines(C, A)
    wp, wn, wuv = wall_mesh(C, lines)
    ap, auv = apron_mesh(C, lines, A)
    log('wall %d tris, apron %d tris' % (len(wp) // 3, len(ap) // 3))
    make_textures()
    P, seats, berths, shore = place(C, lines, rng)
    boats = assign_berths(berths, rng)
    docks = dock_sites(C, berths, rng)
    P['dock'] = docks
    bad = check_routes(C)
    # binary parts
    blob = b''
    parts = {}

    def put(name, arr):
        nonlocal blob
        blob += b'\0' * ((-len(blob)) % 4)
        parts[name] = dict(o=len(blob), n=int(arr.size), t=str(arr.dtype))
        blob += np.ascontiguousarray(arr).tobytes()
    put('wall_p', wp); put('wall_n', wn); put('wall_uv', wuv); put('apron_p', ap); put('apron_uv', auv)
    Ab = np.packbits(A.reshape(-1), bitorder='little')
    put('apron_bits', Ab)
    for k, v in P.items(): put('pl_' + k, np.array(v, np.float32).reshape(-1))
    meta = dict(v=1, parts=parts, frame=dict(x0=C.x0, z0=C.z0, rc=RC, w=C.W, h=C.H), counts={k: len(v) for k, v in P.items()}, deckY=DECK_Y, wallBottom=WALL_BOTTOM,
                boats=boats, routes=ROUTES, scanClean=SCAN_CLEAN, crowd=dict(seats=seats, shore=shore))
    with gzip.open(os.path.join(EXTRA, 'waterfront_data.bin.gz'), 'wb', compresslevel=9) as f: f.write(blob)
    with open(os.path.join(EXTRA, 'waterfront_meta.json'), 'w') as f: json.dump(meta, f, separators=(',', ':'))
    log('waterfront_data.bin.gz %.2f MB, meta %.2f MB, %d berthed boats, %d bad routes' % (os.path.getsize(os.path.join(EXTRA, 'waterfront_data.bin.gz')) / 1048576, os.path.getsize(os.path.join(EXTRA, 'waterfront_meta.json')) / 1048576, len(boats), bad))
    if '--preview' in sys.argv:
        pd = sys.argv[sys.argv.index('--preview') + 1]; os.makedirs(pd, exist_ok=True)
        preview.extra = dict(bollards=[[q[0], q[1]] for q in P['bollard']], lamps=[[q[0], q[1]] for q in P['lamp']], benches=[[q[0], q[1]] for q in P['bench']], rings=[[q[0], q[1]] for q in P['ring']],
                             berths=[dict(x=b['x'], z=b['z'], yaw=b['yaw'], len=b['len']) for b in boats])
        preview(C, lines, A, pd, dict(wf_seaport=(420, 640, 200, 480, 4), wf_battery=(90, 400, 620, 900, 3)))
    log('done %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    main()
