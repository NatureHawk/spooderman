# THREADLINE: articulated characters (run inside Blender after bl_helpers.py)
# Every part is modeled with its origin at the joint pivot. Limbs hang along -Z.
# Characters face -Y in Blender (= +Z in the game after Y-up conversion).
# Recolor slots: slot_primary / slot_secondary / slot_accent / slot_dark / slot_glow_emit / slot_skin / slot_body
import math
PI = math.pi
S = M  # shorthand
PR, SE, AC, DK, GL, SK, BD = (M['slot_primary'], M['slot_secondary'], M['slot_accent'],
                             M['slot_dark'], M['slot_glow'], M['slot_skin'], M['slot_body'])
hi = 0
def H(a):
    global hi
    place(a, hi, spacing=3.0); hi += 1

# ======================= WEAVER (heavy rescue engineer) =======================
a = Asset('W_pelvis', 'hero')
a.box((0.36,0.22,0.2),(0,0,-0.02), DK)
a.box((0.38,0.24,0.07),(0,0,0.06), AC)                # utility belt
for x in (-0.14, 0.0, 0.14):
    a.box((0.07,0.05,0.08),(x,-0.13,0.05), SE)        # pouches
a.box((0.12,0.06,0.12),(0,0.13,0.03), SE)
H(a)
a = Asset('W_torso', 'hero')
a.box((0.34,0.21,0.3),(0,0,0.16), PR, taper=(1.25,1.15))
a.box((0.46,0.26,0.2),(0,0,0.40), PR)                 # broad chest
a.box((0.3,0.05,0.16),(0,-0.14,0.38), SE)             # chest plate
a.box((0.06,0.055,0.2),(0,-0.16,0.38), GL)            # amber core line
a.box((0.34,0.2,0.3),(0,0.2,0.34), DK)                # reel pack
a.cyl(0.08,0.06,(-0.1,0.3,0.42),AC,seg=8,rot=(-PI/2,0,0)); a.cyl(0.08,0.06,(0.1,0.3,0.42),AC,seg=8,rot=(-PI/2,0,0))
for x in (-0.25,0.25):
    a.box((0.14,0.24,0.1),(x,0,0.5), SE)              # shoulder guards
a.sock('neck',(0,0,0.53)); a.sock('shL',(-0.26,0,0.44)); a.sock('shR',(0.26,0,0.44))
a.sock('armUL',(-0.12,0.3,0.48)); a.sock('armUR',(0.12,0.3,0.48)); a.sock('armLL',(-0.12,0.3,0.24)); a.sock('armLR',(0.12,0.3,0.24))
H(a)
a = Asset('W_head', 'hero')
a.box((0.2,0.23,0.24),(0,0,0.13), PR, taper=(0.85,0.85))
a.box((0.17,0.04,0.06),(0,-0.115,0.15), GL)           # visor slit
a.box((0.21,0.2,0.05),(0,0.01,0.24), SE)
a.box((0.03,0.12,0.08),(-0.105,0.02,0.2), AC); a.box((0.03,0.12,0.08),(0.105,0.02,0.2), AC)
a.cyl(0.06,0.06,(0,0,-0.03),DK,seg=6)
H(a)
a = Asset('W_uarm', 'hero')
a.box((0.13,0.13,0.3),(0,0,-0.15), PR, taper=(0.85,0.85))
a.box((0.14,0.14,0.06),(0,0,-0.03), SE)
H(a)
a = Asset('W_farm', 'hero')
a.box((0.11,0.11,0.27),(0,0,-0.135), DK, taper=(1.15,1.15))
a.box((0.13,0.1,0.14),(0,-0.02,-0.18), SE)            # filament launcher
a.box((0.03,0.04,0.1),(0,-0.075,-0.19), GL)
a.sock('wrist',(0,-0.05,-0.28))
H(a)
a = Asset('W_hand', 'hero')
a.box((0.09,0.06,0.1),(0,0,-0.05), DK)
a.box((0.03,0.05,0.05),(0.05,-0.02,-0.03), DK)
H(a)
a = Asset('W_thigh', 'hero')
a.box((0.16,0.17,0.45),(0,0,-0.225), PR, taper=(1.1,1.05))
a.box((0.17,0.04,0.2),(0,-0.09,-0.22), SE)
H(a)
a = Asset('W_shin', 'hero')
a.box((0.13,0.14,0.44),(0,0,-0.22), DK, taper=(1.2,1.15))
a.box((0.14,0.05,0.14),(0,-0.08,-0.06), AC)           # knee guard
H(a)
a = Asset('W_foot', 'hero')
a.box((0.12,0.26,0.09),(0,-0.06,-0.045), DK)
a.box((0.13,0.08,0.03),(0,-0.17,-0.075), AC)
H(a)
a = Asset('W_tarm1', 'hero')   # tension arm upper segment, extends along -Z
a.cyl(0.035,0.55,(0,0,-0.55),SE,seg=6)
a.sph(0.06,(0,0,0),DK,seg=6,rings=4)
a.box((0.06,0.03,0.3),(0,0.03,-0.3),AC)
H(a)
a = Asset('W_tarm2', 'hero')   # tension arm lower segment with claw tip
a.cyl(0.03,0.5,(0,0,-0.5),SE,seg=6,r2=0.022)
a.sph(0.045,(0,0,0),DK,seg=6,rings=4)
for k in range(3):
    ang = k*2*PI/3
    a.beam((0,0,-0.5),(0.06*math.cos(ang),0.06*math.sin(ang),-0.6),0.02,GL)
