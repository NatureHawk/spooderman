# THREADLINE: street + rooftop props (run inside Blender after bl_helpers.py)
import math
PI = math.pi
i = 0
def P(a):
    global i
    place(a, i); i += 1

# ---- Street lamp (tether-able pole) ----
a = Asset('streetlamp', 'prop')
a.cyl(0.12, 7.2, (0,0,0), M['steel_dk'], seg=6, r2=0.08)
a.cyl(0.22, 0.6, (0,0,0), M['steel_dk'], seg=6)
a.beam((0,0,6.9), (1.8,0,7.3), 0.1, M['steel_dk'])
a.box((0.7,0.35,0.18), (2.0,0,7.25), M['steel_dk'])
a.box((0.55,0.28,0.05), (2.0,0,7.14), M['lamp_emit'])
a.col((0.3,0.3,7.4), (0,0,3.7)).col((2.3,0.35,0.35),(1.1,0,7.2))
a.sock('light', (2.0,0,7.0)); a.extra = {'perch': [0,0,7.35]}
P(a)

# ---- Traffic light (pole + mast arm + 2 signal heads). Lamps are overlaid at runtime ----
a = Asset('traffic_light', 'prop')
a.cyl(0.16, 6.5, (0,0,0), M['steel_dk'], seg=6)
a.beam((0,0,6.2), (5.5,0,6.2), 0.14, M['steel_dk'])
a.box((0.4,0.35,1.1), (3.2,0,5.55), M['signal_box'])
a.box((0.4,0.35,1.1), (5.2,0,5.55), M['signal_box'])
a.box((0.35,0.3,0.9), (0,-0.3,3.2), M['signal_box'])
a.col((0.35,0.35,6.6),(0,0,3.3)).col((5.6,0.4,0.4),(2.8,0,6.2)).col((2.4,0.4,1.2),(4.2,0,5.55))
a.sock('head1', (3.2,-0.2,5.55)); a.sock('head2', (5.2,-0.2,5.55)); a.sock('ped', (0,-0.46,3.2))
P(a)

# ---- Trees (2 variants) ----
a = Asset('tree_a', 'prop')
a.cyl(0.18, 3.2, (0,0,0), M['trunk'], seg=6, r2=0.12)
a.sph(1.9, (0,0,4.2), M['leaf'], seg=7, rings=5, scale=(1,1,0.85))
a.sph(1.3, (0.9,0.4,5.2), M['leaf2'], seg=6, rings=4)
a.sph(1.2, (-0.8,-0.5,4.9), M['leaf'], seg=6, rings=4)
a.col((0.4,0.4,3.2),(0,0,1.6)).col((3.4,3.4,2.8),(0,0,4.6))
P(a)
a = Asset('tree_b', 'prop')
a.cyl(0.15, 2.0, (0,0,0), M['trunk'], seg=6)
a.cyl(1.7, 2.6, (0,0,1.6), M['leaf'], seg=7, r2=0.9)
a.cyl(1.2, 2.2, (0,0,3.6), M['leaf2'], seg=7, r2=0.1)
a.col((0.35,0.35,2.0),(0,0,1.0)).col((3.0,3.0,4.2),(0,0,3.7))
P(a)

# ---- Bench ----
a = Asset('bench', 'prop')
for x in (-0.8, 0.8):
    a.box((0.08,0.5,0.45),(x,0,0.225), M['iron'])
a.box((1.9,0.45,0.06),(0,0,0.47), M['wood'])
a.box((1.9,0.06,0.4),(0,0.24,0.75), M['wood'], rot=(0.25,0,0))
a.col((1.9,0.5,0.9),(0,0,0.45))
P(a)

# ---- Hydrant ----
a = Asset('hydrant', 'prop')
a.cyl(0.16, 0.7, (0,0,0), M['paint_red'], seg=8)
a.sph(0.17, (0,0,0.7), M['paint_red'], seg=8, rings=4)
a.cyl(0.07, 0.36, (-0.18,0,0.45), M['paint_red'], seg=6, rot=(0,PI/2,0))
a.col((0.36,0.36,0.85),(0,0,0.42))
P(a)

# ---- Trash bin (throwable) ----
a = Asset('trash_bin', 'prop')
a.cyl(0.3, 0.9, (0,0,0), M['paint_green'], seg=8, r2=0.33)
a.cyl(0.35, 0.08, (0,0,0.9), M['iron'], seg=8)
a.col((0.66,0.66,1.0),(0,0,0.5))
P(a)

