"""THREADLINE — streets for the scan map (seed MAN): road / sidewalk / curb surfaces, markings and street furniture
from the user's NYC street set (src/street/source/ZZ60c.zip) laid onto the real Lower Manhattan street plan.

Inputs (all read-only, from the build dir, TL_BUILD_DIR honoured):
  nyc_raw.pkl  DCP planimetric linework (Roadbed, Parking Lot(s), Parks/Park, Open Space)  [tools/scan/nyc_extract.py]
  scan.json/.bin  frame + 2 m land mask (the flat ground mesh of 03b_scan.js covers exactly its land cells)
  nyc_mask.npz    0.5 m building footprint ids (sidewalk depth for props)              [tools/scan/build_nyc.py]
  extra/trees_layout.json   street trees (tree pits, keep props clear of trunks)
  src/street/source/ZZ60c.zip     the street set (props + kit textures, through Blender: tools/scan/streets_kit.py)
  src/new-york-city/source/procedural_city_6.glb   bench + bike rack, grass / curb detail textures
Outputs (<build>/extra/, embedded by tools/build.js, decoded by src/03e_streets.js):
  streets_meta.json   layout of streets_data.bin.gz + prop types + instance tables
  streets_data.bin.gz sidewalk slab mesh (+15 cm), curb faces, paint/decal quads, curb segments + 4 m lookup grid,
                      0.5 m raised-ground bit raster (physics), 1 m street-light pool raster, prop meshes
  streets_*.webp      tiled detail textures (asphalt, flags, granite, grass, paint/decals, prop atlas)

Geometry model: the existing flat ground (y = -0.02) stays as the roadbed; sidewalks, plazas and parks become a slab
15 cm higher with granite curb faces along every roadbed edge. Lanes, crosswalks and stop bars are real geometry
decals built from the road's medial axis (one-way / two-way by width); the shader gets exact curb distance and
direction from the segment grid (flag joints aligned to the curb, granite curb top, gutter grime).
Usage: TL_BUILD_DIR=build_streets python tools/scan/streets.py
"""
import gzip, io, json, math, os, pickle, struct, subprocess, sys, time, zipfile
import numpy as np
import cv2
from PIL import Image, ImageFilter
from scipy import ndimage as nd
import shapely
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, Point, box
from shapely.ops import unary_union, linemerge

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
OUT = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
EXTRA = os.path.join(OUT, 'extra')
BLENDER = os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 4.3\blender.exe'
KIT_ZIP = os.path.join(ROOT, 'src', 'street', 'source', 'ZZ60c.zip')
GLB = os.path.join(ROOT, 'src', 'new-york-city', 'source', 'procedural_city_6.glb')
FT = 0.3048
RC = 0.5            # analysis raster (m), same frame as nyc_ground.jpg / nyc_mask.npz
CURB_H = 0.15       # sidewalk slab top over the roadbed plane (y)
GROUND_Y = -0.02    # 03b_scan.js buildGround()
GCELL = 4.0         # curb segment lookup grid cell (m)
GK = 8              # segments per grid cell
RNG = np.random.default_rng(1234)


def log(*a): print('[streets]', *a, flush=True)


# ====================================================================================== inputs
class Ctx:
    def __init__(self):
        self.meta = json.load(open(os.path.join(OUT, 'scan.json')))
        self.aff = np.array(json.load(open(os.path.join(ROOT, 'tools', 'scan', 'nyc_affine.json')))['affine'])
        self.lines = pickle.load(open(os.path.join(OUT, 'nyc_raw.pkl'), 'rb'))['lines']
        m = self.meta
        b = open(os.path.join(OUT, 'scan.bin'), 'rb').read()
        self.land = np.frombuffer(b, np.uint8, m['nx'] * m['nz'], m['land']).reshape(m['nz'], m['nx'])
        self.X0, self.Z0 = m['min'][0], m['min'][2]
        self.GW, self.GH = int(np.ceil((m['max'][0] - self.X0) / RC)), int(np.ceil((m['max'][2] - self.Z0) / RC))
        mk = np.load(os.path.join(OUT, 'nyc_mask.npz'))
        self.ids = mk['ids']
        assert abs(float(mk['x0']) - self.X0) < 1e-3 and abs(float(mk['rc']) - RC) < 1e-6

    def tf(self, V):
        a = self.aff; E, N = V[:, 0] * FT, V[:, 1] * FT
        return np.stack([a[0, 0] * E + a[0, 1] * N + a[0, 2], a[1, 0] * E + a[1, 1] * N + a[1, 2]], 1)

    def polys(self, *names):
        out = []
        for nm in names:
            for L in self.lines.get('Linework::' + nm, []):
                if len(L) < 3: continue
                p = Polygon(self.tf(np.asarray(L, float)))
                if not p.is_valid: p = p.buffer(0)
                if p.area > 0.5: out.append(p)
        return out

    def land_poly(self):
        """exact outline of the flat ground mesh (2 m land cells, merged row runs like buildGround())"""
        m, L, cs = self.meta, self.land, self.meta['cell']
        rects = []
        for j in range(m['nz']):
            row = L[j] == 1
            if not row.any(): continue
            d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
            for a, b in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
                rects.append(box(m['ox'] + a * cs, m['oz'] + j * cs, m['ox'] + b * cs, m['oz'] + (j + 1) * cs))
        return unary_union(rects)

    def raster(self, geom, val=1, shape=None):
        """rasterise polygons into the 0.5 m frame (cell centres)"""
        R = np.zeros(shape or (self.GH, self.GW), np.uint8)
        for p in getattr(geom, 'geoms', [geom]):
            if p.is_empty or p.geom_type != 'Polygon': continue
            ext = np.round((np.asarray(p.exterior.coords) - [self.X0, self.Z0]) / RC * 8 - 4).astype(np.int32)
            cv2.fillPoly(R, [ext], val, shift=3)
            for h in p.interiors:
                q = np.round((np.asarray(h.coords) - [self.X0, self.Z0]) / RC * 8 - 4).astype(np.int32)
                cv2.fillPoly(R, [q], 0, shift=3)
        return R


