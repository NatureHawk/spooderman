"""Pack the facade wall materials (ambientCG 1K sets in source/walltex/acg/<id>/, CC0) into two atlases for
src/03l_buildings.js -> <build>/extra/walltex_albedo.webp, walltex_normal.webp, walltex_meta.json.
  albedo atlas: sRGB colour with ambient occlusion baked in
  normal atlas: R,G = OpenGL tangent normal xy, B = roughness
Layers are TILE px squares on a GRID x GRID grid (the runtime splits them into a texture array). Each material gets:
  kind   brick | ashlar | granite | concrete
  fam    colour family (red, brown, buff, white, grey) from its mean colour
  scale  metres covered by one tile: brick / ashlar from the measured course period (US modular brick course
         2 2/3 in = 0.0677 m, NYC limestone ashlar course ~0.6 m), concrete fixed
  mean   linear mean colour (the runtime tints each building by photo colour / mean)
Usage: python tools/scan/walltex_pack.py [--tile 512]"""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'source', 'walltex', 'acg')
OUT = os.path.join(os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build'), 'extra')
TILE = int(sys.argv[sys.argv.index('--tile') + 1]) if '--tile' in sys.argv else 512
ASHLAR = {'Bricks063', 'Bricks064', 'Bricks065', 'Bricks066', 'Bricks068'}
GRANITE = {'Bricks069'}
COURSE = {'brick': 0.0677, 'ashlar': 0.6, 'granite': 0.6}
CONCRETE_SCALE = {'Concrete007': 2.4, 'Concrete009': 2.4, 'Concrete045': 1.6}
# checked by eye where the course detection locks onto a harmonic (courses counted on the 1K colour map)
MANUAL = {'Bricks019': ('brick', 1.6), 'Bricks060': ('brick', 0.9)}


def lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def course_period(img, lo, hi):
    """vertical period (px) of the mortar courses: the FIRST strong peak (fundamental, not a harmonic) of the
    autocorrelation of the row-mean height, searched in the plausible range [lo, hi] px"""
    L = np.asarray(img.convert('L'), np.float32)
    r = L.mean(1); r = r - r.mean()
    n = len(r); f = np.fft.rfft(r, 2 * n); ac = np.fft.irfft(f * np.conj(f))[:n]
    ac /= ac[0] + 1e-9
    seg = ac[lo:hi]
    pk = [k for k in range(1, len(seg) - 1) if seg[k] >= seg[k - 1] and seg[k] >= seg[k + 1]]
    if not pk: return lo + int(np.argmax(seg)), 0.0
    top = max(seg[k] for k in pk)
    k = next(k for k in pk if seg[k] >= 0.6 * top)
    return lo + k, float(seg[k])


def family(m):
    import colorsys
    r, g, b = (float(v) ** (1 / 2.2) for v in m)            # back to display space for hue / value
    h, sat, v = colorsys.rgb_to_hsv(r, g, b)
    if sat < 0.1: return 'white' if v > 0.62 else 'grey'
    if h < 0.075 and sat > 0.18: return 'red'
    if h < 0.1 or v < 0.45: return 'brown'
    return 'white' if v > 0.68 else 'buff'


def main():
    ids = sorted(d for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d)))
    G = int(np.ceil(np.sqrt(len(ids))))
    A = Image.new('RGB', (G * TILE, G * TILE)); Nm = Image.new('RGB', (G * TILE, G * TILE))
    meta = []
    for i, mid in enumerate(ids):
        p = lambda s: os.path.join(SRC, mid, '%s_1K-JPG_%s.jpg' % (mid, s))
        col = Image.open(p('Color')).convert('RGB')
        nor = Image.open(p('NormalGL')).convert('RGB')
        rough = Image.open(p('Roughness')).convert('L') if os.path.exists(p('Roughness')) else Image.new('L', col.size, 200)
        ao = Image.open(p('AmbientOcclusion')).convert('L') if os.path.exists(p('AmbientOcclusion')) else None
        kind = 'ashlar' if mid in ASHLAR else 'granite' if mid in GRANITE else 'brick' if mid.startswith('Bricks') else 'concrete'
        c = np.asarray(col, np.float32) / 255
        if ao is not None: c = c * (0.35 + 0.65 * np.asarray(ao, np.float32)[..., None] / 255)
        mean = lin(c).reshape(-1, 3).mean(0)
        if mid in MANUAL: kind = MANUAL[mid][0]
        if mid in MANUAL:
            scale, per = MANUAL[mid][1], 'manual'
        elif kind == 'concrete':
            scale, per = CONCRETE_SCALE.get(mid, 3.0), None
        else:
            hgt = Image.open(p('Displacement')).convert('L') if os.path.exists(p('Displacement')) else col
            lo, hi = (14, 130) if kind == 'brick' else (60, 520)
            per, q = course_period(hgt.resize(col.size), lo * col.size[1] // 1024, hi * col.size[1] // 1024)
            scale = COURSE[kind] * col.size[1] / per
        ci = Image.fromarray((np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((TILE, TILE), Image.LANCZOS)
        n = np.asarray(nor.resize((TILE, TILE), Image.LANCZOS)).copy()
        n[..., 2] = np.asarray(rough.resize((TILE, TILE), Image.LANCZOS))
        x, y = (i % G) * TILE, (i // G) * TILE
        A.paste(ci, (x, y)); Nm.paste(Image.fromarray(n), (x, y))
        fam = 'grey' if kind == 'granite' else family(mean)
        meta.append({'id': mid, 'kind': kind, 'fam': fam, 'scale': round(scale, 3), 'mean': [round(float(v), 4) for v in mean]})
        print('%-12s %-8s %-6s scale %.2f m  period %s' % (mid, kind, fam, scale, per))
    os.makedirs(OUT, exist_ok=True)
    A.save(os.path.join(OUT, 'walltex_albedo.webp'), 'WEBP', quality=88, method=6)
    Nm.save(os.path.join(OUT, 'walltex_normal.webp'), 'WEBP', quality=92, method=6)
    json.dump({'v': 1, 'tile': TILE, 'grid': G, 'n': len(ids), 'mats': meta,
               'credit': 'Wall materials: ambientCG.com (CC0)'}, open(os.path.join(OUT, 'walltex_meta.json'), 'w'), indent=0)
    print('[walltex] %d materials, atlas %dpx' % (len(ids), G * TILE))


if __name__ == '__main__':
    main()