# ---- Water tower (classic rooftop) ----
a = Asset('water_tower', 'prop')
for (x,y) in ((-1.4,-1.4),(1.4,-1.4),(1.4,1.4),(-1.4,1.4)):
    a.beam((x,y,0),(x*0.8,y*0.8,3.2),0.16,M['iron'])
a.box((3.4,3.4,0.2),(0,0,3.3), M['iron'])
a.cyl(1.9, 3.6, (0,0,3.4), M['wood'], seg=10)
for z in (4.0, 5.2, 6.4):
    a.cyl(1.95, 0.1, (0,0,z), M['iron'], seg=10)
a.cyl(2.05, 1.6, (0,0,7.0), M['wood_dk'], seg=10, r2=0.1)
a.col((3.2,3.2,3.3),(0,0,1.65)).col((3.8,3.8,5.2),(0,0,5.8))
a.extra = {'perch': [0,0,8.6]}
P(a)

# ---- HVAC unit ----
a = Asset('hvac', 'prop')
a.box((3.0,1.8,1.4),(0,0,0.7), M['concrete'])
a.box((3.1,1.9,0.12),(0,0,1.46), M['steel'])
for x in (-0.75, 0.75):
    a.cyl(0.6, 0.12, (x,0,1.46), M['steel_dk'], seg=10)
    a.box((1.1,0.08,0.06),(x,0,1.6), M['iron'])
a.box((0.25,1.0,0.25),(1.65,0,0.5), M['steel'])
a.col((3.1,1.9,1.6),(0,0,0.8))
P(a)

# ---- Rooftop stair access hut ----
a = Asset('roof_hut', 'prop')
a.box((3.2,4.0,3.0),(0,0,1.5), M['concrete_dk'])
a.box((3.5,4.3,0.2),(0,0,3.1), M['tar'])
a.box((1.1,0.06,2.1),(0,-2.02,1.05), M['iron'])
a.box((0.5,0.5,0.4),(0.8,1.0,3.4), M['steel'])
a.col((3.5,4.3,3.2),(0,0,1.6))
P(a)

# ---- Antenna mast ----
a = Asset('antenna', 'prop')
a.cyl(0.25, 1.0, (0,0,0), M['steel_dk'], seg=6)
a.cyl(0.09, 11.0, (0,0,1), M['steel'], seg=5, r2=0.04)
for z,w in ((4,1.6),(6.5,1.2),(9,0.8)):
    a.beam((-w,0,z),(w,0,z),0.05,M['steel'])
a.sph(0.14,(0,0,12.1), M['red_emit'], seg=6, rings=3)
a.col((0.35,0.35,12.2),(0,0,6.1)).col((3.3,0.2,0.2),(0,0,4))
a.extra = {'perch':[0,0,12.2]}
P(a)

# ---- Billboard frame (panel texture added at runtime on +Y face... front is -Y) ----
a = Asset('billboard', 'prop')
for x in (-3.0, 3.0):
    a.beam((x,0.6,0),(x,0.2,4.2),0.18,M['iron'])
    a.beam((x,0.9,0),(x,0.2,2.6),0.12,M['iron'])
a.box((8.4,0.35,4.0),(0,0,6.2), M['iron'])
a.box((8.6,1.0,0.1),(0,-0.55,4.15), M['steel_dk'])
for x in (-3,0,3):
    a.beam((x,-0.9,8.4),(x,-0.2,8.2),0.06,M['steel_dk'])
    a.box((0.3,0.25,0.15),(x,-1.0,8.35),M['lamp_emit'])
a.col((8.6,0.6,4.2),(0,0,6.2)).col((0.4,0.8,4.2),(-3,0.4,2.1)).col((0.4,0.8,4.2),(3,0.4,2.1))
a.sock('panel', (0,-0.19,6.2)); a.extra = {'panel_size':[8.0,3.7], 'perch':[0,0,8.3]}
P(a)

# ---- Fire escape module (one floor, attached to a wall at y=0 facing -Y) ----
a = Asset('fire_escape', 'prop')
a.box((4.0,1.3,0.08),(0,-0.65,0), M['iron'])
a.box((4.0,0.05,0.05),(0,-1.28,1.0), M['iron'])
a.box((4.0,0.05,0.05),(0,-1.28,0.5), M['iron'])
for x in (-1.95, -0.65, 0.65, 1.95):
    a.box((0.05,0.05,1.0),(x,-1.28,0.5), M['iron'])
