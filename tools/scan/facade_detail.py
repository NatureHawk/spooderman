"""Facade detail analysis for the NYC buildings of the scan map (seed MAN).

The baked photo atlas (build_nyc.py -> nyc_atlas.webp, ~0.4 m/texel) keeps every building's real look but its windows are
soft blobs. This pass finds, per planar wall ("facade"), the window layout the photo actually shows, so the runtime
(src/03d_facade.js) can redraw those windows with razor-straight edges, dark reflective glass and night lights:

  1. every wall triangle is mapped back from atlas texels to facade coordinates (s = metres along the wall, y = height),
     coplanar walls of a building are merged, and each facade is resampled into a rectified image;
  2. floor rhythm (vertical) and bay rhythm (horizontal) come from the autocorrelation of the high-passed relative
     luminance, refined by a periodogram so the fold stays phase-coherent over a whole tower; folding the image on those
     periods gives the mean "unit cell", whose dark blob (Otsu split) is the window (size + phase) and whose shape tells
     punched windows / ribbon bands / curtain wall (a connected dark mullion grid over bright glass);
  3. rows and columns are refined (least-squares period, then per-line snap where the photo disagrees with the grid);
  4. every cell is tested against the photo (window darker than its surrounding wall?) with row/column consensus, so
     blank walls, piers, mechanical floors and storefront bases stay as the photo shows them;
  5. glass colours come from the photo. Rebuilt walls use a low-frequency surface recovered from wall samples,
     preserving material colour and broad weathering while removing shifted/missed windows and their blur tails.
     The game embeds nyc_atlas_walls.webp directly for wallSurface >= 2; sharpening the old photo cannot restore it.

Facades without a clear periodic window pattern are left alone (photo as-is).

Outputs (in $TL_BUILD_DIR or build/):
  extra/facade_meta.json      counts, texture sizes, a stamp of the nyc.bin it was made from
  extra/facade_data.bin.gz    uint32 per-triangle record index | float32 RGBA record texels | uint8 RGBA cell texels
  nyc_atlas_walls.webp        atlas with classified facades reconstructed as wall-only surfaces
Usage: TL_BUILD_DIR=build_facade python tools/scan/facade_detail.py [--debug f1,f2,...] [--sheet N]
"""
import os, sys, json, gzip, time, warnings
import numpy as np, cv2
from scipy import ndimage as nd
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
warnings.filterwarnings('ignore', category=RuntimeWarning)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
BD = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
if not os.path.isabs(BD): BD = os.path.join(ROOT, BD)
TEXW = 1024                                   # record texture width (RGBA32F texels)
CELLW = 2048                                  # cell texture width (RGBA8 texels)
T_NONE, T_PUNCHED, T_RIBBON, T_CURTAIN = 0, 1, 2, 3


def log(*a): print('[facade]', *a, flush=True)


# ------------------------------------------------------------------ geometry
def load():
    N = json.load(open(os.path.join(BD, 'nyc.json')))
    raw = open(os.path.join(BD, 'nyc.bin'), 'rb').read()
    T, U = [], []
    for b in N['buildings']:
        T.append(np.frombuffer(raw, np.float32, b['n'] * 9, b['o']).reshape(-1, 3, 3))
        U.append(np.frombuffer(raw, np.float32, b['n'] * 6, b['uo']).reshape(-1, 3, 2))
    bid = np.concatenate([np.full(b['n'], i) for i, b in enumerate(N['buildings'])])
    return N, raw, np.concatenate(T).astype(np.float64), np.concatenate(U).astype(np.float64), bid


