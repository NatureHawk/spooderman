/* =====================================================================================
   CONTACT ANIMATION — the body reacting to what it touches. Visual only: physics (04b_contact.js)
   owns position, velocity and the collision shape; these poses read the committed move, the landing
   record and the rope state and never move the body.
   Model space: +X = character left, +Y up, +Z forward. Joint angles: hip flexion a (forward +),
   knee bend k (shin rotates back from the thigh), so a straight leg is a = k = 0.

   TL.ContactAnim.vault()    step-over, one-hand vault, speed vault, two-hand vault, step-up, mantle,
                             roof-edge climb: anticipation -> contact -> weight transfer -> release ->
                             recovery, each phase from the move's normalized progress u
   TL.ContactAnim.approach() anticipation in the last strides before a committed move
   TL.ContactAnim.landing()  gentle / run / crouch (optional hand brace) / heavy / roll
   TL.ContactAnim.plant()    exact IK for planted hands / feet after smoothing (no sliding contacts)
   TL.CatchMotion            the moment a web becomes loaded: wrist grip -> shoulder load -> chest
                             follows -> pelvis lags -> legs join the pendulum; free arm balances.
                             Driven by attach / slack / tension / tension rise, never by a timer loop.
   References (frames studied, see tests/reference_*): rQVxkz7azJA 0:24.6–0:25.7 (catch: arm on line,
   legs trail then rise), 0:49.0–0:50.2 (low street swing, knees drive forward early), 4:13–4:18 (roof
   edge crouch, hand on lip, step off); S95XpzMkbDM 0:00.25 (one-hand plant on a parapet), 2.75–3.5
   (braced crouch landing into a run), ~10.5 (roll on a roof); gameplay reveal ZRhJT2nmvA4 2:00–2:02
   (rooftop landing with one hand braced, rise to stand), 2:34–2:36 (one hand over a roof ridge).
   ===================================================================================== */
'use strict';

