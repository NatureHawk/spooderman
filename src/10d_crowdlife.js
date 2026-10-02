/* =====================================================================================
   CROWD LIFE — believable pedestrians for the scan map (replaces the block-loop routine of 10_crowd.js when a
   TL.CrowdNav exists; the loop behaviour stays for the generated grid maps).
   * Walkers follow routes on the sidewalk roadmap with real velocity (accelerate, round corners, keep right, pass each
     other, stop for the hero) — no teleports, no sliding: the stride cadence follows the true ground speed.
   * Density follows district x time of day x weather; classes (suit, tourist, local, jogger) shape pace, clothes, stops.
   * Groups of 2-4 walk, wait, queue and sit together (leader + formation slots).
   * Crossings obey the traffic signal of their junction (walk window, enough time to finish, impatient jaywalkers wait for
     a gap), queue along the kerb and hurry when the hand starts flashing.
   * Seats: benches / stoops / lawn; hot-dog carts with a vendor and a queue that shuffles forward; photo stops; phone stops.
   * Hero: look up / point / film when he swings by, gather in a ring around a landing, scatter (and film from afar) from fights.
   * Rain: fewer people, brisk pace, umbrellas, seats emptied, shelter in doorways.
   ===================================================================================== */
'use strict';

TL.CROWD_STYLES = {
  suit:    { spd: [1.45, 1.95], shirts: [0x1d2330, 0x2b3445, 0xd8dde6, 0xe8e4dc, 0x3a3f4a, 0x5b6475, 0x7a8fa8], pants: [0x16181d, 0x23262e, 0x30343c, 0x3a3a40], hat: 0.03, bag: 0.6, phoneWalk: 0.32, group: [0.8, 0.17, 0.03, 0] },
  tourist: { spd: [0.85, 1.2],  shirts: [0xd84a3a, 0x3d8ed0, 0xe8c040, 0x58b868, 0xf0f0f0, 0xe07040, 0xa05ac8, 0x40c0c0, 0xf0a0b0], pants: [0x4a6a9a, 0x8a7a5a, 0xc8b890, 0x3a4a6a, 0x6a6a6a, 0xd8d0c0], hat: 0.38, bag: 0.55, phoneWalk: 0.12, group: [0.4, 0.38, 0.14, 0.08] },
  local:   { spd: [1.15, 1.5],  shirts: [0x3d6a8e, 0x8e3d3d, 0xd8d4c8, 0x2a2a2e, 0x6a8e3d, 0xc8a040, 0x7a4a8a, 0x40a0a0, 0xe07040, 0x5a5a60, 0xb8c8d8], pants: [0x2b2d33, 0x3a4a6a, 0x5a4a3a, 0x202020, 0x6a6a6a, 0x8a7a5a], hat: 0.18, bag: 0.35, phoneWalk: 0.28, group: [0.7, 0.26, 0.04, 0] },
  jogger:  { spd: [2.6, 3.4],   shirts: [0xe05030, 0x2a8ad0, 0x60c050, 0xf0d030, 0x202020, 0xc03080, 0xf0f0f0], pants: [0x1a1a22, 0x2a2a38, 0x303a50, 0x502020], hat: 0.22, bag: 0, phoneWalk: 0, group: [0.8, 0.18, 0.02, 0], jog: true },
};
TL.CROWD_SKIN = [0xf0c8a8, 0xd8a888, 0xb9876a, 0x8a5a40, 0x5e3a26, 0x3e2618];

(function () {
  const bump = (h, c, w) => { let d = Math.abs(h - c); if (d > 12) d = 24 - d; return Math.exp(-(d * d) / (2 * w * w)); };
  /* people on the street per class at hour h (0..1) */
  TL.CROWD_ACTIVITY = {
    suit: (h) => 0.06 + 1.0 * bump(h, 8.3, 1.0) + 0.85 * bump(h, 12.6, 1.1) + 1.0 * bump(h, 17.5, 1.3) + 0.3 * bump(h, 19.8, 1.4),
    tourist: (h) => 0.04 + 1.0 * bump(h, 13.8, 3.0) + 0.45 * bump(h, 19.2, 1.8),
    local: (h) => 0.12 + 0.7 * bump(h, 8.0, 1.4) + 0.6 * bump(h, 12.5, 1.4) + 0.85 * bump(h, 18.3, 2.3) + 0.5 * bump(h, 21.2, 1.8),
    jogger: (h) => 0.02 + 1.0 * bump(h, 6.6, 1.0) + 0.85 * bump(h, 18.2, 1.2) + 0.3 * bump(h, 12.6, 0.9),
  };
})();

