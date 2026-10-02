"""python tests/render_post/diff.py a.png b.png [out_heat.png]  -> per-pixel abs diff stats (8-bit sRGB), optional amplified heat map"""
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.int16)
b = np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(np.int16)
d = np.abs(a - b).max(axis=2)
print('pixels>0: %.3f%%  >2: %.3f%%  >8: %.3f%%  max=%d  mean=%.4f' % ((d > 0).mean() * 100, (d > 2).mean() * 100, (d > 8).mean() * 100, d.max(), d.mean()))
if len(sys.argv) > 3:
    Image.fromarray(np.clip(d * 16, 0, 255).astype(np.uint8)).save(sys.argv[3])
