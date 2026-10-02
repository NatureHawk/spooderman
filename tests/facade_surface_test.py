"""Regression: offset/missed photo windows cannot remain under the new grid."""
import importlib.util
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('facade_detail', Path(__file__).parents[1] / 'tools/scan/facade_detail.py')
fd = importlib.util.module_from_spec(spec); spec.loader.exec_module(fd)

# Photo windows are deliberately shifted outside the replacement window masks,
# including a whole missed row. The previous small-hole inpaint left these intact.
h, w, r = 120, 96, .25
yy, xx = np.indices((h, w)); wall = np.array([178., 154., 131.])
img = np.broadcast_to(wall, (h, w, 3)).copy()
img += (yy[..., None] / h - .5) * 12
old = ((xx % 16) < 7) & ((yy % 16) < 8)
img[old] *= .24
valid = np.ones((h, w), bool)
R = dict(img=img, valid=valid, r=r, tex=(yy.ravel(), xx.ravel(), yy.ravel(), xx.ravel()))
info = dict(type=1, rows=np.arange(3,30,4), cols=np.arange(3,24,4), wU=1.2, wV=1.4,
            Pu=4., Pv=4., frame=wall)
out = np.zeros_like(img, dtype=np.uint8)
fd.inpaint_walls(R, info, out, np.ones((7,6), bool))
before = np.linalg.norm(img[old].mean(0) - img[~old].mean(0))
after = np.linalg.norm(out[old].mean(0) - out[~old].mean(0))
assert after < before * .03, (before, after)
assert np.max(np.abs(out.mean((0,1))-wall)) < 10, out.mean((0,1))
assert np.linalg.norm(out[-8:].mean((0,1))-out[:8].mean((0,1))) > 1, 'Lost broad weathering'
assert out.min() > 80, 'Dark ghost rectangles survived'
print('PASS shifted and missed windows removed, source wall colour and broad weathering retained')

# Actual city repair may only write UV texels of classified wall faces.
tiny = dict(R, tex=(np.array([1]),np.array([2]),np.array([50]),np.array([50])))
atlas = np.full((4,4,3), 23, np.uint8)
fd.inpaint_walls(tiny, info, atlas, None)
assert np.count_nonzero(np.any(atlas != 23, axis=2)) == 1
print('PASS unrelated atlas texels remain untouched')
