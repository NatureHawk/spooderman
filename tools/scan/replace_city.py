"""Building replacement, source side: split src/new-york-city/source/procedural_city_6.glb (a CityGen block model whose
meshes are grouped by MATERIAL, not by building) into individual candidate buildings.

  load_glb(path)         minimal GLB reader (numpy only): world-space primitives, UVs, materials, embedded images
  extract(path)          -> list of Candidate dicts (local frame: footprint bbox centred on the origin, y = 0 at the ground)

Segmentation (top-down raster, 0.25 m): horizontal surfaces of the structural materials give a height map, their vertical
walls are drawn as barriers; the connected regions between barriers are building parts. A region lying inside another
region's filled outline (setback rings around a tower, an inset roof) is merged into it; slivers (awnings, sidewalk sheds,
cornices) are dropped. Every triangle then goes to the region it belongs to (walls: the side that is solid at the wall's
height). Sidewalk sheds (CityGen 'Material' + 'basic_dark_green') stand on the street and are left out.
"""
import io, json, struct
import numpy as np
import cv2
from scipy import ndimage as nd

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

STRUCT = {'CityGen_LR_Facades', 'CityGenroof.001', 'CityGenroof.002', 'CityGenroof.003', 'CityGen_Curb', 'CityGensimple_concrete_1',
          'CityGenconcrete.001', 'CityGentextured_metal', 'CityGenblack_.001', 'Building_Facade.001', 'CityGenwhite_marble_tiles',
          'CityGenyellow_stone'}
WALLS = {'CityGen_LR_Facades', 'Building_Facade.001', 'CityGenconcrete.001', 'CityGentextured_metal', 'CityGenblack_.001'}
SKIP = {'Material', 'CityGenbasic_dark_green'}          # sidewalk sheds: on the street, not part of the building
R = 0.25                                                 # raster resolution (m)


