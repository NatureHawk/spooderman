# THREADLINE: road vehicles from the models in src/ (sedan, taxi, police, van, ambulance, bus, box truck).
# Headless Blender:  blender.exe -b --python tools/hd/vehicles_import.py [-- only1,only2]
# Output: build/vehicles.bin + build/vehicles.json (asset pack, same format as the heroes pack; names override the procedural
# VEH_* assets) and build/vehicles_tex.json (texture sources, resolved by tools/hd/vehicles_tex.py -> build/veh_tex.json).
# Game convention: vehicle faces +X (Blender), origin on the ground at the centre, wheels as separate sockets [x, up, half-width].
import bpy, bmesh, json, math, os, re, struct, sys, mathutils
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) if '__file__' in globals() else r"C:/Users/PRIYANSHU/Pictures/spooderman"
SRC = ROOT + "/src"
OUT = os.environ.get('TL_BUILD_DIR') or (ROOT + "/build")
_exp = open(ROOT + "/tools/hd/export_tla.py").read().replace('OUT_DIR = r"C:/Users/PRIYANSHU/Pictures/spooderman/build"', 'OUT_DIR = None')
exec(_exp, globals())          # Blob, encode, conv

ONLY = (sys.argv[sys.argv.index('--') + 1].split(',') if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 1 else None)

# ------------------------------------------------------------------ palette (sedan): name -> [r,g,b, slot, emit, rough, metal]  (sRGB)
PAL = {
    'Car Paint - All Colors': [0.62, 0.08, 0.08, 7, 0, 0.28, 0.45],
    'Glass ext': [0.03, 0.04, 0.05, 0, 0, 0.04, 0.3], 'Glass ext-tinted': [0.03, 0.04, 0.05, 0, 0, 0.04, 0.3],
    'Glass - Clear': [0.62, 0.68, 0.74, 0, 0, 0.04, 0.0], 'Glass - Clear - Bumps': [0.78, 0.8, 0.82, 0, 0, 0.1, 0.0],
    'Glass - Red': [0.55, 0.02, 0.03, 0, 0, 0.1, 0.0], 'Glass - Red - Rough': [0.35, 0.02, 0.03, 0, 0, 0.3, 0.0],
    'Headlight Metal': [0.06, 0.06, 0.07, 0, 0, 0.2, 0.9], 'Metal-dark': [0.08, 0.08, 0.09, 0, 0, 0.4, 0.8],
    'Metal - Black - Rough 0.2': [0.04, 0.04, 0.045, 0, 0, 0.3, 0.8], 'Metal - Chrome - Rough': [0.62, 0.62, 0.64, 0, 0, 0.25, 0.95],
    'Plastic ext gloss': [0.025, 0.025, 0.03, 0, 0, 0.35, 0.0], 'Plastic ext matt': [0.03, 0.03, 0.032, 0, 0, 0.7, 0.0],
    'Rubber - Black': [0.02, 0.02, 0.02, 0, 0, 0.85, 0.0], 'tire-low': [0.025, 0.025, 0.027, 0, 0, 0.88, 0.0],
    'interior': [0.2, 0.19, 0.18, 0, 0, 0.85, 0.0], 'car-bottom': [0.1, 0.1, 0.1, 0, 0, 0.8, 0.3],
    'MetalStainlessSteelBrushedElongated005_2K': [0.66, 0.67, 0.7, 0, 0, 0.32, 0.92], 'MetalStainlessSteelBrushedElongated005_2K.001': [0.5, 0.5, 0.52, 0, 0, 0.4, 0.9],
    'suspension-pipe-brakes': [0.2, 0.2, 0.22, 0, 0, 0.5, 0.8], 'engine': [0.12, 0.12, 0.12, 0, 0, 0.6, 0.5],
}

def corner_of(p, c):    # 'FL' etc. relative to centre c with forward = +X, left = +Y
    return ('F' if p.x > c.x else 'R') + ('L' if p.y > c.y else 'R')