TL.CrowdLife = class {
  constructor(crowd, nav) {
    this.crowd = crowd; this.game = crowd.game; this.nav = nav; this.rng = crowd.rng;
    this.t = 0; this.cell = 2.5; this.hash = new Map();
    this.dis = nav.districtAt(0, 0);
    this.hour = 14; this.rain = 0;
    this.carts = nav.carts.map((c, i) => Object.assign({ i, queue: [], vendor: null, qd: 1 }, c));
    this.gather = null; this.cool = 0; this.vendorT = 0; this.flyT = 0;
    this.stats = { walking: 0, crossing: 0, waiting: 0, sitting: 0, queueing: 0, groups: 0, gathered: 0 };
    this._tmp = []; this._n = []; this._panic = []; this.panicNear = []; this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this.serial = 0; this.trimT = 0;
  }

  /* ---------------------------------------------------------------- director */
  weights(x, z, hour) {
    const d = this.nav.districtAt(x, z, this.dis), A = TL.CROWD_ACTIVITY, w = this._w || (this._w = {});
    w.tourist = d.mix.tourist * A.tourist(hour); w.suit = d.mix.suit * A.suit(hour); w.local = d.mix.local * A.local(hour); w.jogger = d.mix.jogger * A.jogger(hour);
    return w;
  }
  /* how many pedestrians the street around `focus` should carry now */
  target(focus) {
    const hour = this.hour, w = this.weights(focus.x, focus.z, hour);
    const act = w.tourist + w.suit + w.local + w.jogger;
    const dens = Math.max(0.25, this.nav.densityAt(focus.x, focus.z) * 1.6);
    let f = TL.clamp((0.15 + act * 1.05) * this.dis.crowd * (0.55 + dens * 0.5), 0.1, 1);
    if (this.rain > 0.4) f *= 0.55; else if (this.rain > 0.1) f *= 0.8;
    return Math.round(this.crowd.max * f);
  }
  pickStyle(x, z) {
    const w = this.weights(x, z, this.hour), rng = this.rng;
    let s = w.tourist + w.suit + w.local + w.jogger; if (s <= 0) return 'local';
    let r = rng.next() * s;
    for (const k of ['tourist', 'suit', 'local', 'jogger']) { r -= w[k]; if (r <= 0) return k; }
    return 'local';
  }

  /* ---------------------------------------------------------------- spawning */
  spawn(focus) {
    const C = this.crowd, rng = this.rng, nav = this.nav, cam = this.game.camera.position;
    const want = this.target(focus);
    this.wantNow = want;
    if (C.peds.length >= Math.min(C.max, want)) return;
    for (let k = 0; k < 6 && C.peds.length < Math.min(C.max, want); k++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(55, 185);
      const x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
      const n = nav.nearest(x, z, 10); if (n < 0) continue;
      const nx = nav.x(n), nz = nav.z(n);
      if (nav.densityAt(nx, nz) < rng.next() * 0.9) continue;
      if (Math.hypot(nx - cam.x, nz - cam.z) < 50) continue;                       // never pop in front of the player
      const style = this.pickStyle(nx, nz);
      let gs = 1;
      if (style !== 'jogger' || rng.chance(0.1)) { const G = TL.CROWD_STYLES[style].group; let r = rng.next(), s = 0; for (let i = 0; i < 4; i++) { s += G[i]; if (r <= s) { gs = i + 1; break; } } }
      gs = Math.min(gs, Math.max(1, Math.min(C.max, want) - C.peds.length));
      let G = null;
      for (let m = 0; m < gs; m++) {
        const p = C.pool.get(); this.init(p, n, style, m === 0 ? null : G.members[0], m);
        if (gs > 1 && m === 0) G = p.L.group = { members: [p], style, size: gs, act: 'walk' };
        else if (gs > 1) { p.L.group = G; G.members.push(p); }
        // spread members around the node so they do not stack
        p.pos.x += (m ? rng.range(-0.8, 0.8) : 0); p.pos.z += (m ? rng.range(-0.8, 0.8) : 0);
        C.peds.push(p);
      }
    }
  }
  init(p, node, style, leader, slot) {
    const nav = this.nav, rng = this.rng, S = TL.CROWD_STYLES[style];
    p.i = ++this.serial; p.j = 0; p.t = 0; p.dir = 1; p.cross = null; p.notice = null; p.lookAt = null; p.react = 0; p.fear = 0; p.fleeFrom = null;
    p.variant = style === 'jogger' ? rng.pick(['m', 'f', 'h']) : rng.pick(['m', 'm', 'f', 'f', 'h']);
    p.colors = { shirt: rng.pick(S.shirts), pants: rng.pick(S.pants), skin: rng.pick(TL.CROWD_SKIN) };
    p.hat = rng.chance(S.hat); p.bag = rng.chance(S.bag); p.jog = !!S.jog;
    p.pos.set(nav.x(node), 0, nav.z(node)); p.mode = 'walk'; p.modeT = 0; p.anim = 'walk'; p.sink = 0;
    p.pos.y = this.ground(p.pos.x, p.pos.z);
    const L = p.L || (p.L = {});
    const pref = leader ? leader.L.pref * rng.range(0.96, 1.04) : rng.range(S.spd[0], S.spd[1]);
    Object.assign(L, {
      style, node, prev: -1, route: null, ri: 0, hx: 0, hz: 1, vx: 0, vz: 0, spd: 0, pref, act: 'walk', actT: 0, until: 0, group: null, slot: slot || 0,
      lane: rng.range(0.35, 0.95), phoneWalk: rng.chance(S.phoneWalk), jay: rng.chance(0.07), patience: rng.range(18, 40), seat: null, cart: null, qi: -1,
      cw: null, side: 0, waitSlot: 0, tx: 0, tz: 0, ftx: 0, ftz: 0, curious: rng.range(0, 1), reactCool: 0, allow: 1, segA: -1, segB: -1, food: 0, eatT: 0, restT: rng.range(8, 35),
      hold: 0, speedMul: 1, spawnT: this.t, stuckT: 0, lastX: p.pos.x, lastZ: p.pos.z, ring: null, shelter: false, vendor: false,
    });
    p.speed = 0; p.alive = true;
    // initial heading: along a random edge
    const o = nav.adjStart[node], c = nav.adjStart[node + 1] - o;
    if (c > 0) { const m = nav.adjNode[o + Math.floor(rng.next() * c)]; const dx = nav.x(m) - nav.x(node), dz = nav.z(m) - nav.z(node), l = Math.hypot(dx, dz) || 1; L.hx = dx / l; L.hz = dz / l; }
    p.yaw = Math.atan2(L.hx, L.hz);
    if (!leader) { L.pref = pref; L.speedMul = 1; }
    return p;
  }
  ground(x, z) { const l = this.game.layout; return l && l.ground ? Math.max(0, l.ground(x, z)) : 0; }

  /* ---------------------------------------------------------------- neighbour hash */
  rebuild() {
    const H = this.hash; for (const l of H.values()) l.length = 0;
    const c = this.cell;
    for (const p of this.crowd.peds) {
      const k = Math.floor(p.pos.x / c) * 4096 + Math.floor(p.pos.z / c);
      let l = H.get(k); if (!l) H.set(k, l = []); l.push(p);
    }
  }
  near(x, z, r, out) {
    out.length = 0; const c = this.cell, n = Math.ceil(r / c), cx = Math.floor(x / c), cz = Math.floor(z / c);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const l = this.hash.get((cx + i) * 4096 + cz + j); if (l) for (const q of l) out.push(q); }
    return out;
  }

  /* ---------------------------------------------------------------- signals */
  signal(cw) {
    const tr = this.game.traffic; if (!cw.sig || !tr) return null;
    return TL.signalState(cw.sig[0], cw.sig[1], tr.t);
  }
  /* may a walker leave the kerb now? */
  canCross(p, cw, waited) {
    const tr = this.game.traffic, L = p.L;
    const tt = tr ? tr.t : 0;
    const gap = this.vehicleNear(cw);
    const sig = cw.sig ? TL.signalState(cw.sig[0], cw.sig[1], tt) : null;
    if (sig) {
      const mine = cw.axis === 'ns' ? sig.nsWalk : sig.ewWalk;
      if (mine === 'walk') {
        const need = cw.len / 1.6 * 0.55;
        const later = TL.signalState(cw.sig[0], cw.sig[1], tt + need);
        const conflict = cw.axis === 'ns' ? later.ew === 'green' : later.ns === 'green';
        if (!conflict && !gap) return true;
      }
      return L.jay && waited > L.patience && !gap && !this.vehicleNear(cw, 28);
    }
    return waited > 1.5 && !this.vehicleNear(cw, 24);        // unsignalised: wait for a gap
  }
  /* a moving car right in front of a walker on the road: stop and let it pass */
  vehicleAhead(p) {
    const tr = this.game.traffic; if (!tr) return false; const L = p.L;
    for (const v of tr.vehicles) {
      if (!v.active || v.speed < 0.6) continue;
      const dx = v.pos.x - p.pos.x, dz = v.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < 5.5 && d > 0.01 && (dx * L.hx + dz * L.hz) / d > 0.25) return true;
    }
    return false;
  }
  vehicleNear(cw, r) {
    const tr = this.game.traffic; if (!tr) return false; r = r || 11;
    for (const v of tr.vehicles) {
      if (!v.active) continue;
      const dx = v.pos.x - cw.mx, dz = v.pos.z - cw.mz;
      if (dx * dx + dz * dz < r * r && (v.speed > 2.5 || Math.hypot(dx, dz) < 5)) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- update (called by CrowdManager.update before thinking) */
  begin(dt, focus) {
    this.t += dt;
    const e = this.game.env; this.hour = e ? e.hour : 14; this.rain = e ? e.rain || 0 : 0;
    this.rebuild();
    this.panicNear = this._panic; this._panic = [];
    this.cool -= dt;
    this.trimT -= dt; if (this.trimT <= 0) { this.trimT = 0.6; this.trim(focus); }
    this.vendorT -= dt; if (this.vendorT <= 0) { this.vendorT = 1.5; this.ensureVendors(focus); }
    if (this.gather && this.t > this.gather.until) this.gather = null;
    const st = this.stats; st.walking = st.crossing = st.waiting = st.sitting = st.queueing = st.groups = 0; st.gathered = 0;
    this.flyT -= dt; if (this.flyT <= 0) { this.flyT = 0.7; this.flyby(focus); }
  }

  /* the street thins out (night, rain): retire the most distant unseen walkers first */
  trim(focus) {
    const C = this.crowd, cam = this.game.camera.position, excess = C.peds.length - (this.wantNow || C.max) - 6;
    if (excess <= 0) return;
    let worst = null, wd = 70;
    for (const p of C.peds) {
      const L = p.L; if (!L || L.vendor || L.act === 'sit' || L.act === 'cross' || L.act === 'queue') continue;
      const d = Math.hypot(p.pos.x - cam.x, p.pos.z - cam.z); if (d > wd) { wd = d; worst = p; }
    }
    if (worst) worst.alive = false;                    // CrowdManager.update despawns it on the next pass
  }

  /* carts: a vendor stands by each cart near the player */
  ensureVendors(focus) {
    const C = this.crowd;
    for (const c of this.carts) {
      const d = Math.hypot(c.x - focus.x, c.z - focus.z);
      if (c.vendor && (!c.vendor.alive || !C.peds.includes(c.vendor))) c.vendor = null;
      if (!c.vendor && d < 150 && C.peds.length < C.max + 10) {
        const p = C.pool.get(); const n = this.nav.nearest(c.x, c.z, 8);
        this.init(p, n < 0 ? 0 : n, 'local', null, 0);
        const L = p.L; L.act = 'vendor'; L.vendor = true; L.cart = c; p.mode = 'wait';
        p.colors.shirt = [0xf0f0f0, 0xd8d4c8, 0xe0e0e8][c.i % 3]; p.colors.pants = 0x2a2d34; p.hat = true; p.bag = false;
        p.pos.set(c.x - c.t[0] * c.qd * 1.35 + c.n[0] * 0.2, 0, c.z - c.t[1] * c.qd * 1.35 + c.n[1] * 0.2); p.pos.y = this.ground(p.pos.x, p.pos.z);
        p.yaw = Math.atan2(c.n[0] * 0.8 + c.t[0] * c.qd * 0.6, c.n[1] * 0.8 + c.t[1] * c.qd * 0.6);
        c.vendor = p; C.peds.push(p);
      }
    }
  }

  /* ---------------------------------------------------------------- hero fly-bys */
  flyby(focus) {
    const g = this.game, h = g.hero.ctrl; if (!h || h.grounded) return;
    const sp = h.vel.length(); if (sp < 10) return;
    const C = this.crowd, rng = this.rng; let n = 0;
    for (const p of C.peds) {
      const L = p.L; if (!L || n >= 3 || L.reactCool > this.t || p.fear > 0.2) continue;
      const dx = p.pos.x - h.pos.x, dz = p.pos.z - h.pos.z, d = Math.hypot(dx, dz);
      if (d > 26 || h.pos.y - p.pos.y < 3 || !['walk', 'idle', 'phone', 'queue', 'sit'].includes(L.act)) continue;
      if (rng.next() > 0.18 + L.curious * 0.3) continue;
      if (!g.cityLife || !g.cityLife.visible(new THREE.Vector3(p.pos.x, p.pos.y + 1.6, p.pos.z), h.pos)) continue;
      L.reactCool = this.t + rng.range(18, 40); n++;
      p.lookAt = h.pos.clone(); p.react = 6; p.modeT = rng.range(2.4, 4.2);
      p.mode = L.curious > 0.7 ? 'photo' : L.curious > 0.35 ? 'point' : 'look';
    }
  }
  /* the hero landed hard: curious walkers gather in a ring */
  onLand(pos, impact) {
    if (impact < 12 || this.gather && this.gather.until > this.t + 4) return;
    this.gather = { x: pos.x, z: pos.z, y: pos.y, until: this.t + 16, n: 0, taken: 0 };
    const C = this.crowd, rng = this.rng, G = this.gather; let n = 0;
    for (const p of C.peds) {
      const L = p.L; if (!L || n >= 9 || p.fear > 0.2 || L.vendor || L.act === 'cross') continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d > 24 || d < 2) continue;
      if (L.curious + (1 - d / 24) * 0.7 < 0.75 + rng.next() * 0.25) continue;
      if (this.game.cityLife && !this.game.cityLife.visible(new THREE.Vector3(p.pos.x, p.pos.y + 1.6, p.pos.z), new THREE.Vector3(pos.x, pos.y + 1, pos.z))) continue;
      this.release(p);
      L.ring = { a: (n / 9) * Math.PI * 2 + rng.range(-0.25, 0.25), r: rng.range(3.4, 5.4) }; n++;
      L.act = 'gather'; L.actT = 0; L.until = this.t + rng.range(7, 13); L.reactCool = this.t + 30;
    }
  }

  /* ---------------------------------------------------------------- resource release */
  release(p) {
    const L = p.L, nav = this.nav;
    if (L.seat) { const s = L.seat; if (s.taken) s.taken[L.slotIdx] = null; L.seat = null; }
    if (L.cart) { const c = L.cart; const i = c.queue.indexOf(p); if (i >= 0) c.queue.splice(i, 1); if (!L.vendor) L.cart = null; }
    if (L.cw) { const w = L.cw.waiting[L.side]; const i = w.indexOf(p); if (i >= 0) w.splice(i, 1); if (L.act !== 'cross') L.cw = null; }
    p.sink = 0; p.cross = null;
    void nav;
  }
  despawn(p) { this.release(p); const L = p.L; if (L && L.group) { const g = L.group, i = g.members.indexOf(p); if (i >= 0) g.members.splice(i, 1); if (g.members.length) { for (const m of g.members) m.L.group = g.members.length > 1 ? g : null; } L.group = null; } }

  /* ---------------------------------------------------------------- intents */
  routeTo(p, goal) {
    const L = p.L, nav = this.nav;
    const from = L.node >= 0 ? L.node : nav.nearest(p.pos.x, p.pos.z, 15); if (from < 0) return false;
    const path = nav.path(from, goal, 2600);
    if (!path || path.length < 2) return false;
    L.route = path; L.ri = 1; L.prev = from; L.node = from; L.segA = from; L.segB = path[1];
    return true;
  }
  /* a far goal within ~70-260 m, biased by the density field and the class (joggers like the waterfront and parks) */
  pickGoal(p) {
    const nav = this.nav, rng = this.rng, L = p.L, list = nav.within(p.pos.x, p.pos.z, 240, this._tmp);
    let best = -1, bs = -1;
    for (let k = 0; k < 14 && list.length; k++) {
      const n = list[Math.floor(rng.next() * list.length)];
      const d = Math.hypot(nav.x(n) - p.pos.x, nav.z(n) - p.pos.z); if (d < 70) continue;
      let s = nav.densityAt(nav.x(n), nav.z(n)) + rng.next() * 0.5;
      if (L.style === 'jogger') s += (nav.nearWater(n) ? 1.2 : 0) + (nav.zoneOf(n) === 3 ? 0.7 : 0);
      if (L.style === 'tourist') s += (nav.zoneOf(n) >= 2 ? 0.5 : 0) + (nav.nearWater(n) ? 0.4 : 0);
      if (L.style === 'suit') { const dx = nav.x(n) - p.pos.x, dz = nav.z(n) - p.pos.z; s += Math.abs(dx * L.hx + dz * L.hz) / d * 0.5; }
      if (s > bs) { bs = s; best = n; }
    }
    return best;
  }
  /* decide what to do next: called when a route is finished or a dwell ends */
  decide(p) {
    const L = p.L, rng = this.rng, nav = this.nav, hour = this.hour, raining = this.rain > 0.4;
    if (L.group && L.group.members[0] !== p) { L.act = 'follow'; return; }          // followers do whatever the leader does
    const G = L.group, solo = !G || G.members.length === 1;
    const lunch = hour >= 11.2 && hour <= 14.5, fair = this.rain < 0.15;
    let r = rng.next();
    const wSit = (fair ? (L.style === 'tourist' ? 0.2 : L.style === 'local' ? 0.16 : L.style === 'suit' ? (lunch ? 0.14 : 0.03) : 0.01) : 0) * (hour < 6.5 || hour > 21.5 ? 0.3 : 1);
    const wCart = lunch || (hour > 16 && hour < 19) ? (L.style === 'jogger' ? 0 : 0.12) : 0.025;
    const wPhoto = L.style === 'tourist' ? 0.2 : 0.015;
    const wPhone = L.style === 'jogger' ? 0 : 0.06;
    const wTalk = solo ? 0 : 0.14;
    const wLawn = fair && hour > 10.5 && hour < 19 ? 0.07 : 0;
    const wShelter = raining ? 0.3 : 0;
    if ((r -= wShelter) < 0 && this.goShelter(p)) return;
    if ((r -= wSit) < 0 && this.goSeat(p)) return;
    if ((r -= wCart) < 0 && this.goCart(p)) return;
    if ((r -= wLawn) < 0 && this.goLawn(p)) return;
    if ((r -= wPhoto) < 0) { this.startDwell(p, 'photo', rng.range(3.5, 7)); return; }
    if ((r -= wPhone) < 0) { this.startDwell(p, 'phone', rng.range(5, 16)); return; }
    if ((r -= wTalk) < 0) { this.startDwell(p, 'talk', rng.range(6, 20)); return; }
    const goal = this.pickGoal(p);
    if (goal >= 0 && this.routeTo(p, goal)) { L.act = 'walk'; L.actT = 0; return; }
    // fallback: wander on
    const n = nav.step(L.prev, L.node, L.hx, L.hz, rng, 0.35);
    L.route = [L.node, n]; L.ri = 1; L.act = 'walk';
  }
  startDwell(p, kind, secs) {
    const L = p.L; L.act = kind; L.actT = 0; L.until = this.t + secs; L.ftx = 0;
    if (kind === 'photo') {          // turn towards the nearest big building / landmark side: the side away from the road
      const nav = this.nav, n = L.node;
      let ax = 0, az = 0, cnt = 0;
      for (let k = nav.adjStart[n]; k < nav.adjStart[n + 1]; k++) { const m = nav.adjNode[k]; ax += nav.x(m) - nav.x(n); az += nav.z(m) - nav.z(n); cnt++; }
      const px = -L.hz, pz = L.hx, s = (this.rng.chance(0.5) ? 1 : -1);
      L.ftx = px * s; L.ftz = pz * s; L.look = 1 + Math.floor(this.rng.next() * 3);
      void ax; void az; void cnt;
    }
  }
  seatFree(s, n) { let c = 0; for (const t of s.taken) if (!t) c++; return c >= n; }
  goSeat(p) {
    const L = p.L, nav = this.nav, G = L.group, need = G ? Math.min(G.members.length, 2) : 1;
    let best = null, bd = 1e9;
    for (const s of nav.seats) {
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      if (d < bd && d < 95 && this.seatFree(s, need)) { bd = d; best = s; }
    }
    if (!best) return false;
    const n = nav.nearest(best.x, best.z, 14); if (n < 0 || !this.routeTo(p, n)) return false;
    let k = best.taken[0] ? 1 : 0; best.taken[k] = p; L.seat = best; L.slotIdx = k;
    if (G && need === 2) { const m = G.members[1]; if (m && m.L) { const k2 = best.taken[1 - k] ? -1 : 1 - k; if (k2 >= 0) { best.taken[k2] = m; m.L.seat = best; m.L.slotIdx = k2; m.L.act = 'follow'; } } }
    L.act = 'toseat'; L.actT = 0; return true;
  }
  goLawn(p) {
    const nav = this.nav, rng = this.rng, list = nav.within(p.pos.x, p.pos.z, 90, this._tmp);
    let best = -1, bs = -1;
    for (const n of list) { if (nav.zoneOf(n) !== 3 || nav.clr(n) < 3.2) continue; const s = nav.clr(n) + rng.next() * 3; if (s > bs) { bs = s; best = n; } }
    if (best < 0 || !this.routeTo(p, best)) return false;
    const L = p.L; L.act = 'tolawn'; L.actT = 0; L.lx = nav.x(best) + rng.range(-1.2, 1.2); L.lz = nav.z(best) + rng.range(-1.2, 1.2);
    return true;
  }
  goShelter(p) {
    const nav = this.nav, L = p.L, list = nav.within(p.pos.x, p.pos.z, 80, this._tmp);
    let best = -1, bs = 1e9;
    for (const n of list) { const c = nav.clr(n); if (c > 1.3 || nav.zoneOf(n) === 3) continue; const d = Math.hypot(nav.x(n) - p.pos.x, nav.z(n) - p.pos.z); if (d < bs) { bs = d; best = n; } }
    if (best < 0 || !this.routeTo(p, best)) return false;
    L.act = 'toshelter'; L.actT = 0; return true;
  }
  goCart(p) {
    const L = p.L, G = L.group; let best = null, bd = 1e9;
    if (L.cart) return false;
    for (const c of this.carts) {
      const d = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
      if (d < bd && d < 110 && c.queue.length < 7) { bd = d; best = c; }
    }
    if (!best) return false;
    const n = this.nav.nearest(best.x + best.n[0] * 1.5 + best.t[0] * best.qd * 3, best.z + best.n[1] * 1.5 + best.t[1] * best.qd * 3, 12);
    if (n < 0 || !this.routeTo(p, n)) return false;
    L.cart = best; best.queue.push(p); L.act = 'tocart'; L.actT = 0;
    if (G) for (const m of G.members) if (m !== p && m.L && !m.L.cart && best.queue.length < 7) { m.L.cart = best; best.queue.push(m); m.L.act = 'follow'; }
    return true;
  }
  /* queue slot position k at cart c */
  cartSlot(c, k, out) {
    const f = 1.25, x0 = c.x + c.n[0] * f, z0 = c.z + c.n[1] * f;
    out.x = x0 + c.t[0] * c.qd * (k === 0 ? 0 : 0.5 + k * 0.78);
    out.z = z0 + c.t[1] * c.qd * (k === 0 ? 0 : 0.5 + k * 0.78);
    out.yaw = Math.atan2(-c.n[0] + (k ? -c.t[0] * c.qd * 0.15 : 0), -c.n[1] + (k ? -c.t[1] * c.qd * 0.15 : 0));
    return out;
  }
  waitSlot(cw, side, k, out) {
    const nav = this.nav, n = side === 0 ? cw.a : cw.b, sg = side === 0 ? 1 : -1;        // sg: direction from the kerb into the crossing
    const bx = nav.x(n), bz = nav.z(n), dx = cw.dx * sg, dz = cw.dz * sg, tx = -dz, tz = dx;
    const row = Math.floor(k / 4), col = k % 4, off = (col - 1.5) * 0.7;
    const lim = Math.max(0.2, Math.min(2.2, nav.clr(n) - 0.5));
    out.x = bx - dx * (0.15 + row * 0.7) + tx * TL.clamp(off, -lim, lim);
    out.z = bz - dz * (0.15 + row * 0.7) + tz * TL.clamp(off, -lim, lim);
    out.yaw = Math.atan2(dx, dz);
    return out;
  }

  /* ---------------------------------------------------------------- fear */
  fear(p, dt, danger) {
    const g = this.game, L = p.L, rng = this.rng; let near = null, nd = 28;
    for (const d of danger) {
      const dd = Math.hypot(d.x - p.pos.x, d.z - p.pos.z);
      if (dd < nd && Math.abs(d.y - p.pos.y) < 12 && (!g.cityLife || g.cityLife.visible(this._a.set(p.pos.x, p.pos.y + 1.5, p.pos.z), this._b.set(d.x, d.y + 1, d.z)))) { nd = dd; near = d; }
    }
    if (near) { p.fear = Math.min(1, p.fear + dt * 2); if (!p.fleeFrom) p.fleeFrom = new THREE.Vector3(); p.fleeFrom.copy(near); L.dangerD = nd; L.directT = this.t; }
    else p.fear = Math.max(0, p.fear - dt * 0.06);
    // panic spreads: a frightened neighbour within 6 m scares calm walkers
    if (p.fear < 0.3 && this.panicNear && this.panicNear.length) {
      for (const q of this.panicNear) { const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z; if (dx * dx + dz * dz < 36) { p.fear = Math.min(0.55, p.fear + dt * 0.6); if (!p.fleeFrom) p.fleeFrom = new THREE.Vector3(); p.fleeFrom.copy(q.fleeFrom || q.pos); break; } }
    }
    if (p.fear > 0.3 && !L.vendor) {
      if (L.act !== 'flee' && L.act !== 'cower') { this.release(p); L.act = 'flee'; L.actT = 0; L.route = null; L.curiousFilm = L.curious > 0.75 && (L.dangerD || 0) > 12; }
      if (L.act === 'flee' && p.fear > 0.8 && (L.dangerD || 99) < 9 && rng.next() < dt * 0.25) { L.act = 'cower'; L.actT = 0; L.until = this.t + rng.range(4, 8); }
      if (this.t - (L.directT || -9) < 2) this._panic.push(p);      // only people who saw the danger themselves spread the panic
    } else if ((L.act === 'flee' || L.act === 'cower') && p.fear < 0.08) { L.act = 'recover'; L.actT = 0; L.until = this.t + 1.2; }
  }

  /* ---------------------------------------------------------------- movement */
  /* velocity-based steering: arrive at (tx,tz) at most `want` m/s, avoid neighbours (pass on the right) and the hero */
  steer(p, tx, tz, want, dt) {
    const L = p.L, pos = p.pos, h = this.game.hero.ctrl;
    const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
    let dvx = 0, dvz = 0;
    if (d > 0.03 && want > 0) { const k = Math.min(want, d / 0.45 + 0.05); dvx = dx / d * k; dvz = dz / d * k; }
    let ax = 0, az = 0;
    const fs = Math.hypot(L.vx, L.vz), fx = fs > 0.05 ? L.vx / fs : L.hx, fz = fs > 0.05 ? L.vz / fs : L.hz;
    const nb = this.near(pos.x, pos.z, 2.3, this._n);
    for (const q of nb) {
      if (q === p) continue;
      const rx = pos.x - q.pos.x, rz = pos.z - q.pos.z, dist = Math.hypot(rx, rz);
      if (dist < 1e-3 || dist > 2.3) continue;
      const Q = q.L, mate = L.group && Q && Q.group === L.group, still = !Q || Q.spd < 0.15;
      const pers = mate ? 0.46 : 0.74;
      if (dist < pers * 2.2) { const s = Math.min(2.4, Math.exp((pers - dist) / 0.3) * 0.75 * (mate ? 0.55 : 1)); ax += rx / dist * s; az += rz / dist * s; }
      if (!mate && Q && !still && fs > 0.3) {
        const qs = Math.hypot(Q.vx, Q.vz);
        if (qs > 0.3 && (fx * Q.vx + fz * Q.vz) / qs < -0.4 && (-rx * fx - rz * fz) / dist > 0.25) { const w = (1 - dist / 2.3) * 0.85; ax += -fz * w; az += fx * w; }   // oncoming: take the right
      }
    }
    if (h && (h.grounded || h.state === TL.TS.GROUND)) {
      const rx = pos.x - h.pos.x, rz = pos.z - h.pos.z, dist = Math.hypot(rx, rz);
      if (dist < 1.9 && dist > 1e-3) { const s = Math.min(2.6, Math.exp((0.95 - dist) / 0.35) * 0.9); ax += rx / dist * s; az += rz / dist * s; }
    }
    let tvx = dvx + ax, tvz = dvz + az;
    const ts = Math.hypot(tvx, tvz), cap = Math.max(want, 0.4) * 1.3;
    if (ts > cap) { tvx *= cap / ts; tvz *= cap / ts; }
    const acc = (ts < L.spd ? 3.8 : 2.5) * dt;
    let ex = tvx - L.vx, ez = tvz - L.vz; const el = Math.hypot(ex, ez);
    if (el > acc) { ex *= acc / el; ez *= acc / el; }
    L.vx += ex; L.vz += ez;
    pos.x += L.vx * dt; pos.z += L.vz * dt;
    L.spd = Math.hypot(L.vx, L.vz);
    if (L.spd > 0.12) { L.hx = L.vx / L.spd; L.hz = L.vz / L.spd; }
  }
  stop(p, dt) { this.steer(p, p.pos.x, p.pos.z, 0, dt); }
  face(p, yaw, dt, k) { p.yaw = TL.dampAngle(p.yaw, yaw, k || 6, dt); }

  /* keep a walker inside the corridor of the edge(s) it is on */
  clamp(p, loose, dt) {
    dt = dt || 1 / 60;
    const L = p.L, nav = this.nav; if (L.segA < 0 || loose) return;
    const A = L.segA, B = L.segB;
    const ax = nav.x(A), az = nav.z(A), bx = nav.x(B), bz = nav.z(B), dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const proj = (px, pz, qx, qz, ex, ez, e2) => { const t = TL.clamp(((px - qx) * ex + (pz - qz) * ez) / e2, 0, 1); return [qx + ex * t, qz + ez * t]; };
    let [cx, cz] = proj(p.pos.x, p.pos.z, ax, az, dx, dz, l2);
    let e = nav.edgeBetween(A, B), allow = e >= 0 ? Math.max(0.15, nav.eclr[e] - 0.42) : 0.5;
    if (e >= 0 && nav.exw[e] >= 0) allow = Math.max(allow, 0.9);
    let d = Math.hypot(p.pos.x - cx, p.pos.z - cz);
    if (d > allow && L.route && L.ri < L.route.length - 1 && Math.hypot(p.pos.x - bx, p.pos.z - bz) < 3.2) {      // rounding the corner: the next edge counts too
      const C2 = L.route[L.ri + 1], qx = nav.x(C2) - bx, qz = nav.z(C2) - bz, e2 = nav.edgeBetween(B, C2);
      const [c2x, c2z] = proj(p.pos.x, p.pos.z, bx, bz, qx, qz, qx * qx + qz * qz || 1), d2 = Math.hypot(p.pos.x - c2x, p.pos.z - c2z);
      const a2 = e2 >= 0 ? Math.max(0.15, nav.eclr[e2] - 0.42) : 0.5;
      if (d2 < d) { d = d2; cx = c2x; cz = c2z; allow = Math.max(allow, a2); }
      allow = Math.max(allow, Math.min(nav.clr(B) - 0.42, 1.6));
    }
    if (d > allow) {
      // pull back smoothly (never a snap): at most ~2.4 m/s of correction, more only when far outside
      const over = d - allow, step = Math.min(over, Math.max(0.012, dt * (over > 1.5 ? 4 : 2.4))), k = (d - step) / d;
      const ox = p.pos.x - cx, oz = p.pos.z - cz;
      p.pos.x = cx + ox * k; p.pos.z = cz + oz * k;
      const vo = (L.vx * ox + L.vz * oz) / d;
      if (vo > 0) { L.vx -= ox / d * vo; L.vz -= oz / d * vo; }
    }
  }

  /* follow L.route; returns true when the route is finished */
  walkRoute(p, dt, want, lane) {
    const L = p.L, nav = this.nav, R = L.route, pos = p.pos;
    if (!R) return true;
    while (L.ri < R.length) {
      const B = R[L.ri], bx = nav.x(B), bz = nav.z(B), a = R[L.ri - 1];
      const e = a >= 0 ? nav.edgeBetween(a, B) : -1;
      const need = e >= 0 && nav.exw[e] >= 0 ? 0.55 : L.ri === R.length - 1 ? 0.55 : 1.2;
      if (Math.hypot(bx - pos.x, bz - pos.z) > need) break;
      L.prev = L.node; L.node = B; L.ri++;
      if (L.prev >= 0) { const dx = bx - nav.x(L.prev), dz = bz - nav.z(L.prev), l = Math.hypot(dx, dz) || 1; L.hx = dx / l; L.hz = dz / l; }
      if (L.ri < R.length) {
        const e2 = nav.edgeBetween(B, R[L.ri]);
        if (e2 >= 0 && nav.exw[e2] >= 0 && L.act !== 'cross') { this.beginWait(p, nav.cw[nav.exw[e2]], B === nav.cw[nav.exw[e2]].a ? 0 : 1); return false; }
        if (L.act === 'cross' && e >= 0 && nav.exw[e] >= 0) { L.act = 'walk'; p.cross = null; this.leaveCw(p); }
      }
    }
    if (L.ri >= R.length) { if (L.act === 'cross') { L.act = 'walk'; p.cross = null; this.leaveCw(p); } return true; }
    const B = R[L.ri], A = L.ri > 0 ? R[L.ri - 1] : L.node;
    L.segA = A; L.segB = B;
    const ax = nav.x(A), az = nav.z(A), bx = nav.x(B), bz = nav.z(B);
    let dx = bx - ax, dz = bz - az; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const t = ((pos.x - ax) * dx + (pos.z - az) * dz);
    const la = 1.0 + L.spd * 0.55, rem = len - t;
    let tx, tz, nx = -dz, nz = dx;                                        // right-hand normal of the travel direction (x east, z south)
    if (rem < la && L.ri + 1 < R.length) {
      const C2 = R[L.ri + 1], qx = nav.x(C2) - bx, qz = nav.z(C2) - bz, ql = Math.hypot(qx, qz) || 1, k = Math.min(la - rem, ql * 0.9);
      tx = bx + qx / ql * k; tz = bz + qz / ql * k; nx = -qz / ql; nz = qx / ql;
    } else { const k = Math.min(len, Math.max(t, 0) + la); tx = ax + dx * k; tz = az + dz * k; }
    const e = nav.edgeBetween(A, B), allow = e >= 0 ? Math.max(0, nav.eclr[e] - 0.5) : 0.3;
    L.allow = allow;
    const off = Math.min(lane === undefined ? L.lane * 0.65 : lane, allow * 0.8);
    tx += nx * off; tz += nz * off;
    this.steer(p, tx, tz, want, dt);
    this.clamp(p, false, dt);
    return false;
  }

  /* ---------------------------------------------------------------- crossings */
  beginWait(p, cw, side) {
    const L = p.L; L.cw = cw; L.side = side; L.act = 'waitcross'; L.actT = 0; L.waitSlot = cw.waiting[side].length;
    cw.waiting[side].push(p); p.mode = 'idle';
  }
  leaveCw(p) { const L = p.L; if (!L.cw) return; for (const w of L.cw.waiting) { const i = w.indexOf(p); if (i >= 0) w.splice(i, 1); } L.cw = null; }
  waitCross(p, dt) {
    const L = p.L, cw = L.cw, out = this._slot || (this._slot = { x: 0, z: 0, yaw: 0 });
    const k = cw.waiting[L.side].indexOf(p); this.waitSlot(cw, L.side, k < 0 ? 0 : k, out);
    this.steer(p, out.x, out.z, 1.15, dt);
    const near = Math.hypot(out.x - p.pos.x, out.z - p.pos.z) < 0.6;
    if (near) this.face(p, out.yaw, dt, 5);
    L.ckT = (L.ckT || 0) - dt;
    if (L.ckT <= 0) {
      L.ckT = 0.25 + this.rng.next() * 0.15;
      if (L.actT > 0.8 && this.canCross(p, cw, L.actT)) {
        const w = cw.waiting[L.side], i = w.indexOf(p); if (i >= 0) w.splice(i, 1);
        L.act = 'cross'; L.actT = 0; p.cross = cw; p.mode = 'wait';
      }
    }
  }
  heroFacing(p, dt) { const h = this.game.hero.ctrl.pos; this.face(p, Math.atan2(h.x - p.pos.x, h.z - p.pos.z), 5, dt); }

  /* ---------------------------------------------------------------- per-pedestrian update */
  think(p, dt, danger, h, raining) {
    const g = this.game, L = p.L, rng = this.rng, nav = this.nav;
    p.modeT -= dt; p.react = Math.max(0, p.react - dt); L.actT += dt;
    if (!L.vendor) this.fear(p, dt, danger);
    if (g.cityLife) g.cityLife.react(p, dt);
    // greeting with [E]
    const hd = p.pos.distanceTo(h.pos);
    if (hd < 2.6 && p.fear < 0.3 && h.state === TL.TS.GROUND && !g.missions.active && !(g.cityLife && g.cityLife.incident) && !['cross', 'flee', 'cower'].includes(L.act)) {
      g.ui.prompt('[E] Greet');
      if (g.input.consume('interact')) {
        const kind = ['High-five', 'Selfie', 'Greeting'][Math.floor(Math.random() * 3)];
        p.mode = kind === 'Selfie' ? 'photo' : 'wave'; p.modeT = 2.5; p.react = 20;
        g.progress.changeTrust(g.layout.district(p.pos.x, p.pos.z), 0.5); g.progress.style(5, kind);
        g.ui.caption('Civilian: "' + (kind === 'Selfie' ? 'Say cheese!' : kind === 'High-five' ? 'Up top!' : 'Have a good one!') + '"', 'Civilian');
        g.hero.anim.startAction('cast', 0.4);
      }
    }
    const reacting = p.modeT > 0 && (p.mode === 'look' || p.mode === 'wave' || p.mode === 'photo' || p.mode === 'cheer' || p.mode === 'point' || p.mode === 'cower') && L.act !== 'flee' && L.act !== 'cower';
    if (!reacting && (p.mode === 'look' || p.mode === 'wave' || p.mode === 'photo' || p.mode === 'cheer' || p.mode === 'point')) { p.mode = 'walk'; p.lookAt = null; }
    // rain: leave the benches, hurry
    if (raining && L.seat && L.act === 'sit' && L.actT > 3) L.until = Math.min(L.until, this.t);
    const rainBoost = this.rain > 0.4 ? 1.18 : 1;
    const wantBase = L.pref * rainBoost * (L.speedMul || 1);
    let anim = null;
    switch (L.act) {
      case 'walk': case 'cross': {
        let want = wantBase;
        if (L.act === 'cross') { const sg = L.cw && L.cw.sig ? TL.signalState(L.cw.sig[0], L.cw.sig[1], g.traffic.t) : null; const mine = sg ? (L.cw.axis === 'ns' ? sg.nsWalk : sg.ewWalk) : 'walk'; want = Math.max(want, 1.45) * (mine === 'walk' ? 1.05 : 1.35); if (this.vehicleAhead(p)) want = 0; }
        const G = L.group;
        if (G && G.members[0] === p) { let worst = 0; for (const m of G.members) if (m !== p) worst = Math.max(worst, Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z)); if (worst > 3.2) want *= Math.max(0.25, 1 - (worst - 3.2) * 0.3); }
        if (reacting) { this.stop(p, dt); anim = p.mode; if (p.lookAt) this.face(p, Math.atan2(p.lookAt.x - p.pos.x, p.lookAt.z - p.pos.z), 5, dt); break; }
        if (!L.route || this.walkRoute(p, dt, want)) { if (L.act === 'cross') { L.act = 'walk'; p.cross = null; this.leaveCw(p); } if (L.act === 'walk') { this.decide(p); } }
        if (!reacting) p.mode = L.act === 'cross' ? 'wait' : 'walk';
        // passing a cart at lunchtime: sometimes join the queue
        if (L.act === 'walk' && !reacting && !L.cartDone && !L.food && (L.cartT = (L.cartT || 0) - dt) <= 0) {
          L.cartT = 2 + rng.next() * 2;
          const hour = this.hour, lunch = hour >= 11.3 && hour <= 14.3, eve = hour > 16.5 && hour < 19.5;
          if ((lunch || eve) && this.rain < 0.2 && rng.next() < (lunch ? 0.2 : 0.06) && L.style !== 'jogger') {
            for (const c of this.carts) if (c.queue.length < 6 && Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < 30) { L.cartDone = true; this.goCart(p); break; }
          }
        }
        break;
      }
      case 'waitcross': this.waitCross(p, dt); if (reacting) { anim = p.mode; if (p.lookAt) this.face(p, Math.atan2(p.lookAt.x - p.pos.x, p.lookAt.z - p.pos.z), 5, dt); } else p.mode = 'idle'; break;
      case 'photo': case 'phone': case 'talk': case 'idle': case 'recover': {
        this.stop(p, dt);
        if (L.act === 'photo') this.face(p, Math.atan2(L.ftx, L.ftz), 3, dt);
        if (L.act === 'recover' || this.t >= L.until) { if (this.t >= L.until) this.decide(p); }
        if (reacting) { anim = p.mode; if (p.lookAt) this.face(p, Math.atan2(p.lookAt.x - p.pos.x, p.lookAt.z - p.pos.z), 5, dt); }
        break;
      }
      case 'toseat': case 'tolawn': case 'toshelter': case 'tocart': {
        const fin = this.walkRoute(p, dt, wantBase);
        if (reacting && false) break;
        if (fin) this.arrive(p);
        break;
      }
      case 'seatfront': {
        const s = L.seat, sl = s.slots[L.slotIdx], fx = Math.sin(s.f), fz = Math.cos(s.f);
        this.steer(p, sl[0] + fx * 0.75, sl[1] + fz * 0.75, 1.0, dt); this.clamp(p, true, dt);
        if (Math.hypot(sl[0] + fx * 0.75 - p.pos.x, sl[1] + fz * 0.75 - p.pos.z) < 0.3) { L.act = 'sitdown'; L.actT = 0; L.sx = p.pos.x; L.sz = p.pos.z; p.mode = 'wait'; }
        break;
      }
      case 'sitdown': {
        const s = L.seat, sl = s.slots[L.slotIdx], u = TL.smooth(0, 1.0, L.actT);
        p.pos.x = L.sx + (sl[0] - L.sx) * u; p.pos.z = L.sz + (sl[1] - L.sz) * u; L.vx = L.vz = L.spd = 0;
        this.face(p, s.f, dt, 8);
        p.sink = 0.34 * u; anim = u > 0.5 ? this.sitAnim(p) : 'idle';
        if (L.actT >= 1.0) { L.act = 'sit'; L.actT = 0; L.until = this.t + this.sitTime(p); }
        break;
      }
      case 'sit': {
        const s = L.seat; this.face(p, s.f, dt, 8); p.sink = 0.34; anim = this.sitAnim(p);
        if (this.t >= L.until || p.fear > 0.3) { L.act = 'standup'; L.actT = 0; }
        break;
      }
      case 'standup': {
        const s = L.seat, u = 1 - TL.smooth(0, 0.7, L.actT), fx = Math.sin(s.f), fz = Math.cos(s.f);
        p.sink = 0.34 * u; anim = 'idle';
        const sl = s.slots[L.slotIdx]; p.pos.x = sl[0] + fx * 0.75 * (1 - u); p.pos.z = sl[1] + fz * 0.75 * (1 - u);
        if (L.actT >= 0.7) { this.release(p); L.node = nav.nearest(p.pos.x, p.pos.z, 20); L.segA = L.segB = -1; this.decide(p); if (L.act === 'follow' || L.act === 'walk') p.mode = 'walk'; }
        break;
      }
      case 'lawn': {
        this.stop(p, dt); p.sink = 0.72; anim = 'sitground'; this.face(p, L.lyaw, dt, 4);
        if (this.t >= L.until || p.fear > 0.3 || this.rain > 0.2) { p.sink = 0; this.release(p); this.decide(p); }
        break;
      }
      case 'lawnapproach': {
        this.steer(p, L.lx, L.lz, 1.0, dt);
        if (Math.hypot(L.lx - p.pos.x, L.lz - p.pos.z) < 0.35) { L.act = 'lawn'; L.actT = 0; L.until = this.t + rng.range(35, 140); L.lyaw = rng.range(-3, 3); }
        break;
      }
      case 'shelter': {
        this.stop(p, dt); anim = L.actT % 9 < 6 ? 'idle' : 'look'; this.face(p, L.lyaw, dt, 3);
        if (this.rain < 0.15 && L.actT > 6 || L.actT > 45) this.decide(p);
        break;
      }
      case 'queue': {
        const c = L.cart; let i = c ? c.queue.indexOf(p) : -1;
        if (i < 0) { this.decide(p); break; }
        const out = this._slot || (this._slot = { x: 0, z: 0, yaw: 0 }); this.cartSlot(c, i, out);
        this.steer(p, out.x, out.z, 1.1, dt);
        const there = Math.hypot(out.x - p.pos.x, out.z - p.pos.z) < 0.45;
        if (there) this.face(p, out.yaw, dt, 5);
        p.mode = 'wait';
        if (i === 0 && there) {
          if (!L.ordering) { L.ordering = true; L.orderT = rng.range(4.5, 7); L.actT = 0; }
          anim = 'order'; L.orderT -= dt;
          if (L.orderT <= 0) { L.ordering = false; c.queue.shift(); L.cart = null; L.food = 1; L.eatT = rng.range(8, 14); p.mode = 'walk'; L.act = 'walk'; L.route = null; if (!(rng.chance(0.55) && this.goSeat(p))) { const gl = this.pickGoal(p); if (gl >= 0) this.routeTo(p, gl); } }
        } else anim = there ? 'idle' : null;
        break;
      }
      case 'gather': {
        const G = this.gather; if (!G || this.t > L.until) { this.release(p); this.decide(p); break; }
        const rx = G.x + Math.cos(L.ring.a) * L.ring.r, rz = G.z + Math.sin(L.ring.a) * L.ring.r;
        if (!L.gtx || L.actT < 0.05) { const n = nav.nearest(rx, rz, 7); if (n < 0) { this.decide(p); break; } L.gtx = nav.x(n) + (rx - nav.x(n)) * 0.5; L.gtz = nav.z(n) + (rz - nav.z(n)) * 0.5; }
        const d = Math.hypot(L.gtx - p.pos.x, L.gtz - p.pos.z);
        this.steer(p, L.gtx, L.gtz, d > 6 ? 2.4 : 1.4, dt);
        if (d < 0.7) { this.face(p, Math.atan2(G.x - p.pos.x, G.z - p.pos.z), 6, dt); anim = ['cheer', 'photo', 'point', 'wave', 'photo'][Math.floor(L.curious * 5) % 5]; L.arrived = true; }
        this.stats.gathered++;
        break;
      }
      case 'flee': {
        const from = p.fleeFrom;
        if (L.curiousFilm && p.fear < 0.55 && (L.dangerD || 0) > 12 && from) { this.stop(p, dt); this.face(p, Math.atan2(from.x - p.pos.x, from.z - p.pos.z), 5, dt); anim = 'photo'; break; }
        if ((!L.route || L.ri >= L.route.length) && from) {
          const list = nav.within(p.pos.x, p.pos.z, 130, this._tmp); let best = -1, bs = -1e9;
          for (let k = 0; k < 14 && list.length; k++) { const n = list[Math.floor(rng.next() * list.length)], dx = nav.x(n) - from.x, dz = nav.z(n) - from.z, d = Math.hypot(dx, dz), own = Math.hypot(nav.x(n) - p.pos.x, nav.z(n) - p.pos.z); const s = d - own * 0.35; if (own > 25 && s > bs) { bs = s; best = n; } }
          if (best >= 0) this.routeTo(p, best); else { this.stop(p, dt); break; }
        }
        const cwFlee = L.cw && L.cw.waiting; if (cwFlee) this.leaveCw(p);
        if (this.walkRoute(p, dt, 4.4)) L.route = null;
        break;
      }
      case 'cower': this.stop(p, dt); anim = 'cower'; if (this.t >= L.until && p.fear < 0.3) { L.act = 'recover'; L.until = this.t + 1; } break;
      case 'vendor': {
        const c = L.cart, q = c.queue[0];
        this.stop(p, dt);
        if (q && q.L.ordering) { this.face(p, Math.atan2(q.pos.x - p.pos.x, q.pos.z - p.pos.z), 5, dt); anim = 'serve'; }
        else { this.face(p, Math.atan2(c.n[0] * 0.8 + c.t[0] * c.qd * 0.6, c.n[1] * 0.8 + c.t[1] * c.qd * 0.6), 3, dt); anim = c.queue.length ? 'serve' : (this.t * 0.3 + c.i) % 7 < 5 ? 'idle' : 'wave'; }
        p.mode = 'wait';
        break;
      }
      case 'follow': this.follow(p, dt, wantBase); if (reacting) { anim = p.mode; } break;
      default: this.decide(p);
    }
    this.finish(p, dt, anim, reacting);
  }
  sitTime(p) { const L = p.L; return L.style === 'suit' ? this.rng.range(20, 55) : L.style === 'tourist' ? this.rng.range(30, 90) : this.rng.range(30, 150); }
  sitAnim(p) {
    const L = p.L;
    if (L.sitKind === undefined) { const r = this.rng.next(); L.sitKind = L.food ? 'siteat' : r < 0.3 ? 'sitphone' : r < 0.5 ? 'sitread' : r < 0.75 ? 'sitrelax' : 'sit'; }
    return L.sitKind;
  }
  /* a finished route: what was it for? */
  arrive(p) {
    const L = p.L, nav = this.nav, rng = this.rng;
    L.route = null; L.segA = L.segB = -1;
    const kind = L.act;
    if (kind === 'toseat') { L.act = 'seatfront'; L.actT = 0; L.sitKind = undefined; p.mode = 'wait'; }
    else if (kind === 'tocart') { L.act = 'queue'; L.actT = 0; }
    else if (kind === 'tolawn') { L.act = 'lawnapproach'; L.actT = 0; }
    else if (kind === 'toshelter') { L.act = 'shelter'; L.actT = 0; L.lyaw = Math.atan2(-L.hz, L.hx) + rng.range(-0.5, 0.5); }
    void nav;
  }
  /* group followers: formation behind / beside the leader, or a talking circle when the leader stops */
  follow(p, dt, want) {
    const L = p.L, G = L.group, lead = G && G.members[0];
    if (!G || lead === p || !lead || !lead.L) { L.act = 'walk'; this.decide(p); return; }
    const LL = lead.L;
    if (LL.act === 'tocart' || LL.act === 'queue') { if (L.cart) { L.act = LL.act === 'queue' ? 'queue' : 'follow'; if (L.act === 'queue') return; } }
    if (L.seat && (LL.act === 'seatfront' || LL.act === 'sitdown' || LL.act === 'sit')) { L.act = L.seat ? 'seatfront' : 'follow'; L.actT = 0; return; }
    if (L.cart && LL.act === 'queue') { L.act = 'queue'; return; }
    const idx = Math.max(1, G.members.indexOf(p));
    const ls = Math.hypot(LL.vx, LL.vz);
    if (LL.act === 'walk' || LL.act === 'cross' || LL.act === 'waitcross' || LL.act === 'flee') {
      const fx = LL.hx, fz = LL.hz, rx = -fz, rz = fx;
      const offs = [[0, 0], [0.95, -0.35], [-0.95, -0.35], [0, -1.5]], o = offs[Math.min(idx, 3)];
      const squeeze = Math.min(1, Math.max(0.2, (LL.allow || 1) / 0.9));
      const tx = lead.pos.x + rx * o[0] * squeeze + fx * (o[1] - (1 - squeeze) * 0.8), tz = lead.pos.z + rz * o[0] * squeeze + fz * (o[1] - (1 - squeeze) * 0.8);
      const d = Math.hypot(tx - p.pos.x, tz - p.pos.z);
      this.steer(p, tx, tz, Math.min(2.2, (ls > 0.2 ? Math.max(ls, 0.9) : 1.0) * (1 + Math.min(1, d * 0.5)) + (LL.act === 'flee' ? 3 : 0)), dt);
      if (LL.act === 'cross') p.cross = lead.cross;
      p.mode = d < 0.15 && ls < 0.2 ? 'idle' : 'walk';
    } else {
      // leader dwelling (talk / photo / phone / pause): stand in a loose circle facing it
      const a = (idx / Math.max(2, G.members.length)) * Math.PI * 2 + 0.7, tx = lead.pos.x + Math.cos(a) * 1.0, tz = lead.pos.z + Math.sin(a) * 1.0;
      this.steer(p, tx, tz, 1.1, dt);
      if (Math.hypot(tx - p.pos.x, tz - p.pos.z) < 0.5) this.face(p, Math.atan2(lead.pos.x - p.pos.x, lead.pos.z - p.pos.z), 4, dt);
      p.mode = 'idle';
    }
  }

  /* ---------------------------------------------------------------- final pose / height / animation selection */
  finish(p, dt, anim, reacting) {
    const L = p.L;
    // height: ground (+15 cm on the slab); seated figures sit on the seat height
    const s = L.seat && (L.act === 'sit' || L.act === 'sitdown' || L.act === 'standup') ? L.seat : null;
    let gy = this.ground(p.pos.x, p.pos.z);
    if (s) gy += Math.max(0, (s.h || 0.45) - 0.45);
    p.pos.y += (gy - p.pos.y) * Math.min(1, dt * 14);
    if (!Number.isFinite(p.pos.x + p.pos.z + p.pos.y)) {
      if (TL.CROWD_DEBUG) console.log('NaN ped', L.act, L.style, p.pos.x, p.pos.z, L.vx, L.vz, L.spd, L.node, L.segA, L.segB, L.ri, L.route && L.route.length, 'prevact'); p.pos.set(this.nav.x(L.node), 0, this.nav.z(L.node)); L.vx = L.vz = 0; }
    // heading follows the velocity while moving; dwell acts set the yaw themselves
    if (L.spd > 0.3 && ['walk', 'cross', 'follow', 'toseat', 'tolawn', 'toshelter', 'tocart', 'flee', 'seatfront', 'lawnapproach', 'gather', 'queue', 'waitcross'].includes(L.act)) {
      const reactFace = reacting && p.lookAt;
      if (!reactFace) p.yaw = TL.dampAngle(p.yaw, Math.atan2(L.vx, L.vz), L.spd > 1 ? 9 : 5, dt);
    }
    p.speed = L.spd;
    if (!anim) {
      const moving = L.spd > (L.moving ? 0.14 : 0.24); L.moving = moving;
      const fast = L.spd > 2.2;
      if (L.act === 'flee') anim = 'flee';
      else if (moving) anim = fast ? 'run' : L.food && L.eatT > 0 ? 'walkeat' : L.phoneWalk && L.act === 'walk' && L.style !== 'jogger' ? 'walkphone' : 'walk';
      else anim = L.act === 'phone' ? 'phone' : L.act === 'talk' || (L.act === 'follow' && L.group && p.mode === 'idle' && L.seat === null) ? 'talk' : L.act === 'photo' ? 'film' : 'idle';
    }
    if (L.food && L.eatT > 0) L.eatT -= dt; else if (L.food && L.eatT <= 0) L.food = 0;
    p.anim = anim;
    // stats
    const st = this.stats;
    if (L.act === 'walk' || L.act === 'follow') st.walking++; else if (L.act === 'cross') st.crossing++; else if (L.act === 'waitcross') st.waiting++; else if (L.act === 'sit' || L.act === 'lawn') st.sitting++; else if (L.act === 'queue') st.queueing++;
    if (L.group && L.group.members[0] === p) this.stats.groups++;
  }
};