def load_glb(path):
    f = open(path, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]
    J = json.loads(f[20:20 + L])
    o = 20 + L
    BL = struct.unpack('<I', f[o:o + 4])[0]
    BIN = f[o + 8:o + 8 + BL]

    def acc(i):
        a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', 0)
        if st and st != dt.itemsize * n:
            raw = np.frombuffer(BIN, np.uint8, a['count'] * st, off).reshape(a['count'], st)[:, :dt.itemsize * n]
            return np.ascontiguousarray(raw).view(dt).reshape(a['count'], n)
        return np.frombuffer(BIN, dt, a['count'] * n, off).reshape(a['count'], n)

    def image(i):
        bv = J['bufferViews'][J['images'][i]['bufferView']]
        return BIN[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]

    W = {}

    def walk(i, Pm):
        n = J['nodes'][i]
        if any(k in n for k in ('translation', 'rotation', 'scale')):
            from scipy.spatial.transform import Rotation
            m = np.eye(4)
            m[:3, :3] = Rotation.from_quat(n.get('rotation', [0, 0, 0, 1])).as_matrix() * np.array(n.get('scale', [1, 1, 1]))
            m[:3, 3] = n.get('translation', [0, 0, 0])
        else:
            m = np.array(n['matrix'], float).reshape(4, 4).T if 'matrix' in n else np.eye(4)
        M = Pm @ m; W[i] = M
        for c in n.get('children', []): walk(c, M)
    for r in J['scenes'][J.get('scene', 0)]['nodes']: walk(r, np.eye(4))
    parent = {c: i for i, n in enumerate(J['nodes']) for c in n.get('children', [])}
    prims = []
    for i, n in enumerate(J['nodes']):
        if 'mesh' not in n: continue
        grp = J['nodes'][parent[i]]['name'] if i in parent else ''
        for p in J['meshes'][n['mesh']]['primitives']:
            M = W[i]
            V = acc(p['attributes']['POSITION']).astype(np.float64) @ M[:3, :3].T + M[:3, 3]
            uv = acc(p['attributes']['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in p['attributes'] else np.zeros((len(V), 2), np.float32)
            I = acc(p['indices']).reshape(-1, 3).astype(np.int64)
            prims.append(dict(node=n['name'], grp=grp, V=V.astype(np.float32), UV=uv, I=I, mat=p.get('material')))
    return J, prims, image


def _raster(tris, mn, shape, hm=None, lines=None):
    """horizontal tris -> max-height raster (hm), vertical tris -> 1-px barrier lines"""
    for t in tris:
        q = np.round(np.stack([(t[:, 0] - mn[0]) / R + 2, (t[:, 2] - mn[1]) / R + 2], 1) * 8).astype(np.int32)
        if hm is not None:
            x0, y0 = q.min(0) >> 3; x1, y1 = (q.max(0) >> 3) + 1
            sub = np.zeros((y1 - y0 + 1, x1 - x0 + 1), np.uint8)
            cv2.fillPoly(sub, [q - np.array([x0, y0]) * 8], 1, shift=3)
            reg = hm[y0:y1 + 1, x0:x1 + 1]
            np.maximum(reg, sub * np.float32(t[:, 1].max()), out=reg)
        else:
            cv2.polylines(lines, [q], True, 1, shift=3)


def _attached(Tk, hm, fpm, mn):
    """mask of triangles whose connected piece has a vertex on/inside the building mass (within 0.6 m horizontally of
    the footprint and not above the local roof by more than 0.6 m), i.e. pieces that are not floating"""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    q = np.round(Tk.reshape(-1, 3) * 50).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True); inv = inv.ravel().reshape(-1, 3)
    nv = inv.max() + 1
    r = np.concatenate([inv[:, 0], inv[:, 1]]); c = np.concatenate([inv[:, 1], inv[:, 2]])
    _, lab = connected_components(coo_matrix((np.ones(len(r)), (r, c)), shape=(nv, nv)), directed=False)
    tl = lab[inv[:, 0]]
    near = nd.binary_dilation(fpm, iterations=3)
    roof = nd.maximum_filter(np.where(fpm, hm, 0), size=7)
    P = Tk.reshape(-1, 3)
    i = np.clip(np.round((P[:, 2] - mn[1]) / R + 2).astype(int), 0, hm.shape[0] - 1)
    j = np.clip(np.round((P[:, 0] - mn[0]) / R + 2).astype(int), 0, hm.shape[1] - 1)
    ok = near[i, j] & (P[:, 1] <= roof[i, j] + 0.6)
    good = np.zeros(lab.max() + 1, bool)
    good[np.unique(lab[inv.ravel()[ok]])] = True
    return good[tl]


def _party_fill(Tk, isS, hmk, w, d, cell=0.5):
    """Walls CityGen left out because a neighbour hid them. Per side of the footprint bbox: the wall the building
    needs (from the ground up to its own roof just inside that edge) minus the wall it has (vertical structural
    triangles near that plane) -> rectangles to fill. Returns ((n,3,3) outward-facing triangles, area per side)."""
    n = np.cross(Tk[:, 1] - Tk[:, 0], Tk[:, 2] - Tk[:, 0]); n /= np.linalg.norm(n, axis=1)[:, None] + 1e-12
    V = (np.abs(n[:, 1]) < 0.2) & isS
    H, W = hmk.shape
    tris, areas = [], []
    for side in range(4):
        ax = 0 if side < 2 else 2; sg = -1 if side % 2 == 0 else 1
        half = (w if ax == 0 else d) / 2; L = d if ax == 0 else w; o = 2 - ax
        # roof height just inside this edge, along the edge
        k = int(1.0 / R)
        if ax == 0: strip = hmk[:, :k] if sg < 0 else hmk[:, -k:]; prof = strip.max(1)            # along z (rows)
        else: strip = hmk[:k, :] if sg < 0 else hmk[-k:, :]; prof = strip.max(0)                   # along x (cols)
        ns, ny = int(np.ceil(L / cell)), int(np.ceil(max(prof.max(), 1) / cell))
        s_c = (np.arange(ns) + 0.5) * cell
        need_h = np.interp(s_c, (np.arange(len(prof)) + 0.5) * R, prof)
        need = (np.arange(ny)[:, None] + 0.5) * cell < need_h[None, :] - 0.3
        near = V & (np.abs(Tk[:, :, ax].mean(1) - sg * half) < 1.5)
        cov = np.zeros((ny + 1, ns + 1), np.uint8)
        for t in Tk[near]:
            q = np.stack([(t[:, o] + L / 2) / cell, t[:, 1] / cell], 1)
            cv2.fillPoly(cov, [np.round(q * 8).astype(np.int32)], 1, shift=3)
        cov = cv2.dilate(cov, np.ones((3, 3), np.uint8))[:ny, :ns]
        miss = need & (cov == 0)
        miss = nd.binary_opening(miss, np.ones((2, 2)))
        # plane: where this side's existing walls stand (median), else just inside the bbox edge
        pl = np.median(Tk[near][:, :, ax]) if near.any() else sg * (half - 0.25)
        areas.append(float(miss.sum() * cell * cell))
        # rows -> runs -> merged rectangles
        rects = []; open_ = {}
        for r in range(ny + 1):
            runs = set()
            if r < ny:
                row = miss[r]; c0 = None
                for cidx in range(ns + 1):
                    v = cidx < ns and row[cidx]
                    if v and c0 is None: c0 = cidx
                    if not v and c0 is not None: runs.add((c0, cidx)); c0 = None
            for key in list(open_):
                if key not in runs: rects.append((key[0], open_.pop(key), key[1], r))
            for key in runs:
                if key not in open_: open_[key] = r
        for c0, r0, c1, r1 in rects:
            a0, a1 = c0 * cell - L / 2, c1 * cell - L / 2; b0, b1 = r0 * cell, r1 * cell
            def P(a, b):
                p = [0.0, b, 0.0]; p[ax] = pl; p[o] = a; return p
            q = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)]
            t1, t2 = [q[0], q[1], q[2]], [q[0], q[2], q[3]]
            nn = np.cross(np.subtract(t1[1], t1[0]), np.subtract(t1[2], t1[0]))
            if nn[ax] * sg < 0: t1, t2 = [q[0], q[2], q[1]], [q[0], q[3], q[2]]
            tris += [t1, t2]
    return np.array(tris, np.float32).reshape(-1, 3, 3), areas


