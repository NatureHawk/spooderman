"""Bake the scan's photogrammetry colour onto the NYC buildings (and optionally the ground).

Every planar NYC surface group (a roof surface, or a building's coplanar wall pieces) becomes a chart in one
PAGE x PAGE texture atlas (texel size picked so everything fits; UV layout and output format unchanged: per-vertex
UVs into nyc_atlas.webp). For each texel inside its chart:

  1. registration: each building gets its own small XZ offset (<= 4 m) that best lines its roofs up with the
     scan's top-down height map (the global affine leaves a few metres of local error, which used to sample the
     street / the next facade near every edge);
  2. sampling: a wall texel casts a ray from outside the facade (not past the neighbour across the alley) back
     through it and takes the first scan surface that is oriented like the facade and is not vegetation (trees in
     front are skipped); a roof texel casts down from above and takes the first roof-like surface;
  3. reliability 0..1 per texel: distance of that scan surface from the NYC plane, its orientation, and how
     stretched the scan's own texture is on that triangle (photogrammetry smears unseen surfaces with a few pixels
     stretched over metres: those are exactly the streaks);
  4. fill: unreliable texels are rebuilt from the SAME surface's reliable texels, first by repeating its own
     floor-to-floor (vertical) and bay (horizontal) period found by autocorrelation, then push-pull inpainting;
     a surface with almost nothing reliable copies the building's best facade at the same height (walls) or its
     best roof (roofs). Nothing is ever stretched;
  5. texels outside the surface polygons (chart padding, roof-edge staircase) take the nearest inside texel.
"""
import time
import numpy as np
import cv2
import open3d as o3d
from scipy import ndimage as nd

PAGE = 8192
PAD = 3
R_OUT_MAX = 4.0     # wall rays start this far outside the facade (less where a neighbour is closer)
R_IN = 4.5          # ... and search this far behind it
ROOF_UP, ROOF_DN = 25.0, 10.0
REL = 0.45          # texels with reliability above this are kept as sampled
MAX_SHIFT = 13      # registration search radius in 0.5 m cells


def log(*a): print('[bake]', *a, flush=True)