SPECS = {
    'sedan': dict(kind='blend', path=SRC + "/generic-sedan-car/source/01-passat-generic-sedan-full-v1.blend", mode='pal', len=4.85, front='-y',
                  drop=r'^(Cube|WGT|Windshield Wiper|spring|shock|engine|escape|frame|suspension|radiator|brake-caliper|honeycomb|center-console|door-.*interior|roof-pillars|wheel-fender|headlights-cover-r\.001)',
                  wheel=r'^(generic-wheel|generic-tire|brake-disc)', wheel_asset='VEH_wheel_car', body_asset='VEH_sedan', hi=15000, mid=5200),
    'nypd': dict(extra=r'^Cube', kind='blend', path=r"C:/Users/PRIYANSHU/AppData/Local/Claude/c--Users-PRIYANSHU-Pictures-spooderman/c14bed24-43f9-450c-b8d3-5705f23d734b/scratchpad/cars/nypd.blend",
                 mode='tex', len=5.4, front='-y', rig='Car Rig', body_asset='VEH_police', wheel_asset='VEH_wheel_cv', hi=12000, mid=4500,
                 drop=r'^(WGT|interior$)', wheel=r'^CrownVic\.Wheel', wheel_extra=r'^CrownVic\.WheelBrake',
                 tex={'body': dict(d='new-york-police-and-taxi/textures/Crown_Vic_NYPD_Body_Color.png', r='new-york-police-and-taxi/textures/Crown_Vic_Body_Roughnes.png', rough=0.4, metal=0.35),
                      'glass': dict(c=[0.05, 0.06, 0.08], rough=0.04, metal=0.4),
                      'interior': dict(d='new-york-police-and-taxi/textures/Crown_Vic_interior_color.png', rough=0.85, metal=0),
                      'backwindow': dict(c=[0.05, 0.06, 0.08], rough=0.04, metal=0.4),
                      'wheel': dict(d='new-york-police-and-taxi/textures/Crown_Vic_Wheel_Color.png', r='new-york-police-and-taxi/textures/Crown_Vic_Wheel_roughnes.png', rough=0.6, metal=0.2, size=512),
                      'brake': dict(d='new-york-police-and-taxi/textures/Crown_Vic_Wheel_Brake_Color.jpg', rough=0.5, metal=0.8, size=256),
                      'red roof light.001': dict(c=[0.9, 0.05, 0.05], rough=0.2, metal=0, flash='red', emit=1), 'white roof light': dict(c=[0.9, 0.92, 1.0], rough=0.2, metal=0, emit=1),
                      'orange roof light': dict(c=[1.0, 0.55, 0.1], rough=0.3, metal=0), 'roof light stand': dict(c=[0.05, 0.05, 0.06], rough=0.5, metal=0.5),
                      'light dark': dict(c=[0.04, 0.04, 0.05], rough=0.5, metal=0.3), 'roof light': dict(c=[0.7, 0.7, 0.72], rough=0.3, metal=0.3),
                      'licence plate': dict(c=[0.8, 0.8, 0.78], rough=0.5, metal=0), 'orange back light': dict(c=[0.8, 0.3, 0.05], rough=0.3, metal=0)}),
    'taxi': dict(kind='blend', path=r"C:/Users/PRIYANSHU/AppData/Local/Claude/c--Users-PRIYANSHU-Pictures-spooderman/c14bed24-43f9-450c-b8d3-5705f23d734b/scratchpad/cars/nypd.blend",
                 mode='tex', len=5.4, front='-y', rig='Car Rig.001', body_asset='VEH_taxi', wheel_asset=None, hi=12000, mid=4500, taxi_sign=True,
                 drop=r'^(WGT|interior)', wheel=r'^CrownVic\.Wheel', wheel_extra=r'^CrownVic\.WheelBrake',
                 tex={'body.001': dict(d='new-york-police-and-taxi/textures/Crown_Vic_Body_Color_taxi.png', r='new-york-police-and-taxi/textures/Crown_Vic_Body_Roughnes.png', rough=0.4, metal=0.35),
                      'glass.001': dict(c=[0.05, 0.06, 0.08], rough=0.04, metal=0.4), 'backwindow': dict(c=[0.05, 0.06, 0.08], rough=0.04, metal=0.4),
                      'interior.001': dict(d='new-york-police-and-taxi/textures/Crown_Vic_interior_color.png', rough=0.85, metal=0),
                      'wheel.001': dict(d='new-york-police-and-taxi/textures/Crown_Vic_Wheel_Color.png', r='new-york-police-and-taxi/textures/Crown_Vic_Wheel_roughnes.png', rough=0.6, metal=0.2, size=512),
                      'brake.001': dict(d='new-york-police-and-taxi/textures/Crown_Vic_Wheel_Brake_Color.jpg', rough=0.5, metal=0.8, size=256),
                      'taxi light': dict(c=[1.0, 0.78, 0.3], rough=0.3, metal=0, emit=0.6), 'taxi light base': dict(c=[0.05, 0.05, 0.05], rough=0.5, metal=0.3)}),
    'ambulance': dict(kind='fbx', path=SRC + "/ambulance/source/Ambulance.fbx", mode='tex', len=5.8, front='auto', body_asset='VEH_ambulance', wheel_asset=None, hi=8000, mid=3500,
                      drop=r'^shd$', tex={'Material #84': dict(d='ambulance/textures/Ambulance_D.png', rough=0.45, metal=0.15), 'Material #243': dict(d='ambulance/textures/Ambulance_D.png', rough=0.45, metal=0.15),
                                          'srodek': dict(c=[0.45, 0.45, 0.45], rough=0.8, metal=0)}),
    'truck': dict(kind='fbx', path=SRC + "/box-truck/source/Truck.fbx", mode='tex', len=6.4, front='auto', body_asset='VEH_truck', wheel_asset=None, hi=14000, mid=5500,
                  tex={'TruckMt': dict(d='box-truck/textures/Cars_geo_TruckMt_BaseColor.png', r='box-truck/textures/Cars_geo_TruckMt_Roughness.png', m='box-truck/textures/Cars_geo_TruckMt_Metallic.png', rough=0.6, metal=0.2),
                       'glassmt': dict(c=[0.02, 0.05, 0.08], rough=0.05, metal=0.3)}),
    'van': dict(kind='obj', path=SRC + "/van-game-asset/source/van.obj", mode='tex', len=4.4, front='auto', body_asset='VEH_van', wheel_asset=None, hi=9000, mid=4000,
                tex={'Material': dict(d='van-game-asset/textures/Material_BaseColor.png', r='van-game-asset/textures/Material_Roughness.png', m='van-game-asset/textures/Material_Metallic.png', rough=0.6, metal=0.1)}),
    'bus': dict(kind='fbx', path=SRC + "/city-bus-rigged-5236/source/RoAZ_5236.fbx", mode='tex', len=10.8, front='auto', body_asset='VEH_bus', wheel_asset='VEH_wheel_bus', hi=12000, mid=5000,
                drop=r'^ShadowPlane', wheel=r'^Wheel_', wheel_ref='Wheel_RL',
                tex={'RoAZ_5236': dict(d='city-bus-rigged-5236/textures/RoAZ_5236_TEXTURE.png', rsmooth='city-bus-rigged-5236/textures/RoAZ_5236_SMOOTH.png', e='city-bus-rigged-5236/textures/RoAZ_5236_EMISSION.png', rough=0.5, metal=0.1),
                     'Roaz5236_Interior': dict(d='city-bus-rigged-5236/textures/Interior_Day.png', rough=0.8, metal=0), 'Roaz5236_IntDoors': dict(c=[0.2, 0.2, 0.22], rough=0.6, metal=0.2),
                     'Mirrors': dict(c=[0.6, 0.62, 0.66], rough=0.2, metal=0.8), 'BusWheel': dict(d='city-bus-rigged-5236/textures/BusWheel.png', rough=0.85, metal=0, size=256)}),
}

