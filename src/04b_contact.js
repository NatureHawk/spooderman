/* =====================================================================================
   CONTACT TRAVERSAL (physics side) — movement that reacts to the geometry it touches.
   TL.BodyShapes   collision spheres for the standing body and for folded silhouettes (a tuck or a
                   vault really is smaller, so the visual fold and the collision shape agree).
   TL.Contact      * probe()        short-range obstacle reading in front of a running hero: horizontal
                                     rays (three lanes), a downward top-surface profile, the far face and
                                     the landing beyond; classifies step-over / one-hand vault / speed vault /
                                     two-hand vault / step-up / mantle, or nothing (collision, wall, stop)
                   * planClimbOver() roof-edge climb from a wall run / crawl (lip, standing room, perch)
                   * validate()      swept test of the planned path with the folded shape — a move whose
                                     body would intersect anything, or whose exit is blocked, is rejected
                   * actionStep()    executes a committed move along its velocity-continuous path
                   * airClearance()  tucks the body (shape + pose) only through openings the tucked
                                     shape fits and the standing shape does not
                   * classifyLanding() gentle / run / crouch / roll / heavy / narrow from the impact
   Everything is local and bounded: one broadphase query per probe into a reused array.
   ===================================================================================== */
'use strict';

TL.TS.VAULT = 'vault';   // committed contact move (step-over, vaults, step-up, mantle, roof-edge climb)

TL.BodyShapes = {
  stand: { name: 'stand', off: [-0.57, -0.08, 0.42], r: [0.38, 0.38, 0.38] },
  tuck: { name: 'tuck', off: [-0.15, 0.12, 0.38], r: [0.32, 0.34, 0.34] },     // knees and elbows drawn in
  vault: { name: 'vault', off: [0.1, 0.5], r: [0.17, 0.25] },                  // pelvis + leaning torso; legs swept beside at hip height
  step: { name: 'step', off: [-0.2, 0.42], r: [0.3, 0.3] },                     // a leg lifted over a low object
};