class ScanSampler:
    def __init__(self, flat, tex):
        self.P, self.fi, self.ti, self.VT = flat['P'], flat['fi'], flat['ti'], flat['VT']
        self.tex = tex; self.TH, self.TW = tex.shape[:2]
        self.texf = tex.astype(np.float32)
        self.scene = o3d.t.geometry.RaycastingScene()
        self.scene.add_triangles(o3d.core.Tensor(self.P.astype(np.float32)), o3d.core.Tensor(self.fi.astype(np.uint32)))
        T = self.P[self.fi].astype(np.float64)
        e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
        n = np.cross(e1, e2); a2 = np.linalg.norm(n, axis=1)
        self.nrm = (n / np.maximum(a2, 1e-12)[:, None]).astype(np.float32)   # winding is NOT consistent in the scan
        # texture stretch: smallest singular value of the (triangle plane -> texture pixels) map, px per metre
        U = self.VT[self.ti].astype(np.float64) * [self.TW, self.TH]
        ax = e1 / np.maximum(np.linalg.norm(e1, axis=1, keepdims=True), 1e-12)
        ay = np.cross(n / np.maximum(a2, 1e-12)[:, None], ax)
        X = np.stack([np.stack([(e1 * ax).sum(1), (e1 * ay).sum(1)], 1), np.stack([(e2 * ax).sum(1), (e2 * ay).sum(1)], 1)], 2)
        Um = np.stack([U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]], 2)
        det = X[:, 0, 0] * X[:, 1, 1] - X[:, 0, 1] * X[:, 1, 0]
        ok = np.abs(det) > 1e-8
        J = np.zeros((len(T), 2, 2)); J[ok] = Um[ok] @ np.linalg.inv(X[ok])
        self.smin = np.linalg.svd(J, compute_uv=False)[:, 1].astype(np.float32)

    def color_at(self, prim, bary):
        """prim ids + barycentric (u,v) from open3d -> RGB from the scan texture (bilinear)"""
        U = self.VT[self.ti[prim]]                   # (n,3,2)
        u, v = bary[:, 0:1], bary[:, 1:2]
        uv = U[:, 0] * (1 - u - v) + U[:, 1] * u + U[:, 2] * v
        x = np.clip(uv[:, 0] * self.TW - 0.5, 0, self.TW - 1.001); y = np.clip((1 - uv[:, 1]) * self.TH - 0.5, 0, self.TH - 1.001)
        x0, y0 = x.astype(int), y.astype(int); fx, fy = (x - x0)[:, None], (y - y0)[:, None]
        t = self.texf
        c = (t[y0, x0] * (1 - fx) * (1 - fy) + t[y0, x0 + 1] * fx * (1 - fy) + t[y0 + 1, x0] * (1 - fx) * fy + t[y0 + 1, x0 + 1] * fx * fy)
        return c

    def cast(self, org, d):
        r = np.concatenate([org, d], 1).astype(np.float32)
        a = self.scene.cast_rays(o3d.core.Tensor(r))
        return a['t_hit'].numpy().astype(np.float64), a['primitive_ids'].numpy().astype(np.int64), a['primitive_uvs'].numpy()

    def first_surface(self, org, d, tmax, accept, iters=4):
        """walk each ray through the scan (up to `iters` surfaces) until accept(prim, colour, idx) says yes.
        -> t (inf: none), prim, bary, colour"""
        n = len(org)
        T = np.full(n, np.inf); PR = np.full(n, -1, np.int64); BA = np.zeros((n, 2), np.float32); CO = np.zeros((n, 3), np.float32)
        start = np.zeros(n); act = np.arange(n)
        for _ in range(iters):
            if not len(act): break
            th, prim, bary = self.cast(org[act] + d[act] * start[act, None], d[act])
            tt = start[act] + th
            hit = np.isfinite(th) & (tt <= tmax[act])
            act, tt, prim, bary = act[hit], tt[hit], prim[hit], bary[hit]
            col = self.color_at(prim, bary)
            ok = accept(prim, col, act)
            a = act[ok]; T[a] = tt[ok]; PR[a] = prim[ok]; BA[a] = bary[ok]; CO[a] = col[ok]
            act = act[~ok]; start[act] = tt[~ok] + 0.03
        return T, PR, BA, CO

    def sample(self, pts, nrm, reach):
        """legacy: colour for surface points (ray from outside along n back through the surface, else nearest point)"""
        n = len(pts); out = np.zeros((n, 3), np.float32)
        for s in range(0, n, 2_000_000):
            p, q, r = pts[s:s + 2_000_000], nrm[s:s + 2_000_000], reach[s:s + 2_000_000]
            th, prim, bary = self.cast(p + q * r[:, None], -q)
            hit = th < r * 2.2
            c = np.zeros((len(p), 3), np.float32)
            if hit.any(): c[hit] = self.color_at(prim[hit], bary[hit])
            miss = ~hit
            if miss.any():
                cl = self.scene.compute_closest_points(o3d.core.Tensor(p[miss].astype(np.float32)))
                c[miss] = self.color_at(cl['primitive_ids'].numpy().astype(np.int64), cl['primitive_uvs'].numpy())
            out[s:s + len(p)] = c
        return out


def vegetation(c):
    return (c[:, 1] > c[:, 0] * 1.05) & (c[:, 1] > c[:, 2] * 0.98)


def ramp(x, a, b):
    return np.clip((x - a) / (b - a), 0, 1)


# ------------------------------------------------------------------------------------------------ registration
def scan_topdown(sampler, frame, shape):
    """the scan seen from straight above on the (X0, Z0, RC) grid: first-hit height (>= 0) and colour"""
    X0, Z0, RC = frame; GH, GW = shape
    cx = X0 + (np.arange(GW) + 0.5) * RC; cz = Z0 + (np.arange(GH) + 0.5) * RC
    Hs = np.zeros((GH, GW), np.float32); Cs = np.zeros((GH, GW, 3), np.float32)
    for r0 in range(0, GH, 400):
        X, Z = np.meshgrid(cx, cz[r0:r0 + 400])
        o = np.stack([X.ravel(), np.full(X.size, 1500.0), Z.ravel()], 1)
        th, prim, bary = sampler.cast(o, np.tile([[0, -1.0, 0]], (len(o), 1)))
        hit = np.isfinite(th)
        Hs[r0:r0 + 400] = np.where(hit, 1500 - th, 0).reshape(X.shape)
        c = np.zeros((len(o), 3), np.float32); c[hit] = sampler.color_at(prim[hit], bary[hit])
        Cs[r0:r0 + 400] = c.reshape(X.shape + (3,))
    return np.maximum(Hs, 0), Cs


