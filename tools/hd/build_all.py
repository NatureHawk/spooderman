# THREADLINE: rebuild the entire HD asset library and tag it for export.
# Usage inside Blender (via MCP), in stages to keep each call short:
#   exec(open(T + "hd/build_all.py").read()); stage_chars()      # heroes, peds, enemies (skinned)
#   stage_rigid(); stage_world(); export_all()
import bpy, json
T = r"C:/Users/PRIYANSHU/Pictures/spooderman/tools/"
for _f in ("bl_helpers.py", "hd/hd_char.py", "hd/hd_heroes.py", "hd/hd_pulse.py", "hd/hd_npc.py", "hd/hd_boss.py",
           "hd/hd_vehicles.py", "hd/hd_vehicles2.py", "hd/hd_props.py", "hd/hd_struct.py", "hd/export_tla.py"):
    exec(open(T + _f).read())

def tag(ob, name, cat, skinned=False):
    ob["tl_name"] = name
    ob["tl_cat"] = cat
    if skinned:
        ob["tl_skinned"] = 1
    return ob

def finalize(name, body, pieces, rig, socks=None):
    objs = [body] + [o for o in pieces if o is not None and o.type == 'MESH' and len(o.data.polygons)]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = "HD_" + name + "_skin"
    if not any(m.type == 'ARMATURE' for m in body.modifiers):
        m = body.modifiers.new("Armature", 'ARMATURE'); m.object = rig
    body.parent = rig
    if socks:
        rig["tl_socks"] = json.dumps({k: list(v) for k, v in socks.items()})
    return tag(body, name, 'char', True)

def stage_chars():
    """Skinned characters: WEAVER, PULSE, 3 pedestrians, 2 Meridian variants."""
    out = []
    body, arm, helm, pack, rig, J = build_weaver()
    back = J['chest'] + Vector((0, 0.135, 0.05))
    socks = {'armUL': back + Vector((-0.1, 0.06, 0.12)), 'armUR': back + Vector((0.1, 0.06, 0.12)),
             'armLL': back + Vector((-0.11, 0.06, -0.08)), 'armLR': back + Vector((0.11, 0.06, -0.08))}
    out.append(finalize("WEAVER", body, arm + [helm, pack], rig, socks))
    parts = build_tension_arm_parts()
    for k, o in parts.items():
        tag(o, "WEAVER_" + k, 'char')
    body, arm, helm, gear, rig, J = build_pulse()
    out.append(finalize("PULSE", body, arm + [helm, gear], rig))
    for kind in ('m', 'f', 'h'):
        body, parts_, rig, J = build_ped(kind, 0)
        out.append(finalize("PED_" + kind, body, parts_, rig))
    for heavy in (False, True):
        body, parts_, helm, rig, J = build_meridian(heavy)
        out.append(finalize("MER_" + ("heavy" if heavy else "base"), body, parts_ + [helm], rig))
    for k, o in build_meridian_gear().items():
        tag(o, "GEAR_" + k, 'char')
    return [o.name for o in out]

def stage_rigid():
    """Boss rigid parts + vehicles."""
    for k, o in build_warden().items():
        tag(o, "WD_" + k, 'boss')
    for k, o in build_all_vehicles().items():
        tag(o, "VEH_" + k, 'vehicle')

def stage_world():
    """Props, structures, crowns, facade kit."""
    for k, o in build_props().items():
        tag(o, "P_" + k, 'prop')
    for k, o in build_structures().items():
        tag(o, "S_" + k, 'struct')
    for k, o in build_crowns().items():
        tag(o, "C_" + k, 'crown')
    for k, o in build_facade_kit().items():
        tag(o, "F_" + k, 'facade')

def cleanup_untagged():
    """Mark leftover HD_ meshes without tl_name as skipped (intermediate pieces)."""
    n = 0
    for o in bpy.data.objects:
        if o.name.startswith("HD_") and o.type == 'MESH' and "tl_name" not in o.keys():
            o["tl_skip"] = 1; n += 1
    return n
