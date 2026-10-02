"""THREADLINE — scan map pipeline (seed MAN).

Converts the Lower Manhattan photogrammetry scan (source/ny_clean_up2.zip + textures/tex.jpg) into the
compact data the game embeds:

  build/scan.bin   little-endian sections (offsets in scan.json):
                     tiles: pos u16x3 (quantized to the scan bbox) | nrm i8x3 | uv u16x2 | idx u16
                     boxes: i16 x0,z0,x1,z1 (collision cells, inclusive) + u16 top height (dm)
                     land:  u8 per collision cell (1 = land, 0 = water)
  build/scan.json  scale, bounds, tile table, section offsets, spawn, nav (street graph + sidewalk loops)
  build/scan_tex.webp   the 8K photogrammetry atlas (re-encoded)
  build/scan_map.jpg    top-down orthographic render for the minimap / city map

World frame: metres, ground at y = 0, scan bbox centred on x = z = 0. The scan's own units are
~158 m (70 Pine St spire ~290 m; Whitehall ferry terminal -> Brooklyn Bridge anchorage ~1.4 km).
Collision is a 2 m top-surface heightfield (ground-normalised, spikes median-filtered, vegetation
dropped) greedily merged into axis-aligned boxes, so the existing OBB physics runs on it unchanged.

Usage: python tools/scan/build_scan.py
"""
import io, json, os, sys, time, zipfile
import numpy as np
from PIL import Image
from scipy import ndimage as nd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import trees_layout

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC_ZIP = os.path.join(ROOT, 'source', 'ny_clean_up2.zip')
SRC_TEX = os.path.join(ROOT, 'textures', 'tex.jpg')
OUT = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')   # per-agent build dirs: TL_BUILD_DIR=build_x

SCALE = 158.0         # metres per scan unit
CELL = 2.0            # collision heightfield cell (m)
TILE = 160.0          # render tile size (m) for frustum culling
BLD_MIN = 4.5         # heightfield cells above this (m, over local ground) are structure
Q_LOW, Q_HIGH, Q_SPLIT = 1.0, 2.0, 40.0   # height quantization below / above Q_SPLIT metres


def log(*a):
    print('[scan]', *a, flush=True)


def load_nyc_mask(NX, NZ):
    """Footprints of the NYC buildings actually placed (build/nyc_mask.npz from build_nyc.py), or None."""
    p = os.path.join(OUT, 'nyc_mask.npz')
    if not os.path.exists(p) or not os.path.exists(os.path.join(OUT, 'nyc.json')): return None
    d = np.load(p)
    fp = np.isin(d['ids'], d['kept'])
    k = int(round(CELL / float(d['rc'])))
    H, W = NZ * k, NX * k
    pad = np.zeros((H, W), bool); pad[:min(H, fp.shape[0]), :min(W, fp.shape[1])] = fp[:H, :W]
    fp2 = pad.reshape(NZ, k, NX, k).any(axis=(1, 3))
    meta = json.load(open(os.path.join(OUT, 'nyc.json')))
    raw = open(os.path.join(OUT, 'nyc.bin'), 'rb').read()
    st = meta['boxes'].get('stride', 6)
    boxes = np.frombuffer(raw, np.float32, meta['boxes']['n'] * st, meta['boxes']['o']).reshape(-1, st)
    log('NYC mask: %d footprint cells, %d buildings' % (fp.sum(), len(d['kept'])))
    return {'fp2': fp2, 'x0': float(d['x0']), 'z0': float(d['z0']), 'rc': float(d['rc']), 'boxes': boxes,
            'cut': nd.binary_dilation(fp, iterations=3), 'near': nd.binary_dilation(fp, iterations=16)}