def register(blds, sampler, frame, shape, Hs=None):
    """per-building offset (dx, dz, dy) m lining its roofs up with the scan's top-down height map"""
    t0 = time.time()
    X0, Z0, RC = frame; GH, GW = shape
    if Hs is None: Hs = scan_topdown(sampler, frame, shape)[0]
    Hn = np.zeros((GH, GW), np.float32); Bn = np.full((GH, GW), -1, np.int32)     # NYC top height + whose roof
    polys = []
    for bi, b in enumerate(blds):
        T = b['T']; n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        up = n[:, 1] > 0.3 * np.linalg.norm(n, axis=1)
        for tri in T[up]: polys.append((tri[:, 1].mean(), bi, tri))
    polys.sort(key=lambda p: p[0])
    for h, bi, tri in polys:
        q = np.round(np.stack([(tri[:, 0] - X0) / RC, (tri[:, 2] - Z0) / RC], 1) * 8).astype(np.int32)
        cv2.fillPoly(Hn, [q], float(h), shift=3); cv2.fillPoly(Bn, [q], bi, shift=3)
    # the residual is a smooth warp (up to ~5 m in the north, ~1 m in the south): per-building best shift, then
    # each building takes the median of its neighbourhood unless its own fit is clearly better
    M = MAX_SHIFT; own, costs, cen = [], [], []
    for b in blds:
        T = b['T']; cen.append((T[..., 0].mean(), T[..., 2].mean()))
        c0 = int((T[..., 0].min() - X0) / RC) - 12; c1 = int((T[..., 0].max() - X0) / RC) + 12
        r0 = int((T[..., 2].min() - Z0) / RC) - 12; r1 = int((T[..., 2].max() - Z0) / RC) + 12
        if c0 - M < 0 or r0 - M < 0 or c1 + M >= GW or r1 + M >= GH: own.append((0, 0)); costs.append(None); continue
        W = Hn[r0:r1, c0:c1]
        wt = 1.0 + (W > 0)                               # the building's own area counts double
        cost = np.full((2 * M + 1, 2 * M + 1), np.inf)
        for dy in range(-M, M + 1):
            for dx in range(-M, M + 1):
                S = Hs[r0 + dy:r1 + dy, c0 + dx:c1 + dx]
                cost[dy + M, dx + M] = float((np.minimum(np.abs(W - S), 15.0) * wt).mean())
        k = np.unravel_index(np.argmin(cost), cost.shape)
        own.append((k[1] - M, k[0] - M)); costs.append(cost)
    own = np.array(own, float); cen = np.array(cen)
    offs = np.zeros((len(blds), 2))
    for i in range(len(blds)):
        d = np.hypot(*(cen - cen[i]).T); nb = (d < 120) & np.array([c is not None for c in costs])
        sm = np.round(np.median(own[nb], 0)) if nb.sum() >= 3 else own[i]
        if costs[i] is None: continue
        cs = costs[i][int(sm[1]) + M, int(sm[0]) + M]; co = costs[i][int(own[i, 1]) + M, int(own[i, 0]) + M]
        offs[i] = (own[i] if co < 0.93 * cs and np.hypot(*(own[i] - sm)) <= 5 else sm) * RC
    # vertical: the flattened scan's roofs sit a few metres off the DCP roofs (median -2.5 m, locally -7..+1 m; the
    # scan's ground estimate under big blocks): per building, median of scan - NYC height over its own roof cells
    dy = np.full(len(blds), np.nan)
    sl = nd.find_objects(Bn + 1)
    for i in range(len(blds)):
        if i >= len(sl) or sl[i] is None: continue
        r, c = sl[i]
        m = nd.binary_erosion(Bn[r, c] == i, iterations=2)
        if m.sum() < 30: continue
        sx, sz = int(round(offs[i, 0] / RC)), int(round(offs[i, 1] / RC))
        rr, cc = np.nonzero(m); rr = rr + r.start; cc = cc + c.start
        ok = (rr + sz >= 0) & (rr + sz < GH) & (cc + sx >= 0) & (cc + sx < GW)
        d_ = Hs[rr[ok] + sz, cc[ok] + sx] - Hn[rr[ok], cc[ok]]
        if len(d_) < 30: continue
        q25, q50, q75 = np.percentile(d_, [25, 50, 75])
        if q75 - q25 < 6: dy[i] = q50
    good = np.isfinite(dy)
    for i in range(len(blds)):
        if good[i]: continue
        d = np.hypot(*(cen - cen[i]).T); nb = (d < 150) & good
        dy[i] = np.median(dy[nb]) if nb.sum() >= 3 else 0.0
    dy = np.clip(dy, -10, 4)
    h = np.hypot(*offs.T)
    log('registration: median |offset| %.2f m, 90%% %.2f m, max %.2f m; vertical median %.2f m, 10-90%% %.1f..%.1f m (%.1fs)'
        % (np.median(h), np.percentile(h, 90), h.max(), np.median(dy), np.percentile(dy, 10), np.percentile(dy, 90), time.time() - t0))
    return np.concatenate([offs, dy[:, None]], 1)


