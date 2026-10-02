"""BUILDING REPLACEMENT (seed MAN): swap NYC DCP buildings for modelled CityGen buildings of the same size and shape.

    TL_BUILD_DIR=build_repl python tools/scan/replace_buildings.py [--ratio 0.92] [--report]

Inputs : <build>/nyc.json + nyc.bin (tools/scan/build_nyc.py), <build>/landmarks.json (ids already replaced),
         src/new-york-city/source/procedural_city_6.glb (split into candidate buildings by tools/scan/replace_city.py).
Outputs: <build>/extra/repl_meta.json   candidates (geometry ranges, material classes), instances, colliders, replaced ids
         <build>/extra/repl_geo.bin.gz  vertex data            <build>/extra/repl_atlas.webp  shared texture atlas
Runtime: src/03f_replace.js.

Rule (the user's): a real building may be replaced when width, depth AND height are each within 92% of a candidate's
(min/max >= 0.92, a 90 degree turn allowed, no mirroring), it is not iconic, and its shape really is the candidate's
shape: footprint IoU and the roof-height profile are compared on a grid normalised to both footprint rectangles (an
L-shaped or stepped real building never gets a box). Width/depth = the footprint's minimum-area rectangle, height =
the main roof (75th percentile of the roof-height map, so a bulkhead or antenna does not count as the building).
The candidate is then fitted exactly: rotated onto the real rectangle, scaled (<= 8% per axis), standing on the ground.
Keyed on building ids AND geometry: re-runnable against a regenerated nyc.json (everything is re-measured).
"""
import os, sys, io, json, gzip, math, time, argparse
import numpy as np
import cv2
from scipy import ndimage as nd
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import replace_city

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, os.environ.get('TL_BUILD_DIR', 'build'))
GLB = os.path.join(ROOT, 'src', 'new-york-city', 'source', 'procedural_city_6.glb')
R = 0.5            # NYC raster resolution (m)
G = 48             # normalised comparison grid
def log(*a): print('[repl]', *a, flush=True)

# ---------------------------------------------------------------------------------------------- iconic exclusions
# Lower Manhattan landmarks / notable buildings that must keep their real (DCP) shape. Located by lat/lon -> NY State
# Plane (EPSG:2263) -> scan world (tools/scan/nyc_affine.json); every building whose footprint comes within 15 m of the
# point is excluded (generous on purpose: a lot-edge point must not leave the landmark itself replaceable).
ICONIC = [
    ('One World Trade Center', 40.71299, -74.01323), ('3 World Trade Center', 40.71088, -74.01181), ('4 World Trade Center', 40.71022, -74.01196),
    ('7 World Trade Center', 40.71346, -74.01212), ('2 WTC site', 40.71175, -74.01200), ('WTC Transportation Hub (Oculus)', 40.71147, -74.01105),
    ('9/11 Museum pavilion', 40.71137, -74.01335), ('Woolworth Building', 40.71240, -74.00824), ('8 Spruce Street', 40.71095, -74.00544),
    ('70 Pine Street', 40.70634, -74.00785), ('40 Wall Street', 40.70689, -74.00948), ('1 Wall Street (BNY Mellon)', 40.70703, -74.01177),
    ('Trinity Church', 40.70806, -74.01206), ('Federal Hall', 40.70737, -74.01030), ('New York Stock Exchange', 40.70687, -74.01118),
    ('26 Broadway (Standard Oil)', 40.70547, -74.01313), ('25 Broadway (Cunard)', 40.70518, -74.01349), ('20 Exchange Place', 40.70613, -74.00941),
    ('60 Wall Street', 40.70602, -74.00851), ('55 Wall Street (Merchants Exchange)', 40.70607, -74.00915), ('48 Wall Street', 40.70665, -74.00916),
    ('23 Wall Street (House of Morgan)', 40.70667, -74.01060), ('14 Wall Street (Bankers Trust)', 40.70738, -74.01091),
    ('15 / 20 Broad Street', 40.70660, -74.01090), ('Equitable Building (120 Broadway)', 40.70845, -74.01080),
    ('28 Liberty Street (One Chase Manhattan Plaza)', 40.70792, -74.00868), ('Federal Reserve Bank of NY', 40.70835, -74.00866),
    ('Liberty Tower (55 Liberty)', 40.70860, -74.00946), ('One Liberty Plaza', 40.70960, -74.01103), ('American Surety Building', 40.70838, -74.01142),
    ('Trinity & US Realty Buildings', 40.70880, -74.01182), ('90 West Street', 40.70937, -74.01354), ('195 Broadway (AT&T)', 40.71059, -74.00960),
    ("St. Paul's Chapel", 40.71117, -74.00915), ('Park Row Building', 40.71169, -74.00787), ('Potter Building', 40.71158, -74.00694),
    ('City Hall', 40.71274, -74.00597), ('Tweed Courthouse', 40.71363, -74.00590), ('Manhattan Municipal Building', 40.71316, -74.00401),
    ("St. Peter's Church (Barclay St)", 40.71290, -74.00916), ('Brookfield Place', 40.71296, -74.01556),
    ('Alexander Hamilton U.S. Custom House', 40.70415, -74.01368), ('Bowling Green offices', 40.70440, -74.01410), ('Whitehall Building', 40.70413, -74.01487),
    ('Downtown Athletic Club', 40.70560, -74.01557), ('Fraunces Tavern', 40.70337, -74.01133), ("Delmonico's Building", 40.70501, -74.01029),
    ('India House', 40.70450, -74.01005), ('Battery Maritime Building', 40.70098, -74.01212), ('South Street Seaport Schermerhorn Row', 40.70660, -74.00340),
    ('Brooklyn Bridge approach', 40.70880, -74.00000),
]