H(a)

# ======================= PULSE (fast acrobatic roboticist) =======================
a = Asset('P_pelvis', 'hero')
a.box((0.31,0.19,0.18),(0,0,-0.02), DK)
a.box((0.32,0.2,0.04),(0,0,0.06), SE)
a.box((0.06,0.21,0.045),(0,0,0.06), GL)
H(a)
a = Asset('P_torso', 'hero')
a.box((0.28,0.18,0.3),(0,0,0.15), PR, taper=(1.25,1.1))
a.box((0.38,0.21,0.2),(0,0,0.39), PR)
a.box((0.03,0.215,0.46),(0,0,0.24), GL)               # conductive spine line (front+back)
a.beam((-0.16,-0.106,0.46),(0,-0.106,0.3),0.025,GL,t2=0.012); a.beam((0.16,-0.106,0.46),(0,-0.106,0.3),0.025,GL,t2=0.012)
a.box((0.2,0.06,0.14),(0,0.12,0.36), SE)              # capacitor pack
a.cyl(0.04,0.14,(-0.07,0.16,0.3),GL,seg=6); a.cyl(0.04,0.14,(0.07,0.16,0.3),GL,seg=6)
for x in (-0.21,0.21):
    a.box((0.1,0.19,0.07),(x,0,0.49), SE)
a.sock('neck',(0,0,0.5)); a.sock('shL',(-0.21,0,0.43)); a.sock('shR',(0.21,0,0.43))
H(a)
a = Asset('P_head', 'hero')
a.sph(0.115,(0,0,0.13),PR,seg=8,rings=6,scale=(0.9,1.0,1.08))
a.box((0.19,0.05,0.045),(0,-0.095,0.14), GL, taper=(0.8,1.0))
a.box((0.02,0.2,0.14),(0,0.01,0.2), SE)               # crest fin
a.cyl(0.05,0.06,(0,0,-0.03),DK,seg=6)
H(a)
a = Asset('P_uarm', 'hero')
a.box((0.1,0.1,0.29),(0,0,-0.145), PR, taper=(0.85,0.85))
a.box((0.105,0.02,0.2),(0,-0.05,-0.15), GL)
H(a)
a = Asset('P_farm', 'hero')
a.box((0.09,0.09,0.27),(0,0,-0.135), SE, taper=(1.15,1.15))
a.cyl(0.058,0.1,(0,0,-0.22),GL,seg=8)                 # conductive bracer
a.sock('wrist',(0,-0.04,-0.27))
H(a)
a = Asset('P_hand', 'hero')
a.box((0.08,0.05,0.09),(0,0,-0.045), DK)
H(a)
a = Asset('P_thigh', 'hero')
a.box((0.14,0.15,0.45),(0,0,-0.225), PR, taper=(1.05,1.0))
a.box((0.02,0.155,0.3),(-0.07,0,-0.22), GL)
H(a)
a = Asset('P_shin', 'hero')
a.box((0.11,0.12,0.44),(0,0,-0.22), SE, taper=(1.2,1.1))
a.box((0.115,0.03,0.12),(0,-0.065,-0.05), AC)
H(a)
a = Asset('P_foot', 'hero')
a.box((0.1,0.25,0.08),(0,-0.06,-0.04), DK)
a.box((0.105,0.04,0.02),(0,-0.175,-0.06), GL)
H(a)

# ======================= PEDESTRIANS (instanced; body slot tinted per instance) =======================
ci = 0
def Cc(a):
    global ci
    place(a, ci, spacing=3.0); ci += 1
