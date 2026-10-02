"""THREADLINE — hero landmarks for the scan map (seed MAN).

Downloaded models (Sketchfab, via Blender: textures baked to one image, exported to
source/landmarks/<name>/export.npz as game-space triangles + UVs) replace the NYC DCP building standing at
the landmark's real latitude/longitude. Each model is fitted to that building: rotation + scale +
position are searched so its top-down height map best matches the NYC height map around the site, then it
is cropped to the real footprint (models often ship with a slab of street and neighbours) and gets its own
oriented box colliders.

Outputs: build/landmarks.bin + build/landmarks.json (textures inlined as base64 WebP).
Usage  : python tools/scan/landmarks.py   (after build_nyc.py)
"""
import base64, io, json, os, sys, time
import numpy as np
import cv2
from PIL import Image
from pyproj import Transformer
from scipy import ndimage as nd

sys.path.insert(0, os.path.dirname(__file__))
from build_nyc import building_colliders

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
SRC = os.path.join(ROOT, 'source', 'landmarks')

# name (folder in source/landmarks), real position of the building it replaces, credit
# mode 'anchor2': two model points (x/z after export) pinned on two world points (similarity transform);
#               the model's y = 0 goes to y0
# mode 'anchor': a model point (model_anchor, model x/z after export) pinned on world_anchor, its long axis
#               (pointing away from the anchor into the bulk) along world_dir, fixed scale; cropped to a corridor
# mode 'fit'  : replaces the NYC building at lat/lon; rotation/scale/position fitted to its height map
#      'site' : a capture of a whole site (bridge + surroundings): fitted the same way against everything
#               around it, then cropped to a corridor along the structure's axis, off the real footprints
#      'place': a statue / prop placed at lat/lon, heading (deg from north the model's +Z faces), length (m)
LANDMARKS = [
    {'name': '40_wall_street', 'lat': 40.70696, 'lon': -74.00968, 'tex': 'bake.png',
     'credit': '"40 Wall Street - The Trump Building" by augustgamer1808 (Sketchfab, CC-BY)'},
    # both towers pinned on the NYC 'Bridge_Tunnel_Overpass' outline's tower bulges (486 m main span); the
    # model's own tiling materials (materials.json) are kept instead of a bake
    {'name': 'brooklyn_bridge_model', 'mode': 'anchor2', 'lat': 40.7056, 'lon': -73.9961, 'hollow': True,
     'anchors': [((7644.2, 9711.4), (-190.8, -836.5)), ((-5468.0, -4078.6), (158.6, -1174.3))], 'y0': -3.0,
     'credit': '"Brooklyn Bridge" by krprom (Sketchfab, CC-BY)'},
    {'name': 'charging_bull', 'mode': 'place', 'lat': 40.70558, 'lon': -74.01344, 'heading': 210.0, 'length': 6.1,
     'tex': 'textures/material_baseColor.jpeg', 'texmax': 1024,
     'credit': '"Charging Bull" by rodrigogelmi (Sketchfab, CC-BY)'},
]


def log(*a): print('[landmark]', *a, flush=True)


def heightmap(T, x0, z0, W, H, res, rng):
    """top-surface height map of triangles over [x0, x0+W*res) x [z0, z0+H*res)"""
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    ar = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    n = np.clip(np.ceil(ar / (res * res) * 2), 2, 6000).astype(int)
    ii = np.repeat(np.arange(len(T)), n)
    a = rng.random((len(ii), 1)); b = rng.random((len(ii), 1)); m = (a + b) > 1; a[m] = 1 - a[m]; b[m] = 1 - b[m]
    p = T[ii, 0] + e1[ii] * a + e2[ii] * b
    c = ((p[:, 0] - x0) / res).astype(int); r = ((p[:, 2] - z0) / res).astype(int)
    ok = (c >= 0) & (c < W) & (r >= 0) & (r < H)
    hm = np.zeros(H * W, np.float32)
    np.maximum.at(hm, r[ok] * W + c[ok], p[ok, 1])
    return hm.reshape(H, W)


def xf(T, th, s, tx=0.0, tz=0.0):
    c, sn = np.cos(th), np.sin(th)
    X, Z = T[..., 0], T[..., 2]
    out = T.copy()
    out[..., 0] = s * (c * X - sn * Z) + tx
    out[..., 1] = s * T[..., 1]
    out[..., 2] = s * (sn * X + c * Z) + tz
    return out