for s in range(6):
    t = s/5.0
    a.box((0.9,0.25,0.04),(-1.2+2.2*t,-0.75,0.1+ -1*0+ t*3.4 - 3.4), M['iron'])
a.beam((-1.6,-1.1,-3.4),(1.4,-1.1,0),0.06,M['iron']); a.beam((-1.6,-0.4,-3.4),(1.4,-0.4,0),0.06,M['iron'])
a.col((4.0,1.3,0.3),(0,-0.65,0.0)).col((4.0,0.1,1.05),(0,-1.28,0.55))
a.extra = {'floor_h': 3.4}
P(a)

# ---- Roof vent stack (updraft source) ----
a = Asset('vent_stack', 'prop')
a.box((1.6,1.6,1.8),(0,0,0.9), M['steel'])
a.cyl(0.55, 1.4, (0,0,1.8), M['steel_dk'], seg=10)
a.cyl(0.75, 0.25, (0,0,3.4), M['steel'], seg=10, r2=0.4)
for k in range(4):
    a.beam((0,0,3.2),(0.7*math.cos(k*PI/2),0.7*math.sin(k*PI/2),3.4),0.04,M['steel_dk'])
a.col((1.6,1.6,3.6),(0,0,1.8))
a.extra = {'updraft': 1}
P(a)

# ---- Scaffold bay (4 x 1.2 x 3 m frame with planks) ----
a = Asset('scaffold', 'prop')
for x in (-2,2):
    for y in (0,-1.2):
        a.box((0.06,0.06,3.0),(x,y,1.5), M['steel'])
for z in (0.05, 3.0):
    a.box((4.06,0.06,0.06),(0,0,z), M['steel']); a.box((4.06,0.06,0.06),(0,-1.2,z), M['steel'])
    a.box((0.06,1.26,0.06),(-2,-0.6,z), M['steel']); a.box((0.06,1.26,0.06),(2,-0.6,z), M['steel'])
a.box((4.0,1.1,0.06),(0,-0.6,3.04), M['wood'])
a.beam((-2,-1.2,0),(2,-1.2,3),0.04,M['steel'])
a.box((4.0,0.04,0.04),(0,-1.2,4.0), M['steel']); a.box((0.04,0.04,1.0),(-2,-1.2,3.5), M['steel']); a.box((0.04,0.04,1.0),(2,-1.2,3.5), M['steel'])
a.col((4.1,1.3,0.2),(0,-0.6,3.0)).col((0.2,0.2,4.0),(-2,-1.2,2.0)).col((0.2,0.2,4.0),(2,-1.2,2.0))
P(a)

# ---- Shipping container ----
a = Asset('container', 'prop')
a.box((12.2,2.44,2.6),(0,0,1.3), M['container_a'])
for x in range(-5,6):
    a.box((0.08,2.5,2.5),(x*1.05,0,1.3), M['container_a'])
a.box((0.1,2.3,2.4),(6.1,0,1.3), M['iron'])
a.col((12.2,2.44,2.6),(0,0,1.3))
P(a)

# ---- Factory chimney ----
a = Asset('chimney', 'prop')
a.cyl(2.0, 36, (0,0,0), M['brick'], seg=10, r2=1.3)
for z in (10, 22, 33):
    a.cyl(2.1 - z*0.02, 0.5, (0,0,z), M['brick_dk'], seg=10)
a.cyl(1.4, 1.2, (0,0,36), M['iron'], seg=10)
a.col((3.4,3.4,37),(0,0,18.5))
a.extra = {'updraft': 1, 'perch':[0,0,37.2]}
P(a)

# ---- Pipe rack (industrial) ----
a = Asset('pipe_rack', 'prop')
for x in (-5,0,5):
    a.box((0.3,0.3,5),(x,-1.5,2.5), M['steel_dk']); a.box((0.3,0.3,5),(x,1.5,2.5), M['steel_dk'])
    a.box((0.3,3.3,0.3),(x,0,5), M['steel_dk'])
for y,r,m in ((-1,0.35,'paint_yellow'),(0,0.45,'steel'),(1,0.3,'paint_red')):
    a.cyl(r, 12, (-6,y,5.2+r), M[m], seg=8, rot=(0,PI/2,0))
a.col((12,3.4,1.4),(0,0,5.6))
for x in (-5,0,5): a.col((0.4,3.4,5),(x,0,2.5))
P(a)