a = Asset('ped_torso', 'char')        # origin at waist, shirt = slot_body
a.box((0.32,0.19,0.5),(0,0,0.25), BD, taper=(1.15,1.05))
a.box((0.18,0.14,0.05),(0,0,0.52), SK)
Cc(a)
a = Asset('ped_head', 'char')         # origin at neck, skin = slot_body (instance tint = skin tone)
a.box((0.07,0.07,0.08),(0,0,0.04), BD)
a.box((0.18,0.2,0.22),(0,0,0.18), BD, taper=(0.85,0.9))
a.box((0.19,0.19,0.07),(0,0.02,0.3), M['hair'])
a.box((0.19,0.05,0.12),(0,0.1,0.22), M['hair'])
Cc(a)
a = Asset('ped_arm', 'char')          # origin at shoulder, whole arm (sleeve tinted)
a.box((0.09,0.1,0.33),(0,0,-0.165), BD)
a.box((0.075,0.08,0.28),(0,0,-0.47), BD)
a.box((0.07,0.05,0.09),(0,0,-0.65), SK)
Cc(a)
a = Asset('ped_leg', 'char')          # origin at hip, pants tinted
a.box((0.14,0.15,0.46),(0,0,-0.23), BD)
a.box((0.12,0.13,0.44),(0,0,-0.68), BD)
a.box((0.11,0.24,0.08),(0,-0.05,-0.94), M['rubber'])
Cc(a)
a = Asset('ped_hat', 'char')          # origin at neck (sits on head)
a.cyl(0.13,0.1,(0,0,0.3),BD,seg=8); a.box((0.2,0.14,0.02),(0,-0.14,0.31),BD)
Cc(a)
a = Asset('ped_bag', 'char')          # origin at waist, on the back
a.box((0.26,0.12,0.34),(0,0.16,0.33),BD)
Cc(a)
a = Asset('ped_lod', 'char')          # single-piece far LOD pedestrian (origin at feet)
a.box((0.3,0.2,0.9),(0,0,0.45), M['cloth_blue'], taper=(1.2,1.0))
a.box((0.36,0.22,0.55),(0,0,1.18), BD, taper=(0.9,0.9))
a.box((0.18,0.2,0.24),(0,0,1.58), M['skin'])
Cc(a)
a = Asset('umbrella', 'char')         # origin at hand
a.cyl(0.015,0.9,(0,0,0),M['iron'],seg=4)
a.cyl(0.55,0.25,(0,0,0.75),BD,seg=8,r2=0.03)
Cc(a)
a = Asset('phone', 'char')
a.box((0.07,0.015,0.14),(0,0,0),M['iron'])
Cc(a)

# ======================= MERIDIAN ENEMIES =======================
MR, MA, ML = M['meridian'], M['slot_accent'], M['meridian_lt']
ei = 0
def E(a):
    global ei
    place(a, ei + 12, spacing=3.0); ei += 1
a = Asset('E_pelvis', 'char')
a.box((0.36,0.22,0.2),(0,0,-0.02), MR); a.box((0.38,0.24,0.06),(0,0,0.06), ML)
E(a)
a = Asset('E_torso', 'char')
a.box((0.36,0.22,0.3),(0,0,0.15), MR, taper=(1.2,1.1))
a.box((0.46,0.27,0.22),(0,0,0.4), ML)
a.box((0.2,0.28,0.12),(0,0,0.4), MA)                  # faction chevron band
a.tri_prism([(-0.12,0.0),(0.12,0.0),(0,-0.12)],0.02,(0,-0.14,0.32),M['visor_emit'],rot=(PI,0,0))
for x in (-0.26,0.26):
    a.box((0.16,0.26,0.12),(x,0,0.5), MR)
