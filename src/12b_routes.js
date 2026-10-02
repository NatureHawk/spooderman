/* =====================================================================================
   TRAVERSAL ROUTES — timed challenge routes through the real Lower Manhattan scan (seed MAN).
   Reuses the game's systems: CITYLINK lists the routes, the HUD prompt starts them ([E] at a start),
   the pause menu restarts / exits, SaveManager stores personal bests, hero events feed the scoring.
   TL.ROUTE_DEFS      the three routes (checkpoint gates / zones built on the actual geometry; see
                      tests/routes_test.js for the clearance + order validation and tools used to tune them)
   TL.RouteScore      bounded, diminishing bonuses: clean point launches, tricks credited only after a
                      controlled recovery, genuine near misses (speed + clearance, once per object, no
                      contact), sustained flow, variety. Completion time stays the major factor.
   TL.RouteChallenges start interaction, countdown, ordered swept checkpoints (fast movement cannot skip a
                      gate: every frame's swept segment is tested; backward / out-of-order crossings are
                      rejected), timer that only advances while playing, results, restart / exit, PBs.
   Free roam is untouched while no route is active.
   ===================================================================================== */
'use strict';

/* gate: vertical disc (normal n = travel direction) · zone: sphere · perch: zone entered in a narrow-support perch
   Built from real scan geometry and validated by autopilot runs of the actual game (see tests/routes_test.js):
   every checkpoint lies where the hero's body actually travelled, so none is inside a building, and each route
   was completed end to end through this route system. Medals: gold sits near a clean autopilot line, bronze
   allows a run with a couple of loop-backs. */
TL.ROUTE_DEFS = [
  // A — low obstacles (rail, duct, pipes on real roofs), vaults, a wall-run + roof-edge climb, stepped drops into
  //     controlled landings, and a point-launch departure through the finish gate over West Street
  {"id":"rooftop_flow","name":"Rooftop Flow","blurb":"Run the West Street rooftops: vault the roof furniture, climb the stepped tower, drop to the long roof and point-launch off the far ledge.","start":{"x":-388.5,"y":22.63,"z":-561.5,"yaw":0.69},"cps":[{"kind":"zone","x":-383.52,"y":23.45,"z":-553.84,"r":3,"surface":22.5},{"kind":"zone","x":-370.83,"y":30.53,"z":-533.87,"r":3,"surface":29.58},{"kind":"zone","x":-360.25,"y":18.97,"z":-519.12,"r":3.5,"surface":18.02},{"kind":"zone","x":-341.69,"y":19.45,"z":-539.63,"r":3,"surface":18.5},{"kind":"zone","x":-333.6,"y":19.45,"z":-553,"r":3,"surface":18.5},{"kind":"gate","x":-299.58,"y":29.85,"z":-558.2,"r":4.5,"n":[1.0,0.028]}],"medals":{"gold":20,"silver":26,"bronze":35}},
  // B — chained swings down an 8-12 m wide canyon between 40-100 m walls, two low passes (10 m, 14 m), then a
  //     90 degree corner into the westbound cross street
  {"id":"street_canyon","name":"Street Canyon","blurb":"Swing the narrow canyon south of Liberty Street: keep the momentum through low passes between 90-metre walls, then whip the corner into the westbound avenue.","start":{"x":11.8,"y":57.5,"z":44.6,"yaw":1.087},"cps":[{"kind":"gate","x":-15.1,"y":22,"z":98.9,"r":6.5,"n":[-0.411,0.912]},{"kind":"gate","x":-27.5,"y":14,"z":126.2,"r":6.5,"n":[-0.411,0.912]},{"kind":"gate","x":-49.2,"y":30,"z":171.3,"r":7,"n":[-0.411,0.912]},{"kind":"gate","x":-62.1,"y":10,"z":198.4,"r":6,"n":[-0.411,0.912]},{"kind":"gate","x":-75.8,"y":18,"z":225.0,"r":6.5,"n":[-0.411,0.912]},{"kind":"gate","x":-100.2,"y":14,"z":245.5,"r":7,"n":[-0.912,-0.411]},{"kind":"gate","x":-131.8,"y":12,"z":230.5,"r":7,"n":[-0.912,-0.411]},{"kind":"gate","x":-164.9,"y":16,"z":202.6,"r":7.5,"n":[-0.912,-0.411]}],"medals":{"gold":40,"silver":55,"bronze":75}},
  // C — accurate zips up the Rector Street setbacks (72 -> 103 m), a launch through a gate, an air trick that only
  //     counts on a controlled recovery, and a perch finish on the 105 m tower edge
  {"id":"skyline_technical","name":"Skyline Technical","blurb":"Zip up the Rector Street setbacks, time the launches, land a trick and stick a perch on the tower edge.","start":{"x":-425,"y":72,"z":-100,"yaw":0.2},"cps":[{"kind":"zone","x":-425.45,"y":103.39,"z":-98.94,"r":3,"surface":102.44},{"kind":"gate","x":-427.3,"y":109.58,"z":-79.13,"r":5,"n":[-0.092,0.996]},{"kind":"zone","x":-414.91,"y":93.74,"z":-68.3,"r":3,"surface":92.79},{"kind":"perch","x":-378.19,"y":106.69,"z":-124.18,"r":2.5,"surface":105.74}],"medals":{"gold":8,"silver":11,"bronze":16}},
];

