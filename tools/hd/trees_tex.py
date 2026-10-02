"""THREADLINE — tree textures for the Manhattan scan map (seed MAN): leaf/twig atlas + bark maps.

Photo sources (CC0), downloaded once into source/trees_src/:
  ambientCG LeafSet010 (maple-type, London plane stand-in), LeafSet016 (oak), LeafSet014 (elm),
  LeafSet004 (heart-shaped, linden), Poly Haven jacaranda fronds (bipinnate, honey locust stand-in),
  Poly Haven bark scans (zelkova, oak, elm, linden, locust).
Leaves are cut out of the scans one by one, then composited into twig sprays (petioles, stems, overlap
shadows, per-leaf tint and foreshortening) and dense crown clumps for the far LODs.

Atlas: 4 columns x 5 rows of 512 px cells, row = species, columns 0..2 = twig sprays, column 3 = clump.
Every cell's twig is attached at its bottom centre (u = 0.5, v = 0) and grows towards v = 1.
Used by tools/hd/trees_gen.py (build_atlas(), bark_maps()).
"""
import io, os, zipfile, urllib.request
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'source', 'trees_src')
CELL = 512
SS = 2                 # supersampling of the composition
SPECIES = ['plane', 'locust', 'oak', 'elm', 'linden']
LEAFSETS = {'plane': 'acg:LeafSet010', 'oak': 'acg:LeafSet016', 'elm': 'acg:LeafSet014', 'linden': 'acg:LeafSet004',
            'locust': 'ph:jacaranda_tree_leaves'}
BARKS = {'plane': 'japanese_zelkova_bark', 'locust': 'bark_platanus', 'oak': 'jolcham_oak_bark_01',
         'elm': 'tree_bark_03', 'linden': 'bark_brown_02'}


def log(*a):
    print('[trees_tex]', *a, flush=True)


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 1000: return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    log('download', url)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 threadline-build'})
    with urllib.request.urlopen(req, timeout=120) as r: data = r.read()
    with open(path, 'wb') as f: f.write(data)
    return path


def acg_set(name):
    """ambientCG leaf atlas -> (rgb uint8, alpha float)"""
    z = fetch('https://ambientcg.com/get?file=%s_2K-JPG.zip' % name, os.path.join(SRC, name + '_2K-JPG.zip'))
    with zipfile.ZipFile(z) as zf:
        nm = zf.namelist()
        col = next(n for n in nm if n.endswith('_Color.jpg')); op = next(n for n in nm if n.endswith('_Opacity.jpg'))
        rgb = np.asarray(Image.open(io.BytesIO(zf.read(col))).convert('RGB'))
        a = np.asarray(Image.open(io.BytesIO(zf.read(op))).convert('L')).astype(np.float32) / 255
    return rgb, a


def ph_tex(asset, kind, res='2k', folder='Models'):
    p = os.path.join(SRC, '%s_%s_%s.jpg' % (asset, kind, res))
    base = asset if folder == 'Textures' else asset.rsplit('_leaves', 1)[0]
    return fetch('https://dl.polyhaven.org/file/ph-assets/%s/jpg/%s/%s/%s_%s_%s.jpg' % (folder, res, base, asset, kind, res), p)


def jacaranda():
    """Poly Haven jacaranda fronds on black: alpha from brightness + saturation"""
    rgb = np.asarray(Image.open(ph_tex('jacaranda_tree_leaves', 'diff')).convert('RGB'))
    f = rgb.astype(np.float32)
    lum = f.max(-1)
    a = np.clip((lum - 18) / 22, 0, 1)
    a = cv2.GaussianBlur(a, (0, 0), 0.7)
    return rgb, a