def iconic_ids(nm, aff):
    try:
        from pyproj import Transformer
    except ImportError:
        raise SystemExit('pyproj is needed to locate the iconic buildings (pip install pyproj)')
    tr = Transformer.from_crs('EPSG:4326', 'EPSG:2263', always_xy=True)
    ids = nm['ids']; out = []
    r = int(15 / R)
    for name, la, lo in ICONIC:
        E, N = tr.transform(lo, la); E *= 0.3048006096; N *= 0.3048006096
        X = aff[0, 0] * E + aff[0, 1] * N + aff[0, 2]; Z = aff[1, 0] * E + aff[1, 1] * N + aff[1, 2]
        i, j = int((Z - nm['Z0']) / R), int((X - nm['X0']) / R)
        hit = []
        if -r <= i < ids.shape[0] + r and -r <= j < ids.shape[1] + r:
            yy, xx = np.mgrid[-r:r + 1, -r:r + 1]; disk = yy * yy + xx * xx <= r * r
            ii, jj = np.clip(i + yy[disk], 0, ids.shape[0] - 1), np.clip(j + xx[disk], 0, ids.shape[1] - 1)
            hit = sorted(set(int(v) for v in ids[ii, jj] if v))
        out.append((name, round(float(X), 1), round(float(Z), 1), hit))
    return out


# ---------------------------------------------------------------------------------------------- NYC measurement
def measure_nyc(N, B):
    allT = [np.frombuffer(B, np.float32, b['n'] * 9, b['o']).reshape(-1, 3, 3) for b in N['buildings']]
    P = np.concatenate([t.reshape(-1, 3) for t in allT])
    X0, Z0 = float(P[:, 0].min() - 20), float(P[:, 2].min() - 20)
    GW, GH = int((P[:, 0].max() + 20 - X0) / R) + 1, int((P[:, 2].max() + 20 - Z0) / R) + 1
    ids = np.zeros((GH, GW), np.int32)
    out = {}
    for b, T in zip(N['buildings'], allT):
        q = np.stack([(T[:, :, 0] - X0) / R, (T[:, :, 2] - Z0) / R], -1)
        x0, y0 = np.floor(q.reshape(-1, 2).min(0)).astype(int) - 1
        x1, y1 = np.ceil(q.reshape(-1, 2).max(0)).astype(int) + 2
        fp = np.zeros((y1 - y0, x1 - x0), np.uint8); hm = np.zeros(fp.shape, np.float32)
        n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ny = np.abs(n[:, 1]) / (np.linalg.norm(n, axis=1) + 1e-12)
        for t, qq, yy in zip(T, q, ny):
            if yy <= 0.3: continue
            sub = np.zeros_like(fp)
            cv2.fillPoly(sub, [np.round((qq - [x0, y0]) * 8).astype(np.int32)], 1, shift=3)
            fp |= sub; np.maximum(hm, sub * np.float32(t[:, 1].max()), out=hm)
        fp = nd.binary_fill_holes(nd.binary_closing(fp > 0, iterations=1))
        hm = np.where(fp, np.maximum(hm, nd.maximum_filter(hm, 3) * (hm == 0)), 0)
        ys, xs = np.nonzero(fp)
        if len(xs) < 8: continue
        reg = ids[y0:y1, x0:x1]; reg[fp & (reg == 0)] = b['id']
        out[b['id']] = dict(b=b, x0=int(x0), y0=int(y0), fp=fp, hm=hm, T=T)
    # each building's real wall colour: median of the photo atlas under its wall triangles (the facade the player sees)
    ap = os.path.join(OUT, 'nyc_atlas_sharp.webp') if os.path.exists(os.path.join(OUT, 'nyc_atlas_sharp.webp')) else os.path.join(OUT, 'nyc_atlas.webp')
    if os.path.exists(ap):
        Image.MAX_IMAGE_PIXELS = None
        tex = np.array(Image.open(ap).convert('RGB')); TH, TW = tex.shape[:2]
        rng = np.random.default_rng(3)
        for bid, o in out.items():
            b = o['b']
            if 'uo' not in b: continue
            T = o['T']; UVb = np.frombuffer(B, np.float32, b['n'] * 6, b['uo']).reshape(-1, 3, 2)
            n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ar = np.linalg.norm(n, axis=1) / 2
            wall = np.nonzero((np.abs(n[:, 1]) < 0.3 * (2 * ar + 1e-9)) & (ar > 0.2))[0]
            if not len(wall): continue
            k = rng.choice(wall, 2000, p=ar[wall] / ar[wall].sum())
            u = rng.random(len(k)); v = rng.random(len(k)); m_ = u + v > 1; u[m_] = 1 - u[m_]; v[m_] = 1 - v[m_]
            q = UVb[k, 0] + (UVb[k, 1] - UVb[k, 0]) * u[:, None] + (UVb[k, 2] - UVb[k, 0]) * v[:, None]
            px = tex[np.clip(((1 - q[:, 1]) * TH).astype(int), 0, TH - 1), np.clip((q[:, 0] * TW).astype(int), 0, TW - 1)] / 255.0
            o['photo'] = np.median(px, 0)
        # the scan photo is dark with a strong sky-blue cast (it is shown emissive): white-balance it the way
        # build_nyc.py does (mean over all buildings -> neutral) so it compares with the models' albedo
        have = [o['photo'] for o in out.values() if 'photo' in o]
        if have:
            gain = np.array([150, 145, 138.0]) / 255.0 / np.maximum(np.mean(have, 0), 1e-3)
            for o in out.values():
                if 'photo' in o: o['wb'] = np.clip(o['photo'] * gain, 0, 1)
    return dict(out=out, ids=ids, X0=X0, Z0=Z0)


