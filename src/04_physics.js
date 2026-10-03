/* =====================================================================================
   PHYSICS-FIRST TRAVERSAL
   HeroBody            — real position/velocity integrated with fixed timestep + adaptive substeps
   TetherSystem        — geometry-attached ropes: anchor search (cone raycasts + scoring), pendulum
                         constraint (spring-damper tension only when stretched, never pushes), reel,
                         pumping, steering, moving anchors (target-local storage), corner wrapping,
                         point launch, dual-anchor slingshot
   TraversalStateMachine — one state machine for every traversal state
   HeroController      — per-state forces, collision, transitions, safety (NaN / tunneling / clamps)
   Nothing here is scripted along a path: every motion is the integral of forces + constraints.
   ===================================================================================== */
'use strict';

TL.isClimbPole = c => !!c && c.climb && Math.max(c.hx,c.hz)<.36 && c.hy>.6;

TL.HERO_STATS = {
  WEAVER: { name: 'WEAVER', run: 8.5, sprint: 14.5, jump: 8.6, rope: 72, reel: 18, pump: 5.2, steer: 7.5, air: 5.0,
            glide: 1.0, mass: 90, wallTime: 1.5, dragMul: 1.05, launch: 1.0, sling: 1.1 },
  PULSE:  { name: 'PULSE', run: 9.6, sprint: 17.5, jump: 9.6, rope: 78, reel: 22, pump: 6.6, steer: 9.5, air: 7.0,
            glide: 1.14, mass: 72, wallTime: 1.9, dragMul: 0.95, launch: 1.15, sling: 1.0 },
};

// ------------------------------------------------------------------ traversal states
TL.TS = {
  GROUND: 'ground', AIR: 'air', DIVE: 'dive', SWING: 'swing', GLIDE: 'glide', WALL: 'wallrun', CRAWL: 'wallcrawl',
  CEIL: 'ceiling', PERCH: 'perch', LAUNCH: 'pointlaunch', SLING: 'slingshot', WATER: 'water', RECOVER: 'recovery',
  BRIDGE: 'tensionbridge', ZIP: 'zip',
};

TL.TraversalStateMachine = class {
  constructor() { this.state = TL.TS.AIR; this.prev = null; this.t = 0; this.log = []; this.changes = 0; }
  set(s, reason) {
    if (s === this.state) return false;
    this.prev = this.state; this.state = s; this.t = 0; this.changes++;
    this.log.push({ from: this.prev, to: s, reason: reason || '' });
    if (this.log.length > 40) this.log.shift();
    TL.bus.emit('traversal', s, this.prev, reason);
    return true;
  }
  is(...s) { return s.indexOf(this.state) >= 0; }
  tick(dt) { this.t += dt; }
};

// ------------------------------------------------------------------ rope (one tether line)
TL.Rope = class {
  constructor() {
    this.active = false; this.attached = false; this.col = null;
    this.local = new THREE.Vector3();     // anchor in collider-local space (moving anchors)
    this.anchor = new THREE.Vector3();    // world anchor (updated every substep)
    this.anchorVel = new THREE.Vector3();
    this.L = 10; this.maxL = 80; this.minL = 2.5; this.targetL = 10;
    this.tension = 0; this.stretch = 0;
    this.shotT = 0; this.shotDur = 0; this.hand = 'R';
    this.bends = [];                      // corner-wrap points (world) between anchor and player
    this.bendLen = 0;                     // rope length consumed by bends
    this.elastic = false; this.rest = 0; this.k = 0; // slingshot/bungee
    this.origin = new THREE.Vector3();    // visual start (wrist)
    this.kind = 'swing';
  }
  attachTo(hit, cw) {
    this.col = hit.col || null;
    this.anchor.set(hit.x, hit.y, hit.z);
    if (this.col && this.col.dynamic) this.col.toLocal(hit.x, hit.y, hit.z, this.local); else this.local.set(0, 0, 0);
    this.bends.length = 0; this.bendLen = 0;
  }
  updateAnchor(h) {
    if (this.col && this.col.dynamic) {
      const w = this.col.toWorld(this.local.x, this.local.y, this.local.z, TL._tmpA || (TL._tmpA = { x: 0, y: 0, z: 0 }));
      this.anchor.set(w.x, w.y, w.z);
      const pv = this.col.pointVel(w.x, w.z, TL._tmpB || (TL._tmpB = { x: 0, y: 0, z: 0 }));
      this.anchorVel.set(pv.x, pv.y, pv.z);
    } else this.anchorVel.set(0, 0, 0);
  }
  pivot() { return this.bends.length ? this.bends[this.bends.length - 1] : this.anchor; }
  freeLen() { return Math.max(this.minL * 0.5, this.L - this.bendLen); }
  release() { this.active = false; this.attached = false; this.col = null; this.bends.length = 0; this.bendLen = 0; this.tension = 0; this.elastic = false; }
};

