"""Rebuild just the wall atlas using the existing measured window records.

Does not change geometry, window layout, roofs, or unclassified facades.
Usage: TL_BUILD_DIR=build python tools/scan/clean_facade_walls.py
"""
import gzip, json, os
import numpy as np
from PIL import Image
import facade_detail as fd


def main():
    N, raw, T, U, bid = fd.load()
    path = lambda name: os.path.join(fd.BD, name)
    meta = json.load(open(path('extra/facade_meta.json')))
    assert meta['stamp'] == fd.stamp(N, raw), 'Window records do not match the city geometry'
    blob = gzip.decompress(open(path('extra/facade_data.bin.gz'), 'rb').read())
    tri = np.frombuffer(blob, np.uint32, meta['ntri'])
    rec = np.frombuffer(blob, np.float32, meta['nrec'] * 4, meta['ntri'] * 4).reshape(-1, 4)
    atlas = np.array(Image.open(path('nyc_atlas.webp')).convert('RGB')); walls = atlas.copy()
    H, W = atlas.shape[:2]
    G = fd.group(T, U, bid, W, H); G['U'] = U
    order = np.argsort(G['fac'], kind='stable'); fs = G['fac'][order]
    starts = np.r_[0, np.nonzero(np.diff(fs))[0] + 1, len(fs)]
    count = 0
    for a, b in zip(starts[:-1], starts[1:]):
        idx = order[a:b]; f = fs[a]
        bases = np.unique(tri[G['w'][idx]])
        if len(bases) != 1 or bases[0] == 0: continue
        base = int(bases[0]) - 1; h0, h1, h2 = rec[base:base+3]
        nC, nR, cB, rB = h1.astype(int)
        C, rows = rec[cB:cB+nC], rec[rB:rB+nR]
        R = fd.rectify(G, f, idx, atlas, meta['texel'] * 1.004)
        if R is None: continue
        info = dict(type=int(h0[3]), Pu=h2[1], Pv=h2[2], frame=rec[base+4, :3]*255,
                    cols=(C[:, 2]+C[:, 3])/2+h0[2]-R['s0'],
                    rows=(rows[:, 2]+rows[:, 3])/2-R['y0'],
                    wU=float(np.median(C[:, 3]-C[:, 2])), wV=float(np.median(rows[:, 3]-rows[:, 2])))
        fd.inpaint_walls(R, info, walls, None)
        count += 1
        if count % 400 == 0: fd.log('cleaned', count, 'facades')
    Image.fromarray(walls).save(path('nyc_atlas_walls.webp'), 'WEBP', quality=90, method=4)
    fd.save_facade_distance_atlas(atlas)
    meta['wallSurface'] = 2
    with open(path('extra/facade_meta.json'), 'w') as fp: json.dump(meta, fp)
    fd.log('cleaned', count, 'facades; preserved existing windows, geometry and untouched photo faces')


if __name__ == '__main__': main()
