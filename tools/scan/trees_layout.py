"""THREADLINE — find the scan's trees, split canopies into single trees, pick models, cut the blobs out.

Called from build_scan.py (after the ground field, before collision boxes):
    res = trees_layout.detect(Pf, fi, ti, VT, tex, kept, nyc, land, ox, oz, CELL, NX, NZ, OUT, log)
  Pf     scan vertices with ground-relative heights (world metres)
  kept   bool per triangle: what the scan render would keep (after the NYC cut)
Returns dict(drop=bool per triangle (tree triangles to remove from the render tiles),
             mask2=bool NZ x NX (canopy cells at the collision resolution: no collision there),
             n=tree count). Writes <OUT>/extra/trees_layout.json:
  { v, models: [names], trees: [[x, z, model, yaw, scale, xz-stretch, tint r, g, b], ...] }
Model names must match tools/hd/trees_gen.py MODELS.

Method: the kept scan triangles are splatted into a 1 m grid (max height + colour class counts);
canopy = cells above 1.5 m whose neighbourhood is mostly vegetation-coloured (green, or dark shadowed
foliage next to green) and not bright grey structure (the FDR, piers, bridge ramps). Single trees are
picked greedily from the smoothed canopy height (+ distance to the canopy edge) with a height-dependent
spacing; each gets a height (canopy max, floored by crown width) and crown radius. Trunks are kept off
NYC building footprints. Species follow downtown's real mix: honey locust / London plane / linden /
pin oak on streets, big planes, elms and oaks in the parks.
"""
import json, os
import numpy as np
from scipy import ndimage as nd

MODELS = ['plane_big', 'plane_street', 'locust_vase', 'locust_young', 'oak_pin', 'elm_vase', 'linden_street', 'linden_young']
# native model height / crown radius (tools/hd/trees_gen.py)
NATIVE = {'plane_big': (22.0, 10.0), 'plane_street': (15.0, 5.6), 'locust_vase': (13.0, 7.2), 'locust_young': (9.0, 4.0),
          'oak_pin': (18.0, 6.2), 'elm_vase': (21.0, 10.5), 'linden_street': (11.5, 4.4), 'linden_young': (7.5, 3.1)}
R1 = 1.0             # analysis grid (m)


def splat(Pf, fi, ti, VT, tex, sel, ox, oz, NX1, NZ1, rng):
    """kept triangles -> 1 m grid: max height, counts of vegetation / dark / bright samples above 1.5 m, mean colour"""
    TH, TW = tex.shape[:2]
    T = Pf[fi[sel]].astype(np.float64); U = VT[ti[sel]].astype(np.float64)
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    area = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    n = np.clip(np.ceil(area / 0.1), 3, 20000).astype(np.int64)
    ii = np.repeat(np.arange(len(T)), n)
    a = rng.random((len(ii), 1)); b = rng.random((len(ii), 1)); m = (a + b) > 1; a[m] = 1 - a[m]; b[m] = 1 - b[m]
    p = T[ii, 0] + e1[ii] * a + e2[ii] * b; u = U[ii, 0] + (U[ii, 1] - U[ii, 0]) * a + (U[ii, 2] - U[ii, 0]) * b
    c = tex[np.clip(((1 - u[:, 1]) * TH).astype(int), 0, TH - 1), np.clip((u[:, 0] * TW).astype(int), 0, TW - 1)].astype(np.float32)
    cx = np.clip(((p[:, 0] - ox) / R1).astype(np.int64), 0, NX1 - 1); cz = np.clip(((p[:, 2] - oz) / R1).astype(np.int64), 0, NZ1 - 1)
    cell = cz * NX1 + cx
    L = c.mean(1); sat = c.max(1) - c.min(1)
    veg = (c[:, 1] > c[:, 0] * 1.03) & (c[:, 1] > c[:, 2] * 0.95)
    dark = (L < 75) & ~veg
    bright = (L > 110) & (sat < 45) & ~veg
    hi = p[:, 1] > 1.5
    chm = np.full(NX1 * NZ1, 0.0); np.maximum.at(chm, cell, p[:, 1])
    cnt = lambda msk: np.bincount(cell[msk], minlength=NX1 * NZ1).reshape(NZ1, NX1).astype(np.float64)
    csum = np.zeros((NX1 * NZ1, 3))
    for ch in range(3): np.add.at(csum[:, ch], cell[hi & veg], c[hi & veg, ch])
    nv = cnt(hi & veg)
    col = csum.reshape(NZ1, NX1, 3) / np.maximum(nv, 1)[..., None]
    # per triangle: fraction of vegetation / bright samples
    tv = np.bincount(ii, weights=veg, minlength=len(T)) / n
    tb = np.bincount(ii, weights=bright, minlength=len(T)) / n
    return dict(chm=chm.reshape(NZ1, NX1), nv=nv, nd=cnt(hi & dark), nb=cnt(hi & bright), na=cnt(hi), col=col, tv=tv, tb=tb)