TL.ContactAnim = {
  /* one leg / arm from angles (model space) */
  leg(put, D, side, a, k, spread, footPitch) {
    const s = side === 'L' ? 1 : -1, L = side;
    put('thigh' + L, D(s * 0.06 + spread, -Math.cos(a), Math.sin(a)));
    put('shin' + L, D(s * 0.025 + spread * 0.6, -Math.cos(a - k), Math.sin(a - k)));
    put('foot' + L, D(s * 0.03, -0.45 - (footPitch || 0), 1));
  },
  /* ---------------------------------------------------------------- committed contact moves */
  vault(an, hero, c) {
    const A = hero.action; if (!A) return null;
    const p = A.plan, u = A.u, sm = TL.smooth, put = c.put, D = c.D;
    const out = { pitch: 0, roll: 0, yawTwist: 0, lean: 0.15, twist: 0, hips: new THREE.Vector3(), plants: [], head: 0, clav: { L: 0, R: 0 } };
    const C = p.contact, R = p.release, Ld = p.land;
    const reach = sm(Math.max(0, C - 0.22), C, u);                     // hand travelling to the support
    const sup = sm(C - 0.04, C + 0.04, u) * (1 - sm(R - 0.03, R + 0.08, u));   // weight on the hand(s)
    // legs fold by distance to the near face: folded feet lead the hips by ~0.45 m, so the fold completes before
    // they get there (stage moves and step-overs have their own timing below)
    const sPath = p.stage ? 0 : p.Xs * u;
    const fold = p.stage ? 0 : sm(p.d0 - (p.kind === 'vault2' ? 0.95 : 1.0), p.d0 - (p.kind === 'vault2' ? 0.45 : 0.5), sPath);
    const ext = (p.stage || !Number.isFinite(p.far) ? sm(R, Ld, u) : sm(p.far - 0.05, p.Xs - 0.1, p.Xs * u)) * (1 - sm(Ld, 1, u) * 0.6);
    const rec = sm(Ld, 1, u);
    const run = (a, k) => ({ a, k });
    const legs = { L: run(0, 0.1), R: run(0, 0.1) };
    const kind = p.kind;
    // explicit limb directions for the folded / swept silhouettes (blended with the stride before and after)
    const dirLeg = {};                                                   // side -> {th, sh} model directions
    const blendLeg = (L, th, sh, w) => { const c = dirLeg[L]; c.th.lerp(th, w).normalize(); c.sh.lerp(sh, w).normalize(); };
    const angLeg = (L, a, k, spread) => { const s = L === 'L' ? 1 : -1; dirLeg[L] = { th: D(s * 0.06 + (spread || 0), -Math.cos(a), Math.sin(a)), sh: D(s * 0.025 + (spread || 0) * 0.6, -Math.cos(a - k), Math.sin(a - k)) }; };
    if (kind === 'vault1' || kind === 'speed') {
      const sh = p.hand || 'L', sg = sh === 'L' ? 1 : -1, fs = -sg, speed = kind === 'speed';
      const push = sh === 'L' ? 'R' : 'L', lead = sh;                  // takeoff: the far leg drives
      for (const L of ['L', 'R']) {
        // last stride: push leg extended behind, the other knee driving
        L === push ? angLeg(L, -0.35, 0.35) : angLeg(L, 0.95, 1.25);
        // weight on the hand: legs fold / swing across to the free side at hip height (lazy vault) or long
        // and together (speed vault: body side-on over the support, feet leading)
        const hi = L === push ? 0.06 : 0;
        const th = speed ? D(fs * 0.85, 0.22 + hi, 0.45) : D(fs * 0.7, 0.3 + hi, 0.6);
        const shn = speed ? D(fs * 0.88, 0.12 + hi, 0.42) : D(fs * 0.55, -0.22 + hi, 0.5);
        blendLeg(L, th, shn, fold);
        // release -> landing: the lead foot reaches for the ground in front, the other follows through
        L === lead ? blendLeg(L, D(fs * 0.12, -0.82, 0.56), D(fs * 0.04, -0.98, 0.18), ext) : blendLeg(L, D(fs * 0.08, -0.95, -0.12), D(0, -0.85, -0.52), ext);
      }
      out.roll = sg * (speed ? 0.85 : 0.72) * sup;                      // torso leans far over the support arm (shoulder above the hand)
      out.pitch = 0.1 + (speed ? 0.12 : 0.24) * sup - 0.06 * ext;
      out.yawTwist = sg * (speed ? 0.42 : 0.2) * sup;
      out.lean = 0.2 + 0.3 * sup + 0.1 * reach * (1 - sup);
      out.twist = sg * 0.22 * sup;
      out.hips.set(fs * 0.06 * fold, 0, 0);
      if (p.hands[sh]) out.plants.push({ side: sh, p: p.hands[sh], w: Math.max(reach * 0.9, sup), exact: sup > 0.5 });
      out.clav[sh] = 0.15 * sup;
      // free arm out to the free side and up for balance, then forward for the landing
      const F = fs > 0 ? 'L' : 'R';
      put('uarm' + F, D(fs * 0.9, 0.2 + 0.25 * sup - 0.5 * ext, 0.15 + 0.35 * ext));
      put('farm' + F, D(fs * 0.75, 0.3 * sup - 0.3 * ext, 0.45 + 0.3 * ext));
    } else if (kind === 'vault2') {
      for (const L of ['L', 'R']) {
        const s = L === 'L' ? 1 : -1;
        L === p.lead ? angLeg(L, 0.7, 1.0) : angLeg(L, -0.25, 0.4);
        blendLeg(L, D(s * 0.1, 0.92, 0.38), D(s * 0.05, -0.35, -0.94), fold);          // knees to the chest between the arms, heels under
        L === p.lead ? blendLeg(L, D(s * 0.1, -0.86, 0.5), D(s * 0.04, -0.98, 0.15), ext) : blendLeg(L, D(s * 0.1, -0.95, 0.25), D(s * 0.03, -0.9, -0.4), ext);
      }
      out.pitch = 0.18 + 0.45 * sup + 0.05 * fold - 0.1 * ext;          // shoulders load forward over the hands
      out.lean = 0.25 + 0.3 * sup;
      out.hips.set(0, -0.03 * sup, 0);
      for (const s of ['L', 'R']) { if (p.hands[s]) out.plants.push({ side: s, p: p.hands[s], w: Math.max(reach * 0.9, sup), exact: sup > 0.5 }); out.clav[s] = 0.28 * sup; }
      for (const s of ['L', 'R']) if (ext > 0.05) { const sg = s === 'L' ? 1 : -1; put('uarm' + s, D(sg * 0.55, -0.35 + 0.2 * ext, 0.5)); put('farm' + s, D(sg * 0.35, -0.2, 0.9)); }
    } else if (kind === 'stepover' || kind === 'stepup') {
      const lead = p.lead || 'L', trail = lead === 'L' ? 'R' : 'L';
      const liftL = Math.sin(Math.PI * sm(0.04, 0.62, u)), liftT = Math.sin(Math.PI * sm(0.42, 0.98, u));
      const up = kind === 'stepup';
      legs[lead] = { a: TL.lerp(-0.1, up ? 1.25 : 1.35, liftL), k: TL.lerp(0.15, up ? 1.35 : 1.75, liftL), spread: 0 };
      legs[trail] = { a: TL.lerp(0.15, up ? 0.9 : 0.8, liftT) - 0.35 * (1 - sm(0, 0.4, u)), k: TL.lerp(0.25, up ? 1.5 : 2.05, liftT), spread: 0 };
      out.pitch = 0.1; out.lean = 0.18 + 0.1 * liftL;
      // arms swing opposite the stepping legs
      for (const s of ['L', 'R']) { const sg = s === 'L' ? 1 : -1, f = (s === lead ? -1 : 1) * 0.55 * (1 - liftT * 0.6); put('uarm' + s, D(sg * 0.22, -Math.cos(f), Math.sin(f))); put('farm' + s, D(sg * 0.12, -Math.cos(f + 0.9), Math.sin(f + 0.9))); }
    } else {
      // mantle / roof-edge climb: hands find the lip, shoulders rise over it, a knee takes support, stand
      const lead = p.lead || 'L', trail = lead === 'L' ? 'R' : 'L';
      const rise = sm(C, 0.42, u), over = sm(0.4, 0.7, u), stand = sm(0.72, 1, u);
      const scr = Math.sin(u * 22) * 0.18 * (1 - over);                 // feet scrabble against the face
      legs[lead] = { a: TL.lerp(TL.lerp(0.6 + scr, 1.95, over), 0.05, stand), k: TL.lerp(TL.lerp(1.3, 2.35, over), 0.08, stand), spread: 0.04 };
      legs[trail] = { a: TL.lerp(TL.lerp(0.35 - scr, -0.15, over), 0.0, stand), k: TL.lerp(TL.lerp(1.1, 0.45, over), 0.08, stand), spread: -0.04 };
      const push = sm(0.24, 0.44, u);                                   // shoulders roll over the lip, arms push down
      out.pitch = (0.05 + 0.85 * push) * (1 - stand) + 0.06 * stand;
      out.lean = TL.lerp(0.1 + 0.15 * rise, 0.7, push) * (1 - stand) + 0.12 * stand;
      const hold = sm(Math.max(0, C - 0.12), C, u) * (1 - sm(0.55, 0.66, u));
      for (const s of ['L', 'R']) { if (p.hands[s]) out.plants.push({ side: s, p: p.hands[s], w: hold, exact: hold > 0.5 && u > C }); out.clav[s] = 0.3 * hold * (1 - over * 0.5); }
      out.head = 0.2 * over * (1 - stand);
    }
    for (const L of ['L', 'R']) {
      if (dirLeg[L]) { const sg = L === 'L' ? 1 : -1; put('thigh' + L, dirLeg[L].th); put('shin' + L, dirLeg[L].sh); put('foot' + L, D(sg * 0.03, -0.45 - 0.3 * fold, 1)); }
      else this.leg(put, D, L, legs[L].a, legs[L].k, legs[L].spread || 0, 0.2 * fold);
    }
    // recovery: give the locomotion pose back smoothly
    out.recover = rec;
    return out;
  },
  /* last strides before a committed move: eyes and reaching hand lead, the body lowers slightly */
  approach(an, hero, c) {
    const p = hero.contactPlan; if (!p) return null;
    const P = hero.pos, d = p.d0 - ((P.x - p.S.x) * p.hx + (P.z - p.S.z) * p.hz);
    const w = TL.smooth(p.takeoff + 1.3, p.takeoff + 0.1, d);
    if (w <= 0.01) return null;
    const out = { w, plants: [], lower: 0.05 * w * (p.kind === 'stepover' ? 0.4 : 1) };
    if (p.kind === 'vault1' || p.kind === 'speed') { const s = p.hand; if (p.hands[s]) out.plants.push({ side: s, p: p.hands[s], w: 0.45 * w * w, exact: false }); }
    else if (p.kind === 'vault2' || p.kind === 'mantle') for (const s of ['L', 'R']) if (p.hands[s]) out.plants.push({ side: s, p: p.hands[s], w: 0.35 * w * w, exact: false });
    return out;
  },

  /* ---------------------------------------------------------------- landings */
  /* L: hero.landing; t: seconds since contact. Returns hip drop, lean, foot plants and an optional hand brace. */
  landing(an, hero, c, L, t) {
    const k = L.kind, imp = L.impact || 0, moving = hero.vel.x * hero.vel.x + hero.vel.z * hero.vel.z > 4;
    const prof = (A, tau, len) => (t < len ? A * (t / tau) * Math.exp(1 - t / tau) : 0);
    const out = { drop: 0, lean: 0, plants: [], feet: false, stagger: 0, arms: 0 };
    switch (k) {
      case 'gentle': out.drop = prof(0.06 + imp * 0.004, 0.07, 0.6); out.lean = out.drop * 1.2; out.toe = TL.smooth(0.06, 0, t); out.feet = true; break;
      case 'run': out.drop = prof(0.05 + imp * 0.004, 0.06, 0.5); out.lean = 0.1 + out.drop * 1.5; break;
      case 'crouch': {
        const A = TL.clamp(0.1 + imp * 0.013, 0.16, 0.42), tau = moving ? 0.075 : 0.1;
        out.drop = prof(A, tau, moving ? 0.6 : 0.95); out.lean = out.drop * 1.6; out.feet = true; out.arms = out.drop / A;
        if (imp > 15) {
          const bw = TL.smooth(0.02, 0.07, t) * (1 - TL.smooth(0.24, moving ? 0.34 : 0.44, t));
          if (bw > 0.01) out.brace = { side: L.id % 2 ? 'L' : 'R', w: bw };
        }
        break;
      }
      case 'heavy': {
        const A = 0.52, tau = 0.12;
        out.drop = prof(A, tau, 1.1); out.lean = 0.25 + out.drop * 1.6; out.feet = true; out.arms = out.drop / A;
        const bw = TL.smooth(0.03, 0.09, t) * (1 - TL.smooth(0.34, 0.52, t));
        out.brace = { side: L.id % 2 ? 'L' : 'R', w: bw };
        break;
      }
    }
    return out;
  },
  /* roll: a curled body that really rolls over the shoulder, ball radius ~ hip height while curled */
  roll(an, hero, c, t, dur) {
    const u = TL.clamp(t / dur, 0, 1), sm = TL.smooth, put = c.put, D = c.D;
    const curl = sm(0.0, 0.16, u) * (1 - sm(0.72, 0.95, u));
    const ang = Math.PI * 2 * sm(0.1, 0.86, u);                       // one full revolution, eased in/out
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      const a = TL.lerp(0.3, 2.25, curl), kk = TL.lerp(0.4, 2.55, curl);
      put('thigh' + L, D(s * 0.12, -Math.cos(a), Math.sin(a))); put('shin' + L, D(s * 0.05, -Math.cos(a - kk), Math.sin(a - kk))); put('foot' + L, D(0, -0.9, 0.3));
      // lead arm reaches to the ground first then tucks, the other wraps the knees
      const lead = s > 0;
      put('uarm' + L, lead ? D(s * 0.25, -0.75, 0.75 - 0.4 * curl) : D(s * 0.2, -0.5, 0.85));
      put('farm' + L, lead ? D(-s * 0.15, -0.4 + 0.6 * curl, 0.9) : D(-s * 0.35, 0.3, 0.9));
    }
    return { curl, ang, lean: TL.lerp(0.2, 1.25, curl), head: curl, drop: 0.55 * curl, axis: new THREE.Vector3(1, 0, 0.4).normalize() };
  },

  /* feet / knees caught inside the obstacle volume are lifted onto a path above it (leg IK, after smoothing) */
  clearLimbs(an, plan, meshPos, rootQ, u) {
    const c = plan && plan.col; if (!c || (plan.stage && !(u > 0.42))) return 0;   // a climber's legs hang outside the face until the hips are over
    const rig = an.rig, top = c.cy + c.hy, w = new THREE.Vector3(), lift = [];
    for (const s of ['L', 'R']) {
      let need = 0;
      for (const b of ['foot' + s, 'shin' + s]) {
        w.copy(rig.P[b]).applyQuaternion(rootQ).add(meshPos);
        const L = c.toLocal(w.x, w.y, w.z, {});
        const m = plan.stage ? -0.02 : 0.06;
        if (Math.abs(L.x) < c.hx + m && Math.abs(L.z) < c.hz + m && w.y < top + 0.07) need = Math.max(need, top + 0.08 - w.y);
      }
      if (need > 0) { w.copy(rig.P['foot' + s]).applyQuaternion(rootQ).add(meshPos); w.y += need + 0.02 - an.ankleH; lift.push({ side: s, p: w.clone(), w: 1, exact: true, leg: true, pole: TL.dirv(s === 'L' ? 0.2 : -0.2, 0.6, 1) }); }
    }
    if (lift.length) this.plant(an, lift, meshPos, rootQ);
    return lift.length;
  },
  /* ---------------------------------------------------------------- exact contacts after smoothing */
  /* plants: [{side, p (world), w, exact, leg?, pole?}] — solved on the current FK, then applied without smoothing */
  plant(an, plants, meshPos, rootQ) {
    if (!plants || !plants.length) return;
    const rig = an.rig, inv = rootQ.clone().invert();
    // an exact (weight-bearing) palm a few cm out of reach pulls the body toward it rather than sliding
    let shift = null;
    for (const q of plants) if (q.exact && !q.leg && q.w > 0.5) {
      const sh = rig.P['uarm' + q.side].clone().applyQuaternion(rootQ).add(meshPos), tgt = q.p.clone(); tgt.y += 0.05;
      const ex = sh.distanceTo(tgt) - (rig.upperArm + rig.foreArm) * 0.995;
      if (ex > 0) { const d = tgt.sub(sh).setLength(Math.min(ex, 0.08)); if (!shift || d.lengthSq() > shift.lengthSq()) shift = d; }
    }
    if (shift) { meshPos.add(shift); rig.mesh.position.copy(meshPos); }
    for (const n of rig.order) rig.target[n].copy(rig.cur[n]);
    rig.hipsOffT.copy(rig.hipsOff); rig.hipsQT.copy(rig.hipsQ);
    for (const q of plants) {
      if (q.w <= 0.001) continue;
      const leg = !!q.leg, s = q.side, sg = s === 'L' ? 1 : -1;
      const up = leg ? 'thigh' + s : 'uarm' + s, lo = leg ? 'shin' + s : 'farm' + s, end = leg ? 'foot' + s : 'hand' + s;
      const L1 = leg ? rig.thigh : rig.upperArm, L2 = leg ? rig.shin : rig.foreArm;
      // wrist sits just above the palm on the surface; ankle above the sole
      const wp = q.p.clone(); wp.y += leg ? an.ankleH : 0.05;
      const tgt = wp.sub(meshPos).applyQuaternion(inv);
      const root = rig.P[up], d1 = new THREE.Vector3(), d2 = new THREE.Vector3();
      const dist = tgt.distanceTo(root), maxR = (L1 + L2) * 0.995;
      if (!q.exact && dist > maxR) tgt.sub(root).setLength(maxR).add(root);
      const pole = q.pole || (leg ? TL.dirv(sg * 0.2, 0.1, 1) : TL.dirv(sg * 0.8, -0.3, -0.5));
      rig.ik2(root, tgt, L1, L2, pole, d1, d2);
      const w = TL.clamp(q.w, 0, 1);
      rig.set(up, rig.cur[up].clone().lerp(d1, w).normalize()); rig.set(lo, rig.cur[lo].clone().lerp(d2, w).normalize());
      if (leg) rig.set(end, rig.cur[end].clone().lerp(TL.dirv(sg * 0.05, -0.3, 1), w).normalize());
      else rig.set(end, rig.cur[end].clone().lerp(TL.dirv(sg * 0.15, -0.9, 0.35), w).normalize());
    }
    rig.apply(0);
  },
};