def leaf_sprites(species):
    """cut single leaves / fronds out of the source scan: list of (rgba float32 [h,w,4]), base at the bottom"""
    src = LEAFSETS[species]
    if src.startswith('acg:'): rgb, a = acg_set(src[4:])
    else:
        rgb, a = jacaranda()
        hsv = cv2.cvtColor(rgb.astype(np.float32) / 255, cv2.COLOR_RGB2HSV)
        hsv[..., 0] += 6; hsv[..., 1] = np.clip(hsv[..., 1] * 1.2, 0, 1); hsv[..., 2] = np.clip(hsv[..., 2] * 1.2, 0, 1)
        rgb = (cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB) * 255).astype(np.uint8)
    lab, n = nd.label(a > 0.35)
    out = []
    for k, sl in enumerate(nd.find_objects(lab)):
        if sl is None: continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h * w < 3000: continue
        pad = 6
        y0, y1 = max(0, sl[0].start - pad), min(a.shape[0], sl[0].stop + pad)
        x0, x1 = max(0, sl[1].start - pad), min(a.shape[1], sl[1].stop + pad)
        m = (lab[y0:y1, x0:x1] == k + 1)
        m = nd.binary_dilation(m, iterations=3)
        al = a[y0:y1, x0:x1] * m
        c = rgb[y0:y1, x0:x1].astype(np.float32) / 255
        spr = np.dstack([c, al])
        spr = orient(spr)
        if spr is None: continue
        out.append(spr)
    log(species, 'leaf sprites', len(out))
    return out


