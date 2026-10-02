# THREADLINE: tower crowns + vehicles (run inside Blender after bl_helpers.py)
# Vehicles: length along +X (forward), width Y, height Z, origin at ground center.
# 'slot_body' faces are tinted per-instance at runtime.
import math
PI = math.pi

# ================= TOWER CROWNS (authored for a 20x20 footprint, base z=0) =================
ci = 0
def C(a):
    global ci
    place(a, ci); ci += 1

a = Asset('crown_deco', 'crown')
for (s,h,z) in ((19,6,0),(15,6,6),(11,5,12),(7,4,17)):
    a.box((s,s,h),(0,0,z+h/2), M['slot_primary'])
    a.box((s+0.6,s+0.6,0.5),(0,0,z+h), M['slot_secondary'])
for k in range(4):
    ang = k*PI/2
    a.box((0.6,3.0,8.0),(9.6*math.cos(ang),9.6*math.sin(ang),4.0), M['slot_secondary'], rot=(0,0,ang))
a.cyl(1.6, 16.0, (0,0,21), M['slot_secondary'], seg=8, r2=0.1)
a.sph(0.4,(0,0,37.2),M['red_emit'],seg=6,rings=3)
a.col((19,19,6),(0,0,3)).col((15,15,6),(0,0,9)).col((11,11,5),(0,0,14.5)).col((7,7,4),(0,0,19)).col((2.4,2.4,16),(0,0,29))
a.extra = {'height': 37.4, 'perch':[0,0,37.4]}
C(a)

a = Asset('crown_pyramid', 'crown')
a.box((20,20,2.0),(0,0,1.0), M['slot_secondary'])
a.box((20,20,12),(0,0,8), M['paint_green'], taper=(0.04,0.04))
a.cyl(0.25, 10, (0,0,14), M['steel'], seg=5, r2=0.05)
a.col((20,20,2),(0,0,1)).col((14,14,5),(0,0,4.5)).col((7,7,5),(0,0,9.5)).col((0.5,0.5,10),(0,0,19))
a.extra = {'height': 24, 'perch':[0,0,14.2]}
C(a)

a = Asset('crown_slant', 'crown')
a.tri_prism([(-10,0),(10,0),(10,4),(-10,14)], 20.0, (0,0,0), M['glass'])
a.box((20.4,20.4,0.6),(0,0,0.3), M['slot_secondary'])
a.col((20,20,4),(0,0,2)).col((10,20,5),(-5,0,6.5)).col((5,20,4),(-7.5,0,11))
a.extra = {'height': 14}
C(a)

a = Asset('crown_mech', 'crown')
a.box((12,9,4.5),(-2,1,2.25), M['concrete_dk'])
a.box((6,6,3),(5,-5,1.5), M['concrete'])
for (x,y) in ((-9.5,-9.5),(9.5,-9.5),(9.5,9.5),(-9.5,9.5)):
    a.box((0.5,0.5,9),(x,y,4.5), M['steel_dk'])
for z in (4.5, 9.0):
    a.box((19.5,0.4,0.4),(0,-9.5,z), M['steel_dk']); a.box((19.5,0.4,0.4),(0,9.5,z), M['steel_dk'])
    a.box((0.4,19.5,0.4),(-9.5,0,z), M['steel_dk']); a.box((0.4,19.5,0.4),(9.5,0,z), M['steel_dk'])
for x in (-6,-2,2,6):
    a.box((0.6,0.3,0.3),(x,-9.8,9.3),M['lamp_emit'])
a.col((12,9,4.5),(-2,1,2.25)).col((6,6,3),(5,-5,1.5))
for (x,y) in ((-9.5,-9.5),(9.5,-9.5),(9.5,9.5),(-9.5,9.5)): a.col((0.6,0.6,9),(x,y,4.5))
a.col((20,0.6,0.6),(0,-9.5,9)).col((20,0.6,0.6),(0,9.5,9)).col((0.6,20,0.6),(-9.5,0,9)).col((0.6,20,0.6),(9.5,0,9))
a.extra = {'height': 9.4}
C(a)