def real_frame(o, nm):
    """minimum-area rectangle frame of a real footprint: centre, unit axes e1/e2 (e2 = e1 turned +90 degrees, so the
    frame is a proper rotation), extents W/D, and the footprint / roof height sampled on the normalised G x G grid"""
    ys, xs = np.nonzero(o['fp']); pts = np.stack([xs, ys], 1).astype(np.float32) + 0.5
    box = cv2.boxPoints(cv2.minAreaRect(pts)); e1 = box[1] - box[0]; e1 = e1 / np.linalg.norm(e1); e2 = np.array([-e1[1], e1[0]])
    a, b = pts @ e1, pts @ e2
    W, D = (a.max() - a.min() + 1) * R, (b.max() - b.min() + 1) * R
    cpx = e1 * (a.max() + a.min()) / 2 + e2 * (b.max() + b.min()) / 2
    u = (np.arange(G) + 0.5) / G - 0.5
    U, V = np.meshgrid(u, u)
    px = cpx + (U[..., None] * (W / R)) * e1 + (V[..., None] * (D / R)) * e2
    xi = np.clip(np.floor(px[..., 0]).astype(int), 0, o['fp'].shape[1] - 1); yi = np.clip(np.floor(px[..., 1]).astype(int), 0, o['fp'].shape[0] - 1)
    fpg = o['fp'][yi, xi]; hmg = np.where(fpg, o['hm'][yi, xi], 0)
    h75 = float(np.percentile(o['hm'][o['fp']], 75))
    # abutment per side (+e1, -e1, +e2, -e2): share of the side with another building within 2.5 m outside it
    ids = nm['ids']; ab = []
    for dvec, along, half, L in ((e1, e2, W / 2, D), (-e1, e2, W / 2, D), (e2, e1, D / 2, W), (-e2, e1, D / 2, W)):
        s = np.linspace(-0.45, 0.45, 24) * L / R
        hit = 0
        for t in s:
            for off in (1.0, 2.5):
                p = cpx + dvec * (half / R + off / R) + along * t
                i, j = int(p[1] + o['y0']), int(p[0] + o['x0'])
                if 0 <= i < ids.shape[0] and 0 <= j < ids.shape[1] and ids[i, j] not in (0, o['b']['id']): hit += 1; break
        ab.append(hit / len(s))
    return dict(e1=e1, e2=e2, W=float(W), D=float(D), cx=float((cpx[0] + o['x0']) * R + nm['X0']), cz=float((cpx[1] + o['y0']) * R + nm['Z0']),
                fp=fpg > 0, hm=hmg, h75=h75, abut=ab)


# ---------------------------------------------------------------------------------------------- candidates
WALLMAT = {'CityGen_LR_Facades', 'Building_Facade.001', 'CityGenconcrete.001', 'CityGentextured_metal', 'CityGenblack_.001', 'CityGenyellow_stone'}


def cand_metrics(c, mats, texs, ns=6000, seed=1):
    """what the candidate's walls look like: area-weighted random points on its outward walls -> texel colour (x base
    factor). Window panes (dark, unsaturated) are told apart from wall surface: 'colour' = median wall colour (sRGB 0..1),
    'glass' = share of the facade that is glass (panes + curtain-wall panels) -> masonry vs glass tower."""
    hm = c['hm']; c['h75'] = float(np.percentile(hm[hm > 0], 75))
    rng = np.random.default_rng(seed)
    T = c['T']; n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ar = np.linalg.norm(n, axis=1) / 2
    names = np.array([mats[m]['name'] for m in c['M']])
    wall = (np.abs(n[:, 1]) < 0.3 * (2 * ar + 1e-9)) & np.isin(names, list(WALLMAT))
    W = np.nonzero(wall)[0]
    if not len(W): c['colour'] = np.array([0.5, 0.5, 0.5]); c['glass'] = 0.0; c['blank'] = [0, 0, 0, 0]; return
    pick = rng.choice(W, ns, p=ar[W] / ar[W].sum())
    u = rng.random(ns); v = rng.random(ns); m_ = u + v > 1; u[m_] = 1 - u[m_]; v[m_] = 1 - v[m_]
    UV = c['UV'][pick]; uv = UV[:, 0] + (UV[:, 1] - UV[:, 0]) * u[:, None] + (UV[:, 2] - UV[:, 0]) * v[:, None]
    col = np.zeros((ns, 3)); isg = np.zeros(ns, bool)
    for mi in np.unique(c['M'][pick]):
        k = c['M'][pick] == mi; m = mats[mi]; pbr = m.get('pbrMetallicRoughness', {})
        f = np.array(pbr.get('baseColorFactor', [1, 1, 1, 1])[:3]) ** (1 / 2.2)
        t = pbr.get('baseColorTexture')
        if t is not None:
            q = uv[k]
            ext = t.get('extensions', {}).get('KHR_texture_transform')
            if ext: q = q * np.array(ext.get('scale', [1, 1])) + np.array(ext.get('offset', [0, 0]))
            im = texs(t['index']); q = q % 1.0
            px = im[np.minimum((q[:, 1] * im.shape[0]).astype(int), im.shape[0] - 1), np.minimum((q[:, 0] * im.shape[1]).astype(int), im.shape[1] - 1)]
            rgb = px[:, :3] / 255.0 * f
            if m['name'] == 'Building_Facade.001': isg[k] = px[:, 3] < 128
        else: rgb = np.tile(f, (k.sum(), 1))
        col[k] = rgb
        if m['name'] in ('CityGenblack_.001', 'CityGenGlass.001'): isg[k] = True
    lum = col @ [0.299, 0.587, 0.114]; sat = col.max(1) - col.min(1)
    isg |= (lum < 0.16) & (sat < 0.10)
    wallc = col[~isg] if (~isg).sum() > 50 else col
    c['colour'] = np.median(wallc, 0)
    c['glass'] = float(isg.mean())
    wallA = [max(c['d'], 1) * c['h75'], max(c['d'], 1) * c['h75'], max(c['w'], 1) * c['h75'], max(c['w'], 1) * c['h75']]
    c['blank'] = [min(1.0, a / wa) for a, wa in zip(c['fillArea'], wallA)]        # synthesized share per side x-,x+,z-,z+