TL.Contact = {
  _cands: [], _hit: { t: 0 }, _hit2: { t: 0 }, _t: { x: 0, y: 0, z: 0 },
  // per-kind timing: duration range, phase marks (normalized) and takeoff distance from the near face
  KINDS: {
    stepover: { dur: [0.26, 0.42], contact: 0.18, release: 0.55, land: 0.82, takeoff: 0.42, shape: 'step', hands: 0 },
    vault1: { dur: [0.36, 0.6], contact: 0.22, release: 0.62, land: 0.9, takeoff: 0.62, shape: 'vault', hands: 1 },
    speed: { dur: [0.32, 0.5], contact: 0.2, release: 0.55, land: 0.88, takeoff: 0.85, shape: 'vault', hands: 1 },
    vault2: { dur: [0.48, 0.8], contact: 0.2, release: 0.6, land: 0.88, takeoff: 1.05, shape: 'vault', hands: 2 },
    stepup: { dur: [0.22, 0.36], contact: 0.3, release: 0.75, land: 0.8, takeoff: 0.4, shape: 'step', hands: 0 },
    mantle: { dur: [0.62, 0.9], contact: 0.12, release: 0.72, land: 0.9, takeoff: 0.46, shape: 'tuck', hands: 2 },
    climb: { dur: [0.42, 0.85], contact: 0.08, release: 0.7, land: 0.9, takeoff: 0, shape: 'tuck', hands: 2 },
  },
  solid(c) { return c.solid && !c.dynamic; },
  gather(W, minx, minz, maxx, maxz) { return W.query(minx, minz, maxx, maxz, this._cands); },
  sphereIn(c, x, y, z, r) {
    if (y - r > c.cy + c.hy || y + r < c.cy - c.hy) return false;
    const L = c.toLocal(x, y, z, this._t);
    const dx = L.x - TL.clamp(L.x, -c.hx, c.hx), dy = L.y - TL.clamp(L.y, -c.hy, c.hy), dz = L.z - TL.clamp(L.z, -c.hz, c.hz);
    return dx * dx + dy * dy + dz * dz < r * r;
  },
  /* first thing the shape overlaps at body-centre (x,y,z): a collider, 'ground', or null */
  overlap(W, cands, x, y, z, shape, skin, ignore) {
    skin = skin === undefined ? 0.03 : skin;
    const gy = W.ground(x, z), water = W.waterFn && W.waterFn(x, z);
    for (let k = 0; k < shape.off.length; k++) {
      const sy = y + shape.off[k], r = shape.r[k] - skin;
      if (!water && sy - r < gy - 0.02) return 'ground';
      for (let i = 0; i < cands.length; i++) { const c = cands[i]; if (c !== ignore && c.solid && this.sphereIn(c, x, sy, z, r)) return c; }
    }
    return null;
  },
  ray(W, ox, oy, oz, dx, dy, dz, d, hit, ground) {
    return W.raycast(ox, oy, oz, dx, dy, dz, d, (c) => c.solid && !c.dynamic, hit, { noGround: !ground });
  },
  /* surface height under (x,z), looking down from y0; returns {y, ny, col} or null */
  down(W, x, y0, z, maxD) {
    const h = this.ray(W, x, y0, z, 0, -1, 0, maxD || 6, this._hit2, true);
    return h ? { y: h.y, ny: h.ny, col: h.col } : null;
  },

  /* ---------------------------------------------------------------- obstacle probe (GROUND) */
  probe(h, it) {
    const P = h.pos, V = h.vel, W = h.world, FEET = TL.C.FEET;
    const ml = it.move ? Math.hypot(it.move.x, it.move.z) : 0;
    if (ml < 0.3) return null;
    const hs = Math.hypot(V.x, V.z);
    let hx = it.move.x / ml, hz = it.move.z / ml;
    if (hs > 2) { const w = 0.35, l = Math.hypot(hx * (1 - w) + V.x / hs * w, hz * (1 - w) + V.z / hs * w) || 1; hx = (hx * (1 - w) + V.x / hs * w) / l; hz = (hz * (1 - w) + V.z / hs * w) / l; }
    const feet = P.y - FEET, look = TL.clamp(0.9 + hs * 0.3, 1.2, 4.0);
    // cheap rejection: anything solid in reach whose top lies in the reachable band?
    const ex = Math.abs(hx) * look + 0.6, ez = Math.abs(hz) * look + 0.6, cx = P.x + hx * look * 0.5, cz = P.z + hz * look * 0.5;
    const cands = this.gather(W, cx - ex, cz - ez, cx + ex, cz + ez);
    let any = false;
    for (let i = 0; i < cands.length; i++) { const c = cands[i]; if (c.solid && !c.dynamic && c.cy + c.hy > feet + 0.08 && c.cy - c.hy < feet + 0.4) { any = true; break; } }
    if (!any) return null;
    const lx = hz, lz = -hx;                                   // horizontal axis to the hero's left (model +X)
    // 1) centre-lane horizontal rays from shin to above head: nearest blocking face
    let d0 = Infinity, nx = 0, nz = 0, col = null;
    for (const y of [0.16, 0.42, 0.78, 1.12]) {
      const r = this.ray(W, P.x, feet + y, P.z, hx, 0, hz, look, this._hit, false);
      if (r && r.t < d0 && Math.abs(r.ny) < 0.5) { d0 = r.t; nx = r.nx; nz = r.nz; col = r.col; }
    }
    if (!col) return null;
    // too tall to vault or mantle: wall-run / climb / collision keep ownership
    const tall = this.ray(W, P.x, feet + 2.15, P.z, hx, 0, hz, d0 + 0.45, this._hit, false);
    if (tall) return null;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const facing = -(hx * nx + hz * nz);                      // 1 = square approach
    if (facing < 0.42) return null;
    // 2) downward profile from above the obstacle: top, far face, landing beyond
    const y0 = feet + 2.3, sample = (s) => this.down(W, P.x + hx * s, y0, P.z + hz * s, 60);
    const t0 = sample(d0 + 0.07);
    if (!t0 || t0.ny < 0.8) return null;
    const top = t0.y, hgt = top - feet;
    if (hgt < 0.1 || hgt > 1.95) return null;
    let far = null, lo = top, hi = top, after = null;
    for (let s = d0 + 0.19; s < d0 + 2.6; s += 0.12) {
      const q = sample(s);
      if (!q || q.y < top - 0.22) { after = { s, q }; break; }
      lo = Math.min(lo, q.y); hi = Math.max(hi, q.y);
      if (q.y > top + 0.3) return null;                        // rises again: a taller structure behind
    }
    if (after) {
      // exact far face: horizontal ray back toward the hero just under the top
      const bx = P.x + hx * (after.s + 0.05), bz = P.z + hz * (after.s + 0.05);
      const back = this.ray(W, bx, top - 0.06, bz, -hx, 0, -hz, after.s - d0 + 0.1, this._hit, false);
      far = back ? after.s + 0.05 - back.t : after.s - 0.06;
    }
    const depth = far === null ? Infinity : far - d0;
    if (hi - lo > 0.16 && hgt > 0.55) return null;            // irregular top: no planted hand
    // lane coverage: something wider than a post (a lone bollard is walked around)
    let lanes = 0;
    const yl = feet + Math.min(hgt - 0.08, 0.5);
    for (const s of [-0.26, 0.26]) if (this.ray(W, P.x + lx * s, yl, P.z + lz * s, hx, 0, hz, d0 + 0.5, this._hit, false)) lanes++;
    if (lanes === 0 && hgt > 0.3) return null;
    // 3) classify from height, depth, speed and approach angle
    let kind = null;
    if (depth > 1.6 || far === null) kind = hgt <= 0.6 ? (hgt > 0.22 ? 'stepup' : null) : hgt <= 1.95 ? 'mantle' : null;
    else if (hgt <= 0.55 && depth <= 0.75) kind = 'stepover';
    else if (hgt <= 0.6 && depth > 0.75) kind = hgt > 0.22 ? 'stepup' : null;
    else if (hgt <= 1.2 && depth <= 0.9) kind = hs >= h.stats.run + 1.2 ? 'speed' : hgt <= 1.02 ? 'vault1' : 'vault2';
    else if (hgt <= 1.45 && depth <= 1.6) kind = 'vault2';
    else if (hgt <= 1.95) kind = 'mantle';
    if (!kind) return null;
    if ((kind === 'vault1' || kind === 'speed' || kind === 'vault2') && facing < 0.55) return null;   // glancing: slide along it
    const K = this.KINDS[kind];
    const plan = { kind, hgt, depth, d0, top, far, col, hx, hz, lx, lz, nx, nz, feet, hs, facing, takeoff: K.takeoff, hands: { L: null, R: null } };
    // 4) exit: landing surface beyond the far face (vaults / step-over), or standing room on top (step-up / mantle)
    if (kind === 'stepup' || kind === 'mantle') {
      const s = d0 + (kind === 'mantle' ? 0.75 : 0.55), q = sample(s);
      if (!q || Math.abs(q.y - top) > 0.15) return null;
      plan.exit = new THREE.Vector3(P.x + hx * s, top + FEET + 0.01, P.z + hz * s); plan.air = false; plan.landY = top;
    } else {
      const s = far + (kind === 'stepover' ? 0.55 : kind === 'vault2' ? 0.75 : 0.85), q = this.down(W, P.x + hx * s, top + 0.5, P.z + hz * s, 80);
      if (q && q.y > top - 0.05) return null;                  // something as high as the obstacle right behind it: blocked
      let landY = q ? q.y : -Infinity;
      // a landing needs area, not a sliver of collision box beyond the face: a second sample further on
      const q2 = this.down(W, P.x + hx * (s + 0.65), top + 0.5, P.z + hz * (s + 0.65), 80);
      if (!q2 || Math.abs(q2.y - landY) > 0.35) landY = Math.min(landY, q2 ? q2.y : -Infinity);
      if (landY > feet - 0.9) {
        plan.air = false; plan.landY = landY;
        plan.exit = new THREE.Vector3(P.x + hx * s, landY + FEET + 0.01, P.z + hz * s);
      } else {
        // a drop behind (parapet at a roof edge, railing over a gap): only a deliberate run carries over it
        if (!h.sprinting || hs < h.stats.run * 0.9 || kind === 'vault2') return null;
        plan.air = true; plan.landY = landY;
        plan.exit = new THREE.Vector3(P.x + hx * s, top + (kind === 'stepover' ? 0.62 : 0.42), P.z + hz * s);
      }
    }
    // 5) hand contacts on the actual top surface (wrist targets are solved by the animator)
    if (K.hands) {
      const near = d0 + Math.min(0.13, (Number.isFinite(depth) ? depth : 1) * 0.5);   // thin rails: on the rail itself
      const try1 = (side) => {
        const sg = side === 'L' ? 1 : -1, off = (K.hands === 2 ? 0.24 : 0.2) * sg;
        const x = P.x + hx * near + lx * off, z = P.z + hz * near + lz * off;
        const q = this.down(W, x, top + 0.6, z, 1.2);
        if (!q || Math.abs(q.y - top) > 0.12 || q.ny < 0.8) return null;
        return new THREE.Vector3(x, q.y, z);
      };
      if (K.hands === 2) { plan.hands.L = try1('L'); plan.hands.R = try1('R'); if (!plan.hands.L || !plan.hands.R) return null; }
      else {
        // the nearer hand on an angled approach; alternate on a square one
        const lean = lx * nx + lz * nz;
        const first = Math.abs(lean) > 0.15 ? (lean < 0 ? 'L' : 'R') : (h._vaultHand === 'L' ? 'R' : 'L');
        let p = try1(first), side = first;
        if (!p) { side = first === 'L' ? 'R' : 'L'; p = try1(side); }
        if (!p) return null;
        plan.hands[side] = p; plan.hand = side;
      }
    }
    plan.lead = h._leadFoot || 'L';
    this.buildPath(h, plan);
    if (!this.validate(h, plan)) {
      if (plan.kind === 'vault1' || plan.kind === 'speed') { plan.apexBoost = 0.12; this.buildPath(h, plan); if (!this.validate(h, plan)) return null; }
      else return null;
    }
    return plan;
  },

  /* ---------------------------------------------------------------- roof-edge climb from a wall */
  planClimbOver(h, it) {
    const P = h.pos, W = h.world, n = h.wallN, FEET = TL.C.FEET;
    const ix = -n.x, iz = -n.z;                                 // into the wall / over the roof
    const face = this.ray(W, P.x, P.y, P.z, ix, 0, iz, 1.3, this._hit, false);
    const df = face ? face.t : TL.C.CAP_R + 0.03;
    const feet = P.y - FEET, y0 = P.y + 2.6;
    const at = (s) => this.down(W, P.x + ix * (df + s), y0, P.z + iz * (df + s), 8);
    // the lip is the highest surface just inside the face: a parapet / coping when there is one
    let lip = null;
    for (const s of [0.06, 0.16, 0.28, 0.42]) { const q = at(s); if (q && q.ny > 0.8 && (!lip || q.y > lip.y + 0.02)) lip = Object.assign({ s }, q); }
    if (!lip) { this.why = 'climb:1'; return null; }
    const lipCol = lip.col;
    const rel = lip.y - feet;
    if (rel < -0.6 || rel > 2.45) { this.why = 'climb:2'; return null; }                 // hands cannot reach it yet / already over
    // overhead room at the lip (an overhang turns this into a ceiling, not a climb)
    if (this.ray(W, P.x + ix * (df + 0.1), lip.y + 0.05, P.z + iz * (df + 0.1), 0, 1, 0, 1.0, this._hit, false)) { this.why = 'climb:3'; return null; }
    let stand = null, lipDepth = 0, prevY = lip.y;
    for (let s = lip.s + 0.12; s < 2.3; s += 0.14) {
      const q = at(s);
      if (!q) break;
      if (Math.abs(q.y - lip.y) < 0.06 && !stand) lipDepth = s;
      if (q.y > lip.y + 0.35) { this.why = 'climb:4'; return null; }                     // a taller bulkhead right behind the lip
      if (s >= 0.5 && q.ny > 0.85 && Math.abs(q.y - prevY) < 0.08 && q.y > lip.y - 0.7) { stand = { s, y: q.y }; break; }
      prevY = q.y;
    }
    const plan = { kind: 'climb', col: lipCol, d0: df, hx: ix, hz: iz, lx: iz, lz: -ix, nx: n.x, nz: n.z, feet, top: lip.y, hgt: rel, hs: h.vel.length(), hands: { L: null, R: null }, air: false };
    plan.fast = h.fsm.state === TL.TS.WALL && h.vel.y > 3.5;
    const wantMove = it.move && it.move.lengthSq() > 0.09 && (it.move.x * ix + it.move.z * iz) > 0.2;
    if (stand) {
      plan.exit = new THREE.Vector3(P.x + ix * (df + stand.s + 0.15), stand.y + FEET + 0.01, P.z + iz * (df + stand.s + 0.15));
      plan.landY = stand.y; plan.exitMove = wantMove || plan.fast;
    } else if (lipDepth >= 0.28) {
      // a wall top too narrow to stand on but wide enough for the feet: settle into a perch on it
      plan.exit = new THREE.Vector3(P.x + ix * (df + lipDepth * 0.5), lip.y + FEET + 0.01, P.z + iz * (df + lipDepth * 0.5));
      plan.landY = lip.y; plan.perch = true;
    } else { this.why = 'climb:5'; return null; }
    const tl = iz, tz = -ix;                                   // the climber's left along the wall
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const x = P.x + ix * (df + 0.1) + tl * 0.26 * sg, z = P.z + iz * (df + 0.1) + tz * 0.26 * sg, q = this.down(W, x, lip.y + 0.6, z, 1.2);
      plan.hands[side] = q && Math.abs(q.y - lip.y) < 0.15 ? new THREE.Vector3(x, q.y, z) : new THREE.Vector3(x, lip.y, z);
    }
    plan.lead = h._leadFoot || 'L';
    this.buildPath(h, plan);
    if (this.validate(h, plan)) return plan;
    this.why = 'climb:blocked ' + JSON.stringify(plan.blocked); return null;
  },

  /* ---------------------------------------------------------------- the move's path
     Vault family: constant travel speed along the heading (entry speed is kept, no velocity snap) and a
     height profile over distance that rises before the near face, holds the clearance the folded body
     needs over the top, and descends past the far face. Mantle / climb: staged — reach and stop at the
     face, rise beside it, roll the shoulders over the lip, take a knee, stand. */
  buildPath(h, plan) {
    const P = h.pos, V = h.vel, K = this.KINDS[plan.kind], top = plan.top;
    plan.S = P.clone();
    const toExit = plan.exit.clone().sub(P); plan.Xs = toExit.x * plan.hx + toExit.z * plan.hz;
    const boost = plan.apexBoost || 0, Xs = plan.Xs;
    let exitSpeed;
    if (plan.kind === 'mantle' || plan.kind === 'climb') {
      plan.stage = true;
      plan.s0 = plan.kind === 'climb' ? 0 : Math.max(0, plan.d0 - 0.42);
      plan.sKnee = Math.min(Xs - 0.05, plan.d0 + 0.45);
      plan.over = top + 0.15; plan.kneeY = Math.max(plan.over, plan.landY + 0.62);   // hips just over the lip, chest pitched over it
      plan.ua = plan.kind === 'climb' ? 0.0 : 0.18;
      exitSpeed = plan.exitMove ? (plan.fast ? 6.5 : 4.2) : 0;
      plan.dur = plan.kind === 'climb' ? (plan.fast ? K.dur[0] : K.dur[1]) : TL.clamp(0.62 + (plan.hgt - 1) * 0.25, K.dur[0], K.dur[1]);
      Object.assign(plan, { contact: plan.kind === 'climb' ? 0.05 : plan.ua, release: 0.72, land: 0.9 });
    } else {
      plan.stage = false;
      const r = plan.kind === 'stepover' ? 0.45 : plan.kind === 'stepup' ? 0.35 : plan.kind === 'vault2' ? 1.15 : 0.72;
      plan.sA0 = Math.max(0, plan.d0 - r); plan.sA1 = plan.d0 + (plan.kind === 'stepover' || plan.kind === 'stepup' ? 0.06 : plan.kind === 'vault2' ? -0.45 : -0.02);
      plan.apex = plan.kind === 'stepup' ? plan.exit.y
        : Math.max(plan.kind === 'stepover' ? P.y : 0, top + ({ stepover: 0.53, vault1: 0.12, speed: 0.13, vault2: 0.15 })[plan.kind] + boost);
      plan.sD0 = plan.kind === 'stepup' ? Xs : plan.far + 0.06; plan.sD1 = Xs;
      const minV = plan.kind === 'stepup' ? 2.6 : 3.4;
      plan.dur = TL.clamp(Xs / Math.max(plan.hs * 0.97, minV), K.dur[0] * 0.6, K.dur[1]);
      exitSpeed = Math.max(Math.min(plan.hs, Xs / plan.dur) * (plan.kind === 'vault2' ? 0.88 : plan.kind === 'speed' ? 0.99 : 0.96), 3);
      Object.assign(plan, {
        // the support window follows the hips past the planted hand (an arm reaches ~0.3 m fore and aft)
        contact: TL.clamp((plan.d0 - (({ vault2: 0.78, vault1: 0.3, speed: 0.32 })[plan.kind] || 0.18)) / Xs, 0.06, 0.6),
        release: TL.clamp((plan.kind === 'vault2' ? plan.d0 - 0.3 : (plan.far === null || !Number.isFinite(plan.far) ? plan.d0 + 0.3 : plan.far) + (plan.kind === 'speed' ? -0.14 : -0.1)) / Xs, 0.2, 0.85),
        land: TL.clamp((Xs - 0.18) / Xs, 0.75, 0.97),
      });
      plan.foldS0 = plan.sA0 + 0.08; plan.foldS1 = Xs - 0.14;
    }
    plan.exitSpeed = exitSpeed;
    plan.vOut = new THREE.Vector3(plan.hx * exitSpeed, plan.air ? -0.8 : 0, plan.hz * exitSpeed);
    plan.shape = K.shape;
    // bounding samples (validation broadphase)
    plan.keys = []; const q = new THREE.Vector3();
    for (let i = 0; i <= 8; i++) plan.keys.push([i / 8, this.pathAt(plan, i / 8, q).clone()]);
  },
  sAt(plan, u) {
    if (!plan.stage) return plan.Xs * u;
    const ua = plan.ua, b = 0.4, c = 0.72;
    if (u < ua) { const t = u / ua; return plan.s0 * (1 - (1 - t) * (1 - t)); }
    if (u < b) return plan.s0;
    if (u < c) return plan.s0 + (plan.sKnee - plan.s0) * TL.smooth(b, c, u);
    return plan.sKnee + (plan.Xs - plan.sKnee) * TL.smooth(c, 1, u);
  },
  pathAt(plan, u, out) {
    u = TL.clamp(u, 0, 1);
    const s = this.sAt(plan, u), S = plan.S;
    let y;
    if (plan.stage) {
      if (u < 0.72) y = S.y + (plan.over - S.y) * TL.smooth(0.03, 0.46, u) + (plan.kneeY - plan.over) * TL.smooth(0.46, 0.72, u);
      else y = plan.kneeY + (plan.exit.y - plan.kneeY) * TL.smooth(0.74, 1, u);
    } else if (s < plan.sD0) y = S.y + (plan.apex - S.y) * TL.smooth(plan.sA0, plan.sA1, s);
    else y = plan.apex + (plan.exit.y - plan.apex) * TL.smooth(plan.sD0, plan.sD1, s);
    return out.set(S.x + plan.hx * s, y, S.z + plan.hz * s);
  },
  shapeAt(plan, u) {
    // stage moves: knees drawn up beside the face, then only pelvis + chest pass over the lip; unfold once standing
    if (plan.stage) return u <= 0.05 || u >= 0.995 ? TL.BodyShapes.stand : u < 0.4 ? TL.BodyShapes.tuck : TL.BodyShapes.vault;
    const s = this.sAt(plan, u), fold = s > plan.foldS0 && s < plan.foldS1;
    if (plan.kind === 'stepover' || plan.kind === 'stepup') return fold ? TL.BodyShapes.step : TL.BodyShapes.stand;
    return fold ? TL.BodyShapes.vault : TL.BodyShapes.stand;
  },
  /* swept clearance of the whole move with the shape the body actually has at each point */
  validate(h, plan) {
    const W = h.world, p = this._v || (this._v = new THREE.Vector3());
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (const [, q] of plan.keys) { minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); minz = Math.min(minz, q.z); maxz = Math.max(maxz, q.z); }
    const cands = this.gather(W, minx - 1, minz - 1, maxx + 1, maxz + 1);
    const N = 18;
    for (let i = 1; i <= N; i++) {
      const u = i / N; this.pathAt(plan, u, p);
      const shape = this.shapeAt(plan, u);
      // the start overlaps nothing new; the first sample may graze the floor the hero stands on
      const hit = this.overlap(W, cands, p.x, p.y, p.z, shape, i < 3 || i === N ? 0.06 : 0.035);
      if (hit) { plan.blocked = { u, by: hit === 'ground' ? 'ground' : hit.kind }; return false; }
    }
    // final standing volume (head room) on a ground exit
    if (!plan.air && this.overlap(W, cands, plan.exit.x, plan.exit.y + 0.05, plan.exit.z, TL.BodyShapes.stand, 0.05)) { plan.blocked = { u: 1, by: 'exit' }; return false; }
    return true;
  },

  /* ---------------------------------------------------------------- execution */
  start(h, plan) {
    h.action = { plan, t: 0, u: 0, jump: false, swing: false, startPos: h.pos.clone() };
    h.contactPlan = null;
    if (plan.hand) h._vaultHand = plan.hand;
    h.shape = this.shapeAt(plan, 0.01);
    h.fsm.set(TL.TS.VAULT, plan.kind);
    h.emit('contact', plan.kind, plan);
  },
  actionStep(h, a, dt, it) {
    const A = h.action; a.set(0, 0, 0);
    if (!A) { h.fsm.set(TL.TS.AIR, 'contact-lost'); return; }
    const plan = A.plan;
    A.t += dt; A.u = TL.clamp(A.t / plan.dur, 0, 1);
    const p = this.pathAt(plan, A.u, this._p || (this._p = new THREE.Vector3()));
    h.vel.copy(p).sub(h.pos).multiplyScalar(1 / dt);           // integration lands exactly on the path
    h.shape = this.shapeAt(plan, A.u);
    if (!A.planted && A.u >= plan.contact) { A.planted = true; if (plan.kind !== 'stepover' && plan.kind !== 'stepup') h.emit('handplant', plan.kind, plan); }
    if (!A.released && A.u >= plan.release) { A.released = true; }
  },
  /* after collide(): finish, or abort if something unexpected (a vehicle, a moved prop) pushed the body */
  actionPost(h, it) {
    const A = h.action; if (!A) return;
    const plan = A.plan, S = TL.TS;
    if (h._contactPush > 0.06) { this.finish(h, 'contact-abort', true); return; }
    if (A.u >= 1) this.finish(h, 'contact-done');
  },
  finish(h, reason, aborted) {
    const A = h.action, plan = A.plan, S = TL.TS, V = h.vel;
    h.action = null; h.shape = TL.BodyShapes.stand;
    if (aborted) { V.multiplyScalar(0.4); h.fsm.set(S.AIR, reason); return; }
    V.copy(plan.vOut);
    if (plan.perch) { V.set(0, 0, 0); h.perchPoint.copy(h.pos); h.perchFacing = Math.atan2(plan.hx, plan.hz); TL.PerchSupport.enter(h,plan.col,h.pos,h.perchFacing);h.fsm.set(S.PERCH, 'climb-perch'); return; }
    if (A.jump) { V.y = h.stats.jump * 0.95; V.x *= 1.05; V.z *= 1.05; h.fsm.set(S.AIR, 'vault-jump'); h.emit('jump'); return; }
    if (plan.air) { h.fsm.set(S.AIR, 'vault-air'); return; }
    h.grounded = true; h.fsm.set(S.GROUND, reason);
    const drop = plan.feet - plan.landY;
    if (drop > 0.35) h.landing = { kind: drop > 1.2 ? 'crouch' : 'run', impact: Math.sqrt(2 * TL.C.G * drop), hs: plan.exitSpeed, t: 0, id: (h.landing ? h.landing.id : 0) + 1, from: 'vault' };
  },

  /* ---------------------------------------------------------------- airborne clearance tuck */
  airClearance(h) {
    const P = h.pos, V = h.vel, W = h.world, G = TL.C.G;
    const sp = V.length();
    if (sp < 3) return false;
    const T = TL.clamp(2.6 / sp, 0.12, 0.32), swing = h.fsm.state === TL.TS.SWING;
    const ex = Math.abs(V.x) * T + 1.2, ez = Math.abs(V.z) * T + 1.2;
    const cands = this.gather(W, P.x + V.x * T * 0.5 - ex, P.z + V.z * T * 0.5 - ez, P.x + V.x * T * 0.5 + ex, P.z + V.z * T * 0.5 + ez);
    let near = false;
    for (let i = 0; i < cands.length; i++) { const c = cands[i]; if (c.solid && c.cy + c.hy > P.y - 1.4 && c.cy - c.hy < P.y + 1.2) { near = true; break; } }
    if (!near) return false;
    let standHit = false;
    for (let i = 1; i <= 6; i++) {
      const t = T * i / 6;
      const x = P.x + V.x * t, y = P.y + V.y * t - (swing ? 0 : 0.5 * G * t * t), z = P.z + V.z * t;
      if (this.overlap(W, cands, x, y, z, TL.BodyShapes.tuck, 0.02)) return false;   // the opening is too small even tucked
      if (!standHit && this.overlap(W, cands, x, y, z, TL.BodyShapes.stand, 0.02)) standHit = true;
    }
    return standHit;
  },
  standFree(h) {
    const P = h.pos, cands = this.gather(h.world, P.x - 1, P.z - 1, P.x + 1, P.z + 1);
    return !this.overlap(h.world, cands, P.x, P.y, P.z, TL.BodyShapes.stand, 0.02);
  },

  /* ---------------------------------------------------------------- landing selection */
  /* impact: speed into the surface; hs: horizontal speed; returns {kind, ...} */
  classifyLanding(h, impact, it) {
    const P = h.pos, V = h.vel, W = h.world, col = h.groundCol;
    const hs = Math.hypot(V.x, V.z), moving = it && it.move && it.move.lengthSq() > 0.09;
    const L = { kind: 'gentle', impact, hs, t: 0, id: (h.landing ? h.landing.id : 0) + 1, surf: col ? (col.src === 'rooftop' ? 'roof' : col.kind) : 'ground', moving };
    // narrow support: a parapet top, a small cap — not the side of an antenna (that is a wall contact)
    if (col && !col.dynamic && Math.min(col.hx, col.hz) < 0.42 && col.hy < 6 && Math.max(col.hx, col.hz) >= 0.3) {
      const top = col.cy + col.hy;
      if (Math.abs(P.y - TL.C.FEET - top) < 0.12) { L.kind = 'narrow'; L.col = col; return L; }
    }
    if (impact > 32 || (impact > 22 && !moving && hs < 6)) L.kind = impact > 32 ? 'heavy' : 'crouch';
    else if (impact > 13) L.kind = 'crouch';
    else if (hs > 4.5 && moving) L.kind = 'run';
    else if (impact > 7.5) L.kind = 'crouch';
    // fast forward momentum with room ahead turns a hard / medium landing into a roll
    if ((L.kind === 'heavy' || L.kind === 'crouch') && hs > 9 && impact > 12 && impact < 55) {
      const d = this.rollRoom(h, Math.atan2(V.x, V.z), 3.4);
      if (d >= 3.4) { L.kind = 'roll'; L.dir = Math.atan2(V.x, V.z); }
    }
    return L;
  },
  /* free, supported distance ahead (walls at knee/chest height, ground support under each step) */
  rollRoom(h, yaw, maxD) {
    const P = h.pos, W = h.world, fx = Math.sin(yaw), fz = Math.cos(yaw), feet = P.y - TL.C.FEET;
    for (const y of [0.35, 0.8]) { const r = this.ray(W, P.x, feet + y, P.z, fx, 0, fz, maxD + 0.5, this._hit, false); if (r) maxD = Math.min(maxD, r.t - 0.55); }
    for (let s = 0.6; s <= maxD; s += 0.55) {
      const q = this.down(W, P.x + fx * s, feet + 0.6, P.z + fz * s, 1.0);
      if (!q || Math.abs(q.y - feet) > 0.25) return Math.max(0, s - 0.6);
    }
    return Math.max(0, maxD);
  },
};