// ------------------------------------------------------------------ tether system
TL.TetherSystem = class {
  constructor(world) {
    this.world = world;
    this.ropes = [new TL.Rope(), new TL.Rope()];   // two lines (slingshot / point launch / bridge use both)
    this.candidates = [];                          // debug: last candidate set
    this.chosen = null;
    this.lastHand = 'L';
    this.SHOT_SPEED = 320;
    this.k = 420; this.c = 30; this.Tmax = 14 * TL.C.G;   // spring/damper per unit mass
    this._hit = { t: 0 }; this._v = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._dirs = [];
  }
  get main() { return this.ropes[0]; }
  anyAttached() { return this.ropes[0].attached || this.ropes[1].attached; }
  releaseAll() { this.ropes[0].release(); this.ropes[1].release(); }

  /* Anchor search: rays in a cone around an intent direction; every candidate is a real surface hit.
     Scores consider camera direction, velocity, turn side, height above player, distance, clearance
     of the predicted arc and moving-anchor stability. assist 0..100 widens the cone / adds rays. */
  findSwingAnchor(body, intent, stats, assist, hand) {
    const W = this.world, p = body.pos, v = body.vel;
    const a = TL.clamp(assist, 0, 100) / 100;
    const speed = Math.hypot(v.x, v.z);
    // horizontal intent: camera forward blended with velocity (faster -> trust momentum more)
    const cf = intent.camFwd;
    let hx = cf.x, hz = cf.z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    if (speed > 3) { const w = TL.clamp(speed / 40, 0, 0.55) * (0.5 + a * 0.5); hx = hx * (1 - w) + (v.x / speed) * w; hz = hz * (1 - w) + (v.z / speed) * w; }
    // turning side from lateral input
    const side = intent.moveLocal ? intent.moveLocal.x : 0;
    if (Math.abs(side) > 0.2) { const ang = -side * 0.45; const c = Math.cos(ang), s = Math.sin(ang); const nx = hx * c + hz * s, nz = -hx * s + hz * c; hx = nx; hz = nz; }
    const n0 = Math.hypot(hx, hz) || 1; hx /= n0; hz /= n0;
    // elevation: higher when slow or low, lower when fast
    const gy = W.ground(p.x, p.z);
    const alt = p.y - gy;
    let elev = TL.lerp(62, 45, TL.clamp(speed / 45, 0, 1)) * Math.PI / 180;
    if (alt < 8) elev += 0.12;
    const ce = Math.cos(elev), se = Math.sin(elev);
    const D = this._d.set(hx * ce, se, hz * ce).normalize();
    // build orthonormal frame around D
    const up = TL.V.get().set(0, 1, 0);
    const R = TL.V.get().crossVectors(D, up).normalize();
    const U = TL.V.get().crossVectors(R, D).normalize();
    const rings = [[0, 1], [0.13, 8], [0.26, 12], [0.4, 14], [0.55, 16]];
    if (a > 0.5) rings.push([0.7, 18]);
    const maxL = stats.rope;
    const origin = TL.V.get().set(p.x, p.y + 0.6, p.z);
    this.candidates.length = 0;
    let best = null, bestScore = -1e9;
    let preferred = null, preferredScore = -1e9;
    const right = intent.camRight || { x: Math.cos(body.facing), z: -Math.sin(body.facing) };
    const hit = this._hit;
    // relaxed = fallback pass: shorter minimum distance / height, forward bias instead of cone alignment
    const evaluate = (dx, dy, dz, relaxed) => {
      const h = W.raycast(origin.x, origin.y, origin.z, dx, dy, dz, maxL, (c) => c.anchor, hit, { noGround: true });
      if (!h || !h.col) return;
      const cand = { x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, col: h.col, d: h.t, score: 0, ok: true, why: '' };
      const dh = h.y - p.y;
      const fwdN = TL.clamp(((h.x - p.x) * hx + (h.z - p.z) * hz) / h.t, -1, 1);   // forwardness (-1 behind .. 1 ahead)
      if (dh < (body.inWater ? 1.5 : relaxed ? 2.5 : 3.2)) { cand.ok = false; cand.why = 'low'; }
      else if (h.t < (relaxed ? 3.5 : 5)) { cand.ok = false; cand.why = 'close'; }
      else if (h.ny < -0.7) { cand.ok = false; cand.why = 'underside'; }    // ceilings are ok only for crawl, not swings
      else if (relaxed && speed > 10 && fwdN < -0.35) { cand.ok = false; cand.why = 'behind'; }   // would yank the hero backwards
      if (cand.ok) {
        // predicted rope length: keep lowest arc point above the ground (assist raises clearance)
        const clearance = (relaxed ? 1.5 : 2.0) + a * 2.0;
        const Lmax = h.y - (gy + clearance);
        const L = Math.min(h.t * 0.98, Lmax);
        if (L < h.t * (relaxed ? 0.35 : 0.45) || L < (relaxed ? 3 : 4)) { cand.ok = false; cand.why = 'arc hits ground'; }
        cand.L = L;
        let s;
        if (relaxed) s = fwdN * 30 + TL.clamp(dh, 0, 40) * 0.3 - Math.abs(h.t - 30) * 0.25 - 40;   // always ranks below a cone hit
        else {
          const align = dx * D.x + dy * D.y + dz * D.z;
          s = align * 40 + fwdN * 18;
          s -= Math.abs(h.t - TL.lerp(26, 42, TL.clamp(speed / 40, 0, 1))) * 0.35;
          s += TL.clamp(dh, 0, 40) * 0.25;
          const lat = Math.abs((h.x - p.x) * -hz + (h.z - p.z) * hx);   // sideways offset from the travel line
          s -= lat * (0.25 + 0.35 * a);
        }
        if (h.col.dynamic) s -= 6 - (h.col.kind === 'drone' ? 0 : 3);     // moving anchors are less predictable
        if (h.col.kind === 'building' && h.ny > 0.5) s += 3;             // roof edges / tops make solid anchors
        if (cand.ok && !body.world.segmentClear(origin, h, h.col, 0.6)) { cand.ok = false; cand.why = 'blocked'; }
        cand.score = s;
        if (cand.ok && s > bestScore) { bestScore = s; best = cand; }
        const lateral = (h.x - p.x) * right.x + (h.z - p.z) * right.z;
        if (cand.ok && hand && (hand === 'L' ? lateral < -0.05 : lateral > 0.05) && s > preferredScore) {
          preferredScore = s; preferred = cand;
        }
      }
      if (this.candidates.length < 120) this.candidates.push(cand);
    };
    // pass 1: cone around the intent direction
    for (const [ang, n] of rings) {
      for (let k = 0; k < n; k++) {
        const phi = (k / n) * Math.PI * 2 + ang * 3.1;
        const sa = Math.sin(ang), ca = Math.cos(ang);
        evaluate(D.x * ca + (R.x * Math.cos(phi) + U.x * Math.sin(phi)) * sa,
          D.y * ca + (R.y * Math.cos(phi) + U.y * Math.sin(phi)) * sa,
          D.z * ca + (R.z * Math.cos(phi) + U.z * Math.sin(phi)) * sa, false);
      }
    }
    // pass 2 (nothing usable in the cone): sweep the upper hemisphere — side facades in a street canyon,
    // a distant tower when high above the rooftops, anything reachable when slow
    if (!best || (hand && !preferred)) {
      for (const el of [0.3, 0.55, 0.8, 1.05, 1.3]) {
        const n = el > 1.2 ? 12 : 24, ce2 = Math.cos(el), se2 = Math.sin(el);
        for (let k = 0; k < n; k++) {
          const az = Math.atan2(hx, hz) + (k / n) * Math.PI * 2;
          evaluate(Math.sin(az) * ce2, se2, Math.cos(az) * ce2, true);
        }
      }
    }
    this.chosen = preferred || best;
    return this.chosen;
  }

  /* Point-launch target: nearest valid top edge around the camera ray. */
  findLaunchPoint(body, camPos, camFwd, maxD) {
    const W = this.world;
    const h = W.raycast(camPos.x, camPos.y, camPos.z, camFwd.x, camFwd.y, camFwd.z, maxD + 20, (c) => c.climb, null, { noGround: true });
    if (!h || !h.col) return null;
    const c = h.col;
    const top = c.cy + c.hy;
    if (top - body.pos.y < -6 || top - body.pos.y > 45) return null;
    // closest point on the top perimeter to the hit (local space)
    const L = c.toLocal(h.x, h.y, h.z, { x: 0, y: 0, z: 0 });
    let lx = TL.clamp(L.x, -c.hx, c.hx), lz = TL.clamp(L.z, -c.hz, c.hz);
    const ex = c.hx - Math.abs(lx), ez = c.hz - Math.abs(lz);
    if (ex < ez) lx = Math.sign(lx || 1) * c.hx; else lz = Math.sign(lz || 1) * c.hz;
    // step inward slightly so the landing is on the roof
    const inx = lx - Math.sign(lx) * Math.min(0.6, c.hx * 0.3) * (ex < ez ? 1 : 0);
    const inz = lz - Math.sign(lz) * Math.min(0.6, c.hz * 0.3) * (ex < ez ? 0 : 1);
    const w = c.toWorld(inx, c.hy, inz, { x: 0, y: 0, z: 0 });
    const pt = new THREE.Vector3(w.x, w.y + 0.02, w.z);
    const support=TL.PerchSupport.describe(c,pt,body.facing);
    if(support)pt.copy(support.center);
    const d = pt.distanceTo(body.pos);
    if (d > maxD || d < 3) return null;
    return { point: pt, col: c, d };
  }

  /* Two anchors for the slingshot: rays left/right of camera forward. */
  findSlingAnchors(body, camFwd) {
    const W = this.world; const out = [];
    const hx = camFwd.x, hz = camFwd.z; const hl = Math.hypot(hx, hz) || 1;
    for (const ang of [0.5, -0.5]) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const dx = (hx * c + hz * s) / hl, dz = (-hx * s + hz * c) / hl;
      let best = null;
      for (const el of [0.55, 0.38, 0.22, 0.1]) {
        const h = W.raycast(body.pos.x, body.pos.y + 0.5, body.pos.z, dx * Math.cos(el), Math.sin(el), dz * Math.cos(el), 38, (cc) => cc.anchor, null, { noGround: true });
        if (h && h.col && h.t > 6) { best = { x: h.x, y: h.y, z: h.z, col: h.col, d: h.t }; break; }
      }
      if (!best) return null;
      out.push(best);
    }
    return out;
  }

  /* Pendulum constraint on the player for one substep. Applies tension ONLY when stretched.
     Returns tension magnitude (per unit mass, m/s^2). */
  constrain(rope, body, h) {
    rope.updateAnchor(h);
    const pv = rope.pivot();
    const P = body.pos, V = body.vel;
    const dx = P.x - pv.x, dy = P.y - pv.y, dz = P.z - pv.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-4) return 0;
    const nx = dx / d, ny = dy / d, nz = dz / d;
    const Lf = rope.freeLen();
    const av = rope.bends.length ? null : rope.anchorVel;
    const rvx = V.x - (av ? av.x : 0), rvy = V.y - (av ? av.y : 0), rvz = V.z - (av ? av.z : 0);
    const vr = rvx * nx + rvy * ny + rvz * nz;         // radial speed (+ = moving away)
    let T = 0;
    if (rope.elastic) {
      // slingshot / bungee: linear elastic cord, slack below rest length
      const x = d - rope.rest;
      if (x > 0) T = Math.min(rope.k * x + 2.5 * Math.max(vr, 0), 60 * TL.C.G);
    } else if (d > Lf) {
      T = this.k * (d - Lf) + this.c * vr;             // spring + damper
      if (T < 0) T = 0;                                // a rope never pushes
      if (T > this.Tmax) T = this.Tmax;
    }
    if (T > 0) {
      V.x -= nx * T * h; V.y -= ny * T * h; V.z -= nz * T * h;
      // mass-aware reaction on light movable anchors (drones, crates, enemies)
      const col = rope.col;
      if (col && col.dynamic && col.mass < 5000 && col.owner && col.owner.applyImpulse && !rope.bends.length) {
        const k = (body.mass / col.mass) * T * h;
        col.owner.applyImpulse(nx * k, ny * k, nz * k);
      } else if (col && col.dynamic && col.owner && col.owner.tetherDrag) col.owner.tetherDrag(T * body.mass, nx, ny, nz, h);
    }
    // hard safety limit: never let the rope overstretch (numerical stabilization preserving tangential motion)
    if (!rope.elastic) {
      const lim = Lf * 1.04 + 0.15;
      if (d > lim) {
        P.x = pv.x + nx * lim; P.y = pv.y + ny * lim; P.z = pv.z + nz * lim;
        const vr2 = (V.x - (av ? av.x : 0)) * nx + (V.y - (av ? av.y : 0)) * ny + (V.z - (av ? av.z : 0)) * nz;
        if (vr2 > 0) { V.x -= nx * vr2; V.y -= ny * vr2; V.z -= nz * vr2; }
      }
    }
    rope.tension = T; rope.stretch = d - Lf;
    return T;
  }

  /* Corner wrapping: add a bend where the straight rope would pass through geometry; remove it
     when the rope can see past the bend again. Static anchors only (moving anchors skip wrapping). */
  wrap(rope, body) {
    if (rope.col && rope.col.dynamic) return;
    const W = this.world, P = body.pos;
    const pv = rope.pivot();
    const dx = pv.x - P.x, dy = pv.y - P.y, dz = pv.z - P.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1.5) return;
    const h = W.raycast(P.x, P.y + 0.5, P.z, dx, dy - 0.5, dz, d - 0.8, (c) => c.solid, this._hit, { noGround: true });
    if (h && h.col && rope.bends.length < 6) {
      // bend point pushed slightly off the surface along the hit normal
      const b = new THREE.Vector3(h.x + h.nx * 0.12, h.y + h.ny * 0.12, h.z + h.nz * 0.12);
      const seg = b.distanceTo(pv);
      if (seg > 0.6 && rope.freeLen() - seg > 2) { rope.bends.push(b); rope.bendLen += seg; }
      return;
    }
    if (rope.bends.length) {
      const prev = rope.bends.length > 1 ? rope.bends[rope.bends.length - 2] : rope.anchor;
      const tmpA = TL.V.get().set(P.x, P.y + 0.5, P.z);
      if (W.segmentClear(tmpA, prev, rope.col, 1.0)) {
        const last = rope.bends.pop();
        rope.bendLen -= last.distanceTo(prev);
        if (rope.bendLen < 0) rope.bendLen = 0;
      }
    }
  }
};

// ------------------------------------------------------------------ wind field (updrafts, gusts)
TL.WindField = class {
  constructor() { this.updrafts = []; this.base = new THREE.Vector3(2, 0, 1); this.gust = 0; this.t = 0; this.rain = 0; }
  add(x, z, r, h0, h1, strength, kind) { const u = { x, z, r, h0, h1, s: strength, kind: kind || 'vent', on: true }; this.updrafts.push(u); return u; }
  clearChunk(tag) { this.updrafts = this.updrafts.filter((u) => u.tag !== tag); }
  sample(p, out) {
    const g = 1 + 0.5 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.11);
    out.set(this.base.x * g, 0, this.base.z * g);
    const alt = TL.clamp((p.y - 20) / 120, 0, 1);
    out.multiplyScalar(0.4 + alt * 1.6 + this.rain * 0.8);
    for (let i = 0; i < this.updrafts.length; i++) {
      const u = this.updrafts[i]; if (!u.on) continue;
      const dx = p.x - u.x, dz = p.z - u.z; const d2 = dx * dx + dz * dz;
      if (d2 > u.r * u.r || p.y < u.h0 || p.y > u.h1) continue;
      const f = (1 - Math.sqrt(d2) / u.r) * TL.smooth(u.h1, u.h1 - 12, p.y);
      out.y += u.s * f;
    }
    return out;
  }
  update(dt) { this.t += dt; }
};

