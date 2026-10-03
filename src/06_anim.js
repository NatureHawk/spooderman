/* =====================================================================================
   PROCEDURAL ANIMATION
   TL.Rig          — direction-driven posing of a skinned skeleton (rest frames are world-aligned),
                     forward kinematics in model space, two-bone IK, per-bone smoothing (springs).
   TL.HeroAnimator — traversal/combat poses driven by the physics state (never moves the body):
                     run cycles, swing (rope-hand targets the real anchor), glide spread, wall run,
                     crawl, ceiling, perch, launch, slingshot, dive, tricks, recovery, attacks.
                     WEAVER: powerful, compact, 4 IK tension arms. PULSE: acrobatic, splits/spins.
   TL.Membranes    — original triangular glide membranes stretched between wrist, hip and ankle.
   TL.NPCAnimator  — pedestrians & enemies (walk/run/idle/flee/cower/cheer/phone/aim/strike/stagger).
   Model space: +Z forward, +Y up, +X = character's left.
   ===================================================================================== */
'use strict';

TL.Rig = class {
  constructor(sk) {
    this.sk = sk; this.mesh = sk.mesh; this.bones = sk.bones;
    this.defs = {}; for (const d of sk.defs) this.defs[d.name] = d;
    this.rest = {};       // rest head (model space) and rest direction per bone
    for (const d of sk.defs) {
      const h = new THREE.Vector3(d.head[0], d.head[1], d.head[2]);
      const t = new THREE.Vector3(d.tail[0], d.tail[1], d.tail[2]);
      const dir = t.clone().sub(h); const len = dir.length() || 0.1;
      this.rest[d.name] = { head: h, dir: dir.normalize(), len, parent: d.parent };
    }
    this.order = sk.defs.map((d) => d.name);   // exported in hierarchy order
    this.cur = {}; this.target = {};
    for (const n of this.order) { this.cur[n] = this.rest[n].dir.clone(); this.target[n] = this.rest[n].dir.clone(); }
    this.twist = {}; this.Qm = {}; this.P = {};
    for (const n of this.order) { this.Qm[n] = new THREE.Quaternion(); this.P[n] = new THREE.Vector3(); this.twist[n] = 0; }
    this.hipsQ = new THREE.Quaternion(); this.hipsQT = new THREE.Quaternion();
    this.hipsOff = new THREE.Vector3(); this.hipsOffT = new THREE.Vector3();
    this.stiff = 14;
    this.boneStiff = {};  // per-bone stiffness overrides for this frame (e.g. the rope arm snaps to the line)
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.len = (n) => this.rest[n] ? this.rest[n].len : 0.3;
    this.upperArm = this.len('uarmL'); this.foreArm = this.len('farmL'); this.thigh = this.len('thighL'); this.shin = this.len('shinL');
  }
  set(name, dir, twist) { const t = this.target[name]; if (!t) return; t.copy(dir).normalize(); if (twist !== undefined) this.twist[name] = twist; }
  setRest(name) { if (this.target[name]) this.target[name].copy(this.rest[name].dir); }
  /* model-space position of a joint's rest head after FK of its parent (valid during apply) */
  jointPos(name) { return this.P[name]; }
  /* Apply smoothed targets through the hierarchy. dt=0 -> snap. */
  apply(dt) {
    const k = dt > 0 ? 1 - Math.exp(-this.stiff * dt) : 1;
    this.hipsQ.slerp(this.hipsQT, k);
    this.hipsOff.lerp(this.hipsOffT, k);
    for (const n of this.order) {
      const b = this.bones[n]; if (!b) continue;
      const r = this.rest[n];
      const bs = this.boneStiff[n];
      const cur = this.cur[n]; cur.lerp(this.target[n], bs && dt > 0 ? 1 - Math.exp(-bs * dt) : k).normalize();
      const par = r.parent;
      if (!par) {
        this.Qm[n].copy(this.hipsQ);
        this.P[n].copy(r.head).add(this.hipsOff);
        b.quaternion.copy(this.hipsQ);
        b.position.copy(b.userData.rest).add(this.hipsOff);
        continue;
      }
      const Qp = this.Qm[par];
      // FK: joint position
      this.P[n].copy(r.head).sub(this.rest[par].head).applyQuaternion(Qp).add(this.P[par]);
      // model orientation: rest direction -> current direction (plus optional twist)
      const qd = this._q.setFromUnitVectors(r.dir, cur);
      if (this.twist[n]) qd.multiply(this._q2.setFromAxisAngle(r.dir, this.twist[n]));
      this.Qm[n].copy(qd);
      // local = Qp^-1 * Qm
      b.quaternion.copy(Qp).invert().multiply(qd);
    }
  }
  /* Two-bone IK: returns [upperDir, lowerDir] (model space) reaching from `root` toward `target`. */
  ik2(root, target, L1, L2, pole, out1, out2) {
    const d = this._v.copy(target).sub(root);
    let dist = d.length();
    const maxR = (L1 + L2) * 0.999;
    if (dist > maxR) { d.multiplyScalar(maxR / dist); dist = maxR; }
    if (dist < 1e-4) { out1.copy(pole); out2.copy(pole); return; }
    const dn = d.clone().normalize();
    const a = TL.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const ang = Math.acos(a);
    // bend plane contains dn and pole
    const side = pole.clone().sub(dn.clone().multiplyScalar(pole.dot(dn)));
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1); side.normalize();
    out1.copy(dn).multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang)).normalize();
    const elbow = root.clone().addScaledVector(out1, L1);
    out2.copy(target).sub(elbow).normalize();
    if (!Number.isFinite(out2.x)) out2.copy(dn);
  }
};

/* ------------------------------------------------------------------ direction helpers */
TL.dirv = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
TL._tmpd = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

/* ------------------------------------------------------------------ WEAVER tension arms (IK, rigid parts)
   The four claw arms come from the Iron Spider model itself (tools/hd/hd_import_heroes.py): each arm is three rigid
   pieces (upper, forearm, claw) modelled in a local frame at its own joint — y along the segment, x = bend-plane normal —
   so the same two-bone IK that drove the old arms drives these; each piece is placed by that frame at run time. */