def cand_grid(c, f, k, sx, sz):
    """candidate footprint/roof sampled at the real frame's normalised grid points, for quarter-turn k and scales"""
    u = (np.arange(G) + 0.5) / G - 0.5
    U, V = np.meshgrid(u, u)
    q = U[..., None] * f['W'] * f['e1'] + V[..., None] * f['D'] * f['e2']            # metres, world xz offsets
    ax = [f['e1'], f['e2'], -f['e1'], -f['e2']][k]; pz = np.array([-ax[1], ax[0]])
    x = (q @ ax) / sx; z = (q @ pz) / sz
    hm = c['hm']; Rc = replace_city.R
    col = np.floor((x + c['w'] / 2) / Rc).astype(int); row = np.floor((z + c['d'] / 2) / Rc).astype(int)
    ok = (col >= 0) & (row >= 0) & (col < hm.shape[1]) & (row < hm.shape[0])
    return np.where(ok, hm[np.clip(row, 0, hm.shape[0] - 1), np.clip(col, 0, hm.shape[1] - 1)], 0), ax, pz


def lab(rgb):
    c = np.clip(np.array(rgb, float).reshape(1, 1, 3), 0, 1).astype(np.float32)
    return cv2.cvtColor(c, cv2.COLOR_RGB2LAB)[0, 0]


FAM = {0: 'GLASS', 1: 'STONE', 2: 'BRICK', 3: 'INDUSTRIAL', 4: 'BROWNSTONE', 5: 'OFFICE'}


def score_pair(c, f, o, ratio):
    """best quarter turn of candidate c on real frame f, or None when it fails the rule"""
    b = o['b']; best = None
    rh = min(c['h75'], f['h75']) / max(c['h75'], f['h75'])
    if rh < ratio: return None
    for k in range(4):
        w, d = (c['w'], c['d']) if k % 2 == 0 else (c['d'], c['w'])
        RW, RD = (f['W'], f['D']) if k % 2 == 0 else (f['D'], f['W'])   # real extent along candidate x / z
        rw, rd = min(c['w'], RW) / max(c['w'], RW), min(c['d'], RD) / max(c['d'], RD)
        if min(rw, rd) < ratio: continue
        sx, sz = RW / c['w'], RD / c['d']
        g, ax, pz = cand_grid(c, f, k, sx, sz)
        A, Bm = f['fp'], g > 0
        iou = (A & Bm).sum() / max((A | Bm).sum(), 1)
        ra = np.clip(np.where(A, f['hm'], 0) / f['h75'], 0, 1.3); rb = np.clip(g / c['h75'], 0, 1.3)
        err = float(np.abs(ra - rb)[A | Bm].mean())
        # blank (synthesized party) walls should face the real building's neighbours: side x-,x+,z-,z+ -> world dirs
        dirs = [-ax, ax, -pz, pz]
        expo = 0.0
        for side, dv in enumerate(dirs):
            sims = [float(dv @ e) for e in (f['e1'], -f['e1'], f['e2'], -f['e2'])]
            expo += c['blank'][side] * (1 - f['abut'][int(np.argmax(sims))])
        s = dict(k=k, sx=sx, sz=sz, sy=f['h75'] / c['h75'], iou=float(iou), err=err, expo=expo, rw=rw, rd=rd, rh=rh, ax=ax)
        if best is None or (s['err'] + (1 - s['iou']) + 0.15 * s['expo']) < (best['err'] + (1 - best['iou']) + 0.15 * best['expo']): best = s
    return best


