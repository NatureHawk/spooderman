"""THREADLINE — street-life props for the crowd: hot-dog cart (user model src/new-york-hot-dog-cart), brownstone stoop,
bus shelter.  Headless:  blender -b --python tools/hd/life_props.py [-- <build dir>]
Writes (via life_export): <build>/extra/life_models.bin.gz + life_models.json + life_tex_*.webp.
waterfront.py adds its own models to the same file (life_water.build() is called from here when present).

Model frames (game axes: x east, y up, z south), origin on the ground:
  cart     customers on +X, long axis Z (2.0 m), umbrellas over the -X (vendor) side
  stoop    against a wall at x = 0, steps descend towards +X (landing 0.9 m, step 0.45 m), width 1.9 m on Z
  shelter  long axis Z (3.8 m), open towards +X (the street), back panel at -X
"""
import bpy, math, os, sys, zipfile
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import bmesh
from mathutils import Vector, Matrix
import life_export as LX

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUILD = os.environ.get('TL_BUILD_DIR') or os.path.join(ROOT, 'build')
BUILD = BUILD if os.path.isabs(BUILD) else os.path.join(ROOT, BUILD)
if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 1: BUILD = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
EXTRA = os.path.join(BUILD, 'extra')
SRC = os.path.join(BUILD, 'life_src')


def new_col(name):
    c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); return c


def load_img(path, nonc=False):
    img = bpy.data.images.load(path)
    if nonc: img.colorspace_settings.name = 'Non-Color'
    return img


# ------------------------------------------------------------------ hot-dog cart (FBX)
def build_cart():
    zf = os.path.join(ROOT, 'src', 'new-york-hot-dog-cart', 'source', 'hot-dog-cart.zip')
    d = os.path.join(SRC, 'cart'); os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(zf) as z: z.extractall(d)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(d, 'hot-dog-cart.fbx'))
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    col = new_col('cart')
    for o in objs:
        for c in list(o.users_collection): c.objects.unlink(o)
        col.objects.link(o)
        o.parent = None
    bpy.context.view_layer.update()
    # textures: the FBX carries none, assign the base colour (+ opacity for the props sheet)
    for m in bpy.data.materials:
        if m.name not in ('hot-dog', 'props'): continue
        m.use_nodes = True
        nt = m.node_tree; bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = load_img(os.path.join(d, m.name + '_Base_Color.png'))
        nt.links.new(t.outputs['Color'], bs.inputs['Base Color'])
        if m.name == 'props':
            a = nt.nodes.new('ShaderNodeTexImage'); a.image = load_img(os.path.join(d, 'props_Opacity.png'), True)
            nt.links.new(a.outputs['Color'], bs.inputs['Alpha'])
        bs.inputs['Roughness'].default_value = 0.55; bs.inputs['Metallic'].default_value = 0.1
        for l in list(bs.inputs['Normal'].links): nt.links.remove(l)
    # recentre on the body (not the umbrellas): x = body centre, y = body centre, z = 0 ; customers on +X (Blender frame is the model frame already)
    body = [o for o in objs if o.name[:1] in 'abe' and not o.name.startswith('bottle')]
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in body:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    K = 1.25                                                          # the model is a little small for a street cart
    for o in objs:
        o.location = (o.matrix_world.translation - Vector((cx, cy, 0))) * K; o.scale = o.scale * K; o.matrix_parent_inverse = Matrix.Identity(4)
    LX.log('cart body bbox', tuple(round(v, 2) for v in mn), tuple(round(v, 2) for v in mx))


# ------------------------------------------------------------------ brownstone stoop
def build_stoop():
    col = new_col('stoop')
    stone = LX.mat_flat('stoop_stone', LX.srgb(0x6b4636), 0.92)
    cap = LX.mat_flat('stoop_cap', LX.srgb(0x8d7a68), 0.85)
    iron = LX.mat_flat('iron_black', LX.srgb(0x1b1c1e), 0.55, 0.6)
    W = 1.9
    bm = bmesh.new()
    LX.box(bm, (0.5, 0, 0.43), (1.0, W, 0.86))                         # landing block
    LX.box(bm, (1.225, 0, 0.215), (0.45, W, 0.43))                     # step block
    # cheek walls: stepped profile (side view), 14 cm thick
    prof = [(0, 0), (1.78, 0), (1.78, 0.62), (1.02, 0.62), (1.02, 1.08), (0, 1.08)]
    for s in (-1, 1): LX.prism(bm, prof, s * (W / 2 + 0.14) if s > 0 else -(W / 2 + 0.14) - 0.0, s * (W / 2) if s > 0 else -(W / 2))
    LX.add_obj('stoop_stone', bm, stone, col)
    bm = bmesh.new()
    LX.box(bm, (0.5, 0, 0.885), (1.04, W, 0.05)); LX.box(bm, (1.225, 0, 0.445), (0.5, W, 0.05))   # treads
    for s in (-1, 1): LX.box(bm, (0.89, s * (W / 2 + 0.07), 1.1), (1.8, 0.2, 0.04))                 # cheek copings (flat approximation)
    LX.add_obj('stoop_cap', bm, cap, col)
    bm = bmesh.new()
    for s in (-1, 1):
        y = s * (W / 2 + 0.07)
        for k in range(7): LX.cyl(bm, (0.12 + k * 0.26, y, 1.38), 0.013, 0.5, 5)           # balusters on the landing + step
        LX.box(bm, (0.9, y, 1.64), (1.84, 0.035, 0.04))                                      # top rail
        LX.cyl(bm, (1.72, y, 0.85), 0.03, 0.78, 8)                                           # newel
    LX.add_obj('stoop_iron', bm, iron, col)