a = Asset('crown_dome', 'crown')
a.cyl(9.0, 5.0, (0,0,0), M['slot_primary'], seg=12)
a.cyl(9.4, 0.6, (0,0,5), M['slot_secondary'], seg=12)
a.sph(8.2, (0,0,5.5), M['paint_green'], seg=12, rings=6, scale=(1,1,0.8))
a.cyl(0.6, 6, (0,0,11.5), M['slot_secondary'], seg=6, r2=0.1)
a.col((17,17,5.6),(0,0,2.8)).col((12,12,5),(0,0,8.2)).col((1.2,1.2,6),(0,0,14.5))
a.extra = {'height': 17.5, 'perch':[0,0,17.5]}
C(a)

a = Asset('roof_garden', 'crown')
a.box((6.0,3.0,0.8),(0,0,0.4), M['concrete'])
a.box((5.6,2.6,0.3),(0,0,0.9), M['leaf'])
for x in (-2,0,2): a.sph(0.7,(x,0,1.5),M['leaf2'],seg=6,rings=4)
a.col((6,3,1.2),(0,0,0.6))
C(a)

# ================= VEHICLES =================
vi = 0
def V(a):
    global vi
    place(a, vi); vi += 1

def wheels(a, xs, y, r=0.34, w=0.24):
    for x in xs:
        for s in (-1, 1):
            a.cyl(r, w, (x, s*y + w/2, r), M['rubber'], seg=8, rot=(PI/2,0,0))

def car_body(a, L, W, H, cabin_frac=0.5, cabin_off=-0.1, body_mat=None, cabin_h=None):
    body_mat = body_mat or M['slot_body']
    a.box((L, W, H*0.45), (0,0,0.32+H*0.225), body_mat)
    ch = cabin_h or H*0.5
    a.box((L*cabin_frac, W*0.9, ch), (cabin_off*L, 0, 0.32+H*0.45+ch/2), body_mat, taper=(0.82,0.9))
    # windows
    a.box((L*cabin_frac*0.78, W*0.92, ch*0.62), (cabin_off*L, 0, 0.32+H*0.45+ch*0.45), M['glass_dk'], taper=(0.85,0.95))
    a.box((0.1, W*0.8, 0.14), (L/2, 0, 0.32+H*0.3), M['lamp_emit'])
    a.box((0.1, W*0.8, 0.12), (-L/2, 0, 0.32+H*0.3), M['red_emit'])

a = Asset('car_sedan', 'vehicle')
car_body(a, 4.6, 1.85, 1.45)
wheels(a, (1.45,-1.45), 0.9)
a.col((4.6,1.9,1.5),(0,0,0.75)); a.extra = {'mass': 1400, 'len':4.6, 'wid':1.9}
V(a)

a = Asset('car_taxi', 'vehicle')   # fictional "Metro Cab": orange/teal
car_body(a, 4.8, 1.9, 1.5, body_mat=M['taxi'])
a.box((4.82,1.92,0.18),(0,0,0.95), M['taxi2'])
a.box((0.9,0.35,0.3),(-0.1,0,1.78), M['amberglow_emit'])
wheels(a, (1.5,-1.5), 0.92)
a.col((4.8,1.9,1.6),(0,0,0.8)); a.extra = {'mass': 1450, 'len':4.8, 'wid':1.9}
V(a)

a = Asset('car_police', 'vehicle')
car_body(a, 4.9, 1.9, 1.5, body_mat=M['police'])
a.box((2.0,1.92,0.35),(0.2,0,0.8), M['white'])
a.box((0.35,0.6,0.16),(-0.1,-0.4,1.8), M['red_emit']); a.box((0.35,0.6,0.16),(-0.1,0.4,1.8), M['blue_emit'])
wheels(a, (1.5,-1.5), 0.92)
a.col((4.9,1.9,1.7),(0,0,0.85)); a.extra = {'mass': 1600, 'len':4.9, 'wid':1.9, 'siren':1}
V(a)

