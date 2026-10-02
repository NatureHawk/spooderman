# THREADLINE: large traversal structures (run inside Blender after bl_helpers.py)
import math
PI = math.pi
i = 0
def P(a):
    global i
    place(a, i); i += 1

# ---- Tower crane mast (lattice, 62 m) ----
a = Asset('crane_mast', 'struct')
H = 62.0; w = 1.1
a.box((6,6,1.2),(0,0,0.6), M['concrete_dk'])
for (x,y) in ((-w,-w),(w,-w),(w,w),(-w,w)):
    a.box((0.22,0.22,H),(x,y,H/2), M['paint_yellow'])
z = 1.2
k = 0
while z < H - 1:
    z2 = min(z + 4.0, H)
    sides = (((-w,-w),(w,-w)),((w,-w),(w,w)),((w,w),(-w,w)),((-w,w),(-w,-w)))
    for (p,q) in sides:
        a.beam((p[0],p[1],z2),(q[0],q[1],z2),0.1,M['paint_yellow'])
        if k % 2 == 0: a.beam((p[0],p[1],z),(q[0],q[1],z2),0.07,M['paint_yellow'])
        else: a.beam((q[0],q[1],z),(p[0],p[1],z2),0.07,M['paint_yellow'])
    z = z2; k += 1
a.box((3.2,3.2,1.0),(0,0,H+0.5), M['steel_dk'])  # slewing ring
a.col((2.6,2.6,H+1),(0,0,(H+1)/2))
a.sock('slew', (0,0,H+1.0)); a.extra = {'height': H+1.0}
P(a)

# ---- Crane jib (rotates about origin at slewing ring; jib points +X) ----
a = Asset('crane_jib', 'struct')
L = 50.0; CL = 14.0
a.box((3.0,2.6,3.0),(0,0,1.5), M['paint_yellow'])      # turntable house
a.box((2.2,2.0,2.4),(1.2,-2.4,1.2), M['paint_yellow'])  # cab
a.box((2.0,0.1,1.6),(1.2,-3.42,1.4), M['glass_dk'])
a.box((0.5,0.5,9.0),(0,0,7.5), M['paint_yellow'])       # apex tower
for (y) in (-0.9, 0.9):
    a.box((L,0.2,0.2),(L/2,y,3.2), M['paint_yellow'])
a.box((L,0.2,0.2),(L/2,0,5.0), M['paint_yellow'])
x = 0.0; k = 0
while x < L - 0.5:
    x2 = min(x + 3.0, L)
    for y in (-0.9, 0.9):
        a.beam((x,y,3.2),(x2,0,5.0) if k%2==0 else (x2,y,3.2),0.07,M['paint_yellow'])
    a.beam((x2,-0.9,3.2),(x2,0.9,3.2),0.07,M['paint_yellow'])
    x = x2; k += 1
for y in (-1.0, 1.0):
    a.box((CL,0.25,0.4),(-CL/2,y,3.2), M['paint_yellow'])
a.box((4.0,2.8,2.6),(-CL+2.2,0,2.4), M['concrete'])   # counterweight
a.beam((0,0,12.0),(L*0.7,0,5.0),0.06,M['cable'])
a.beam((0,0,12.0),(-CL+1,0,3.4),0.06,M['cable'])
a.box((1.6,0.9,0.8),(L*0.8,0,2.8), M['steel_dk'])      # trolley
a.col((L,2.2,2.4),(L/2,0,4.1)).col((CL,2.6,1.2),(-CL/2,0,3.2)).col((4.0,2.8,2.6),(-CL+2.2,0,2.4)).col((3.2,3.2,3.2),(0,0,1.6)).col((0.6,0.6,9),(0,0,7.5))
a.sock('trolley', (L*0.8,0,2.4)); a.extra = {'length': L, 'counter': CL}
P(a)

# ---- Crane hook block (runtime-positioned under trolley) ----
a = Asset('crane_hook', 'struct')
a.box((1.0,0.6,1.2),(0,0,0.9), M['paint_yellow'])
a.cyl(0.12,0.9,(0,0,-0.2),M['steel_dk'],seg=6)
a.box((0.5,0.18,0.18),(0.2,0,-0.25),M['steel_dk'])
a.col((1.0,0.6,1.8),(0,0,0.7))
P(a)

# ---- Suspension bridge tower (deck runs along X between legs at y=+-13) ----
a = Asset('bridge_tower', 'struct')
TH = 112.0
for y in (-13.0, 13.0):
    a.box((5.0,4.0,TH),(0,y,TH/2-10), M['steel'], taper=(0.75,0.8))
    a.box((6.4,5.4,2.0),(0,y,TH-9), M['steel_dk'])
    a.box((7.0,6.0,10.0),(0,y,-10), M['concrete'])   # pier into water
for (z,hgt) in ((6.0,3.0),(48.0,4.0),(84.0,4.0),(100.0,5.0)):
    a.box((3.4,22.0,hgt),(0,0,z), M['steel'])
    # arch detail below crossbeam
    a.box((3.0,18.0,1.2),(0,0,z-hgt/2-0.6), M['steel_dk'])