TL.TensionArms = class {
  constructor(scene, mat, rig, quality) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.arms = [];
    const socks = rig.sk.socks || {};
    const keys = ['armUL', 'armUR', 'armLL', 'armLR'];
    for (let i = 0; i < 4; i++) {
      const nm = 'WEAVER_' + keys[i].replace('arm', 'arm_');
      const s = socks[keys[i]] || [i % 2 ? -0.1 : 0.1, 1.45 - Math.floor(i / 2) * 0.2, -0.19];
      const g1 = TL.Assets.geo(nm + '_1', 'hi');
      const seg = [1, 2, 3].map((k) => { const g = TL.Assets.geo(nm + '_' + k, 'hi'); return g ? new THREE.Mesh(g, TL.Assets.texMats(g) || mat) : null; });
      const ex = g1 ? g1.userData.extra : {};
      if (seg[2]) seg[2].geometry.computeBoundingBox();
      const a = {
        socket: new THREE.Vector3(s[0], s[1], s[2]), L1: ex.L1 || 0.55, L2: ex.L2 || 0.62,
        seg1: seg[0], seg2: seg[1], claw: seg[2],
        tip: new THREE.Vector3(), target: new THREE.Vector3(), side: s[0] >= 0 ? 1 : -1, upper: i < 2,   // side from the real socket (+X = character left)
        n: new THREE.Vector3(),
        clawLength: seg[2] ? Math.max(0,seg[2].geometry.boundingBox.max.y) : 0,
      };
      for (const m of seg) if (m) { m.castShadow = true; m.frustumCulled = false; this.group.add(m); }
      this.arms.push(a);
    }
    this.rig = rig; this._v = new THREE.Vector3(); this._d1 = new THREE.Vector3(); this._d2 = new THREE.Vector3();
    this._n = new THREE.Vector3(); this._z = new THREE.Vector3(); this._m = new THREE.Matrix4();
    this.mode = 'idle'; this.focus = null; this.t = 0;
    this.idleTime = 0; this.fold = 0; this.wallClock = 0;
    this.retracted = false; this.deployment = 1;
    // A shallow, raised gold spider follows the chest, including crouches/flips.
    this.emblem = new THREE.Group(); this.group.add(this.emblem);
    this.emblemMat = new THREE.MeshStandardMaterial({color:0xe3b54f,metalness:.8,roughness:.28,emissive:0xffb52d,emissiveIntensity:0});
    const plate = points => {
      const shape=new THREE.Shape();points.forEach((p,i)=>i?shape.lineTo(...p):shape.moveTo(...p));shape.closePath();
      const geo=new THREE.ExtrudeGeometry(shape,{depth:.012,bevelEnabled:true,bevelThickness:.004,bevelSize:.004,bevelSegments:1,steps:1});
      const mesh=new THREE.Mesh(geo,this.emblemMat);mesh.castShadow=true;this.emblem.add(mesh);
    };
    plate([[0,.12],[.045,.065],[.035,-.02],[.055,-.075],[0,-.17],[-.055,-.075],[-.035,-.02],[-.045,.065]]);
    for(const s of [-1,1])for(const [y,bend,tip]of [[.075,.16,.27],[.035,.095,.15],[-.015,-.07,-.2],[-.06,-.16,-.29]]){
      plate([[s*.025,y+.012],[s*.14,bend+.012],[s*.20,tip],[s*.177,tip-.005],[s*.12,bend-.014],[s*.025,y-.014]]);
    }
    this.emblem.visible=false;
  }
  setRetracted(value,snap=false) { this.retracted=!!value;if(snap)this.deployment=value?0:1; }
  /* orientation of a piece: local y along d, local x = bend-plane normal n */
  _orient(q, n, d) {
    this._z.crossVectors(n, d);
    this._m.makeBasis(n, d, this._z);
    q.setFromRotationMatrix(this._m);
  }
  tint(c) { for (const a of this.arms) for (const m of [a.seg1, a.seg2, a.claw]) if (m && m.material.color) m.material.color.copy(c); }
  /* mode: idle | swing | wall | strike | lattice | bind | glide; focus: world point (enemy / wall) */
  update(dt, root, rootQ, heroState, extra) {
    this.t += dt;
    const hero = extra && extra.hero, speed = hero ? hero.vel.length() : 0;
    const contactNormal=hero&&hero.state===TL.TS.CEIL?new THREE.Vector3(0,-1,0):hero?hero.wallN:null;
    const resting = this.mode === 'idle' && (heroState === TL.TS.GROUND || heroState === TL.TS.PERCH) && speed < 0.25;
    this.idleTime = resting ? this.idleTime + dt : 0;
    this.fold = TL.damp(this.fold, this.idleTime >= 2 ? 1 : 0, this.idleTime >= 2 ? 4 : 9, dt);
    // Retract the telescoping links for aerial rotations; deploy fully for contact.
    const compactTarget=this.mode==='packed'?1:this.mode==='swing'?.45:this.mode==='idle'?this.fold:0;
    this.compact=TL.damp(this.compact||0,compactTarget,12,dt);
    this.wallClock += dt * TL.clamp(speed * 2.2, 0, 22);
    const chestQ = this.rig.Qm.chest, chestP = this.rig.P.chest, chestRest = this.rig.rest.chest.head;
    this.deployment=TL.clamp(this.deployment+(this.retracted?-1:1)*dt/.48,0,1);
    const unfold=TL.smooth(0,1,this.deployment);
    const emblemLocal=new THREE.Vector3(0,1.37,-.185).sub(chestRest).applyQuaternion(chestQ).add(chestP);
    this.emblem.position.copy(emblemLocal).applyQuaternion(rootQ).add(root);
    this.emblem.quaternion.copy(rootQ).multiply(chestQ);
    this.emblem.visible=this.deployment<1;
    this.emblem.scale.setScalar(.6+.18*(1-unfold));
    this.emblemMat.emissiveIntensity=Math.sin(this.deployment*Math.PI)*.65;
    for (let i = 0; i < 4; i++) {
      const a = this.arms[i];
      const linkScale=1-.42*this.compact,L1=a.L1*linkScale,L2=a.L2*linkScale;
      const clawScale=1-.6*this.compact,clawLength=a.clawLength*clawScale;
      if(a.seg1)a.seg1.scale.set(1,linkScale,1);
      if(a.seg2)a.seg2.scale.set(1,linkScale,1);
      if(a.claw)a.claw.scale.setScalar(clawScale);
      // socket in world: model FK of the chest, then root transform
      const sm = this._v.copy(a.socket).sub(chestRest).applyQuaternion(chestQ).add(chestP);
      const base = sm.clone().applyQuaternion(rootQ).add(root);
      // desired tip (world)
      const s = a.side, u = a.upper ? 1 : 0;
      let local;
      switch (this.mode) {
        case 'packed': local=new THREE.Vector3(s*.1,u?-.24:-.16,-.2);break;
        case 'swing': {
          // Sweep rearward in the airflow; no periodic wing flap. Load briefly opens the joints.
          const load = hero ? TL.clamp(hero.tether.main.tension / (TL.C.G * 4), 0, 1) : 0;
          const arc = hero ? TL.clamp(hero.vel.y / Math.max(speed, 1), -1, 1) : 0;
          local = new THREE.Vector3(s * (.24 + load * .16), u ? -.2 - arc*.12 : -.48, -.5 - Math.min(speed/80,.4)); break;
        }
        case 'glide': local = new THREE.Vector3(s * 1.0, 0.1 * u, -0.25); break;
        case 'lattice': local = new THREE.Vector3(s * (0.55 - 0.25 * u), 0.9 + 0.45 * u, 0.75); break;
        case 'strike': local = null; break;
        case 'ceiling': case 'wall': local = new THREE.Vector3(s * 0.7, u ? 0.6 : -0.6, 0.8); break;
        default: local = new THREE.Vector3(s * TL.lerp(.36,.08,this.fold), TL.lerp(u ? -.12 : -.3, u ? -.25 : -.18,this.fold), TL.lerp(-.3,-.16,this.fold));
      }
      if (local) a.target.copy(base).add(local.multiplyScalar(1.05).applyQuaternion(rootQ));
      else if (this.focus) a.target.copy(this.focus).add(new THREE.Vector3(Math.sin(i * 1.7) * 0.4, Math.cos(i * 2.3) * 0.4, 0));
      a.planted = false;
      if ((this.mode === 'wall'||this.mode==='ceiling') && hero && !this.retracted && this.deployment===1) {
        const normal = contactNormal;
        const maxReach = (L1 + L2) * .97;
        const stepDuration=TL.clamp(.16/(1+speed*.18),.028,.16);
        // Contact points remain in world space while the chest climbs past them.
        // One claw at a time reaches ahead, leaving the other three supporting the body.
        const slot = [0,3,1,2][Math.floor(this.wallClock) % 4];
        const overreach = a.contact && base.distanceTo(a.contact) > maxReach;
        const nextStep = slot === i && a.lastStep !== Math.floor(this.wallClock) && speed > .2;
        if (overreach) a.contact = null;
        if ((!a.contact || nextStep) && !a.step) {
          const reach = maxReach * .46;
          const probe = base.clone().add(new THREE.Vector3(s*reach, u ? reach*.7 : -reach*.55, 0).applyQuaternion(rootQ));
          probe.addScaledVector(hero.vel, Math.min(.15, .46 / Math.max(speed,1)));
          probe.addScaledVector(normal, .25);
          const hit = hero.world.raycast(probe.x,probe.y,probe.z,-normal.x,-normal.y,-normal.z,maxReach+.6,c=>c.solid && c.climb,null,{noGround:true});
          if (hit) {
            const target = new THREE.Vector3(hit.x,hit.y,hit.z).addScaledVector(normal,.025);
            if (base.distanceTo(target) < maxReach) {
              a.step = { from: a.tip.lengthSq() ? a.tip.clone() : base.clone(), to: target, t:0 };
              a.contact = null; a.lastStep = Math.floor(this.wallClock);
            }
          }
        }
        if(a.step&&base.distanceTo(a.step.to)>maxReach){a.step=null;a.contact=null;}
        if (a.step) {
          a.step.t += dt; const t = TL.clamp(a.step.t / stepDuration,0,1);
          a.target.copy(a.step.from).lerp(a.step.to,TL.smooth(0,1,t)).addScaledVector(normal,Math.sin(t*Math.PI)*.12);
          a.tip.copy(a.target);
          if (t >= 1) { a.contact = a.step.to.clone(); a.step = null; }
        }
        if (a.contact) { a.target.copy(a.contact); a.tip.copy(a.contact); a.planted = true; }
      } else { a.contact = null; a.step = null; }
      if (a.tip.lengthSq() === 0) a.tip.copy(a.target);
      if (!a.planted && !a.step) a.tip.lerp(a.target, 1 - Math.exp(-(this.mode === 'packed'?45:this.mode === 'strike' ? 22 : 12) * dt));
      // IK with pole pointing up/back (spider-leg look)
      // folded: upper pair bends up over the shoulders, lower pair bends down beside the hips (never across the back)
      const folded = this.mode === 'idle' || this.mode === 'packed' || !this.mode;
      const pole = (folded ? new THREE.Vector3(s * TL.lerp(.25,.04,this.fold), -1, -.3) : this.mode === 'swing' ? new THREE.Vector3(s*.08,-1,-.35) : new THREE.Vector3(s * .65, u ? .5 : -.5, -.5)).applyQuaternion(rootQ).normalize();
      // Wall targets refer to the claw tip, not the wrist: keep the blade out of the wall.
      const solveTip = a.tip.clone();
      if ((this.mode === 'wall'||this.mode==='ceiling') && hero && (a.planted || a.step)) solveTip.addScaledVector(contactNormal,clawLength);
      this.rig.ik2(base, solveTip, L1, L2, pole, this._d1, this._d2);
      // bend-plane normal (same convention as the modelled rest chain); straight arm -> fall back to the pole plane
      const n = this._n.crossVectors(this._d1, this._d2);
      if (n.lengthSq() < 4e-4) n.crossVectors(this._d1, pole);
      n.normalize();
      if (a.n.lengthSq() > 0 && a.n.dot(n) < 0 && this._d1.dot(this._d2) > 0.995) n.negate();   // straight arm: keep the previous roll
      a.n.copy(n);
      const elbow = base.clone().addScaledVector(this._d1, L1);
      const wrist = elbow.clone().addScaledVector(this._d2, L2);
      if (a.seg1) { a.seg1.position.copy(base); this._orient(a.seg1.quaternion, n, this._d1); }
      if (a.seg2) { a.seg2.position.copy(elbow); this._orient(a.seg2.quaternion, n, this._d2); }
      a.world = wrist.clone();
      if (a.claw) {
        a.claw.position.copy(wrist);
        if ((this.mode === 'wall'||this.mode==='ceiling') && hero && (a.planted || a.step)) {
          const d = contactNormal.clone().negate(), cn = pole.clone().cross(d).normalize();
          if (cn.lengthSq() < .001) cn.set(1,0,0);
          this._orient(a.claw.quaternion,cn,d); a.world.addScaledVector(d,clawLength);
        } else if (folded || this.mode === 'swing') {
          const d = new THREE.Vector3(s*.04,this.mode==='packed'?1:-1,this.mode === 'swing' ? -.5 : -.08).applyQuaternion(rootQ).normalize();
          const cn = new THREE.Vector3(1,0,0).applyQuaternion(rootQ).addScaledVector(d,-new THREE.Vector3(1,0,0).applyQuaternion(rootQ).dot(d)).normalize();
          this._orient(a.claw.quaternion,cn,d);
        } else this._orient(a.claw.quaternion, n, this._d2);
      }
      // Nanotech recall: the complete silhouette contracts into the back emblem.
      // Apply after IK so gameplay and the normal deployed poses remain unchanged.
      for(const mesh of [a.seg1,a.seg2,a.claw])if(mesh){
        mesh.visible=this.deployment>0;
        mesh.position.lerp(this.emblem.position,1-unfold);
        mesh.scale.multiplyScalar(unfold);
      }
    }
  }
  setVisible(v) { this.group.visible = v; }
  dispose(scene) { scene.remove(this.group);this.emblem.traverse(o=>{if(o.geometry)o.geometry.dispose();});this.emblemMat.dispose(); }
};

/* ------------------------------------------------------------------ glide membranes (dynamic triangles) */
TL.Membranes = class {
  constructor(scene, color) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(8 * 3 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0.85, emissive: color, emissiveIntensity: 0.15 });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    scene.add(this.mesh); this.amount = 0;
  }
  update(dt, pts, show) {
    this.amount = TL.damp(this.amount, show ? 1 : 0, 8, dt);
    this.mesh.visible = this.amount > 0.02;
    if (!this.mesh.visible) return;
    const P = this.pos; let o = 0;
    const tri = (a, b, c) => { for (const v of [a, b, c]) { P[o++] = v.x; P[o++] = v.y; P[o++] = v.z; } };
    // membranes shrink toward the body as they deploy/retract
    const lerpTo = (p, c) => p.clone().lerp(c, 1 - this.amount);
    const L = pts;
    tri(L.shL, lerpTo(L.wrL, L.shL), L.hipL); tri(L.hipL, lerpTo(L.wrL, L.shL), lerpTo(L.anL, L.hipL));
    tri(L.shR, L.hipR, lerpTo(L.wrR, L.shR)); tri(L.hipR, lerpTo(L.anR, L.hipR), lerpTo(L.wrR, L.shR));
    tri(L.hipL, lerpTo(L.anL, L.hipL), L.crotch); tri(L.crotch, lerpTo(L.anR, L.hipR), L.hipR);
    tri(L.crotch, lerpTo(L.anL, L.hipL), lerpTo(L.anR, L.hipR)); tri(L.shL, L.hipL, L.hipR);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
  dispose(scene) { scene.remove(this.mesh); }
};

/* ------------------------------------------------------------------ hero animator */
/* Poses are sets of model-space bone directions; the traversal poses are weighted blends of key poses
   driven by physics (swing arc phase, fall speed, rope tension, landing impact), never by timers alone.
   Airborne rotations pivot about the physics body center so flips, dives and rope hangs stay on the body. */