# ------------------------------------------------------------------ helpers
def clear():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
        for b in list(coll): coll.remove(b)

def load(spec):
    clear(); p = spec['path']
    if spec['kind'] == 'fbx': bpy.ops.import_scene.fbx(filepath=p)
    elif spec['kind'] == 'obj': bpy.ops.wm.obj_import(filepath=p)
    else:
        with bpy.data.libraries.load(p) as (s, d): d.objects = list(s.objects)
        for o in d.objects:
            if o: bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.update()

def under(o, rig):
    while o:
        if o.name == rig: return True
        o = o.parent
    return False

def baked(o):
    dg = bpy.context.evaluated_depsgraph_get(); eo = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(eo, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(eo.matrix_world)
    n = bpy.data.objects.new(o.name + '_b', me); bpy.context.scene.collection.objects.link(n)
    return n

def bbox(objs):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            for k in range(3): mn[k] = min(mn[k], v.co[k]); mx[k] = max(mx[k], v.co[k])
    return mn, mx

def xform(objs, M):
    for o in objs: o.data.transform(M)

def join(objs, name):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # unify material slots by name so the joined mesh has one slot per material
    bpy.ops.object.join(); o = bpy.context.view_layer.objects.active; o.name = name; return o

def decimate(o, target):
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris <= target: return tris
    m = o.modifiers.new('d', 'DECIMATE'); m.ratio = max(0.02, target / tris); m.use_collapse_triangulate = True
    m.delimit = {'MATERIAL'}
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

def tri_mesh(o, matmap, hard=45.0):
    """-> verts[(co game, n game, mat, None)], uv list, index, groups   (matmap: slot index -> output id)"""
    me = o.data; bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    cos_t = math.cos(math.radians(hard))
    fn = {f.index: f.normal.copy() for f in bm.faces}; fa = {f.index: max(f.calc_area(), 1e-12) for f in bm.faces}
    faces = sorted(bm.faces, key=lambda f: matmap(f.material_index))
    verts, uvs, index, keymap, groups = [], [], [], {}, []
    for f in faces:
        mid = matmap(f.material_index)
        if not groups or groups[-1][2] != mid: groups.append([len(index), 0, mid])
        for l in f.loops:
            v = l.vert
            acc = Vector((0, 0, 0))
            for g in v.link_faces:
                if fn[g.index].dot(fn[f.index]) >= cos_t: acc += fn[g.index] * fa[g.index]
            n = acc.normalized() if acc.length > 1e-12 else fn[f.index]
            uv = tuple(l[uvl].uv) if uvl else (0.0, 0.0)
            key = (v.index, mid, round(n.x, 2), round(n.y, 2), round(n.z, 2), round(uv[0], 4), round(uv[1], 4))
            k = keymap.get(key)
            if k is None:
                k = len(verts); keymap[key] = k; verts.append((v.co.copy(), n, mid, None)); uvs.append(uv)
            index.append(k)
        groups[-1][1] += 3
    bm.free()
    return verts, uvs, index, groups

def mat_key(m): return m.name if m else 'none'

# ------------------------------------------------------------------ main per-vehicle processing
def process(name, spec, blob, man, report):
    load(spec)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.polygons) > 0]
    rig = spec.get('rig')
    if rig:
        ex = re.compile(spec['extra']) if spec.get('extra') else None
        meshes = [o for o in meshes if under(o, rig) or (ex and ex.search(o.name))]
    drop = re.compile(spec.get('drop', r'^$'), re.I); wre = re.compile(spec['wheel']) if spec.get('wheel') else None
    wxr = re.compile(spec['wheel_extra']) if spec.get('wheel_extra') else None
    body_src, wheel_src = [], []
    for o in meshes:
        if drop.search(o.name): continue
        (wheel_src if (wre and (wre.search(o.name) or (wxr and wxr.search(o.name)))) else body_src).append(o)
    body = [baked(o) for o in body_src]; wheels = [baked(o) for o in wheel_src]
    for n_, o in zip([o.name for o in body_src + wheel_src], body + wheels): o['srcname'] = n_
    # ---- orientation: forward -> +X
    allo = body + wheels
    if spec['front'] == 'auto':
        mn, mx = bbox(allo); size = mx - mn
        # long axis -> X
        if size.y > size.x: xform(allo, Matrix.Rotation(math.radians(90), 4, 'Z'))
        if spec.get('flip'): xform(allo, Matrix.Rotation(math.pi, 4, 'Z'))
        mn, mx = bbox(allo)
        cb = [o for o in wheels]
        spec['_front_guess'] = True
    elif rig and wheels:
        # use the wheel layout: front axle (names 'Ft') -> rear axle; rotate about Z so forward = +X
        def ctr(os_):
            c = Vector((0, 0, 0))
            for o in os_: mn, mx = bbox([o]); c += (mn + mx) / 2
            return c / max(1, len(os_))
        fr = ctr([o for o in wheels if '.Ft.' in o['srcname'] and 'Brake' not in o['srcname']]); rr = ctr([o for o in wheels if '.Bk.' in o['srcname'] and 'Brake' not in o['srcname']])
        d = fr - rr; ang = math.atan2(d.y, d.x)
        xform(allo, Matrix.Rotation(-ang, 4, 'Z'))
    else:
        rot = {'-y': 90, '+y': -90, '+x': 0, '-x': 180}[spec['front']]
        xform(allo, Matrix.Rotation(math.radians(rot), 4, 'Z'))
    mn, mx = bbox(allo)
    s = spec['len'] / (mx.x - mn.x); xform(allo, Matrix.Scale(s, 4))
    mn, mx = bbox(allo)
    # centre on x/y (by body), sit on z=0 (lowest wheel / body point)
    bmn, bmx = bbox(body)
    T = Matrix.Translation(Vector((-(bmn.x + bmx.x) / 2, -(bmn.y + bmx.y) / 2, -mn.z))); xform(allo, T)
    mn, mx = bbox(allo)
    # ---- taxi roof sign (the source taxi has none)
    if spec.get('taxi_sign'):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts: v.co = Vector((v.co.x * 0.62, v.co.y * 0.22, v.co.z * 0.16))
        me = bpy.data.meshes.new('taxisign'); bm.to_mesh(me); bm.free()
        top = max(v.co.z for o in body for v in o.data.vertices if abs(v.co.x + 0.1) < 0.5 and abs(v.co.y) < 0.4)
        for sl in ('taxi light base', 'taxi light'): me.materials.append(bpy.data.materials.new(sl))
        for i, p in enumerate(me.polygons): p.material_index = 1 if abs(p.normal.y) > 0.5 else 0
        me.transform(Matrix.Translation(Vector((-0.1, 0, top + 0.07))))
        no = bpy.data.objects.new('taxisign', me); bpy.context.scene.collection.objects.link(no); body.append(no)
    # ---- wheels: sockets + asset
    sockets = []; wasset = None
    if wheels:
        ref = spec.get('wheel_ref')
        # group wheel parts by corner relative to the body centre
        cb = Vector((0, 0, 0))
        corners = {}
        for o in wheels:
            mn_, mx_ = bbox([o]); c = (mn_ + mx_) / 2
            corners.setdefault(corner_of(c, cb), []).append(o)
        cinfo = {}
        for k, os_ in corners.items():
            tire = max(os_, key=lambda o: len(o.data.polygons)) if not ref else next((o for o in os_ if o['srcname'] == ref), os_[0])
            mn_, mx_ = bbox([tire]); cinfo[k] = (mn_ + mx_) / 2
            cinfo[k] = Vector(cinfo[k])
        for k, c in cinfo.items():
            if c.y < 0: sockets.append([round(c.x, 4), round(c.z, 4), round(abs(c.y), 4)])
        # one wheel mesh from the -Y side (outer face toward -Y == game +Z), centred
        pick = [k for k in cinfo if cinfo[k].y < 0][0]
        wparts = corners[pick]
        if ref:   # bus: the rear wheel looks the same on both sides; take the rear pair's -Y wheel
            rr_ = [k for k in cinfo if cinfo[k].y < 0 and cinfo[k].x < 0]; pick = rr_[0] if rr_ else pick; wparts = corners[pick]
        wc = cinfo[pick]
        for o in corners[pick]: o.data.transform(Matrix.Translation(-wc))
        wasset = (corners[pick], wc)
        # wheel radius
        wmn, wmx = bbox(corners[pick]); radius = (wmx.z - wmn.z) / 2
        report.append('%s wheel sockets %s radius %.3f' % (name, sockets, radius))
        sockets_by_x = sorted(set(round(sk[0], 3) for sk in sockets))
        sockets = [[sx, next(sk[1] for sk in sockets if round(sk[0], 3) == sx), next(sk[2] for sk in sockets if round(sk[0], 3) == sx)] for sx in sockets_by_x]
        spec['_radius'] = radius
    # ---- materials -> ids
    def build(objs, aname, budget_hi, budget_mid, is_wheel=False):
        o = join(objs, aname)
        # LODs: hi (budget_hi) then mid
        mats = [m for m in o.data.materials]
        mkeys = [mat_key(m) for m in mats]
        if spec['mode'] == 'pal':
            pal_idx, pal = {}, []
            for k in mkeys:
                p = PAL.get(k) or PAL.get(re.sub(r'\.\d+$', '', k)) or [0.3, 0.3, 0.3, 0, 0, 0.6, 0.3]
                pal_idx[k] = len(pal); pal.append(list(p))
            mm = lambda i: pal_idx[mkeys[min(i, len(mkeys) - 1)]] if mkeys else 0
            tex = None
        else:
            tdefs = spec['tex']; order, tex, pal = [], [], [[0.6, 0.6, 0.6, 0, 0, 0.6, 0.0]]
            ids = {}
            for k in mkeys:
                key = k if k in tdefs else re.sub(r'\.\d+$', '', k)
                if key not in tdefs: report.append('%s: material %s has no texture def, using grey' % (name, k)); tdefs[key] = dict(c=[0.5, 0.5, 0.5], rough=0.7, metal=0.1)
                if key not in ids: ids[key] = len(tex); tex.append(dict(tdefs[key], name=key))
            mm = lambda i: ids[(mkeys[min(i, len(mkeys) - 1)] if mkeys[min(i, len(mkeys) - 1)] in tdefs else re.sub(r'\.\d+$', '', mkeys[min(i, len(mkeys) - 1)]))]
        res = {}
        for lod, tgt in (('hi', budget_hi), ('mid', budget_mid)):
            if lod == 'mid':
                o2 = o.copy(); o2.data = o.data.copy(); bpy.context.scene.collection.objects.link(o2); oo = o2
            else: oo = o
            t = decimate(oo, tgt)
            verts, uvs, index, groups = tri_mesh(oo, mm)
            P = []
            res[lod] = (verts, uvs, index, groups, t)
        return res, pal, tex
    out = {}
    report.append('%s: body objects %d, wheel parts %d, size %.2f x %.2f x %.2f' % (name, len(body), len(wheels), mx.x - mn.x, mx.y - mn.y, mx.z - mn.z))
    bres, bpal, btex = build(body, name + '_body', spec['hi'], spec['mid'])
    wres = wpal = wtex = None
    if wasset and spec.get('wheel_asset'):
        wres, wpal, wtex = build(wasset[0], name + '_wheel', 1100, 450, True)
    # ---- encode
    def put(asset, res, pal, tex, meta_extra=None, textured=False):
        a = {}
        for lod, (verts, uvs, index, groups, t) in res.items():
            # game space conversion happens in encode(); verts hold blender coords
            meta = dict(lod=lod, cat='vehicle', hb=2)
            if meta_extra: meta.update(meta_extra)
            if textured:
                meta['tex'] = [dict(k) for k in tex]; meta['groups'] = groups
            e = encode(asset, verts, index, pal, blob, meta=meta)
            if textured: e['uv'] = blob.add(struct.pack('<%df' % (len(uvs) * 2), *[c for uv in uvs for c in uv]))
            a[lod] = e
            report.append('  %s %s: %d verts, %d tris' % (asset, lod, len(verts), t))
        man['assets'][asset] = a
    textured = spec['mode'] == 'tex'
    put(spec['body_asset'], bres, bpal, btex, dict(wheels=sockets) if sockets else None, textured)
    # wheels meta: encode() writes e['wheels'] through the generic meta update (list of [x, up, half-width])
    if wres:
        put(spec['wheel_asset'], wres, wpal, wtex, None, textured)
    return dict(radius=spec.get('_radius'), sockets=sockets, size=[round(v, 3) for v in (mx - mn)])

def main():
    blob = Blob(); man = dict(version=2, assets={}); report = []; info = {}
    shared_wheel = {}
    names = ONLY or ['sedan', 'nypd', 'taxi', 'ambulance', 'truck', 'van', 'bus']
    for n in names:
        try:
            info[n] = process(n, SPECS[n], blob, man, report)
        except Exception as ex:
            import traceback; traceback.print_exc(); report.append('FAILED %s: %s' % (n, ex))
    # taxi shares the police wheel asset; its body socket list comes from its own processing
    # texture sources for the python texture packer
    texsrc = {}
    for n in names:
        sp = SPECS[n]
        if sp['mode'] == 'tex':
            for k, v in sp['tex'].items():
                texsrc['%s:%s' % (n, k)] = v
    os.makedirs(OUT, exist_ok=True)
    with open(OUT + "/vehicles.bin", "wb") as f: f.write(blob.bytes())
    with open(OUT + "/vehicles.json", "w") as f: json.dump(man, f, separators=(',', ':'))
    with open(OUT + "/vehicles_info.json", "w") as f: json.dump(info, f, indent=1)
    print('\n'.join(report)); print('INFO', json.dumps(info))

main()
