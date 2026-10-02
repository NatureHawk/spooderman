"""Architectural style per NYC building (seed MAN) from NYC PLUTO tax lots -> <build>/extra/bstyle.json.
Each lot centroid (lat/lon) is projected to EPSG:2263, through tools/scan/nyc_affine.json into the scan world, and
matched to the building whose roof triangles contain it (nearest roof within 12 m otherwise). The building takes the
year / class / floors of its largest lot. Style from year built, building class and height:
  0 brick walk-up      low masonry residential (<= 7 floors)
  1 loft               pre-1915 commercial / manufacturing masonry (cast iron + brick, tall windows)
  2 prewar tower       1900-1924 stone / terracotta skyscraper
  3 art deco           1925-1945 setback tower (brick + limestone, vertical piers)
  4 postwar office     1946-1979 office slab (ribbon windows, panels)
  5 glass tower        1980+ office / hotel (curtain wall)
  6 modern residential 1980+ residential (glass + panel / brick mix)
  7 civic              government / institutional / transport
Source: https://data.cityofnewyork.us/resource/64uk-42ks.json (borough MN, cd 101 + 103), saved in source/pluto/.
Usage: python tools/scan/building_styles.py"""
import json, os
import numpy as np
from pyproj import Transformer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
FT = 0.3048
NAMES = ['brick_walkup', 'loft', 'prewar_tower', 'art_deco', 'postwar_office', 'glass_tower', 'modern_res', 'civic']


def classify(year, cls, floors, h):
    c0 = (cls or '?')[0]
    tall = floors >= 9 or h > 36
    if c0 in 'PQTUWYZ' or cls in ('M1', 'M2', 'M3', 'M4', 'M9', 'I1', 'I4', 'I5', 'I6', 'I7', 'I9', 'J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9'):
        return 7
    if year <= 0:   # unknown: guess from height
        return 5 if h > 80 else 2 if h > 40 else 0
    if year >= 1980:
        return 6 if c0 in 'ABCDRS' and floors < 30 and h < 100 else 5
    if year >= 1946:
        return 4 if tall or c0 in 'O' else (6 if c0 in 'DR' else 0)
    if year >= 1925:
        return 3 if tall else (1 if c0 in 'EFKLO' else 0)
    if tall:
        return 2
    return 1 if c0 in 'EFKLOGH' else 0


def main():
    nyc = json.load(open(os.path.join(OUT, 'nyc.json')))
    B = open(os.path.join(OUT, 'nyc.bin'), 'rb').read()
    aff = np.array(json.load(open(os.path.join(os.path.dirname(__file__), 'nyc_affine.json')))['affine'])
    lots = json.load(open(os.path.join(ROOT, 'source', 'pluto', 'pluto_mn01_mn03.json')))
    lots = [l for l in lots if l.get('latitude') and l.get('longitude')]
    tr = Transformer.from_crs('EPSG:4326', 'EPSG:2263', always_xy=True)
    E, N = tr.transform(np.array([float(l['longitude']) for l in lots]), np.array([float(l['latitude']) for l in lots]))
    E, N = E * FT, N * FT
    LX = aff[0, 0] * E + aff[0, 1] * N + aff[0, 2]
    LZ = aff[1, 0] * E + aff[1, 1] * N + aff[1, 2]

    # roof triangles (XZ) per building
    roofs = []
    for bi, b in enumerate(nyc['buildings']):
        T = np.frombuffer(B, np.float32, b['n'] * 9, b['o']).reshape(-1, 3, 3)
        nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        up = np.abs(nrm[:, 1]) > 0.7 * np.linalg.norm(nrm, axis=1) + 1e-9
        roofs.append(T[up][:, :, [0, 2]])
    cx = np.array([b['x'] for b in nyc['buildings']]); cz = np.array([b['z'] for b in nyc['buildings']])

    def inside(tris, p):
        if len(tris) == 0: return False
        a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
        def s(u, v): return (p[0] - v[:, 0]) * (u[:, 1] - v[:, 1]) - (u[:, 0] - v[:, 0]) * (p[1] - v[:, 1])
        d1, d2, d3 = s(a, b), s(b, c), s(c, a)
        neg = (d1 < 0) | (d2 < 0) | (d3 < 0); pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
        return bool(np.any(~(neg & pos)))

    def dist(tris, p):
        if len(tris) == 0: return 1e9
        return float(np.min(np.hypot(tris[..., 0] - p[0], tris[..., 1] - p[1])))

    match = {}
    for li in range(len(lots)):
        p = (LX[li], LZ[li])
        near = np.argsort((cx - p[0]) ** 2 + (cz - p[1]) ** 2)[:12]
        hit = next((int(k) for k in near if inside(roofs[k], p)), None)
        if hit is None:
            k = int(min(near, key=lambda k: dist(roofs[k], p)))
            if dist(roofs[k], p) < 12: hit = k
        if hit is not None: match.setdefault(hit, []).append(li)

    out, counts = {}, [0] * len(NAMES)
    for bi, b in enumerate(nyc['buildings']):
        L = [lots[i] for i in match.get(bi, [])]
        best = max(L, key=lambda l: float(l.get('bldgarea') or 0)) if L else None
        year = int(float(best.get('yearbuilt') or 0)) if best else 0
        cls = best.get('bldgclass', '') if best else ''
        floors = float(best.get('numfloors') or 0) if best else 0
        st = classify(year, cls, floors, b['h'])
        counts[st] += 1
        out[str(b['id'])] = {'s': st, 'y': year, 'c': cls, 'f': round(floors, 1), 'a': (best or {}).get('address', ''), 'lm': bool(best and best.get('landmark'))}
    os.makedirs(os.path.join(OUT, 'extra'), exist_ok=True)
    json.dump({'v': 1, 'names': NAMES, 'b': out}, open(os.path.join(OUT, 'extra', 'bstyle.json'), 'w'), separators=(',', ':'))
    print('[styles] matched %d / %d buildings to lots' % (len(match), len(nyc['buildings'])))
    for n, c in zip(NAMES, counts): print('  %-16s %d' % (n, c))


if __name__ == '__main__':
    main()