/* ------------------------------------------------------------------ web catch load response */
TL.CatchMotion = {
  G: 16,
  begin(an, hero) {
    const r = hero.tether.main, rig = an.rig, log = hero.fsm.log, last = log.length > 1 ? log[log.length - 2] : null;
    const snap = {}; for (const n of ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR']) snap[n] = rig.cur[n].clone();
    const V = hero.vel, sp = V.length();
    an.catchS = {
      hand: r.hand, t: 0, load: 0, absorb: 0, absorbV: 0, budget: 1, chest: 0, pelvis: 0, prevTn: 0,   // the line carried nothing before it bit
      legs: snap, fast: V.y < -14 || sp > 28, transfer: !!(last && last.reason === 'hand-transfer'),
      cross: false, wide: false, strongSent: false, peak: 0,
    };
  },
  update(an, hero, dt, anchorLocal) {
    const C = an.catchS, r = hero.tether.main; if (!C) return null;
    C.t += dt;
    const Tn = r.tension / this.G, slack = r.stretch < -0.03 && r.tension <= 0;
    const tgt = slack ? 0 : TL.clamp((Tn - 0.35) / 2.2, 0, 1);
    C.load = TL.damp(C.load, tgt, tgt > C.load ? 16 : 5, dt);
    // the elbow / shoulder give: a damped spring kicked by each jump in tension (impulse), with a finite budget
    // per catch so a rope that keeps loading and unloading never replays the catch
    const w0 = 15, z = 0.85;
    const jump = Math.max(0, Tn - C.prevTn); C.prevTn = Tn;
    if (C.t < 0.7 && C.budget > 0 && !slack && jump > 0.4) {
      const imp = Math.min(jump * 0.075, C.budget); C.budget -= imp; C.absorbV += imp * w0;
    }
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const acc = -w0 * w0 * C.absorb - 2 * z * w0 * C.absorbV;
      C.absorbV += acc * h; C.absorb = TL.clamp(C.absorb + C.absorbV * h, 0, 0.75);
      if (C.absorb === 0 && C.absorbV < 0) C.absorbV = 0;
    }
    C.peak = Math.max(C.peak, C.absorb);
    C.chest = TL.damp(C.chest, C.load, 14, dt);
    C.pelvis = TL.damp(C.pelvis, C.chest, 6.5, dt);
    if (anchorLocal) {
      const sg = C.hand === 'L' ? 1 : -1, lat = anchorLocal.x / Math.max(anchorLocal.length(), 1e-3);
      C.cross = lat * sg < -0.18; C.wide = Math.abs(lat) > 0.5;
    }
    if (!C.strongSent && C.absorb > 0.3) { C.strongSent = true; TL.bus.emit('hero:catchload', hero, C.absorb, C.hand); }
    return C;
  },
  legBlend(C) { return TL.smooth(0, 0.16, C.t); },
};