def build_nav(hq, land, veg, ox, oz):
    """Street graph for traffic (skeleton of the open street space) and sidewalk loops for pedestrians
    (outlines of each building block, ~2-3 m off the walls). World metres; JSON-friendly lists."""
    import cv2, networkx as nx
    wx = lambda c: round(float(ox + (c + 0.5) * CELL), 2)
    wz = lambda r: round(float(oz + (r + 0.5) * CELL), 2)
    bld = hq > 0
    vegbig = nd.binary_opening(veg, iterations=3)                 # parks / canopies, not single street trees
    street = nd.binary_opening(land & ~bld & ~vegbig, iterations=1)
    dist = nd.distance_transform_edt(street) * CELL              # metres to the nearest wall / kerb
    wide = street & (nd.maximum_filter(dist, 5) >= 3.0)
    lab, n = nd.label(wide)
    wide = lab == (np.argmax(nd.sum(wide, lab, range(1, n + 1))) + 1)
    sk = cv2.ximgproc.thinning(wide.astype(np.uint8) * 255) > 0
    S = set(zip(*[a.tolist() for a in np.nonzero(sk)]))
    G = nx.Graph()
    for (z, x) in S:
        G.add_node((z, x))
        for dz, dx in ((0, 1), (1, 0)):
            if (z + dz, x + dx) in S: G.add_edge((z, x), (z + dz, x + dx))
        for dz, dx in ((1, 1), (1, -1)):              # diagonal only where no orthogonal path exists
            if (z + dz, x + dx) in S and (z + dz, x) not in S and (z, x + dx) not in S: G.add_edge((z, x), (z + dz, x + dx))

    def chains():
        out, seen = [], set()
        for s in [v for v in G if G.degree(v) != 2]:
            for t in G[s]:
                if (s, t) in seen: continue
                path = [s, t]; seen.add((s, t)); seen.add((t, s))
                while G.degree(path[-1]) == 2:
                    a, b = list(G[path[-1]]); q = a if a != path[-2] else b
                    if (path[-1], q) in seen: break
                    seen.add((path[-1], q)); seen.add((q, path[-1])); path.append(q)
                out.append(path)
        return out

    for _ in range(8):                                   # prune short dead-end spurs
        rem = []
        for p in chains():
            da, db = G.degree(p[0]), G.degree(p[-1])
            if (da == 1) != (db == 1) and len(p) * CELL < 30: rem += p[:-1] if db != 1 else p[1:]
        rem = [v for v in set(rem) if G.degree(v) <= 2]
        G.remove_nodes_from(rem); G.remove_nodes_from([v for v in list(G) if G.degree(v) == 0])
        if not rem: break
    G = G.subgraph(max(nx.connected_components(G), key=len)).copy()
    nid, nodes, edges = {}, [], set()

    def node(v):
        if v not in nid:
            nid[v] = len(nodes); nodes.append([wx(v[1]), wz(v[0]), round(float(max(dist[v], 2.5)), 1)])
        return nid[v]
    for p in chains():
        pts = np.array([(v[1], v[0]) for v in p], np.float32).reshape(-1, 1, 2)
        keep = cv2.approxPolyDP(pts, 1.0, False).reshape(-1, 2)
        ids = [node((int(q[1]), int(q[0]))) for q in keep]
        for a, b in zip(ids, ids[1:]):
            if a != b: edges.add((min(a, b), max(a, b)))
    # sidewalk loops around building blocks
    block = nd.binary_fill_holes(nd.binary_closing(bld, iterations=1))
    ring = nd.binary_dilation(block, iterations=1).astype(np.uint8)
    cs, _ = cv2.findContours(ring, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    loops = []
    for c in cs:
        if cv2.contourArea(c) * CELL * CELL < 300: continue
        s = cv2.approxPolyDP(c, 1.0, True).reshape(-1, 2)
        if len(s) < 3: continue
        loops.append([[wx(q[0]), wz(q[1])] for q in s])
    log('nav: %d road nodes, %d road edges, %d junctions, %d sidewalk loops' % (
        len(nodes), len(edges), sum(1 for v in G if G.degree(v) >= 3), len(loops)))
    return {'nodes': nodes, 'edges': sorted(edges), 'loops': loops}


def load_obj():
    t = time.time()
    with zipfile.ZipFile(SRC_ZIP) as z:
        name = next(n for n in z.namelist() if n.lower().endswith('.obj'))
        text = z.read(name).decode('utf8', 'replace')
    V, VT, F = [], [], []
    for ln in text.splitlines():
        if ln.startswith('v '):
            V.append(ln.split()[1:4])
        elif ln.startswith('vt '):
            VT.append(ln.split()[1:3])
        elif ln.startswith('f '):
            p = ln.split()[1:]
            if len(p) != 3:        # the export is all triangles; fan anything else
                for k in range(1, len(p) - 1):
                    F.append([p[0].split('/')[:2], p[k].split('/')[:2], p[k + 1].split('/')[:2]])
                continue
            F.append([q.split('/')[:2] for q in p])
    V = np.array(V, np.float64); VT = np.array(VT, np.float64); F = np.array(F, np.int64) - 1
    log('obj', name, 'v', len(V), 'vt', len(VT), 'tris', len(F), '%.1fs' % (time.time() - t))
    return V, VT, F


def main():
    os.makedirs(OUT, exist_ok=True)
    V, VT, F = load_obj()
    tex = np.asarray(Image.open(SRC_TEX).convert('RGB'))
    TH, TW = tex.shape[:2]

    # ---------------------------------------------------------------- metres, centred
    P = V * SCALE
    mn, mx = P.min(0), P.max(0)
    cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
    P[:, 0] -= cx; P[:, 2] -= cz
    mn, mx = P.min(0), P.max(0)

    # drop degenerate triangles
    fi, ti = F[:, :, 0], F[:, :, 1]
    T = P[fi]
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    area = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    keep = area > 1e-4
    F, fi, ti, T, e1, e2, area = F[keep], fi[keep], ti[keep], T[keep], e1[keep], e2[keep], area[keep]
    log('kept tris', len(F))

    # ---------------------------------------------------------------- top-surface heightfield (point splat)
    t = time.time()
    NX = int(np.ceil((mx[0] - mn[0]) / CELL)) + 1
    NZ = int(np.ceil((mx[2] - mn[2]) / CELL)) + 1
    ox, oz = mn[0], mn[2]
    top = np.full(NX * NZ, -1e9); cnt = np.zeros(NX * NZ, np.int64); csum = np.zeros((NX * NZ, 3))
    U = VT[ti]
    n = np.clip(np.ceil(area / 0.5), 2, 4000).astype(np.int64)
    rng = np.random.default_rng(1)
    idx_all = np.repeat(np.arange(len(F)), n)
    for s in range(0, len(idx_all), 4_000_000):
        ii = idx_all[s:s + 4_000_000]
        a = rng.random((len(ii), 1)); b = rng.random((len(ii), 1)); m = (a + b) > 1; a[m] = 1 - a[m]; b[m] = 1 - b[m]
        p = T[ii, 0] + e1[ii] * a + e2[ii] * b
        u = U[ii, 0] + (U[ii, 1] - U[ii, 0]) * a + (U[ii, 2] - U[ii, 0]) * b
        k = ((p[:, 2] - oz) / CELL).astype(np.int64) * NX + ((p[:, 0] - ox) / CELL).astype(np.int64)
        np.maximum.at(top, k, p[:, 1]); np.add.at(cnt, k, 1)
        tx = np.clip((u[:, 0] * TW).astype(np.int64), 0, TW - 1); ty = np.clip(((1 - u[:, 1]) * TH).astype(np.int64), 0, TH - 1)
        c = tex[ty, tx].astype(np.float64)
        for ch in range(3): np.add.at(csum[:, ch], k, c[:, ch])
    col = (csum / np.maximum(cnt, 1)[:, None]).reshape(NZ, NX, 3); top = top.reshape(NZ, NX); cnt = cnt.reshape(NZ, NX)
    log('heightfield %dx%d  %.1fs' % (NX, NZ, time.time() - t))

    has = cnt > 0
    land = nd.binary_closing(has, iterations=3)
    land = nd.binary_fill_holes(land)
    land = nd.binary_opening(land, iterations=2)
    nyc = load_nyc_mask(NX, NZ)

    def ground_field(src, pct, size):
        g_ = nd.percentile_filter(src, pct, size=size)
        g_[g_ > 5e3] = np.nan
        fill = nd.distance_transform_edt(np.isnan(g_), return_distances=False, return_indices=True)
        return nd.gaussian_filter(g_[tuple(fill)], 6)
    # local ground, pass 1: low percentile of the top surface over ~62 m (fooled inside big buildings: the
    # window sees only roof); pass 2: the same over street cells only, away from anything building-like
    g = ground_field(np.where(has, top, 1e4), 8, 31)
    blocked = (top - g > 6.0) & has
    if nyc is not None: blocked |= nyc['fp2']
    street_c = has & ~nd.binary_dilation(blocked, iterations=2)
    g = ground_field(np.where(street_c, top, 1e4), 20, 51)
    base = float(np.median(g[land]))
    log('ground base %.1f m, spread p5/p95' % base, np.round(np.percentile(g[land] - base, [5, 95]), 1))

    h = np.where(has, top - g, 0.0)
    h = np.where(land & ~has, nd.median_filter(h, 5), h)
    h = np.where(land, h, 0.0)
    h = nd.median_filter(h, 3)
    r, gc, bl = col[..., 0], col[..., 1], col[..., 2]
    veg = nd.binary_opening((gc > r * 1.05) & (gc > bl * 0.98) & (h < 25), iterations=1)
    bld = nd.binary_opening((h > BLD_MIN) & ~veg & land, iterations=1)
    hm = nd.median_filter(np.where(bld, h, 0.0), 5)
    hs = np.where(bld, np.maximum(hm, BLD_MIN), 0.0)
    hq = np.where(hs < Q_SPLIT, np.round(hs / Q_LOW) * Q_LOW, np.round(hs / Q_HIGH) * Q_HIGH)
    hq = np.where(bld, hq, 0.0)

    # NYC official buildings (tools/scan/build_nyc.py) replace the scan's own: no scan collision on or right
    # next to their footprints; the street graph routes around them
    hq_nav = hq
    if nyc is not None:
        fp2 = nyc['fp2']
        hq = np.where(nd.binary_dilation(fp2, iterations=1) | (nd.binary_dilation(fp2, iterations=2) & ~veg), 0.0, hq)
        hq_nav = np.where(fp2, 10.0, hq)

    def sample(field, x, z):
        fx = np.clip((x - ox) / CELL - 0.5, 0, NX - 1.001); fz = np.clip((z - oz) / CELL - 0.5, 0, NZ - 1.001)
        return nd.map_coordinates(field, [fz, fx], order=1)

    def nyc_drop(Pf):
        """triangles the render drops for the NYC buildings: scan buildings under / near NYC footprints and the bare ground"""
        T_ = Pf[fi]; cen_ = T_.mean(1); uvc = VT[ti].mean(1)
        cc = np.clip(((cen_[:, 0] - nyc['x0']) / nyc['rc']).astype(int), 0, nyc['cut'].shape[1] - 1)
        rr = np.clip(((cen_[:, 2] - nyc['z0']) / nyc['rc']).astype(int), 0, nyc['cut'].shape[0] - 1)
        c = tex[np.clip(((1 - uvc[:, 1]) * TH).astype(int), 0, TH - 1), np.clip((uvc[:, 0] * TW).astype(int), 0, TW - 1)].astype(float)
        vegc = (c[:, 1] > c[:, 0] * 1.05) & (c[:, 1] > c[:, 2] * 0.98)
        drop = nyc['cut'][rr, cc] | ((cen_[:, 1] > 3.0) & nyc['near'][rr, cc] & ~vegc)
        drop |= (cen_[:, 1] < 3.5) & ~vegc              # the ground itself comes from the NYC linework texture
        return drop

    # trees (tools/scan/trees_layout.py): find the scan's canopies, place detailed tree models there (extra/trees_layout.json),
    # cut the photogrammetry blobs out of the render tiles and keep their cells free of collision boxes
    Pf = P.copy(); Pf[:, 1] -= sample(g, P[:, 0], P[:, 2])
    TREES = trees_layout.detect(Pf, fi, ti, VT, tex, ~nyc_drop(Pf) if nyc is not None else np.ones(len(fi), bool),
                                nyc, land, ox, oz, CELL, NX, NZ, OUT, log)
    if os.environ.get('TL_TREES_DEBUG'):
        import cv2
        dbg = np.zeros((NZ, NX, 3), np.uint8); dbg[land] = (40, 40, 40); dbg[hq > 0] = (0, 0, 200)
        dbg[(hq > 0) & TREES['mask2']] = (0, 220, 255); dbg[TREES['mask2'] & ~(hq > 0)] = (0, 110, 0)
        cv2.imwrite(os.environ['TL_TREES_DEBUG'], cv2.resize(dbg, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))
    hq = np.where(TREES['mask2'], 0.0, hq)
    del Pf

    # collision must follow what is actually drawn: the 5x5 median above smears every building outwards, and trees / low
    # structures leave tall boxes over empty air ("invisible walls"). Keep a cell only where the raw scan surface really
    # reaches most of the box height (closing one cell so a hole in the roof scan doesn't open a walk-through).
    raw_h = np.where(has, top - g, 0.0)
    keep = (raw_h >= 0.65 * hq) & (hq > 0)
    keep = nd.binary_closing(keep, iterations=1) & (hq > 0)
    keep = nd.binary_opening(keep, structure=np.ones((2, 2)))
    log('collision cells trimmed to the drawn surface: %d -> %d' % ((hq > 0).sum(), keep.sum()))
    hq = np.where(keep, hq, 0.0)
    # clutter the scan sees as 'structure' (kiosks, poles, boats, scaffolding, tree crowns next to lawns): small isolated
    # low clusters and anything right against vegetation are not worth a wall the player can't see
    lab, nlab = nd.label(hq > 0)
    if nlab:
        area = np.bincount(lab.ravel(), minlength=nlab + 1); mxh = nd.maximum(hq, lab, index=np.arange(nlab + 1))
        small = (area < 7) & (mxh < 16.0)                # < ~28 m^2 footprint and under 16 m tall
        near_veg = nd.binary_dilation(veg, iterations=1) & (hq < 20.0)
        hq = np.where(small[lab] | near_veg, 0.0, hq)
        log('collision clutter removed: %d small clusters' % int(small[1:].sum()))

    # greedy rectangle merge
    t = time.time()
    used = np.zeros(hq.shape, bool); boxes = []
    for z in range(NZ):
        row = hq[z]; x = 0
        while x < NX:
            if row[x] <= 0 or used[z, x]: x += 1; continue
            hv = row[x]; x1 = x
            while x1 + 1 < NX and row[x1 + 1] == hv and not used[z, x1 + 1]: x1 += 1
            z1 = z
            while z1 + 1 < NZ and np.all(hq[z1 + 1, x:x1 + 1] == hv) and not used[z1 + 1, x:x1 + 1].any(): z1 += 1
            used[z:z1 + 1, x:x1 + 1] = True
            boxes.append((x, z, x1, z1, int(round(hv * 10))))
            x = x1 + 1
    boxes = np.array(boxes, np.int32)
    log('collision boxes', len(boxes), '%.1fs' % (time.time() - t))
    nav = build_nav(hq_nav, land, veg, ox, oz)

    # ---------------------------------------------------------------- flatten the render mesh onto the same ground
    P[:, 1] -= sample(g, P[:, 0], P[:, 2])
    mn, mx = P.min(0), P.max(0)

    fi_all, ti_all = fi, ti          # the top-down map keeps the full scan
    # full ground-flattened scan for build_nyc.py's texture bake (world frame, before any cutting)
    np.savez(os.path.join(OUT, 'scan_flat.npz'), P=P.astype(np.float32), fi=fi.astype(np.int32), ti=ti.astype(np.int32), VT=VT.astype(np.float32))
    # cut the scan's buildings where NYC buildings stand: keep ground, trees, piers, the elevated FDR
    drop = TREES['drop'].copy()                        # tree blobs (replaced by tree models)
    if nyc is not None:
        dn = nyc_drop(P)
        log('scan tris cut under NYC buildings', int(dn.sum()))
        drop |= dn
    F, fi, ti = F[~drop], fi[~drop], ti[~drop]
    log('scan tris kept', len(F))

    # per-position smooth normals (area-weighted, shared across UV seams)
    T = P[fi]
    fn = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    VN = np.zeros_like(P)
    for k in range(3): np.add.at(VN, fi[:, k], fn)
    VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-9)

    # ---------------------------------------------------------------- render tiles
    cen = T.mean(1)
    TX = int(np.ceil((mx[0] - mn[0]) / TILE)); TZ = int(np.ceil((mx[2] - mn[2]) / TILE))
    tid = np.clip(((cen[:, 2] - mn[2]) // TILE).astype(int), 0, TZ - 1) * TX + np.clip(((cen[:, 0] - mn[0]) // TILE).astype(int), 0, TX - 1)
    ext = np.maximum(mx - mn, 1e-6)
    parts, tiles, off = [], [], 0

    def put(arr):
        nonlocal off
        b = arr.tobytes(); pad = (-len(b)) % 4
        parts.append(b + b'\0' * pad); o = off; off += len(b) + pad; return o

    for t_ in range(TX * TZ):
        sel = np.nonzero(tid == t_)[0]
        if not len(sel): continue
        # split oversized tiles so u16 indices always fit
        for chunk in np.array_split(sel, int(np.ceil(len(sel) * 3 / 60000))):
            pairs = np.stack([fi[chunk].ravel(), ti[chunk].ravel()], 1)
            uniq, inv = np.unique(pairs, axis=0, return_inverse=True)
            inv = inv.reshape(-1)
            assert len(uniq) < 65536
            pv = P[uniq[:, 0]]; nv = VN[uniq[:, 0]]; uv = VT[uniq[:, 1]]
            q = np.round((pv - mn) / ext * 65535).astype(np.uint16)
            nq = np.round(nv * 127).astype(np.int8)
            uq = np.round(np.clip(uv, 0, 1) * 65535).astype(np.uint16)
            tiles.append({
                'n': int(len(uniq)), 'i': int(len(inv)),
                'pos': put(q), 'nrm': put(nq), 'uv': put(uq), 'idx': put(inv.astype(np.uint16)),
                'min': [round(float(v), 2) for v in pv.min(0)], 'max': [round(float(v), 2) for v in pv.max(0)],
            })
    boxes_off = put(boxes[:, :4].astype(np.int16)); boxh_off = put(boxes[:, 4].astype(np.uint16))
    land_off = put(land.astype(np.uint8))
    log('tiles', len(tiles), 'verts', sum(t['n'] for t in tiles), 'bin %.2f MB' % (off / 1048576))

    # ---------------------------------------------------------------- spawn: a broad high roof near the centre
    bw = (boxes[:, 2] - boxes[:, 0] + 1) * CELL; bd = (boxes[:, 3] - boxes[:, 1] + 1) * CELL; bh = boxes[:, 4] / 10
    bx = ox + (boxes[:, 0] + boxes[:, 2] + 1) / 2 * CELL; bz = oz + (boxes[:, 1] + boxes[:, 3] + 1) / 2 * CELL
    if nyc is not None and len(nyc['boxes']):      # spawn on an NYC roof instead
        nb_ = nyc['boxes']; bx, bh, bz = nb_[:, 0], nb_[:, 1], nb_[:, 2]; bw, bd = nb_[:, 3] * 2, nb_[:, 4] * 2
    ok = (bw >= 10) & (bd >= 10) & (bh > 90) & (bh < 190)
    score = np.where(ok, -np.hypot(bx, bz) + bw * bd * 0.05, -1e9)
    s = int(np.argmax(score))
    spawn = {'x': round(float(bx[s]), 2), 'y': round(float(bh[s]) + 0.1, 2), 'z': round(float(bz[s]), 2)}
    log('spawn', spawn, 'roof %.0fx%.0f' % (bw[s], bd[s]))

    meta = {
        'v': 1, 'name': 'Lower Manhattan (scan)', 'scale': SCALE,
        'min': [round(float(v), 3) for v in mn], 'max': [round(float(v), 3) for v in mx],
        'cell': CELL, 'nx': NX, 'nz': NZ, 'ox': round(float(ox), 3), 'oz': round(float(oz), 3),
        'tiles': tiles, 'boxes': {'n': int(len(boxes)), 'rect': boxes_off, 'h': boxh_off}, 'land': land_off,
        'spawn': spawn, 'bytes': off, 'nav': nav,
    }
    with open(os.path.join(OUT, 'scan.bin'), 'wb') as f:
        for p in parts: f.write(p)
    with open(os.path.join(OUT, 'scan.json'), 'w') as f: json.dump(meta, f, separators=(',', ':'))

    # ---------------------------------------------------------------- texture + top-down map
    ti_ = Image.fromarray(tex)
    if nyc is not None: ti_.thumbnail((4096, 4096), Image.LANCZOS)   # with NYC buildings it only covers trees / piers / the FDR
    ti_.save(os.path.join(OUT, 'scan_tex.webp'), 'WEBP', quality=75, method=4)
    t = time.time()
    MAPW = 1024; ms = (MAPW - 1) / (mx[0] - mn[0]); MH = int((mx[2] - mn[2]) * ms) + 1
    zbuf = np.full(MH * MAPW, -1e9); img = np.zeros((MH * MAPW, 3), np.uint8)
    T = P[fi_all]; e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]; U = VT[ti_all]
    for _ in range(20):
        a = rng.random((len(T), 1)); b = rng.random((len(T), 1)); m = (a + b) > 1; a[m] = 1 - a[m]; b[m] = 1 - b[m]
        p = T[:, 0] + e1 * a + e2 * b; u = U[:, 0] + (U[:, 1] - U[:, 0]) * a + (U[:, 2] - U[:, 0]) * b
        k = ((p[:, 2] - mn[2]) * ms).astype(np.int64) * MAPW + ((p[:, 0] - mn[0]) * ms).astype(np.int64)
        c = tex[np.clip(((1 - u[:, 1]) * TH).astype(np.int64), 0, TH - 1), np.clip((u[:, 0] * TW).astype(np.int64), 0, TW - 1)]
        o = np.argsort(p[:, 1]); k, y, c = k[o], p[o, 1], c[o]
        w = y > zbuf[k]; zbuf[k[w]] = y[w]; img[k[w]] = c[w]
    img = img.reshape(MH, MAPW, 3)
    hole = zbuf.reshape(MH, MAPW) < -1e8
    fillm = nd.distance_transform_edt(hole, return_distances=False, return_indices=True)
    img = img[tuple(fillm)]
    lm = nd.zoom(land.astype(np.float32), (MH / NZ, MAPW / NX), order=1)[:MH, :MAPW] > 0.5
    img[~lm] = (24, 56, 74)
    Image.fromarray(img).save(os.path.join(OUT, 'scan_map.jpg'), 'JPEG', quality=82)
    meta['map'] = {'w': MAPW, 'h': MH, 'min': [round(float(mn[0]), 3), round(float(mn[2]), 3)], 'mpp': round(1 / ms, 5)}
    with open(os.path.join(OUT, 'scan.json'), 'w') as f: json.dump(meta, f, separators=(',', ':'))
    log('map %dx%d %.1fs' % (MAPW, MH, time.time() - t))
    for fn_ in ('scan.bin', 'scan.json', 'scan_tex.webp', 'scan_map.jpg'):
        log('%-14s %.2f MB' % (fn_, os.path.getsize(os.path.join(OUT, fn_)) / 1048576))


if __name__ == '__main__':
    sys.exit(main())