def orient(spr):
    """rotate a sprite so its main axis is vertical with the petiole (thin end) at the bottom"""
    a = spr[..., 3]
    ys, xs = np.nonzero(a > 0.5)
    if len(xs) < 200: return None
    w = a[ys, xs]
    cx, cy = np.average(xs, weights=w), np.average(ys, weights=w)
    C = np.cov(np.stack([xs - cx, ys - cy]), aweights=w)
    ev, evec = np.linalg.eigh(C)
    ax = evec[:, 1]                                  # main axis (x, y)
    ang = np.degrees(np.arctan2(ax[1], ax[0]))
    H, W = a.shape
    D = int(np.hypot(H, W)) + 4
    M = cv2.getRotationMatrix2D((cx, cy), ang - 90 + 180, 1.0)   # main axis -> vertical
    M[0, 2] += D / 2 - cx; M[1, 2] += D / 2 - cy
    r = cv2.warpAffine(spr, M, (D, D), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    ra = r[..., 3]
    ys, xs = np.nonzero(ra > 0.3)
    r = r[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    ra = r[..., 3]
    # the petiole end has less mass: make it the bottom
    h = ra.shape[0]
    top, bot = ra[:h // 6].sum(), ra[-(h // 6):].sum()
    if bot > top: r = r[::-1, ::-1].copy()
    return r


# ------------------------------------------------------------------ compositing helpers
class Canvas:
    def __init__(self, W, H):
        self.W, self.H = W, H
        self.rgb = np.zeros((H, W, 3), np.float32); self.a = np.zeros((H, W), np.float32)

    def shadow(self, alpha_layer, strength, off, blur):
        """darken what is already painted under a layer about to be painted on top"""
        s = cv2.GaussianBlur(alpha_layer, (0, 0), blur)
        M = np.float32([[1, 0, off[0]], [0, 1, off[1]]])
        s = cv2.warpAffine(s, M, (self.W, self.H))
        self.rgb *= (1 - strength * s)[..., None]

    def over(self, rgb, a):
        self.rgb = rgb * a[..., None] + self.rgb * (1 - a[..., None])
        self.a = a + self.a * (1 - a)


def place_sprite(cv, spr, base, angle, length, squash, tint, shade, rng, shadow=0.35):
    """paint a leaf sprite with its petiole base at `base` (px), pointing `angle` (rad, 0 = up, +cw),
    scaled to `length` px, width squashed (foreshortening), tinted; before painting, the leaf's soft
    shadow darkens what is already on the canvas under it"""
    h, w = spr.shape[:2]
    s = length / h
    ca, sa = np.cos(angle), np.sin(angle)
    sx, sy = s * squash, s
    A = np.array([[ca * sx, -sa * sy], [sa * sx, ca * sy]], np.float32)
    t = np.array(base, np.float32) - A @ np.array([w / 2, h], np.float32)
    corners = (A @ np.array([[0, 0], [w, 0], [0, h], [w, h]], np.float32).T).T + t
    pad = int(12 * SS)
    x0, y0 = np.floor(corners.min(0)).astype(int) - pad
    x1, y1 = np.ceil(corners.max(0)).astype(int) + pad
    x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, cv.W), min(y1, cv.H)
    if x1 <= x0 or y1 <= y0: return
    M = np.hstack([A, (t - np.array([x0, y0], np.float32))[:, None]])
    lay = cv2.warpAffine(spr, M, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    a = np.clip(lay[..., 3], 0, 1)
    if a.max() <= 0: return
    rgb = np.clip(lay[..., :3] / np.maximum(a[..., None], 1e-4), 0, 1)
    rgb = tint_rgb(rgb, tint) * shade
    sub_rgb, sub_a = cv.rgb[y0:y1, x0:x1], cv.a[y0:y1, x0:x1]
    if shadow > 0:
        sh = cv2.GaussianBlur(a, (0, 0), 3.5 * SS)
        sh = cv2.warpAffine(sh, np.float32([[1, 0, 3 * SS], [0, 1, 5 * SS]]), (x1 - x0, y1 - y0))
        sub_rgb *= (1 - shadow * sh)[..., None]
    cv.rgb[y0:y1, x0:x1] = np.clip(rgb, 0, 1) * a[..., None] + sub_rgb * (1 - a[..., None])
    cv.a[y0:y1, x0:x1] = a + sub_a * (1 - a)


def tint_rgb(rgb, t):
    """t = (hue shift, sat mul, val mul) applied in a cheap YUV-ish way"""
    dh, sm, vm = t
    hsv = cv2.cvtColor(rgb.astype(np.float32), cv2.COLOR_RGB2HSV)
    hsv[..., 0] = (hsv[..., 0] + dh) % 360
    hsv[..., 1] = np.clip(hsv[..., 1] * sm, 0, 1)
    hsv[..., 2] = np.clip(hsv[..., 2] * vm, 0, 1)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)


def draw_stem(cv, pts, w0, w1, col):
    """tapered stem polyline (px) with a lit edge"""
    pts = np.asarray(pts, np.float32)
    n = len(pts)
    lay = np.zeros((cv.H, cv.W, 4), np.float32)
    for i in range(n - 1):
        f = i / max(1, n - 2)
        w = w0 + (w1 - w0) * f
        p, q = pts[i], pts[i + 1]
        c = np.array(col, np.float32) * (0.85 + 0.25 * f)
        cv2.line(lay, tuple(int(v) for v in p * 16), tuple(int(v) for v in q * 16), (float(c[0]), float(c[1]), float(c[2]), 1.0),
                 max(1, int(round(w))), cv2.LINE_AA, shift=4)
    a = lay[..., 3]
    cv.over(lay[..., :3] / np.maximum(a[..., None], 1e-4), a)


def bezier(p0, p1, p2, n=24):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2


# ------------------------------------------------------------------ species twigs
STEM = {'plane': (0.36, 0.30, 0.22), 'locust': (0.30, 0.24, 0.18), 'oak': (0.33, 0.27, 0.21), 'elm': (0.30, 0.25, 0.20), 'linden': (0.40, 0.26, 0.18)}


# branchlet recipes: side shoots, leaves per shoot, leaf length (x cell), leaf angle off the shoot, petiole (x leaf),
# rosette = leaves bunched at shoot tips (oak), stem colour
TWIG = {
    'plane':  dict(ns=(6, 8), nl=(5, 7), L=0.27, ang=(0.5, 1.2), pet=0.15, rosette=False),
    'linden': dict(ns=(6, 8), nl=(6, 8), L=0.22, ang=(0.6, 1.3), pet=0.2, rosette=False),
    'oak':    dict(ns=(5, 7), nl=(7, 9), L=0.25, ang=(0.3, 2.4), pet=0.05, rosette=True),
    'elm':    dict(ns=(6, 8), nl=(9, 12), L=0.18, ang=(0.7, 1.3), pet=0.05, rosette=False),
    'locust': dict(ns=(7, 9), nl=(3, 4), L=0.36, ang=(0.4, 1.2), pet=0.02, rosette=False),
}


def twig(species, sprites, rng, variant):
    """a leafy branchlet: main stem with alternate side shoots, each carrying leaves (photo sprites)"""
    W = H = CELL * SS
    cv = Canvas(W * 2, int(H * 1.5))
    base = np.array([W, H * 1.5 - 2], np.float32)
    R = TWIG[species]
    lean = rng.uniform(-0.2, 0.2)
    tip = base + np.array([np.sin(lean) * H * 0.7, -np.cos(lean) * H * 0.92])
    mid = (base + tip) / 2 + np.array([rng.uniform(-0.1, 0.1) * W, 0])
    main = bezier(base, mid, tip, 32)
    shoots = [(main, 1.0)]
    ns = rng.integers(*R['ns'])
    for sidx in range(ns):
        f = 0.18 + 0.62 * (sidx + rng.uniform(0, 0.6)) / ns
        k = int(f * (len(main) - 1))
        d = main[min(k + 1, len(main) - 1)] - main[max(k - 1, 0)]; a0 = np.arctan2(d[0], -d[1])
        side = 1 if sidx % 2 else -1
        ang = a0 + side * rng.uniform(0.55, 1.0)
        ln = H * rng.uniform(0.3, 0.46) * (1.05 - 0.45 * f)
        e = main[k] + ln * np.array([np.sin(ang), -np.cos(ang)])
        c = (main[k] + e) / 2 + np.array([np.sin(ang - side * 0.5), -np.cos(ang - side * 0.5)]) * ln * 0.12
        shoots.append((bezier(main[k], c, e, 20), 0.6))
    for sh, wgt in shoots[::-1]:
        draw_stem(cv, sh, (6.5 if wgt == 1.0 else 3.5) * SS, 1.8 * SS, STEM[species])
    items = []
    L = H * R['L']
    for sh, wgt in shoots:
        n = rng.integers(*R['nl']) + (2 if wgt == 1.0 else 0)
        for i in range(n):
            if R['rosette']: f = 0.82 + 0.18 * rng.random()
            else: f = 0.2 + 0.8 * (i + rng.uniform(0, 0.5)) / n
            k = min(int(f * (len(sh) - 1)), len(sh) - 1)
            d = sh[min(k + 1, len(sh) - 1)] - sh[max(k - 1, 0)]; a0 = np.arctan2(d[0], -d[1])
            side = 1 if i % 2 else -1
            if R['rosette']: ang = a0 + rng.uniform(-R['ang'][1], R['ang'][1])
            else: ang = a0 + side * rng.uniform(*R['ang'])
            ln = L * rng.uniform(0.7, 1.0) * (1.0 - 0.25 * f if not R['rosette'] else 1.0)
            pb = sh[k] + ln * R['pet'] * np.array([np.sin(ang), -np.cos(ang)])
            items.append((sh[k], pb, ang + rng.uniform(-0.15, 0.15), ln, rng.uniform(0.55, 1.0)))
        # terminal leaf
        d = sh[-1] - sh[-3]; a0 = np.arctan2(d[0], -d[1])
        items.append((sh[-1], sh[-1], a0 + rng.uniform(-0.2, 0.2), L * rng.uniform(0.85, 1.0), rng.uniform(0.7, 1.0)))
    for a0_, pb, ang, ln, sq in items:
        if R['pet'] > 0.1 and np.linalg.norm(pb - a0_) > 2: draw_stem(cv, [a0_, (a0_ + pb) / 2, pb], 1.8 * SS, 1.2 * SS, STEM[species])
    for j in rng.permutation(len(items)):
        a0_, pb, ang, ln, sq = items[j]
        place_sprite(cv, sprites[rng.integers(len(sprites))], pb, ang, ln, sq, (rng.uniform(-6, 6), rng.uniform(0.85, 1.12), 1.0),
                     rng.uniform(0.8, 1.08), rng, shadow=0.3 if species != 'locust' else 0.2)
    return finish(fit(cv, base))


def fit(cv, base):
    """scale the composition about its base so it fits a CELL*SS square with the base at the bottom centre"""
    ys, xs = np.nonzero(cv.a > 0.02)
    W = CELL * SS
    ext_x = max(base[0] - xs.min(), xs.max() - base[0], 1) + 4
    ext_y = max(base[1] - ys.min(), 1) + 4
    k = min(1.0, (W / 2) / ext_x, W / ext_y)
    M = np.float32([[k, 0, W / 2 - k * base[0]], [0, k, (W - 2) - k * base[1]]])
    out = Canvas(W, W)
    out.a = cv2.warpAffine(cv.a, M, (W, W), flags=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
    out.rgb = cv2.warpAffine(cv.rgb * cv.a[..., None], M, (W, W), flags=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR) / np.maximum(out.a[..., None], 1e-4)
    return out


def clump(species, sprites, rng):
    """dense foliage clump (for far LOD cards): many small twig sprays radiating from the centre"""
    W = H = CELL * SS
    cv = Canvas(W, H)
    c = np.array([W / 2, H / 2])
    n, L = {'plane': (170, 0.115), 'locust': (120, 0.17), 'oak': (190, 0.105), 'elm': (360, 0.075), 'linden': (240, 0.095)}[species]
    # lumpy outline: radius varies with angle
    ph = rng.uniform(0, 6.28, 4)
    def rad(a): return 0.36 + 0.05 * np.sin(3 * a + ph[0]) + 0.04 * np.sin(5 * a + ph[1]) + 0.03 * np.sin(7 * a + ph[2])
    items = []
    for i in range(n):
        a = rng.uniform(-np.pi, np.pi)
        f = rng.uniform(0, 1) ** 0.6
        r = f * rad(a) * W
        p = c + r * np.array([np.sin(a), -np.cos(a)])
        out_ang = a + rng.uniform(-0.9, 0.9) if f > 0.35 else rng.uniform(-np.pi, np.pi)   # outer leaves point away
        ln = L * H * rng.uniform(0.75, 1.05)
        items.append((p - 0.5 * ln * np.array([np.sin(out_ang), -np.cos(out_ang)]), out_ang, ln, f))
    items.sort(key=lambda t: -t[3])                     # outer (further back) first, centre on top
    for p, ang, ln, f in items:
        shade = (0.72 + 0.3 * (1 - f)) * rng.uniform(0.9, 1.08)
        place_sprite(cv, sprites[rng.integers(len(sprites))], p, ang, ln, rng.uniform(0.55, 1.0), (rng.uniform(-5, 5), rng.uniform(0.9, 1.1), 1.0), shade, rng, shadow=0.3)
    return finish(cv)


def finish(cv):
    """downsample the supersampled canvas, bleed colour into transparent texels (clean mips)"""
    a = cv2.resize(cv.a, (CELL, CELL), interpolation=cv2.INTER_AREA)
    rgb = cv2.resize(cv.rgb * cv.a[..., None], (CELL, CELL), interpolation=cv2.INTER_AREA) / np.maximum(a[..., None], 1e-4)
    solid = a > 0.2
    if solid.any():
        idx = nd.distance_transform_edt(~solid, return_distances=False, return_indices=True)
        bled = rgb[tuple(idx)]
        rgb = np.where(solid[..., None], rgb, bled)
        # far-away transparent texels: the average leaf colour (mip-friendly)
        avg = rgb[solid].mean(0)
        far = nd.distance_transform_edt(~solid) > 24
        rgb[far] = avg
    out = np.dstack([np.clip(rgb, 0, 1) * 255, np.clip(a, 0, 1) * 255]).astype(np.uint8)
    return out


LEAF_TARGET = {'plane': (84, 104, 50), 'locust': (106, 130, 50), 'oak': (70, 96, 44), 'elm': (82, 104, 50), 'linden': (74, 100, 46)}


def normalise(sprites, species):
    """scale a species' leaf sprites (float rgba) so their mean colour matches its target (keeps the photo detail)"""
    px = np.concatenate([c[..., :3][c[..., 3] > 0.5].reshape(-1, 3) for c in sprites]).astype(np.float32)
    k = (np.array(LEAF_TARGET[species]) / 255.0) ** 2.2 / np.maximum((px ** 2.2).mean(0), 1e-4)
    return [np.dstack([np.clip((c[..., :3] ** 2.2 * k) ** (1 / 2.2), 0, 1), c[..., 3]]).astype(np.float32) for c in sprites]


def build_atlas(seed=7):
    rng = np.random.default_rng(seed)
    atlas = np.zeros((CELL * len(SPECIES), CELL * 4, 4), np.uint8)
    for si, sp in enumerate(SPECIES):
        spr = normalise(leaf_sprites(sp), sp)
        tw = [twig(sp, spr, rng, v) for v in range(3)]
        cl = clump(sp, spr, rng)
        for j, im in enumerate(tw + [cl]):
            atlas[si * CELL:(si + 1) * CELL, j * CELL:(j + 1) * CELL] = im
    return atlas


def bark_maps(size=512):
    """species -> (albedo rgb uint8, normal rgb uint8), tiling"""
    out = {}
    for sp, asset in BARKS.items():
        d = np.asarray(Image.open(ph_tex(asset, 'diff', '1k', 'Textures')).convert('RGB')).astype(np.float32) / 255
        n = np.asarray(Image.open(ph_tex(asset, 'nor_gl', '1k', 'Textures')).convert('RGB'))
        if sp == 'plane': d = plane_camo(d) * 0.8
        if sp == 'locust': d = d * 0.72
        if sp in ('elm', 'oak'):             # tame the moss, darken
            hsv = cv2.cvtColor(d, cv2.COLOR_RGB2HSV); hsv[..., 1] *= 0.6; d = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB) * (0.62 if sp == 'elm' else 0.8)
        d = cv2.resize(d, (size, size), interpolation=cv2.INTER_AREA)
        n = cv2.resize(n, (size, size), interpolation=cv2.INTER_AREA)
        out[sp] = ((np.clip(d, 0, 1) * 255).astype(np.uint8), n)
    return out


def plane_camo(d):
    """London plane: smooth bark shedding in jigsaw plates -> cream / olive / grey camouflage patches (tiling)"""
    H, W = d.shape[:2]
    rng = np.random.default_rng(3)
    def tile_noise(scale, seed):
        r = np.random.default_rng(seed).random((scale, scale)).astype(np.float32)
        r = np.tile(r, (3, 3))
        r = cv2.resize(r, (W * 3, H * 3), interpolation=cv2.INTER_CUBIC)[H:2 * H, W:2 * W]
        return r
    n1 = tile_noise(13, 1) * 0.55 + tile_noise(29, 2) * 0.3 + tile_noise(71, 3) * 0.15
    n2 = tile_noise(11, 4) * 0.55 + tile_noise(27, 5) * 0.3 + tile_noise(63, 6) * 0.15
    lum = d.mean(-1, keepdims=True)
    detail = d / np.maximum(lum, 1e-3)
    grey = np.array([0.40, 0.39, 0.34]); olive = np.array([0.34, 0.34, 0.24]); cream = np.array([0.62, 0.58, 0.45])
    base = np.where((n1 > 0.58)[..., None], cream, np.where((n2 > 0.55)[..., None], olive, grey))
    base = cv2.GaussianBlur(base.astype(np.float32), (0, 0), 1.2)
    out = base * (0.55 + 0.9 * lum) * (0.8 + 0.2 * detail)
    return np.clip(out * 0.6 + d * 0.4, 0, 1)


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    at = build_atlas()
    Image.fromarray(at).save(os.path.join(out, 'atlas_preview.png'))
    for sp, (d, n) in bark_maps().items(): Image.fromarray(d).save(os.path.join(out, 'bark_%s.png' % sp))