a = Asset('van', 'vehicle')
a.box((5.2,2.05,1.9),(-0.4,0,1.3), M['slot_body'])
a.box((1.3,2.0,1.3),(2.5,0,1.0), M['slot_body'], taper=(0.7,1.0))
a.box((0.6,1.9,0.7),(2.2,0,1.6), M['glass_dk'])
a.box((0.1,1.6,0.14),(3.15,0,0.8), M['lamp_emit']); a.box((0.1,1.6,0.14),(-3.0,0,0.8), M['red_emit'])
wheels(a, (2.1,-1.9), 0.98, r=0.38)
a.col((6.2,2.1,2.3),(0,0,1.15)); a.extra = {'mass': 2600, 'len':6.2, 'wid':2.1}
V(a)

a = Asset('ambulance', 'vehicle')
a.box((4.6,2.2,2.3),(-0.7,0,1.5), M['ambul'])
a.box((1.5,2.1,1.5),(2.3,0,1.1), M['ambul'], taper=(0.7,1.0))
a.box((0.6,2.0,0.7),(2.1,0,1.7), M['glass_dk'])
a.box((4.62,2.22,0.3),(-0.7,0,1.3), M['paint_red'])
a.box((0.4,0.5,0.2),(1.4,-0.5,2.75), M['red_emit']); a.box((0.4,0.5,0.2),(1.4,0.5,2.75), M['blue_emit'])
wheels(a, (2.0,-2.0), 1.0, r=0.4)
a.col((6.2,2.2,2.7),(0,0,1.35)); a.extra = {'mass': 3500, 'len':6.2, 'wid':2.2, 'siren':1}
V(a)

a = Asset('bus', 'vehicle')
a.box((12.0,2.55,2.7),(0,0,1.75), M['bus'])
a.box((11.6,2.58,0.9),(0,0,2.2), M['glass_dk'])
a.box((0.1,2.3,1.6),(6.0,0,1.9), M['glass_dk'])
a.box((12.0,2.6,0.3),(0,0,0.5), M['steel_dk'])
a.box((3.0,1.6,0.35),(-2,0,3.2), M['steel'])
a.box((0.1,1.6,0.3),(6.02,0,3.0), M['amberglow_emit'])
wheels(a, (4.2,-3.6), 1.15, r=0.5, w=0.3)
a.col((12.0,2.6,3.3),(0,0,1.65)); a.extra = {'mass': 12000, 'len':12, 'wid':2.6}
V(a)

a = Asset('truck', 'vehicle')
a.box((2.4,2.4,2.5),(3.0,0,1.65), M['slot_body'])
a.box((0.1,2.2,1.0),(4.21,0,2.3), M['glass_dk'])
a.box((5.8,2.5,3.2),(-1.3,0,2.1), M['white'])
a.box((8.6,2.2,0.4),(0,0,0.6), M['steel_dk'])
wheels(a, (3.2,-0.8,-3.2), 1.05, r=0.5, w=0.3)
a.col((8.6,2.5,3.7),(0,0,1.85)); a.extra = {'mass': 9000, 'len':8.6, 'wid':2.5}
V(a)

a = Asset('motorcycle', 'vehicle')
a.cyl(0.32,0.14,(0.75,0.07,0.32),M['rubber'],seg=8,rot=(PI/2,0,0)); a.cyl(0.32,0.14,(-0.75,0.07,0.32),M['rubber'],seg=8,rot=(PI/2,0,0))
a.box((1.2,0.35,0.35),(0,0,0.7), M['slot_body'])
a.box((0.6,0.3,0.2),(-0.3,0,0.95), M['rubber'])
a.beam((0.75,0,0.35),(0.5,0,1.1),0.06,M['chrome']); a.box((0.1,0.7,0.05),(0.5,0,1.1),M['chrome'])
a.col((2.1,0.7,1.2),(0,0,0.6)); a.extra = {'mass': 250, 'len':2.1, 'wid':0.7}
V(a)