TL.HeroAnimator = class {
  constructor(sk, heroName, scene, mat, quality) {
    this.rig = new TL.Rig(sk);
    this.name = heroName;
    this.scene = scene;
    this.phase = 0; this.lastPos = new THREE.Vector3();
    this.rootQ = new THREE.Quaternion(); this.rootQT = new THREE.Quaternion();
    this.lean = 0; this.bank = 0;
    this.trick = null; this.trickT = 0; this.trickDur = 0.8;
    this.action = null;                 // combat action {type, t, dur, side, target}
    this.motion = new TL.TraversalMotion();
    this.arms = heroName === 'WEAVER' ? new TL.TensionArms(scene, mat, this.rig, quality) : null;
    this.membranes = new TL.Membranes(scene, heroName === 'WEAVER' ? 0x8a5a1c : 0x1d2fa8);
    this.handWorld = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.t = 0;
    // physics-driven animation state
    this.prevSt = null; this.prevVy = 0; this.airT = 0;
    this.fall = 0; this.pull = 0;       // freefall dive blend, pull-out (feet first) before impact
    this.arc = 0;                       // smoothed swing arc phase: -1 descending .. +1 rising
    this.landT = 9; this.landAmt = 0;   // landing absorb
    this.recDur = 0.45;
    this.rel = null;                    // coordinated aerial clip {kind, t, dur, dir, reach}
    this.pivotH = 0;                    // rotation pivot height above the feet (0 grounded, FEET airborne)
    this.steps = 0; this.stepSpeed = 0; this.stepSurf = 'ground';   // footstep counter (read by audio)
    this.meshPos = new THREE.Vector3();
    this._e = new THREE.Euler(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, col: null, ground: false, water: false };
    this._rayK = 0; this._impactT = 9;
    // contact animation state (06d_contact_anim.js)
    this.ankleH = this.rig.rest.footL ? this.rig.rest.footL.head.y : 0.12;
    this.catchS = null; this.landRec = null; this.lastLandingId = 0; this.tuckW = 0; this.contactW = 0;
  }
  startTrick(kind) { this.rel=null;this.trick=kind;this.trickT=0;this.trickDur=TL.AerialMotion.clip(kind).duration; }
  playAerial(kind,hand='L') {
    this.rel={kind,t:0,dur:TL.AerialMotion.clip(kind).duration,dir:hand==='L'?1:-1,reach:hand==='L'?'R':'L',entryQ:this.rootQ.clone(),entryOffset:this.contactOffset?this.contactOffset.clone():null};
  }
  /* Rising releases rotate when there is clearance. Low releases open into a stride.
     Variation is deterministic; new catches always take priority. */
  startRelease(hero) {
    if (this.trick) return;
    const V = hero.vel, log = hero.fsm.log, last = log[log.length - 1];
    if (last && last.reason === 'hand-transfer') { this.rel = null; return; }
    const boosted=last&&last.reason==='release-jump', altitude=hero.pos.y-hero.world.ground(hero.pos.x,hero.pos.z);
    const safe=altitude>9 && (V.y>0 || altitude/Math.max(1,-V.y)>1.6);
    const n=this.releaseSerial||0;this.releaseSerial=n+1;
    let kind=TL.SwingStyle.release(hero,n,this.swingStyle);
    if(!safe)kind='sail';
    if(boosted&&n===0&&safe&&!(this.swingStyle&&this.swingStyle.low>.65))kind='flip';
    this.playAerial(kind,hero.tether.main.hand);
  }
  startAction(type, dur, target, side) { this.action = { type, t: 0, dur, target: target ? target.clone() : null, side: side || 1 }; }
  startWebShot(rope) {
    // Dedicated wrist reach survives independently of combat actions. Mirror by the fired hand,
    // not by the anchor side, so a cross-body fallback never changes the shooting arm.
    this.webShot = { hand: rope.hand, target: rope.anchor.clone(), t: 0, dur: Math.max(.32,rope.shotDur||0) };
    this.rel = null; this.trick = null;
  }
  /* hero: HeroController; pos: interpolated render position; dt: frame time */
  update(dt, hero, bodyPos, cam) {
    this.t += dt;
    // physics tracks the body center; the skinned mesh origin is at the feet
    const pos = this._feet || (this._feet = new THREE.Vector3());
    pos.copy(bodyPos); pos.y -= TL.C.FEET;
    const rig = this.rig, S = TL.TS, st = hero.state, V = hero.vel;
    if(!this.aerialFlow)this.aerialFlow=new TL.AerialFlow();
    this.aerialFlow.begin(this,hero,dt);
    if(st===S.SWING)this.swingStyle=TL.SwingStyle.sample(this,hero,dt);
    const hs = Math.hypot(V.x, V.z), speed = V.length();
    const swingWall=st===S.SWING&&!!hero.swingWall&&hero.tether.main.attached;
    const onWall=st===S.WALL||st===S.CRAWL||swingWall;
    const onSurface=onWall||st===S.CEIL;
    const onPole=onWall&&TL.isClimbPole(hero.wallCol);
    const surfaceSpeed=onPole?Math.hypot(V.y,V.x*-hero.wallN.z+V.z*hero.wallN.x):speed;
    this.poleGrip=TL.damp(this.poleGrip||0,onPole?1-TL.smooth(.15,1.5,surfaceSpeed):0,10,dt);
    const heavy = this.name === 'WEAVER';
    const motion = this.motion.update(dt, hero, this);
    const airborne = (s) => s === S.AIR || s === S.DIVE || s === S.GLIDE || s === S.SWING || s === S.LAUNCH || s === S.SLING || s === S.ZIP;
    // ----- state transitions -> one-shot animation events
    const CA = TL.ContactAnim;
    const LR = hero.landing;
    if (CA && LR && LR.id !== this.lastLandingId) {
      // one landing record per physical contact (no re-trigger while standing)
      this.lastLandingId = LR.id; this.landRec = { L: LR, t: 0, feet: null, groundY: bodyPos.y - TL.C.FEET };
      if (LR.kind === 'run') this.phase = Math.floor(this.phase / (2 * Math.PI)) * 2 * Math.PI + Math.PI / 2 - 0.12;   // lead foot is the one reaching
    }
    if (this.landRec) { this.landRec.t += dt; if (this.landRec.t > 1.6 || (st !== S.GROUND && st !== S.RECOVER && st !== S.PERCH)) this.landRec = null; }
    if (CA && st === S.SWING && (this.prevSt !== S.SWING || !this.catchS)) TL.CatchMotion.begin(this, hero);
    else if (st !== S.SWING) this.catchS = null;
    if (st !== this.prevSt) {
      if (!CA && st === S.GROUND && (airborne(this.prevSt) || this.prevSt === S.RECOVER)) {
        this.landT = 0;
        this.landAmt = this.prevSt === S.RECOVER ? 0.55 : TL.clamp((-this.prevVy - 3) / 20, 0.12, 1);
      }
      if (st === S.RECOVER) this.recDur = Math.max(0.2, hero.recoverT);
      if (st === S.AIR && this.prevSt === S.SWING) this.startRelease(hero);
      else if(st===S.AIR) {
        const log=hero.fsm.log,reason=log.length?log[log.length-1].reason:'';
        const moves={'wall-leap':'wall_kick','wall-crest':'wall_vault','perch-jump':'perch_launch','launch-boost':'point_launch','sling-release':'sling_launch','exit-water':'water_launch','support-launch':'pole_vault','quick-recovery':'quick_recovery'};
        if(moves[reason])this.playAerial(moves[reason],hero.tether.main.hand);
      }
      if(st!==S.AIR&&st!==S.DIVE){this.rel=null;this.trick=null;}
    }
    if (this.rel) {
      // Airborne clips expire; a new catch cancels them in the state transition above.
      this.rel.t += dt * (st === S.SWING || st === S.LAUNCH ? 3 : 1);
      if (this.rel.t >= this.rel.dur * 1.2 || !(st === S.AIR || st === S.DIVE || st === S.SWING || st === S.LAUNCH)) this.rel = null;
    }
    const relSpin = this.rel && this.rel.t < this.rel.dur && (st === S.AIR || st === S.DIVE);
    this.landT += dt;
    this.airT = st === S.AIR || st === S.DIVE ? this.airT + dt : 0;
    this.arc = TL.damp(this.arc, TL.clamp(V.y / Math.max(speed, 4), -1, 1), 8, dt);
    // ----- freefall dive blend: builds with fall speed and time falling, pulls out feet-first before impact
    let fallT = 0;
    if (st === S.DIVE) fallT = 1;
    else if (st === S.AIR && !this.trick && !relSpin) fallT = TL.smooth(-8, -22, V.y) * TL.smooth(0.3, 0.9, this.airT);
    let pullT = 0;
    if ((st === S.AIR || st === S.DIVE) && V.y < -4) {
      if (++this._rayK % 3 === 0 || this._impactT > 8) {
        const look = Math.min(80, speed * 1.0);
        const h = hero.world.raycast(bodyPos.x, bodyPos.y, bodyPos.z, V.x, V.y, V.z, look, (c) => c.solid, this._hit);
        this._impactT = h ? h.t / Math.max(speed, 1) : 9;
      } else this._impactT -= dt;
      pullT = 1 - TL.smooth(0.35, 0.85, this._impactT);
    } else this._impactT = 9;
    this.pull = TL.damp(this.pull, pullT, 10, dt);
    fallT *= 1 - this.pull;
    this.fall = TL.damp(this.fall, fallT, fallT > this.fall ? 2.2 : 7, dt);
    // ----- root orientation (world): facing yaw + state-dependent pitch/roll
    let yaw = hero.facing, pitch = 0, roll = 0;
    if(st===S.PERCH&&Number.isFinite(hero.perchFacing))yaw=hero.perchFacing;
    const r = hero.tether.main;
    let ropeDirW = null;
    const zipPose=(st===S.LAUNCH||st===S.ZIP)?TL.ZipMotion.sample(hero):null;
    const preSets = {};
    const vo = CA && st === S.VAULT ? CA.vault(this, hero, { put: (n, v) => { preSets[n] = v; }, D: TL.dirv }) : null;
    const rollDur = .58, rollO = CA && st === S.RECOVER && hero.landing && hero.landing.kind === 'roll' ? CA.roll(this, hero, { put: (n, v) => { preSets[n] = v; }, D: TL.dirv }, hero.fsm.t, rollDur) : null;
    if (st === S.SWING && r.attached) {
      ropeDirW = this._a.copy(r.pivot()).sub(bodyPos).normalize();
    }
    switch (st) {
      case S.GROUND: case S.RECOVER: pitch = TL.clamp(hs * 0.012, 0, 0.22) + (hero.sprinting ? 0.1 : 0); break;
      case S.DIVE: case S.AIR: {
        // head leads along the velocity once the dive takes over (pitch about the shoulders' axis)
        const airP = TL.lerp(.5,1.0,TL.smooth(10,-6,V.y));
        const vf = V.x * Math.sin(yaw) + V.z * Math.cos(yaw);
        const th = TL.clamp(Math.atan2(Math.max(vf, 0), V.y), 1.15, st===S.DIVE?Math.PI-.06:2.45);
        pitch = TL.lerp(airP, th, this.fall);
        if(hero.world.waterFn&&hero.world.waterFn(bodyPos.x,bodyPos.z)&&bodyPos.y<TL.C.WATER_Y+2.8&&hs>14)pitch=.15;
        roll = Math.sin(this.t * 2.3) * 0.012 * this.fall * TL.clamp((speed - 22) / 30, 0, 1);   // wind buffeting
        break;
      }
      case S.GLIDE: pitch = TL.glideRootPitch(hero); roll = hero.glide.roll * 0.9; break;
      case S.VAULT: if (vo) { pitch = vo.pitch; roll = vo.roll; yaw += vo.yawTwist; } break;
      case S.WATER: pitch = 1.3; break;
    }
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const qPR = new THREE.Quaternion().setFromEuler(this._e.set(pitch, 0, -roll, 'XYZ'));
    this.rootQT.copy(qYaw).multiply(qPR);
    // swing phase weights (also shape the body attitude on the rope)
    const spdK = TL.clamp(speed / 30, 0, 1), eK = 0.35 + 0.65 * spdK;
    const desc = TL.smooth(0.05, 0.55, -this.arc), rise = TL.smooth(0.05, 0.55, this.arc), bot = Math.max(0, 1 - desc - rise);
    const tenK = r.attached ? TL.clamp((r.tension / TL.C.G - 1) / 2.5, 0, 1) : 0;
    if (ropeDirW && !swingWall) {
      // swing: body hangs along the rope (up vector toward the anchor), facing the travel direction
      const up = ropeDirW.clone();
      let fwd = V.clone(); fwd.addScaledVector(up, -fwd.dot(up));
      if (fwd.lengthSq() < 1e-4) fwd.set(Math.sin(yaw), 0, Math.cos(yaw)).addScaledVector(up, -up.y);
      fwd.normalize();
      const left = new THREE.Vector3().crossVectors(up, fwd).normalize();
      const m = new THREE.Matrix4().makeBasis(left, up, fwd);
      this.rootQT.setFromRotationMatrix(m);
      // attitude: head leads into the drop (feet trail), feet lead out of the bottom; hang tilts off the rope hand
      const single=hero.singleHandSwing&&st===S.SWING,handSign=r.hand==='L'?1:-1;
      const po = eK * (desc * 0.3 - rise * 0.26 + bot * (single?.18:.06));
      // Offset the torso beneath the loaded shoulder, instead of hanging square
      // beneath the head. Small opposing chest/hip turns keep the pose supple.
      const hs2 = handSign * (single ? -(.24+.1*tenK) : .1+.1*tenK);
      const shoulderTurn=single?handSign*(.12+.1*desc-.08*rise):0;
      this.rootQT.multiply(new THREE.Quaternion().setFromEuler(this._e.set(po, shoulderTurn, hs2, 'XYZ')));
    } else if(zipPose) {
      const target=hero.launch?hero.launch.point:r.pivot();
      const dz=target.z-bodyPos.z,dx=target.x-bodyPos.x;
      const zipYaw=zipPose.braced?Math.atan2(hero.launch.heading.x,hero.launch.heading.z):Math.hypot(dx,dz)>.1?Math.atan2(dx,dz):yaw;
      this.rootQT.setFromEuler(this._e.set(zipPose.pitch,zipYaw,0,'YXZ'));
    } else if (onWall) {
      // feet on the wall: body up = wall-run direction, facing into the wall... keep body parallel to wall
      const n = hero.wallN;
      const running=!onPole&&(st===S.WALL||swingWall);
      const tangent=V.clone().addScaledVector(n,-V.dot(n));
      const upW=running&&tangent.lengthSq()>.2?tangent.normalize():new THREE.Vector3(0,1,0);
      const fwd = new THREE.Vector3(-n.x, 0, -n.z);                       // chest faces the wall
      let upv = upW.clone(); upv.addScaledVector(fwd, -upv.dot(fwd)).normalize();

      const left = new THREE.Vector3().crossVectors(upv, fwd).normalize();
      this.rootQT.setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, upv, fwd));
      if(onPole)this.rootQT.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-.95*this.poleGrip));
    } else if (st === S.CEIL) {
      const fwd=new THREE.Vector3(0,1,0);
      const upv=new THREE.Vector3(V.x,0,V.z);if(upv.lengthSq()<.1)upv.set(Math.sin(yaw),0,Math.cos(yaw));upv.normalize();
      const left = new THREE.Vector3().crossVectors(upv, fwd).normalize();
      this.rootQT.setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, upv, fwd));
    }
    // One coordinated root/limb sample drives the entire acrobatic move.
    let aerial=null;
    if(this.trick && (st===S.AIR||st===S.DIVE)) {
      this.trickT+=dt;
      aerial=TL.AerialMotion.sample(this.trick,this.trickT/this.trickDur);
      if(this.trickT>=this.trickDur*1.2)this.trick=null;
    } else if(this.rel&&(st===S.AIR||st===S.DIVE)) aerial=TL.AerialMotion.sample(this.rel.kind,this.rel.t/this.rel.dur,this.rel.dir);
    if(aerial) {
      if(aerial.pitch!==undefined)this.rootQT.setFromEuler(this._e.set(aerial.pitch,yaw,0,'YXZ'));
      // Preserve the departure attitude before turning into the airborne move.
      if(this.rel&&this.rel.entryQ&&this.rel.t<.22&&this.rel.kind!=='point_launch') {
        const target=this.rootQT.clone();
        this.rootQT.copy(this.rel.entryQ).slerp(target,TL.smooth(0,.22,this.rel.t));
      }
      this.rootQT.multiply(aerial.root);
    }
    if (motion.weight > .01 && !this.trick && !onWall && st !== S.RECOVER && st !== S.CEIL) {
      const m = motion.root;
      this.rootQT.multiply(new THREE.Quaternion().setFromEuler(this._e.set(m.pitch*motion.weight,m.twist*motion.weight,m.roll*motion.weight+(motion.turn || 0),'XYZ')));
    }
    // landing roll: the curled body revolves over the shoulder (diagonal axis); a heavy landing does not spin
    if (rollO) this.rootQT.multiply(new THREE.Quaternion().setFromAxisAngle(rollO.axis, rollO.ang));
    else if (st === S.RECOVER && !CA) { const u = TL.clamp(1 - hero.recoverT / this.recDur, 0, 1); this.rootQT.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), u * u * (3 - 2 * u) * Math.PI * 2)); }
    const catchK = this.catchS ? Math.max(this.catchS.load, TL.smooth(0.3, 0.6, this.catchS.t)) : 1;
    const referencePose=TL.ReferenceMotion&&TL.ReferenceMotion.sample(hero);
    if(referencePose&&!referencePose.keepRoot){
      const target=new THREE.Quaternion().setFromEuler(this._e.set(referencePose.pitch,yaw,referencePose.roll,'YXZ'));
      this.rootQT.slerp(target,referencePose.weight);this.rel=null;this.trick=null;
    }
    const rk = onWall?18:referencePose?32:st === S.SWING ? TL.lerp(5, 10, catchK) : st === S.VAULT ? 20 : this.trick || relSpin || rollO || zipPose&&zipPose.handspring ? 30 : st === S.RECOVER ? 14 : 12;
    // Smooth the flight attitude separately from the unwrapped tube roll.
    // Slerping whole revolutions takes the shortest quaternion path and can
    // erase the spin; apply the distance-driven local-Y rotation afterward.
    const priorSpin=this.passageSpin||0,spinAxis=new THREE.Vector3(0,1,0);
    if(priorSpin)this.rootQ.multiply(new THREE.Quaternion().setFromAxisAngle(spinAxis,-priorSpin));
    this.rootQ.slerp(this.rootQT, 1 - Math.exp(-rk * dt));
    this.passageSpin=referencePose?.spin??TL.damp(priorSpin,Math.round(priorSpin/(Math.PI*2))*Math.PI*2,12,dt);
    if(Math.abs(this.passageSpin%(Math.PI*2))<.0001)this.passageSpin=0;
    if(this.passageSpin)this.rootQ.multiply(new THREE.Quaternion().setFromAxisAngle(spinAxis,this.passageSpin));
    // pivot: rotate about the body center while airborne / rolling, about the feet when standing
    const pivT = onSurface ? TL.C.FEET : rollO ? 0.5 : st === S.RECOVER ? (CA ? 0 : 0.55) : st === S.VAULT ? TL.C.FEET * 0.95 : airborne(st) && !hero.grounded ? TL.C.FEET : 0;
    this.pivotH = TL.damp(this.pivotH, pivT, 10, dt);
    const pv = this._d.set(0, this.pivotH, 0);
    this.meshPos.copy(pos).add(pv).sub(pv.clone().applyQuaternion(this.rootQ));
    if(st===S.CEIL)this.meshPos.y+=TL.lerp(-.18,.28,TL.smooth(.9,.999,new THREE.Vector3(0,0,1).applyQuaternion(this.rootQ).y));
    if(this.rel&&this.rel.entryOffset)this.meshPos.addScaledVector(this.rel.entryOffset,1-TL.smooth(0,.18,this.rel.t));
    // ----- limb poses (model space directions)
    const moved = this._v.copy(pos).sub(this.lastPos); moved.y = 0;
    this.lastPos.copy(pos);
    const D = TL.dirv;
    const sets = {};
    let swingLegDrive=0;
    const put = (n, v) => { sets[n] = v; };
    /* weighted blend of key poses: [[w, {bone: dir}], ...] (all poses in a blend define the same bones) */
    const blend = (list) => {
      const out = {};
      for (const [w, p] of list) if (w > 1e-4) for (const n in p) (out[n] || (out[n] = new THREE.Vector3())).addScaledVector(p[n], w);
      for (const n in out) if (out[n].lengthSq() > 1e-8) put(n, out[n].normalize());
    };
    const limbs = (s, th, sh, ft, ua, fa) => {   // one side of a pose: s = +1 left, -1 right
      const L = s > 0 ? 'L' : 'R', o = {};
      if (th) o['thigh' + L] = th; if (sh) o['shin' + L] = sh; if (ft) o['foot' + L] = ft;
      if (ua) o['uarm' + L] = ua; if (fa) o['farm' + L] = fa;
      return o;
    };
    const both = (f) => Object.assign(f(1), f(-1));
    // high-speed flutter: small fast oscillation on the limbs (wind load)
    const flK = (hero.feedback?hero.feedback.energy:TL.clamp((speed - 20) / 40, 0, 1)) * 0.012;
    const flut = (v, k) => (flK > 0 ? v.clone().add(this._c.set(Math.sin(this.t * 23 + k) * flK, Math.sin(this.t * 19 + k * 2.1) * flK, Math.sin(this.t * 29 + k * 1.3) * flK)).normalize() : v);
    const legRun = (ph, amp, knee) => {
      for (const s of [1, -1]) {
        const p = ph + (s > 0 ? 0 : Math.PI);
        const sw = Math.sin(p) * amp;
        put('thigh' + (s > 0 ? 'L' : 'R'), D(0.05 * s, -Math.cos(sw), Math.sin(sw)));
        const kb = Math.max(0, -Math.cos(p)) * knee + 0.15;
        put('shin' + (s > 0 ? 'L' : 'R'), D(0.02 * s, -Math.cos(sw - kb), Math.sin(sw - kb)));
        put('foot' + (s > 0 ? 'L' : 'R'), D(0, -0.35, 1));
      }
    };
    const armSwing = (ph, amp, elbow) => {
      for (const s of [1, -1]) {
        const p = ph + (s > 0 ? Math.PI : 0);
        const sw = Math.sin(p) * amp;
        put('uarm' + (s > 0 ? 'L' : 'R'), D(0.18 * s, -Math.cos(sw), Math.sin(sw)));
        put('farm' + (s > 0 ? 'L' : 'R'), D(0.1 * s, -Math.cos(sw + elbow), Math.sin(sw + elbow)));
      }
    };
    const countSteps = (prev, cur, surf, spd) => {   // a foot plants each time the phase passes pi/2 + k*pi
      if (Math.floor((cur - Math.PI / 2) / Math.PI) !== Math.floor((prev - Math.PI / 2) / Math.PI)) { this.steps++; this.stepSurf = surf; this.stepSpeed = spd; }
    };
    const iks = [];   // [{hand, t (model space), reach, pole, w, stiff}]
    const rq = this._q.copy(this.rootQ).invert();
    const toModel = (w) => w.clone().sub(this.meshPos).applyQuaternion(rq);
    let spineLean = 0, spineTwist = 0, clavUp = { L: 0, R: 0 }, headBack = 0;
    const plants = [];
    switch (st) {
      case S.GROUND: case S.PERCH: {
        if (st === S.PERCH) {
          // Deep spider crouch: hips between raised, splayed knees, chest over
          // the hands. Exact foot/palm contacts are solved after current-frame FK.
          const breath=Math.sin(this.t*1.65)*.008;
          const cycle=hero.fsm.t%13,shift=TL.smooth(3.5,4.7,cycle)*(1-TL.smooth(7.5,8.8,cycle));
          this.perchShift=hero.perchSupport&&['rail','cap','rounded'].includes(hero.perchSupport.type)?0:shift;
          for(const [side,sg]of [['L',1],['R',-1]]){
            put('thigh'+side,D(sg,.35,.5));put('shin'+side,D(-sg*.45,-1,-.35));put('foot'+side,D(sg*.45,-.35,1));
            put('uarm'+side,D(sg*.15,-1,.25));put('farm'+side,D(-sg*.15,-1,.25));
          }
          spineLean=1.4+breath;spineTwist=-.08*shift;
          rig.hipsOffT.set(-.035*shift,.29-rig.rest.hips.head.y+breath,-.08);
          break;
        }
        rig.hipsOffT.set(0, 0, 0);
        if (hs > 0.5) {
          const stride = heavy ? 1.9 : 2.1;
          const ph0 = this.phase;
          this.phase += moved.length() / stride * Math.PI;
          countSteps(ph0, this.phase, 'ground', hs);
          const run = TL.clamp(hs / 9, 0, 1.4);
          legRun(this.phase, 0.25 + 0.55 * run, 0.6 + 0.9 * run);
          armSwing(this.phase, 0.25 + 0.5 * run, 0.4 + 0.9 * run);
          spineLean = 0.05 + 0.18 * run; spineTwist = Math.sin(this.phase) * 0.15 * run;
          rig.hipsOffT.set(0, -Math.abs(Math.cos(this.phase)) * 0.04 * run, 0);
        } else {
          const b = Math.sin(this.t * 1.8) * 0.02;
          put('thighL', D(0.08, -1, 0.02)); put('thighR', D(-0.08, -1, 0.02)); put('shinL', D(0.02, -1, -0.03)); put('shinR', D(-0.02, -1, -0.03));
          put('footL', D(0.1, -0.35, 1)); put('footR', D(-0.1, -0.35, 1));
          put('uarmL', D(0.28 + b, -1, heavy ? 0.1 : 0.02)); put('uarmR', D(-0.28 - b, -1, heavy ? 0.1 : 0.02));
          put('farmL', D(0.18, -1, 0.25)); put('farmR', D(-0.18, -1, 0.25));
          spineLean = 0.02 + b;
        }
        // landing absorb: hips drop, knees fold (feet stay planted: thigh/shin mirror about the vertical), arms settle forward
        const lt = this.landT, tau = 0.06 + 0.08 * this.landAmt;
        const lw = lt < 1.5 ? this.landAmt * (lt / tau) * Math.exp(1 - lt / tau) : 0;
        if (lw > 0.01) {
          const Lg = rig.thigh + rig.shin, d = Math.min(0.55, 0.5 * lw);
          const al = Math.acos(TL.clamp(1 - d / Lg, -1, 1));
          const k = Math.min(1, lw * 2.2);
          for (const s of [1, -1]) {
            const L = s > 0 ? 'L' : 'R';
            const mixTo = (n, v, w) => put(n, sets[n] ? sets[n].clone().lerp(v, w).normalize() : v);
            mixTo('thigh' + L, D(0.12 * s, -Math.cos(al), Math.sin(al)), k);
            mixTo('shin' + L, D(0.03 * s, -Math.cos(al), -Math.sin(al)), k);
            mixTo('foot' + L, D(0.08 * s, -0.25, 1), k);
            mixTo('uarm' + L, D(0.45 * s, -0.8, 0.45), k * 0.75);
            mixTo('farm' + L, D(0.2 * s, -0.55, 0.8), k * 0.75);
          }
          rig.hipsOffT.y -= Lg * (1 - Math.cos(al)) * k;
          spineLean += 0.55 * lw;
        }
        if (CA && st === S.GROUND) {
          const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
          if (this.landRec) {
            const R = this.landRec, o = CA.landing(this, hero, { put, D }, R.L, R.t);
            const moving = hs > 2;
            rig.hipsOffT.y -= o.drop; spineLean += o.lean;
            if (o.toe) for (const s of ['L', 'R']) put('foot' + s, D(s === 'L' ? 0.05 : -0.05, -0.35 - 0.6 * o.toe, 1));
            if (o.arms > 0.02) for (const s of ['L', 'R']) { const sg = s === 'L' ? 1 : -1; put('uarm' + s, (sets['uarm' + s] || D(sg * .2, -1, 0)).clone().lerp(D(sg * 0.5, -0.75, 0.45), 0.7 * o.arms).normalize()); put('farm' + s, (sets['farm' + s] || D(sg * .1, -1, .2)).clone().lerp(D(sg * 0.2, -0.6, 0.8), 0.7 * o.arms).normalize()); }
            if (o.feet && !moving && o.drop > 0.004) {
              if (!R.feet) R.feet = ['L', 'R'].map((s, i) => { const sg = s === 'L' ? 1 : -1, st2 = (i ? -0.06 : 0.06); return { side: s, p: new THREE.Vector3(pos.x + lx * 0.15 * sg + fx * st2, R.groundY, pos.z + lz * 0.15 * sg + fz * st2) }; });
              for (const f of R.feet) plants.push({ side: f.side, p: f.p, w: 1, exact: false, leg: true });
            }
            if (o.brace && o.brace.w > 0.01) { const sg = o.brace.side === 'L' ? 1 : -1; plants.push({ side: o.brace.side, p: new THREE.Vector3(pos.x + fx * 0.45 + lx * 0.3 * sg, R.groundY, pos.z + fz * 0.45 + lz * 0.3 * sg), w: o.brace.w, exact: false }); }
          }
          const ap = CA.approach(this, hero, { put, D });
          if (ap) { rig.hipsOffT.y -= ap.lower; spineLean += 0.18 * ap.w; for (const q of ap.plants) plants.push(q); }
        }
        break;
      }
      case S.RECOVER: {
        if (rollO) {
          for (const n in preSets) put(n, preSets[n]);
          rig.hipsOffT.set(0, -rollO.drop, 0.05 * rollO.curl); spineLean = rollO.lean; headBack = -0.5 * rollO.head;
          break;
        }
        if (CA && this.landRec) {
          // heavy landing: deep compression with planted feet and a braced hand, then a prompt rise
          const R = this.landRec, o = CA.landing(this, hero, { put, D }, R.L, R.t), fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
          for (const s of ['L', 'R']) { const sg = s === 'L' ? 1 : -1; put('thigh' + s, D(sg * 0.1, -1, 0.05)); put('shin' + s, D(sg * 0.03, -1, -0.05)); put('foot' + s, D(sg * 0.08, -0.3, 1)); put('uarm' + s, D(sg * 0.55, -0.7, 0.45)); put('farm' + s, D(sg * 0.25, -0.5, 0.85)); }
          rig.hipsOffT.set(0, -o.drop, 0); spineLean = o.lean;
          if (!R.feet) R.feet = ['L', 'R'].map((s, i) => { const sg = s === 'L' ? 1 : -1, st2 = i ? -0.08 : 0.08; return { side: s, p: new THREE.Vector3(pos.x + lx * 0.17 * sg + fx * st2, R.groundY, pos.z + lz * 0.17 * sg + fz * st2) }; });
          for (const f of R.feet) plants.push({ side: f.side, p: f.p, w: 1, exact: false, leg: true });
          if (o.brace && o.brace.w > 0.01) { const sg = o.brace.side === 'L' ? 1 : -1; plants.push({ side: o.brace.side, p: new THREE.Vector3(pos.x + fx * 0.5 + lx * 0.32 * sg, R.groundY, pos.z + fz * 0.5 + lz * 0.32 * sg), w: o.brace.w, exact: false }); }
          break;
        }
        // tucked roll: knees to chest, arms wrapped
        rig.hipsOffT.set(0, 0.15, 0);
        blend([[1, both((s) => limbs(s, D(0.16 * s, 0.35, 1), D(0.05 * s, -0.25, -1), D(0, -1, 0.3), D(0.3 * s, -0.35, 0.9), D(-0.35 * s, 0.25, 1)))]]);
        spineLean = 0.75; headBack = -0.3;
        break;
      }
      case S.AIR: case S.DIVE: {
        rig.hipsOffT.set(0, 0, 0);
        const F = this.fall, P = this.pull;
        // rising: launched, stretched and a little tucked; falling slow: skydive spread; fast: streamlined head-first dive
        const wRise = TL.smooth(-3, 5, V.y) * (1 - F);
        const wSpread = (1 - wRise - F) * (1 - P);
        const wLand = (1 - wRise - F) * P;
        const fl = Math.sin(this.t * 4.2), fl2 = Math.sin(this.t * 3.1 + 1);
        blend([
          [wRise, Object.assign(
            limbs(1, D(0.12, -0.3, 0.9), D(0.05, -1, -1), D(0, -0.5, 0.8), D(0.9, 0.55, 0.1), D(0.6, 0.85, 0.4)),
            limbs(-1, D(-0.12, -0.7, 0.45), D(-0.05, -1, -0.7), D(0, -0.5, 0.8), D(-0.9, 0.45, 0.1), D(-0.6, 0.8, 0.4)))],
          [wSpread, both((s) => limbs(s, D(0.16 * s, -1, -0.12), D(0.04 * s, s>0?-.32:-.45, -1), D(0, -.65, -.35),
            D(1 * s, 0.3 + 0.12 * (s > 0 ? fl : fl2), -0.05), D(0.55 * s, 0.75, 0.15 + 0.1 * fl)))],
          [wLand, both((s) => limbs(s, D(0.14 * s, -1, 0.3), D(0.06 * s, -1, -.7), D(0, -0.4, 1), D(0.9 * s, -0.1, 0.3), D(0.5 * s, 0.1, 0.8)))],
          [F, both((s) => limbs(s, D(0.05 * s, -1, -0.06), st===S.DIVE?D(0.025*s,-1,s>0?-.2:-.26):D(0.04*s,s>0?-.38:-.5,-1), D(0, -.8, -.25), D(0.32 * s, -1, -0.3), D(0.18 * s, -1, -0.12)))],
        ]);
        for (const n of ['uarmL', 'uarmR', 'farmL', 'farmR', 'thighL', 'thighR', 'shinL', 'shinR']) if (sets[n]) sets[n] = flut(sets[n], n.length * 1.7 + (n.endsWith('L') ? 0 : 3));
        spineLean = wRise * 0.05 + wSpread * -0.05 + wLand * 0.15 + F * -0.14;
        headBack = F * 0.5;
        if(aerial) {
          for(const n in aerial.pose) put(n,sets[n]?sets[n].clone().lerp(aerial.pose[n],aerial.weight).normalize():aerial.pose[n]);
          spineLean=TL.lerp(spineLean,aerial.lean,aerial.weight);
          rig.hipsOffT.y=aerial.hips||0;
          spineTwist=.12*(this.rel?this.rel.dir:1)*aerial.weight;
        }
        // clearance tuck through a narrow opening: knees and elbows in (the collision shape is tucked too)
        this.tuckW = TL.damp(this.tuckW, hero.tuck || 0, hero.tuck ? 18 : 9, dt);
        if (this.tuckW > 0.01) {
          const w = this.tuckW;
          for (const [s, sg] of [['L', 1], ['R', -1]]) {
            const ball = { thigh: D(sg * 0.12, 0.25, 1), shin: D(sg * 0.04, -1, -0.45), foot: D(0, -0.9, 0.3), uarm: D(sg * 0.3, -0.55, 0.75), farm: D(-sg * 0.25, 0.45, 0.85) };
            for (const b in ball) put(b + s, (sets[b + s] || ball[b]).clone().lerp(ball[b], w).normalize());
          }
          spineLean = TL.lerp(spineLean, 0.55, w);
        }
        // A fast pass over water has a low, forward foot and a trailing leg.
        const nearWater=hero.world.waterFn&&hero.world.waterFn(bodyPos.x,bodyPos.z)&&bodyPos.y<TL.C.WATER_Y+2.8&&hs>14;
        if(nearWater) {
          put('thighL',D(.16,-.55,.85));put('shinL',D(.05,-.8,.6));
          put('thighR',D(-.18,-1,-.35));put('shinR',D(-.05,-1,-.55));
          put('uarmL',D(1,.15,.2));put('uarmR',D(-1,.25,-.1));spineLean=.15;
        }
        break;
      }
      case S.LAUNCH: case S.ZIP: {
        const z=zipPose;
        const sink=rig.thigh*(1-Math.cos(z.hip))+rig.shin*(1-Math.cos(z.hip-z.knee));
        rig.hipsOffT.set(0,z.handspring?0:z.braced?-sink:-.14*z.arrive,0);
        for(const side of ['L','R']) {
          const s=side==='L'?1:-1;
          put('thigh'+side,D(s*.14,-Math.cos(z.hip),Math.sin(z.hip)));
          put('shin'+side,D(s*.04,-Math.cos(z.hip-z.knee),Math.sin(z.hip-z.knee)));
          put('foot'+side,D(s*.02,-.6,.5));
          const rp=hero.tether.ropes.find(q=>q.active&&q.hand===side);
          if(rp) {
            const shoulder=rig.P['uarm'+side].lengthSq()?rig.P['uarm'+side]:rig.rest['uarm'+side].head;
            const direction=toModel(rp.pivot()).sub(shoulder).normalize();
            const wrist=shoulder.clone().addScaledVector(direction,(rig.upperArm+rig.foreArm)*.97);
            const pulled=shoulder.clone().add(new THREE.Vector3(s*.12,-.48,-.32));
            wrist.lerp(pulled,z.pull*(1-.7*z.arrive));
            if(z.braced) {
              const hand=hero.launch.point.clone();
              hand.x+=Math.cos(yaw)*s*.3;hand.z-=Math.sin(yaw)*s*.3;hand.y+=.035;
              wrist.copy(toModel(hand));
            }
            iks.push({hand:side,t:wrist,reach:1,exact:true,pole:D(s,-.15,-.85),w:1,stiff:z.braced?50:30});
            clavUp[side]=.12*(1-z.pull);
          }
        }
        spineLean=z.handspring?TL.lerp(-.04,1.05,z.coil):TL.lerp(-.12,.7,z.arrive);headBack=.3*(1-z.arrive);
        break;
      }
      case S.VAULT: {
        for (const n in preSets) put(n, preSets[n]);
        if (vo) {
          rig.hipsOffT.copy(vo.hips); spineLean = vo.lean; spineTwist = vo.twist; headBack = -vo.head;
          clavUp.L = vo.clav.L; clavUp.R = vo.clav.R;
          for (const q of vo.plants) plants.push(q);
          // arms not on a support swing with the stride
          for (const s of ['L', 'R']) if (!sets['uarm' + s]) { const sg = s === 'L' ? 1 : -1; put('uarm' + s, D(sg * 0.35, -0.8, 0.3)); put('farm' + s, D(sg * 0.2, -0.5, 0.8)); }
        }
        break;
      }
      case S.SLING: {
        const sl=hero.sling,load=sl?TL.clamp(sl.pull/8,0,1):0;
        const hip=TL.lerp(.65,1.48,load),knee=TL.lerp(1.1,2.65,load);
        const sink=rig.thigh*(1-Math.cos(hip))+rig.shin*(1-Math.cos(hip-knee));
        rig.hipsOffT.set(0,sl&&sl.braced?-sink:-.12,0);
        for(const side of ['L','R']) {
          const s=side==='L'?1:-1;
          put('thigh'+side,D(s*.25,-Math.cos(hip),Math.sin(hip)));
          put('shin'+side,D(s*.08,-Math.cos(hip-knee),Math.sin(hip-knee)));
          put('foot'+side,D(s*.06,-.3,1));
          const rp=hero.tether.ropes.find(q=>q.active&&q.hand===side);
          if(rp)iks.push({hand:side,t:toModel(rp.pivot()),reach:TL.lerp(.9,.56,load),pole:D(s,-.35,-.8),w:1,stiff:28});
        }
        spineLean=TL.lerp(.08,.42,load);headBack=.12;break;
      }
      case S.SWING: {
        rig.hipsOffT.set(0, 0, 0);
        const both2 = false;
        const ropeHand = r.hand === 'L' ? 'L' : 'R', freeS = ropeHand === 'L' ? -1 : 1;
        const pulse = !heavy;
        // legs: hang (slow) / trail behind on the drop / knees tucked through the bottom / kick out on the rise
        const e = eK;
        const kickF = pulse ? 1.25 : 0.9;
        blend([
          [1 - e, both((s) => limbs(s, D(0.08 * s, -1, 0.12), D(0.03 * s, -1, -0.28), D(0, -0.6, 0.8)))],
          [e * desc, both((s) => limbs(s, D(0.07 * s, -1, -0.26 - (s > 0 ? 0.08 : 0)), D(0.03 * s, -1, -0.42), D(0, -1, 0.25)))],
          [e * bot, both((s) => limbs(s, D(0.14 * s, -0.3 + (s > 0 ? 0.12 : 0), 1), D(0.05 * s, -1, -0.12), D(0, -0.6, 0.8)))],
          [e * rise, Object.assign(
            limbs(1, D(0.09, -0.7, 0.7 * kickF), D(0.05, -0.5, 0.9), D(0, -0.2, 1)),
            limbs(-1, pulse ? D(-0.12, -1, -0.3) : D(-0.09, -0.7, 0.6), pulse ? D(-0.05, -1, -0.5) : D(-0.05, -0.6, 0.8), D(0, -0.4, 1)))],
        ]);
        const CS = this.catchS && r.attached ? TL.CatchMotion.update(this, hero, dt, toModel(r.pivot())) : null;
        if (st === S.SWING && r.attached) {
          // A single sweep through the pendulum arc, never a time-looping squat.
          const pump = TL.PendulumMotion.sample(hero);
          swingLegDrive=pump.drive;
          // catch: legs trail briefly on a loaded descending catch, never delaying the forward drive
          const trail = CS ? CS.load * (1 - TL.smooth(0.06, 0.32, CS.t)) * (1 - pump.drive) * 0.35 : 0;
          for (const side of ['L','R']) {
            const s = side === 'L' ? 1 : -1, hip = pump.hip + s*pump.asymmetry - trail, knee = pump.knee + trail * 0.6;
            put('thigh'+side,D(.065*s,-Math.cos(hip),Math.sin(hip)));
            put('shin'+side,D(.025*s,-Math.cos(hip-knee),Math.sin(hip-knee)));
            put('foot'+side,D(.02*s,-.55, .65));
          }
          if (CS) {
            // airborne legs blend into the pendulum within ~0.16 s; the pelvis lags the loaded chest
            const w = TL.CatchMotion.legBlend(CS), hsg = r.hand === 'L' ? 1 : -1;
            const lag = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(CS.chest - CS.pelvis) * hsg * 0.55);
            for (const n of ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR']) {
              const v = CS.legs[n].clone().lerp(sets[n], w).normalize().applyQuaternion(lag);
              put(n, v);
            }
          }
        }
        // rope arm(s): IK onto the actual line — slight elbow bend when easy, locked straight under load
        const shoulderOf = (s) => (rig.P['uarm' + s].lengthSq() > 0 ? rig.P['uarm' + s].clone() : rig.rest['uarm' + s].head.clone());
        const reach = rig.upperArm + rig.foreArm;
        for (const rp of hero.tether.ropes) if (rp.active) {
          const s = rp.hand === 'L' ? 'L' : 'R', sg = s === 'L' ? 1 : -1;
          // grip -> load: an easy arm while slack, extended under load, a short elbow give on a hard catch
          const ab = CS && rp === r ? CS.absorb : 0, ld = CS && rp === r ? Math.max(CS.load, tenK) : tenK;
          const cross = CS && CS.cross && rp === r;
          iks.push({ hand: s, t: toModel(rp.pivot()), reach: TL.lerp(0.88, 0.99, ld) - 0.2 * ab, pole: D(sg * (cross ? 0.4 : 1), -0.1 - 0.45 * ab, cross ? -0.8 : -0.35), w: 1, stiff: 24 + 12 * ab });
          clavUp[s] = 0.35 + 0.25 * ld + 0.2 * ab;
        }
        // free arm: trails out behind on the drop, comes forward through the bottom, reaches ahead on the rise;
        // under heavy load at the bottom it joins the rope hand on the line
        if (!both2) {
          const fs = freeS, F = fs > 0 ? 'L' : 'R';
          blend([
            [1 - e, limbs(fs, null, null, null, D(0.55 * fs, -0.8, -0.1), D(0.3 * fs, -0.8, 0.3))],
            [e * desc, limbs(fs, null, null, null, D(0.75 * fs, -0.45, -0.45), D(0.45 * fs, -0.55, 0.05))],
            [e * bot, limbs(fs, null, null, null, D(0.55 * fs, -0.6, 0.35), D(0.1 * fs, -0.2, 1))],
            [e * rise, limbs(fs, null, null, null, D(0.55 * fs, 0.35, 0.6), D(0.3 * fs, 0.75, 0.55))],
          ]);
          for (const n of ['uarm' + F, 'farm' + F]) sets[n] = flut(sets[n], fs * 5);
          const grip = hero.singleHandSwing || swingWall ? 0 : bot * tenK * spdK * 0.8;
          if (grip > 0.05 && r.active) {
            const sm = shoulderOf(ropeHand), dirM = toModel(r.pivot()).sub(sm).normalize();
            const gp = sm.addScaledVector(dirM, reach * 0.9 - 0.24);
            iks.push({ hand: F, t: gp, reach: 1, pole: D(fs, -0.6, 0.3), w: grip, stiff: 16, exact: true });
          }
          spineTwist = (ropeHand === 'R' ? 1 : -1) * (0.12 + 0.1 * tenK);
          if (CS) {
            // the chest turns after the loaded shoulder (cross-body: toward the anchor), the pelvis follows later
            const ts = CS.cross ? -(ropeHand === 'R' ? 1 : -1) : (ropeHand === 'R' ? 1 : -1);
            spineTwist += ts * 0.2 * CS.chest * (CS.wide ? 1.3 : 1) - (ropeHand === 'R' ? 1 : -1) * 0.12 * (CS.chest - CS.pelvis);
            // free arm thrown out for balance on a strong catch
            const fb = CS.load * (1 - TL.smooth(0.25, 0.65, CS.t)) * 0.75;
            if (fb > 0.02) { const F = freeS > 0 ? 'L' : 'R'; put('uarm' + F, sets['uarm' + F].clone().lerp(D(freeS * 0.95, 0.25, -0.3), fb).normalize()); put('farm' + F, sets['farm' + F].clone().lerp(D(freeS * 0.85, 0.35, 0.1), fb).normalize()); }
          }
          if (hero.singleHandSwing) {
            // One loaded shoulder, opposite arm counterbalances; torso follows cross-body anchors.
            const anchorLocal = toModel(r.pivot());
            spineTwist += TL.clamp(anchorLocal.x * 0.012, -0.22, 0.22);
            blend([
              [desc,limbs(fs,null,null,null,D(fs*.55,-.65,-.65),D(fs*.2,-.65,-.1))],
              [bot,limbs(fs,null,null,null,D(fs*.6,-.75,-.15),D(-fs*.15,-.25,.9))],
              [rise,limbs(fs,null,null,null,D(fs*.7,.1,.55),D(fs*.3,.45,.8))]
            ]);
            rig.hipsOffT.x=freeS*.055;
            rig.hipsOffT.y=-.035;
            clavUp[ropeHand]=.55+.15*tenK;
          }
        }
        spineLean = e * (desc * -0.1 + bot * 0.28 - rise * 0.22);
        // Read the street clearance and anchor side, rather than cycling poses
        // on a timer. Keep the established hip drive and rope-hand IK intact.
        const style=this.swingStyle;
        if(style) {
          this.styleLow=TL.damp(this.styleLow||0,style.low,7,dt);
          this.styleHigh=TL.damp(this.styleHigh||0,style.high,7,dt);
          const low=this.styleLow*style.fast,high=this.styleHigh;
          spineLean+=e*(low*.12*bot-high*.1*rise);
          if(!both2) {
            const F=freeS>0?'L':'R',u=sets['uarm'+F],f=sets['farm'+F];
            const open=style.cross?D(freeS*.95,-.2,-.35):D(freeS*.7,.35,.6);
            if(u)u.lerp(open,e*(style.cross?.3:high*.22)*rise).normalize();
            if(f)f.lerp(D(freeS*.35,-.55,.65),low*.3*bot).normalize();
          }
          // A small stagger gives high arcs a long silhouette; low swings stay
          // narrow. Both modes use identical legs and identical pendulum timing.
          for(const side of ['L','R']) {
            const thigh=sets['thigh'+side];
            if(thigh){thigh.x+=(side==='L'?1:-1)*high*.08*rise;thigh.normalize();}
          }
        }
        break;
      }
      case S.GLIDE: {   // deploy sequence + glide pose: see 06c_glide.js
        const gp = TL.glidePose(this, hero, put, D, flut);
        spineLean = gp.spineLean; spineTwist = gp.spineTwist; headBack = gp.headBack;
        break;
      }
      case S.WALL: case S.CRAWL: case S.CEIL: {
        // limbs toward the surface (model -Z... chest faces the wall = +Z), crawling cycle
        const ph0 = this.phase;
        this.phase += speed * dt * (st === S.WALL ? 1.6 : 3.2);
        if (st === S.WALL) countSteps(ph0, this.phase, 'wall', speed);
        const c = Math.sin(this.phase), cc = Math.cos(this.phase);
        const sp = st === S.WALL ? 0.6 : 0.35;
        put('uarmL', D(0.6, 0.5 + c * sp, 0.6)); put('farmL', D(0.2, 0.3 + c * sp, 0.9));
        put('uarmR', D(-0.6, 0.5 - c * sp, 0.6)); put('farmR', D(-0.2, 0.3 - c * sp, 0.9));
        put('thighL', D(0.45, -0.5 - cc * sp, 0.7)); put('shinL', D(0.2, -1, 0.2));
        put('thighR', D(-0.45, -0.5 + cc * sp, 0.7)); put('shinR', D(-0.2, -1, 0.2));
        rig.hipsOffT.set(0, 0, st === S.WALL ? 0 : 0.08);
        spineLean = st === S.CRAWL ? 0.25 : 0.1;
        if (hero.corner) {
          const Cn = hero.corner, u = TL.clamp(Cn.t / Cn.dur, 0, 1), yC = bodyPos.y + 0.45;
          const lead = toModel(new THREE.Vector3(Cn.E.x, yC, Cn.E.z)).x > 0 ? 'L' : 'R', trailH = lead === 'L' ? 'R' : 'L';
          plants.push({ side: lead, p: new THREE.Vector3(Cn.E.x + Cn.out.x * 0.32 + Cn.n1.x * 0.03, yC - 0.05, Cn.E.z + Cn.out.z * 0.32 + Cn.n1.z * 0.03), w: TL.smooth(0, 0.3, u), exact: false, pole: D(lead === 'L' ? 1 : -1, -0.5, -0.3) });
          plants.push({ side: trailH, p: new THREE.Vector3(Cn.E.x - Cn.n1.x * 0.3 + Cn.n0.x * 0.03, yC - 0.25, Cn.E.z - Cn.n1.z * 0.3 + Cn.n0.z * 0.03), w: 1 - TL.smooth(0.45, 0.85, u), exact: false, pole: D(trailH === 'L' ? 1 : -1, -0.5, -0.3) });
          spineTwist = (lead === 'L' ? 1 : -1) * 0.25 * Math.sin(Math.PI * u);
        }
        break;
      }
      case S.WATER: {
        const sw = this.t * 3;
        put('uarmL', D(0.6, Math.sin(sw) * 0.6, Math.cos(sw))); put('uarmR', D(-0.6, -Math.sin(sw) * 0.6, -Math.cos(sw)));
        put('thighL', D(0.1, -1, Math.sin(sw * 2) * 0.3)); put('thighR', D(-0.1, -1, -Math.sin(sw * 2) * 0.3));
        break;
      }
    }
    // Authored accents blend over locomotion; rope-hand IK and combat keep priority.
    if (motion.weight > .01 && !onSurface) {
      for (const n in motion.out) {
        const isArm = n.startsWith('uarm') || n.startsWith('farm');
        if (isArm && (iks.some(k => n.endsWith(k.hand)) || ((st === S.WALL || st === S.CRAWL) && !this.arms))) continue;
        const base = sets[n] || rig.target[n];
        if (base) put(n,base.clone().lerp(motion.out[n],motion.weight).normalize());
      }
      spineLean = TL.lerp(spineLean,motion.lean || 0,motion.weight);
      if (st === S.GROUND) rig.hipsOffT.y += motion.root.hips*motion.weight;
    }
    if(onPole&&this.poleGrip>.01){
      const w=this.poleGrip;
      for(const [n,d]of Object.entries({uarmR:D(-.25,-1,.05),farmR:D(.12,-1,.1),handR:D(0,-1,.08)}))
        put(n,(sets[n]||rig.target[n]).clone().lerp(d,w).normalize());
      spineLean=TL.lerp(spineLean,.04,w);spineTwist=TL.lerp(spineTwist,-.1,w);
      rig.hipsOffT.lerp(new THREE.Vector3(0,-.06,-.04),w);
    }
    // Surface gait owns the final locomotion pose; loaded rope hands retain their IK.
    if(onSurface&&!onPole&&TL.WallMotion){
      const wallPose=TL.WallMotion.pose(this,hero,dt,put,D,iks);
      spineLean=wallPose.lean;spineTwist=wallPose.twist;
    } else this.wallContacts=null;
    // combat action overrides (upper body / kicks)
    if (this.action) {
      const A = this.action; A.t += dt;
      const u = TL.clamp(A.t / A.dur, 0, 1);
      const ext = Math.sin(Math.min(u * 1.6, 1) * Math.PI * 0.5) * (1 - TL.smooth(0.7, 1, u));
      const s = A.side;
      const sideL = s > 0 ? 'L' : 'R';
      switch (A.type) {
        case 'jab': case 'light': put('uarm' + sideL, D(0.2 * s, TL.lerp(-0.6, 0.05, ext), TL.lerp(0.4, 1, ext))); put('farm' + sideL, D(0.05 * s, TL.lerp(0.3, 0.02, ext), 1)); spineTwist = -s * 0.4 * ext; break;
        case 'heavy': put('uarm' + sideL, D(0.5 * s, TL.lerp(0.9, -0.2, ext), TL.lerp(-0.2, 1, ext))); put('farm' + sideL, D(0.1 * s, TL.lerp(0.9, -0.3, ext), TL.lerp(0, 1, ext))); spineLean = 0.3 * ext; spineTwist = -s * 0.6 * ext; break;
        case 'kick': put('thigh' + sideL, D(0.1 * s, TL.lerp(-1, 0.15, ext), TL.lerp(0.1, 1, ext))); put('shin' + sideL, D(0.05 * s, TL.lerp(-1, 0.1, ext), 1)); spineLean = -0.25 * ext; break;
        case 'launcher': put('uarm' + sideL, D(0.2 * s, TL.lerp(-0.8, 1, ext), 0.4)); put('farm' + sideL, D(0.1 * s, 1, 0.1)); spineLean = -0.3 * ext; break;
        case 'slam': for (const q of ['L', 'R']) { const sg = q === 'L' ? 1 : -1; put('uarm' + q, D(0.3 * sg, TL.lerp(1, -0.8, ext), 0.4)); put('farm' + q, D(0.1 * sg, TL.lerp(1, -1, ext), 0.3)); } spineLean = 0.6 * ext; break;
        case 'shoot': case 'pull': case 'zip':
          // point the shooting wrist at the real target (web anchor / enemy); snap out, ease back
          if (A.target && !iks.some((k) => k.hand === sideL)) {
            const w = Math.max(ext, u < 0.6 ? 1 : 0);
            iks.push({ hand: sideL, t: toModel(A.target), reach: 1, pole: D(s, -0.4, -0.2), w, stiff: 40 });
            clavUp[sideL] = 0.2;
          } else if (!A.target) { put('uarm' + sideL, D(0.1 * s, 0.1, 1)); put('farm' + sideL, D(0.05 * s, 0.05, 1)); }
          break;
        case 'dodge': spineLean = -0.2; break;
        case 'parry': put('uarmL', D(0.2, 0.3, 1)); put('farmL', D(-0.3, 0.8, 0.4)); put('uarmR', D(-0.2, 0.3, 1)); put('farmR', D(0.3, 0.8, 0.4)); break;
        case 'cast': for (const q of ['L', 'R']) { const sg = q === 'L' ? 1 : -1; put('uarm' + q, D(0.6 * sg, 0.4, 0.8)); put('farm' + q, D(0.4 * sg, 0.3, 1)); } break;
      }
      if (u >= 1) this.action = null;
    }
    if (this.webShot) {
      const shot = this.webShot; shot.t += dt;
      const u = TL.clamp(shot.t / shot.dur, 0, 1), sg = shot.hand === 'L' ? 1 : -1;
      const loaded = r.active && r.hand === shot.hand;
      const reach = TL.smooth(0, 0.12, u);
      const settle = 1 - TL.smooth(0.55, 1, u);
      if (!iks.some((k) => k.hand === shot.hand)) {
        iks.push({ hand: shot.hand, t: toModel(loaded ? r.anchor : shot.target),
          reach: TL.lerp(0.72, 0.98, reach), pole: D(sg, -0.35, -0.3),
          w: reach * (loaded ? 1 : settle), stiff: 28 });
        clavUp[shot.hand] = (.25+.18*(1-TL.smooth(.1,.5,u))) * reach;
      }
      spineTwist += -sg * 0.16 * Math.sin(u * Math.PI);
      if (u >= 1) this.webShot = null;
    }
    if(TL.TraversalExpression){
      const expression=TL.TraversalExpression.update(this,hero,dt,iks,toModel,D,onSurface);
      spineTwist+=expression.twist;spineLean+=expression.loadLean;rig.hipsOffT.x+=expression.shift;rig.hipsOffT.y-=expression.loadDrop;
    }
    // arm IK (rope hands, shooting wrist). Uses last frame's shoulder joints: they barely move frame to frame,
    // and solving before the single apply() means the rope arm is never pulled back toward a canned pose.
    rig.boneStiff = {};
    if (st === S.GLIDE) TL.glideStiff(rig, hero);
    if(swingLegDrive>0)for(const side of ['L','R'])for(const bone of ['thigh','shin','foot'])rig.boneStiff[bone+side]=24;
    if(st===S.VAULT)for(const side of ['L','R'])for(const bone of ['thigh','shin','foot'])rig.boneStiff[bone+side]=40;   // legs must clear the obstacle on time
    for (const k of iks) {
      const s = k.hand;
      const root = rig.P['uarm' + s].lengthSq() > 0 ? rig.P['uarm' + s].clone() : rig.rest['uarm' + s].head.clone();
      const dir = k.t.clone().sub(root); const dist = dir.length();
      const reachL = (rig.upperArm + rig.foreArm) * k.reach;
      const tgt = k.exact && dist < reachL ? k.t : root.clone().addScaledVector(dir.normalize(), reachL);
      const d1 = new THREE.Vector3(), d2 = new THREE.Vector3();
      rig.ik2(root, tgt, rig.upperArm, rig.foreArm, k.pole, d1, d2);
      const mix = (n, v) => { const b = sets[n] || rig.target[n]; put(n, k.w >= 0.999 ? v : b.clone().lerp(v, k.w).normalize()); };
      mix('uarm' + s, d1); mix('farm' + s, d2); put('hand' + s, sets['farm' + s].clone());
      if (k.w > 0.5) { rig.boneStiff['uarm' + s] = k.stiff; rig.boneStiff['farm' + s] = k.stiff; rig.boneStiff['hand' + s] = k.stiff; }
    }
    // shoulders shrug up with a raised / loaded arm
    for (const s of ['L', 'R']) if (clavUp[s] > 0 && rig.rest['clav' + s]) put('clav' + s, rig.rest['clav' + s].dir.clone().add(this._d.set(0, clavUp[s], 0.05)).normalize());
    // spine / head
    const sl = spineLean;
    const shoulderBend=st===S.SWING&&r.attached&&hero.singleHandSwing?(r.hand==='L'?1:-1)*.12:0;
    put('spine', D(shoulderBend*.45, 1, sl * 0.6)); put('chest', D(shoulderBend, 1, sl)); put('neck', D(-shoulderBend*.3, 1, sl * 0.3 - headBack * 0.3));
    rig.twist.spine = spineTwist * 0.5; rig.twist.chest = spineTwist;
    // A standing look uses yaw about the neck, not sideways tilt of its up axis.
    let headYaw=0;
    if (cam) {
      const lookW = cam.fwd.clone(); const lookL = lookW.applyQuaternion(this._q.copy(this.rootQ).invert());
      if(st===S.GROUND||st===S.PERCH) {
        headYaw=lookL.z>0?TL.clamp(Math.atan2(lookL.x,lookL.z),-.55,.55):0;
        put('head',D(0,1,.04-TL.clamp(lookL.y,-.15,.15)));
      } else {
        const hd = D(TL.clamp(lookL.x, -0.6, 0.6), 1.0 + TL.clamp(lookL.y, -0.5, 0.5), Math.max(0.2, lookL.z) * 0.35);
        put('head', headBack > 0 ? hd.lerp(D(hd.x, 1, -0.55), headBack).normalize() : hd);
      }
    }
    rig.twist.head=TL.damp(rig.twist.head||0,headYaw,10,dt);
    if(zipPose&&zipPose.coil>0) {
      const curl=zipPose.coil;
      put('neck',sets.neck.clone().lerp(D(0,.8,.6),curl).normalize());
      put('head',(sets.head||D(0,1,0)).clone().lerp(D(0,.8,.55),curl).normalize());
    }
    if(aerial&&aerial.tuck>0) {
      const curl=aerial.tuck*aerial.weight;
      put('neck',sets.neck.clone().lerp(D(0,.8,.6),curl).normalize());
      put('head',(sets.head||D(0,1,0)).clone().lerp(D(0,.7,.7),curl).normalize());
    }
    if(referencePose)for(const [n,d]of Object.entries(referencePose.pose))put(n,(sets[n]||rig.target[n]).clone().lerp(d,referencePose.weight).normalize());
    if(!referencePose)this.aerialFlow.apply(this,hero,sets,iks);
    for (const n in sets) rig.set(n, sets[n]);
    for (const n of ['clavL', 'clavR', 'handL', 'handR']) if (!sets[n]) {
      if (n.startsWith('hand')) { const f = rig.target['farm' + n.slice(4)]; if (f) rig.target[n].copy(f); } else rig.setRest(n);
    }
    const landing = this.landT < 0.5 && this.landAmt > 0.2;
    rig.stiff = st === S.SWING ? 12 : referencePose || aerial || zipPose&&zipPose.handspring ? 28 : st === S.VAULT ? 24 : this.action || landing || this.landRec && this.landRec.t < 0.5 ? 26 : st === S.RECOVER ? 22 : 16;
    // mesh transform: rotate about the pivot (body center when airborne) so the body stays on the physics point
    this.rig.mesh.position.copy(this.meshPos);
    this.rig.mesh.quaternion.copy(this.rootQ);
    rig.apply(dt);
    if(onSurface&&!onPole&&!hero.corner&&!this.action&&TL.WallMotion)TL.WallMotion.plant(this,hero,dt,iks);
    if(TL.TraversalExpression)TL.TraversalExpression.plant(this);
    if(referencePose&&TL.ReferenceMotion.grip)TL.ReferenceMotion.grip(this,hero,referencePose);
    if (CA && plants.length) CA.plant(this, plants, this.meshPos, this.rootQ);
    if (CA && vo && hero.action) CA.clearLimbs(this, hero.action.plan, this.meshPos, this.rootQ, hero.action.u);
    if (rollO) {
      // the curled body rolls ON the surface: its lowest point (shoulder / back / knees / head) keeps contact
      let low = Infinity; const w = this._c;
      for (const b of ['head', 'neck', 'chest', 'spine', 'hips', 'shinL', 'shinR', 'footL', 'footR', 'handL', 'handR', 'farmL', 'farmR', 'uarmL', 'uarmR']) {
        if (!rig.P[b]) continue; w.copy(rig.P[b]).applyQuaternion(this.rootQ).add(this.meshPos); low = Math.min(low, w.y);
      }
      const gy = this.landRec ? this.landRec.groundY : pos.y, want = gy + 0.07 * rollO.curl + 0.02;
      if (Number.isFinite(low)) { this.meshPos.y += TL.clamp(want - low, -0.25, 0.6) * TL.smooth(0, 0.08, rollO.curl + 0.02); rig.mesh.position.copy(this.meshPos); }
    }
    if(onPole&&this.poleGrip>.01){
      // Grip the real shaft surface, not a pair of imaginary wide wall contacts.
      const n=hero.wallN,p=bodyPos;
      const hit=hero.world.raycast(p.x,p.y,p.z,-n.x,0,-n.z,1.2,c=>c===hero.wallCol,null,{noGround:true});
      if(hit){
        for(const b of rig.order)rig.target[b].copy(rig.cur[b]);
        rig.hipsOffT.copy(rig.hipsOff);rig.hipsQT.copy(rig.hipsQ);
        const inv=this.rootQ.clone().invert(),w=this.poleGrip;
        const target=y=>new THREE.Vector3(hit.x+n.x*.025,p.y-TL.C.FEET+y,hit.z+n.z*.025).sub(this.meshPos).applyQuaternion(inv);
        const solve=(upper,lower,end,y,L1,L2,pole)=>{
          const a=new THREE.Vector3(),b=new THREE.Vector3();rig.ik2(rig.P[upper],target(y),L1,L2,pole,a,b);
          rig.set(upper,rig.cur[upper].clone().lerp(a,w).normalize());rig.set(lower,rig.cur[lower].clone().lerp(b,w).normalize());
          rig.set(end,end.startsWith('foot')?D(.4,-.3,.7):D(.45,.15,.7));
        };
        solve('uarmL','farmL','handL',1.85,rig.upperArm,rig.foreArm,D(.5,.2,-1));
        solve('thighL','shinL','footL',.78,rig.thigh,rig.shin,D(1,.5,-.1));
        solve('thighR','shinR','footR',.12,rig.thigh,rig.shin,D(-.4,.1,.8));
        rig.apply(0);
      }
    }
    if(st===S.PERCH){
      // Keep the support points fixed while breathing/looking/weight shifting.
      // The ledge centre is the controller's foot plane; no phantom chair seat.
      for(const n of rig.order)rig.target[n].copy(rig.cur[n]);
      rig.hipsOffT.copy(rig.hipsOff);rig.hipsQT.copy(rig.hipsQ);
      const plane=hero.perchPoint.clone();plane.y-=TL.C.FEET;
      const inv=this.rootQ.clone().invert();
      const support=hero.perchSupport;
      const local=(x,y,z)=>(support?TL.PerchSupport.contact(support,x,y,z):new THREE.Vector3(x,y,z).applyQuaternion(this.rootQ).add(plane)).sub(this.meshPos).applyQuaternion(inv);
      const narrow=support&&['rail','cap','rounded'].includes(support.type),rail=support&&support.type==='rail';
      for(const [side,sg]of [['L',1],['R',-1]]){
        const leg1=new THREE.Vector3(),leg2=new THREE.Vector3();
        rig.ik2(rig.P['thigh'+side],local(sg*(narrow?.10:.34),.095,rail?sg*.19:-.035),rig.thigh,rig.shin,D(sg, .55,.75),leg1,leg2);
        rig.set('thigh'+side,leg1);rig.set('shin'+side,leg2);rig.set('foot'+side,D(sg*.42,-.45,1));
        const lift=side==='R'?(this.perchShift||0):0;
        const palm=local(sg*TL.lerp(narrow?.09:.16,.46,lift),TL.lerp(.055,.43,lift),TL.lerp(.12,-.05,lift));
        const arm1=new THREE.Vector3(),arm2=new THREE.Vector3();
        rig.ik2(rig.P['uarm'+side],palm,rig.upperArm,rig.foreArm,D(sg*.6,-.05,-1),arm1,arm2);
        rig.set('uarm'+side,arm1);rig.set('farm'+side,arm2);rig.set('hand'+side,D(0,-.6,1));
      }
      rig.apply(0);
    }
    if(zipPose&&zipPose.braced) {
      // Solve against the current shoulders AFTER the arrival has been posed.
      // The palms stay in world space while the shoulder girdle rises through
      // the push, so elbow extension actually lifts the character off the edge.
      const L=hero.launch,reach=rig.upperArm+rig.foreArm,push=TL.smooth(.09,.24,L.plantT);
      const center=rig.P.uarmL.clone().add(rig.P.uarmR).multiplyScalar(.5).applyQuaternion(this.rootQ).add(this.meshPos);
      const desired=L.point.clone().addScaledVector(L.heading,-reach*.16);
      desired.y+=.035+reach*TL.lerp(zipPose.handspring?.76:.5,.94,push);
      this.contactOffset=desired.sub(center);this.meshPos.add(this.contactOffset);
      rig.mesh.position.copy(this.meshPos);
      // Freeze all already-smoothed bones for this FK pass; only contact arms
      // receive exact directions. This avoids applying smoothing a second time.
      for(const n of rig.order)rig.target[n].copy(rig.cur[n]);
      rig.hipsOffT.copy(rig.hipsOff);rig.hipsQT.copy(rig.hipsQ);
      const inv=this.rootQ.clone().invert();
      for(const [side,sg] of [['L',1],['R',-1]]) {
        const support=L.narrow&&TL.PerchSupport.describe(L.col,L.point,yaw);
        const target=support?TL.PerchSupport.contact(support,sg*.09,.035,.08):L.point.clone().add(new THREE.Vector3(Math.cos(yaw)*sg*.3,.035,-Math.sin(yaw)*sg*.3));
        target.sub(this.meshPos).applyQuaternion(inv);
        const d1=new THREE.Vector3(),d2=new THREE.Vector3();
        rig.ik2(rig.P['uarm'+side],target,rig.upperArm,rig.foreArm,D(sg,0,-1),d1,d2);
        rig.set('uarm'+side,d1);rig.set('farm'+side,d2);rig.set('hand'+side,D(0,-.15,1));
      }
      rig.apply(0);
    } else this.contactOffset=null;
    this.rig.mesh.updateMatrixWorld(true);
    // wrist world positions (web origin)
    for (const s of ['L', 'R']) {
      const b = rig.bones['hand' + s];
      if (b) b.getWorldPosition(this.handWorld[s]);
    }
    // WEAVER arms + membranes
    const mp = this.meshPos;
    if (this.arms) {
      this.arms.mode = st===S.CEIL?'ceiling':onWall ? 'wall' : st===S.PERCH?'packed':this.armsMode || (referencePose?'packed':st === S.GLIDE ? 'glide' : (this.rel||this.trick||zipPose||st===S.SLING||st===S.VAULT||rollO)?'packed' : airborne(st) ? 'swing' : 'idle');
      this.arms.update(dt, mp, this.rootQ, st, {hero});
    }
    const P = rig.P, tw = (n) => P[n].clone().applyQuaternion(this.rootQ).add(mp);
    this.membranes.update(dt, {
      shL: tw('uarmL'), shR: tw('uarmR'), elL: tw('farmL'), elR: tw('farmR'), wrL: tw('handL'), wrR: tw('handR'), hipL: tw('thighL'), hipR: tw('thighR'),
      anL: tw('footL'), anR: tw('footR'), crotch: tw('hips'),
    }, st === S.GLIDE);
    this.prevSt = st;
    if (!hero.grounded) this.prevVy = V.y;
  }
  dispose(scene) { if (this.arms) this.arms.dispose(scene); this.membranes.dispose(scene); }
};

