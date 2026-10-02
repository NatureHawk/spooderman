"""THREADLINE: remove the leftover photogrammetry shards from the scan render (seed MAN).

After the NYC buildings, street kit and tree models replace most of the raw scan, build_scan.py keeps only what
none of them cover: the elevated highways, footbridges, piers and some small structures. Mixed in are tree
canopies the tree detector missed because the photo shows them as shadowed blue-grey foliage (or glass
reflections) rather than green. They render as jagged dark-blue shards floating around parks and the waterfront.

A connected piece of the residual scan (triangles sharing vertices) is treated as junk when it is
  - blue-tinted and dark:  mean texture B - R >= 12 and brightness < 106 (shadowed foliage / glass), and
  - organic:               median sliver ratio < 4 (built structures are long regular strips; shards are blobby).
The highways (neutral grey, bright), the footbridges (bluish but long slivers) and pale structures stay.
Collision boxes that stood only under removed shards are dropped too, so nothing invisible is left behind.

Run after build_scan.py, before landmarks.py (it only rewrites build/scan.json + scan.bin; re-running is a no-op):
    python tools/scan/clean_scan_shards.py [--dry]
New index / box sections are appended to scan.bin; every existing offset (land mask, vertices) stays valid.
"""
import json, os, sys, shutil
import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.abspath(os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build'))
BLUE_MIN, LUM_MAX, SLIVER_MAX, BOX_JUNK = 12.0, 106.0, 4.0, 0.5


def log(*a):
    print('[clean_shards]', *a, flush=True)


def decode(M, B):
    mn = np.array(M['min']); ext = np.array(M['max']) - mn
    T, U, TI, LI = [], [], [], []
    for k, t in enumerate(M['tiles']):
        pos = mn + np.frombuffer(B, np.uint16, t['n'] * 3, t['pos']).reshape(-1, 3) / 65535 * ext
        uv = np.frombuffer(B, np.uint16, t['n'] * 2, t['uv']).reshape(-1, 2) / 65535
        idx = np.frombuffer(B, np.uint16, t['i'], t['idx']).reshape(-1, 3)
        T.append(pos[idx]); U.append(uv[idx]); TI.append(np.full(len(idx), k)); LI.append(idx)
    return np.concatenate(T), np.concatenate(U), np.concatenate(TI), LI


def components(T, eps=0.15):
    keys = np.round(T.reshape(-1, 3) / eps).astype(np.int64)
    _, vid = np.unique(keys, axis=0, return_inverse=True); vid = vid.reshape(-1, 3)
    r = np.repeat(np.arange(len(T)), 3)
    A = coo_matrix((np.ones(len(r)), (r, vid.ravel())), shape=(len(T), vid.max() + 1)).tocsr()
    return connected_components(A @ A.T, directed=False)[1]


def junk_mask(T, U, tex):
    TH, TW = tex.shape[:2]
    bary = np.array([[1 / 3, 1 / 3, 1 / 3], [.7, .15, .15], [.15, .7, .15], [.15, .15, .7], [.5, .5, 0], [0, .5, .5], [.5, 0, .5]])
    uv = np.einsum('kj,tjc->tkc', bary, U)
    col = tex[np.clip(((1 - uv[..., 1]) * TH).astype(int), 0, TH - 1), np.clip((uv[..., 0] * TW).astype(int), 0, TW - 1)].mean(1)
    a = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) / 2
    Lmax = np.max([np.linalg.norm(T[:, (i + 1) % 3] - T[:, i], axis=1) for i in range(3)], axis=0)
    sliver = Lmax ** 2 / np.maximum(4 * a / np.sqrt(3), 1e-9)          # 1 = equilateral, large = long sliver
    lab = components(T); K = lab.max() + 1
    w = np.maximum(a, 1e-9); ws = np.bincount(lab, w, K)
    cm = np.stack([np.bincount(lab, w * col[:, c], K) for c in range(3)], 1) / ws[:, None]
    blue, lum = cm[:, 2] - cm[:, 0], cm.mean(1)
    sl = np.array([np.median(sliver[lab == c]) for c in range(K)])
    bad = (blue >= BLUE_MIN) & (lum < LUM_MAX) & (sl < SLIVER_MAX)
    return bad[lab], a, lab, bad, ws


