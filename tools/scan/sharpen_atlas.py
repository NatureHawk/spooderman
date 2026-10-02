"""Detail pass for the NYC facade atlas: the photo atlas is soft when a building fills the screen, so add local contrast
(unsharp mask on luminance only, no colour shift) and write <build>/nyc_atlas_sharp.webp (build.js prefers it).
Source: nyc_atlas_walls.webp (facade_detail.py: detected windows inpainted out, the game redraws them) when it is at least
as new as nyc_atlas.webp, else the raw nyc_atlas.webp."""
import os, sys
import numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
BD = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
if not os.path.isabs(BD): BD = os.path.join(ROOT, BD)
raw = os.path.join(BD, 'nyc_atlas.webp'); walls = os.path.join(BD, 'nyc_atlas_walls.webp'); dst = os.path.join(BD, 'nyc_atlas_sharp.webp')
src = walls if os.path.exists(walls) and os.path.getmtime(walls) >= os.path.getmtime(raw) else raw
if src == raw and os.path.exists(walls): print('note: nyc_atlas_walls.webp is older than nyc_atlas.webp (re-run facade_detail.py) - using the raw atlas')
im = np.array(Image.open(src).convert('RGB')).astype(np.float32) / 255.0
lab = cv2.cvtColor(im, cv2.COLOR_RGB2LAB)
L = lab[..., 0]
for sigma, amt in ((1.0, 0.45),):       # fine edges (window frames, bricks) + medium structure
    L = L + amt * (L - cv2.GaussianBlur(L, (0, 0), sigma))
lab[..., 0] = np.clip(L, 0, 100)
out = np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB), 0, 1)
Image.fromarray((out * 255).astype(np.uint8)).save(dst, 'WEBP', quality=78, method=4)
print('wrote', dst, 'from', os.path.basename(src), os.path.getsize(dst) // 1024, 'KB')
