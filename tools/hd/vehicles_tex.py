"""Vehicle textures: resolves the texture sources named in build/vehicles.json (written by vehicles_import.py) into
build/veh_tex.json {key: base64 webp} and rewrites each asset's tex entries to the keys the game reads:
  d = diffuse (sRGB), o = ORM (R ao=1, G roughness, B metal), e = emissive; c = flat colour, rough / metal scalars, flash, emit.
Usage: python tools/hd/vehicles_tex.py"""
import base64, io, json, os, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BD = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
SRC = os.path.join(ROOT, 'src')
man = json.load(open(os.path.join(BD, 'vehicles.json')))
out, cache = {}, {}
def load(rel, size, mode='RGB'):
    k = (rel, size, mode)
    if k not in cache:
        im = Image.open(os.path.join(SRC, rel)).convert(mode)
        if size and max(im.size) != size: im = im.resize((size, size), Image.LANCZOS)
        cache[k] = im
    return cache[k]
def enc(im, q):
    b = io.BytesIO(); im.save(b, 'WEBP', quality=q, method=6); return base64.b64encode(b.getvalue()).decode()
def put(key, im, q=88):
    if key not in out: out[key] = enc(im, q)
    return key
for asset, a in man['assets'].items():
    tex = None
    for lod in a.values():
        if 'tex' in lod: tex = tex or lod['tex']
    if tex is None: continue
    final = []
    for i, t in enumerate(tex):
        size = t.get('size', 2048)
        e = {k: t[k] for k in ('c', 'rough', 'metal', 'emit', 'flash') if k in t}
        base = 'veh_%s_%d' % (asset, i)
        if 'd' in t:
            d = load(t['d'], size); e['d'] = put(base + '_d', d, 86)
            # ORM only when real roughness / metal maps exist
            if any(k in t for k in ('r', 'rsmooth', 'm')):
                osz = min(size, 1024)
                r = load(t['r'], osz, 'L') if 'r' in t else (Image.eval(load(t['rsmooth'], osz, 'L'), lambda v: 255 - v) if 'rsmooth' in t else Image.new('L', (osz, osz), int(255 * t.get('rough', 0.5))))
                m = load(t['m'], osz, 'L') if 'm' in t else Image.new('L', (osz, osz), int(255 * t.get('metal', 0)))
                if r.size != (osz, osz): r = r.resize((osz, osz))
                if m.size != (osz, osz): m = m.resize((osz, osz))
                e['o'] = put(base + '_o', Image.merge('RGB', (Image.new('L', (osz, osz), 255), r, m)), 84)
        if 'e' in t:
            e['e'] = put(base + '_e', load(t['e'], min(size, 1024)), 84)
        final.append(e)
    for lod in a.values():
        if 'tex' in lod: lod['tex'] = final
json.dump(man, open(os.path.join(BD, 'vehicles.json'), 'w'), separators=(',', ':'))
json.dump(out, open(os.path.join(BD, 'veh_tex.json'), 'w'), separators=(',', ':'))
print('textures', len(out), {k: round(len(v) * 0.75 / 1024) for k, v in out.items()}, 'KB')