def polygons(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    if g.geom_type == 'MultiPolygon': return list(g.geoms)
    return [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']


def lines_of(g):
    if g.is_empty: return []
    if g.geom_type == 'LineString': return [g]
    if g.geom_type == 'MultiLineString': return list(g.geoms)
    out = []
    for q in getattr(g, 'geoms', []): out += lines_of(q)
    return out


# ====================================================================================== surfaces
def surfaces(C):
    t = time.time()
    land = C.land_poly()
    road_raw = unary_union(C.polys('Roadbed'))
    park_raw = unary_union(C.polys('Parks', 'Park'))
    open_raw = unary_union(C.polys('Open Space'))
    lot_raw = unary_union(C.polys('Parking Lots', 'Parking Lot'))
    # close the hairline gaps between the DCP's roadbed pieces, drop slivers
    road = road_raw.buffer(0.08, join_style='mitre').buffer(-0.08, join_style='mitre').intersection(land)
    lots = lot_raw.difference(park_raw).intersection(land)
    asphalt = unary_union([road, lots]).buffer(0)
    slab = land.difference(asphalt)
    slab = unary_union([p for p in polygons(slab) if p.area > 2.0]).simplify(0.02)
    asphalt = land.difference(slab)
    park = park_raw.intersection(slab).buffer(0)
    plaza = open_raw.intersection(slab).difference(park).buffer(0)
    log('surfaces: land %.0f, road %.0f, lots %.0f, slab %.0f (park %.0f, plaza %.0f) m2  %.1fs' % (
        land.area, road.area, lots.area, slab.area, park.area, plaza.area, time.time() - t))
    return dict(land=land, road=road, lots=lots, asphalt=asphalt, slab=slab, park=park, plaza=plaza)



def thin_paths(C, S):
    """roadbed strips narrower than ~4 m that run through parks / plazas (service lanes, the DCP's park drives) are paved
    paths, not streets: move them to the slab as plaza"""
    R = C.raster(S['road'])
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))          # 4.5 m opening
    op = cv2.morphologyEx(R, cv2.MORPH_OPEN, k)
    rest = (R > 0) & (op == 0)
    lab, n = nd.label(rest)
    if not n: return S
    area = nd.sum(rest, lab, range(1, n + 1)) * RC * RC
    sl = nd.find_objects(lab)
    keep = np.zeros(n + 1, bool)
    for i in range(n):
        if area[i] < 60: continue
        ext = max(sl[i][0].stop - sl[i][0].start, sl[i][1].stop - sl[i][1].start) * RC
        if ext > 25 and area[i] / ext < 4.5: keep[i + 1] = True
    M = keep[lab].astype(np.uint8)
    if not M.any(): return S
    M = cv2.dilate(M, np.ones((3, 3), np.uint8))
    cs, hier = cv2.findContours(M, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    ps = []
    for c in cs:
        if len(c) < 3: continue
        q = c.reshape(-1, 2).astype(float) * RC + [C.X0 + RC / 2, C.Z0 + RC / 2]
        p = Polygon(q).buffer(0)
        if p.area > 20: ps.append(p)
    P = unary_union(ps).intersection(S['road'])
    log('thin roadbed strips moved to paths: %.0f m2' % P.area)
    S = dict(S)
    S['road'] = S['road'].difference(P).buffer(0)
    S['asphalt'] = S['asphalt'].difference(P).buffer(0)
    S['slab'] = unary_union([S['slab'], P]).buffer(0)
    S['plaza'] = unary_union([S['plaza'], P.difference(S['park'])]).buffer(0)
    return S


# ====================================================================================== street skeleton
def skeleton(C, S):
    """medial axis of the roadbed -> chains between junctions with half-widths (world m)"""
    import networkx as nx
    t = time.time()
    R = C.raster(S['road'])
    R = cv2.medianBlur(R * 255, 5) > 0
    dt = nd.distance_transform_edt(R) * RC
    sk = cv2.ximgproc.thinning((R * 255).astype(np.uint8)) > 0
    G = nx.Graph()
    ys, xs = np.nonzero(sk)
    Sset = set(zip(ys.tolist(), xs.tolist()))
    for (y, x) in Sset:
        G.add_node((y, x))
        for dy, dx in ((0, 1), (1, 0)):
            if (y + dy, x + dx) in Sset: G.add_edge((y, x), (y + dy, x + dx))
        for dy, dx in ((1, 1), (1, -1)):
            if (y + dy, x + dx) in Sset and (y + dy, x) not in Sset and (y, x + dx) not in Sset: G.add_edge((y, x), (y + dy, x + dx))

    def chains():
        out, seen = [], set()
        for s0 in [v for v in G if G.degree(v) != 2]:
            for t1 in G[s0]:
                if (s0, t1) in seen: continue
                path = [s0, t1]; seen.add((s0, t1)); seen.add((t1, s0))
                while G.degree(path[-1]) == 2:
                    a, b = list(G[path[-1]]); q = a if a != path[-2] else b
                    if (path[-1], q) in seen: break
                    seen.add((path[-1], q)); seen.add((q, path[-1])); path.append(q)
                out.append(path)
        return out
    for _ in range(12):                       # prune spurs: dead ends shorter than the road is wide
        rem = []
        for p in chains():
            da, db = G.degree(p[0]), G.degree(p[-1])
            if (da == 1) != (db == 1):
                jn = p[-1] if da == 1 else p[0]
                if len(p) * RC < max(8.0, 1.6 * dt[jn]): rem += p[:-1] if da == 1 else p[1:]
        rem = [v for v in set(rem) if G.degree(v) <= 2]
        G.remove_nodes_from(rem); G.remove_nodes_from([v for v in list(G) if G.degree(v) == 0])
        if not rem: break
    # merge junction clusters (adjacent junction pixels) into one node id
    jpx = [v for v in G if G.degree(v) >= 3]
    jid = {}
    for comp in nx.connected_components(G.subgraph(jpx)):
        k = len(set(jid.values()))
        for v in comp: jid[v] = k
    J = {}
    for v, k in jid.items(): J.setdefault(k, []).append(v)
    jpos = {k: (np.mean([C.X0 + (v[1] + 0.5) * RC for v in vs]), np.mean([C.Z0 + (v[0] + 0.5) * RC for v in vs])) for k, vs in J.items()}
    out = []
    for p in chains():
        if len(p) < 3: continue
        if all(v in jid for v in p): continue
        pts = np.array([[C.X0 + (v[1] + 0.5) * RC, C.Z0 + (v[0] + 0.5) * RC] for v in p])
        hw = np.array([dt[v] for v in p])
        out.append({'pts': pts, 'hw': hw, 'ja': jid.get(p[0], -1), 'jb': jid.get(p[-1], -1),
                    'da': G.degree(p[0]), 'db': G.degree(p[-1])})
    # junctions split by the thinning (a 4-way often comes out as two T's joined by a stub): merge them and drop
    # the stubs, so arms are counted per real intersection
    par = {k: k for k in J}
    def f(k):
        while par[k] != k: par[k] = par[par[k]]; k = par[k]
        return k
    keep = []
    for c in out:
        Lc = float(np.sum(np.linalg.norm(np.diff(c['pts'], axis=0), axis=1)))
        if c['ja'] >= 0 and c['jb'] >= 0 and Lc < max(12.0, c['hw'][0] + c['hw'][-1] + 3.0):
            ra, rb = f(c['ja']), f(c['jb'])
            if ra != rb: par[ra] = rb
            continue
        keep.append(c)
    for c in keep:
        if c['ja'] >= 0: c['ja'] = f(c['ja'])
        if c['jb'] >= 0: c['jb'] = f(c['jb'])
    grp = {}
    for k, v in jpos.items(): grp.setdefault(f(k), []).append(v)
    jpos = {k: tuple(np.mean(v, 0)) for k, v in grp.items()}
    out = keep
    log('skeleton: %d chains, %d junctions %.1fs' % (len(out), len(jpos), time.time() - t))
    return out, jpos, dt


def resample(pts, step=1.0):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    if d[-1] < step: return pts[[0, -1]], np.array([0, d[-1]])
    s = np.linspace(0, d[-1], int(d[-1] / step) + 1)
    return np.stack([np.interp(s, d, pts[:, 0]), np.interp(s, d, pts[:, 1])], 1), s


def smooth_line(pts, it=3):
    P = pts.copy()
    for _ in range(it):
        Q = P.copy(); Q[1:-1] = (P[:-2] + 2 * P[1:-1] + P[2:]) / 4; P = Q
    return P



# ====================================================================================== paint
class Paint:
    """road decals as quads: xz corners + (u metres along, v 0..1 across) + kind
    kinds: 0 white line, 1 yellow line, 2 crosswalk bar, 3 stop bar, 4.. cover decals (atlas cell = kind - 4)"""
    def __init__(self): self.P, self.UV, self.K = [], [], []

    def quad(self, a, b, c, d, u0, u1, kind, v0=0.0, v1=1.0):
        # a,b along the left edge (u0 -> u1), d,c along the right edge
        self.P += [a, b, c, a, c, d]
        self.UV += [(u0, v0), (u1, v0), (u1, v1), (u0, v0), (u1, v1), (u0, v1)]
        self.K += [kind] * 6

    def strip(self, F, s0, s1, o0, o1, kind, step=2.0):
        """band along a chain frame F (callable s -> (p, t, n)) between offsets o0..o1"""
        if s1 - s0 < 0.05: return
        n = max(1, int(math.ceil((s1 - s0) / step)))
        ss = np.linspace(s0, s1, n + 1)
        for k in range(n):
            pa, ta, na = F(ss[k]); pb, tb, nb = F(ss[k + 1])
            self.quad(pa + na * o0, pb + nb * o0, pb + nb * o1, pa + na * o1, ss[k], ss[k + 1], kind)


def frame_of(P, s):
    T = np.gradient(P, axis=0); T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    N = np.stack([-T[:, 1], T[:, 0]], 1)               # left of travel in xz (x right, z down the map)
    def F(q):
        q = float(np.clip(q, s[0], s[-1]))
        p = np.array([np.interp(q, s, P[:, 0]), np.interp(q, s, P[:, 1])])
        t = np.array([np.interp(q, s, T[:, 0]), np.interp(q, s, T[:, 1])]); t /= max(np.linalg.norm(t), 1e-9)
        return p, t, np.array([-t[1], t[0]])
    return F


def markings(C, S, chains, jpos, dt):
    """lane lines (one-way white dashes / two-way double yellow by width), high-visibility crosswalks and stop bars
    at real junctions; returns the paint quads + crosswalk records (junction, centre, direction, half width)"""
    t = time.time()
    road = S['road']
    paint = Paint()
    # junctions that are real intersections: >= 3 street arms at least 6 m wide
    arms = {}
    for ch in chains:
        W = 2 * float(np.median(ch['hw']))
        for j in (ch['ja'], ch['jb']):
            if j >= 0 and W >= 4.5: arms[j] = arms.get(j, 0) + 1
    xings, nlane = [], 0
    for ci, ch in enumerate(chains):
        P0, s0 = resample(smooth_line(ch['pts'], 6), 1.0)
        if len(P0) < 4: continue
        P = smooth_line(P0, 4)
        d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(ch['pts'], axis=0), axis=1))]
        hw = np.interp(s0 / max(s0[-1], 1e-6) * d[-1], d, ch['hw'])
        L = s0[-1]
        mid = hw[int(len(hw) * 0.25):max(int(len(hw) * 0.75), int(len(hw) * 0.25) + 1)]
        hwr = float(np.median(mid)); W = 2 * hwr
        if W < 4.5: continue
        F = frame_of(P, s0)
        cw = 3.6 if W >= 11 else 3.0
        ends = []
        for end, j in ((0, ch['ja']), (1, ch['jb'])):
            if j < 0 or arms.get(j, 0) < 3: ends.append(None); continue
            h = hw if end == 0 else hw[::-1]
            k0 = int(min(len(h) - 1, max(1, hwr * 0.6)))
            th = None
            cap = min(len(h) - 1, int(6 + 2.2 * hwr))
            for k in range(k0, cap + 1):
                if h[k] <= hwr + 0.35: th = float(k); break
            if th is None and len(h) > 2 * cap: th = float(cap)   # flared approach: crossing at the cap
            ends.append(th)
        used = sum(e + cw + 3 for e in ends if e is not None)
        if used > L - 2:                       # too short for both crossings: keep the one at the bigger junction
            if ends[0] is not None and ends[1] is not None:
                if arms.get(ch['ja'], 0) >= arms.get(ch['jb'], 0): ends[1] = None
                else: ends[0] = None
            if sum(e + cw + 3 for e in ends if e is not None) > L - 1: ends = [None, None]
        two_way = W >= 15.5
        rng = np.random.default_rng(ci * 7919 + 13)
        oneway_dir = 1 if rng.random() < 0.5 else -1      # travel along +s or -s
        lo, hi = 0.0, L
        for end, th in enumerate(ends):
            if th is None: continue
            j = ch['ja'] if end == 0 else ch['jb']
            # band [a, b] in chain s measured from this end
            a = th + 0.4; b = a + cw
            sa, sb = (a, b) if end == 0 else (L - b, L - a)
            sm = (sa + sb) / 2
            pm, tm, nm = F(sm)
            hwx = float(np.interp(sm, s0, hw))
            # bars (NYC high-visibility): 0.6 m bars along the street, 0.6 m gaps, kerb to kerb
            span = hwx - 0.35
            nb = int((2 * span + 0.6) // 1.2)
            if nb >= 2:
                off0 = -(nb * 1.2 - 0.6) / 2
                for k in range(nb):
                    o = off0 + k * 1.2
                    paint.strip(F, sa, sb, o, o + 0.6, 2, step=cw)
            # stop bar behind the crossing, approach lanes only
            into = -1 if end == 0 else 1           # travel direction (in s) that approaches this junction
            sbar = (sb + 1.5) if end == 0 else (sa - 1.5 - 0.45)
            if two_way:
                # approaching traffic keeps right: right of travel direction t*into is -n*into
                o0, o1 = (-span, -0.2) if into > 0 else (0.2, span)
                paint.strip(F, sbar, sbar + 0.45, o0, o1, 3, step=1)
            elif oneway_dir == into:
                paint.strip(F, sbar, sbar + 0.45, -span, span, 3, step=1)
            xings.append({'j': int(j), 'p': pm.tolist(), 't': (tm * (1 if end == 0 else -1)).tolist(), 'hw': hwx, 'cw': cw,
                          'chain': ci, 's': [float(sa), float(sb)], 'W': W})
            if end == 0: lo = sb + 3.5
            else: hi = sa - 3.5
        if hi - lo < 6: continue
        lo_d, hi_d = lo + 1.0 * (ends[0] is None), hi - 1.0 * (ends[1] is None)
        # lane lines
        if two_way:
            paint.strip(F, lo_d, hi_d, -0.17, -0.07, 1); paint.strip(F, lo_d, hi_d, 0.07, 0.17, 1)
            per = hwr - 2.5                      # travel width per direction (parking lane 2.5 m)
            n = int(round(per / 3.3))
            for side in (-1, 1):
                for k in range(1, n):
                    o = side * (0.1 + k * per / n)
                    for q in np.arange(lo_d + 1.5, hi_d - 3.0, 12.2):
                        paint.strip(F, q, q + 3.05, o - 0.06, o + 0.06, 0, step=3.05)
            nlane += 1
        elif W >= 8.5:
            travel = W - 5.0
            n = max(1, int(round(travel / 3.3)))
            for k in range(1, n):
                o = -hwr + 2.5 + k * travel / n
                for q in np.arange(lo_d + 1.5, hi_d - 3.0, 12.2):
                    paint.strip(F, q, q + 3.05, o - 0.06, o + 0.06, 0, step=3.05)
            nlane += 1
    log('markings: %d crossings, %d chains with lanes, %d paint verts %.1fs' % (len(xings), nlane, len(paint.P), time.time() - t))
    return paint, xings, arms



# ====================================================================================== curbs + lookup grid
def curbs(C, S):
    """slab edges along the asphalt -> oriented curb polylines (road on the right of a->b), plus the slab's other
    (shore) edges"""
    t = time.time()
    road_r = C.raster(S['asphalt'])
    asp = S['asphalt'].buffer(0.06)
    chains, shore = [], []
    def is_road(x, z):
        c = int((x - C.X0) / RC); r = int((z - C.Z0) / RC)
        return 0 <= c < C.GW and 0 <= r < C.GH and road_r[r, c] > 0
    for p in polygons(S['slab']):
        for ring in [p.exterior] + list(p.interiors):
            ls = LineString(ring.coords)
            g = ls.intersection(asp)
            g = linemerge(g) if g.geom_type == 'MultiLineString' else g
            for l in lines_of(g):
                l = l.simplify(0.03)
                if l.length < 0.4: continue
                q = np.asarray(l.coords)
                # orient: road on the right of travel (right of (dx,dz) is (-dz, dx))
                votes = 0
                for k in range(0, len(q) - 1, max(1, (len(q) - 1) // 6)):
                    a_, b_ = q[k], q[k + 1]; d = b_ - a_; L = np.linalg.norm(d)
                    if L < 1e-3: continue
                    d /= L; m = (a_ + b_) / 2; rgt = np.array([-d[1], d[0]])
                    votes += (1 if is_road(*(m + rgt * 0.7)) else 0) - (1 if is_road(*(m - rgt * 0.7)) else 0)
                if votes < 0: q = q[::-1]
                chains.append(q)
            g2 = ls.difference(asp)
            for l in lines_of(g2):
                if l.length > 0.3: shore.append(np.asarray(l.simplify(0.05).coords))
    nseg = sum(len(q) - 1 for q in chains)
    log('curbs: %d chains, %d segments, %.0f m; shore edges %d  %.1fs' % (len(chains), nseg, sum(LineString(q).length for q in chains), len(shore), time.time() - t))
    return chains, shore


def seg_grid(C, chains):
    """segments (ax, az, bx, bz | frame origin x, z, frame angle, chain hash) and a 4 m grid holding the GK nearest
    segment ids per cell. The paving frame of a segment is that of the nearest straight run (>= 2.5 m) of its chain,
    phase-continuous along the chain, so flags stay square to the curb and the rounded corners split on the bisector
    between the two streets' grids (like the real corner quadrants) instead of fanning out."""
    from scipy.spatial import cKDTree
    t = time.time()
    A, B, FR = [], [], []
    for ci, q in enumerate(chains):
        s = 0.0; h = ((ci * 2654435761) % 1000) / 1000.0
        segs = []
        for k in range(len(q) - 1):
            L = float(np.linalg.norm(q[k + 1] - q[k]))
            if L < 1e-4: continue
            segs.append((q[k], q[k + 1], s, L)); s += L
        longs = [i for i, sg in enumerate(segs) if sg[3] >= 2.5] or list(range(len(segs)))
        lmid = np.array([segs[i][2] + segs[i][3] / 2 for i in longs])
        for i, (a, b, s0, L) in enumerate(segs):
            j = longs[int(np.argmin(np.abs(lmid - (s0 + L / 2))))]
            la, lb, ls0, lL = segs[j]
            d = (lb - la) / lL
            o = la - d * ls0
            A.append(a); B.append(b); FR.append((o[0], o[1], math.atan2(d[1], d[0]), h))
    A, B = np.array(A), np.array(B); n = len(A)
    seg = np.zeros((n, 8), np.float32)
    seg[:, 0:2] = A; seg[:, 2:4] = B; seg[:, 4:8] = np.array(FR)
    # samples along segments for the neighbour search
    pts, ids = [], []
    for i in range(n):
        L = np.linalg.norm(B[i] - A[i]); m = max(2, int(L / 0.75) + 1)
        f = np.linspace(0, 1, m)[:, None]
        pts.append(A[i] + (B[i] - A[i]) * f); ids.append(np.full(m, i))
    pts = np.concatenate(pts); ids = np.concatenate(ids)
    tree = cKDTree(pts)
    gx = int(np.ceil((C.GW * RC) / GCELL)); gz = int(np.ceil((C.GH * RC) / GCELL))
    cx = C.X0 + (np.arange(gx) + 0.5) * GCELL; cz = C.Z0 + (np.arange(gz) + 0.5) * GCELL
    CX, CZ = np.meshgrid(cx, cz)
    Q = np.stack([CX.ravel(), CZ.ravel()], 1)
    dd, ii = tree.query(Q, k=64, distance_upper_bound=16.0)
    grid = np.full((len(Q), GK), -1, np.int32)
    for r in range(len(Q)):
        ok = np.isfinite(dd[r])
        if not ok.any(): continue
        cand = list(dict.fromkeys(ids[ii[r][ok]].tolist()))
        if len(cand) > GK:
            a_, b_ = A[cand], B[cand]; d = b_ - a_; p = Q[r]
            tt = np.clip(np.einsum('ij,ij->i', p - a_, d) / np.maximum(np.einsum('ij,ij->i', d, d), 1e-9), 0, 1)
            dist = np.linalg.norm(a_ + d * tt[:, None] - p, axis=1)
            cand = [cand[k] for k in np.argsort(dist)[:GK]]
        grid[r, :len(cand)] = cand
    log('segment grid: %d segs, %dx%d cells, %.1f%% filled  %.1fs' % (n, gx, gz, 100 * (grid[:, 0] >= 0).mean(), time.time() - t))
    return seg, grid.reshape(gz, gx, GK), (gx, gz), tree, ids, A, B


# ====================================================================================== meshes
def tri_poly(p):
    """constrained Delaunay triangles of a polygon (with holes) -> (n,3,2)"""
    out = []
    try:
        g = shapely.constrained_delaunay_triangles(p)
        for t in getattr(g, 'geoms', []):
            c = np.asarray(t.exterior.coords)[:3]
            if len(c) == 3: out.append(c)
    except Exception as e:
        log('triangulation failed', e)
    return out


def slab_mesh(S):
    t = time.time()
    side = S['slab'].difference(S['park']).difference(S['plaza']).buffer(0)
    T, K = [], []
    for kind, g in ((0, side), (1, S['plaza']), (2, S['park'])):
        for p in polygons(g):
            if p.area < 0.5: continue
            tr = tri_poly(p)
            T += tr; K += [kind] * len(tr)
    T = np.array(T, np.float64); K = np.array(K, np.uint8)
    # consistent winding: counter-clockwise seen from +y (x right, z down the map -> cross z component < 0)
    cr = (T[:, 1, 0] - T[:, 0, 0]) * (T[:, 2, 1] - T[:, 0, 1]) - (T[:, 1, 1] - T[:, 0, 1]) * (T[:, 2, 0] - T[:, 0, 0])
    flip = cr > 0
    T[flip] = T[flip][:, ::-1]
    log('slab mesh: %d triangles (%d sidewalk, %d plaza, %d park) %.1fs' % (len(T), (K == 0).sum(), (K == 1).sum(), (K == 2).sum(), time.time() - t))
    return T, K


def curb_faces(chains, shore):
    """vertical faces (road side) from the roadbed plane up to the slab: (n,3,3) xyz + per-vertex (u along, v up)"""
    P, U, F = [], [], []
    for q, flag in [(q, 0) for q in chains] + [(q, 1) for q in shore]:
        s = 0.0
        for k in range(len(q) - 1):
            a, b = q[k], q[k + 1]; L = float(np.linalg.norm(b - a))
            if L < 1e-4: continue
            if flag:   # shore edge: orientation unknown -> both sides
                pass
            A0 = (a[0], GROUND_Y - 0.01, a[1]); B0 = (b[0], GROUND_Y - 0.01, b[1]); A1 = (a[0], CURB_H, a[1]); B1 = (b[0], CURB_H, b[1])
            # front face looks to the right of a->b (the road): order so the normal points right
            P += [A0, A1, B1, A0, B1, B0]
            U += [(s, 0), (s, 1), (s + L, 1), (s, 0), (s + L, 1), (s + L, 0)]
            F += [flag] * 6
            if flag:
                P += [A0, B1, A1, A0, B0, B1]; U += [(s, 0), (s + L, 1), (s, 1), (s, 0), (s + L, 0), (s + L, 1)]; F += [flag] * 6
            s += L
    return np.array(P, np.float32), np.array(U, np.float32), np.array(F, np.uint8)


# ====================================================================================== prop meshes
def glb_read(path):
    f = open(path, 'rb'); f.read(12)
    l, _ = struct.unpack('<II', f.read(8)); j = json.loads(f.read(l))
    l2, _ = struct.unpack('<II', f.read(8)); B = f.read(l2)
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(B, dt, a['count'] * nc, o).reshape(a['count'], nc) if nc > 1 else np.frombuffer(B, dt, a['count'], o)
    def image(i):
        bv = j['bufferViews'][j['images'][i]['bufferView']]
        return Image.open(io.BytesIO(B[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]))
    return j, acc, image


def glb_props():
    """bench + bike rack out of the city pack's merged 'Street_Assets' mesh (glTF, y up) -> {name: (tris, uvs)}, texture"""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    j, acc, image = glb_read(GLB)
    mname = lambda p_: j['materials'][p_.get('material', 0)].get('name')
    mi = max((i for i, m in enumerate(j['meshes']) if any(mname(p_) == 'Street_Assets' for p_ in m['primitives'])),
             key=lambda i: sum(j['accessors'][p_['indices']]['count'] for p_ in j['meshes'][i]['primitives']))
    pr = j['meshes'][mi]['primitives'][0]
    P = acc(pr['attributes']['POSITION']).astype(np.float64); UV = acc(pr['attributes']['TEXCOORD_0']).astype(np.float64)
    I = acc(pr['indices']).astype(np.int64).reshape(-1, 3)
    _, wid = np.unique(np.round(P, 4), axis=0, return_inverse=True); wid = wid.ravel()
    W = wid[I]; n = wid.max() + 1
    g = coo_matrix((np.ones(len(W) * 2), (np.r_[W[:, 0], W[:, 1]], np.r_[W[:, 1], W[:, 2]])), shape=(n, n))
    nc, lab = connected_components(g, directed=False)
    tl = lab[W[:, 0]]
    T = P[I]
    mn = np.full((nc, 3), 1e9); mx = np.full((nc, 3), -1e9)
    np.minimum.at(mn, tl, T.min(1)); np.maximum.at(mx, tl, T.max(1))
    par = np.arange(nc)
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    order = np.argsort(mn[:, 0])
    for ai in range(nc):
        ia = order[ai]
        for bi in range(ai + 1, nc):
            ib = order[bi]
            if mn[ib, 0] > mx[ia, 0] + 0.03: break
            if (mn[ib] <= mx[ia] + 0.03).all() and (mx[ib] >= mn[ia] - 0.03).all():
                ra, rb = f(ia), f(ib)
                if ra != rb: par[ra] = rb
    root = np.array([f(i) for i in range(nc)])
    tri_root = root[tl]
    out = {}
    want = {'bench': (2.0, 0.9, 0.7, 164), 'rack': (1.5, 0.9, 0.1, 44)}
    for name, (dx, dy, dz, nt) in want.items():
        for r in np.unique(root):
            sel = tri_root == r
            if abs(int(sel.sum()) - nt) > 2: continue
            Tm = T[sel]; d = Tm.reshape(-1, 3).max(0) - Tm.reshape(-1, 3).min(0)
            if abs(d[0] - dx) < 0.08 and abs(d[1] - dy) < 0.08 and abs(d[2] - dz) < 0.08:
                out[name] = (Tm, UV[I[sel]]); break
    ti = next(m for m in j['materials'] if m.get('name') == 'Street_Assets')['pbrMetallicRoughness']['baseColorTexture']['index']
    log('glb props:', {k: len(v[0]) for k, v in out.items()})
    return out, image(j['textures'][ti]['source'])


# per prop: scale (set units -> m: the street set is modelled at about half size), arm (rotate the arm to +x),
# emissive rule, pole collider radius
PROP_DEF = {
    'light_a': (2.0, True, 'lamp', 0.11),
    'light_b': (2.0, True, 'lamp', 0.11),
    'signal':  (2.0, True, 'signal', 0.13),
    'lantern': (3.6, False, 'lantern', 0.12),
    'sign':    (2.0, False, None, 0),
    'meter':   (2.1, False, None, 0),
    'mailbox': (3.0, False, None, 0),
    'trash_a': (2.4, False, None, 0),
    'trash_b': (2.4, False, None, 0),
    'hydrant': (2.5, False, None, 0),
    'bollard': (3.8, False, None, 0),
    'bench':   (1.0, False, None, 0),
    'rack':    (1.0, False, None, 0),
}


def prop_meshes(kit_tex):
    """kit (Blender export, z up) + glb props -> per prop arrays in a y-up local frame: base centre at the origin,
    arms along +x (towards the road), long axis of benches / racks along z"""
    K = np.load(os.path.join(OUT, 'streets_kit.npz'))
    mats = list(K['mats'])
    tex = np.asarray(kit_tex.convert('RGB')).astype(np.float32) / 255
    TH, TW = tex.shape[:2]
    gp, gimg = glb_props()
    props = {}
    for name, (sc, arm, emit, _) in PROP_DEF.items():
        if name in ('bench', 'rack'):
            if name not in gp: continue
            Tm, UVm = gp[name]
            V = Tm.copy()
            UVm = UVm.copy(); UVm[..., 1] = 1 - UVm[..., 1]          # glTF uv origin top-left -> GL bottom-left
            dark = np.zeros(len(V), bool); src = 1
        else:
            if name + '_pos' not in K.files: continue
            Pz = K[name + '_pos'].astype(np.float64)
            V = np.stack([Pz[..., 0], Pz[..., 2], -Pz[..., 1]], -1)
            UVm = K[name + '_uv'].astype(np.float64)
            dark = np.array([mats[m] != 'M0_0_0_37' for m in K[name + '_mat']]); src = 0
        V = V * sc
        flat = V.reshape(-1, 3)
        y0 = flat[:, 1].min(); H = flat[:, 1].max() - y0
        if arm:
            low = flat[flat[:, 1] < y0 + 0.4]
            base = low[:, [0, 2]].mean(0)
            top = flat[flat[:, 1] > y0 + 0.88 * H][:, [0, 2]].mean(0) - base
            ang = math.atan2(top[1], top[0])
        else:
            base = (flat[:, [0, 2]].min(0) + flat[:, [0, 2]].max(0)) / 2
            ext = flat[:, [0, 2]].max(0) - flat[:, [0, 2]].min(0)
            ang = 0.0 if ext[1] >= ext[0] else math.pi / 2
        c, s_ = math.cos(ang), math.sin(ang)
        X = flat[:, 0] - base[0]; Z = flat[:, 2] - base[1]
        # rotate by -ang in the xz plane: (cos, sin) of the arm -> (1, 0)
        flat = np.stack([X * c + Z * s_, flat[:, 1] - y0, -X * s_ + Z * c], 1)
        if name == 'bench':
            hi = flat[flat[:, 1] > 0.75 * flat[:, 1].max()]
            if hi[:, 0].mean() < 0: flat[:, 0] *= -1; flat[:, 2] *= -1
        V = flat.reshape(-1, 3, 3)
        e = np.zeros(len(V), np.float32)
        nrm = np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0]); nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        cy = V[:, :, 1].mean(1); H = float(V[..., 1].max())
        lum = sat = np.zeros(len(V))
        if src == 0:
            uvc = UVm.mean(1)
            px = tex[np.clip(((1 - (uvc[:, 1] % 1)) * TH).astype(int), 0, TH - 1), np.clip(((uvc[:, 0] % 1) * TW).astype(int), 0, TW - 1)]
            lum = px.mean(1); sat = px.max(1) - px.min(1)
        if emit in ('lamp', 'signal'):
            cx = V[:, :, 0].mean(1)
            e[(cy > 0.88 * H) & (nrm[:, 1] < -0.5) & (cx > 0.7 * V[..., 0].max())] = 1.0
        if emit == 'lantern':
            e[(cy > 0.72 * H) & (lum > 0.45)] = 1.0
        if emit == 'signal':
            lens = ((px[:, 0] > 0.55) & (px[:, 1] < 0.35)) | ((px[:, 1] > 0.45) & (px[:, 0] < 0.35))
            e[(cy < 0.8 * H) & (cy > 1.5) & lens & (e == 0)] = 0.7
        props[name] = {'V': V.astype(np.float32), 'UV': UVm.astype(np.float32), 'dark': dark, 'e': e, 'src': src, 'H': H}
        log('prop %-8s %4d tris  h %.2f m  arm %.2f m  emissive %d' % (name, len(V), H, float(V[..., 0].max()), int((e > 0).sum())))
    return props, gimg


# ====================================================================================== placement
class Placer:
    """street furniture along the real curbs / corners / park and plaza edges, NYC-ish spacing"""
    def __init__(self, C, S, curb_chains, xings, trees, seg_tree, seg_ids, SA, SB):
        self.C = C
        cl = np.zeros((C.GH, C.GW), np.uint8)
        cl[C.raster(S['slab']) > 0] = 1
        cl[C.raster(S['plaza']) > 0] = 2
        cl[C.raster(S['park']) > 0] = 3
        self.cl = cl
        self.bld = C.ids > 0
        self.inst = {k: [] for k in PROP_DEF}
        self.cells = {}
        self.noprop = np.zeros_like(cl)
        for x in xings:
            p, t = np.array(x['p']), np.array(x['t']); n = np.array([-t[1], t[0]])
            a = x['cw'] / 2 + 0.6; b = x['hw'] + 3.2
            q = np.array([p + t * a + n * b, p - t * a + n * b, p - t * a - n * b, p + t * a - n * b])
            cv2.fillPoly(self.noprop, [np.round((q - [C.X0, C.Z0]) / RC * 8 - 4).astype(np.int32)], 1, shift=3)
        from scipy.spatial import cKDTree
        self.trees = cKDTree(np.array(trees)) if len(trees) else None
        self.chains, self.xings = curb_chains, xings
        self.seg_tree, self.seg_ids, self.SA, self.SB = seg_tree, seg_ids, SA, SB

    def cls(self, x, z):
        c = int((x - self.C.X0) / RC); r = int((z - self.C.Z0) / RC)
        if not (0 <= c < self.C.GW and 0 <= r < self.C.GH): return 0
        return 0 if self.bld[r, c] else int(self.cl[r, c])

    def free(self, x, z, r):
        c = int((x - self.C.X0) / RC); rr = int((z - self.C.Z0) / RC)
        if not (0 <= c < self.C.GW and 0 <= rr < self.C.GH): return False
        if self.noprop[rr, c]: return False
        if self.trees is not None and self.trees.query_ball_point([x, z], 1.3): return False
        k = (int(x // 8), int(z // 8))
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for (px, pz, pr) in self.cells.get((k[0] + i, k[1] + j), ()):
                    if (px - x) ** 2 + (pz - z) ** 2 < (max(pr, r)) ** 2: return False
        return True

    def depth(self, p, n, maxd=14.0):
        """free sidewalk depth from the curb point p along n (to a building / the road / off the slab)"""
        d = 0.3
        while d < maxd:
            q = p + n * d
            if self.cls(*q) == 0: return d
            d += 0.4
        return maxd

    def add(self, kind, x, z, yaw, r, y=CURB_H):
        self.inst[kind].append((float(x), float(y), float(z), float(yaw)))
        k = (int(x // 8), int(z // 8)); self.cells.setdefault(k, []).append((x, z, r))

    @staticmethod
    def yaw_to(w):           # local +x -> world direction w (three.js rotation.y)
        return math.atan2(-w[1], w[0])

    def walk(self, q, spacing, start):
        """points along a curb chain every `spacing` m: (point, unit dir, inward normal (sidewalk side))"""
        d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(q, axis=0), axis=1))]
        s = start
        while s < d[-1] - 1:
            k = min(np.searchsorted(d, s, 'right') - 1, len(q) - 2)
            f = (s - d[k]) / max(d[k + 1] - d[k], 1e-9)
            p = q[k] + (q[k + 1] - q[k]) * f
            t = (q[k + 1] - q[k]) / max(d[k + 1] - d[k], 1e-9)
            yield p, t, np.array([t[1], -t[0]]), s
            s += spacing

    def run(self, props):
        rng = np.random.default_rng(77)
        X = self.xings
        # 1. signal poles: right-hand corner of every approach at real intersections
        nsig = 0
        for x in X:
            if x['W'] < 5.0: continue
            p, t = np.array(x['p']), np.array(x['t'])
            right = np.array([t[1], -t[0]])             # right of the approaching traffic (travelling along -t)
            for dt_ in (0.0, -0.8, 0.8, -1.6, 1.6):
                q = p + right * (x['hw'] + 0.75) - t * (x['cw'] / 2 + 0.7 + dt_)
                if self.cls(*q) in (1, 2) and self.cls(*(q + right * 0.6)) in (1, 2) and (self.trees is None or not self.trees.query_ball_point(q, 1.2)):
                    self.add('signal', q[0], q[1], self.yaw_to(-right), 2.0); nsig += 1; break
            # opposite corner: litter basket / mailbox
            left = -right
            q = p + left * (x['hw'] + 0.9) - t * (x['cw'] / 2 + 1.4)
            if rng.random() < 0.6 and self.cls(*q) in (1, 2) and self.free(q[0], q[1], 1.0):
                self.add(rng.choice(['trash_a', 'trash_b'], p=[0.7, 0.3]), q[0], q[1], rng.uniform(0, 6.28), 1.0)
            q2 = q - t * 1.4
            if rng.random() < 0.14 and self.cls(*q2) in (1, 2) and self.free(q2[0], q2[1], 1.0):
                self.add('mailbox', q2[0], q2[1], self.yaw_to(left), 1.0)
        # 2. curb-side furniture
        for ci, q in enumerate(self.chains):
            L = float(np.sum(np.linalg.norm(np.diff(q, axis=0), axis=1)))
            if L < 12: continue
            cr = np.random.default_rng(ci + 1)
            sp = cr.uniform(29, 36)
            lt = 'light_a' if cr.random() < 0.6 else 'light_b'
            for p, t, n, s in self.walk(q, sp, cr.uniform(4, sp)):
                for jit in (0.0, 2.0, -2.0, 4.0):
                    pp = p + t * jit; c = pp + n * 0.55
                    if self.cls(*c) in (1, 2) and self.depth(pp, n) >= 1.9 and self.free(c[0], c[1], 13.0):
                        self.add(lt, c[0], c[1], self.yaw_to(-n), 13.0); break
            for p, t, n, s in self.walk(q, cr.uniform(65, 95), cr.uniform(6, 14)):
                c = p + n * 0.6
                if self.cls(*c) in (1, 2) and self.depth(p, n) >= 1.6 and self.free(c[0], c[1], 2.0):
                    self.add('hydrant', c[0], c[1], cr.uniform(0, 6.28), 2.0)
            for p, t, n, s in self.walk(q, cr.uniform(20, 28), cr.uniform(8, 16)):
                c = p + n * 0.42
                if self.cls(*c) in (1, 2) and self.depth(p, n) >= 1.6 and self.free(c[0], c[1], 1.5):
                    self.add('sign', c[0], c[1], self.yaw_to(-n), 1.5)
            if cr.random() < 0.45:
                for p, t, n, s in self.walk(q, 7.0, cr.uniform(10, 20)):
                    if s > 60: break
                    c = p + n * 0.5
                    if self.cls(*c) in (1, 2) and self.depth(p, n) >= 2.2 and self.free(c[0], c[1], 1.2):
                        self.add('meter', c[0], c[1], self.yaw_to(n), 1.2)
            for p, t, n, s in self.walk(q, cr.uniform(55, 80), cr.uniform(15, 40)):
                c = p + n * 1.15
                if self.cls(*c) in (1, 2) and self.depth(p, n) >= 4.5 and self.free(c[0], c[1], 1.6):
                    self.add('rack', c[0], c[1], self.yaw_to(-n), 1.6)
            for p, t, n, s in self.walk(q, cr.uniform(70, 110), cr.uniform(20, 50)):
                c = p + n * 1.5
                if self.cls(*c) in (1, 2) and self.depth(p, n) >= 6.0 and self.free(c[0], c[1], 2.0):
                    self.add('bench', c[0], c[1], self.yaw_to(-n), 2.0)
            # plazas meeting the curb: security bollards (Financial District)
            mid = q[len(q) // 2]; tt = q[min(len(q) - 1, len(q) // 2 + 1)] - q[max(0, len(q) // 2 - 1)]
            nn = np.array([tt[1], -tt[0]]) / max(np.linalg.norm(tt), 1e-9)
            if self.cls(*(mid + nn * 1.0)) == 2:
                for p, t, n, s in self.walk(q, 1.7, 1.0):
                    c = p + n * 0.6
                    if self.cls(*c) == 2 and self.free(c[0], c[1], 0.5):
                        self.add('bollard', c[0], c[1], 0.0, 0.5)
        return self

    def edges(self, S):
        """lanterns + benches just inside park and plaza edges"""
        rng = np.random.default_rng(5)
        for kind, g, lsp, bsp in (('park', S['park'], 24.0, 17.0), ('plaza', S['plaza'], 19.0, 23.0)):
            for poly in polygons(g):
                if poly.area < 150: continue
                inner = poly.buffer(-1.7)
                for ip in polygons(inner):
                    q = np.asarray(ip.exterior.coords)
                    L = float(np.sum(np.linalg.norm(np.diff(q, axis=0), axis=1)))
                    if L < 20: continue
                    ccw = ip.exterior.is_ccw
                    for p, t, n, s in self.walk(q, lsp, rng.uniform(3, lsp)):
                        inward = n if not ccw else -n
                        if self.cls(*p) in (2, 3) and self.free(p[0], p[1], 6.0):
                            self.add('lantern', p[0], p[1], 0.0, 6.0)
                    for p, t, n, s in self.walk(q, bsp, rng.uniform(6, 12)):
                        inward = n if not ccw else -n
                        if not ip.contains(Point(*(p + inward * 1.0))): inward = -inward
                        if self.cls(*p) in (2, 3) and self.free(p[0], p[1], 2.2):
                            self.add('bench', p[0], p[1], self.yaw_to(-inward), 2.2)
        return self


def light_pools(C, inst, props):
    """1 m raster of street-light pools on the ground (night lighting in the street shaders)"""
    W, H = int(np.ceil(C.GW * RC)), int(np.ceil(C.GH * RC))
    P = np.zeros((H, W), np.float32)
    def splat(x, z, sig, amp):
        r = int(sig * 2.6); cx, cz = int(x - C.X0), int(z - C.Z0)
        x0, x1, z0, z1 = max(0, cx - r), min(W, cx + r + 1), max(0, cz - r), min(H, cz + r + 1)
        if x0 >= x1 or z0 >= z1: return
        gx = np.arange(x0, x1) + 0.5 + C.X0 - x; gz = np.arange(z0, z1) + 0.5 + C.Z0 - z
        P[z0:z1, x0:x1] += amp * np.exp(-(gz[:, None] ** 2 + gx[None, :] ** 2) / (2 * sig * sig))
    for kind, sig, amp in (('light_a', 7.0, 1.0), ('light_b', 7.0, 1.0), ('signal', 7.5, 1.0), ('lantern', 5.0, 0.95)):
        if kind not in props: continue
        arm = float(props[kind]['V'][..., 0].max()) * (0.85 if kind != 'lantern' else 0)
        for (x, y, z, yaw) in inst[kind]:
            hx, hz = x + math.cos(yaw) * arm, z - math.sin(yaw) * arm
            splat(hx, hz, sig, amp)
    return np.clip(P / 1.6 * 255, 0, 255).astype(np.uint8)


def decal_extras(chains, jpos, xings, trees_on_walk, seg_tree, seg_ids, SA, SB):
    """manholes along the street centres and in junctions, storm drain grates in the gutters before crossings,
    tree pits on the sidewalks -> Paint objects (road level, slab level)"""
    rng = np.random.default_rng(31)
    road, walk = Paint(), Paint()
    def cover(paint, p, t, w, l, kind, rot=0.0):
        n = np.array([-t[1], t[0]])
        a = p - t * l / 2 - n * w / 2; b = p + t * l / 2 - n * w / 2; c = p + t * l / 2 + n * w / 2; d = p - t * l / 2 + n * w / 2
        paint.quad(a, b, c, d, 0, 1, kind)
    for ch in chains:
        P0, s0 = resample(smooth_line(ch['pts'], 6), 1.0)
        if len(P0) < 10: continue
        F = frame_of(smooth_line(P0, 4), s0)
        L = s0[-1]; hw = float(np.median(ch['hw']))
        if hw < 2.6: continue
        s = rng.uniform(12, 30)
        while s < L - 10:
            p, t, n = F(s)
            off = rng.uniform(-0.35, 0.35) * hw
            ang = rng.uniform(0, 6.28); tt = np.array([math.cos(ang), math.sin(ang)])
            cover(road, p + n * off, tt, 0.8, 0.8, 4 if rng.random() < 0.6 else 6)
            if rng.random() < 0.25:
                cover(road, p + n * (-off * 0.5) + t * rng.uniform(2, 5), t, 0.75, 1.25, 7)
            s += rng.uniform(30, 60)
    for k, (x, z) in jpos.items():
        if rng.random() < 0.7:
            ang = rng.uniform(0, 6.28)
            cover(road, np.array([x, z]) + rng.uniform(-2, 2, 2), np.array([math.cos(ang), math.sin(ang)]), 0.8, 0.8, 4 if rng.random() < 0.5 else 6)
    for x in xings:
        if rng.random() < 0.55: continue
        p, t = np.array(x['p']), np.array(x['t']); right = np.array([t[1], -t[0]])
        q = p + right * (x['hw'] - 0.42) + t * (x['cw'] / 2 + rng.uniform(1.5, 4))
        cover(road, q, t, 0.5, 1.0, 5)
    for (x, z) in trees_on_walk:
        d, i = seg_tree.query([x, z])
        sg = seg_ids[i]; t = SB[sg] - SA[sg]; t = t / max(np.linalg.norm(t), 1e-9)
        cover(walk, np.array([x, z]), t, 1.25, 2.2, 8)
    return road, walk


# ====================================================================================== textures
def tileable(img):
    """seamless tile: blend with the half-rolled copy, weight 0 at the edges"""
    h, w = img.shape[:2]
    R = np.roll(img, (h // 2, w // 2), (0, 1))
    wy = 1 - np.abs(np.linspace(-1, 1, h)); wx = 1 - np.abs(np.linspace(-1, 1, w))
    W_ = np.clip(np.minimum(wy[:, None], wx[None, :]) * 3.0, 0, 1)
    W_ = W_[..., None] if img.ndim == 3 else W_
    return img * W_ + R * (1 - W_)


def rsz(arr, size, flt=Image.LANCZOS):
    """resize float HxWxC without PIL's alpha premultiplication (RGBA resize blackens rgb under alpha 0)"""
    ch = [np.asarray(Image.fromarray((np.clip(arr[..., k], 0, 1) * 255).astype(np.uint8), 'L').resize(size, flt)).astype(np.float32) / 255
          for k in range(arr.shape[2])]
    return np.dstack(ch)


def wrap_noise(shape, sig, rng):
    n = rng.normal(0, 1, shape)
    n = nd.gaussian_filter(n, sig, mode='wrap')
    return n / max(n.std(), 1e-9)


def textures():
    """detail textures from the street set (+ the city pack's grass), written into extra/"""
    t = time.time()
    M = os.path.join(OUT, 'streets_src', 'model')
    kit = lambda n: np.asarray(Image.open(os.path.join(M, 'M0_0_0_%s.png' % n)).convert('RGBA')).astype(np.float32) / 255
    rng = np.random.default_rng(3)
    out = {}
    # asphalt: the set's wet street (M0_0_0_44, a 5.6 m strip) without its painted edge line, made seamless,
    # neutralised to NYC grey, + 1024 px aggregate grain. alpha = the set's wet-patch mask (puddles when it rains)
    a = kit('44')
    def clean(x):
        """inpaint the set's paint splats / deepest wet holes so they don't repeat on every tile"""
        u8 = (np.clip(x, 0, 1) * 255).astype(np.uint8)
        lum = x[..., :3].mean(2)
        hole = ((lum < np.percentile(lum, 4)) | (x[..., 3] < 0.01) | (lum < 0.06)).astype(np.uint8)
        hole = cv2.dilate(hole, np.ones((5, 5), np.uint8))
        rgb_ = cv2.inpaint(np.ascontiguousarray(u8[..., :3]), hole, 6, cv2.INPAINT_TELEA)
        al_ = cv2.inpaint(np.ascontiguousarray(u8[..., 3]), hole, 6, cv2.INPAINT_TELEA)
        return np.dstack([rgb_, al_]).astype(np.float32) / 255
    A1, A2 = clean(a[52:252]), clean(a[308:508])
    w8 = np.linspace(0, 1, 24)[:, None, None]
    patch = np.concatenate([A1[:-24], A1[-24:] * (1 - w8) + A2[:24] * w8, A2[24:]], 0)
    patch = rsz(patch, (512, 512))
    patch = tileable(patch)
    rgb = patch[..., :3]; lum = rgb.mean(2, keepdims=True)
    rgb = lum + (rgb - lum) * 0.28
    low = nd.gaussian_filter(rgb, (22, 22, 0), mode='wrap')
    rgb = rgb - 0.6 * (low - low.mean((0, 1)))                # tame the big wet blotches: they repeat every tile
    rgb = (rgb - rgb.mean()) * 0.85 + 0.30
    big = np.asarray(Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS)).astype(np.float32) / 255
    g1 = wrap_noise((1024, 1024), 0.6, rng); g2 = wrap_noise((1024, 1024), 1.6, rng)
    stones = (wrap_noise((1024, 1024), 0.9, rng) > 1.6).astype(np.float32) * 0.07
    big = big * (1 + 0.10 * g1[..., None] + 0.06 * g2[..., None]) + stones[..., None]
    wet = np.asarray(Image.fromarray((patch[..., 3] * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS)).astype(np.float32) / 255
    wet = nd.gaussian_filter(wet, 3, mode='wrap')
    out['streets_asphalt.webp'] = np.dstack([np.clip(big, 0, 1), np.clip(wet * 1.4, 0, 1)])
    # sidewalk flags: the set's cracked 2x2 flag tile (M0_0_0_45), joints moved onto the tile grid, x4 + grain;
    # alpha = its grime / crack mask
    f = kit('45')
    f = np.roll(f, (-32, -36), (0, 1))
    fl = f[..., :3].mean(2)
    hole = ((fl < np.percentile(fl, 3)) | (f[..., 3] < 0.01) | (fl < 0.12)).astype(np.uint8)
    hole = cv2.dilate(hole, np.ones((3, 3), np.uint8))
    f8 = (f * 255).astype(np.uint8)
    f = np.dstack([cv2.inpaint(np.ascontiguousarray(f8[..., :3]), hole, 3, cv2.INPAINT_TELEA), f8[..., 3]]).astype(np.float32) / 255
    up = rsz(f, (512, 512))
    rgb = up[..., :3]; lum = rgb.mean(2, keepdims=True)
    rgb = lum + (rgb - lum) * 0.45
    rgb = rgb * (0.66 / max(float(rgb.mean()), 1e-3))
    rgb *= (1 + 0.035 * wrap_noise((512, 512), 0.7, rng)[..., None] + 0.03 * wrap_noise((512, 512), 2.5, rng)[..., None])
    out['streets_flags.webp'] = np.dstack([np.clip(rgb, 0, 1), up[..., 3] / max(float(up[..., 3].max()), 1e-3)])
    # grime clouds (M0_0_0_47)
    gr = kit('47')[..., :3].mean(2)
    gr = (gr - gr.min()) / max(float(gr.max() - gr.min()), 1e-3)
    gr = np.asarray(Image.fromarray((gr * 255).astype(np.uint8)).resize((256, 256), Image.BICUBIC)).astype(np.float32) / 255
    out['streets_grime.webp'] = np.dstack([gr, nd.gaussian_filter(gr, 6, mode='wrap'), (wrap_noise((256, 256), 4, rng) * 0.25 + 0.5)])
    # paint: wear along the set's worn crosswalk bar (M0_0_0_46), 256 x 32
    m = kit('46')
    bar = m[11:19, 72:127, :3].mean(2)
    bar = (bar - bar.min()) / max(float(bar.max() - bar.min()), 1e-3)
    wear = np.asarray(Image.fromarray((bar * 255).astype(np.uint8)).resize((256, 32), Image.BICUBIC)).astype(np.float32) / 255
    wear = tileable(wear) * (1 + 0.15 * wrap_noise((32, 256), 0.8, rng))
    out['streets_wear.webp'] = np.dstack([np.clip(wear, 0, 1)] * 3)
    # covers atlas (2x2 of 256): set manhole (M0_0_0_46), grate, cast-iron and steel covers / plate (city pack)
    _, _, image = glb_read(GLB)
    j, _, _ = glb_read(GLB)
    ti = next(mm for mm in j['materials'] if mm.get('name') == 'Street_Assets.001')['pbrMetallicRoughness']['baseColorTexture']['index']
    sa = np.asarray(image(j['textures'][ti]['source']).convert('RGB')).astype(np.float32) / 255
    def cell(img, box_, circle):
        c = np.asarray(Image.fromarray((np.clip(img[box_[1]:box_[3], box_[0]:box_[2]], 0, 1) * 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS)).astype(np.float32) / 255
        c = np.asarray(Image.fromarray((c * 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(2, 80, 2))).astype(np.float32) / 255
        yy, xx = np.mgrid[0:256, 0:256] / 255.0 - 0.5
        al = np.clip((0.485 - np.hypot(xx, yy)) * 120, 0, 1) if circle else np.ones((256, 256))
        return np.dstack([c, al])
    atlas = np.zeros((512, 512, 4), np.float32)
    atlas[0:256, 0:256] = cell(m[..., :3], (16, 13, 64, 61), True)
    atlas[0:256, 256:512] = cell(sa, (2, 384, 62, 446), False)
    atlas[256:512, 0:256] = cell(sa, (129, 384, 191, 446), True)
    atlas[256:512, 256:512] = cell(sa, (64, 448, 128, 512), False)
    out['streets_covers.webp'] = atlas
    # grass (city pack), props: the set's sign / prop sheet + the city pack's street-asset sheet
    ji = next(mm for mm in j['materials'] if mm.get('name') == 'CityGen_Grass')['pbrMetallicRoughness']['baseColorTexture']['index']
    out['streets_grass.webp'] = np.asarray(image(j['textures'][ji]['source']).convert('RGB').resize((1024, 1024), Image.LANCZOS)).astype(np.float32) / 255
    out['streets_kit.webp'] = kit('37')[..., :3]
    for name, arr in out.items():
        arr8 = (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
        if arr8.shape[2] == 4 and name != 'streets_covers.webp': arr8[..., 3] = np.maximum(arr8[..., 3], 3)   # webp drops rgb under alpha 0
        im = Image.fromarray(arr8, 'RGBA' if arr8.shape[2] == 4 else 'RGB')
        im.save(os.path.join(EXTRA, name), 'WEBP', quality=88, method=6, exact=True)
    log('textures %s  %.1fs' % (', '.join('%s %dx%d' % (k, v.shape[1], v.shape[0]) for k, v in out.items()), time.time() - t))


# ====================================================================================== pack
class Pack:
    def __init__(self): self.parts, self.off, self.meta = [], 0, {}
    def add(self, name, arr):
        b = np.ascontiguousarray(arr).tobytes()
        self.meta[name] = {'o': self.off, 'n': int(arr.size), 't': str(arr.dtype)}
        self.parts.append(b); self.off += len(b)
        pad = (-self.off) % 4
        if pad: self.parts.append(b'\0' * pad); self.off += pad


def main():
    t0 = time.time()
    os.makedirs(EXTRA, exist_ok=True)
    src = os.path.join(OUT, 'streets_src')
    if not os.path.exists(os.path.join(src, 'model.dae')):
        zipfile.ZipFile(KIT_ZIP).extractall(src)
    kit = os.path.join(OUT, 'streets_kit.npz')
    if not os.path.exists(kit) or os.path.getmtime(kit) < os.path.getmtime(os.path.join(ROOT, 'tools', 'scan', 'streets_kit.py')):
        log('blender: extracting the street set props')
        subprocess.run([BLENDER, '-b', '--python', os.path.join(ROOT, 'tools', 'scan', 'streets_kit.py'), '--', os.path.join(src, 'model.dae'), kit],
                       check=True, stdout=subprocess.DEVNULL)
    C = Ctx()
    S = thin_paths(C, surfaces(C))
    chains, jpos, dt = skeleton(C, S)
    paint, xings, arms = markings(C, S, chains, jpos, dt)
    cb, shore = curbs(C, S)
    seg, grid, gdim, seg_tree, seg_ids, SA, SB = seg_grid(C, cb)
    T, K = slab_mesh(S)
    cP, cU, cF = curb_faces(cb, shore)
    props, gimg = prop_meshes(Image.open(os.path.join(src, 'model', 'M0_0_0_37.png')))
    tl = json.load(open(os.path.join(EXTRA, 'trees_layout.json'))) if os.path.exists(os.path.join(EXTRA, 'trees_layout.json')) else {'trees': []}
    trees = [(t_[0], t_[1]) for t_ in tl['trees']]
    pl = Placer(C, S, cb, xings, trees, seg_tree, seg_ids, SA, SB).run(props).edges(S)
    log('props:', {k: len(v) for k, v in pl.inst.items()})
    walk_trees = [p for p in trees if pl.cls(*p) == 1]
    road_dec, walk_dec = decal_extras(chains, jpos, xings, walk_trees, seg_tree, seg_ids, SA, SB)
    pools = light_pools(C, pl.inst, props)
    raised = C.raster(S['slab'])
    raised[C.ids > 0] = 1                        # under buildings: never reached on foot, keep the raster simple
    textures()
    gimg.convert('RGB').resize((512, 512), Image.LANCZOS).save(os.path.join(EXTRA, 'streets_assets.webp'), 'WEBP', quality=88)

    pk = Pack()
    pk.add('slab_xz', T[:, :, :].astype(np.float32).reshape(-1))
    pk.add('slab_k', np.repeat(K, 3).astype(np.uint8))
    pk.add('curb_p', cP.reshape(-1)); pk.add('curb_uv', cU.reshape(-1)); pk.add('curb_f', cF)
    for nm, P_ in (('paint', paint), ('roaddec', road_dec), ('walkdec', walk_dec)):
        if not P_.P: P_.quad(np.zeros(2), np.zeros(2), np.zeros(2), np.zeros(2), 0, 0, 0)
        pk.add(nm + '_xz', np.array(P_.P, np.float32).reshape(-1))
        pk.add(nm + '_uv', np.array(P_.UV, np.float32).reshape(-1))
        pk.add(nm + '_k', np.array(P_.K, np.uint8))
    pk.add('seg', seg.reshape(-1))
    pk.add('grid', grid.astype(np.int16).reshape(-1))
    pk.add('raised', np.packbits(raised.reshape(-1) > 0, bitorder='little'))
    pk.add('pools', pools.reshape(-1))
    ptypes = {}
    for name, pr in props.items():
        pk.add('p_' + name + '_v', pr['V'].reshape(-1))
        pk.add('p_' + name + '_uv', pr['UV'].reshape(-1))
        pk.add('p_' + name + '_d', pr['dark'].astype(np.uint8))
        pk.add('p_' + name + '_e', (pr['e'] * 255).astype(np.uint8))
        sc, arm, emit, col = PROP_DEF[name]
        ptypes[name] = {'h': round(pr['H'], 2), 'arm': round(float(pr['V'][..., 0].max()), 2), 'tex': 'streets_assets.webp' if pr['src'] else 'streets_kit.webp',
                        'col': col, 'emit': emit or '', 'tris': int(len(pr['V'])), 'inst': [[round(v, 3) for v in r] for r in pl.inst.get(name, [])]}
    blob = b''.join(pk.parts)
    with gzip.open(os.path.join(EXTRA, 'streets_data.bin.gz'), 'wb', compresslevel=9) as f: f.write(blob)
    meta = {'v': 1, 'frame': {'x0': C.X0, 'z0': C.Z0, 'rc': RC, 'w': C.GW, 'h': C.GH}, 'curbH': CURB_H, 'groundY': GROUND_Y,
            'grid': {'cell': GCELL, 'k': GK, 'nx': gdim[0], 'nz': gdim[1]}, 'nseg': int(len(seg)),
            'pools': {'w': int(pools.shape[1]), 'h': int(pools.shape[0]), 'cell': 1.0}, 'parts': pk.meta, 'props': ptypes,
            'stats': {'crossings': len(xings), 'curb_m': round(sum(LineString(q).length for q in cb)), 'slab_tris': int(len(T))}}
    json.dump(meta, open(os.path.join(EXTRA, 'streets_meta.json'), 'w'), separators=(',', ':'))
    log('wrote streets_data.bin.gz %.2f MB raw -> %.2f MB gz, meta; total %.1fs' % (len(blob) / 1048576, os.path.getsize(os.path.join(EXTRA, 'streets_data.bin.gz')) / 1048576, time.time() - t0))


if __name__ == '__main__' and 'tex' in sys.argv:
    textures()
elif __name__ == '__main__':
    main()