def match(I, Tm):
    num = cv2.matchTemplate(I, Tm, cv2.TM_CCORR); tE = float((Tm * Tm).sum())
    I2 = cv2.integral(I * I); h, w = Tm.shape
    wE = (I2[h:, w:] - I2[:-h, w:] - I2[h:, :-w] + I2[:-h, :-w])[:num.shape[0], :num.shape[1]]
    r = num / np.sqrt(tE * np.maximum(wE, 0.3 * tE))
    _, v, _, loc = cv2.minMaxLoc(r)
    return v, loc


def fit(L, mode, Tm, UV, X, Z, ids, x0m, z0m, rc, byid, meta, tri, rng):
    c, r = int((X - x0m) / rc), int((Z - z0m) / rc)
    if mode == 'fit':
        win = ids[max(0, r - 20):r + 21, max(0, c - 20):c + 21]
        cand = [i for i in np.unique(win) if i in byid]
        if not cand: log(L['name'], 'no NYC building near', X, Z); return None, None, None, None
        # the building covering the point, else the most present one in the 10 m window
        bid = int(ids[r, c]) if ids[r, c] in byid else max(cand, key=lambda i: (win == i).sum())
        cx, cz = byid[bid]['x'], byid[bid]['z']
    else:
        bid = None; cx, cz = X, Z
    # NYC height map around the site (all buildings, so the model's bundled neighbours help the fit)
    s0 = L.get('scale0', 1.0)
    R = 180.0 if mode == 'fit' else 520.0
    near = [b for b in meta['buildings'] if abs(b['x'] - cx) < R + 80 and abs(b['z'] - cz) < R + 80]
    TN = np.concatenate([tri(b) for b in near]).astype(np.float64)
    best = None
    coarse = [0.96, 1.0, 1.04] if mode == 'fit' else list(s0 * np.linspace(0.85, 1.15, 7))
    for res, ths, ss in [(2.0 if mode == 'fit' else 4.0, np.radians(np.arange(0, 360, 3)), coarse), (1.0 if mode == 'fit' else 2.0, None, None)]:
        W = H = int(2 * R / res)
        I = np.clip(heightmap(TN, cx - R, cz - R, W, H, res, rng), 0, 320)
        if ths is None:
            ths = best[1] + np.radians(np.arange(-3, 3.01, 0.5)); ss = best[2] * (1 + np.array([-0.02, -0.01, 0, 0.01, 0.02]))
        first = True
        for th in ths:
            for s in ss:
                Tt = xf(Tm, th, s)
                lo = Tt.reshape(-1, 3).min(0); hi = Tt.reshape(-1, 3).max(0)
                w, h = int((hi[0] - lo[0]) / res) + 1, int((hi[2] - lo[2]) / res) + 1
                if w >= W or h >= H: continue
                Tp = np.clip(heightmap(Tt, lo[0], lo[2], w, h, res, rng), 0, 320)
                v, loc = match(I, Tp)
                if best is None or v > best[0] or first:
                    best = (v, th, s, (cx - R + loc[0] * res - lo[0], cz - R + loc[1] * res - lo[2])); first = False
        log('%s  res %.0f m  score %.3f  rot %.1f  scale %.3f' % (L['name'], res, best[0], np.degrees(best[1]), best[2]))
    v, th, s, (tx, tz) = best
    Tw = xf(Tm, th, s, tx, tz)
    cen = Tw.mean(1)
    cc = np.clip(((cen[:, 0] - x0m) / rc).astype(int), 0, ids.shape[1] - 1); rr = np.clip(((cen[:, 2] - z0m) / rc).astype(int), 0, ids.shape[0] - 1)
    if mode == 'fit':
        # crop to the real footprint (+2 m): drops the street slab / neighbours the model came with
        keep = nd.binary_dilation(ids == bid, iterations=4)[rr, cc]
        log('%s -> NYC building %d (h %.0f m)' % (L['name'], bid, byid[bid]['h']))
    else:
        # corridor along the structure: axis from its tall parts (towers / cables), off every real footprint
        hi = cen[cen[:, 1] > 0.45 * cen[:, 1].max()][:, [0, 2]]
        m0 = hi.mean(0); _, _, vt = np.linalg.svd(hi - m0, full_matrices=False); ax = vt[0]
        dperp = np.abs((cen[:, 0] - m0[0]) * ax[1] - (cen[:, 2] - m0[1]) * ax[0])
        onfoot = nd.binary_dilation(np.isin(ids, list(byid)), iterations=4)[rr, cc]
        keep = (dperp < L.get('corridor', 24.0)) & ~onfoot & (cen[:, 1] > 1.5)
        log('%s site fit: axis %s through %s' % (L['name'], np.round(ax, 3), np.round(m0, 1)))
    return Tw[keep], UV[keep], bid, keep