# ---------------------------------------------------------------------------------------------- atlas + geometry
def brick_tile(size=256, seed=7):
    """running-bond brick for synthesized party walls (tiles: 2 m x 2 m); coloured per instance by vertex colour"""
    rng = np.random.default_rng(seed)
    im = np.zeros((size, size, 3), np.float32)
    bh = size // 26; bw = size // 9          # ~ 7.7 cm courses, 22 cm bricks at 2 m per tile
    for r in range(0, size, bh):
        off = (r // bh) % 2 * bw // 2
        for c0 in range(-bw, size + bw, bw):
            v = rng.normal(1.0, 0.07); hue = rng.normal(0, 0.03)
            x0, x1 = max(c0 + off, 0), min(c0 + off + bw - 1, size)
            if x1 <= x0: continue
            im[r:r + bh - 1, x0:x1] = np.array([0.80 + hue, 0.80, 0.80 - hue]) * v
    im[im.sum(-1) == 0] = 0.62                           # mortar
    im *= rng.normal(1.0, 0.04, (size, size, 1))
    blur = cv2.GaussianBlur(rng.normal(0, 1, (size // 16, size // 16)).astype(np.float32), (0, 0), 1.0)
    im *= 1 + 0.08 * cv2.resize(blur, (size, size), interpolation=cv2.INTER_CUBIC)[..., None]
    a = np.full((size, size, 1), 1.0, np.float32)
    return (np.clip(np.concatenate([im, a], -1), 0, 1) * 255).astype(np.uint8)


class Atlas:
    """RGBA atlas, shelf-packed tallest first, exact (non power of two) height. Tiling regions get a wrapped 8 px border
    (mip levels / bilinear taps at a tile edge read the opposite edge), others a clamped one. add() returns a key;
    regions (x, y, w, h px) exist after pack()."""
    PAD = 8

    def __init__(self, W=4096):
        self.W = W; self.items = {}; self.regions = {}

    def add(self, key, img, tile):
        if key not in self.items: self.items[key] = (img, tile)
        return key

    def _layout(self, W):
        x = y = row = 0; P = self.PAD; reg = {}
        for key, (img, tile) in sorted(self.items.items(), key=lambda kv: -kv[1][0].shape[0]):
            h, w = img.shape[:2]
            if x + w + 2 * P > W: x = 0; y += row; row = 0
            reg[key] = (x + P, y + P, w, h); x += w + 2 * P; row = max(row, h + 2 * P)
        return reg, int(np.ceil((y + row) / 64.0) * 64)

    def pack(self):
        # smallest area over a few widths (non power of two is fine in WebGL2), height <= 4096 where possible
        P = self.PAD; widest = max(img.shape[1] for img, _ in self.items.values()) + 2 * P
        opts = []
        for W in sorted(set([int(np.ceil(widest / 64.0) * 64), 2560, 3072, 4096])):
            if W < widest or W > 4096: continue
            reg, H = self._layout(W); opts.append((H > 4096, W * H, W, reg, H))
        _, _, self.W, self.regions, self.H = min(opts, key=lambda o: (o[0], o[1]))
        A = np.zeros((self.H, self.W, 4), np.uint8)
        for key, (img, tile) in self.items.items():
            rx, ry, w, h = self.regions[key]
            A[ry - P:ry + h + P, rx - P:rx + w + P] = np.pad(img, ((P, P), (P, P), (0, 0)), mode='wrap' if tile else 'edge')
        return A


def build_assets(sel, cands, mats, J, image, texs):
    used = sorted(set(m['cand'] for m in sel))
    atlas = Atlas()
    brick = atlas.add('brick', brick_tile(), True)
    # material -> (region, tiling, transform, factor, class, rough, metal, window flag)
    minfo = {}
    CLASS_ALPHA = {'firescape', 'Material.001', 'Material.003'}
    GLASS = {'CityGenGlass.001'}
    def mat_info(mi, tiling):
        key = (mi, tiling)
        if key in minfo: return minfo[key]
        m = mats[mi]; pbr = m.get('pbrMetallicRoughness', {}); name = m['name']
        f = list(pbr.get('baseColorFactor', [1, 1, 1, 1]))
        rough = pbr.get('roughnessFactor', 1.0); metal = pbr.get('metallicFactor', 1.0)
        if pbr.get('metallicRoughnessTexture') is not None: rough, metal = min(rough, 0.85), min(metal, 0.1)
        cls = 'alpha' if name in CLASS_ALPHA else 'glass' if name in GLASS else 'opaque'
        win = 2 if name == 'CityGenblack_.001' else 0
        tr = (0, 0, 1, 1); reg = None
        t = pbr.get('baseColorTexture')
        if t is not None:
            ext = t.get('extensions', {}).get('KHR_texture_transform')
            if ext: tr = (ext.get('offset', [0, 0])[0], ext.get('offset', [0, 0])[1], ext.get('scale', [1, 1])[0], ext.get('scale', [1, 1])[1])
            im = texs(t['index']).copy()
            cap = 2048 if name == 'CityGen_LR_Facades' else 1024 if name in ('Building_Facade.001', 'CityGentextured_metal', 'CityGenconcrete.001') else 512
            if name == 'CityGenconcrete.001': cap = 2048          # 8 swatches in a 4096 x 512 strip
            s = min(1.0, cap / max(im.shape[:2]))
            if s < 1: im = cv2.resize(im, (int(im.shape[1] * s), int(im.shape[0] * s)), interpolation=cv2.INTER_AREA)
            if cls == 'opaque':
                # opaque materials: alpha channel = 255 wall / 0 window glass (lit at night)
                rgb = im[..., :3].astype(np.float32)
                if name == 'Building_Facade.001':        # transparent window cut-outs -> dark glass
                    win_m = im[..., 3] < 128
                    rgb[win_m] = rgb[win_m] * 0.15 + np.array([22, 30, 38]) * 0.85
                    im[..., :3] = rgb.astype(np.uint8); win = 1
                elif name == 'CityGen_LR_Facades':      # dark panes in the facade photos
                    lum = rgb @ [0.299, 0.587, 0.114]
                    win_m = (lum < 34) & (np.ptp(rgb, -1) < 30)
                    win_m = nd.binary_opening(win_m, iterations=1); win = 1
                else: win_m = np.zeros(im.shape[:2], bool)
                im[..., 3] = np.where(win_m, 0, 255)
            reg = atlas.add(t['index'], im, tiling)
        minfo[key] = dict(reg=reg, tr=tr, f=f, cls=cls, rough=rough, metal=metal, win=win, name=name)
        return minfo[key]

    # pass 1: every material of every used candidate -> atlas entries; pass 2 (after packing): vertex data
    jobs = []
    for ci in used:
        c = cands[ci]
        for mi in np.unique(c['M']):          # tiling decided per material from its UVs in this candidate
            idx = np.nonzero(c['M'] == mi)[0]
            t = mats[mi].get('pbrMetallicRoughness', {}).get('baseColorTexture')
            uv = c['UV'][idx].copy()
            ext = t.get('extensions', {}).get('KHR_texture_transform') if t else None
            if ext: uv = uv * np.array(ext.get('scale', [1, 1])) + np.array(ext.get('offset', [0, 0]))
            tiling = bool(t is not None and ((uv < -0.002).any() or (uv > 1.002).any()))
            jobs.append((ci, idx, uv, mat_info(int(mi), tiling), tiling))
    A = atlas.pack()
    # keep the atlas <= 4096 tall (WebGL max texture size on weaker GPUs): halve everything but the facade atlas
    while atlas.H > 4096:
        for key, (img, tile) in list(atlas.items.items()):
            if img.shape[0] > 64 and img.shape[0] < 2048:
                atlas.items[key] = (cv2.resize(img, (img.shape[1] // 2, img.shape[0] // 2), interpolation=cv2.INTER_AREA), tile)
        A = atlas.pack()
    geo = {}                                                # (cand, cls) -> lists
    for ci, idx, uv, info, tiling in jobs:
        c = cands[ci]
        g = geo.setdefault((ci, info['cls']), dict(P=[], UV=[], RC=[], C=[], PB=[]))
        g['P'].append(c['T'][idx])
        if info['reg'] is None:
            g['UV'].append(np.zeros((len(idx), 3, 2), np.float32)); rect = (-1, -1, 0, 0)      # rect.x < 0: untextured
        else:
            rx, ry, rw, rh = atlas.regions[info['reg']]
            if tiling: g['UV'].append(uv.astype(np.float32)); rect = (rx / atlas.W, ry, rw / atlas.W, rh)     # y fixed after build
            else:
                g['UV'].append(np.stack([(rx + np.clip(uv[..., 0], 0, 1) * rw) / atlas.W, ry + np.clip(uv[..., 1], 0, 1) * rh], -1).astype(np.float32))
                rect = (0, -2, 0, 0)                                                                       # pre-mapped (y fixed later)
        g['RC'].append(np.tile(np.array(rect, np.float64), (len(idx), 3, 1)))
        f = info['f']
        g['C'].append(np.tile(np.array([f[0], f[1], f[2]], np.float32), (len(idx), 3, 1)))
        g['PB'].append(np.tile(np.array([info['rough'], info['metal'], info['win'] / 2.0, f[3]], np.float32), (len(idx), 3, 1)))
    for ci in used:
        c = cands[ci]
        # synthesized party walls: brick, 2 m tiles, world-ish UVs (along the wall, up)
        F = c['fill']
        if len(F):
            g = geo.setdefault((ci, 'opaque'), dict(P=[], UV=[], RC=[], C=[], PB=[]))
            n = np.cross(F[:, 1] - F[:, 0], F[:, 2] - F[:, 0])
            s = np.where((np.abs(n[:, 0]) > np.abs(n[:, 2]))[:, None], F[..., 2], F[..., 0])
            uv = np.stack([s / 2.0, F[..., 1] / 2.0], -1).astype(np.float32)
            g['P'].append(F); g['UV'].append(uv)
            rx, ry, rw, rh = atlas.regions[brick]
            g['RC'].append(np.tile(np.array([rx / atlas.W, ry, rw / atlas.W, rh], np.float64), (len(F), 3, 1)))
            g['C'].append(np.tile(np.array(c['partyTint'], np.float32), (len(F), 3, 1)))
            g['PB'].append(np.tile(np.array([0.9, 0.0, 0.0, 1.0], np.float32), (len(F), 3, 1)))
    # atlas y (pixels) -> normalised now that its height is known
    out = {}
    for key, g in geo.items():
        P = np.concatenate(g['P']).astype(np.float32); UV = np.concatenate(g['UV']); RC = np.concatenate(g['RC']); C = np.concatenate(g['C']); PB = np.concatenate(g['PB'])
        pre = RC[..., 1] == -2
        UV[..., 1] = np.where(pre, UV[..., 1] / atlas.H, UV[..., 1])
        RC[..., 1] = np.where(RC[..., 1] >= 0, RC[..., 1] / atlas.H, RC[..., 1]); RC[..., 3] = RC[..., 3] / atlas.H
        RC[pre] = 0
        out[key] = dict(P=P, UV=UV.astype(np.float32), RC=RC.astype(np.float32), C=C, PB=PB)
    return out, A, atlas


def colliders(c):
    """oriented boxes for a candidate in its local frame (x, z, hx, hz, top): one set per roof tier (a height level
    covering >= 6% of the footprint); each tier's region (cells at least that high) is covered by a few rectangles
    (chamfers, L-shaped tiers) whose top is that tier's own roof. Lower tiers under a tower overlap its boxes: fine."""
    hm = c['hm']; Rc = replace_city.R
    fp = hm > 0
    q = np.round(hm)
    area = fp.sum(); levels = []
    for v in sorted(set(q[fp].ravel())):
        if (q >= v).sum() < 0.06 * area: break
        if not levels or v - levels[-1] >= 3: levels.append(v)     # within 3 m: same tier (parapets, bulkhead lips)
    boxes = []
    for li, v in enumerate(levels):
        regm = q >= v - 0.5
        if regm.sum() > 200: regm = nd.binary_opening(regm, iterations=2)
        if regm.sum() < 16: continue
        nxt = levels[li + 1] if li + 1 < len(levels) else None
        own = regm & (q < nxt - 0.5) if nxt is not None else regm
        topv = float(np.percentile(hm[own], 90)) if own.sum() >= 16 else float(v)
        for (r0, r1, c0, c1) in rect_cover(regm):
            x0 = c0 * Rc - c['w'] / 2; x1 = (c1 + 1) * Rc - c['w'] / 2; z0 = r0 * Rc - c['d'] / 2; z1 = (r1 + 1) * Rc - c['d'] / 2
            boxes.append(((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, topv))
    return boxes


def rect_cover(m, cover=0.96, maxn=4):
    """a few axis-aligned rectangles covering a mask (largest rectangle first)"""
    m = m.copy(); total = m.sum(); out = []
    while m.sum() > (1 - cover) * total and len(out) < maxn:
        h = np.zeros(m.shape[1], int); best = (0, None)
        for r in range(m.shape[0]):
            h = np.where(m[r], h + 1, 0)
            st = []
            for cc in range(len(h) + 1):
                hh = h[cc] if cc < len(h) else 0
                start = cc
                while st and st[-1][1] >= hh:
                    s0, sh = st.pop(); a = sh * (cc - s0)
                    if a > best[0]: best = (a, (r - sh + 1, r, s0, cc - 1))
                    start = s0
                st.append((start, hh))
        if best[1] is None or best[0] < 16: break
        r0, r1, c0, c1 = best[1]; m[r0:r1 + 1, c0:c1 + 1] = False
        if min(r1 - r0, c1 - c0) + 1 >= 3: out.append(best[1])       # < 0.75 m wide: a cornice lip, not climbable mass
    return out


# ---------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ratio', type=float, default=0.92, help='minimum min/max ratio for width, depth and height')
    ap.add_argument('--iou', type=float, default=0.85, help='minimum footprint IoU after the fit')
    ap.add_argument('--err', type=float, default=0.18, help='maximum mean roof-profile difference (fraction of the height)')
    ap.add_argument('--report', action='store_true', help='also list near misses')
    ap.add_argument('--dry', action='store_true', help='match and report only, write nothing')
    a = ap.parse_args()
    t0 = time.time()
    N = json.load(open(os.path.join(OUT, 'nyc.json'))); B = open(os.path.join(OUT, 'nyc.bin'), 'rb').read()
    aff = np.array(json.load(open(os.path.join(os.path.dirname(__file__), 'nyc_affine.json')))['affine'])
    lmr = set()
    if os.path.exists(os.path.join(OUT, 'landmarks.json')):
        for L in json.load(open(os.path.join(OUT, 'landmarks.json')))['landmarks']: lmr |= set(L.get('replaces', []))
    src = replace_city.extract(GLB, log=log)
    J, image, mats = src['J'], src['image'], src['mats']
    cache = {}
    def texs(ti):
        if ti not in cache:
            cache[ti] = np.array(Image.open(io.BytesIO(image(J['textures'][ti]['source']))).convert('RGBA'))
        return cache[ti]
    # usable candidates: >= 9.5 m on each side and 20 m tall (drops the two small corner pieces whose source geometry has
    # stray skirt surfaces, and the 6 m deep sliver)
    good = []
    for c in src['cands']:
        c['h75'] = float(np.percentile(c['hm'][c['hm'] > 0], 75))
        if min(c['w'], c['d']) < 9.5 or c['h75'] < 20: continue
        cand_metrics(c, mats, texs)
        good.append(c)
    cands = good
    for i, c in enumerate(cands): c['idx'] = i
    log('%d usable candidates' % len(cands))
    nm = measure_nyc(N, B)
    ic = iconic_ids(nm, aff)
    excl = set()
    for name, X, Z, hit in ic: excl |= set(hit)
    scan_only = set(b['id'] for b in N['buildings'] if b['id'] >= 696)       # scan-only prisms (no real shape data)
    log('iconic exclusions: %d buildings from %d landmarks (+%d landmark-replaced, %d scan-only prisms)' % (len(excl), len(ic), len(lmr), len(scan_only)))
    # all passing pairs
    pairs = []; near = []
    for bid, o in nm['out'].items():
        if bid in excl or bid in lmr or bid in scan_only: continue
        if o['b']['h'] < 15: continue
        f = real_frame(o, nm); o['f'] = f
        for c in cands:
            s = score_pair(c, f, o, a.ratio)
            if s is None: continue
            ok = s['iou'] >= a.iou and s['err'] <= a.err
            # character: never a glass curtain wall on a masonry building or the reverse; colour distance as a preference
            fam = FAM[o['b']['st']]
            rc = o.get('wb')
            if rc is None: rc = np.array([(o['b']['c'] >> 16) & 255, (o['b']['c'] >> 8) & 255, o['b']['c'] & 255]) / 255.0
            dcol = float(np.linalg.norm(lab(rc) - lab(c['colour'])))
            if c['glass'] > 0.6 and fam not in ('GLASS', 'OFFICE'): ok = False; s['why'] = 'curtain-wall model on a %s building' % fam.lower()
            if c['glass'] < 0.45 and fam == 'GLASS': ok = False; s['why'] = 'masonry model on a glass building'
            # facade colour: the photo's wall colour vs the model's wall colour (CIE Lab); a mild tint closes the rest
            if dcol > 25: ok = False; s['why'] = 'facade colour differs (dE %.0f)' % dcol
            s['tint'] = [float(v) for v in np.clip((np.clip(rc, 0.03, 1) ** 2.2 / np.clip(np.array(c['colour']), 0.03, 1) ** 2.2) ** 0.8, 0.6, 1.5)]
            s.update(bid=bid, cand=c['idx'], ckey=c['key'], dcol=dcol, fam=fam)
            (pairs if ok else near).append(s)
    log('%d passing pairs over %d buildings (%d dimension-passing pairs fail shape/character)' % (len(pairs), len(set(p['bid'] for p in pairs)), len(near)))
    # selection: best total per building, varied (each extra use of a candidate costs; never the same candidate on
    # buildings closer than 120 m)
    uses = {}; sel = []
    def total(p): return p['err'] + (1 - p['iou']) + 0.15 * p['expo'] + p['dcol'] / 100 + 0.08 * uses.get(p['cand'], 0)
    byb = {}
    for p in pairs: byb.setdefault(p['bid'], []).append(p)
    order = sorted(byb, key=lambda b: min(p['err'] + (1 - p['iou']) for p in byb[b]))
    for bid in order:
        f = nm['out'][bid]['f']
        opts = sorted(byb[bid], key=total)
        for p in opts:
            clash = any(q['cand'] == p['cand'] and math.hypot(nm['out'][q['bid']]['f']['cx'] - f['cx'], nm['out'][q['bid']]['f']['cz'] - f['cz']) < 120 for q in sel)
            if clash: continue
            sel.append(p); uses[p['cand']] = uses.get(p['cand'], 0) + 1; break
    for p in sel:
        o = nm['out'][p['bid']]; f = o['f']
        log('  replace NYC %d (%s, %.1fx%.1fx%.1f m at %.0f,%.0f) with candidate %d (%.1fx%.1fx%.1f, turn %d): ratios w %.3f d %.3f h %.3f, IoU %.2f, profile %.3f, colour dE %.0f'
            % (p['bid'], p['fam'], f['W'], f['D'], f['h75'], f['cx'], f['cz'], p['ckey'], cands[p['cand']]['w'], cands[p['cand']]['d'], cands[p['cand']]['h75'],
               p['k'], p['rw'], p['rd'], p['rh'], p['iou'], p['err'], p['dcol']))
    if a.report:
        for p in sorted(near, key=lambda p: p['bid']):
            log('  near miss NYC %d (%s) / cand %d: ratios %.2f %.2f %.2f IoU %.2f profile %.3f %s' % (p['bid'], p['fam'], p['ckey'], p['rw'], p['rd'], p['rh'], p['iou'], p['err'], p.get('why', '')))
    if a.dry: return
    # party-wall tint: the candidate's own facade colour, darkened (brick reads as brick, a stone tower gets a stone-ish wall)
    for c in cands:
        col = np.clip(np.array(c['colour']) ** 2.2 * 1.25, 0.05, 0.9)
        c['partyTint'] = [float(v) for v in col]
    geo, A, atlas = build_assets(sel, cands, mats, J, image, texs)
    # pack vertex data
    ED = os.path.join(OUT, 'extra'); os.makedirs(ED, exist_ok=True)
    blob = bytearray(); parts = []
    def put(arr):
        arr = np.ascontiguousarray(arr); off = len(blob); blob.extend(arr.tobytes())
        while len(blob) % 4: blob.append(0)
        return off
    for (ci, cls), g in sorted(geo.items()):
        n = len(g['P'])
        parts.append(dict(cand=int(ci), cls=cls, n=int(n), p=put(g['P']), uv=put(g['UV']), rc=put(g['RC']),
                          c=put(np.clip(g['C'] * 255, 0, 255).astype(np.uint8)), pb=put(np.clip(g['PB'] * 255, 0, 255).astype(np.uint8))))
    inst = []; boxes = []
    for p in sel:
        o = nm['out'][p['bid']]; f = o['f']; c = cands[p['cand']]
        ax = p['ax']; yaw = math.atan2(-ax[1], ax[0])        # three.js rotation.y that turns local +x onto ax
        sx, sz, sy = p['sx'], p['sz'], p['sy']
        inst.append(dict(bid=int(p['bid']), cand=int(p['cand']), key=int(c['key']), x=round(f['cx'], 3), z=round(f['cz'], 3), yaw=round(yaw, 5),
                         sx=round(sx, 4), sy=round(sy, 4), sz=round(sz, 4), tint=[round(v, 3) for v in p['tint']]))
        cy, sy_ = math.cos(yaw), math.sin(yaw)
        for (lx, lz, hx, hz, top) in colliders(c):
            lx *= sx; lz *= sz
            wx = f['cx'] + lx * cy + lz * sy_; wz = f['cz'] - lx * sy_ + lz * cy
            boxes.append([round(wx, 3), round(top * sy, 3), round(wz, 3), round(hx * sx, 3), round(hz * sz, 3), round(yaw, 5), int(p['bid'])])
    meta = dict(v=1, src='src/new-york-city/source/procedural_city_6.glb (CityGen)', ratio=a.ratio, atlas=[atlas.W, atlas.H],
                replaced=[int(p['bid']) for p in sel], parts=parts, inst=inst, boxes=boxes,
                cands=[dict(idx=c['idx'], key=c['key'], w=round(c['w'], 2), d=round(c['d'], 2), h=round(c['h75'], 2)) for c in cands if c['idx'] in set(p['cand'] for p in sel)],
                iconic=[dict(name=n_, x=x_, z=z_, ids=h_) for n_, x_, z_, h_ in ic])
    json.dump(meta, open(os.path.join(ED, 'repl_meta.json'), 'w'))
    with gzip.open(os.path.join(ED, 'repl_geo.bin.gz'), 'wb', 9) as fo: fo.write(bytes(blob))
    Image.fromarray(A, 'RGBA').save(os.path.join(ED, 'repl_atlas.webp'), quality=90, method=6)
    log('wrote %d instances, %d colliders, atlas %dx%d (%.1f MB webp), geometry %.0f KB gz in %.0fs'
        % (len(inst), len(boxes), atlas.W, atlas.H, os.path.getsize(os.path.join(ED, 'repl_atlas.webp')) / 1048576,
           os.path.getsize(os.path.join(ED, 'repl_geo.bin.gz')) / 1024, time.time() - t0))


if __name__ == '__main__':
    main()
