"""Majority wall colour per building side (seed MAN) -> <build>/extra/wallcol.bin.gz (u8 RGB per nyc.bin triangle, sRGB).
The scan photo on a building carries blotches (shadows of other buildings baked in, missing-data smears, blue tints).
For every building, wall triangles are grouped by facing (8 compass sectors); each side samples its texels in the runtime
atlas (nyc_atlas_walls.webp, else _sharp / plain), area-weighted, and takes the MAJORITY colour: the most populated cell of
a coarse CIELAB histogram (+ its neighbours) over the brighter 60 % of samples (baked shadows / window glass excluded),
then the median of those samples. Blotches are minorities and drop out.
Sides with too few samples take the building's own majority. Roof / floor triangles keep 0 (runtime: photo).
src/03l_buildings.js uses it as the wall colour; the photo only adds a gentle weathering.
Usage: python tools/scan/wall_colors.py"""
import gzip, json, os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
SAMPLES_PER_M2 = 1.5


def srgb_to_lab(c):
    c = c / 255.0
    l = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = l @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def majority(px):
    """majority colour of (n,3) sRGB samples: densest coarse Lab cell (with neighbours) -> median"""
    if len(px) < 8: return np.median(px, 0)
    lab = srgb_to_lab(px.astype(np.float64))
    # baked shadows of neighbouring buildings and dark window glass are not the wall's colour (the game lights and
    # shadows the walls itself): vote among the brighter 60 % only
    keep = lab[:, 0] >= np.percentile(lab[:, 0], 40)
    px, lab = px[keep], lab[keep]
    q = np.stack([np.floor(lab[:, 0] / 8), np.floor(lab[:, 1] / 5), np.floor(lab[:, 2] / 5)], 1).astype(np.int64)
    keys, inv, cnt = np.unique(q, axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()
    # score each cell by itself + its 26 neighbours
    look = {tuple(k): c for k, c in zip(keys, cnt)}
    off = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)]
    score = np.array([sum(look.get((k[0] + a, k[1] + b, k[2] + c), 0) for a, b, c in off) for k in keys])
    best = keys[int(np.argmax(score))]
    sel = np.all(np.abs(q - best) <= 1, axis=1)
    return np.median(px[sel], 0)


def main():
    nyc = json.load(open(os.path.join(OUT, 'nyc.json')))
    B = open(os.path.join(OUT, 'nyc.bin'), 'rb').read()
    name = next(f for f in ('nyc_atlas_walls.webp', 'nyc_atlas_sharp.webp', 'nyc_atlas.webp') if os.path.exists(os.path.join(OUT, f)))
    A = np.asarray(Image.open(os.path.join(OUT, name)).convert('RGB'))
    H, W = A.shape[:2]
    print('[wallcol] atlas', name, W, H)
    rng = np.random.default_rng(7)
    ntri = sum(b['n'] for b in nyc['buildings'])
    out = np.zeros((ntri, 3), np.uint8)
    t0 = 0; nsides = 0
    for b in nyc['buildings']:
        n = b['n']
        T = np.frombuffer(B, np.float32, n * 9, b['o']).reshape(n, 3, 3).astype(np.float64)
        UV = np.frombuffer(B, np.float32, n * 6, b['uo']).reshape(n, 3, 2).astype(np.float64)
        nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        area = np.linalg.norm(nrm, axis=1) * 0.5
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        wall = (np.abs(nrm[:, 1]) < 0.6) & (area > 0.05)
        sector = (np.round(np.arctan2(nrm[:, 2], nrm[:, 0]) / (np.pi / 4)).astype(int)) % 8
        samples = {}
        for k in np.nonzero(wall)[0]:
            m = int(min(400, max(3, area[k] * SAMPLES_PER_M2)))
            r1, r2 = rng.random(m), rng.random(m)
            s = np.sqrt(r1)
            w0, w1, w2 = 1 - s, s * (1 - r2), s * r2
            uv = UV[k, 0] * w0[:, None] + UV[k, 1] * w1[:, None] + UV[k, 2] * w2[:, None]
            x = np.clip((uv[:, 0] * W).astype(int), 0, W - 1)
            y = np.clip(((1 - uv[:, 1]) * H).astype(int), 0, H - 1)       # three.js textures flipY
            samples.setdefault(sector[k], []).append(A[y, x])
        if not samples: t0 += n; continue
        allpx = np.concatenate([np.concatenate(v) for v in samples.values()])
        bmaj = majority(allpx)
        side = {}
        for sec, v in samples.items():
            px = np.concatenate(v)
            side[sec] = majority(px) if len(px) >= 40 else bmaj
            nsides += 1
        for k in np.nonzero(wall)[0]: out[t0 + k] = np.clip(np.round(side[sector[k]]), 1, 255)
        t0 += n
    os.makedirs(os.path.join(OUT, 'extra'), exist_ok=True)
    with gzip.open(os.path.join(OUT, 'extra', 'wallcol.bin.gz'), 'wb') as f: f.write(out.tobytes())
    print('[wallcol] %d triangles, %d building sides' % (ntri, nsides))


if __name__ == '__main__':
    main()