# ------------------------------------------------------------------ bus shelter
def build_shelter():
    col = new_col('shelter')
    metal = LX.mat_flat('shelter_metal', LX.srgb(0x2c3036), 0.45, 0.7)
    glass = LX.mat_flat('shelter_glass', LX.srgb(0xa8c4cc), 0.1, 0.0, alpha=0.32)
    roof = LX.mat_flat('shelter_roof', LX.srgb(0x3a3f46), 0.5, 0.5)
    ad = LX.mat_flat('shelter_ad', LX.srgb(0xe8e6e0), 0.5, 0.0, emit=(0.9, 0.9, 0.85, 0.6))
    wood = LX.mat_flat('shelter_bench', LX.srgb(0x4a3a2c), 0.7)
    L = 3.8
    bm = bmesh.new()
    for z in (-L / 2, 0, L / 2):                                       # posts
        for x in (-0.75, 0.55): LX.box(bm, (x, z, 1.2), (0.07, 0.07, 2.4))
    LX.box(bm, (-0.75, 0, 0.05), (0.07, L, 0.1)); LX.box(bm, (-0.75, 0, 2.37), (0.07, L, 0.06))   # back rails
    LX.add_obj('shelter_metal', bm, metal, col)
    bm = bmesh.new(); LX.box(bm, (-0.1, 0, 2.5), (1.7, L + 0.3, 0.1)); LX.box(bm, (0.78, 0, 2.43), (0.1, L + 0.3, 0.2))
    LX.add_obj('shelter_roof', bm, roof, col)
    bm = bmesh.new()                                                    # back + side glass
    LX.box(bm, (-0.75, -L / 4, 1.2), (0.03, L / 2 - 0.14, 2.2)); LX.box(bm, (-0.75, L / 4 + 0.45, 1.2), (0.03, L / 2 - 0.6, 2.2))
    LX.box(bm, (-0.1, -L / 2, 1.2), (1.3, 0.03, 2.2)); LX.box(bm, (-0.1, L / 2, 1.2), (1.3, 0.03, 2.2))
    LX.add_obj('shelter_glass', bm, glass, col)
    bm = bmesh.new(); LX.box(bm, (-0.75, L / 4 + 0.05, 1.25), (0.05, 0.9, 1.6)); LX.add_obj('shelter_ad', bm, ad, col)   # lit panel
    bm = bmesh.new(); LX.box(bm, (-0.45, 0.35, 0.45), (0.45, 2.1, 0.06))      # game z = -y: the bench centre sits at z = -0.35
    LX.add_obj('shelter_bench', bm, wood, col)


def preview(names, outdir):
    """workbench renders (3/4 view + side) of every model collection -> <outdir>/<name>.png ; env LIFE_PREVIEW=<dir>"""
    os.makedirs(outdir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'
    sc.render.resolution_x = 900; sc.render.resolution_y = 420
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.62, 0.7)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    for n in names:
        col = bpy.data.collections.get(n)
        if not col: continue
        for c in bpy.data.collections: c.hide_render = (c.name != n)
        mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
        for o in col.all_objects:
            for b in o.bound_box:
                w = o.matrix_world @ Vector(b)
                for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
        ctr = (mn + mx) / 2; ext = max(mx - mn)
        for k, (az, el) in enumerate(((35, 22), (90, 4))):
            a, e = math.radians(az), math.radians(el)
            cam.data.type = 'ORTHO'; cam.data.ortho_scale = ext * 1.15
            cam.location = ctr + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * ext * 3
            cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(outdir, '%s_%d.png' % (n, k))
            bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_cart(); build_stoop(); build_shelter()
    names = ['cart', 'stoop', 'shelter']
    try:
        import life_water
        names += life_water.build(new_col)
    except ImportError:
        pass
    if os.environ.get('LIFE_PREVIEW'): preview(names, os.environ['LIFE_PREVIEW'])
    LX.export(names, EXTRA, tex_px=1024)


main()