def footprint(T, a, sel, M, rng):
    """cells (collision grid) touched by the selected triangles, sampled ~4 points per m^2"""
    nx, nz, cs, ox, oz = M['nx'], M['nz'], M['cell'], M['ox'], M['oz']
    out = np.zeros((nz, nx), bool)
    idx = np.nonzero(sel)[0]
    if not len(idx): return out
    n = np.clip(np.ceil(a[idx] * 4), 3, 4000).astype(int); ii = np.repeat(idx, n)
    s, t = rng.random(len(ii)), rng.random(len(ii)); m = s + t > 1; s[m], t[m] = 1 - s[m], 1 - t[m]
    P = T[ii, 0] + (T[ii, 1] - T[ii, 0]) * s[:, None] + (T[ii, 2] - T[ii, 0]) * t[:, None]
    i = np.clip(((P[:, 0] - ox) / cs).astype(int), 0, nx - 1); j = np.clip(((P[:, 2] - oz) / cs).astype(int), 0, nz - 1)
    out[j, i] = True
    return out


def main():
    dry = '--dry' in sys.argv
    jp, bp = os.path.join(OUT, 'scan.json'), os.path.join(OUT, 'scan.bin')
    M = json.load(open(jp)); B = open(bp, 'rb').read()
    tex = np.asarray(Image.open(os.path.join(OUT, 'scan_tex.webp')).convert('RGB')).astype(np.float32)
    T, U, TI, LI = decode(M, B)
    junk, a, lab, bad, ws = junk_mask(T, U, tex)
    log('residual scan: %d triangles in %d pieces; junk: %d pieces, %d triangles (%.0f%% of the area)'
        % (len(T), lab.max() + 1, bad.sum(), junk.sum(), 100 * a[junk].sum() / max(a.sum(), 1e-9)))
    # collision boxes standing only under removed shards
    rng = np.random.default_rng(7)
    fj, fk = footprint(T, a, junk, M, rng), footprint(T, a, ~junk, M, rng)
    only = fj & ~fk
    nb = M['boxes']['n']
    R = np.frombuffer(B, np.int16, nb * 4, M['boxes']['rect']).reshape(-1, 4); H = np.frombuffer(B, np.uint16, nb, M['boxes']['h'])
    keepb = np.ones(nb, bool)
    for k, (x0, z0, x1, z1) in enumerate(R):
        cells = only[z0:z1 + 1, x0:x1 + 1]
        if cells.size and cells.mean() > BOX_JUNK: keepb[k] = False
    log('collision boxes: %d -> %d' % (nb, keepb.sum()))
    if dry or (not junk.any() and keepb.all()):
        log('nothing written' + (' (dry run)' if dry else ' (already clean)')); return
    for f in (jp, bp):                                   # one backup of the uncleaned output
        if not os.path.exists(f + '.preclean'): shutil.copyfile(f, f + '.preclean')
    buf = bytearray(B)
    def put(arr):
        while len(buf) % 4: buf.append(0)
        o = len(buf); buf.extend(arr.tobytes()); return o
    start = 0
    for k, t in enumerate(M['tiles']):
        n = len(LI[k]); keep = ~junk[start:start + n]; start += n
        if keep.all(): continue
        idx = np.ascontiguousarray(LI[k][keep]).astype(np.uint16).ravel()
        t['i'] = int(idx.size); t['idx'] = put(idx) if idx.size else 0
    M['tiles'] = [t for t in M['tiles'] if t['i'] > 0]
    M['boxes'] = {'n': int(keepb.sum()), 'rect': put(np.ascontiguousarray(R[keepb])), 'h': put(np.ascontiguousarray(H[keepb]))}
    M['bytes'] = len(buf); M['shardClean'] = 1
    open(bp, 'wb').write(bytes(buf))
    json.dump(M, open(jp, 'w'), separators=(',', ':'))
    log('wrote %s (%d bytes, %d tiles)' % (bp, len(buf), len(M['tiles'])))


if __name__ == '__main__':
    main()
