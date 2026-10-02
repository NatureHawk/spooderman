# Preview helpers for review screenshots (not part of export)
import bpy, math
from mathutils import Vector, Euler

def setc(mname, hx):
    m = bpy.data.materials.get(mname)
    if m is None: return
    c = hexc(hx)
    m.diffuse_color = (c[0], c[1], c[2], 1)
    b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if b: b.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1)

PALETTES = {
    'weaver': dict(slot_primary='56606e', slot_secondary='2e343d', slot_accent='d08a28', slot_dark='17191d', slot_glow_emit='ffb030'),
    'pulse': dict(slot_primary='1f6f78', slot_secondary='b0673a', slot_accent='e0e6e8', slot_dark='14181c', slot_glow_emit='40f0e0'),
    'meridian': dict(slot_primary='2a2c30', slot_secondary='55595f', slot_accent='c2462e', slot_dark='151617', slot_glow_emit='ff4a2a'),
}
def palette(name):
    for k, v in PALETTES[name].items(): setc(k, v)

def view(loc, dist, rx=84, rz=-28):
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            r3d = area.spaces[0].region_3d
            r3d.view_location = Vector(loc); r3d.view_distance = dist
            r3d.view_rotation = Euler((math.radians(rx), 0, math.radians(rz))).to_quaternion()
            sp = area.spaces[0]
            sp.shading.type = 'SOLID'; sp.shading.color_type = 'MATERIAL'; sp.shading.light = 'STUDIO'
            sp.overlay.show_bones = False
    for o in bpy.context.view_layer.objects: o.select_set(False)

def only(prefixes):
    """Show only objects whose names start with any prefix (in TL_HIGH)."""
    c = bpy.data.collections.get("TL_HIGH")
    if not c: return
    for o in c.objects:
        o.hide_set(not any(o.name.startswith(p) for p in prefixes))