TL.RouteScore = class {
  constructor() {
    this.cat = { launch: 0, trick: 0, near: 0, flow: 0, variety: 0 };
    this.count = { launch: 0, trick: 0, near: 0 };
    this.CAP = { launch: 500, trick: 600, near: 480, flow: 360, variety: 150 };
    this.byKind = {}; this.nearIds = new Set(); this.nearCool = 0; this.pendingTrick = null;
    this.flowT = 0; this.slowT = 0; this.events = [];
  }
  add(cat, base, label, key) {
    const n = key ? (this.byKind[key] = (this.byKind[key] || 0) + 1) - 1 : this.count[cat] || 0;
    const pts = Math.round(Math.min(base * Math.pow(0.6, n), this.CAP[cat] - this.cat[cat]));
    if (cat in this.count) this.count[cat]++;
    if (pts <= 0) return 0;
    this.cat[cat] += pts; this.events.push({ label, pts });
    if (cat !== 'variety' && this.types() >= 3 && !this.cat.variety) this.add('variety', 150, 'Variety');
    return pts;
  }
  types() { return ['launch', 'trick', 'near', 'flow'].filter((k) => this.cat[k] > 0).length; }
  get bonus() { return Object.values(this.cat).reduce((a, b) => a + b, 0); }
};

TL.RouteChallenges = class {
  constructor(game) {
    this.game = game; this.best = {}; this.active = null; this.startMarks = []; this.marks = [];
    this.defs = game.scanMode ? TL.ROUTE_DEFS.slice() : [];
    this._hit = { t: 0 }; this._cands = []; this._v = new THREE.Vector3();
    this.buildHud();
    if (this.defs.length) this.buildStartMarkers();
  }
  /* ---------------------------------------------------------------- persistence */
  serialize() { return { best: this.best }; }
  deserialize(d) { this.best = Object.assign({}, d && d.best || {}); }
  medalOf(def, t) { return t <= def.medals.gold ? 'gold' : t <= def.medals.silver ? 'silver' : t <= def.medals.bronze ? 'bronze' : null; }
  fmt(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
  /* ---------------------------------------------------------------- visuals */
  buildHud() {
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('hud'); if (!hud) return;
    const el = document.createElement('div'); el.id = 'routeHud';
    el.style = 'position:absolute;left:50%;top:14px;transform:translateX(-50%);padding:5px 14px;border-radius:6px;background:rgba(8,12,18,.55);color:#e9f4ff;font:600 14px/1.25 system-ui,sans-serif;letter-spacing:.04em;display:none;text-align:center;pointer-events:none;white-space:nowrap';
    const pop = document.createElement('div'); pop.id = 'routePop';
    pop.style = 'position:absolute;left:50%;top:52px;transform:translateX(-50%);color:#9fe8ff;font:600 13px system-ui,sans-serif;opacity:0;transition:opacity .25s;pointer-events:none;text-shadow:0 0 4px #000';
    const cd = document.createElement('div'); cd.id = 'routeCount';
    cd.style = 'position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);color:#fff;font:800 64px system-ui,sans-serif;opacity:0;pointer-events:none;text-shadow:0 0 18px rgba(64,200,255,.7)';
    hud.append(el, pop, cd); this.hud = el; this.popEl = pop; this.cdEl = cd;
  }
  popText(t) { if (!this.popEl) return; this.popEl.textContent = t; this.popEl.style.opacity = 1; clearTimeout(this._popT); this._popT = setTimeout(() => (this.popEl.style.opacity = 0), 1300); }
  ringMesh(r, color, tube) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube || 0.07, 8, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    m.renderOrder = 3; return m;
  }
  buildStartMarkers() {
    const sc = this.game.scene;
    for (const def of this.defs) {
      const g = new THREE.Group(), s = def.start;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 26, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x55d8ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 13; g.add(beam);
      const ring = this.ringMesh(1.1, 0x55d8ff, 0.05); ring.rotation.x = Math.PI / 2; ring.position.y = 0.04; g.add(ring);
      g.position.set(s.x, s.y, s.z); sc.add(g); this.startMarks.push({ def, g });
    }
  }
  buildMarkers(def) {
    this.clearMarkers();
    const sc = this.game.scene;
    def.cps.forEach((c, i) => {
      const last = i === def.cps.length - 1, color = last ? 0xffc94a : 0x55d8ff;
      let m;
      if (c.kind === 'gate') {
        m = this.ringMesh(c.r, color, 0.08);
        m.position.set(c.x, c.y, c.z); m.rotation.y = Math.atan2(c.n[0], c.n[1]);
      } else {
        m = new THREE.Group();
        const ring = this.ringMesh(c.r, color, 0.06); ring.rotation.x = Math.PI / 2; m.add(ring);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
        beam.position.y = 3; m.add(beam);
        m.position.set(c.x, c.surface !== undefined ? c.surface + 0.05 : c.y - 0.9, c.z);
      }
      sc.add(m); this.marks.push(m);
    });
    this.refreshMarkers();
  }
  refreshMarkers() {
    const A = this.active; if (!A) return;
    this.marks.forEach((m, i) => {
      m.visible = i >= A.k && i <= A.k + 1;
      const op = i === A.k ? 0.9 : 0.25;
      m.traverse((o) => { if (o.material) o.material.opacity = o.geometry && o.geometry.type === 'CylinderGeometry' ? op * 0.4 : op; });
    });
  }
  clearMarkers() { for (const m of this.marks) { this.game.scene.remove(m); m.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } this.marks = []; }
  /* ---------------------------------------------------------------- flow */
  busy() { const M = this.game.missions; return !!(M && (M.active || M.crime || M.activeActivity)); }
  begin(def) {
    const g = this.game, h = g.hero.ctrl;
    this.cleanupRun();
    const s = def.start;
    h.tether.releaseAll(); h.teleport(s.x, s.y + TL.C.FEET + 0.02, s.z); h.vel.set(0, 0, 0); h.facing = s.yaw;
    h.fsm.set(TL.TS.GROUND, 'route-start'); h.grounded = true; h.frozen = true; h.landing = null;
    if (g.hero.anim) { g.hero.anim.rel = null; g.hero.anim.trick = null; g.hero.anim.landRec = null; }
    g.rig.yaw = s.yaw + Math.PI; g.rig.pitch = -0.16; g.rig.smoothT.copy(h.pos);
    this.active = { def, phase: 'countdown', t: 0, time: 0, k: 0, warned: -1, splits: [], score: new TL.RouteScore(), prev: h.pos.clone(), lastTrick: null, offT: 0 };
    this.buildMarkers(def);
    for (const sm of this.startMarks) sm.g.visible = false;
    g.ui.setWaypoint(new THREE.Vector3(def.cps[0].x, def.cps[0].y, def.cps[0].z));
    if (this.hud) this.hud.style.display = 'block';
    g.audio.sfx('ui');
  }
  restart() { if (this.active) this.begin(this.active.def); }
  exit() {
    if (!this.active) return;
    this.cleanupRun(); this.active = null;
    if (this.hud) this.hud.style.display = 'none';
    for (const sm of this.startMarks) sm.g.visible = true;
    this.game.ui.setWaypoint(null);
  }
  /* temporary state of a run: markers, freeze, countdown overlay, pending bonuses */
  cleanupRun() {
    const g = this.game; this.clearMarkers();
    if (g.hero) g.hero.ctrl.frozen = false;
    if (this.cdEl) this.cdEl.style.opacity = 0;
    if (this.popEl) this.popEl.style.opacity = 0;
  }
  finish() {
    const A = this.active, g = this.game, def = A.def, t = A.time, sc = A.score;
    const timeScore = Math.round(5000 * def.medals.gold / Math.max(t, def.medals.gold * 0.6));   // bounded: at most ~8300
    const total = timeScore + sc.bonus, medal = this.medalOf(def, t);
    const prev = this.best[def.id], pbTime = !prev || t < prev.time, pbScore = !prev || total > prev.score;
    this.best[def.id] = { time: pbTime ? +t.toFixed(2) : prev.time, score: pbScore ? total : prev.score, medal: this.betterMedal(prev && prev.medal, medal) };
    const result = { def, t, timeScore, bonus: sc.bonus, cat: Object.assign({}, sc.cat), total, medal, pbTime, pbScore, splits: A.splits.slice() };
    this.lastResult = result;
    A.phase = 'done'; g.hero.ctrl.frozen = false;
    g.audio.sfx('reward');
    if (g.progress) g.progress.addXP(medal === 'gold' ? 300 : medal === 'silver' ? 220 : medal ? 160 : 100, def.name);
    if (g.save) g.save.save(true);
    this.showResults(result);
  }
  betterMedal(a, b) { const r = { gold: 3, silver: 2, bronze: 1 }; return (r[b] || 0) > (r[a] || 0) ? b : a || null; }
  showResults(R) {
    const ui = this.game.ui; if (!ui || !ui.openModal) return;
    const row = (k, v) => '<div class="row"><span>' + k + '</span><b>' + v + '</b></div>';
    ui.openModal(R.def.name.toUpperCase() + ' — COMPLETE', (b) => {
      const medal = R.medal ? { gold: '★★★ Gold', silver: '★★ Silver', bronze: '★ Bronze' }[R.medal] : 'No medal';
      b.innerHTML = '<p class="small">' + R.def.blurb + '</p>' +
        row('Time', this.fmt(R.t) + (R.pbTime ? '  (new best)' : '  (best ' + this.fmt(this.best[R.def.id].time) + ')')) +
        row('Medal', medal + ' · gold ' + this.fmt(R.def.medals.gold) + ' / silver ' + this.fmt(R.def.medals.silver) + ' / bronze ' + this.fmt(R.def.medals.bronze)) +
        row('Time score', R.timeScore) +
        row('Clean point launches', R.cat.launch) + row('Tricks with a controlled recovery', R.cat.trick) + row('Near misses', R.cat.near) +
        row('Sustained flow', R.cat.flow) + row('Variety', R.cat.variety) +
        row('Total', R.total + (R.pbScore ? '  (new best)' : '')) +
        '<p class="small">Bonuses are capped per kind and repeated moves earn less each time; the time score is the larger part.</p>';
      const bar = ui.el('div', { class: 'grid' });
      bar.appendChild(ui.btn('Restart', () => { ui.closeModal(); this.restart(); }));
      bar.appendChild(ui.btn('Exit route', () => { ui.closeModal(); this.exit(); }));
      b.appendChild(bar);
    }, { back: () => { this.exit(); this.game.pause(false); } });
  }
  /* ---------------------------------------------------------------- per frame (called only while playing) */
  update(dt) {
    const g = this.game; if (!this.defs.length || !g.hero) return;
    const h = g.hero.ctrl;
    if (!this.active) {
      if (this.busy()) return;
      for (const sm of this.startMarks) {
        const s = sm.def.start;
        if (Math.abs(h.pos.x - s.x) + Math.abs(h.pos.z - s.z) > 12 || Math.abs(h.pos.y - TL.C.FEET - s.y) > 3) continue;
        if (Math.hypot(h.pos.x - s.x, h.pos.z - s.z) > 4.5) continue;
        const b = this.best[sm.def.id];
        g.ui.prompt('[E] Start route: ' + sm.def.name + (b ? '  ·  best ' + this.fmt(b.time) : ''));
        if (g.input.consume('interact')) this.begin(sm.def);
        break;
      }
      return;
    }
    const A = this.active, def = A.def;
    if (A.phase === 'done') return;
    if (g.input.consume('routeRestart')) { this.restart(); return; }
    if (A.phase === 'countdown') {
      A.t += dt; h.frozen = true;
      const n = 3 - Math.floor(A.t);
      if (this.cdEl) { this.cdEl.textContent = n > 0 ? String(n) : 'GO'; this.cdEl.style.opacity = A.t < 3.6 ? 1 - Math.max(0, A.t - 3) / 0.6 : 0; }
      if (A.t >= 3) { A.phase = 'run'; h.frozen = false; A.prev.copy(h.pos); g.audio.sfx('perfect'); }
      this.drawHud();
      return;
    }
    if (this.cdEl && A.t < 3.7) { A.t += dt; this.cdEl.style.opacity = Math.max(0, 1 - (A.t - 3) / 0.6); }
    A.time += dt;
    this.scoreFrame(dt, h);
    // swept checkpoint tests on this frame's motion segment
    const p0 = A.prev, p1 = h.pos;
    for (let guard = 0; guard < 3 && A.k < def.cps.length; guard++) {
      const c = def.cps[A.k], r = this.crossing(c, p0, p1, h);
      if (r === 'pass') {
        A.k++; A.warned = -1; A.splits.push(+A.time.toFixed(2)); g.audio.sfx('perfect'); this.refreshMarkers();
        if (A.k >= def.cps.length) { A.prev.copy(p1); this.finish(); return; }
        const n = def.cps[A.k]; g.ui.setWaypoint(new THREE.Vector3(n.x, n.y, n.z));
        continue;
      }
      if (r === 'miss' && A.warned !== A.k) { A.warned = A.k; g.ui.hint('Missed checkpoint ' + (A.k + 1) + ' — turn back through the marker'); }
      break;
    }
    // a later checkpoint crossed first never counts (order is fixed); say so once
    for (let j = A.k + 1; j < def.cps.length; j++) if (this.crossing(def.cps[j], p0, p1, h) === 'pass' && A.warned !== 100 + A.k) { A.warned = 100 + A.k; g.ui.hint('Checkpoint ' + (A.k + 1) + ' first'); }
    A.prev.copy(p1);
    this.drawHud();
  }
  /* 'pass' | 'miss' (crossed the gate plane outside the ring, close by) | null */
  crossing(c, p0, p1, h) {
    if (c.kind === 'gate') {
      const nx = c.n[0], nz = c.n[1];
      const s0 = (p0.x - c.x) * nx + (p0.z - c.z) * nz, s1 = (p1.x - c.x) * nx + (p1.z - c.z) * nz;
      if (!(s0 < 0 && s1 >= 0)) return null;                    // backward or no crossing: rejected
      const t = s0 / (s0 - s1), x = p0.x + (p1.x - p0.x) * t, y = p0.y + (p1.y - p0.y) * t, z = p0.z + (p1.z - p0.z) * t;
      const d = Math.hypot(x - c.x, y - c.y, z - c.z);
      return d <= c.r ? 'pass' : d < c.r * 4 ? 'miss' : null;
    }
    // zones: closest distance from the swept segment to the centre
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z, L2 = dx * dx + dy * dy + dz * dz;
    const t = L2 > 1e-9 ? TL.clamp(((c.x - p0.x) * dx + (c.y - p0.y) * dy + (c.z - p0.z) * dz) / L2, 0, 1) : 0;
    const d = Math.hypot(p0.x + dx * t - c.x, p0.y + dy * t - c.y, p0.z + dz * t - c.z);
    if (d > c.r) return null;
    if (c.kind === 'perch') return h.state === TL.TS.PERCH ? 'pass' : null;
    return 'pass';
  }
  drawHud() {
    const A = this.active; if (!this.hud || !A) return;
    const b = this.best[A.def.id];
    this.hud.textContent = A.def.name.toUpperCase() + '   ' + this.fmt(A.time) + '   ' + Math.min(A.k + (A.phase === 'run' ? 0 : 0), A.def.cps.length) + '/' + A.def.cps.length + '   ★ ' + this.fmt(A.def.medals.gold) + (b ? '   best ' + this.fmt(b.time) : '');
  }
  /* ---------------------------------------------------------------- bonuses */
  onHeroEvent(hero, e, a, b) {
    const A = this.active; if (!A || A.phase !== 'run') return;
    const S = A.score;
    switch (e) {
      case 'launchboost': { const p = S.add('launch', a && a.perfect ? 200 : 120, a && a.perfect ? 'Clean point launch' : 'Point launch'); if (p) this.popText('+' + p + ' ' + (a && a.perfect ? 'Clean point launch' : 'Point launch')); break; }
      case 'attach': case 'wall': case 'pointcatch': case 'land': this.resolveTrick(hero, e, b); break;
      case 'hardland': case 'splash': case 'wallimpact': if (S.pendingTrick) { S.pendingTrick = null; this.popText('Trick lost — uncontrolled landing'); } break;
    }
  }
  resolveTrick(hero, e, L) {
    const S = this.active.score, T = S.pendingTrick; if (!T) return;
    // a trick only counts once the hero has recovered into a controlled state (no heavy landing)
    if (e === 'land' && L && L.kind === 'heavy') { S.pendingTrick = null; return; }
    S.pendingTrick = null;
    const p = S.add('trick', 120, 'Trick: ' + T, 'trick:' + T);
    if (p) this.popText('+' + p + ' ' + T + ' (landed)');
  }
  scoreFrame(dt, h) {
    const g = this.game, S = this.active.score, an = g.hero.anim, sp = h.vel.length(), st = h.state, T = TL.TS;
    // trick start (from the combat trick input); credited later on a controlled recovery
    if (an && an.trick && an.trick !== S.lastTrick) S.pendingTrick = an.trick;
    S.lastTrick = an ? an.trick : null;
    // sustained flow: speed carried without stalling
    if (sp > 15 && st !== T.PERCH) { S.flowAcc = (S.flowAcc || 0) + dt; if (S.flowAcc >= 1) { S.flowAcc -= 1; S.add('flow', 12, null); } }
    // near misses: fast, airborne, genuinely close to a surface without touching it; once per object
    S.nearCool -= dt;
    const air = st === T.AIR || st === T.SWING || st === T.DIVE || st === T.GLIDE;
    if (!air || sp < 18) { S.nearCand = null; return; }
    if (h.nContacts > 0) { for (let i = 0; i < h.nContacts; i++) { const c = h.contacts[i].col; if (c) S.nearIds.add(c.id); } S.nearCand = null; return; }
    if ((S.nk = (S.nk || 0) + 1) % 3) return;
    const P = h.pos, cands = g.world.query(P.x - 2.2, P.z - 2.2, P.x + 2.2, P.z + 2.2, this._cands);
    let best = null, bd = 1.7;
    for (const c of cands) {
      if (!c.solid || c.dynamic || S.nearIds.has(c.id)) continue;
      const q = g.world.closest(c, P.x, P.y, P.z, this._v), d = q.distanceTo(P) - 0.42;
      if (d > 0.12 && d < bd) { bd = d; best = c; }
    }
    if (best) S.nearCand = { id: best.id, d: bd };
    else if (S.nearCand) {
      // cleared the surface without contact
      const id = S.nearCand.id; S.nearCand = null;
      if (!S.nearIds.has(id) && S.nearCool <= 0) { S.nearIds.add(id); S.nearCool = 0.7; const p = S.add('near', 60, 'Near miss'); if (p) this.popText('+' + p + ' Near miss'); }
    }
  }
};
