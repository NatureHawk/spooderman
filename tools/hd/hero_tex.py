"""WEAVER textures (Iron Spider model) -> build/hero_tex.json {name: base64 webp}. Run after hd_import_heroes.export_heroes().
Diffuse 2048, normal / ORM (R=AO G=roughness B=metal) at source size; alpha dropped."""
import base64, io, json, os
from PIL import Image
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SRC = os.path.join(ROOT, 'build', 'hero_src', 'weaver')
SETS = {'body': 'Body', 'equip1': 'Equip_01', 'equip2': 'Equip_02', 'head': 'Head', 'weapon': 'Weapon'}
out = {}
def enc(path, q, size=None):
    im = Image.open(path).convert('RGB')
    if size and im.width != size: im = im.resize((size, size), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'WEBP', quality=q, method=6)
    return base64.b64encode(b.getvalue()).decode()
for k, n in SETS.items():
    out['w_%s_d' % k] = enc(os.path.join(SRC, 'T_1036800_%s_D.png' % n), 90, 2048)
    out['w_%s_n' % k] = enc(os.path.join(SRC, 'T_1036800_%s_N.png' % n), 92)
    out['w_%s_o' % k] = enc(os.path.join(SRC, 'T_1036800_%s_ORM.png' % n), 85)
out['w_arm_d'] = enc(os.path.join(SRC, 'T_WP_1036800_Arm_D.png'), 90, 2048)
json.dump(out, open(os.path.join(ROOT, 'build', 'hero_tex.json'), 'w'), separators=(',', ':'))
print({k: round(len(v) * 3 / 4 / 1024) for k, v in out.items()}, 'KB')