/* ------------------------------------------------------------------ NPC animator (pedestrians & enemies) */
TL.NPCAnimator = class {
  constructor(sk) { this.rig = new TL.Rig(sk); this.phase = Math.random() * 6; this.t = Math.random() * 10; this.rig.stiff = 12; }
  /* mode: idle|walk|run|flee|cower|cheer|wave|phone|photo|sit|talk|aim|strike|stagger|down|restrained|guard|throw */
  update(dt, pos, yaw, speed, mode, extra) {
    this.t += dt;
    const D = TL.dirv, rig = this.rig;
    const set = (n, v) => rig.set(n, v);
    let lean = 0, hy = 0, twist = 0;
    if (mode === 'walk' || mode === 'run' || mode === 'flee') {
      this.phase += speed * dt / (mode === 'walk' ? 0.75 : 1.1) * Math.PI;
      const amp = mode === 'walk' ? 0.35 : 0.75, knee = mode === 'walk' ? 0.7 : 1.4;
      for (const s of [1, -1]) {
        const p = this.phase + (s > 0 ? 0 : Math.PI); const sw = Math.sin(p) * amp;
        const L = s > 0 ? 'L' : 'R';
        set('thigh' + L, D(0.05 * s, -Math.cos(sw), Math.sin(sw)));
        const kb = Math.max(0, -Math.cos(p)) * knee + 0.1;
        set('shin' + L, D(0, -Math.cos(sw - kb), Math.sin(sw - kb)));
        set('foot' + L, D(0, -0.3, 1));
        const ap = this.phase + (s > 0 ? Math.PI : 0), as = Math.sin(ap) * amp * (mode === 'flee' ? 1.4 : 0.9);
        if (mode === 'flee') { set('uarm' + L, D(0.4 * s, 0.3, 0.5)); set('farm' + L, D(0.1 * s, 0.9, 0.3)); }
        else { set('uarm' + L, D(0.2 * s, -Math.cos(as), Math.sin(as))); set('farm' + L, D(0.1 * s, -Math.cos(as + 0.5), Math.sin(as + 0.5))); }
      }
      lean = mode === 'walk' ? 0.05 : 0.22; hy = -Math.abs(Math.cos(this.phase)) * 0.03;
    } else {
      const b = Math.sin(this.t * 1.7) * 0.02;
      set('thighL', D(0.07, -1, 0.02)); set('thighR', D(-0.07, -1, 0.02)); set('shinL', D(0, -1, -0.02)); set('shinR', D(0, -1, -0.02));
      set('footL', D(0.1, -0.3, 1)); set('footR', D(-0.1, -0.3, 1));
      set('uarmL', D(0.25 + b, -1, 0.05)); set('uarmR', D(-0.25 - b, -1, 0.05)); set('farmL', D(0.15, -1, 0.2)); set('farmR', D(-0.15, -1, 0.2));
      switch (mode) {
        case 'cower': set('thighL', D(0.2, -0.3, 1)); set('thighR', D(-0.2, -0.3, 1)); set('shinL', D(0, -1, -0.3)); set('shinR', D(0, -1, -0.3));
          set('uarmL', D(0.3, 0.4, 0.8)); set('farmL', D(-0.5, 0.8, 0.2)); set('uarmR', D(-0.3, 0.4, 0.8)); set('farmR', D(0.5, 0.8, 0.2)); lean = 0.6; hy = -0.5; break;
        case 'cheer': { const w = Math.sin(this.t * 8) * 0.2; set('uarmL', D(0.4, 1, 0.1)); set('farmL', D(0.2 + w, 1, 0)); set('uarmR', D(-0.4, 1, 0.1)); set('farmR', D(-0.2 - w, 1, 0)); break; }
        case 'wave': { const w = Math.sin(this.t * 7) * 0.4; set('uarmR', D(-0.7, 0.8, 0.2)); set('farmR', D(-0.2 + w, 1, 0.1)); break; }
        case 'inspect': set('thighL',D(.2,-.45,.8));set('thighR',D(-.2,-.45,.8));set('shinL',D(0,-1,-.2));set('shinR',D(0,-1,-.2));set('uarmR',D(-.12,-.7,.65));set('farmR',D(.08,-.4,.85));lean=.3;hy=-.38;break;
        case 'look': set('head',D(0,1,-.3)); break;
        case 'phone': set('uarmR', D(-0.2, -0.6, 0.6)); set('farmR', D(0.3, 0.4, 0.8)); lean = 0.1; break;
        case 'photo': set('uarmR', D(-0.2, 0.2, 1)); set('farmR', D(0.2, 0.6, 0.8)); set('uarmL', D(0.2, 0.2, 1)); set('farmL', D(-0.2, 0.6, 0.8)); break;
        case 'talk': { const w = Math.sin(this.t * 3); set('uarmR', D(-0.3, -0.6, 0.5)); set('farmR', D(-0.1, 0.2 + w * 0.3, 1)); break; }
        case 'sit': set('thighL', D(0.1, 0, 1)); set('thighR', D(-0.1, 0, 1)); set('shinL', D(0, -1, 0)); set('shinR', D(0, -1, 0)); hy = -0.45; break;
        case 'aim': set('uarmR', D(-0.1, 0.05, 1)); set('farmR', D(0.05, 0.02, 1)); set('uarmL', D(0.1, 0.0, 1)); set('farmL', D(-0.3, 0.1, 1)); twist = 0.3; break;
        case 'guard': set('uarmL', D(0.2, 0.1, 1)); set('farmL', D(-0.1, 0.9, 0.3)); set('uarmR', D(-0.3, -0.3, 0.6)); set('farmR', D(0, 0.2, 1)); break;
        case 'strike': { const u = extra || 0; const e = Math.sin(Math.min(1, u * 1.5) * Math.PI / 2) * (1 - TL.smooth(0.7, 1, u)); set('uarmR', D(-0.2, TL.lerp(0.8, 0.05, e), TL.lerp(-0.3, 1, e))); set('farmR', D(0, TL.lerp(0.9, 0, e), 1)); twist = 0.5 * e; lean = 0.25 * e; break; }
        case 'throw': set('uarmR', D(-0.3, 0.9, -0.3)); set('farmR', D(0, 1, 0.2)); break;
        case 'stagger': lean = -0.35; set('uarmL', D(0.8, 0.3, -0.3)); set('uarmR', D(-0.8, 0.3, -0.3)); break;
        case 'down': lean = 1.4; hy = -0.8; break;
        case 'restrained': set('uarmL', D(0.1, -1, -0.4)); set('uarmR', D(-0.1, -1, -0.4)); set('farmL', D(-0.6, -0.3, -0.5)); set('farmR', D(0.6, -0.3, -0.5)); set('thighL', D(0.02, -1, 0)); set('thighR', D(-0.02, -1, 0)); break;
        case 'pilot': set('thighL', D(0.12, 0, 1)); set('thighR', D(-0.12, 0, 1)); set('shinL', D(0, -1, 0.1)); set('shinR', D(0, -1, 0.1));
          set('uarmL', D(0.2, -0.7, 0.6)); set('farmL', D(0.05, 0, 1)); set('uarmR', D(-0.2, -0.7, 0.6)); set('farmR', D(-0.05, 0, 1)); hy = -0.45; break;
      }
    }
    set('spine', D(0, 1, lean * 0.6)); set('chest', D(0, 1, lean)); set('neck', D(0, 1, lean * 0.2)); set('head', D(0, 1, mode==='look'?-.3:.05));
    rig.twist.chest = twist;
    for (const n of ['handL', 'handR']) { const f = rig.target['farm' + n.slice(4)]; if (f) rig.target[n].copy(f); }
    rig.hipsOffT.set(0, hy, 0);
    rig.mesh.position.copy(pos);
    rig.mesh.rotation.set(mode === 'down' ? -1.3 : 0, yaw, 0, 'YXZ');
    if (mode === 'down') rig.mesh.position.y += 0.2;
    rig.apply(dt);
  }
};