def extract(path, log=print):
    J, prims, image = load_glb(path)
    mats = J['materials']
    # all building triangles
    T, UV, MI = [], [], []
    for p in prims:
        if 'Buildings' not in p['grp']: continue
        if mats[p['mat']]['name'] in SKIP: continue
        T.append(p['V'][p['I']]); UV.append(p['UV'][p['I']]); MI.append(np.full(len(p['I']), p['mat'], np.int32))
    T = np.concatenate(T); UV = np.concatenate(UV); MI = np.concatenate(MI)
    mname = np.array([m['name'] for m in mats])
    isS = np.isin(mname[MI], list(STRUCT)); isW = np.isin(mname[MI], list(WALLS))
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ln = np.linalg.norm(n, axis=1) + 1e-12; n = n / ln[:, None]
    ext = T[:, :, 1].max(1) - T[:, :, 1].min(1)
    mn = T.reshape(-1, 3)[:, [0, 2]].min(0) - 1; mx = T.reshape(-1, 3)[:, [0, 2]].max(0) + 1
    shape = (int((mx[1] - mn[1]) / R) + 6, int((mx[0] - mn[0]) / R) + 6)
    hm = np.zeros(shape, np.float32); bar = np.zeros(shape, np.uint8)
    _raster(T[isS & (np.abs(n[:, 1]) > 0.7)], mn, shape, hm=hm)
    _raster(T[isW & (np.abs(n[:, 1]) < 0.2) & (ext > 2.5)], mn, shape, lines=bar)
    inside = ((hm > 3) & (bar == 0)).astype(np.uint8)
    nl, lab = cv2.connectedComponents(inside, connectivity=4)
    area = nd.sum(np.ones_like(lab), lab, np.arange(nl)) * R * R
    hp = np.array([np.percentile(hm[lab == i], 90) if i else 0 for i in range(nl)])
    keep = [i for i in range(1, nl) if area[i] >= 40 and hp[i] >= 8]
    # merge enclosed regions (setback rings, inset roofs): CityGen is axis-aligned, so a region whose bbox lies inside
    # another (larger) region's bbox is part of that building; chains (rings inside rings) resolve to the outermost
    sl = nd.find_objects(lab)
    bb = {i: (sl[i - 1][1].start, sl[i - 1][0].start, sl[i - 1][1].stop, sl[i - 1][0].stop) for i in keep}
    def inside(a, b, tol=4):   # bbox a inside bbox b (px tolerance)
        return a[0] >= b[0] - tol and a[1] >= b[1] - tol and a[2] <= b[2] + tol and a[3] <= b[3] + tol
    barea = {i: (b[2] - b[0]) * (b[3] - b[1]) for i, b in bb.items()}
    parent = {}
    for j in keep:
        outer = [i for i in keep if i != j and barea[i] > barea[j] and inside(bb[j], bb[i])]
        parent[j] = max(outer, key=lambda i: barea[i]) if outer else j
    groups = {}
    for i in keep: groups.setdefault(parent[i], []).append(i)
    B = np.zeros_like(lab)
    for k, (r, mem) in enumerate(sorted(groups.items())):
        for i in mem: B[lab == i] = k + 1
    ncand = len(groups)
    # triangle -> building: the nearest building (<= 2.5 m) that is locally at least as tall as the triangle's base, so
    # a taller neighbour's parapet / fire escapes / upper wall never land on a lower building. Walls are sampled 0.6 m
    # to either side; a wall solid on both sides at its height is a party wall and goes to both buildings.
    c = T.mean(1); y0 = T[:, :, 1].min(1)
    vert = np.abs(n[:, 1]) < 0.5
    def ij(x, z):
        return (np.clip(np.round((z - mn[1]) / R + 2).astype(int), 0, shape[0] - 1),
                np.clip(np.round((x - mn[0]) / R + 2).astype(int), 0, shape[1] - 1))
    samples = [ij(c[:, 0], c[:, 2]), ij(c[:, 0] + n[:, 0] * 0.6, c[:, 2] + n[:, 2] * 0.6), ij(c[:, 0] - n[:, 0] * 0.6, c[:, 2] - n[:, 2] * 0.6)]
    best = np.full(len(T), np.inf); tb = np.zeros(len(T), int)
    solid = np.zeros((ncand + 1, len(T)), bool)
    for k in range(1, ncand + 1):
        mk = B == k
        dk = nd.distance_transform_edt(~mk) * R
        Hk = nd.maximum_filter(np.where(mk, hm, 0), size=int(1.5 / R) * 2 + 1)
        dist = np.full(len(T), np.inf)
        for si, (i, j) in enumerate(samples):
            ok = (dk[i, j] <= 2.5) & (Hk[i, j] >= y0 - 1.0)
            dist = np.minimum(dist, np.where(ok, dk[i, j], np.inf))
            if si: solid[k] |= (dk[i, j] <= 0.3) & (Hk[i, j] >= c[:, 1] - 0.3)
        better = dist < best
        tb[better] = k; best[better] = dist[better]
    party = vert & (solid[1:].sum(0) >= 2) & np.isin(mname[MI], list(STRUCT))
    out = []
    for k in range(1, ncand + 1):
        sel = (tb == k) | (party & solid[k])
        if sel.sum() < 50: continue
        fp = nd.binary_fill_holes(nd.binary_closing(B == k, iterations=4))
        # drop floating fragments (pieces that neither touch the building's mass nor rest on it)
        sel = np.nonzero(sel)[0]
        sel = sel[_attached(T[sel], hm, fp, mn)]
        ys, xs = np.nonzero(fp)
        if not len(xs): continue
        # footprint bbox (CityGen is axis-aligned) -> local frame centred on it
        x0, x1 = (xs.min() - 2) * R + mn[0], (xs.max() - 2 + 1) * R + mn[0]
        z0, z1 = (ys.min() - 2) * R + mn[1], (ys.max() - 2 + 1) * R + mn[1]
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        hmk = np.where(fp, hm, 0)[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        Tk = T[sel].copy(); Tk[:, :, 0] -= cx; Tk[:, :, 2] -= cz
        Mk = MI[sel]
        fillT, area = _party_fill(Tk, np.isin(mname[Mk], list(STRUCT)), hmk, x1 - x0, z1 - z0)
        main = float(np.percentile(hmk[hmk > 0], 97))
        out.append(dict(key=k, cx=float(cx), cz=float(cz), w=float(x1 - x0), d=float(z1 - z0), h=main,
                        top=float(Tk[:, :, 1].max()), hm=hmk, T=Tk.astype(np.float32), UV=UV[sel], M=Mk,
                        fill=fillT, fillArea=area))
    log('[city] %d triangles -> %d candidate buildings' % (len(T), len(out)))
    return dict(J=J, image=image, mats=mats, cands=out, debug=dict(B=B, hm=hm, bar=bar, mn=mn))


if __name__ == '__main__':
    import sys
    r = extract(sys.argv[1])
    B = r['debug']['B']
    rng = np.random.RandomState(3); col = rng.randint(60, 255, (B.max() + 1, 3)); col[0] = 0
    im = col[B].astype(np.uint8); im[r['debug']['bar'] > 0] = 255
    for c in r['cands']:
        mn = r['debug']['mn']
        p = (int((c['cx'] - mn[0]) / R + 2), int((c['cz'] - mn[1]) / R + 2))
        cv2.putText(im, '%d %.0fx%.0fx%.0f' % (c['key'], c['w'], c['d'], c['h']), (p[0] - 40, p[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 1)
        print(c['key'], 'w %.1f d %.1f h %.1f top %.1f tris %d fill %.2f' % (c['w'], c['d'], c['h'], c['top'], len(c['T']), (c['hm'] > 0).mean()),
              sorted(set(r['mats'][m]['name'] for m in c['M']))[:20])
    cv2.imwrite(sys.argv[2], im)
