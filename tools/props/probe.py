import bpy, json, sys, importlib.util
p=r'C:/Users/PRIYANSHU/AppData/Roaming/Blender Foundation/Blender/4.3/scripts/addons/blender_mcp.py'
spec=importlib.util.spec_from_file_location('blender_mcp',p); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print('ADDON_CLASSES',[(n) for n in dir(m) if 'Server' in n])
print('PREF_ADDONS',list(bpy.context.preferences.addons.keys()))