# ------------------------------------------------------------------------------------------------ fill helpers
def push_pull(C, W):
    """fill where W == 0 from the weighted colours around (pyramid); C (h,w,3), W (h,w) >= 0"""
    levels = []
    c, w = C * W[..., None], W.astype(np.float32).copy()
    while True:
        levels.append((c, w))
        if min(c.shape[:2]) <= 1: break
        h2, w2 = (c.shape[0] + 1) // 2, (c.shape[1] + 1) // 2
        cp = np.zeros((h2 * 2, w2 * 2, 3), np.float32); cp[:c.shape[0], :c.shape[1]] = c
        wp = np.zeros((h2 * 2, w2 * 2), np.float32); wp[:w.shape[0], :w.shape[1]] = w
        c = cp.reshape(h2, 2, w2, 2, 3).sum((1, 3)); w = wp.reshape(h2, 2, w2, 2).sum((1, 3))
        if w.max() <= 0: break
    c, w = levels[-1]
    col = c / np.maximum(w, 1e-6)[..., None]
    for c_, w_ in reversed(levels[:-1]):
        up = np.repeat(np.repeat(col, 2, 0), 2, 1)[:c_.shape[0], :c_.shape[1]]
        up = cv2.GaussianBlur(up, (3, 3), 0.8) if min(up.shape[:2]) >= 3 else up
        a = np.clip(w_, 0, 1)[..., None]
        col = np.where(w_[..., None] > 0, (c_ / np.maximum(w_, 1e-6)[..., None]) * a + up * (1 - a), up)
    return col


def period(L, R, lo, hi, axis):
    """dominant repeat (in texels) of luminance L along axis over reliable texels R, within [lo, hi]; (lag, score)"""
    if hi < lo or L.shape[axis] <= lo + 2: return None, 0.0
    Lm = np.where(R, L - (L[R].mean() if R.any() else 0), 0.0)
    best, bs = None, 0.0
    n = L.shape[axis]
    for lag in range(lo, min(hi, n - 2) + 1):
        a = Lm.take(range(0, n - lag), axis); b = Lm.take(range(lag, n), axis)
        ra = R.take(range(0, n - lag), axis) & R.take(range(lag, n), axis)
        if ra.sum() < 20: continue
        num = (a * b * ra).sum(); den = np.sqrt((a * a * ra).sum() * (b * b * ra).sum()) + 1e-6
        s = num / den
        if s > bs: best, bs = lag, s
    return best, bs


def periodic_fill(C, R, hole, P, axis, kmax=12):
    """copy into hole texels from reliable texels k*P away along axis (nearest first)"""
    out = C.copy(); todo = hole.copy(); n = C.shape[axis]
    for k in range(1, kmax + 1):
        for sgn in (1, -1):
            s = sgn * k * P
            if abs(s) >= n or not todo.any(): continue
            src = np.zeros_like(R); srcC = np.zeros_like(C)
            if axis == 0:
                if s > 0: src[:-s] = R[s:]; srcC[:-s] = C[s:]
                else: src[-s:] = R[:s]; srcC[-s:] = C[:s]
            else:
                if s > 0: src[:, :-s] = R[:, s:]; srcC[:, :-s] = C[:, s:]
                else: src[:, -s:] = R[:, :s]; srcC[:, -s:] = C[:, :s]
            m = todo & src
            out[m] = srcC[m]; todo &= ~m
    return out, todo


def fill_chart(C, Q, M, kind, D):
    """C (h,w,3) sampled colour, Q reliability, M texels inside the surface -> filled colour, reliable fraction"""
    R = M & (Q > REL)
    nM = max(int(M.sum()), 1); fr = R.sum() / nM
    hole = M & ~R
    out = C.copy()
    if hole.any() and R.sum() >= 12:
        if kind == 'wall':
            L = C.mean(2)
            Py, _ = period(L, R, int(np.ceil(2.7 / D)), int(np.floor(6.0 / D)), 0)
            Py = Py or int(round(3.9 / D))
            out, todo = periodic_fill(out, R, hole, Py, 0)
            if todo.any():
                Rx = M & ~todo
                Px, sx = period(L, R, int(np.ceil(1.2 / D)), int(np.floor(9.0 / D)), 1)
                if Px and sx > 0.2: out, todo = periodic_fill(out, Rx, todo, Px, 1)
        else:
            todo = hole
        if todo.any():
            W = (M & ~todo).astype(np.float32) * np.maximum(Q, 0.5) * (~todo)
            pp = push_pull(out, W)
            out[todo] = pp[todo]
    return out, fr


