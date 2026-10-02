# THREADLINE Blender asset helpers.
# Executed inside Blender via MCP: exec(open(<this file>).read())
# Builds low-poly flat-shaded assets into the "TL_EXPORT" collection.
# Conventions (Blender space, Z-up, meters): asset origin = pivot (base center for props,
# joint for articulated parts). Colliders/sockets are stored as custom props on the root.
import bpy, bmesh, math, json
from mathutils import Vector, Matrix, Euler

COLL_NAME = "TL_EXPORT"

def tl_collection():
    c = bpy.data.collections.get(COLL_NAME)
    if c is None:
        c = bpy.data.collections.new(COLL_NAME)
        bpy.context.scene.collection.children.link(c)
    return c

def tl_mat(name, rgb, emit=False, rough=0.8, metal=0.0):
    """Get/create a material. Names starting with 'slot_' are recolorable at runtime.
    Names containing 'emit' are rendered emissive in the game."""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    col = (rgb[0], rgb[1], rgb[2], 1.0)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = col
        try:
            bsdf.inputs["Roughness"].default_value = rough
            bsdf.inputs["Metallic"].default_value = metal
        except Exception:
            pass
        if emit:
            for key in ("Emission Color", "Emission"):
                if key in bsdf.inputs:
                    bsdf.inputs[key].default_value = col
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = 2.0
    m.diffuse_color = col
    m["tl_rgb"] = list(rgb)
    m["tl_emit"] = 1 if emit else 0
    return m

def hexc(h):
    h = h.lstrip('#')
    r, g, b = int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255
    return (r, g, b)

# Shared material palette (sRGB-ish values; game treats them as sRGB vertex colors)
M = {}
def init_mats():
    P = {
        'concrete': '8d8b86', 'concrete_dk': '5f5e5a', 'steel': '6f7780', 'steel_dk': '3a3f45',
        'iron': '2c2f33', 'paint_yellow': 'd9a521', 'paint_red': 'a8322a', 'paint_green': '3d6b47',
        'brick': '8a4a36', 'brick_dk': '5e3326', 'wood': '7a5a3a', 'wood_dk': '4f3a26',
        'leaf': '3f6e3a', 'leaf2': '5a8a3c', 'trunk': '4d3a2a', 'rubber': '1c1c1e', 'glass': '5f7f95',
        'glass_dk': '2b3c4a', 'white': 'e6e3dc', 'chrome': 'b8bec4', 'cloth_blue': '36507a',
        'cloth_red': '8e3434', 'skin': 'b98a6a', 'hair': '2a1f18', 'taxi': 'e07b24', 'taxi2': '1f8a86',
        'police': '1d2b52', 'ambul': 'e8e6e0', 'bus': '2f6fa8', 'truck': '6a7f5a', 'van': 'c8c6c0',
        'container_a': '9c3b2d', 'container_b': '2e5f8a', 'container_c': '6b8a3a',
        'meridian': '26282c', 'meridian_acc': 'c2462e', 'meridian_lt': '55595f',
        'warden': 'c89a2a', 'warden_dk': '3a3530', 'cable': '2a2a2a', 'tar': '3b3b3d',
        'signal_box': '1f2a22', 'neon_cyan': '4fd8e8', 'neon_amber': 'ffb040',
        'lamp_emit': 'fff1c8', 'red_emit': 'ff3030', 'blue_emit': '3060ff', 'orange_emit': 'ff8a20',
        'tealglow_emit': '40f0e0', 'amberglow_emit': 'ffb030', 'visor_emit': 'ff4a2a',
    }
    for k, v in P.items():
        M[k] = tl_mat('tl_' + k, hexc(v), emit=k.endswith('_emit'))
    # Recolorable slots (heroes / peds / enemies / vehicles)
    for s, v in (('primary', '808080'), ('secondary', '404040'), ('accent', 'c08030'),
                 ('dark', '202226'), ('glow', 'ffffff'), ('skin', 'b98a6a'), ('body', '7090a0')):
        M['slot_' + s] = tl_mat('slot_' + s + ('_emit' if s == 'glow' else ''), hexc(v), emit=(s == 'glow'))