a.box((2.5,1.6,1.6),(0,-13,TH-7.5), M['steel_dk']); a.box((2.5,1.6,1.6),(0,13,TH-7.5), M['steel_dk'])
a.sph(0.6,(0,-13,TH-5.6),M['red_emit'],seg=6,rings=3); a.sph(0.6,(0,13,TH-5.6),M['red_emit'],seg=6,rings=3)
for y in (-13.0, 13.0):
    a.col((5.0,4.0,TH+10),(0,y,TH/2-15))
for (z,hgt) in ((6.0,3.0),(48.0,4.0),(84.0,4.0),(100.0,5.0)):
    a.col((3.4,22.0,hgt),(0,0,z))
a.sock('saddleL', (0,-13,TH-7.5)); a.sock('saddleR', (0,13,TH-7.5))
a.extra = {'height': TH}
P(a)

# ---- Bridge deck segment (20 m along X, width 26) ----
a = Asset('bridge_deck', 'struct')
a.box((20.0,26.0,0.6),(0,0,-0.3), M['tar'])
a.box((20.0,1.8,0.25),(0,-12.1,0.12), M['concrete'])
a.box((20.0,1.8,0.25),(0,12.1,0.12), M['concrete'])
for y in (-12.9, 12.9):
    a.box((20.0,0.12,0.12),(0,y,1.2), M['steel_dk'])
    for x in range(-10,11,2):
        a.box((0.08,0.08,1.2),(x,y,0.6), M['steel_dk'])
# stiffening truss under the deck
for y in (-12.5, -4.2, 4.2, 12.5):
    a.box((20.0,0.4,3.2),(0,y,-2.2), M['steel_dk'])
for x in (-9.5, 0, 9.5):
    a.box((0.4,25.0,0.5),(x,0,-3.6), M['steel_dk'])
for x in (-10,-5,0,5):
    for y in (-12.5, 12.5):
        a.beam((x,y,-0.6),(x+5,y,-3.8),0.18,M['steel_dk'])
a.cyl(0.12,7.0,(0,-12.0,0),M['steel_dk'],seg=6); a.box((1.6,0.3,0.2),(0,-11.3,7.0),M['steel_dk']); a.box((0.5,0.3,0.06),(0,-10.7,6.9),M['lamp_emit'])
a.col((20.0,26.0,4.0),(0,0,-2.0)).col((20.0,0.3,1.3),(0,-12.9,0.65)).col((20.0,0.3,1.3),(0,12.9,0.65)).col((0.3,0.3,7),(0,-12.0,3.5))
P(a)

# ---- Elevated rail segment (20 m along X) ----
a = Asset('rail_el', 'struct')
for x in (-9.0, 9.0):
    for y in (-3.2, 3.2):
        a.box((0.6,0.6,10.0),(x,y,5.0), M['steel_dk'])
    a.box((0.8,7.4,1.0),(x,0,10.0), M['steel_dk'])
    a.beam((x,-3.2,6.5),(x,0,9.5),0.3,M['steel_dk']); a.beam((x,3.2,6.5),(x,0,9.5),0.3,M['steel_dk'])
for y in (-2.6, 2.6):
    a.box((20.0,0.5,1.4),(0,y,10.2), M['iron'])
a.box((20.0,7.0,0.4),(0,0,11.0), M['concrete_dk'])
for y in (-1.5, -0.3, 0.3, 1.5):
    a.box((20.0,0.1,0.15),(0,y,11.27), M['chrome'])
for x in range(-9,10,3):
    a.box((0.4,5.0,0.15),(x,0,11.22), M['wood_dk'])
a.col((20.0,7.4,1.8),(0,0,10.3))
for x in (-9.0, 9.0):
    for y in (-3.2, 3.2):
        a.col((0.6,0.6,10.0),(x,y,5.0))
a.extra = {'deck_z': 11.3}
P(a)

# ---- Elevated highway segment (20 m, wide, concrete) ----
a = Asset('highway_el', 'struct')
a.box((20.0,20.0,1.4),(0,0,13.0), M['concrete'])
a.box((20.0,0.5,1.1),(0,-9.8,14.2), M['concrete']); a.box((20.0,0.5,1.1),(0,9.8,14.2), M['concrete'])
a.box((3.0,14.0,1.6),(0,0,11.5), M['concrete_dk'])
a.box((2.6,2.6,11.0),(0,0,5.5), M['concrete'])
a.cyl(0.12,6.0,(0,-9.4,13.7),M['steel_dk'],seg=6); a.box((1.6,0.3,0.2),(0,-8.7,19.6),M['steel_dk']); a.box((0.5,0.3,0.06),(0,-8.1,19.5),M['lamp_emit'])
a.col((20.0,20.0,1.6),(0,0,12.9)).col((20.0,0.5,1.2),(0,-9.8,14.2)).col((20.0,0.5,1.2),(0,9.8,14.2)).col((2.6,2.6,12.2),(0,0,6.1)).col((3.0,14.0,1.6),(0,0,11.5))
a.extra = {'deck_z': 13.7}
P(a)

# ---- Pier / dock module (10 m) ----
a = Asset('pier', 'struct')
a.box((10.0,8.0,0.4),(0,0,-0.2), M['wood'])
for x in (-4.5, 0, 4.5):
    for y in (-3.6, 3.6):
        a.cyl(0.25,6.0,(x,y,-6.0),M['wood_dk'],seg=6)
a.box((10.0,0.15,0.15),(0,3.9,1.0),M['wood_dk'])
a.col((10.0,8.0,0.5),(0,0,-0.25))
P(a)
print("structs:", i)