def stamp(N, raw):
    """cheap fingerprint of nyc.bin (the runtime recomputes it to refuse stale facade data)"""
    w = np.frombuffer(raw[:len(raw) // 4 * 4], np.uint32)[::61].astype(np.uint64)
    h = 2166136261
    for v in w.tolist(): h = ((h ^ v) * 16777619) & 0xffffffff
    return {'nb': len(N['buildings']), 'ntri': int(sum(b['n'] for b in N['buildings'])), 'hash': h}


def group(T, U, bid, W, H):
    """wall triangles -> charts (same atlas mapping) -> facades (coplanar charts of one building)"""
    e = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ar = np.linalg.norm(e, axis=1) / 2
    n = e / np.maximum(2 * ar, 1e-12)[:, None]
    PX = U[:, :, 0] * W; PY = (1 - U[:, :, 1]) * H
    M = np.stack([PX, PY, np.ones_like(PX)], 2)
    det = np.linalg.det(M)
    wall = (np.abs(n[:, 1]) < 0.3) & (ar > 1e-3) & (np.abs(det) > 1e-3)
    w = np.nonzero(wall)[0]
    Minv = np.linalg.inv(M[w])
    # canonical horizontal line of each triangle (normal direction mod 180 deg)
    th = np.degrees(np.arctan2(n[w, 2], n[w, 0])) % 180.0
    nc = np.stack([np.cos(np.radians(th)), np.sin(np.radians(th))], 1)
    off = T[w, 0, 0] * nc[:, 0] + T[w, 0, 2] * nc[:, 1]
    # charts: same building + same pixel->world mapping (Minv applied to world x,y,z)
    Ax = np.einsum('nij,nj->ni', Minv, T[w, :, 0]); Ay = np.einsum('nij,nj->ni', Minv, T[w, :, 1]); Az = np.einsum('nij,nj->ni', Minv, T[w, :, 2])
    key = np.round(np.concatenate([Ax[:, :2] * 1e3, Ax[:, 2:] * 20, Ay[:, :2] * 1e3, Ay[:, 2:] * 20, Az[:, :2] * 1e3, Az[:, 2:] * 20], 1)).astype(np.int64)
    _, chart = np.unique(np.concatenate([bid[w, None], key], 1), axis=0, return_inverse=True); chart = chart.ravel()
    ncht = chart.max() + 1
    cb = np.zeros(ncht, np.int64); ct = np.zeros(ncht); co = np.zeros(ncht); ca = np.zeros(ncht)
    cb[chart] = bid[w]; ct[chart] = th; co[chart] = off
    np.add.at(ca, chart, ar[w])
    par = np.arange(ncht)

    def find(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    order = np.argsort(cb, kind='stable'); cbs = cb[order]
    starts = np.r_[0, np.nonzero(np.diff(cbs))[0] + 1, len(cbs)]
    for a, b in zip(starts[:-1], starts[1:]):
        cs = order[a:b]
        for i in range(len(cs)):
            dt = np.abs((ct[cs[i + 1:]] - ct[cs[i]] + 90) % 180 - 90)
            for j in np.nonzero((dt < 1.0) & (np.abs(co[cs[i + 1:]] - co[cs[i]]) < 0.3))[0]:
                par[find(cs[i])] = find(cs[i + 1 + j])
    root = np.array([find(i) for i in range(ncht)]); _, fac = np.unique(root, return_inverse=True); fac = fac.ravel()
    # canonical tangent per facade (area-weighted mean of the canonical line angle)
    nf = fac.max() + 1
    ang = np.zeros(nf); aw = np.zeros(nf); ref = np.full(nf, np.nan)
    for c in np.argsort(-ca):
        f = fac[c]
        if np.isnan(ref[f]): ref[f] = ct[c]
        d = (ct[c] - ref[f] + 90) % 180 - 90
        ang[f] += (ref[f] + d) * ca[c]; aw[f] += ca[c]
    ang = np.radians(ang / np.maximum(aw, 1e-9))
    nrm = np.stack([np.cos(ang), np.sin(ang)], 1)                  # facade normal (x,z), sign arbitrary
    tan = np.stack([-nrm[:, 1], nrm[:, 0]], 1)                     # s axis
    return dict(w=w, chart=chart, fac=fac[chart], nf=nf, Ax=Ax, Ay=Ay, Az=Az, tan=tan, area=np.bincount(fac[chart], ar[w], nf))


def rectify(G, f, idx, atlas, r):
    """facade f (tri positions idx into G['w']) -> rectified image (row 0 = lowest y), valid mask, origin, texel map"""
    H, W = atlas.shape[:2]
    tx, tz = G['tan'][f]
    chart = G['chart'][idx]
    ss, yy, rows, cols = [], [], [], []
    for c in np.unique(chart):
        k = idx[chart == c]; t = G['w'][k]
        P = np.stack([G['U'][t, :, 0] * W, (1 - G['U'][t, :, 1]) * H], 2)
        x0 = max(int(np.floor(P[..., 0].min())) - 1, 0); y0 = max(int(np.floor(P[..., 1].min())) - 1, 0)
        x1 = min(int(np.ceil(P[..., 0].max())) + 1, W); y1 = min(int(np.ceil(P[..., 1].max())) + 1, H)
        if x1 <= x0 or y1 <= y0: continue
        m = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.fillPoly(m, [np.round((p - [x0, y0]) * 16 - 8).astype(np.int32) for p in P], 1, lineType=cv2.LINE_8, shift=4)
        yv, xv = np.nonzero(m)
        if not len(yv): continue
        px = xv + x0 + 0.5; py = yv + y0 + 0.5
        k0 = k[0]
        ax, ay, az = G['Ax'][k0], G['Ay'][k0], G['Az'][k0]
        X = ax[0] * px + ax[1] * py + ax[2]; Z = az[0] * px + az[1] * py + az[2]
        ss.append(X * tx + Z * tz); yy.append(ay[0] * px + ay[1] * py + ay[2]); rows.append(yv + y0); cols.append(xv + x0)
    if not ss: return None
    s = np.concatenate(ss); y = np.concatenate(yy); ar_ = np.concatenate(rows); ac = np.concatenate(cols)
    s0 = s.min() - r * 0.5; y0 = y.min() - r * 0.5
    i = np.floor((s - s0) / r).astype(np.int64); j = np.floor((y - y0) / r).astype(np.int64)
    wi, hj = i.max() + 1, j.max() + 1
    if wi * hj > 6e6: return None
    c = atlas[ar_, ac].astype(np.float32)
    img = np.zeros((hj, wi, 3), np.float32); cnt = np.zeros((hj, wi), np.float32)
    np.add.at(img, (j, i), c); np.add.at(cnt, (j, i), 1)
    valid = cnt > 0; img[valid] /= cnt[valid, None]
    # isolated holes (bin aliasing): fill from neighbours
    if (~valid).any():
        near = nd.binary_dilation(valid, np.ones((3, 3), bool)) & ~valid
        if near.any():
            ksum = np.stack([nd.uniform_filter(img[..., q] * valid, 3) for q in range(3)], -1); kc = nd.uniform_filter(valid.astype(np.float32), 3)
            fill = near & (kc > 0.3)
            img[fill] = ksum[fill] / kc[fill, None]
            valid = valid | fill
    return dict(img=img, valid=valid, s0=s0, y0=y0, r=r, tex=(ar_, ac, j, i))


# ------------------------------------------------------------------ signal analysis
def nblur(a, m, s):
    return nd.gaussian_filter(a * m, s) / np.maximum(nd.gaussian_filter(m, s), 1e-3)


def autoc(Hp, m, axis):
    n = Hp.shape[axis]
    F = np.fft.rfft(Hp, 2 * n, axis=axis); G = np.fft.rfft(m, 2 * n, axis=axis)
    R = np.fft.irfft(np.abs(F) ** 2, axis=axis).sum(1 - axis)[:n]; C = np.fft.irfft(np.abs(G) ** 2, axis=axis).sum(1 - axis)[:n]
    rr = R / np.maximum(C, 1)
    return rr / max(rr[0], 1e-12), C


def peaks(rr, C, lo, hi):
    lo = max(int(np.floor(lo)), 1); hi = min(int(np.ceil(hi)), len(rr) - 2); out = []
    for k in range(lo, hi + 1):
        if rr[k] >= rr[k - 1] and rr[k] >= rr[k + 1] and C[k] >= C[0] * 0.2:
            a, b, c = rr[k - 1], rr[k], rr[k + 1]; d = a - 2 * b + c
            out.append((k + (0.5 * (a - c) / d if d < 0 else 0.0), b))
    return out


def choose(c, minv, frac=0.75):
    """smallest lag whose autocorrelation is close to the best one (window spacing, not its multiples)"""
    if not c: return None
    best = max(b for a, b in c)
    if best < minv: return None
    for a, b in c:
        if b >= frac * best: return a, b


def refine(prof, w, r, P0, span=0.035, n=141):
    """periodogram refinement of an autocorrelation period: the fold must stay phase-coherent over the whole facade
    (a 1 % error drifts a 40-floor tower by 40 % of a floor), so pick the period whose fold has the most variance"""
    x = (np.arange(len(prof)) + 0.5) * r
    best, bp = -1.0, P0
    for P in P0 * np.linspace(1 - span, 1 + span, n):
        K = max(12, int(round(P / 0.12)))
        b = np.minimum(((x % P) / P * K).astype(int), K - 1)
        c = np.bincount(b, w, K); sm = np.bincount(b, prof * w, K)
        mu = sm / np.maximum(c, 1e-9)
        v = float((c * mu ** 2).sum() / max(c.sum(), 1e-9)) - K / max(w.sum(), 1.0) * 0.0
        if v > best: best, bp = v, P
    return bp


def otsu(v):
    v = v.ravel(); best = (-1.0, float(v.mean()))
    for t in np.quantile(v, np.linspace(0.04, 0.96, 47)):
        a = v < t; na = a.mean()
        if na <= 0 or na >= 1: continue
        bt = na * (1 - na) * (v[a].mean() - v[~a].mean()) ** 2
        if bt > best[0]: best = (bt, float(t))
    return best[1]


def tile_window(Mt, Pv, Pu, two_d):
    """mean unit cell (rows = y phase, cols = s phase) -> the dark window blob: Otsu split, the connected part around
    the darkest point, its extent (rows/cols covered by >= half its widest span). Returns centre/size in metres,
    whether it spans the whole cell vertically / horizontally, and its contrast against the rest."""
    Kv, Ku = Mt.shape
    if not two_d: Mt = np.repeat(Mt.mean(1, keepdims=True), Ku, 1)
    S = nd.gaussian_filter(Mt, 1.0, mode='wrap')
    j, i = np.unravel_index(int(np.argmin(S)), S.shape)
    sv, su = Kv // 2 - j, Ku // 2 - i
    T = np.roll(np.roll(Mt, sv, 0), su, 1)
    mask = T < otsu(T)
    lab, _ = nd.label(mask)
    if lab[Kv // 2, Ku // 2] == 0: return None
    comp = lab == lab[Kv // 2, Ku // 2]
    if comp.all() or (~mask).sum() < 2: return None

    def extent(cov):
        K = len(cov); c = K // 2; t = 0.5 * cov.max(); a = c; b = c
        while a - 1 >= 0 and cov[a - 1] >= t: a -= 1
        while b + 1 < K and cov[b + 1] >= t: b += 1
        return a, b + 1
    a, b = extent(comp.mean(1)); c, d = extent(comp.mean(0))
    spanV = (b - a) >= Kv - 1; spanU = (d - c) >= Ku - 1
    cV = (((a + b) / 2 - sv) % Kv) / Kv * Pv; wV = (b - a) / Kv * Pv
    cU = (((c + d) / 2 - su) % Ku) / Ku * Pu; wU = (d - c) / Ku * Pu
    con = float(T[~mask].mean() - T[comp].mean())
    return cV, wV, cU, wU, spanV, spanU, con


def cdist(a, b, P):
    d = (a - b) % P
    return np.minimum(d, P - d)


def snap_lines(prof, pm, r, P, c0, width, lo, hi, maxdev):
    """regular lines c0 + k P (k over [lo, hi] metres) refined against a darkness profile (texel units -> metres):
    least-squares period/phase from the strong snapped minima, then per-line deviations only where the photo insists"""
    n = len(prof)
    x = (np.arange(n) + 0.5) * r
    wbox = max(int(round(width / r)), 1)
    pb = nd.uniform_filter1d(np.where(pm > 0, prof, 0.0), wbox, mode='constant') / np.maximum(nd.uniform_filter1d(pm.astype(np.float64), wbox, mode='constant'), 1e-6)
    pb[nd.uniform_filter1d(pm.astype(np.float64), wbox, mode='constant') < 0.5] = 0.0
    k0 = int(np.floor((lo - c0) / P)) - 1; k1 = int(np.ceil((hi - c0) / P)) + 1
    ks, cs, st = [], [], []
    rng = max(int(round(0.3 * P / r)), 1)
    noise = np.std(pb[pb != 0]) if (pb != 0).any() else 1.0
    for k in range(k0, k1 + 1):
        c = c0 + k * P
        if c < lo - P * 0.25 or c > hi + P * 0.25: continue
        ci = int(round(c / r - 0.5))
        a = max(ci - rng, 0); b = min(ci + rng + 1, n)
        if b - a < 2: continue
        seg = pb[a:b]; j = int(np.argmin(seg))
        if 0 < j < len(seg) - 1:
            aa, bb, cc = seg[j - 1], seg[j], seg[j + 1]; d = aa - 2 * bb + cc
            off = 0.5 * (aa - cc) / d if d > 0 else 0.0
        else: off = 0.0
        ks.append(k); cs.append((a + j + off + 0.5) * r); st.append(-seg[j] / (noise + 1e-9))
    if not ks: return []
    ks = np.array(ks, float); cs = np.array(cs); st = np.array(st)
    good = st > 0.8
    if good.sum() >= 3:
        A = np.stack([ks[good], np.ones(good.sum())], 1)
        sol, *_ = np.linalg.lstsq(A, cs[good], rcond=None)
        # robust: one reweighting pass
        res = cs[good] - A @ sol
        keep = np.abs(res) < max(0.25 * P, 2.5 * np.median(np.abs(res)) + 1e-3)
        if keep.sum() >= 3: sol, *_ = np.linalg.lstsq(A[keep], cs[good][keep], rcond=None)
        if abs(sol[0] - P) < 0.08 * P: P, c0 = sol[0], sol[1]
    out = []
    for k, c, s in zip(ks, cs, st):
        reg = c0 + k * P
        out.append(c if (abs(c - reg) > maxdev and s > 1.6) else reg)
    out = sorted(out)
    # keep a minimum spacing
    res = []
    for c in out:
        if res and c - res[-1] < 0.55 * P: continue
        res.append(c)
    return res


FAIL = {}


def _fail(why):
    FAIL['why'] = why
    return None


def analyze(R, dbg=False):
    img, valid, r = R['img'], R['valid'], R['r']
    h, wd = valid.shape
    if h * r < 6 or wd * r < 2.5: return _fail('r3')
    m = valid.astype(np.float32)
    L = (img @ np.array([0.299, 0.587, 0.114], np.float32)) / 255.0
    Low = nblur(L, m, 5.0)
    Hp = (L - Low) / np.maximum(Low, 0.08) * m          # relative contrast: dark (shaded / glass) facades count too
    rv, Cv = autoc(Hp, m, 0)
    nval = float(m.sum())
    thr = float(np.clip(3.0 / np.sqrt(nval / 8.0), 0.1, 0.3))   # autocorrelation significance shrinks with more data
    V = choose(peaks(rv, Cv, 2.4 / r, 5.8 / r), thr)
    if not V: return _fail('r10')
    ru, Cu = autoc(Hp, m, 1)
    Uc = choose(peaks(ru, Cu, 0.9 / r, 10.0 / r), thr * 0.85) if wd * r >= 3.0 else None
    Pv = V[0] * r
    Pu = Uc[0] * r if Uc else 1.5
    rw = m.sum(1); cw = m.sum(0)
    Pv = refine(Hp.sum(1) / np.maximum(rw, 1), rw, r, Pv)
    if Uc: Pu = refine(Hp.sum(0) / np.maximum(cw, 1), cw, r, Pu)
    ys = (np.arange(h) + 0.5) * r; xs = (np.arange(wd) + 0.5) * r
    # 2D fold -> unit cell
    Kv = max(12, int(round(Pv / 0.1))); Ku = max(8, int(round(Pu / 0.1)))
    bv = np.minimum(((ys % Pv) / Pv * Kv).astype(int), Kv - 1); bu = np.minimum(((xs % Pu) / Pu * Ku).astype(int), Ku - 1)
    cid = (bv[:, None] * Ku + bu[None, :]).ravel()
    Mt = np.bincount(cid, Hp.ravel(), Kv * Ku) / np.maximum(np.bincount(cid, m.ravel(), Kv * Ku), 1e-6)
    Mt = nd.gaussian_filter(Mt.reshape(Kv, Ku), 0.8, mode='wrap')
    pv = Mt.mean(1); pu = Mt.mean(0)
    W = tile_window(Mt, Pv, Pu, bool(Uc))
    if W is None: return _fail('r30')
    cV, wV, cU, wU, spanV, spanU, con = W
    info = dict(Pv=Pv, Pu=Pu, V=V, U=Uc, wV=wV, wU=wU)
    noise = 2.0 * float(np.std(Hp[valid])) / np.sqrt(max(nval / 8.0, 1.0))
    if con < max(0.03, 4.0 * noise): return _fail('r31')
    typ = T_PUNCHED
    if not Uc or (spanU and not spanV):
        typ = T_RIBBON                                   # dark horizontal bands; the bay rhythm (if any) = mullions
    elif spanU and spanV:
        # the dark part is a connected grid of lines: mullions + spandrels over bright glass (curtain wall)
        W2 = tile_window(-Mt, Pv, Pu, True)
        if W2 is None or (W2[4] and W2[5]): return _fail('r32')
        cV, wV, cU, wU = W2[:4]; typ = T_CURTAIN
    elif spanV:
        wV = Pv                                          # vertical window strips: floors only split by thin spandrels
    wV = float(np.clip(wV, 0.8, Pv - 0.3)); wU = float(np.clip(wU, 0.5, Pu - 0.2)) if typ != T_RIBBON else Pu
    info.update(type=typ, con=con, spanV=spanV, spanU=spanU, rb=0.0, rc=0.0)
    # ---- rows (floors) and columns (bays), snapped to the photo
    sign = -1.0 if typ == T_CURTAIN else 1.0             # profiles: window = minimum
    ymin, ymax = ys[valid.any(1)].min(), ys[valid.any(1)].max()
    xmin, xmax = xs[valid.any(0)].min(), xs[valid.any(0)].max()
    colmask = (cdist(xs, cU, Pu) < wU / 2) if typ != T_RIBBON else np.ones(wd, bool)
    prof_v = sign * (Hp[:, colmask].sum(1)) / np.maximum(m[:, colmask].sum(1), 1)
    rows = snap_lines(prof_v, m[:, colmask].sum(1) > 0, r, Pv, cV, wV, ymin + wV / 2, ymax - wV / 2, 0.45)
    rowmask = np.zeros(h, bool)
    for c in rows: rowmask |= np.abs(ys - c) < wV / 2
    if typ == T_RIBBON:
        # window bands: split into mullion bays (the detected bay rhythm subdivided to ~1.5 m, else 1.5 m) so the
        # photo decides bay by bay where the band is glass and where it is a pier
        Pf = Pu / max(1, round(Pu / 1.5)) if Uc else 1.5
        c0 = (cU if Uc else xmin) % Pf
        k0 = int(np.floor((xmin - c0) / Pf)); k1 = int(np.ceil((xmax - c0) / Pf))
        cols = [c0 + k * Pf for k in range(k0, k1 + 1) if xmin - Pf * 0.25 <= c0 + k * Pf <= xmax + Pf * 0.25]
        Pu = Pf; wU = Pf
    else:
        prof_u = sign * (Hp[rowmask].sum(0)) / np.maximum(m[rowmask].sum(0), 1)
        cols = snap_lines(prof_u, m[rowmask].sum(0) > 0, r, Pu, cU, wU, xmin + wU / 2, xmax - wU / 2, 0.3)
    if not rows or not cols: return _fail('r65')
    # ---- per cell evidence
    nR, nC = len(rows), len(cols)
    z = np.full((nR, nC), np.nan); cov = np.zeros((nR, nC)); col = np.zeros((nR, nC, 3))
    shrink = 0.15
    for j, cy in enumerate(rows):
        ry_in = np.abs(ys - cy) < max(wV / 2 - shrink, r * 0.6)
        ry_cell = np.abs(ys - cy) < Pv / 2
        guard = float(np.clip((Pv - wV) / 2 - r, 0.0, 0.2))
        ry_out = ry_cell & (np.abs(ys - cy) > wV / 2 + guard)
        if not ry_out.any(): ry_out = ry_cell & (np.abs(ys - cy) >= Pv / 2 - r * 0.75)
        for i, cx in enumerate(cols):
            if typ == T_RIBBON:                         # bands: compare with the spandrels above/below only
                rx_in = np.abs(xs - cx) < Pu / 2; rx_cell = rx_in; rx_out = np.zeros(wd, bool)
            else:
                rx_in = np.abs(xs - cx) < max(wU / 2 - shrink, r * 0.6)
                rx_cell = np.abs(xs - cx) < Pu / 2
                gu = float(np.clip((Pu - wU) / 2 - r, 0.0, 0.2))
                rx_out = rx_cell & (np.abs(xs - cx) > wU / 2 + gu)
                if not rx_out.any(): rx_out = rx_cell & (np.abs(xs - cx) >= Pu / 2 - r * 0.75)
            win = np.ix_(ry_in, rx_in)
            wv_ = m[win]
            full = np.ix_(np.abs(ys - cy) < wV / 2, np.abs(xs - cx) < wU / 2)
            cov[j, i] = m[full].mean() if m[full].size else 0.0
            if wv_.sum() < 1: continue
            a_in = (Hp[win] * wv_).sum() / wv_.sum()
            # surrounding wall: same-row piers + spandrels above/below in this cell
            o1 = np.ix_(ry_in, rx_out); o2 = np.ix_(ry_out, rx_cell)
            so = (Hp[o1] * m[o1]).sum() + (Hp[o2] * m[o2]).sum(); no = m[o1].sum() + m[o2].sum()
            if no < 1: continue
            z[j, i] = sign * (so / no - a_in) / con
            col[j, i] = (img[win] * wv_[..., None]).sum((0, 1)) / wv_.sum()
    ok = (cov > 0.85) & np.isfinite(z)
    if ok.sum() < 3: return _fail('r94')
    zz = np.where(ok, z, np.nan)
    # neighbourhood evidence: real layouts change by bays / floors, not by single cells -> blend with the 3x3 median
    zp = np.pad(zz, 1, constant_values=np.nan)
    st = np.stack([zp[1 + dj:1 + dj + nR, 1 + di:1 + di + nC] for dj in (-1, 0, 1) for di in (-1, 0, 1)])
    with np.errstate(all='ignore'):
        zm = np.nanmedian(st, 0)
    zz = np.where(ok, 0.5 * zz + 0.5 * np.where(np.isfinite(zm), zm, zz), np.nan)
    with np.errstate(all='ignore'):
        Rk = np.nanmedian(zz, 1); Ci = np.nanmedian(zz, 0)
    Rk = np.nan_to_num(Rk, nan=-1); Ci = np.nan_to_num(Ci, nan=-1)
    pres = ok & (((Rk[:, None] > 0.3) & (Ci[None, :] > 0.3) & (zz > -0.05)) | (zz > 0.85))
    pres &= (np.array(rows)[:, None] + R['y0'] - wV / 2 > 1.2) & (np.array(rows)[:, None] + R['y0'] > 3.2)   # ground floor: photo
    if pres.sum() < 3: return _fail('r107')
    # along a row: close single-cell gaps, drop single-cell islands (ribbons / dense grids)
    if nC >= 3:
        l = np.pad(pres, ((0, 0), (1, 1)))
        gap = ~pres & l[:, :-2] & l[:, 2:] & ok & (zz > -0.4)
        isl = pres & ~l[:, :-2] & ~l[:, 2:] & (zz < 0.9)
        pres = (pres | gap) & ~isl
    # isolated single windows in otherwise blank rows/columns are more likely noise than architecture
    rowcnt = pres.sum(1); colcnt = pres.sum(0)
    pres &= (rowcnt[:, None] >= min(2, nC)) & (colcnt[None, :] >= min(2, nR))
    if pres.sum() < 3: return _fail('r117')
    # trim empty border rows/cols
    jr = np.nonzero(pres.any(1))[0]; ic = np.nonzero(pres.any(0))[0]
    j0, j1, i0, i1 = jr[0], jr[-1] + 1, ic[0], ic[-1] + 1
    rows = rows[j0:j1]; cols = cols[i0:i1]; pres = pres[j0:j1, i0:i1]; col = col[j0:j1, i0:i1]; z = z[j0:j1, i0:i1]
    # frame / mullion colour (curtain: the dark lines; else the wall)
    fm = np.zeros((h, wd), bool)
    for c in rows: fm |= (np.abs(ys - c) < wV / 2)[:, None] & np.ones(wd, bool)
    cm = np.zeros(wd, bool)
    for c in cols: cm |= np.abs(xs - c) < wU / 2
    fm &= cm[None, :]
    wallpx = valid & ~nd.binary_dilation(fm, np.ones((3, 3), bool))
    frame = np.median(img[wallpx], 0) if wallpx.sum() > 10 else np.median(img[valid], 0)
    glassL = float(np.median((col[pres] @ np.array([0.299, 0.587, 0.114])) / 255.0))
    info.update(rows=rows, cols=cols, pres=pres, col=col, z=z, wU=wU, wV=wV, frame=frame, glassL=glassL, winmask=fm)
    return info


# ------------------------------------------------------------------ records
def bounds(c, P, lo_pad=None):
    """line centres -> cell boundaries (midpoints; ends half a period out)"""
    c = np.asarray(c, float)
    if len(c) == 1: return np.array([c[0] - P / 2, c[0] + P / 2])
    mids = (c[1:] + c[:-1]) / 2
    return np.concatenate([[c[0] - min(P, c[1] - c[0]) / 2], mids, [c[-1] + min(P, c[-1] - c[-2]) / 2]])


def main():
    dbg = []
    if '--debug' in sys.argv: dbg = [int(x) for x in sys.argv[sys.argv.index('--debug') + 1].split(',')]   # building indices
    t0 = time.time()
    N, raw, T, U, bid = load()
    atlas = np.array(Image.open(os.path.join(BD, 'nyc_atlas.webp')).convert('RGB'))
    H, W = atlas.shape[:2]
    log('loaded %d buildings, %d tris, atlas %dx%d (%.1fs)' % (len(N['buildings']), len(T), W, H, time.time() - t0))
    G = group(T, U, bid, W, H); G['U'] = U
    log('%d wall tris -> %d facades (%.1fs)' % (len(G['w']), G['nf'], time.time() - t0))
    texel = float(np.median(np.hypot(G['Ax'][:, 0], G['Az'][:, 0]) + np.hypot(G['Ax'][:, 1], G['Az'][:, 1])))
    r = texel * 1.004
    order = np.argsort(G['fac'], kind='stable'); fs = G['fac'][order]
    starts = np.r_[0, np.nonzero(np.diff(fs))[0] + 1, len(fs)]
    walls = atlas.copy()
    recs, cells, triRec = [], [], np.zeros(len(T), np.uint32)
    fails = {}
    nrec = 0; ncell = 0; stats = {T_PUNCHED: 0, T_RIBBON: 0, T_CURTAIN: 0}; areaW = 0.0
    for a, b in zip(starts[:-1], starts[1:]):
        f = fs[a]; idx = order[a:b]
        if G['area'][f] < 25: continue
        R = rectify(G, f, idx, atlas, r)
        if R is None: continue
        isd = int(bid[G['w'][idx[0]]]) in dbg
        info = analyze(R, isd)
        if isd: debug_view('b%d_f%d' % (bid[G['w'][idx[0]]], f), R, info)
        if info is None:
            fails[FAIL.get('why', '?')] = fails.get(FAIL.get('why', '?'), 0.0) + G['area'][f]; continue
        typ = info['type']; stats[typ] += 1; areaW += G['area'][f]
        rows, cols, pres = info['rows'], info['cols'], info['pres']
        nR, nC = len(rows), len(cols)
        rb = bounds(rows, info['Pv']); cb = bounds(cols, info['Pu'])
        s0, y0 = R['s0'], R['y0']
        tx, tz = G['tan'][f]
        base = nrec
        hdr = [
            [tx, tz, s0, typ],
            [nC, nR, base + 5, base + 5 + nC],
            [ncell, info['Pu'], info['Pv'], 0.0],
            [cb[0], rb[0] + y0, float(pres.mean()), info['wU'] * info['wV'] / (info['Pu'] * info['Pv'])],
            [info['frame'][0] / 255, info['frame'][1] / 255, info['frame'][2] / 255, info['glassL']],
        ]
        for i in range(nC):
            hdr.append([cb[i], cb[i + 1], max(cols[i] - info['wU'] / 2, cb[i]), min(cols[i] + info['wU'] / 2, cb[i + 1])])
        for j in range(nR):
            hdr.append([rb[j] + y0, rb[j + 1] + y0, rows[j] - info['wV'] / 2 + y0, rows[j] + info['wV'] / 2 + y0])
        recs.append(np.array(hdr, np.float32)); nrec += len(hdr)
        cc = np.zeros((nR, nC, 4), np.uint8)
        cc[..., :3] = np.clip(info['col'], 0, 255).astype(np.uint8)
        cc[..., 3] = np.where(pres, 255, 0)
        cells.append(cc.reshape(-1, 4)); ncell += nR * nC
        triRec[G['w'][idx]] = base + 1
        # Whole classified faces need a wall-only surface, including margins and missed cells.
        inpaint_walls(R, info, walls, pres)
    log('facades with windows: %d punched, %d ribbon, %d curtain; %.0f%% of wall area (%.1fs)' % (
        stats[T_PUNCHED], stats[T_RIBBON], stats[T_CURTAIN], 100 * areaW / G['area'].sum(), time.time() - t0))
    log('no windows (share of wall area): ' + ', '.join('%s %.0f%%' % (k, 100 * v / G['area'].sum()) for k, v in sorted(fails.items(), key=lambda kv: -kv[1])))
    rec = np.concatenate(recs) if recs else np.zeros((0, 4), np.float32)
    cel = np.concatenate(cells) if cells else np.zeros((0, 4), np.uint8)
    ED = os.path.join(BD, 'extra'); os.makedirs(ED, exist_ok=True)
    blob = triRec.tobytes() + rec.astype(np.float32).tobytes() + cel.tobytes()
    with open(os.path.join(ED, 'facade_data.bin.gz'), 'wb') as fp: fp.write(gzip.compress(blob, 9))
    meta = {'v': 1, 'wallSurface': 2, 'stamp': stamp(N, raw), 'ntri': len(T), 'nrec': int(nrec), 'ncell': int(ncell), 'texW': TEXW, 'cellW': CELLW,
            'texel': texel, 'types': {k: int(v) for k, v in stats.items()}}
    json.dump(meta, open(os.path.join(ED, 'facade_meta.json'), 'w'))
    Image.fromarray(walls).save(os.path.join(BD, 'nyc_atlas_walls.webp'), 'WEBP', quality=90, method=4)
    save_facade_distance_atlas(atlas)
    log('wrote extra/facade_data.bin.gz (%d KB), %d records, %d cells, nyc_atlas_walls.webp (%.1fs)' % (
        os.path.getsize(os.path.join(ED, 'facade_data.bin.gz')) // 1024, nrec, ncell, time.time() - t0))


def save_facade_distance_atlas(atlas):
    """Keep the original building-specific photo character for the distant skyline."""
    im = Image.fromarray(atlas)
    im.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
    os.makedirs(os.path.join(BD, 'extra'), exist_ok=True)
    im.save(os.path.join(BD, 'extra', 'facade_distance.webp'), 'WEBP', quality=88, method=4)


def inpaint_walls(R, info, walls, pres):
    """Separate the wall surface from ALL baked window detail on a rebuilt facade.

    Small holes at the new window coordinates cannot erase misaligned photo windows,
    their blur tails, or windows the detector missed. Recover a low-frequency wall
    field from the wall samples instead. Keep source colour/weathering, but restrict
    contrast and bandwidth so the atlas cannot supply a second window pattern.
    The analytic layer remains the sole owner of windows on this entire face.
    """
    img, valid, r = R['img'], R['valid'], R['r']
    h, wd = valid.shape
    ys = (np.arange(h) + 0.5) * r; xs = (np.arange(wd) + 0.5) * r
    mask = np.zeros((h, wd), bool)
    for j, cy in enumerate(info['rows']):
        ry = np.abs(ys - cy) < info['wV'] / 2 + max(r, 0.45)
        for i, cx in enumerate(info['cols']):
            # Absent cells can still contain a missed/shifted baked window.
            rx = np.abs(xs - cx) < info['wU'] / 2 + max(r, 0.45)
            mask |= ry[:, None] & rx[None, :]
    known = valid & ~mask
    if known.sum() < 10: known = valid.copy()
    if not known.any(): return
    lum = img @ np.array([0.299, 0.587, 0.114])
    # Reject dark contamination from neighboring buildings / old window shadows.
    # Curtain-wall frames are dark by design, so retain their measured frame tone.
    if info['type'] != T_CURTAIN:
        known &= lum >= np.percentile(lum[known], 35)
    samples = img[known]
    centre = np.median(samples, axis=0)
    if info['type'] == T_CURTAIN: centre = np.asarray(info['frame'])
    kn = known.astype(np.float32)
    # More than one window period in both directions: a shifted old grid cannot survive.
    sigma = (max(2.0, info['Pv'] * 1.4 / r), max(2.0, info['Pu'] * 1.4 / r))
    den = nd.gaussian_filter(kn, sigma)
    num = np.stack([nd.gaussian_filter(img[..., q] * kn, sigma) for q in range(3)], -1)
    field = np.where((den > 1e-4)[..., None], num / np.maximum(den[..., None], 1e-4), centre)
    # Broad stains and material hue remain; no high-contrast rectangles in the wall layer.
    out = centre + np.clip(field - centre, -30.0, 30.0) * 0.85
    # Restore broad photographed shading/setback bands, below the window frequency.
    # Sampling the original only at this scale keeps the building's large structure
    # without reintroducing the high-contrast dark rectangles we just removed.
    shade_sigma = (max(2.0, info['Pv'] * .85 / r), max(2.0, info['Pu'] * .85 / r))
    shade = nblur(lum, valid, shade_sigma)
    mean_shade = max(float(np.median(shade[valid])), 1.0)
    out *= np.clip(shade / mean_shade, .72, 1.22)[..., None]
    ar_, ac, j, i = R['tex']
    walls[ar_, ac] = np.clip(out[j, i], 0, 255).astype(np.uint8)


def debug_view(f, R, info):
    img, valid, r = R['img'], R['valid'], R['r']
    S = 4
    h, wd = valid.shape
    ph = cv2.resize(img, (wd * S, h * S), interpolation=cv2.INTER_NEAREST)
    ph[cv2.resize(valid.astype(np.uint8), (wd * S, h * S), interpolation=cv2.INTER_NEAREST) == 0] = [60, 0, 60]
    ov = ph.copy()
    txt = 'none ' + FAIL.get('why', '')
    if info:
        for j, cy in enumerate(info['rows']):
            for i, cx in enumerate(info['cols']):
                x0 = (cx - info['wU'] / 2) / r * S; x1 = (cx + info['wU'] / 2) / r * S
                y0 = (cy - info['wV'] / 2) / r * S; y1 = (cy + info['wV'] / 2) / r * S
                cv2.rectangle(ov, (int(x0), int(y0)), (int(x1), int(y1)), (0, 255, 0) if info['pres'][j, i] else (255, 0, 0), 1)
        txt = 't%d Pv%.2f Pu%.2f wV%.2f wU%.2f rb%.2f rc%.2f con%.3f' % (info['type'], info['Pv'], info['Pu'], info['wV'], info['wU'], info['rb'], info['rc'], info['con'])
    print('[debug]', f, R['img'].shape, txt, flush=True)
    im = np.concatenate([ph, ov], 1)[::-1].copy()
    cv2.putText(im, '%s %s' % (f, txt), (2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 0), 1)
    out = os.environ.get('TL_FACADE_DEBUG', '.')
    cv2.imwrite(os.path.join(out, 'fd_%s.png' % f), im[..., ::-1].astype(np.uint8))


if __name__ == '__main__':
    main()