class Asset:
    """Accumulates primitives into one bmesh with per-face material indices."""
    def __init__(self, name, cat='prop'):
        self.name = name
        self.cat = cat
        self.bm = bmesh.new()
        self.mats = []
        self.cols = []     # [cx,cy,cz,hx,hy,hz] in Blender space (converted on export)
        self.socks = {}
        self.extra = {}

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _xf(self, verts, loc, rot):
        R = Euler(rot, 'XYZ').to_matrix().to_4x4() if rot else Matrix.Identity(4)
        T = Matrix.Translation(Vector(loc)) @ R
        bmesh.ops.transform(self.bm, matrix=T, verts=verts)

    def _faces_mat(self, geom, m):
        mi = self._mi(m)
        for f in geom:
            if isinstance(f, bmesh.types.BMFace):
                f.material_index = mi

    def box(self, size, loc, m, rot=None, taper=None):
        """Axis box centered at loc. taper=(sx,sy) scales the top face (for tapered shapes)."""
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        vs = r['verts']
        for v in vs:
            v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
            if taper and v.co.z > 0:
                v.co.x *= taper[0]; v.co.y *= taper[1]
        self._xf(vs, loc, rot)
        faces = list({f for v in vs for f in v.link_faces})
        self._faces_mat(faces, m)
        return self

    def cyl(self, r, h, loc, m, seg=8, rot=None, r2=None, caps=True):
        """Cylinder/cone with base at loc (along +Z before rotation)."""
        r2 = r if r2 is None else r2
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg,
                                    radius1=r, radius2=r2, depth=h)
        vs = res['verts']
        for v in vs:
            v.co.z += h / 2
        self._xf(vs, loc, rot)
        faces = list({f for v in vs for f in v.link_faces})
        self._faces_mat(faces, m)
        return self

    def sph(self, r, loc, m, seg=8, rings=5, scale=(1, 1, 1)):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r)
        vs = res['verts']
        for v in vs:
            v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
        self._xf(vs, loc, None)
        faces = list({f for v in vs for f in v.link_faces})
        self._faces_mat(faces, m)
        return self

    def beam(self, a, b, t, m, t2=None):
        """Square beam from point a to point b with thickness t (t2 = depth)."""
        a = Vector(a); b = Vector(b)
        d = b - a
        L = d.length
        if L < 1e-6:
            return self
        res = bmesh.ops.create_cube(self.bm, size=1.0)
        vs = res['verts']
        t2 = t if t2 is None else t2
        for v in vs:
            v.co.x *= t; v.co.y *= t2; v.co.z = (v.co.z + 0.5) * L
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        T = Matrix.Translation(a) @ q.to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=T, verts=vs)
        faces = list({f for v in vs for f in v.link_faces})
        self._faces_mat(faces, m)
        return self

    def tri_prism(self, pts2d, depth, loc, m, axis='Y', rot=None):
        """Extruded 2D polygon (pts in local XZ plane), extruded along Y by depth, centered."""
        vs_front = [self.bm.verts.new((p[0], -depth / 2, p[1])) for p in pts2d]
        vs_back = [self.bm.verts.new((p[0], depth / 2, p[1])) for p in pts2d]
        faces = []
        faces.append(self.bm.faces.new(list(reversed(vs_front))))
        faces.append(self.bm.faces.new(vs_back))
        n = len(pts2d)
        for i in range(n):
            j = (i + 1) % n
            faces.append(self.bm.faces.new((vs_front[i], vs_front[j], vs_back[j], vs_back[i])))
        self._xf(vs_front + vs_back, loc, rot)
        self._faces_mat(faces, m)
        return self

    def col(self, size, loc):
        self.cols.append([loc[0], loc[1], loc[2], size[0] / 2, size[1] / 2, size[2] / 2])
        return self

    def sock(self, name, loc):
        self.socks[name] = list(loc)
        return self

    def build(self, grid_pos=(0, 0, 0)):
        coll = tl_collection()
        old = bpy.data.objects.get("A_" + self.name)
        if old is not None:
            for ch in list(old.children):
                bpy.data.objects.remove(ch, do_unlink=True)
            bpy.data.objects.remove(old, do_unlink=True)
        oldm = bpy.data.meshes.get("ME_" + self.name)
        if oldm is not None:
            bpy.data.meshes.remove(oldm)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new("ME_" + self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new("A_" + self.name, me)
        coll.objects.link(ob)
        ob.location = grid_pos
        ob["tl_asset"] = 1
        ob["tl_cat"] = self.cat
        ob["tl_cols"] = json.dumps(self.cols)
        ob["tl_socks"] = json.dumps(self.socks)
        ob["tl_extra"] = json.dumps(self.extra)
        # Visualize colliders as wire children (not exported as geometry)
        for i, c in enumerate(self.cols):
            e = bpy.data.objects.new("COL_%s_%d" % (self.name, i), None)
            e.empty_display_type = 'CUBE'
            e.empty_display_size = 1.0
            e.scale = (c[3], c[4], c[5])
            e.location = (c[0], c[1], c[2])
            e.parent = ob
            coll.objects.link(e)
        return ob

ROWS = {'prop': 0, 'struct': 1, 'vehicle': 2, 'hero': 3, 'char': 4, 'boss': 5, 'crown': 6}
def place(asset, idx, spacing=14.0):
    """Build the asset at a layout slot (row by category) so the library is viewable in Blender."""
    row = ROWS.get(asset.cat, 7)
    sp = spacing * (3 if asset.cat in ('struct', 'crown') else 1)
    return asset.build((idx * sp, -row * 40.0, 0))

init_mats()

def look(names, dist=None, rot=(1.1, 0, 0.6), hide_cols=True):
    """Frame the viewport on the given asset names (without the A_ prefix) for review."""
    from mathutils import Vector, Euler
    bpy.context.view_layer.update()
    obs = [bpy.data.objects.get("A_" + n) for n in names]
    obs = [o for o in obs if o]
    if not obs:
        return
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in obs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    for o in bpy.data.objects:
        if o.name.startswith("COL_"):
            o.hide_viewport = hide_cols
    ctr = (lo + hi) / 2
    size = (hi - lo).length
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            r3d = area.spaces[0].region_3d
            r3d.view_location = ctr
            r3d.view_distance = dist or size * 1.1
            r3d.view_rotation = Euler(rot).to_quaternion()
            r3d.view_perspective = 'PERSP'