// ------------------------------------------------------------------ hero body + controller
TL.HeroController = class {
  constructor(world, stats) {
    this.world = world;
    this.stats = stats;
    this.mass = stats.mass;
    this.pos = new THREE.Vector3(0, 60, 0);
    this.vel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();     // for render interpolation
    this.safePos = new THREE.Vector3(); this.safeVel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.preVel = new THREE.Vector3();
    this.fsm = new TL.TraversalStateMachine();
    this.tether = new TL.TetherSystem(world);
    this.wind = null;
    this.facing = 0;                        // yaw (radians) the body faces
    this.grounded = false; this.groundCol = null; this.groundY = 0;
    this.wallN = new THREE.Vector3(); this.wallCol = null; this.wallTime = 0; this.wallMode = 'up';
    this.swingWall = false;                    // wall contact overlays the live pendulum, never replaces it
    this.ceilCol = null;
    this.contacts = []; for (let i = 0; i < 24; i++) this.contacts.push({ nx: 0, ny: 0, nz: 0, depth: 0, col: null, vn: 0, yOff: 0 });
    this.nContacts = 0;
    this.cands = [];
    this.inWater = false; this.waterTime = 0; this.skims = 0;
    this.glide = { yaw: 0, pitch: -0.15, roll: 0, aoa: 0, lift: 0, drag: 0, stall: false, t: 9, deploy: 1, pop: 0, entry: 0 };   // t: seconds since the wings opened; deploy 0..1; pop: boost impulse just applied
    this.launch = null; this.sling = null; this.bridge = null;
    this.impact = 0; this.lastImpactSpeed = 0;
    this.airTime = 0; this.coyote = 0; this.jumpBuffer = 0;
    this.trick = null; this.style = 0;
    this.debug = { tension: 0, vr: 0, vt: 0, substeps: 1, ropeLen: 0, ropeMax: 0, dist: 0 };
    this.nanResets = 0;
    this.health = 100; this.maxHealth = 100;
    this.onEvent = null;
    this.frozen = false;
    this.releaseBoostWindow = 0;
    this.lastSwingSide = 1;
    this.perchPoint = new THREE.Vector3(); this.perchSupport=null;
    this.recoverT = 0;
    this.sprinting = false;
    this.assist = 60;
    this.stepCount = 0;
    // contact traversal (04b_contact.js): body shape, committed move, approach plan, tuck, landing record, corner arc
    this.shape = TL.BodyShapes ? TL.BodyShapes.stand : null;
    this.action = null; this.contactPlan = null; this.tuck = 0; this.tuckHold = 0;
    this.landing = null; this.corner = null; this._contactPush = 0;
  }
  get state() { return this.fsm.state; }
  emit(e, a, b) { if (this.onEvent) this.onEvent(e, a, b); TL.bus.emit('hero:' + e, a, b); }
  setStats(s) { this.stats = s; this.mass = s.mass; }
  teleport(x, y, z) {
    this.swingWall = false;
    this.perchSupport=null;
    if(this.reference){this.reference.action=null;this.reference.loop=null;}
    this.pos.set(x, y, z); this.prevPos.copy(this.pos); this.vel.set(0, 0, 0);
    this.tether.releaseAll(); this.fsm.set(TL.TS.AIR, 'teleport'); this.safePos.copy(this.pos); this.safeVel.set(0, 0, 0);
    this.action = null; this.contactPlan = null; this.corner = null; this.roofFlow=null;this.ceilCarry=0;this.tuck = 0; if (TL.BodyShapes) this.shape = TL.BodyShapes.stand;
  }

  /* ---------------------------------------------------------------- fixed step */
  step(dt, intent) {
    if (this.frozen) { this.prevPos.copy(this.pos); return; }
    this.stepCount++;
    this.prevPos.copy(this.pos);
    if(TL.ReferenceTraversal)TL.ReferenceTraversal.tick(this,dt,intent);
    const speed = this.vel.length();
    const n = TL.clamp(Math.ceil((speed * dt) / 0.22), 1, TL.C.MAX_SUBSTEPS);
    const h = dt / n;
    this.debug.substeps = n;
    this.handleInputEdges(intent, dt);
    // broadphase once per step around the swept volume
    const ext = speed * dt + 3;
    this.world.query(this.pos.x - ext, this.pos.z - ext, this.pos.x + ext, this.pos.z + ext, this.cands);
    for (let i = 0; i < n; i++) {
      this.substep(h, intent);
      if (!TL.finite3(this.pos) || !TL.finite3(this.vel)) {
        // numerical safety: restore last good state instead of exploding
        this.pos.copy(this.safePos); this.vel.copy(this.safeVel).multiplyScalar(0.5);
        this.tether.releaseAll(); this.fsm.set(TL.TS.AIR, 'nan-reset'); this.nanResets++;
        break;
      }
    }
    if (TL.finite3(this.pos)) { this.safePos.copy(this.pos); this.safeVel.copy(this.vel); }
    this.fsm.tick(dt); this.simT = (this.simT || 0) + dt;
    this.contactStep(dt, intent);
    this.updateFacing(dt, intent);
    this.airTime = this.grounded ? 0 : this.airTime + dt;
  }

  /* One-shot inputs (pressed edges) handled once per fixed step. */
  handleInputEdges(it, dt) {
    const S = TL.TS, st = this.fsm.state, tether = this.tether;
    this.motionInput = this.motionInput || { x: 0, y: 0 };
    this.motionInput.x = it.moveLocal ? it.moveLocal.x : 0;
    this.motionInput.y = it.moveLocal ? it.moveLocal.y : 0;
    this.singleHandSwing = !!it.singleHand;
    // Releasing Shift also cancels a web still travelling toward its anchor.
    if (it.singleHand && !it.swing && tether.main.active && tether.main.kind === 'swing') this.releaseSwing(false, it);
    if (it.jump) this.jumpBuffer = 0.14; else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (st === S.VAULT && this.action) {
      // committed contact: jump is queued for the exit; a web may be fired once the hands have released
      if (it.jump) { this.action.jump = true; this.jumpBuffer = 0; }
      if (it.swingPressed && this.action.u >= this.action.plan.release) {
        TL.Contact.finish(this, 'contact-cancel'); if (this.fsm.state === S.GROUND) this.fsm.set(S.AIR, 'contact-swing');
        this.tryStartSwing(it); return;
      }
    }
    if (st === S.LAUNCH && this.launch && it.jump && (this.launch.window || this.launch.arrived)) {
      this.launch.perfect = true; this.launch.boosted = true;
    }
    this.releaseBoostWindow = Math.max(0, this.releaseBoostWindow - dt);
    // SWING: start (in air / wall / perch) or chain
    if (it.swingPressed && (st === S.AIR || st === S.DIVE || st === S.GLIDE || st === S.WALL || st === S.PERCH || st === S.WATER || st === S.CRAWL || st === S.CEIL || (it.singleHand && st === S.SWING))) {
      this.tryStartSwing(it);
    } else if (it.swingPressed && (st === S.GROUND || st === S.RECOVER)) {
      // ground swing start: a real jump first, then the line fires (only if a valid anchor exists)
      const save = this.pos.y; this.pos.y += 2.0;
      const ok = this.tether.findSwingAnchor(this, it, this.stats, this.assist, it.singleHand ? it.swingHand : null);
      this.pos.y = save;
      if (ok) { this.vel.y = Math.max(this.vel.y, this.stats.jump); this.fsm.set(S.AIR, 'jump-swing'); this.emit('jump'); this.tryStartSwing(it); }
    }
    if (st === S.SWING) {
      if (!it.swing && tether.main.active) this.releaseSwing(false, it);
      else if (this.jumpBuffer > 0) { this.jumpBuffer = 0; this.releaseSwing(true, it); }
    }
    // point launch / zip (E)
    if (it.tether && it.launchTarget && st !== S.SWING && st !== S.SLING && st !== S.LAUNCH) {
      // a committed contact move can hand over to a launch only once its hands have released
      if (st !== S.VAULT) this.startPointLaunch(it.launchTarget);
      else if (this.action && this.action.u >= this.action.plan.release) { TL.Contact.finish(this, 'contact-cancel'); this.startPointLaunch(it.launchTarget); }
    }
    // glide toggle
    if (it.glideToggle) {
      if (st === S.GLIDE) this.fsm.set(S.AIR, 'glide-off');
      else if ((st === S.AIR || st === S.DIVE) && this.pos.y - this.world.ground(this.pos.x, this.pos.z) > 3) this.startGlide();
    }
    // slingshot
    if (it.slingPressed && (st === S.GROUND || st === S.AIR || st === S.PERCH || st === S.WALL || st === S.DIVE || st === S.GLIDE)) this.startSling(it);
    if (st === S.SLING && !it.sling) this.releaseSling();
  }

  tryStartSwing(it) {
    const a = this.tether.findSwingAnchor(this, it, this.stats, this.assist, it.singleHand ? it.swingHand : null);
    if (!a) { this.emit('noanchor'); return false; }
    const r = this.tether.main;
    r.release();
    r.active = true; r.attached = false; r.kind = 'swing';
    if (it.singleHand && this.fsm.state === TL.TS.SWING) this.fsm.set(TL.TS.AIR, 'hand-transfer');
    r.attachTo({ x: a.x, y: a.y, z: a.z, col: a.col });
    r.maxL = this.stats.rope; r.L = TL.clamp(a.L, r.minL, r.maxL);
    r.shotDur = a.d / this.tether.SHOT_SPEED; r.shotT = 0;
    // alternate wrists by the side the anchor is on relative to facing
    const rx = Math.cos(this.facing), rz = -Math.sin(this.facing);
    const side = (a.x - this.pos.x) * rx + (a.z - this.pos.z) * rz;
    r.hand = it.singleHand && it.swingHand ? it.swingHand : side > 0 ? 'R' : 'L';
    this.lastSwingSide = r.hand === 'R' ? 1 : -1;
    this.emit('webshot', r);
    return true;
  }
  releaseSwing(boost, it) {
    this.corner=null;
    const r = this.tether.main;
    const V = this.vel;
    const offWall = this.swingWall;
    this.swingWall = false;
    if (boost && r.attached) {
      // muscle yank + release: a short impulse along the way the hero is already travelling (momentum carries
      // through); when too slow to have a heading, along the stick / camera. Best timed on the rise.
      const rising = TL.clamp(V.y / 12, 0, 1);
      const hs = Math.hypot(V.x, V.z);
      let dx, dz;
      if (hs > 4) { dx = V.x / hs; dz = V.z / hs; }
      else {
        const m = it && it.move && it.move.lengthSq() > 0.01 ? it.move : it && it.camFwd ? it.camFwd : { x: Math.sin(this.facing), z: Math.cos(this.facing) };
        const ml = Math.hypot(m.x, m.z) || 1; dx = m.x / ml; dz = m.z / ml;
      }
      // climb angle follows the arc (rising release -> up-and-over, bottom release -> flat and fast), clamped 13..43 deg
      const climb = TL.clamp(Math.atan2(V.y, Math.max(hs, 1)), 0.22, 0.75);
      const k = (4 + 5 * rising) * this.stats.launch;
      const kh = k * Math.cos(climb), kv = k * Math.sin(climb);
      V.x += dx * kh; V.z += dz * kh; V.y = Math.max(V.y, 0) + kv;
      this.style += 25 * rising;
      this.emit('releaseboost', rising);
      this.releaseBoostWindow = 0.3;
    }
    // A deliberate jump plants the feet and pushes clear; ordinary release keeps all tangent momentum.
    if (boost && offWall) {
      const vn = V.x * this.wallN.x + V.z * this.wallN.z;
      V.x += this.wallN.x * Math.max(0, 5 - vn); V.z += this.wallN.z * Math.max(0, 5 - vn);
    }
    r.release();
    this.fsm.set(TL.TS.AIR, boost ? 'release-jump' : 'release');
    this.emit('release', V.length());
  }
  /* Wings open: the web catches the air like a canopy — a pop UP and FORWARD (resistance snap, then the wing carries
     the momentum). The deploy window (g.t < ~0.9 s) also adds temporary extra lift + parachute drag in glideForces. */
  startGlide() {
    const v = this.vel; const g = this.glide;
    const hs = Math.hypot(v.x, v.z);
    g.yaw = Math.atan2(v.x, v.z) || this.facing; g.pitch = TL.clamp(Math.atan2(v.y, hs), -0.9, 0.3); g.roll = 0;
    g.t = 0; g.deploy = 0; g.entry = hs;
    // the faster / steeper you were falling, the harder the canopy bites; never a free launch from a standstill
    const bite = TL.clamp(hs / 22, 0.35, 1.25) * (1 + TL.clamp(-v.y / 40, 0, 0.5));
    const up = TL.clamp(5.6 * bite + Math.max(0, -v.y) * 0.3, 0, 11), fwd = 3.6 * bite;
    const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
    v.x += fx * fwd; v.z += fz * fwd; v.y = Math.min(v.y + up, 12);
    g.pop = up;
    this.fsm.set(TL.TS.GLIDE, 'glide-on'); this.emit('glide', up, hs);
  }
  startPointLaunch(t) {
    this.tether.releaseAll();
    const r = this.tether.ropes[0], r2 = this.tether.ropes[1];
    for (const rr of [r, r2]) { rr.active = true; rr.attached = false; rr.kind = 'launch'; rr.attachTo({ x: t.point.x, y: t.point.y, z: t.point.z, col: t.col }); rr.L = this.pos.distanceTo(t.point); rr.maxL = rr.L + 5; rr.shotT = 0; rr.shotDur = TL.clamp(rr.L / this.tether.SHOT_SPEED,.08,.2); }
    r.hand = 'R'; r2.hand = 'L';
    this.launch = { point: t.point.clone(), col: t.col, t: 0, boosted: false, arrived: false, window: false };
    this.fsm.set(TL.TS.LAUNCH, 'point-launch');
    this.emit('pointlaunch', t);
  }
  startSling(it) {
    const anchors = this.tether.findSlingAnchors(this, it.camFwd);
    if (!anchors) { this.emit('noanchor'); return; }
    this.tether.releaseAll();
    const ropes = this.tether.ropes;
    anchors.forEach((a, i) => {
      const r = ropes[i]; r.active = true; r.attached = true; r.kind = 'sling'; r.attachTo(a);
      r.elastic = true; r.rest = a.d * 0.95; r.k = 10 * this.stats.sling; r.L = a.d; r.shotT = 0; r.shotDur = a.d / this.tether.SHOT_SPEED;
      r.hand = i === 0 ? 'L' : 'R';
    });
    const onSurface = this.grounded || this.fsm.state === TL.TS.GROUND || this.fsm.state === TL.TS.PERCH ||
      (this.pos.y - TL.C.FEET - this.world.ground(this.pos.x, this.pos.z)) < 0.15;
    this.sling = { t: 0, pull: 0, anchors, grounded: onSurface, braced: onSurface, tension: 0 };
    this.fsm.set(TL.TS.SLING, 'slingshot');
    this.emit('sling');
  }
  releaseSling() {
    const sl = this.sling;
    this.sling = null;
    this.vel.y = Math.max(this.vel.y, 2.5);                          // small hop so feet leave the ground as the cords fire
    // ropes stay elastic for the launch until they go slack (handled in substep), mark release
    for (const r of this.tether.ropes) if (r.kind === 'sling') r.kind = 'slingfire';
    this.fsm.set(TL.TS.AIR, 'sling-release');
    this.emit('slingfire', sl ? sl.pull : 0);
  }

  /* ---------------------------------------------------------------- substep integration */
  substep(h, it) {
    if(TL.SurfaceFlow){
      TL.SurfaceFlow.roofStep(this,h);
      if(this.fsm.state===TL.TS.WALL||this.fsm.state===TL.TS.CRAWL||this.swingWall)TL.SurfaceFlow.corner(this,h,it);
    }
    const S = TL.TS, st = this.fsm.state, P = this.pos, V = this.vel, st8 = this.stats;
    const G = TL.C.G;
    const a = this.acc.set(0, -G, 0);
    const wind = this.wind ? this.wind.sample(P, TL.V.get()) : TL.V.get();
    // relative air velocity -> quadratic drag
    const rvx = V.x - wind.x, rvy = V.y - wind.y, rvz = V.z - wind.z;
    const rs = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
    let kd = 0.0036 * st8.dragMul;                 // terminal ~ 67 m/s upright
    if (st === S.DIVE || (st === S.SWING && it.dive)) kd *= 0.45;
    if (st === S.GROUND || st === S.WALL || st === S.CRAWL || st === S.CEIL || st === S.PERCH || st === S.VAULT) kd *= 0.2;
    if (st !== S.GLIDE) { a.x -= kd * rs * rvx; a.y -= kd * rs * rvy; a.z -= kd * rs * rvz; }

    switch (st) {
      case S.GROUND: this.groundForces(a, h, it); break;
      case S.AIR: case S.DIVE: this.airForces(a, h, it); break;
      case S.SWING: this.swingForces(a, h, it); break;
      case S.GLIDE: this.glideForces(a, h, it, wind); break;
      case S.WALL: case S.CRAWL: this.wallForces(a, h, it); break;
      case S.CEIL: this.ceilForces(a, h, it); break;
      case S.PERCH: a.set(0, 0, 0); V.multiplyScalar(0.0); P.lerp(this.perchPoint, 0.35); break;
      case S.LAUNCH: this.launchForces(a, h, it); break;
      case S.SLING: this.slingForces(a, h, it); break;
      case S.WATER: this.waterForces(a, h, it); break;
      case S.RECOVER: this.recoverForces(a, h, it); break;
      case S.VAULT: TL.Contact.actionStep(this, a, h, it); break;
    }
    // A committed two-rim zip redirects existing momentum along its validated
    // route. Cancel ambient drag/gravity only during this short guided passage;
    // ordinary integration and collision response below remain authoritative.
    if(TL.ReferenceTraversal?.advancePassage(this,h))a.set(0,0,0);
    // integrate (semi-implicit Euler)
    V.x += a.x * h; V.y += a.y * h; V.z += a.z * h;
    if(this.corner?.flow)TL.SurfaceFlow.cornerStep(this,h);
    // rope constraints
    const T = this.tether;
    for (let i = 0; i < 2; i++) {
      const r = T.ropes[i];
      if (!r.active) continue;
      if (!r.attached) {
        r.shotT += h; r.updateAnchor(h);
        if (r.shotT >= r.shotDur) {
          r.attached = true;
          if (r.kind === 'swing' && (this.fsm.state !== S.SWING)) {
            // re-evaluate length at attach time: player moved during the line's flight
            const d = P.distanceTo(r.anchor);
            const gy = this.world.ground(P.x, P.z);
            const alt = P.y - gy;
            // desired arc clearance: keep swings flowing above the street (assist raises it)
            const want = Math.min(TL.lerp(2.5, 11, this.assist / 100), Math.max(2.5, alt * 0.6));
            r.L = TL.clamp(d * 0.99, r.minL, r.maxL);
            r.targetL = TL.clamp(Math.min(d * 0.99, r.anchor.y - gy - want), Math.max(r.minL, d * 0.55), r.maxL);
            this.fsm.set(S.SWING, 'attach'); this.emit('attach', r);
          }
        }
        continue;
      }
      if (r.elastic && this.sling && this.sling.braced && r.kind === 'sling') {
        // braced stance: the ground holds the cord force while the hero pulls back (tension stored, not applied)
        r.updateAnchor(h);
        const x = P.distanceTo(r.anchor) - r.rest; r.tension = Math.max(0, r.k * x); r.stretch = x;
        continue;
      }
      if (r.kind === 'launch' && this.launch && this.launch.arrived) continue;
      if (r.kind === 'airzip') { r.updateAnchor(h); continue; } // bounded pull, moving attachment still tracked
      const ten = T.constrain(r, this, h);
      if (i === 0) this.debug.tension = ten;
      if ((r.kind === 'slingfire') && P.distanceTo(r.anchor) < r.rest) r.release();   // cord slack after launch
      if (r.kind === 'swing' && this.stepCount % 2 === 0) T.wrap(r, this);
    }
    // speed clamp (numerical safety only)
    const sp = V.length();
    if (sp > TL.C.MAX_SPEED) V.multiplyScalar(TL.C.MAX_SPEED / sp);
    // position
    P.x += V.x * h; P.y += V.y * h; P.z += V.z * h;
    this.preVel.copy(V);                      // velocity before contacts remove the into-surface part
    this.collide(h, it);
    if(this.corner?.flow)TL.SurfaceFlow.cornerPost(this);
    if (this.fsm.state === S.VAULT) TL.Contact.actionPost(this, it);
    this.transitions(h, it);
    this.updateDebug();
  }

  /* ---------------------------------------------------------------- per-state forces */
  groundForces(a, h, it, control) {
    const V = this.vel, st8 = this.stats;
    control = control === undefined ? 1 : control;
    if (this.grounded) a.y = 0;                 // supported by ground (collision keeps us up)
    const sprint = it.sprint;
    this.sprinting = sprint && it.move.lengthSq() > 0.1;
    const target = (sprint ? st8.sprint : st8.run) * Math.min(1, it.move.length());
    // platform velocity (vehicles / moving roofs)
    let pvx = 0, pvz = 0;
    if (this.groundCol && this.groundCol.dynamic) { const pv = this.groundCol.pointVel(this.pos.x, this.pos.z, TL.V.get()); pvx = pv.x; pvz = pv.z; }
    const rvx = V.x - pvx, rvz = V.z - pvz;
    const cur = Math.hypot(rvx, rvz);
    let dx = 0, dz = 0;
    if (it.move.lengthSq() > 0.01) { const m = it.move.length(); dx = it.move.x / m; dz = it.move.z / m; }
    const tvx = dx * target, tvz = dz * target;
    // momentum preservation: above run speed we only bleed slowly unless input opposes
    let accel = 55 * control;
    if (cur > target + 0.5) {
      const along = (rvx * dx + rvz * dz) / (cur || 1);
      accel = along > 0.3 ? 7 : 30;
    }
    let ex = tvx - rvx, ez = tvz - rvz;
    const el = Math.hypot(ex, ez);
    if (el > 1e-6) { const k = Math.min(accel, el / h); a.x += (ex / el) * k; a.z += (ez / el) * k; }
  }
  airForces(a, h, it) {
    const V = this.vel, st8 = this.stats;
    // limited air control: steer perpendicular / add up to a modest air speed
    if (it.move.lengthSq() > 0.01) {
      const m = Math.min(1, it.move.length());
      const dx = it.move.x / it.move.length(), dz = it.move.z / it.move.length();
      const hs = Math.hypot(V.x, V.z);
      const along = V.x * dx + V.z * dz;
      const ac = st8.air * m * (along > 12 ? 0.35 : 1.0);
      a.x += dx * ac; a.z += dz * ac;
      if (hs > 4) { // bank toward input by rotating horizontal velocity slightly (physical side force)
        const sx = -V.z / hs, sz = V.x / hs;
        const lat = dx * sx + dz * sz;
        a.x += sx * lat * st8.air * 0.8; a.z += sz * lat * st8.air * 0.8;
      }
    }
    if (this.fsm.state === TL.TS.DIVE) { a.y -= 5.5; }
  }
  swingForces(a, h, it) {
    const r = this.tether.main, V = this.vel, P = this.pos, st8 = this.stats;
    if (this.swingWall) {
      // Feet grip only along the surface normal. The live rope and swing forces continue to own
      // the arc: no wall-run speed reset, crawl damping, upward conversion or extra tangent boost.
      const vn = V.x * this.wallN.x + V.z * this.wallN.z;
      if (vn < 1.5) { a.x -= this.wallN.x * 12; a.z -= this.wallN.z * 12; }
    }
    const pv = r.pivot();
    const nx = P.x - pv.x, ny = P.y - pv.y, nz = P.z - pv.z; const d = Math.hypot(nx, ny, nz) || 1;
    const ux = nx / d, uy = ny / d, uz = nz / d;               // rope direction (anchor -> player)
    // tangential velocity
    const vr = V.x * ux + V.y * uy + V.z * uz;
    let tx = V.x - ux * vr, ty = V.y - uy * vr, tz = V.z - uz * vr;
    const ts = Math.hypot(tx, ty, tz);
    if (ts > 0.5) { tx /= ts; ty /= ts; tz /= ts; }
    // PUMPING (hold forward): tangential push while descending through the arc + leg pump (reel at bottom)
    const fwd = it.moveLocal ? it.moveLocal.y : 0;
    if (fwd > 0.2 && ts > 0.5) {
      const descending = ty < 0 ? 1 : 0.35;
      const below = TL.clamp(-uy, 0, 1);                        // 1 when directly below the anchor
      const k = st8.pump * fwd * descending * (0.4 + 0.6 * below);
      a.x += tx * k; a.y += ty * k; a.z += tz * k;
      // leg pump: shorten slightly near the bottom (angular momentum -> speed), lengthen near the top
      if (below > 0.85) r.L = Math.max(r.minL, r.L - 0.9 * h);
      else if (below < 0.4) r.L = Math.min(r.maxL, r.L + 0.6 * h);
    }
    if (fwd < -0.3 && ts > 0.5) { a.x -= tx * 3; a.y -= ty * 3; a.z -= tz * 3; } // brake
    // STEERING: lateral input force projected onto the tangent plane (sideways to motion)
    if (it.moveLocal && Math.abs(it.moveLocal.x) > 0.1) {
      const cr = it.camRight;
      let sx = cr.x, sy = 0, sz = cr.z;
      const sdot = sx * ux + sy * uy + sz * uz; sx -= ux * sdot; sy -= uy * sdot; sz -= uz * sdot;
      const k = st8.steer * it.moveLocal.x;
      a.x += sx * k; a.y += sy * k; a.z += sz * k;
    }
    // SWING-PLANE ASSIST: the hero's body English counters the rope's sideways pull so swings flow along
    // the travel direction (capped force; the anchor stays the real attachment point)
    if (this.assist > 0 && ts > 3 && !(it.moveLocal && Math.abs(it.moveLocal.x) > 0.3)) {
      const hv = Math.hypot(V.x, V.z) || 1;
      const lx = -V.z / hv, lz = V.x / hv;                         // horizontal lateral axis
      const ropeLat = -(ux * lx + uz * lz);                        // + = rope pulls toward +lateral
      const Test = TL.C.G * Math.max(0, -uy) + (ts * ts) / d;      // tension estimate (gravity + centripetal)
      const cap = 13 * (this.assist / 100);
      const k = TL.clamp(-ropeLat * Test * 0.9, -cap, cap);
      a.x += lx * k; a.z += lz * k;
    }
    // REEL (E / wheel): changes rope length; the constraint converts it into real motion
    if (it.reelIn) { r.L = Math.max(r.minL, r.L - st8.reel * h * it.reelIn); r.targetL = r.L; }
    if (it.reelOut) { r.L = Math.min(r.maxL, r.L + st8.reel * h * it.reelOut); r.targetL = r.L; }
    // automatic reel toward the attach-time target length (limited by the hero's reel speed)
    if (r.targetL < r.L - 0.01) r.L = Math.max(r.targetL, r.L - st8.reel * h);
    // DIVE while swinging: tuck + push down for speed
    if (it.dive) { a.y -= 6; }
    // swing assistance: gentle ground avoidance by reeling (never moves the player directly)
    const gy = this.world.ground(P.x, P.z);
    if (this.assist > 0 && P.y - gy < 3 && V.y < 0) r.L = Math.max(r.minL, r.L - (this.assist / 100) * 14 * h);
  }
  glideForces(a, h, it, wind) {
    const V = this.vel, g = this.glide, st8 = this.stats;
    const tunnel=this.wind?.tunnelAt&&this.wind.tunnelAt(this.pos);
    if(tunnel){
      const k=tunnel.weight,dir=tunnel.field.axis;
      const along=V.dot(dir),thrust=TL.clamp((42-along)*2,0,24)*k;
      a.addScaledVector(dir,thrust);a.y+=(TL.C.G*.8-V.y*.65)*k;
      g.tunnel=k;
    }else g.tunnel=0;
    // pilot inputs: pitch (W down / S up), bank (A/D); auto-trim relaxes toward a gentle glide
    const pitchIn = it.moveLocal ? -it.moveLocal.y : 0, rollIn = it.moveLocal ? it.moveLocal.x : 0;
    let targetPitch = TL.clamp(-0.085 + pitchIn * (pitchIn > 0 ? 0.95 : 0.6) + (it.dive ? -0.6 : 0), -1.2, 0.85);
    // opening: the wing is thrown nose-up first (the canopy bites -> the pop up), then settles into the forward glide
    const hsp0 = Math.hypot(V.x, V.z);
    if (g.t < 0.8) targetPitch = TL.lerp(Math.max(targetPitch, 0.22 * (1 - TL.clamp((-V.y - 4) / 10, 0, 1))), targetPitch, TL.smooth(0.14, 0.8, g.t));
    // stall recovery: a stalled wing drops its nose toward the flight path so it re-builds speed instead of hanging in a deep stall
    if (g.aoa > 0.5 && V.y < -3) targetPitch = Math.min(targetPitch, Math.max(-1.2, Math.atan2(V.y, Math.max(hsp0, 6)) + 0.12));
    g.pitch = TL.damp(g.pitch, targetPitch, g.t < 0.8 ? 4.5 : 3.0, h);
    g.roll = TL.damp(g.roll, rollIn * 0.85, 3.5, h);
    // body axes
    const cy = Math.cos(g.yaw), sy = Math.sin(g.yaw), cp = Math.cos(g.pitch), sp = Math.sin(g.pitch);
    const fx = sy * cp, fy = sp, fz = cy * cp;
    const rx = cy, ry = 0, rz = -sy;                    // lateral axis (level; points to the hero's left)
    const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;  // body up = fwd x lateral
    // roll: rotate right/up around forward
    const cr = Math.cos(g.roll), sr = Math.sin(g.roll);
    const ux2 = ux * cr - rx * sr, uy2 = uy * cr - ry * sr, uz2 = uz * cr - rz * sr;
    const rx2 = rx * cr + ux * sr, ry2 = ry * cr + uy * sr, rz2 = rz * cr + uz * sr;
    const rvx = V.x - wind.x, rvy = V.y - wind.y, rvz = V.z - wind.z;
    const s = Math.hypot(rvx, rvy, rvz) || 1e-3;
    const vx = rvx / s, vy = rvy / s, vz = rvz / s;
    // angle of attack in the body's pitch plane
    const aoa = Math.atan2(-(vx * ux2 + vy * uy2 + vz * uz2), vx * fx + vy * fy + vz * fz);
    g.aoa = aoa;
    const stallA = 0.33;
    let CL = TL.clamp(5.2 * aoa, -1.1, 1.25);
    g.stall = aoa > stallA;
    if (g.stall) CL = 0.55 - (aoa - stallA) * 0.8;
    g.t += h; g.deploy = TL.smooth(0, 0.55, g.t);
    const dep = Math.exp(-g.t * 3.2);                   // 1 at the moment the wings open -> 0 after ~1 s
    const CD = 0.088 + 0.13 * CL * CL + (g.stall ? 0.35 : 0);
    const K = 0.0245 * st8.glide * (1 + 0.5 * dep);     // wing area: extra lift while the canopy fills
    // lift perpendicular to relative wind, in the plane of body-up
    let lx = ux2 - vx * (ux2 * vx + uy2 * vy + uz2 * vz), ly = uy2 - vy * (ux2 * vx + uy2 * vy + uz2 * vz), lz = uz2 - vz * (ux2 * vx + uy2 * vy + uz2 * vz);
    const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    const Lm = K * CL * s * s, Dm = K * 0.55 * CD * s * s * (1 + 2.4 * dep * dep);   // parachute resistance as it opens
    a.x += lx * Lm - vx * Dm; a.y += ly * Lm - vy * Dm; a.z += lz * Lm - vz * Dm;
    g.lift = Lm; g.drag = Dm;
    // cruise assist: the wing keeps its momentum (a glider never just stalls out of the air) — thrust only below cruise speed
    // and only when flying roughly level or down, so pulling up still trades speed for height and stalls
    const cruise = 25 * st8.glide, hsp = Math.hypot(V.x, V.z);
    if (!g.stall && hsp > 1 && g.pitch < 0.25) {
      const thr = TL.clamp((cruise - s) / 9, 0, 1) * 3.6 * g.deploy;
      a.x += (V.x / hsp) * thr; a.z += (V.z / hsp) * thr;
    }
    // banking turns the glider: the horizontal velocity swings toward the lowered wing (speed is kept), so A / D carve left and
    // right across the screen instead of just rolling the body. screen-right (D) = yaw decreasing.
    {
      const hs1 = Math.hypot(V.x, V.z);
      if (hs1 > 3 && g.t > 0.12) {
        const dpsi = -g.roll * 0.62 * TL.clamp(hs1 / 22, 0.55, 1.25) * h, c = Math.cos(dpsi), sn = Math.sin(dpsi);
        const nx = V.x * c + V.z * sn, nz = -V.x * sn + V.z * c; V.x = nx; V.z = nz;
        g.yaw += dpsi;
      }
    }
    // heading follows the velocity (weathervane)
    const hv = Math.hypot(V.x, V.z);
    if (hv > 2) g.yaw = TL.dampAngle(g.yaw, Math.atan2(V.x, V.z), 2.5, h);
    this.facing = g.yaw;
    void rx2; void ry2; void rz2;
  }
  wallForces(a, h, it) {
    const V = this.vel, n = this.wallN, st8 = this.stats;
    if(this.corner?.flow){a.set(0,this.fsm.state===TL.TS.CRAWL?0:-TL.C.G*.15,0);return;}
    if(this.roofFlow){a.set(0,-TL.C.G*.35,0);return;}
    if (this.corner) {
      // around an outer corner: the body circles the vertical edge at contact distance while the
      // wall normal turns with it — hands and feet transfer face to face, nothing snaps 90 degrees
      const C = this.corner, P = this.pos;
      C.t += h;
      const u = TL.clamp(C.t / C.dur, 0, 1), e = u * u * (3 - 2 * u), ang = C.a0 + C.da * e;
      const tx = C.E.x + Math.sin(ang) * C.r, tz = C.E.z + Math.cos(ang) * C.r;
      V.x = (tx - P.x) / h; V.z = (tz - P.z) / h;
      V.y = this.fsm.state === TL.TS.CRAWL ? TL.damp(V.y, 0, 10, h) : V.y;
      a.set(0, this.fsm.state === TL.TS.WALL ? -TL.C.G * 0.15 : 0, 0);
      this.wallN.set(Math.sin(ang), 0, Math.cos(ang));
      if (u >= 1) { V.x = C.out.x * C.sp; V.z = C.out.z * C.sp; this.wallCol = C.col; this.corner = null; }
      return;
    }
    // stick to the wall (normal force from grip) and remove motion into it
    a.x -= n.x * 25; a.z -= n.z * 25;
    const st = this.fsm.state;
    if (st === TL.TS.WALL) {
      if (this.wallMode === 'up') a.y += TL.C.G * 0.62;           // running up: partial support that fades
      else a.y += TL.C.G * 0.78;                                   // horizontal run: most weight carried
      this.wallTime += h;
      const fade = TL.clamp(this.wallTime / st8.wallTime, 0, 1);
      a.y -= TL.C.G * 0.55 * fade;
      // input steers along the wall
      if (it.move.lengthSq() > 0.01) {
        const tx = -n.z, tz = n.x;                                  // horizontal tangent
        const lat = it.move.x * tx + it.move.z * tz;
        a.x += tx * lat * 10; a.z += tz * lat * 10;
      }
    } else {
      // CRAWL: slow, fully supported, input moves in wall plane (up = forward input)
      a.y = 0; V.multiplyScalar(Math.max(0, 1 - 10 * h));
      const tx = -n.z, tz = n.x;
      const up = it.moveLocal ? it.moveLocal.y : 0, lat = it.moveLocal ? it.moveLocal.x : 0;
      // lateral relative to camera: project camRight on wall tangent
      const cr = it.camRight; const side = Math.sign(cr.x * tx + cr.z * tz) || 1;
      const sp = it.sprint ? 7 : 4;
      V.y = TL.damp(V.y, up * sp, 12, h);
      const vt = TL.damp(V.x * tx + V.z * tz, lat * side * sp, 12, h);
      V.x = tx * vt - n.x * 0.5; V.z = tz * vt - n.z * 0.5;
    }
  }
  ceilForces(a, h, it) {
    const V = this.vel;
    a.set(0, 25, 0);                                               // grip pulls up into the ceiling
    V.y = Math.min(V.y, 0.5);
    if(this.ceilCarry>0){this.ceilCarry=Math.max(0,this.ceilCarry-h);a.x+=it.move.x*3;a.z+=it.move.z*3;return;}
    const sp = 3.5;
    V.x = TL.damp(V.x, it.move.x * sp, 10, h); V.z = TL.damp(V.z, it.move.z * sp, 10, h);
  }
  launchForces(a, h, it) {
    const L = this.launch, V = this.vel, P = this.pos;
    L.t += h;
    L.anticipateBoost=!!it.jumpHeld||L.boosted;
    if (L.arrived) {
      L.plantT += h; a.set(0,0,0); V.set(0,0,0); P.copy(this.perchPoint);
      const push=TL.smooth(.09,.24,L.plantT);
      P.y+=push*.24; P.addScaledVector(L.heading,push*.12);
      if (this.jumpBuffer > 0 || it.jumpHeld) L.boosted = true;
      if (L.plantT < .24) return;
      this.tether.releaseAll();
      if (L.boosted) {
        const gain=L.perfect?1.22:1;
        const forward=Math.max(24,L.inSpeed*.96)*this.stats.launch*gain;
        V.copy(L.heading).multiplyScalar(forward); V.y=(L.perfect?15:12.5)*this.stats.launch;
        this.jumpBuffer=0; this.style+=L.perfect?65:40;
        this.fsm.set(TL.TS.AIR,L.narrow?'support-launch':'launch-boost');
        this.emit('launchboost',{perfect:!!L.perfect,point:L.point.clone(),speed:V.length()});
      } else {
        this.perchFacing=Math.atan2(-L.heading.x,-L.heading.z);
        TL.PerchSupport.enter(this,L.col,L.point,this.perchFacing);
        this.fsm.set(TL.TS.PERCH,'launch-perch');
      }
      this.launch=null; return;
    }
    const r0 = this.tether.ropes[0], r1 = this.tether.ropes[1];
    if (!r0.attached) return;
    if (!L.gripped) { L.gripped=true; this.emit('zipgrip',L.point); }
    if (!L.pulled && L.t >= .24) { L.pulled=true; this.emit('zippull'); }
    // rapid reel-in: shortening the rope makes the constraint pull the hero toward the point
    const d = P.distanceTo(L.point);
    // Acceleration lands on the visual arm pull, then eases into the ledge.
    const reel = TL.lerp(18,64,TL.smooth(.1,.34,L.t))*TL.lerp(.35,1,TL.smooth(1.6,8,d));
    r0.L = Math.max(0.8, r0.L - reel * h); r1.L = r0.L;
    a.y *= 0.35;                                                   // lines carry most of the weight
    L.window = d < 7;
    if (L.t > 3 && d >= 1.6) {
      this.tether.releaseAll(); this.launch = null;
      this.fsm.set(TL.TS.AIR, 'zip-interrupted');
      return;
    }
    if (d < 1.6) {
      // arrival: timed jump converts momentum into a launch, otherwise perch on the edge
      L.boosted = L.boosted || this.jumpBuffer > 0 || (it.jumpHeld && L.window);
      // Finish the ledge catch before pushing off: the rope targets the hands,
      // but the launch must start with the feet above that supporting surface.
      this.perchPoint.copy(L.point).y += TL.C.FEET + .02;
      const support=TL.PerchSupport.describe(L.col,L.point,this.facing);
      L.narrow=!!support&&['rail','cap','rounded'].includes(support.type);
      P.copy(this.perchPoint);
      L.inSpeed = Math.max(V.length(),16);
        // heading: the zip's own horizontal momentum where it has some, blended toward where the camera looks
        const hs = Math.hypot(V.x, V.z), cl = Math.hypot(it.camFwd.x, it.camFwd.z) || 1, w = TL.clamp((hs - 3) / 15, 0, 0.6);
        const fx = it.camFwd.x / cl * (1 - w) + (hs > 0.1 ? V.x / hs : 0) * w, fz = it.camFwd.z / cl * (1 - w) + (hs > 0.1 ? V.z / hs : 0) * w, fl = Math.hypot(fx, fz) || 1;
      L.heading=new THREE.Vector3(fx/fl,0,fz/fl);
      L.arrived=true; L.plantT=0; this.jumpBuffer=0;
      a.set(0,0,0); V.set(0,0,0); this.emit('pointcatch',L.point);
    }
  }
  slingForces(a, h, it) {
    const sl = this.sling, P = this.pos, V = this.vel;
    sl.t += h;
    // player pulls back against the elastic cords (legs on ground, or momentum in air)
    if (sl.braced) {
      // braced on a surface: walk backward against the cords until the maximum draw
      a.set(0, this.grounded ? 0 : -TL.C.G, 0);
      const bx = -it.camFwd.x, bz = -it.camFwd.z; const bl = Math.hypot(bx, bz) || 1;
      const T = this.tether.ropes;
      const s0 = Math.max(0, P.distanceTo(T[0].anchor) - T[0].rest), s1 = Math.max(0, P.distanceTo(T[1].anchor) - T[1].rest);
      sl.pull = (s0 + s1) / 2; sl.tension = T[0].k * (s0 + s1);
      const maxDraw = 10;
      const sp = sl.pull < maxDraw ? 4.5 : 0;
      V.x = (bx / bl) * sp; V.z = (bz / bl) * sp;
      if (!this.grounded && sl.t > 0.25 && this.fsm.state !== TL.TS.PERCH) sl.braced = false;   // lost footing: cords take over
    } else {
      sl.pull = Math.max(0, P.distanceTo(this.tether.ropes[0].anchor) - this.tether.ropes[0].rest);
    }
  }
  waterForces(a, h, it) {
    const V = this.vel, P = this.pos;
    const depth = TL.C.WATER_Y - (P.y - 0.3);
    a.y += TL.C.G * 1.15 * TL.clamp(depth / 0.6, 0, 1.6);          // buoyancy
    V.multiplyScalar(Math.max(0, 1 - 2.5 * h));                  // water drag
    if (it.move.lengthSq() > 0.01) { a.x += it.move.x * 9; a.z += it.move.z * 9; }
    this.waterTime += h;
  }

  /* ---------------------------------------------------------------- collision + contacts */
  collide(h, it) {
    const P = this.pos, V = this.vel, W = this.world, R = TL.C.CAP_R;
    let ci = 0;
    const cands = this.cands;
    // refresh dynamic colliders in candidate list (they move every frame)
    // the body's current shape: standing capsule, or the folded shape of a tuck / vault / step-over
    const sh = this.shape || { off: TL.C.CAP_OFF, r: [R, R, R] };
    for (let iter = 0; iter < 2; iter++) {
      for (let k = 0; k < sh.off.length; k++) ci = W.resolveSphere(P, V, sh.off[k], sh.r[k], cands, this.contacts, ci);
    }
    this.nContacts = ci;
    this._contactPush = 0;
    if (this.fsm.state === TL.TS.VAULT) for (let i = 0; i < ci; i++) this._contactPush = Math.max(this._contactPush, this.contacts[i].depth);
    // ground plane (streets / sidewalks / park) and water
    const gy = W.ground(P.x, P.z);
    const water = W.waterFn && W.waterFn(P.x, P.z);
    this.inWater = false;
    if (this.fsm.state === TL.TS.VAULT) { /* the planned path owns height; validated against the ground already */ }
    else if (!water) {
      if (P.y - TL.C.FEET < gy + 0.015 && V.y <= 0.5) {
        if (P.y - TL.C.FEET < gy) P.y = gy + TL.C.FEET;
        if (V.y < 0) { this.lastImpactSpeed = -V.y; V.y = 0; }
        this.addContact(0, 1, 0, null);
      }
    } else if (P.y - 0.9 < TL.C.WATER_Y) {
      this.inWater = true;
    }
    // classify contacts
    this.grounded = false; this.groundCol = null;
    let wall = null, ceil = null, bestImpact = 0;
    for (let i = 0; i < this.nContacts; i++) {
      const c = this.contacts[i];
      if (c.ny > 0.65) { this.grounded = true; this.groundCol = c.col; this.groundY = P.y - TL.C.FEET; }
      else if (c.ny < -0.7) ceil = c;
      else if (Math.abs(c.ny) < 0.35 && c.col) { if (!wall || c.depth > wall.depth) wall = c; }
      if (-c.vn > bestImpact) bestImpact = -c.vn;
    }
    this.impact = bestImpact;
    this._wallContact = wall; this._ceilContact = ceil;
    // step-up small obstacles while moving on the ground
    if (wall && this.grounded && wall.col && wall.yOff < 0 && (this.fsm.state === TL.TS.GROUND)) {
      const top = wall.col.cy + wall.col.hy;
      const feet = P.y - TL.C.FEET;
      // only onto a top with room for a foot; a thin parapet / rail is a contact move or a stop, never a pop onto it
      const room = Math.min(wall.col.hx, wall.col.hz) * 2;
      if (top - feet > 0.02 && (top - feet < 0.3 || (top - feet < 0.6 && room > 0.6))) { P.y = top + TL.C.FEET + 0.02; this._wallContact = null; }
    }
  }
  addContact(nx, ny, nz, col) {
    if (this.nContacts < this.contacts.length) { const k = this.contacts[this.nContacts++]; k.nx = nx; k.ny = ny; k.nz = nz; k.depth = 0.01; k.col = col; k.vn = 0; k.yOff = -0.57; }
  }

  /* ---------------------------------------------------------------- state transitions */
  transitions(h, it) {
    const S = TL.TS, fsm = this.fsm, st = fsm.state, V = this.vel, P = this.pos;
    if (st !== S.SWING) this.swingWall = false;
    const hs = Math.hypot(V.x, V.z);
    // WATER
    if (this.inWater && st !== S.WATER && st !== S.SWING && st !== S.LAUNCH) {
      if (hs > 15 && V.y > -14 && (st === S.AIR || st === S.DIVE || st === S.GLIDE)) {
        // skim: bounce off the surface, lose some speed
        P.y = TL.C.WATER_Y + 0.9; V.y = Math.abs(V.y) * 0.35 + 2.2; V.x *= 0.86; V.z *= 0.86;
        this.skims++; this.style += 15; this.emit('skim', hs);
        return;
      }
      this.tether.releaseAll(); fsm.set(S.WATER, 'splash'); this.waterTime = 0; this._waterRecoverSent = false; this.emit('splash', V.length());
      return;
    }
    switch (st) {
      case S.GROUND:
        if (!this.grounded) { this.coyote += h; if (this.coyote > 0.12) fsm.set(S.AIR, 'walk-off'); }
        else this.coyote = 0;
        if (this.jumpBuffer > 0 && (this.grounded || this.coyote < 0.12)) {
          this.jumpBuffer = 0;
          V.y = this.stats.jump + (this.sprinting ? 1.0 : 0);
          fsm.set(S.AIR, 'jump'); this.emit('jump');
        }
        // parkour: vault / mantle when sprinting into an obstacle
        if (this._wallContact && this._wallContact.col && it.move.lengthSq() > 0.2) this.tryVaultOrWall(it);
        break;
      case S.RECOVER:
        this.recoverT -= h;
        // a held jump cuts the heavy recovery short once the legs have absorbed the hit
        if (this.jumpBuffer > 0 && this.landing && this.landing.kind === 'heavy' && this.fsm.t > 0.22) this.recoverT = 0;
        if (this.recoverT <= 0) fsm.set(this.grounded ? S.GROUND : S.AIR, 'recovered');
        break;
      case S.VAULT: break;
      case S.AIR: case S.DIVE:
        if (it.dive && st === S.AIR && this.airTime > 0.15) fsm.set(S.DIVE, 'dive');
        if (!it.dive && st === S.DIVE) fsm.set(S.AIR, 'undive');
        // moving up past a ledge you just launched from is not a landing
        if (this.grounded && V.y <= 0.5) { this.land(it); break; }
        if (this._wallContact && this._wallContact.col && this._wallContact.col.climb) this.enterWall(this._wallContact, it);
        else if (this._ceilContact && this._ceilContact.col && this._ceilContact.col.climb && V.y > -2) { fsm.set(S.CEIL, 'ceiling'); this.ceilCol = this._ceilContact.col; }
        break;
      case S.SWING:
        if (this.grounded && V.y <= 0.5) { this.swingWall = false; this.tether.releaseAll(); this.land(it); }
        else this.swingWallUpdate(h,it);
        break;
      case S.GLIDE:
        if (this.grounded) { this.land(it); break; }
        if (this._wallContact && this._wallContact.col && this._wallContact.col.climb) this.enterWall(this._wallContact, it);
        break;
      case S.WALL: case S.CRAWL:
        this.wallUpdate(h, it);
        break;
      case S.CEIL:
        if(this._wallContact?.col?.climb&&!TL.isClimbPole(this._wallContact.col)&&it.move.lengthSq()>.1){
          const hit=this._wallContact,n=this.wallN.set(hit.nx,0,hit.nz).normalize();
          const speed=Math.min(this.preVel.length(),Math.hypot(this.preVel.x,this.preVel.z));
          this.wallCol=hit.col;V.addScaledVector(n,-V.dot(n));V.y=-speed*.85;
          if(V.length()>this.preVel.length())V.setLength(this.preVel.length());
          this.wallMode='side';this.wallTime=0;fsm.set(S.WALL,'ceiling-to-wall');this.emit('surfacehandoff','wall');
        }else if (!this._ceilContact && !this.probeCeiling()) fsm.set(S.AIR, 'ceiling-lost');
        if (this.jumpBuffer > 0 || it.dive) { this.jumpBuffer = 0; V.y = -3; fsm.set(S.AIR, 'ceiling-drop'); }
        break;
      case S.PERCH:
        if(this.perchSupport&&(this.perchSupport.col.id!==this.perchSupport.id||!this.perchSupport.col.cells)){this.perchSupport=null;fsm.set(S.AIR,'support-lost');break;}
        if (this.jumpBuffer > 0) { this.jumpBuffer = 0; V.set(0, this.stats.jump * 1.1, 0); const f = it.camFwd; V.x = f.x * 6; V.z = f.z * 6; fsm.set(S.AIR, 'perch-jump'); }
        else if (it.move.lengthSq() > 0.3) { fsm.set(S.GROUND, 'perch-walk'); }
        break;
      case S.WATER:
        if (!this.inWater && P.y > TL.C.WATER_Y + 0.5) fsm.set(S.AIR, 'exit-water');
        else if (this.waterTime > 5 && !this._waterRecoverSent) { this._waterRecoverSent = true; this.emit('waterrecover'); }
        break;
      case S.SLING:
        if (this.fsm.t > 6) this.releaseSling();
        break;
    }
  }
  land(it) {
    const S = TL.TS, V = this.vel;
    const impact = Math.max(this.lastImpactSpeed || 0, this.impact || 0, -V.y);
    this.lastImpactSpeed = 0; this.coyote = 0;                // the walk-off window starts fresh on every landing
    // a micro-hop (support flicker between substeps, a curb) is not a landing: no record, no effects
    if (this.airTime < 0.1 && impact < 3 && this.fsm.state === S.AIR) { this.fsm.set(S.GROUND, 'resettle'); return; }
    const L = TL.Contact ? TL.Contact.classifyLanding(this, impact, it) : { kind: impact > 32 ? 'heavy' : 'crouch', impact, hs: Math.hypot(V.x, V.z), t: 0, id: 1 };
    if (L.kind === 'heavy' && this.jumpBuffer > 0) L.kind = 'crouch';
    L.airTime = this.airTime; L.from = this.fsm.state;
    this.landing = L;
    // damage / recovery rules are unchanged; only the body's way of absorbing the hit depends on the context
    if (impact > 50) this.damage(Math.min(20, (impact - 50) * 0.8), 'fall');
    if (L.kind === 'narrow' && TL.PerchSupport && TL.PerchSupport.enter(this, L.col, this.pos, Math.atan2(V.x, V.z))) {
      // shared narrow-support perch (rails, caps, ledges): bounded contact region on the real top
      this.fsm.set(S.PERCH, 'narrow-landing');
    } else if (L.kind === 'narrow') {
      // feet onto the narrow top along its long axis, facing the open side closest to the travel direction
      const c = L.col, P = this.pos, loc = c.toLocal(P.x, P.y, P.z, { x: 0, y: 0, z: 0 });
      const alongX = c.hx >= c.hz, lx = alongX ? TL.clamp(loc.x, -c.hx + 0.35, c.hx - 0.35) : 0, lz = alongX ? 0 : TL.clamp(loc.z, -c.hz + 0.35, c.hz - 0.35);
      const w = c.toWorld(lx, c.hy, lz, { x: 0, y: 0, z: 0 });
      this.perchPoint.set(w.x, w.y + TL.C.FEET + 0.01, w.z);
      const nrm = c.dirToWorld(alongX ? 0 : 1, 0, alongX ? 1 : 0, { x: 0, y: 0, z: 0 });
      const sg = (V.x * nrm.x + V.z * nrm.z) >= 0 ? 1 : -1;
      this.perchFacing = Math.atan2(nrm.x * sg, nrm.z * sg);
      TL.PerchSupport.enter(this,c,this.perchPoint,this.perchFacing);
      V.set(0, 0, 0); this.fsm.set(S.PERCH, 'narrow-landing');
    } else if (L.kind === 'roll') {
      this.rollDir = L.dir; this.rollSpeed = TL.clamp(L.hs * 0.62, 5.5, 8.5); this.rollBrake = false;
      this.recoverT = 0.58; this.fsm.set(S.RECOVER, 'roll');
    } else if (L.kind === 'heavy') {
      // hard landing: deep compression, momentum partly preserved, never clipping or instant death
      this.recoverT = 0.45; this.fsm.set(S.RECOVER, 'hard-landing'); V.x *= 0.6; V.z *= 0.6;
    } else if(this.groundCol?.perch&&Math.hypot(V.x,V.z)<4&&this.jumpBuffer<=0&&TL.PerchSupport.enter(this,this.groundCol,this.pos,this.facing))this.fsm.set(S.PERCH,'support-land');
    else this.fsm.set(S.GROUND, 'land');
    this.emit(L.kind === 'heavy' ? 'hardland' : 'land', impact, L);
  }
  recoverForces(a, h, it) {
    const L = this.landing;
    if (L && L.kind === 'roll') {
      // the roll carries the run forward; it brakes instead of rolling off an edge or into a wall
      if (this.grounded) a.y = 0;
      const sp = this.rollBrake ? 0 : this.rollSpeed * (1 - 0.25 * TL.clamp(this.fsm.t / 0.58, 0, 1));
      const tx = Math.sin(this.rollDir) * sp, tz = Math.cos(this.rollDir) * sp;
      const k = this.rollBrake ? 40 : 18;
      a.x += (tx - this.vel.x) * k; a.z += (tz - this.vel.z) * k;
      return;
    }
    this.groundForces(a, h, it, 0.25);
  }
  /* once per fixed step: obstacle approach / commit, roof-edge climb, airborne tuck, roll safety */
  contactStep(dt, it) {
    if (!TL.Contact) return;
    const S = TL.TS, st = this.fsm.state, C = TL.Contact;
    // left the contact move by any other route (teleport, water, damage...): no stale move or folded shape
    if (this.action && st !== S.VAULT) { this.action = null; if (this.shape !== TL.BodyShapes.tuck || C.standFree(this)) this.shape = TL.BodyShapes.stand; }
    this._probeK = (this._probeK || 0) + 1;
    // supported: box-collider roofs re-settle the capsule every other substep, so use the coyote window too
    if (st === S.GROUND && (this.grounded || this.coyote < 0.08) && !this.action) {
      const near = this.contactPlan && this.contactPlan.d0 < this.contactPlan.takeoff + 1.2;
      if (near || this._probeK % 2 === 0) this.contactPlan = C.probe(this, it);
      const p = this.contactPlan;
      if (p && p.d0 <= p.takeoff + Math.hypot(this.vel.x, this.vel.z) * dt) { this._leadFoot = this._leadFoot === 'L' ? 'R' : 'L'; C.start(this, p); }
    } else if (st !== S.VAULT) this.contactPlan = null;
    if(TL.SurfaceFlow&&TL.SurfaceFlow.roof(this,it))return;
    // wall: reaching the roof edge becomes a climb over the lip (hands, shoulders, knee, settle)
    if ((st === S.WALL || st === S.CRAWL) && !this.corner && !this.roofFlow && this.wallCol && this._probeK % 2 === 0) {
      const top = this.wallCol.cy + this.wallCol.hy, P = this.pos;
      const climbing = st === S.CRAWL ? this.vel.y > 0.2 && P.y > top - 2.0 : this.wallMode === 'up' && this.vel.y > 1 && P.y > top - 2.4;
      if (climbing) { const plan = C.planClimbOver(this, it); if (plan && plan.hgt < (st === S.CRAWL ? 1.95 : 2.25)) C.start(this, plan); }
    }
    // airborne clearance tuck: only where the tucked body fits and the standing one would not
    const air = st === S.AIR || st === S.DIVE || st === S.SWING;
    if (air && this._probeK % 2 === 0 && C.airClearance(this)) { this.tuckHold = 0.18; this.shape = TL.BodyShapes.tuck; }
    if (this.shape === TL.BodyShapes.tuck && st !== S.VAULT) {
      this.tuckHold -= dt;
      if (this.tuckHold <= 0 && C.standFree(this)) this.shape = TL.BodyShapes.stand;
    }
    this.tuck = this.shape === TL.BodyShapes.tuck && st !== S.VAULT ? 1 : 0;
    if (st === S.RECOVER && this.landing && this.landing.kind === 'roll' && !this.rollBrake && this._probeK % 2 === 0) {
      if (C.rollRoom(this, this.rollDir, 1.1) < 1.0) this.rollBrake = true;
    }
    if (this.landing) this.landing.t += dt;
  }
  damage(n, src) { this.health = Math.max(1, this.health - n); this.emit('damage', n, src); }

  swingWallUpdate(h,it) {
    if(this.corner?.flow&&this.tether.main.active&&this.tether.main.attached){this.swingWall=true;return;}
    const r = this.tether.main, P = this.pos, V = this.vel, n = this.wallN;
    if (!r.active || !r.attached || r.kind !== 'swing') { this.swingWall = false; return; }
    let hit = this._wallContact;
    if (!hit && this.swingWall && V.x * n.x + V.z * n.z < 1.5) {
      hit = this.world.raycast(P.x, P.y, P.z, -n.x, 0, -n.z, TL.C.CAP_R + 0.25,
        (c) => c.solid && c.climb, null, { noGround: true });
    }
    if (!hit || !hit.col || !hit.col.climb || Math.abs(hit.ny) > 0.35 || TL.isClimbPole(hit.col)) {
      this.swingWall = false; return;         // edge, roof or outward rope pull: flow back into the same swing
    }
    const entered = !this.swingWall;
    n.set(hit.nx, 0, hit.nz).normalize();
    if (V.x * n.x + V.z * n.z > 1.5) { this.swingWall = false; return; }
    this.swingWall = true; this.wallCol = hit.col;
    this.wallTime = entered ? 0 : this.wallTime + h;
    this.wallMode = Math.abs(V.y) > Math.hypot(V.x, V.z) ? 'up' : 'side';
    if (hit.x !== undefined) (this._wallPt || (this._wallPt = new THREE.Vector3())).set(hit.x, hit.y, hit.z);
    if (entered) this.emit('wall', 'swing');
  }
  enterWall(c, it) {
    const S = TL.TS, V = this.vel, PV = this.preVel;
    const n = this.wallN.set(c.nx, 0, c.nz).normalize();
    const into = -(PV.x * n.x + PV.z * n.z);
    const hs = Math.hypot(PV.x, PV.z);
    const wantUp = it.move.lengthSq() > 0.1 && (it.move.x * -n.x + it.move.z * -n.z) > 0.5;
    this.wallCol = c.col; this.wallTime = 0;
    // hard impact into the wall: recovery (no clipping), otherwise convert momentum into a wall run
    if (c.vn < -38) { this.recoverT = 0.35; this.fsm.set(S.RECOVER, 'wall-impact'); this.emit('wallimpact', -c.vn); V.multiplyScalar(0.3); return; }
    if (wantUp || into > hs * 0.7) {
      // run UP: convert horizontal speed into vertical (energy-plausible, with losses)
      this.wallMode = 'up';
      // re-gripping the same wall a moment after losing it (probe flicker on poles / ledges) carries the
      // current climb on; it must not add the run-up conversion again (stacked boosts catapulted the hero)
      const reentry = this._wallLostT !== undefined && (this.simT || 0) - this._wallLostT < 0.3;
      const up = reentry ? Math.max(PV.y, 0) : Math.max(PV.y, 0) + Math.min(Math.max(hs, 8) * 0.75, 24);
      V.set(0, up, 0);
    } else {
      this.wallMode = 'side';
      const tx = -n.z, tz = n.x; const vt = PV.x * tx + PV.z * tz;
      V.set(tx * vt, Math.max(PV.y, 0) * 0.6 + 2, tz * vt);
    }
    this.fsm.set(S.WALL, 'wall-' + this.wallMode); this.emit('wall', this.wallMode);
  }
  wallUpdate(h, it) {
    const S = TL.TS, V = this.vel, P = this.pos, n = this.wallN, W = this.world;
    if(TL.SurfaceFlow&&TL.SurfaceFlow.ceiling(this,it))return;
    if(this.roofFlow)return;
    // predictive probe into the wall
    if (this.corner) {
      if (this.jumpBuffer > 0) { this.corner = null; }           // leaping off mid-corner is always allowed
      else return;
    }
    // a pole is probed toward its own axis (a ray along -n can slip past a thin shaft)
    let pdx = -n.x, pdz = -n.z;
    if (TL.isClimbPole(this.wallCol)) { const ax = this.wallCol.cx - P.x, az = this.wallCol.cz - P.z, al = Math.hypot(ax, az); if (al > 1e-3) { pdx = ax / al; pdz = az / al; } }
    const probe = W.raycast(P.x, P.y, P.z, pdx, 0, pdz, 1.2, (c) => c.solid, null, { noGround: true });
    if (probe) (this._wallPt || (this._wallPt = new THREE.Vector3())).set(probe.x, probe.y, probe.z);
    if (this.jumpBuffer > 0) {
      // leap off: away from wall + up, keep tangential speed, bias toward camera
      this.jumpBuffer = 0;
      const tx = -n.z, tz = n.x; const vt = V.x * tx + V.z * tz;
      const f = it.camFwd;
      V.set(n.x * 7 + tx * vt * 0.8 + f.x * 5, 8.5, n.z * 7 + tz * vt * 0.8 + f.z * 5);
      this.fsm.set(S.AIR, 'wall-leap'); this.emit('wallleap');
      return;
    }
    if (!probe) {
      // lost the wall: either crested the top (vault onto roof) or reached an outer corner
      const col = this.wallCol;
      if (col && P.y > col.cy + col.hy - 1.2) {
        const plan = TL.Contact && TL.Contact.planClimbOver(this, it);
        if (plan) { TL.Contact.start(this, plan); return; }
        // A missed/blocked crest departs with its real velocity, never a canned boost.
        this.fsm.set(S.AIR, 'wall-crest'); this.emit('vault');
        return;
      }
      this._wallLostT = this.simT || 0; this.fsm.set(S.AIR, 'wall-lost');
      return;
    }
    this.wallCol = probe.col;
    if (probe.col) this.wallN.set(probe.nx, 0, probe.nz).normalize();
    // inner corner: another wall ahead in the running direction
    // (a pole's contact normal turns around the shaft every step — that is not a corner)
    if (!TL.isClimbPole(this.wallCol) && this._wallContact && this._wallContact.col && (Math.abs(this._wallContact.nx - n.x) + Math.abs(this._wallContact.nz - n.z)) > 0.8) {
      this.wallN.set(this._wallContact.nx, 0, this._wallContact.nz).normalize(); this.emit('corner', null);
    }
    const pole=TL.isClimbPole(this.wallCol);
    // Narrow antenna shafts are a grip, not a sideways wall-running surface.
    if(pole&&this.fsm.state===S.WALL&&this.fsm.t>.18&&it.move.lengthSq()<.01)
      this.fsm.set(S.CRAWL,'pole-grip');
    if (this.grounded && !pole && this.fsm.t > 0.2) { this.fsm.set(S.GROUND, 'wall-to-ground'); return; }
    if (this.fsm.state === S.WALL && V.y < 1.5 && this.wallMode === 'up' && this.fsm.t > 0.25) this.fsm.set(S.CRAWL, 'wall-crawl');
    if (this.fsm.state === S.WALL && this.wallMode === 'side' && this.wallTime > this.stats.wallTime) this.fsm.set(S.CRAWL, 'side-to-crawl');
    if (this.fsm.state === S.CRAWL && it.dive) { this.fsm.set(S.AIR, 'crawl-drop'); V.set(this.wallN.x * 2, 0, this.wallN.z * 2); }
    // crawl onto the roof when reaching the top
    if (this.fsm.state === S.CRAWL && this.wallCol && P.y > this.wallCol.cy + this.wallCol.hy - 0.4 && V.y > 0.5) {
      const plan = TL.Contact && TL.Contact.planClimbOver(this, it);
      if (plan) { TL.Contact.start(this, plan); return; }
      V.set(-n.x * 3, 5.5, -n.z * 3); this.fsm.set(S.AIR, 'crawl-mantle'); this.emit('vault');
    }
    // ceiling transition: overhang above while crawling up
    // Ceiling handoffs are checked by SurfaceFlow.ceiling above.
  }
  probeCeiling() {
    const P = this.pos;
    const h = this.world.raycast(P.x, P.y, P.z, 0, 1, 0, 1.3, (c) => c.solid, null, { noGround: true });
    return !!h;
  }
  tryVaultOrWall(it) {
    const c = this._wallContact, V = this.vel, P = this.pos;
    const col = c.col; const top = col.cy + col.hy; const feet = P.y - TL.C.FEET;
    const hs = Math.hypot(this.preVel.x, this.preVel.z);
    const rise = top - feet;
    if (TL.Contact && rise < 1.95) {
      // a low lip / parapet at the foot of a taller climbable face: sprinting runs up the face behind it
      if (it.sprint) {
        const t = this.world.raycast(P.x, P.y + 0.6, P.z, -c.nx, 0, -c.nz, 1.6, (q) => q.solid && q.climb && q !== col, null, { noGround: true });
        if (t && t.col && t.col.cy + t.col.hy - feet >= 1.95 && Math.abs(t.ny) < 0.3) this.enterWall({ nx: t.nx, ny: 0, nz: t.nz, col: t.col, vn: -hs * 0.4 }, it);
      }
      return;                                              // otherwise: contact move (probe) or a plain stop
    }
    if (rise < 1.3 && hs > 4) {
      // vault: momentum-preserving hop over a low obstacle
      V.y = Math.sqrt(2 * TL.C.G * (rise + 0.5)); V.x *= 1.05; V.z *= 1.05;
      this.fsm.set(TL.TS.AIR, 'vault'); this.emit('vault');
    } else if (rise < 2.6 && hs > 2) {
      // mantle: pull up onto a ledge within reach
      V.y = Math.sqrt(2 * TL.C.G * (rise + 0.35)); V.x -= c.nx * 2; V.z -= c.nz * 2;
      this.fsm.set(TL.TS.AIR, 'mantle'); this.emit('vault');
    } else if (it.sprint && col.climb) {
      this.enterWall(c, it);
    }
  }
  updateFacing(dt, it) {
    const V = this.vel, st = this.fsm.state, S = TL.TS;
    let target = this.facing;
    if (st === S.RECOVER && this.landing && this.landing.kind === 'roll') target = this.rollDir;
    else if (st === S.GROUND || st === S.RECOVER) { if (Math.hypot(V.x, V.z) > 0.6) target = Math.atan2(V.x, V.z); }
    else if (st === S.WALL || st === S.CRAWL) target = Math.atan2(-this.wallN.x, -this.wallN.z);
    else if (st === S.GLIDE) target = this.glide.yaw;
    else if (st === S.VAULT && this.action) target = Math.atan2(this.action.plan.hx, this.action.plan.hz);
    else if (st === S.SLING) target = Math.atan2(it.camFwd.x, it.camFwd.z);
    else if (Math.hypot(V.x, V.z) > 2) target = Math.atan2(V.x, V.z);
    this.facing = TL.dampAngle(this.facing, target, st === S.GROUND || st === S.VAULT ? 14 : 6, dt);
  }
  updateDebug() {
    const r = this.tether.main, D = this.debug, V = this.vel, P = this.pos;
    if (r.attached) {
      const pv = r.pivot(); const dx = P.x - pv.x, dy = P.y - pv.y, dz = P.z - pv.z; const d = Math.hypot(dx, dy, dz) || 1;
      const vr = (V.x * dx + V.y * dy + V.z * dz) / d;
      D.vr = vr; D.vt = Math.sqrt(Math.max(0, V.lengthSq() - vr * vr)); D.ropeLen = r.L; D.ropeMax = r.maxL; D.dist = d;
    } else { D.vr = 0; D.vt = V.length(); D.ropeLen = 0; D.dist = 0; }
  }
};