a = Asset('boat', 'vehicle')
a.tri_prism([(-4.5,0.2),(3.5,0.2),(5.0,1.6),(-4.5,1.6)], 3.0, (0,0,-0.6), M['white'], rot=None)
a.box((9.4,3.1,0.2),(0.2,0,1.0), M['wood'])
a.box((2.8,2.2,1.6),(-1.2,0,1.9), M['white'])
a.box((2.9,2.3,0.6),(-1.2,0,2.2), M['glass_dk'])
a.box((0.3,0.3,1.4),(-1.2,0,3.4), M['steel'])
a.col((9.4,3.1,1.8),(0,0,0.5)).col((2.8,2.2,2.2),(-1.2,0,2.1)); a.extra = {'mass': 6000, 'len':9.4, 'wid':3.1}
V(a)

a = Asset('train_car', 'vehicle')
a.box((17.6,2.9,3.2),(0,0,2.1), M['chrome'])
a.box((17.0,2.94,1.0),(0,0,2.5), M['glass_dk'])
a.box((17.6,2.95,0.3),(0,0,1.5), M['paint_red'])
for x in (-6.5, 6.5):
    a.box((2.6,2.4,0.6),(x,0,0.3), M['steel_dk'])
a.box((0.1,1.6,0.3),(8.82,0,1.3),M['lamp_emit'])
a.col((17.6,2.9,3.4),(0,0,2.0)); a.extra = {'mass': 30000, 'len':17.6, 'wid':2.9}
V(a)

a = Asset('drone_sup', 'vehicle')   # Meridian suppression drone
a.box((0.6,0.6,0.28),(0,0,0), M['meridian'])
a.sph(0.18,(0.3,0,-0.05),M['visor_emit'],seg=6,rings=3)
for k in range(4):
    ang = PI/4 + k*PI/2
    x, y = 0.55*math.cos(ang), 0.55*math.sin(ang)
    a.beam((0,0,0),(x,y,0.05),0.07,M['meridian_lt'])
    a.cyl(0.26,0.04,(x,y,0.08),M['meridian_lt'],seg=8)
a.box((0.4,0.08,0.08),(0.2,0,-0.2),M['iron'])
a.col((1.3,1.3,0.45),(0,0,0.02)); a.extra = {'mass': 12}
V(a)

a = Asset('drone_carrier', 'vehicle')
a.box((1.8,1.2,0.6),(0,0,0), M['meridian'])
a.box((1.2,0.9,0.7),(0,0,-0.65), M['meridian_acc'])
for k in range(4):
    ang = PI/4 + k*PI/2
    x, y = 1.4*math.cos(ang), 1.0*math.sin(ang)
    a.beam((0,0,0),(x,y,0.2),0.12,M['meridian_lt'])
    a.cyl(0.55,0.06,(x,y,0.25),M['meridian_lt'],seg=10)
a.sph(0.2,(0.9,0,0),M['visor_emit'],seg=6,rings=3)
a.col((3.2,2.4,1.5),(0,0,-0.3)); a.extra = {'mass': 80}
V(a)

a = Asset('lift_drone', 'vehicle')   # hero gadget
a.cyl(0.25,0.18,(0,0,-0.09),M['slot_primary'],seg=8)
a.cyl(0.12,0.05,(0,0,-0.14),M['slot_glow'],seg=8)
for k in range(3):
    ang = k*2*PI/3
    a.beam((0,0,0),(0.35*math.cos(ang),0.35*math.sin(ang),0.05),0.04,M['slot_dark'])
a.extra = {'mass': 2}
V(a)
print('crowns', ci, 'vehicles', vi)