a.box((0.3,0.14,0.34),(0,0.18,0.3), MR)
H_ = a
E(a)
a = Asset('E_head', 'char')
a.box((0.21,0.23,0.25),(0,0,0.13), MR, taper=(0.9,0.9))
a.box((0.19,0.04,0.07),(0,-0.115,0.15), M['visor_emit'])
a.box((0.04,0.18,0.06),(0,0.01,0.27), MA)
E(a)
a = Asset('E_uarm', 'char')
a.box((0.13,0.13,0.3),(0,0,-0.15), ML); a.box((0.15,0.15,0.08),(0,0,-0.03), MR)
E(a)
a = Asset('E_farm', 'char')
a.box((0.11,0.11,0.28),(0,0,-0.14), MR, taper=(1.1,1.1)); a.box((0.1,0.08,0.1),(0,0,-0.3), M['rubber'])
a.sock('hand',(0,0,-0.3))
E(a)
a = Asset('E_thigh', 'char')
a.box((0.17,0.18,0.45),(0,0,-0.225), MR)
E(a)
a = Asset('E_shin', 'char')
a.box((0.14,0.15,0.44),(0,0,-0.22), ML, taper=(1.15,1.1)); a.box((0.13,0.28,0.1),(0,-0.06,-0.47), M['rubber'])
E(a)
a = Asset('E_shield', 'char')         # riot shield, origin at hand
a.box((0.6,0.06,1.0),(0,-0.15,-0.1), M['glass_dk']); a.box((0.64,0.08,0.06),(0,-0.15,0.4), MA); a.box((0.64,0.08,0.06),(0,-0.15,-0.6), MA)
E(a)
a = Asset('E_rifle', 'char')          # marksman rifle, origin at hand, barrel along -Y
a.box((0.06,0.9,0.1),(0,-0.25,0), M['iron']); a.box((0.05,0.25,0.14),(0,0.25,-0.03), ML)
a.cyl(0.03,0.2,(0,-0.12,0.1),M['iron'],seg=6,rot=(PI/2,0,0)); a.sph(0.02,(0,-0.72,0),M['visor_emit'],seg=4,rings=3)
a.sock('muzzle',(0,-0.72,0))
E(a)
a = Asset('E_baton', 'char')
a.cyl(0.025,0.6,(0,0,-0.55),M['iron'],seg=5); a.box((0.03,0.03,0.2),(0,0,-0.6),M['visor_emit'])
E(a)
a = Asset('E_pack', 'char')           # drone operator backpack w/ antenna
a.box((0.34,0.18,0.4),(0,0.26,0.3),ML); a.cyl(0.01,0.5,(0.12,0.3,0.5),M['iron'],seg=4); a.sph(0.03,(0.12,0.3,1.0),M['visor_emit'],seg=4,rings=3)
E(a)
a = Asset('E_pauldron', 'char')       # captain cape/pauldron, origin at neck
a.box((0.6,0.3,0.1),(0,0.02,-0.05),MA); a.box((0.5,0.04,0.7),(0,0.16,-0.4),MA,taper=(1.3,1.0))
E(a)

# ======================= THE WARDEN (construction exoskeleton boss) =======================
WY, WD = M['warden'], M['warden_dk']
wi = 0
def W(a):
    global wi
    place(a, wi, spacing=6.0); wi += 1
a = Asset('WD_pelvis', 'boss')
a.box((1.3,0.9,0.6),(0,0,0), WD); a.box((1.4,1.0,0.2),(0,0,0.3), WY)
W(a)
a = Asset('WD_torso', 'boss')
a.box((1.6,1.2,1.1),(0,0,0.55), WY, taper=(1.2,1.1))
a.box((2.2,1.4,0.9),(0,0,1.45), WY)
a.box((1.0,0.1,0.6),(0,-0.72,1.35), M['glass_dk'])          # pilot cab window
a.box((0.8,0.05,0.12),(0,-0.75,1.1), M['orange_emit'])
a.box((1.4,0.8,1.2),(0,0.9,1.2), WD)                         # hydraulic pack
for x in (-0.4,0.4): a.cyl(0.14,0.9,(x,1.2,1.2),M['steel'],seg=6)
for x in (-1.2,1.2):
    a.box((0.8,1.1,0.6),(x,0,1.9), WD)
    a.tri_prism([(-0.3,0),(0.3,0),(0,0.5)],0.9,(x,0,2.2),M['paint_red'])
a.sph(0.18,(0,-0.5,2.05),M['orange_emit'],seg=6,rings=4)    # sensor eye (weak point)
a.sock('neck',(0,0,1.95)); a.sock('shL',(-1.3,0,1.6)); a.sock('shR',(1.3,0,1.6)); a.sock('core',(0,0.9,1.3))
W(a)
a = Asset('WD_uarm', 'boss')
a.box((0.5,0.5,1.4),(0,0,-0.7), WD); a.cyl(0.1,1.2,(0,-0.3,-1.3),M['steel'],seg=6)
a.box((0.6,0.6,0.3),(0,0,-0.1), WY)
W(a)
a = Asset('WD_farm', 'boss')          # forearm ending in hydraulic claw
a.box((0.55,0.55,1.3),(0,0,-0.65), WY, taper=(1.2,1.2))
for s in (-1,1):
    a.beam((0,0,-1.3),(s*0.35,-0.1,-1.9),0.14,WD); a.beam((s*0.35,-0.1,-1.9),(s*0.12,-0.2,-2.3),0.12,WD)
a.sock('claw',(0,-0.1,-2.0))
W(a)
a = Asset('WD_thigh', 'boss')
a.box((0.6,0.65,1.3),(0,0,-0.65), WD); a.cyl(0.09,1.1,(0.25,-0.35,-1.2),M['steel'],seg=6)
W(a)
a = Asset('WD_shin', 'boss')
a.box((0.55,0.6,1.3),(0,0,-0.65), WY, taper=(1.3,1.2)); a.box((0.9,1.3,0.3),(0,-0.2,-1.35), WD)
W(a)
print('heroes', hi, 'chars', ci, 'enemies', ei, 'boss', wi)