def main():
    t0 = time.time()
    rng = np.random.default_rng(5)
    aff = np.array(json.load(open(os.path.join(os.path.dirname(__file__), 'nyc_affine.json')))['affine'])
    to2263 = Transformer.from_crs('EPSG:4326', 'EPSG:2263', always_xy=True)
    meta = json.load(open(os.path.join(OUT, 'nyc.json'))); raw = open(os.path.join(OUT, 'nyc.bin'), 'rb').read()
    mask = np.load(os.path.join(OUT, 'nyc_mask.npz')); ids = mask['ids']; x0m, z0m, rc = float(mask['x0']), float(mask['z0']), float(mask['rc'])
    byid = {b['id']: b for b in meta['buildings']}
    smeta = json.load(open(os.path.join(OUT, 'scan.json'))); sbin = open(os.path.join(OUT, 'scan.bin'), 'rb').read()
    land = np.frombuffer(sbin, np.uint8, smeta['nx'] * smeta['nz'], smeta['land']).reshape(smeta['nz'], smeta['nx'])
    tri = lambda b: np.frombuffer(raw, np.float32, b['n'] * 9, b['o']).reshape(-1, 3, 3)
    parts, off, out = [], 0, []
    only = set(sys.argv[1:])
    for L in LANDMARKS:
        if L.get('off'): continue
        E, N = to2263.transform(L['lon'], L['lat']); E *= 0.3048; N *= 0.3048
        X, Z = aff[0, 0] * E + aff[0, 1] * N + aff[0, 2], aff[1, 0] * E + aff[1, 1] * N + aff[1, 2]
        mode = L.get('mode', 'fit')
        d = np.load(os.path.join(SRC, L['name'], 'export.npz')); Tm, UV = d['T'].astype(np.float64), d['UV']
        MI = d['MI'] if 'MI' in d else np.zeros(len(Tm), np.int32)
        y_orig = Tm[..., 1].copy()
        Tm[..., 1] -= Tm[..., 1].min()
        mc = Tm.reshape(-1, 3).mean(0); Tm[..., 0] -= mc[0]; Tm[..., 2] -= mc[2]
        if mode == 'anchor2':
            (ma, wa), (mb, wb) = [(np.array(m_) - mc[[0, 2]], np.array(w_)) for m_, w_ in L['anchors']]
            s_ = np.linalg.norm(wb - wa) / np.linalg.norm(mb - ma)
            th = np.arctan2(*(wb - wa)[::-1]) - np.arctan2(*(mb - ma)[::-1])
            c_, sn = np.cos(th), np.sin(th)
            ra = s_ * np.array([c_ * ma[0] - sn * ma[1], sn * ma[0] + c_ * ma[1]])
            Tw = xf(Tm, th, s_, *(wa - ra)); Tw[..., 1] = y_orig * s_ + L.get('y0', 0.0)
            U, bid, keep = UV, None, np.ones(len(Tw), bool)
            log('%s: scale %.5f, rot %.1f deg, top %.0f m' % (L['name'], s_, np.degrees(th), Tw[..., 1].max()))
        elif mode == 'anchor':
            s_ = L['scale']
            a_m = np.array(L['model_anchor']) - mc[[0, 2]]
            cxz = Tm.mean(1)[:, [0, 2]]; cy = Tm.mean(1)[:, 1]
            tall = cxz[(cy > 0.35 * cy.max()) & (np.hypot(*(cxz - a_m).T) > 2.0)]
            _, _, vt = np.linalg.svd(tall - tall.mean(0), full_matrices=False); axm = vt[0]
            if (tall.mean(0) - a_m) @ axm < 0: axm = -axm
            wd = np.array(L['world_dir']) / np.linalg.norm(L['world_dir'])
            th = np.arctan2(wd[1], wd[0]) - np.arctan2(axm[1], axm[0])
            c_, sn = np.cos(th), np.sin(th)
            ra = s_ * np.array([c_ * a_m[0] - sn * a_m[1], sn * a_m[0] + c_ * a_m[1]])
            tx, tz = np.array(L['world_anchor']) - ra
            Tw = xf(Tm, th, s_, tx, tz); Tw[..., 1] += L.get('y0', 0.0)
            # corridor along the axis; drop the capture's water surface, ground, and anything on real footprints
            cen = Tw.mean(1); wa = np.array(L['world_anchor'])
            dperp = np.abs((cen[:, 0] - wa[0]) * wd[1] - (cen[:, 2] - wa[1]) * wd[0])
            cc = np.clip(((cen[:, 0] - x0m) / rc).astype(int), 0, ids.shape[1] - 1); rr = np.clip(((cen[:, 2] - z0m) / rc).astype(int), 0, ids.shape[0] - 1)
            inside = (cen[:, 0] > x0m) & (cen[:, 2] > z0m) & (cen[:, 0] < x0m + ids.shape[1] * rc) & (cen[:, 2] < z0m + ids.shape[0] * rc)
            onfoot = inside & nd.binary_dilation(np.isin(ids, list(byid)), iterations=4)[rr, cc]
            li = ((cen[:, 0] - smeta['ox']) / smeta['cell']).astype(int); lj = ((cen[:, 2] - smeta['oz']) / smeta['cell']).astype(int)
            okl = (li >= 0) & (lj >= 0) & (li < smeta['nx']) & (lj < smeta['nz'])
            onland = np.zeros(len(cen), bool); onland[okl] = land[lj[okl], li[okl]] == 1
            keep = (dperp < L.get('corridor', 22.0)) & ~onfoot & np.where(onland, cen[:, 1] > 2.5, cen[:, 1] > -1.5)
            Tw, U, bid = Tw[keep], UV[keep], None; MI = MI[keep]
            log('%s anchored: rot %.1f deg, tower top %.0f m' % (L['name'], np.degrees(th), Tw[..., 1].max()))
        elif mode == 'place':
            ext = np.ptp(Tm.reshape(-1, 3), 0); s = L['length'] / max(ext[0], ext[2])
            h = np.radians(L['heading']); dE, dN = np.sin(h), np.cos(h)
            dX, dZ = aff[0, 0] * dE + aff[0, 1] * dN, aff[1, 0] * dE + aff[1, 1] * dN
            th = np.arctan2(dX, dZ)                   # the model's +Z onto the heading (xf rotates +Z by -th)
            Tw = xf(Tm, -th, s, X, Z); U = UV; bid = None; keep = np.ones(len(Tw), bool)
            Tw[..., 1] -= Tw[..., 1].min()
        else:
            Tw, U, bid, keep = fit(L, mode, Tm, UV, X, Z, ids, x0m, z0m, rc, byid, meta, tri, rng)
            if Tw is None: continue
            MI = MI[keep]
        hollow = L.get('hollow', False)
        boxes = np.array([bx if hollow else bx + (-1.0,) for bx in building_colliders(Tw, rng, hollow)], np.float32).reshape(-1, 7)
        mfile = os.path.join(SRC, L['name'], 'materials.json')
        mats = json.load(open(mfile)) if os.path.exists(mfile) else [{'tex': L.get('tex', 'bake.png'), 'color': [1, 1, 1]}]
        rec = {'name': L['name'], 'replaces': [bid] if bid is not None else [], 'credit': L['credit'], 'n': int(len(Tw)), 'parts': []}
        for k, m_ in enumerate(mats):
            sel = MI == k
            if not sel.any(): continue
            part = {'n': int(sel.sum()), 'color': [round(float(c_), 3) for c_ in m_.get('color', [1, 1, 1])], 'repeat': bool(np.abs(U[sel]).max() > 1.01)}
            if m_.get('tex'):
                im = Image.open(os.path.join(SRC, L['name'], m_['tex']))
                cut = im.mode in ('RGBA', 'LA', 'P') and np.asarray(im.convert('RGBA'))[..., 3].min() < 128   # cutout (cable webs)
                im = im.convert('RGBA' if cut else 'RGB')
                if max(im.size) > L.get('texmax', 2048): im.thumbnail((L.get('texmax', 2048),) * 2, Image.LANCZOS)
                buf = io.BytesIO(); im.save(buf, 'WEBP', quality=85); part['tex'] = base64.b64encode(buf.getvalue()).decode()
                if cut: part['alpha'] = True
            for key, arr in (('o', Tw[sel].astype(np.float32)), ('uo', U[sel].astype(np.float32))):
                part[key] = off; b_ = arr.tobytes(); parts.append(b_); off += len(b_)
            rec['parts'].append(part)
        rec['bo'] = off; b_ = boxes.tobytes(); parts.append(b_); off += len(b_)
        rec['nb'] = int(len(boxes))
        out.append(rec)
        log('%s: %d tris, %d colliders, h %.0f m, at %.0f %.0f' % (L['name'], len(Tw), len(boxes), Tw[..., 1].max(), Tw[..., 0].mean(), Tw[..., 2].mean()))
    with open(os.path.join(OUT, 'landmarks.bin'), 'wb') as f:
        for p_ in parts: f.write(p_)
    json.dump({'v': 1, 'landmarks': out}, open(os.path.join(OUT, 'landmarks.json'), 'w'), separators=(',', ':'))
    log('%d landmarks, %.2f MB bin, %.1fs' % (len(out), off / 1048576, time.time() - t0))


if __name__ == '__main__':
    main()
