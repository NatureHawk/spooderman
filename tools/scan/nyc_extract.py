"""Extract the NYC Department of City Planning 3D model (2014, per community district, Rhino .3dm, EPSG:2263
feet) into a cache: build/nyc_raw.pkl = {'mesh': {facade|roof|foot|other: [(layer, V ft, F)]}, 'lines': {...}}.
Sources (download + unzip into source/nyc/):
  https://www.nyc.gov/assets/planning/download/zip/data-maps/open-data/nyc-3d-model/nyc_3dmodel_mn01.zip
  https://www.nyc.gov/assets/planning/download/zip/data-maps/open-data/nyc-3d-model/nyc_3dmodel_mn03.zip
Usage: python tools/scan/nyc_extract.py   (needs `pip install rhino3dm`)"""
import os, pickle, time
import numpy as np
import rhino3dm

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DISTRICTS = ('MN01', 'MN03')


def main():
    t = time.time()
    out = {'facade': [], 'roof': [], 'foot': [], 'other': []}
    lines = {}
    for d in DISTRICTS:
        m = rhino3dm.File3dm.Read(os.path.join(ROOT, 'source', 'nyc', 'NYC_3DModel_%s.3dm' % d))
        L = {l.Index: l.FullPath for l in m.Layers}
        for o in m.Objects:
            g, ln = o.Geometry, L[o.Attributes.LayerIndex]
            if isinstance(g, rhino3dm.Brep):
                V, F = [], []
                for f in g.Faces:                         # cached render meshes (rhino3dm can't tessellate)
                    ms = f.GetMesh(rhino3dm.MeshType.Any)
                    if ms is None: continue
                    b = len(V)
                    for k in range(len(ms.Vertices)): p = ms.Vertices[k]; V.append((p.X, p.Y, p.Z))
                    for k in range(len(ms.Faces)):
                        q = ms.Faces[k]
                        F.append((b + q[0], b + q[1], b + q[2]))
                        if q[2] != q[3]: F.append((b + q[0], b + q[2], b + q[3]))
                if not F: continue
                key = 'facade' if 'Facade' in ln else 'roof' if 'RoofTop' in ln else 'foot' if 'FootPrint' in ln else 'other'
                out[key].append((ln, np.array(V), np.array(F, np.int32)))
            elif isinstance(g, rhino3dm.PolylineCurve) and ln.startswith('Linework'):
                lines.setdefault(ln, []).append(np.array([(g.Point(k).X, g.Point(k).Y, g.Point(k).Z) for k in range(g.PointCount)]))
    for k, v in out.items(): print('[nyc]', k, len(v), 'surfaces', sum(len(x[2]) for x in v), 'tris')
    out_dir = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')      # per-agent build dirs
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'nyc_raw.pkl'), 'wb') as f: pickle.dump({'mesh': out, 'lines': lines}, f)
    print('[nyc] extracted in %.1fs' % (time.time() - t))


if __name__ == '__main__':
    main()