def detect(Pf, fi, ti, VT, tex, kept, nyc, land, ox, oz, CELL, NX, NZ, OUT, log):
    rng = np.random.default_rng(4)
    ext_x, ext_z = NX * CELL, NZ * CELL
    NX1, NZ1 = int(np.ceil(ext_x / R1)), int(np.ceil(ext_z / R1))
    sel = np.nonzero(kept)[0]
    S = splat(Pf, fi, ti, VT, tex, sel, ox, oz, NX1, NZ1, rng)
    chm, na = S['chm'], S['na']
    box = lambda a: nd.uniform_filter(a, 5)
    A = np.maximum(box(na), 1e-3)
    vf, bf, df = box(S['nv']) / A, box(S['nb']) / A, box(S['nd']) / A
    occ = na > 0
    tree = occ & (chm > 1.5) & ((vf > 0.2) | ((df > 0.5) & (vf > 0.05))) & (bf < 0.35)
    # not on / right against NYC buildings, only over land
    up = lambda m2: np.kron(m2, np.ones((int(CELL / R1), int(CELL / R1)), bool))[:NZ1, :NX1]
    land1 = up(land)
    fp1 = up(nyc['fp2']) if nyc is not None else np.zeros((NZ1, NX1), bool)
    tree &= land1 & ~fp1
    tree = nd.binary_closing(tree, iterations=1)
    lab, n = nd.label(tree); area = np.bincount(lab.ravel()); ok = area >= 8; ok[0] = False
    tree = ok[lab]
    log('trees: canopy %d m^2 (%d components)' % (tree.sum(), ok.sum()))

    # ---------------------------------------------------------------- single trees
    dist = nd.distance_transform_edt(tree) * R1
    ch = nd.gaussian_filter(np.where(tree, chm, 0), 1.2)
    Hloc = nd.maximum_filter(np.where(tree, chm, 0), size=7)
    Sc = ch + 0.6 * dist
    dbld = nd.distance_transform_edt(~fp1) * R1
    zz, xx = np.nonzero(tree)
    order = np.argsort(-Sc[zz, xx])
    G = 12; grid = {}; acc = []
    for k in order:
        z, x = zz[k], xx[k]
        H = Hloc[z, x]
        if dist[z, x] < 1.5 and H < 3.0: continue
        r = float(np.clip(0.3 * H + 1.6, 2.8, 8.5))
        r = max(2.8, min(r, dist[z, x] + 3.0))
        good = True
        for a in range(int(x // G) - 1, int(x // G) + 2):
            for b in range(int(z // G) - 1, int(z // G) + 2):
                for t in grid.get((a, b), ()):
                    if (t[0] - x) ** 2 + (t[1] - z) ** 2 < max(0.85 * (r + t[2]), 5.5) ** 2: good = False; break
                if not good: break
            if not good: break
        if not good: continue
        t = (x, z, r, H); acc.append(t); grid.setdefault((int(x // G), int(z // G)), []).append(t)
    acc = np.array(acc, float).reshape(-1, 4)
    # ---------------------------------------------------------------- per tree: position, size, context, colour
    gx, gz = np.gradient(dbld)
    tint_all = S['col'][tree & (S['nv'] > 3)]
    cmean = tint_all.mean(0) if len(tint_all) else np.array([90, 105, 70.0])
    # park context: tree density around
    pos = acc[:, :2]
    from scipy.spatial import cKDTree
    kd = cKDTree(pos) if len(pos) else None
    out = []
    for i, (x, z, r, H) in enumerate(acc):
        xi, zi = int(x), int(z)
        # keep the trunk >= 1.8 m off building footprints
        for _ in range(6):
            d = dbld[min(zi, NZ1 - 1), min(xi, NX1 - 1)]
            if d >= 1.8: break
            g2 = np.array([gx[zi, xi], gz[zi, xi]]); ng = np.hypot(*g2)
            if ng < 1e-6: break
            z += g2[0] / ng * (1.8 - d + 0.3); x += g2[1] / ng * (1.8 - d + 0.3)
            xi, zi = int(np.clip(x, 0, NX1 - 1)), int(np.clip(z, 0, NZ1 - 1))
        if dbld[zi, xi] < 1.0 or not land1[zi, xi]: continue
        r = min(r, dbld[zi, xi] + 2.5)
        H = float(np.clip(max(H * 1.05, 1.5 * r + 2.0), 3.5, 26.0))
        dense = len(kd.query_ball_point([x, z], 22.0)) if kd is not None else 1
        park = dense >= 7
        wx, wz = ox + (x + 0.5) * R1, oz + (z + 0.5) * R1
        hsh = np.random.default_rng(int(abs(wx * 7919 + wz * 104729)) % (2 ** 31))
        name = pick_model(H, r, park, hsh)
        mh, mr = NATIVE[name]
        s = float(np.clip(H / mh, 0.55, 1.45))
        sx = float(np.clip(r / (mr * s), 0.78, 1.3))
        # colour: this canopy's scan colour relative to the mean, softened, plus a little jitter
        y0, y1, x0, x1 = max(0, zi - 3), zi + 4, max(0, xi - 3), xi + 4
        cm = S['col'][y0:y1, x0:x1][S['nv'][y0:y1, x0:x1] > 3]
        c = cm.mean(0) if len(cm) else cmean
        tint = np.clip((c / cmean) ** 0.35 * hsh.uniform(0.94, 1.06, 3), 0.84, 1.16)
        out.append([round(wx, 2), round(wz, 2), MODELS.index(name), round(float(hsh.uniform(0, 2 * np.pi)), 3), round(s, 3), round(sx, 3)] + [round(float(v), 3) for v in tint])
    cnt = np.bincount([t[2] for t in out], minlength=len(MODELS))
    log('trees: %d placed  ' % len(out) + ' '.join('%s %d' % (m, c) for m, c in zip(MODELS, cnt)))
    os.makedirs(os.path.join(OUT, 'extra'), exist_ok=True)
    with open(os.path.join(OUT, 'extra', 'trees_layout.json'), 'w') as f:
        json.dump({'v': 1, 'models': MODELS, 'trees': out}, f, separators=(',', ':'))

    # ---------------------------------------------------------------- what to cut out of the scan render
    foot = nd.binary_dilation(tree, iterations=2)                       # canopy + its skirt
    T = Pf[fi]; cen = T.mean(1); ymax = T[:, :, 1].max(1)
    cx = np.clip(((cen[:, 0] - ox) / R1).astype(int), 0, NX1 - 1); cz = np.clip(((cen[:, 2] - oz) / R1).astype(int), 0, NZ1 - 1)
    tv = np.zeros(len(fi)); tb = np.zeros(len(fi)); tv[sel] = S['tv']; tb[sel] = S['tb']
    # big structures (FDR, piers, ramps, pavilions): raised, not vegetation, large -> never cut
    st = occ & (chm > 1.5) & ~tree
    st = nd.binary_opening(st, iterations=1)
    lab, n = nd.label(st); ar = np.bincount(lab.ravel()); big = ar >= 60; big[0] = False
    struct = nd.binary_dilation(big[lab], iterations=1)[cz, cx]
    near = nd.binary_dilation(tree, iterations=6)[cz, cx]
    drop = kept & foot[cz, cx] & ((tb < 0.5) | ~struct)                  # everything in a canopy footprint but structure
    drop |= kept & near & ~struct                                        # canopy skirts / shards around it
    drop |= kept & (tv > 0.35) & (ymax > 1.2)                            # stray green shards anywhere above the lawn
    drop |= kept & (ymax < 2.5) & ~struct                                # scan lawn patches: the NYC park ground reads cleaner
    log('trees: %d scan triangles cut (of %d kept)' % (int(drop.sum()), int(kept.sum())))
    # canopy at collision resolution
    k = int(CELL / R1)
    t2 = np.zeros((NZ * k, NX * k), bool); t2[:NZ1, :NX1] = foot[:NZ * k, :NX * k]
    mask2 = t2.reshape(NZ, k, NX, k).mean(axis=(1, 3)) > 0.5
    return dict(drop=drop, mask2=mask2, n=len(out))


def pick_model(H, r, park, g):
    """downtown mix; young models for small trees, big park trees where it's tall"""
    w = {}
    if H < 8.0:
        w = {'linden_young': 0.45, 'locust_young': 0.4, 'linden_street': 0.15}
    elif H < 12.5:
        w = {'locust_vase': 0.3, 'linden_street': 0.3, 'plane_street': 0.2, 'locust_young': 0.1, 'oak_pin': 0.1}
        if r / H > 0.48: w['locust_vase'] += 0.3
    elif H < 17.5:
        w = {'plane_street': 0.35, 'oak_pin': 0.2, 'locust_vase': 0.2, 'linden_street': 0.1, 'elm_vase': 0.05, 'plane_big': 0.1}
        if park: w['plane_big'] += 0.2; w['elm_vase'] += 0.1
    else:
        w = {'plane_big': 0.45, 'elm_vase': 0.25, 'oak_pin': 0.15, 'plane_street': 0.15}
        if not park: w['plane_street'] += 0.2; w['elm_vase'] -= 0.1
    names = list(w); p = np.array([max(w[n], 0) for n in names]); p /= p.sum()
    return names[int(g.choice(len(names), p=p))]