def extend(C, M):
    """texels outside M take the nearest texel inside M"""
    if M.all() or not M.any(): return C
    idx = nd.distance_transform_edt(~M, return_distances=False, return_indices=True)
    return C[idx[0], idx[1]]


# ------------------------------------------------------------------------------------------------ main bake
def bake_buildings(blds, sampler, ids=None, frame=None, **kw):
    """blds[k]['S'] = list of (m,3,3) planar surface groups (world, ground-relative Y), blds[k]['Sk'] their kind
    ('roof' | 'wall'). Adds blds[k]['UV'] (n,3,2) in the order of concatenate(S) and returns (atlas uint8, texel m)."""
    t0 = time.time()
    if all('reg' in b for b in blds): offs = np.array([b['reg'] for b in blds], float)
    else: offs = register(blds, sampler, frame, ids.shape) if frame is not None and ids is not None else np.zeros((len(blds), 3))
    charts = []
    for bi, b in enumerate(blds):
        for si, T in enumerate(b['S']):
            e = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); n = e.sum(0); ln = np.linalg.norm(n)
            if ln < 1e-9: n = np.array([0, 1.0, 0]); ln = 1
            n = n / ln
            kind = b['Sk'][si] if 'Sk' in b else ('roof' if abs(n[1]) > 0.7 else 'wall')
            if abs(n[1]) > 0.7: ua, va = np.array([1.0, 0, 0]), np.array([0, 0, 1.0])
            else:
                ua = np.array([-n[2], 0, n[0]]); ua /= np.linalg.norm(ua) or 1; va = np.cross(n, ua); va /= np.linalg.norm(va) or 1
                if va[1] < 0: va = -va; ua = -ua
            V = T.reshape(-1, 3); s2 = np.stack([V @ ua, V @ va], 1)
            lo = s2.min(0); ext = s2.max(0) - lo
            charts.append({'b': bi, 's': si, 'n': n, 'u': ua, 'v': va, 'lo': lo, 'ext': ext, 'kind': kind,
                           'area': float(np.linalg.norm(e, axis=1).sum() / 2)})
    # texel size: fit everything (bbox area, with packing slack) into one page
    bbox = sum((c['ext'][0] + 1) * (c['ext'][1] + 1) for c in charts)
    D = max(0.25, float(np.sqrt(bbox * 1.2 / (PAGE * PAGE))))
    for _ in range(40):
        for c in charts: c['w'] = int(np.ceil(c['ext'][0] / D)) + 1 + 2 * PAD; c['h'] = int(np.ceil(c['ext'][1] / D)) + 1 + 2 * PAD
        order = sorted(range(len(charts)), key=lambda k: -charts[k]['h'])
        x = y = rowh = 0; ok = True
        for k in order:
            c = charts[k]
            if c['w'] > PAGE: ok = False; break
            if x + c['w'] > PAGE: x = 0; y += rowh; rowh = 0
            if y + c['h'] > PAGE: ok = False; break
            c['x'], c['y'] = x, y; x += c['w']; rowh = max(rowh, c['h'])
        if ok: break
        D *= 1.03
    log('%d charts, texel %.3f m, atlas %d^2' % (len(charts), D, PAGE))

    # per-vertex UVs + inside masks
    for b in blds: b['UV'] = [None] * len(b['S'])
    for c in charts:
        T = blds[c['b']]['S'][c['s']]; V = T.reshape(-1, 3)
        su = (V @ c['u'] - c['lo'][0]) / D + PAD; sv = (V @ c['v'] - c['lo'][1]) / D + PAD
        uv = np.stack([(c['x'] + su) / PAGE, 1 - (c['y'] + sv) / PAGE], 1)
        blds[c['b']]['UV'][c['s']] = uv.reshape(-1, 3, 2)
        M = np.zeros((c['h'], c['w']), np.uint8)
        q = np.round(np.stack([su - 0.5, sv - 0.5], 1).reshape(-1, 3, 2) * 16).astype(np.int32)
        cv2.fillPoly(M, list(q), 1, shift=4)
        cv2.polylines(M, list(q), True, 1, 1, shift=4)          # slivers narrower than a texel keep their edge texels
        c['M'] = M.astype(bool)
    for b in blds: b['UV'] = np.concatenate(b['UV'])

    # neighbour clearance for wall rays: NYC geometry scene (so a ray never starts inside the next building)
    allT = np.concatenate([b['T'] for b in blds]).astype(np.float32)
    nyc_scene = o3d.t.geometry.RaycastingScene()
    nyc_scene.add_triangles(o3d.core.Tensor(allT.reshape(-1, 3)), o3d.core.Tensor(np.arange(allT.shape[0] * 3, dtype=np.uint32).reshape(-1, 3)))

    atlas = np.zeros((PAGE, PAGE, 3), np.uint8)
    stats = {'tex': 0, 'rel': 0, 'donor': 0, 'raw': 0}
    fracs = np.zeros(len(charts))
    need_donor = []
    BATCH = 3_000_000
    k = 0
    while k < len(charts):
        batch = []; nt = 0
        while k < len(charts) and (nt < BATCH or not batch):
            c = charts[k]; batch.append(k); nt += int(c['M'].sum()); k += 1
        P, N, KW, OF, ci, jj_, ii_ = [], [], [], [], [], [], []
        for ck in batch:
            c = charts[ck]; jj, ii = np.nonzero(c['M'])
            su = c['lo'][0] + (ii - PAD + 0.5) * D; sv = c['lo'][1] + (jj - PAD + 0.5) * D
            T0 = blds[c['b']]['S'][c['s']][0, 0]; off = T0 @ c['n']
            p = su[:, None] * c['u'] + sv[:, None] * c['v'] + off * c['n']
            P.append(p); N.append(np.broadcast_to(c['n'], p.shape)); KW.append(np.full(len(p), c['kind'] == 'wall'))
            OF.append(np.broadcast_to(offs[c['b']], (len(p), 3))); ci.append(np.full(len(p), ck)); jj_.append(jj); ii_.append(ii)
        P, N, KW, OF, ci, jj_, ii_ = map(np.concatenate, (P, N, KW, OF, ci, jj_, ii_))
        col, q = sample_points(sampler, nyc_scene, P, N, KW, OF)
        stats['tex'] += len(P); stats['rel'] += int((q > REL).sum())
        o = 0
        for ck in batch:
            c = charts[ck]; m = int(c['M'].sum())
            C = np.zeros((c['h'], c['w'], 3), np.float32); Q = np.zeros((c['h'], c['w']), np.float32)
            C[jj_[o:o + m], ii_[o:o + m]] = col[o:o + m]; Q[jj_[o:o + m], ii_[o:o + m]] = q[o:o + m]; o += m
            out, fr = fill_chart(C, Q, c['M'], c['kind'], D)
            fracs[ck] = fr
            R = c['M'] & (Q > REL); c['nrel'] = int(R.sum()); c['csum'] = C[R].sum(0) if R.any() else np.zeros(3)
            if fr < 0.08 or (Q > REL).sum() < 12:
                need_donor.append(ck); c['raw'] = (C, Q)
            put(atlas, c, out)
        log('  %d/%d charts, %.0fs' % (k, len(charts), time.time() - t0))
    # walls with (almost) nothing reliable: the same building's best facade at the same height
    best = {}; bchart = {}
    for ck, c in enumerate(charts): bchart.setdefault(c['b'], []).append(ck)
    for ck, c in enumerate(charts):
        if fracs[ck] >= 0.3 and c['M'].sum() >= 40:
            key = (c['b'], c['kind']); score = fracs[ck] * c['M'].sum()
            if key not in best or score > best[key][0]: best[key] = (score, ck)
    for ck in need_donor:
        c = charts[ck]; dn = best.get((c['b'], c['kind'])) if c['kind'] == 'wall' else None
        if dn is None:
            # roofs (a tiled donor roof reads as an obvious repeat from above) and walls of buildings with nothing
            # reliable: the building's own mean reliable roof (else wall) colour with a faint grain, else the raw
            # samples heavily smoothed so no streak survives
            mean = None
            for kind, k_ in ((c['kind'], 1.0), ('wall' if c['kind'] == 'roof' else 'roof', 0.85)):
                n_ = sum(charts[j]['nrel'] for j in bchart[c['b']] if charts[j]['kind'] == kind)
                if n_ >= 40:
                    mean = sum(charts[j]['csum'] for j in bchart[c['b']] if charts[j]['kind'] == kind) / n_ * k_; break
            if mean is not None:
                rng = np.random.default_rng(ck)
                gr = cv2.resize(rng.normal(0, 1, (max(2, c['h'] // 6), max(2, c['w'] // 6))).astype(np.float32), (c['w'], c['h']), interpolation=cv2.INTER_CUBIC)
                out = mean[None, None] * (1 + 0.05 * gr[..., None] + 0.03 * rng.normal(0, 1, (c['h'], c['w'], 1)))
                put(atlas, c, out); stats['raw'] += 1; continue
            C, Q = c['raw']; W = c['M'].astype(np.float32) * np.maximum(Q, 0.05)
            sm = cv2.GaussianBlur(C * W[..., None], (0, 0), 2.5) / np.maximum(cv2.GaussianBlur(W, (0, 0), 2.5), 1e-4)[..., None]
            put(atlas, c, push_pull(sm, W)); stats['raw'] += 1; continue
        d = charts[dn[1]]
        src = atlas[d['y']:d['y'] + d['h'], d['x']:d['x'] + d['w']].astype(np.float32)
        dm = d['M']; cols = np.nonzero(dm.any(0))[0]; rows = np.nonzero(dm.any(1))[0]
        h, w = c['h'], c['w']
        jj, ii = np.mgrid[0:h, 0:w]
        if c['kind'] == 'wall':
            # same height above the ground (v axes are vertical, lo[1] = the lowest point) so floors line up;
            # heights beyond the donor wrap around its rows
            y = c['lo'][1] + (jj - PAD + 0.5) * D
            dj = np.round((y - d['lo'][1]) / D + PAD - 0.5).astype(int)
            r0, r1 = rows.min(), rows.max(); span = r1 - r0 + 1
            dj = np.where((dj < r0) | (dj > r1), r0 + (dj - r0) % span, dj)
        else:
            dj = rows.min() + jj % max(len(rows), 1)
        di = cols.min() + (ii % max(len(cols), 1))
        out = src[np.clip(dj, 0, d['h'] - 1), np.clip(di, 0, d['w'] - 1)]
        put(atlas, c, out); stats['donor'] += 1
    log('%d texels, %.0f%% reliable as sampled; %d walls from a donor facade, %d surfaces from the building mean colour / smoothed (%.0fs)'
        % (stats['tex'], 100 * stats['rel'] / max(stats['tex'], 1), stats['donor'], stats['raw'], time.time() - t0))
    return atlas, D


def put(atlas, c, out):
    """chart colour -> atlas: outside-surface texels extended from inside, mild unsharp mask, clipped"""
    out = extend(out.astype(np.float32), c['M'])
    blur = cv2.GaussianBlur(out, (0, 0), 1.2)
    out = out + 0.35 * (out - blur)
    atlas[c['y']:c['y'] + c['h'], c['x']:c['x'] + c['w']] = np.clip(out, 0, 255).astype(np.uint8)


def sample_points(S, nyc_scene, P, N, KW, OF):
    """colour + reliability for surface points P (normals N, wall flags KW, registration offsets OF)"""
    n = len(P); col = np.zeros((n, 3), np.float32); q = np.zeros(n, np.float32)
    Q = P.copy(); Q[:, 0] += OF[:, 0]; Q[:, 1] += OF[:, 2]; Q[:, 2] += OF[:, 1]
    w = np.nonzero(KW)[0]
    if len(w):
        p, nn = Q[w], N[w]
        # clearance to the next NYC surface in front of the facade (unshifted geometry)
        r = np.concatenate([P[w] + N[w] * 0.05, N[w]], 1).astype(np.float32)
        tc = nyc_scene.cast_rays(o3d.core.Tensor(r))['t_hit'].numpy()
        rout = np.clip(np.where(np.isfinite(tc), tc * 0.45, R_OUT_MAX), 0.6, R_OUT_MAX)
        org = p + nn * rout[:, None]
        def acc(prim, c, idx):
            return (np.abs((S.nrm[prim] * nn[idx]).sum(1)) > 0.3) & ~vegetation(c)
        t, prim, bary, c = S.first_surface(org, -nn, rout + R_IN, acc)
        hit = np.isfinite(t)
        dep = np.where(hit, t - rout, 99)                          # + : the scan's facade is behind the NYC plane
        a = np.where(hit, np.abs((S.nrm[np.maximum(prim, 0)] * nn).sum(1)), 0)
        sm = np.where(hit, S.smin[np.maximum(prim, 0)], 0)
        qq = ramp(a, 0.3, 0.6) * ramp(sm, 0.35, 0.9) * (1 - ramp(dep, 2.5, 4.4)) * (1 - ramp(-dep, 1.8, 3.8))
        col[w] = c; q[w] = np.where(hit, qq, 0)
    r_ = np.nonzero(~KW)[0]
    if len(r_):
        p = Q[r_]
        org = p + np.array([0, ROOF_UP, 0])
        def acc(prim, c, idx):
            return np.abs(S.nrm[prim][:, 1]) > 0.25
        dn = np.tile([[0, -1.0, 0]], (len(p), 1))
        t, prim, bary, c = S.first_surface(org, dn, np.full(len(p), ROOF_UP + ROOF_DN), acc, iters=3)
        hit = np.isfinite(t)
        dh = np.where(hit, ROOF_UP - t, -99)                       # + : the scan's roof is above the NYC roof
        a = np.where(hit, np.abs(S.nrm[np.maximum(prim, 0), 1]), 0)
        sm = np.where(hit, S.smin[np.maximum(prim, 0)], 0)
        qq = ramp(a, 0.25, 0.6) * ramp(sm, 0.35, 0.9) * (1 - ramp(dh, 6.0, 14.0)) * (1 - ramp(-dh, 3.0, 7.0))
        col[r_] = c; q[r_] = np.where(hit, qq, 0)
    return col, q


def bake_ground(sampler, X0, Z0, RC, GW, GH, fallback, footprint, labels):
    """top-down colour of the scan's ground-level triangles at RC metres; gaps from `fallback` (GH,GW,3)."""
    P, fi = sampler.P, sampler.fi
    T = P[fi]; cy = T[:, :, 1].mean(1)
    nz_ = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ny = np.abs(nz_[:, 1]) / (np.linalg.norm(nz_, axis=1) + 1e-12)
    cx = ((T[:, :, 0].mean(1) - X0) / RC).astype(int); cz = ((T[:, :, 2].mean(1) - Z0) / RC).astype(int)
    ok = (cx >= 0) & (cx < GW) & (cz >= 0) & (cz < GH)
    under = np.zeros(len(T), bool); under[ok] = footprint[cz[ok], cx[ok]]
    # street surface only: near-horizontal, near ground, not under a building (skirts / flattened roofs)
    g = np.nonzero((cy < 3.5) & (cy > -2.5) & (ny > 0.45) & ~under)[0]
    T = T[g]
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    area = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    n = np.clip(np.ceil(area / (RC * RC) * 3), 1, 20000).astype(np.int64)
    rng = np.random.default_rng(3)
    idx = np.repeat(np.arange(len(T)), n)
    img = np.zeros((GH * GW, 3), np.float32); cnt = np.zeros(GH * GW, np.float32)
    for s in range(0, len(idx), 3_000_000):
        ii = idx[s:s + 3_000_000]
        a = rng.random((len(ii), 1)); b = rng.random((len(ii), 1)); m = (a + b) > 1; a[m] = 1 - a[m]; b[m] = 1 - b[m]
        p = T[ii, 0] + e1[ii] * a + e2[ii] * b
        c_ = ((p[:, 0] - X0) / RC).astype(np.int64); r_ = ((p[:, 2] - Z0) / RC).astype(np.int64)
        ok = (c_ >= 0) & (c_ < GW) & (r_ >= 0) & (r_ < GH)
        bary = np.concatenate([a, b], 1)[ok].astype(np.float32)
        col = sampler.color_at(g[ii[ok]], bary)
        k = r_[ok] * GW + c_[ok]
        for ch in range(3): np.add.at(img[:, ch], k, col[:, ch])
        np.add.at(cnt, k, 1)
    have = cnt > 0
    img[have] /= cnt[have, None]
    img = img.reshape(GH, GW, 3); have = have.reshape(GH, GW)
    have = nd.binary_erosion(have, iterations=1)
    # recolour the linework fill per surface class to the scan's own average for that class, then blend softly
    fb = fallback.astype(np.float32)
    for lab in np.unique(labels):
        m = labels == lab; mh = m & have
        if mh.sum() > 500:
            k = img[mh].mean(0) / np.maximum(fb[mh].mean(0), 1)
            fb[m] *= k
    w = np.clip(nd.distance_transform_edt(have) / 6.0, 0, 1)[..., None]
    out = img * w + fb * (1 - w)
    log('ground bake: %.0f%% from the scan' % (100 * have.mean()))
    return np.clip(out, 0, 255).astype(np.uint8)