# ---- Market stall ----
a = Asset('market_stall', 'prop')
for (x,y) in ((-1.4,-0.9),(1.4,-0.9),(-1.4,0.9),(1.4,0.9)):
    a.box((0.08,0.08,2.4),(x,y,1.2), M['wood_dk'])
a.box((3.0,1.6,0.9),(0,0.1,0.45), M['wood'])
a.box((3.4,2.4,0.08),(0,0,2.45), M['cloth_red'], rot=(0.18,0,0))
a.box((2.6,1.2,0.25),(0,0.1,1.0), M['leaf2'])
a.col((3.4,2.4,2.6),(0,0,1.3))
P(a)

# ---- Bus stop shelter ----
a = Asset('bus_stop', 'prop')
a.box((3.6,1.4,0.1),(0,0,2.5), M['steel_dk'])
for x in (-1.7,1.7):
    a.box((0.08,0.08,2.5),(x,0.6,1.25), M['steel_dk'])
a.box((3.4,0.04,1.8),(0,0.62,1.4), M['glass'])
a.box((0.04,1.0,1.8),(1.7,0.1,1.4), M['glass'])
a.box((2.4,0.35,0.06),(0,0.35,0.5), M['steel'])
a.col((3.6,1.4,2.6),(0,0.1,1.3))
P(a)

# ---- Crate / barrier / street sign / pipe (throwables) ----
a = Asset('crate', 'prop')
a.box((1.0,1.0,1.0),(0,0,0.5), M['wood'])
for s in (-1,1):
    a.box((1.04,0.12,0.12),(0,s*0.45,0.94), M['wood_dk']); a.box((1.04,0.12,0.12),(0,s*0.45,0.06), M['wood_dk'])
a.col((1.0,1.0,1.0),(0,0,0.5))
P(a)
a = Asset('barrier', 'prop')
a.box((2.0,0.6,0.9),(0,0,0.45), M['white'], taper=(1.0,0.4))
a.box((2.02,0.3,0.12),(0,0,0.7), M['paint_red'])
a.col((2.0,0.6,0.9),(0,0,0.45))
P(a)
a = Asset('street_sign', 'prop')
a.cyl(0.05, 3.0, (0,0,0), M['steel'], seg=5)
a.box((0.8,0.05,0.8),(0,0,2.6), M['paint_green'], rot=(0,PI/4,0))
a.col((0.8,0.2,3.0),(0,0,1.5))
P(a)
a = Asset('pipe_piece', 'prop')
a.cyl(0.18, 3.0, (-1.5,0,0.18), M['steel'], seg=8, rot=(0,PI/2,0))
a.col((3.0,0.36,0.36),(0,0,0.18))
P(a)

# ---- Newsstand / vendor cart ----
a = Asset('vendor_cart', 'prop')
a.box((1.8,1.0,1.0),(0,0,0.65), M['chrome'])
a.cyl(0.18,0.08,(-0.6,-0.5,0.18),M['rubber'],seg=8,rot=(PI/2,0,0)); a.cyl(0.18,0.08,(0.6,-0.5,0.18),M['rubber'],seg=8,rot=(PI/2,0,0))
a.box((0.05,0.05,1.2),(0,0,1.75), M['steel'])
a.cyl(1.2,0.5,(0,0,2.3),M['taxi2'],seg=8,r2=0.05)
a.col((1.8,1.0,1.3),(0,0,0.65))
P(a)

# ---- Park lamp (short) ----
a = Asset('park_lamp', 'prop')
a.cyl(0.08, 3.6, (0,0,0), M['iron'], seg=6)
a.sph(0.28, (0,0,3.8), M['lamp_emit'], seg=6, rings=4)
a.cyl(0.3, 0.12, (0,0,4.02), M['iron'], seg=6, r2=0.05)
a.col((0.2,0.2,4.1),(0,0,2.05))
P(a)

# ---- Boardwalk railing module (4m) ----
a = Asset('railing', 'prop')
for x in (-2,0,2):
    a.box((0.1,0.1,1.1),(x,0,0.55), M['wood_dk'])
a.box((4.1,0.12,0.1),(0,0,1.1), M['wood']); a.box((4.1,0.06,0.06),(0,0,0.6), M['wood'])
a.col((4.1,0.2,1.15),(0,0,0.57))
P(a)

# ---- Bollard ----
a = Asset('bollard', 'prop')
a.cyl(0.13, 0.9, (0,0,0), M['iron'], seg=8)
a.col((0.26,0.26,0.9),(0,0,0.45))
P(a)
print("props:", i)
