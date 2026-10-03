/* =====================================================================================
   PROGRESSION + MISSIONS + CRIMES + ACTIVITIES
   Progression    — XP/levels, upgrade points, City Trust per district, 3 skill trees, gadget upgrades,
                    outfit unlocks, style meter, stats.
   MissionManager — story missions built from objective primitives, IncidentDirector (dynamic crimes
                    with variations/optional goals/rewards), activities, waypoints, CITYLINK feed,
                    world objects (markers, tetherable props, relays, rings, civilians to carry).
   ===================================================================================== */
'use strict';

TL.SKILLS = {
  traversal: [
    { id: 't_pump', name: 'Swing Momentum', desc: 'Pumping builds 20% more speed.', cost: 1 },
    { id: 't_aero', name: 'Aerodynamics', desc: 'Membrane lift +12%, less stall.', cost: 1 },
    { id: 't_launch', name: 'Launch Timing', desc: 'Point-launch boost +15%, wider timing window.', cost: 1 },
    { id: 't_wall', name: 'Wall Sprint', desc: 'Wall runs last 40% longer.', cost: 2 },
    { id: 't_trick', name: 'Air Tricks', desc: 'Tricks earn 50% more style.', cost: 1 },
    { id: 't_line', name: 'Line Speed', desc: 'Faster line travel and reeling (+25%).', cost: 2 },
  ],
  WEAVER: [
    { id: 'w_slam', name: 'Heavy Anchor', desc: 'Vector Slam damage +30%.', cost: 1 },
    { id: 'w_sweep', name: 'Wide Sweep', desc: 'Tension Sweep radius +40%.', cost: 1 },
    { id: 'w_bind', name: 'Quad Bind', desc: 'Multi-Bind restrains one extra target.', cost: 2 },
    { id: 'w_lattice', name: 'Hardened Lattice', desc: 'Defensive Lattice lasts 50% longer.', cost: 1 },
    { id: 'w_throw', name: 'Structural Mastery', desc: 'Thrown objects deal +40% damage.', cost: 1 },
    { id: 'w_ult', name: 'Zero-Slack Plus', desc: 'Ultimate duration +3 s.', cost: 2 },
  ],
  PULSE: [
    { id: 'p_chain', name: 'Arc Chain', desc: 'Chain Discharge jumps to one more target.', cost: 1 },
    { id: 'p_cap', name: 'Capacitor', desc: 'Ability charge builds 25% faster.', cost: 1 },
    { id: 'p_ion', name: 'Ion Step', desc: 'Ion Dash cooldown -35%.', cost: 1 },
    { id: 'p_mag', name: 'Magnet Field', desc: 'Magnetic Pull radius +50%.', cost: 2 },
    { id: 'p_tether', name: 'Overcharge Tether', desc: 'Charged Tether stuns longer.', cost: 1 },
    { id: 'p_ult', name: 'Resonance+', desc: 'Resonance Cascade radius +40%.', cost: 2 },
  ],
};

TL.Progression = class {
  constructor(game) {
    this.game = game;
    this.xp = 0; this.spent = 0; this.skills = new Set(); this.trust = { core: 40, brooklyn: 35, queens: 30 };
    this.gadgetLv = { adhesive: 1, node: 1, lift: 1, mine: 1, decoy: 0, dart: 0 };
    this.unlocked = { WEAVER: [0], PULSE: [0] };
    this.styleMeter = 0; this.styleText = ''; this.styleT = 0; this.combo = 0;
    this.stats = { swings: 0, crimes: 0, takedowns: 0, photos: 0, distance: 0, caches: 0 };
    this.lastPos = null;
  }
  get level() { return Math.floor(Math.sqrt(this.xp / 120)) + 1; }
  get points() { return (this.level - 1) * 2 + 1 - this.spent; }
  addXP(n, why) {
    const before = this.level; this.xp += Math.round(n);
    this.game.ui.xpToast(Math.round(n), why);
    if (this.level > before) { this.game.ui.toast('LEVEL ' + this.level + ' — upgrade points available'); this.game.audio.sfx('reward'); this.checkUnlocks(); }
  }
  checkUnlocks() {
    for (const h of ['WEAVER', 'PULSE']) for (let o = 1; o < 4; o++) if (this.level >= o * 3 && this.unlocked[h].indexOf(o) < 0) { this.unlocked[h].push(o); this.game.ui.toast('Outfit unlocked: ' + TL.Outfits.defs[h][o].name); }
  }
  has(id) { return this.skills.has(id); }
  buy(id) {
    const all = [].concat(TL.SKILLS.traversal, TL.SKILLS.WEAVER, TL.SKILLS.PULSE);
    const s = all.find((x) => x.id === id); if (!s || this.skills.has(id) || this.points < s.cost) return false;
    this.skills.add(id); this.spent += s.cost; this.applySkills(); this.game.audio.sfx('reward'); return true;
  }
  upgradeGadget(k) {
    const cost = this.gadgetLv[k] + 1;
    if (this.gadgetLv[k] >= 3 || this.points < cost) return false;
    this.gadgetLv[k]++; this.spent += cost; this.game.audio.sfx('reward');
    if (this.game.combat) this.game.combat.refreshGadgets();
    return true;
  }
  applySkills() {
    for (const n of ['WEAVER', 'PULSE']) {
      const base = TL.HERO_STATS[n], s = Object.assign({}, base);
      if (this.has('t_pump')) s.pump *= 1.2;
      if (this.has('t_aero')) s.glide *= 1.12;
      if (this.has('t_launch')) s.launch *= 1.15;
      if (this.has('t_wall')) s.wallTime *= 1.4;
      if (this.has('t_line')) s.reel *= 1.25;
      const h = this.game.heroes[n]; if (h) h.ctrl.setStats(s);
    }
    if (this.game.heroes.WEAVER) this.game.heroes.WEAVER.ctrl.tether.SHOT_SPEED = this.has('t_line') ? 400 : 320;
  }
  changeTrust(district, d) {
    if (!(district in this.trust)) return;
    this.trust[district] = TL.clamp(this.trust[district] + d, 0, 100);
  }
  trustAt(p) { const d = this.game.layout.district(p.x, p.z); return this.trust[d] !== undefined ? this.trust[d] : 50; }
  style(n, text) {
    const mul = this.has('t_trick') && /trick|flip|screw|roll/i.test(text || '') ? 1.5 : 1;
    this.styleMeter = Math.min(999, this.styleMeter + n * mul); this.styleText = text || ''; this.styleT = 2.5;
    if (text) this.game.ui.styleBlip(text, Math.round(n * mul));
  }
  stat(k, n) { this.stats[k] = (this.stats[k] || 0) + (n || 1); }
  update(dt) {
    this.styleT -= dt;
    if (this.styleT <= 0 && this.styleMeter > 0) {
      if (this.styleMeter > 30) this.addXP(this.styleMeter * 0.25, 'Style');
      this.styleMeter = 0;
    }
    const h = this.game.hero; if (h) { if (this.lastPos) this.stats.distance += Math.min(50, h.ctrl.pos.distanceTo(this.lastPos)); this.lastPos = (this.lastPos || new THREE.Vector3()).copy(h.ctrl.pos); }
    this.game.save.update(dt);
  }
  serialize() { return { xp: this.xp, spent: this.spent, skills: [...this.skills], trust: this.trust, gadgetLv: this.gadgetLv, unlocked: this.unlocked, stats: this.stats }; }
  deserialize(d) { Object.assign(this, { xp: d.xp || 0, spent: d.spent || 0, trust: d.trust || this.trust, gadgetLv: d.gadgetLv || this.gadgetLv, unlocked: d.unlocked || this.unlocked, stats: Object.assign(this.stats, d.stats || {}) }); this.skills = new Set(d.skills || []); this.applySkills(); }
};

/* ------------------------------------------------------------------ world objects used by objectives */
TL.MissionObjects = class {
  constructor(game) { this.game = game; this.list = []; this.scene = game.scene; }
  marker(p, color, h) {
    const g = new THREE.CylinderGeometry(0.6, 0.6, h || 60, 12, 1, true);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: color || 0x40e0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(p.x, p.y + (h || 60) / 2, p.z); this.scene.add(m);
    const o = { kind: 'marker', mesh: m, p: p.clone() }; this.list.push(o); return o;
  }
  ring(p, yaw, r) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r || 5, 0.35, 8, 36), new THREE.MeshStandardMaterial({ color: 0x40e0ff, emissive: 0x40e0ff, emissiveIntensity: 1.2 }));
    m.position.copy(p); m.rotation.y = yaw || 0; this.scene.add(m);
    const o = { kind: 'ring', mesh: m, p: p.clone(), r: r || 5, passed: false }; this.list.push(o); return o;
  }
  /* tetherable object: a real collider (dynamic) + mesh; objective checks rope.col === obj.col */
  beam(p, len, tag) {
    const W = this.game.world;
    const m = TL.Assets.mesh('P_pipe_piece', TL.Assets.pickLod('P_pipe_piece', this.game.quality), TL.Assets.shared('world'));
    if (m) { m.position.copy(p); m.scale.set(len / 3, 2, 2); this.scene.add(m); }
    const col = W.addDynamic(p.x, p.y + 0.36, p.z, len / 2, 0.4, 0.4, 0, { kind: 'objective', mass: 2000, anchor: true, tag });
    const o = { kind: 'beam', mesh: m, col, p: p.clone(), tag, secured: false, sway: Math.random() * 6, lines: [] }; this.list.push(o); return o;
  }
  node(p, label) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.8), new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.5, roughness: 0.5 }));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff4020, emissive: 0xff4020, emissiveIntensity: 1.5 }));
    lamp.position.y = 1.0; base.position.y = 0.8; g.add(base); g.add(lamp); g.position.copy(p); this.scene.add(g);
    const o = { kind: 'node', mesh: g, lamp, p: p.clone(), label, done: false, state: 0 }; this.list.push(o); return o;
  }
  setNode(o, on, color) { o.done = on; o.lamp.material.color.set(color || (on ? 0x40ff80 : 0xff4020)); o.lamp.material.emissive.set(color || (on ? 0x40ff80 : 0xff4020)); }
  item(p, color) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshStandardMaterial({ color: color || 0xffc040, emissive: color || 0xffc040, emissiveIntensity: 1 }));
    m.position.copy(p); this.scene.add(m);
    const o = { kind: 'item', mesh: m, p: p.clone(), taken: false }; this.list.push(o); return o;
  }
  remove(o) { if (!o) return; if (o.mesh) this.scene.remove(o.mesh); if (o.col) this.game.world.removeDynamic(o.col); for (const l of o.lines || []) this.scene.remove(l); const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1); }
  clear() { for (const o of this.list.slice()) this.remove(o); }
  update(dt, t) {
    for (const o of this.list) {
      if (o.kind === 'marker') o.mesh.material.opacity = 0.18 + 0.08 * Math.sin(t * 3);
      if (o.kind === 'item' || o.kind === 'ring') o.mesh.rotation.y += dt * (o.kind === 'item' ? 2 : 0.3);
      if (o.kind === 'beam' && !o.secured) {
        // failing structural piece sways (moving anchor)
        o.sway += dt;
        const x = o.p.x + Math.sin(o.sway * 1.3) * 0.8, y = o.p.y - Math.abs(Math.sin(o.sway * 0.9)) * 0.6;
        if (o.mesh) { o.mesh.position.set(x, y, o.p.z); o.mesh.rotation.z = Math.sin(o.sway) * 0.15; }
        this.game.world.moveDynamic(o.col, x, y + 0.36, o.p.z, 0, dt);
      }
    }
  }
};

/* ------------------------------------------------------------------ objective primitives */
TL.OBJ = {
  goto: (p, r, text) => ({ type: 'goto', p, r: r || 8, text }),
  defeat: (spawn, text) => ({ type: 'defeat', spawn, text }),
  tether: (beams, text) => ({ type: 'tether', beams, text }),
  interact: (nodes, text) => ({ type: 'interact', nodes, text }),
  switchHero: (to, text) => ({ type: 'switch', to, text }),
  chase: (route, dur, text) => ({ type: 'chase', route, dur, text }),
  rescue: (pts, safe, text) => ({ type: 'rescue', pts, safe, text }),
  rings: (pts, dur, text) => ({ type: 'rings', pts, dur, text }),
  stopVehicle: (kind, text) => ({ type: 'stopveh', kind, text }),
  stealth: (spawn, text) => ({ type: 'stealth', spawn, text }),
  bridge: (text) => ({ type: 'tensionbridge', text }),
  puzzle: (nodes, pattern, text) => ({ type: 'puzzle', nodes, pattern, text }),
  boss: (phase, text) => ({ type: 'boss', phase, text }),
  photo: (p, text) => ({ type: 'photo', p, text }),
  scanAt: (pts, text) => ({ type: 'scanat', pts, text }),
  holdTether: (secs, text) => ({ type: 'holdtether', secs, text }),
  wait: (secs, text) => ({ type: 'wait', secs, text }),
};

TL.MissionManager = class {
  constructor(game) {
    this.game = game;
    this.objs = new TL.MissionObjects(game);
    this.active = null;             // {id, title, steps, i, stepState}
    this.completed = new Set();
    this.crimesDone = 0; this.crime = null; this.crimeT = 45;
    this.activities = []; this.activityDone = new Set();
    this.caches = []; this.cacheFound = new Set();
    this.feed = [];                 // CITYLINK entries
    this.t = 0;
    this.checkpoint = null;
    this.buildMissionDefs();
    this.buildActivities();
    this.pushFeed('CITYLINK online. Story: BRIDGE UNDER LOAD is available at the Tension Bridge.', 'story');
  }
  L() { return this.game.layout; }
  /* ---------------------------------------------------------------- story missions */
  buildMissionDefs() {
    const L = this.L(), O = TL.OBJ, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const bz = L.bridgeZ;
    const camp = L.blockCenter(L.special.campus.i, L.special.campus.j);
    const wh = L.blockCenter(L.special.warehouse.i, L.special.warehouse.j);
    const ws = L.blockCenter(L.special.wardenSite.i, L.special.wardenSite.j);
    const tall = L.blockCenter(L.special.tallest.i, L.special.tallest.j);
    this.defs = {
      m1: { id: 'm1', title: 'BRIDGE UNDER LOAD', start: V(150, 2, bz), district: 'river', reward: 900, unlock: 'm2',
        brief: 'Meridian saboteurs are cutting the Tension Bridge supports during rush hour.',
        steps: () => [
          O.goto(V(200, 30, bz - 16), 12, 'Swing to the west tower of the Tension Bridge'),
          O.goto(V(240, 4, bz), 14, 'Swing through traffic to midspan'),
          O.tether([V(222, -4.2, bz - 14.5), V(246, -4.2, bz + 14.5), V(262, -4.2, bz - 14.5)], 'Stabilize the failing deck sections — tether each (Shift toward the glowing beams)'),
          O.defeat({ at: V(250, 1.2, bz), types: ['enforcer', 'enforcer', 'shield', 'pursuer', 'enforcer'] }, 'Defeat the Meridian crew on the deck'),
          O.switchHero('PULSE', 'Switch to PULSE [V] — she is at the east tower'),
          O.interact([V(282, 1.2, bz - 11), V(282, 1.2, bz + 11)], 'Restore power to the tower junctions [E]'),
          O.chase([V(290, 30, bz), V(360, 38, bz - 60), V(430, 40, bz - 150), V(480, 45, bz - 260), V(520, 42, bz - 360)], 70, 'Catch the carrier drone before it escapes'),
          O.rescue([V(230, 1, bz + 8), V(255, 1, bz - 8), V(270, 1, bz + 6)], V(335, 1, bz), 'Carry 3 stranded civilians to the east approach [E]'),
        ] },
      m2: { id: 'm2', title: 'SILENT FREQUENCY', start: V(camp.x, 1, camp.z - 45), district: 'queens', reward: 1100, unlock: 'm3',
        brief: 'Meridian is stealing a resonance emitter from the Lumen Research Campus. Get in quietly.',
        steps: () => [
          O.goto(V(camp.x - 14, 44, camp.z - 12), 10, 'Perch on the campus roof unseen'),
          O.stealth({ at: V(camp.x + 14, 35, camp.z + 12), types: ['enforcer', 'marksman', 'enforcer', 'operator'], roof: true }, 'Take down the rooftop guards without raising the alarm (stealth)'),
          O.bridge('Create a Tension Bridge between two points [X while perched] and perch on it'),
          O.puzzle([V(camp.x - 24, 44.2, camp.z - 20), V(camp.x - 4, 44.2, camp.z - 20), V(camp.x - 14, 44.2, camp.z - 2)], [2, 1, 3], 'Security puzzle: align the three relays [E] (match the pattern shown)'),
          O.defeat({ at: V(wh.x, 1, wh.z), types: ['heavy', 'marksman', 'pursuer', 'enforcer', 'shield'], interior: true }, 'Fight through the warehouse interior'),
          O.stopVehicle('van', 'Industrial chase: stop the getaway van (tether it and hold)'),
        ] },
      m3: { id: 'm3', title: 'CITY IN RESONANCE', start: V(ws.x + 60, 1, ws.z), district: 'core', reward: 1600, unlock: null,
        brief: 'Rainy night. THE WARDEN has blacked out the core with a resonance weapon.',
        weather: 'rain', night: true, blackout: { x: ws.x, z: ws.z, r: 420 },
        steps: () => [
          O.rescue([V(ws.x + 40, 1, ws.z + 40), V(ws.x - 40, 1, ws.z + 45), V(ws.x + 45, 1, ws.z - 40)], V(ws.x + 90, 1, ws.z + 90), 'Evacuate trapped civilians to the shelter [E]'),
          O.rings([V(ws.x + 20, 40, ws.z + 60), V(ws.x - 30, 55, ws.z + 10), V(tall.x + 40, 70, tall.z + 60), V(tall.x + 10, 90, tall.z + 25)], 90, 'Ride the unstable wind routes — glide through the rings'),
          O.defeat({ at: V(tall.x, 301, tall.z), types: ['captain', 'enforcer', 'operator', 'shield', 'drone', 'drone'], roof: true }, 'Rooftop battle atop the Meridian Spire'),
          O.stopVehicle('bus', 'A runaway bus! Tether it and hold until it stops'),
          O.goto(V(ws.x, 1, ws.z + 22), 8, 'Enter the construction site underpass'),
          O.boss(1, 'THE WARDEN — Phase 1: street combat (parry the swipes, dodge the slams)'),
          O.boss(2, 'Phase 2: chase THE WARDEN up the skyscraper exterior'),
          O.boss(3, 'Phase 3: crane fight — tether the swinging hooks into its core'),
        ] },
    };
  }
  available() { return Object.values(this.defs).filter((d) => !this.completed.has(d.id) && (d.id === 'm1' || this.completed.has(Object.values(this.defs).find((x) => x.unlock === d.id).id))); }
  startMission(id) {
    if (this.game.routes && this.game.routes.active || this.game.encounters && this.game.encounters.active) return false;
    const d = this.defs[id]; if (!d || this.active) return false;
    if(this.game.cityLife)this.game.cityLife.cleanupIncident('abandoned');
    this.endCrime(false, true);
    this.active = { id, def: d, steps: d.steps(), i: 0, st: null, t: 0 };
    this.game.ui.missionBanner(d.title, d.brief);
    if (d.weather) this.game.env.forced = d.weather;
    if (d.night) this.game.env.hour = 22;
    if (d.blackout) { const U = this.game.streamer.mats.uniforms.uBlackout.value; U.set(d.blackout.x, d.blackout.z, 1, d.blackout.r); }
    this.beginStep();
    this.pushFeed('Mission started: ' + d.title, 'story');
    return true;
  }
  failMission(reason) {
    const A = this.active; if (!A) return;
    this.game.ui.toast('Mission setback: ' + reason + ' — retrying from checkpoint');
    this.cleanupStep(); this.beginStep();
  }
  abandonMission() {
    const A = this.active; if (!A) return;
    this.cleanupStep(); this.active = null; this.game.env.forced = null; this.game.streamer.mats.uniforms.uBlackout.value.z = 0;
    this.game.ui.setObjective(''); this.game.ui.setWaypoint(null);
  }
  completeMission() {
    const A = this.active; this.completed.add(A.id);
    this.game.progress.addXP(A.def.reward, A.def.title);
    this.game.progress.changeTrust(A.def.district === 'river' ? 'core' : A.def.district, 15);
    this.game.ui.missionComplete(A.def.title, A.def.reward);
    this.game.audio.sfx('reward');
    this.cleanupStep();
    if (A.def.weather) this.game.env.forced = null;
    this.game.streamer.mats.uniforms.uBlackout.value.z = 0;
    this.active = null;
    this.game.ui.setObjective(''); this.game.ui.setWaypoint(null);
    this.pushFeed('Mission complete: ' + A.def.title, 'story');
    if (A.def.unlock) this.pushFeed('New story mission: ' + this.defs[A.def.unlock].title, 'story');
    this.game.save.save(true);
  }
  beginStep() {
    const A = this.active, s = A.steps[A.i], g = this.game, O = this.objs;
    A.st = { t: 0 };
    this.checkpoint = { mission: A.id, step: A.i };
    g.ui.setObjective(s.text);
    const st = A.st;
    switch (s.type) {
      case 'goto': st.m = O.marker(s.p); g.ui.setWaypoint(s.p); break;
      case 'defeat': case 'stealth':
        st.group = g.ai.spawnGroup(s.spawn.types, s.spawn.at, { roof: s.spawn.roof, interior: s.spawn.interior, stealth: s.type === 'stealth', mission: true });
        g.ui.setWaypoint(s.spawn.at); break;
      case 'tether': st.beams = s.beams.map((p, k) => O.beam(p, 7, 'beam' + k)); g.ui.setWaypoint(s.beams[0]); break;
      case 'interact': case 'puzzle':
        st.nodes = s.nodes.map((p, k) => O.node(p, 'node' + k));
        if (s.type === 'puzzle') { st.nodes.forEach((n) => { n.state = 0; O.setNode(n, false, 0x8080ff); }); g.ui.hint('Target pattern: ' + s.pattern.map((v) => '◆'.repeat(v)).join('  ')); }
        g.ui.setWaypoint(s.nodes[0]); break;
      case 'switch': if (s.to === 'PULSE') g.heroes.PULSE.ctrl.teleport(305, 2, g.layout.bridgeZ + 8); break;
      case 'chase': st.drone = g.ai.spawnCarrierDrone(s.route); st.timer = s.dur; break;
      case 'rescue': st.civs = s.pts.map((p) => g.crowd.spawnVictim(p)); st.safe = O.marker(s.safe, 0x40ff80, 30); st.saved = 0; g.ui.setWaypoint(s.pts[0]); break;
      case 'rings': st.rings = s.pts.map((p, k) => O.ring(p, 0.5 * k, 7)); st.timer = s.dur; st.k = 0; g.ui.setWaypoint(s.pts[0]); break;
      case 'stopveh': st.veh = g.traffic.spawnRunaway(s.kind, g.hero.ctrl.pos); g.ui.setWaypoint(null); break;
      case 'tensionbridge': st.done = false; break;
      case 'boss': st.boss = g.ai.startBoss(s.phase); break;
      case 'wait': st.timer = s.secs; break;
    }
  }
  cleanupStep() {
    const A = this.active; if (!A || !A.st) return;
    const st = A.st, O = this.objs, g = this.game;
    if (st.m) O.remove(st.m);
    if (st.beams) for (const b of st.beams) O.remove(b);
    if (st.nodes) for (const n of st.nodes) O.remove(n);
    if (st.rings) for (const r of st.rings) O.remove(r);
    if (st.safe) O.remove(st.safe);
    if (st.group !== undefined) g.ai.despawnGroup(st.group);
    if (st.drone) g.ai.despawnDrone(st.drone);
    if (st.civs) for (const c of st.civs) g.crowd.removeVictim(c);
    if (st.veh) g.traffic.releaseRunaway(st.veh);
    if (st.boss) g.ai.endBoss();
    A.st = null;
  }
  nextStep() {
    const A = this.active;
    this.cleanupStep();
    A.i++;
    this.game.audio.sfx('ui');
    if (A.i >= A.steps.length) { this.completeMission(); return; }
    this.game.progress.addXP(60, 'Objective');
    this.beginStep();
  }
  /* ---------------------------------------------------------------- per-frame evaluation */
  update(dt) {
    this.t += dt;
    const g = this.game;
    this.objs.update(dt, this.t);
    if (g.routes && g.routes.active || g.encounters && g.encounters.active) return;
    if (this.active) this.updateStep(dt);
    else this.updateCrimes(dt);
    this.updateActivities(dt);
    // start missions by entering their start marker
    if (!this.active) for (const d of this.available()) {
      if (g.hero.ctrl.pos.distanceTo(d.start) < 10) { this.startMission(d.id); break; }
    }
  }
  heroNear(p, r) { return this.game.hero.ctrl.pos.distanceTo(p) < r; }
  interactPressed() { return this.game.input.consume('interact'); }
  updateStep(dt) {
    const A = this.active, s = A.steps[A.i], st = A.st, g = this.game, h = g.hero.ctrl;
    if (!st) return;
    st.t += dt;
    switch (s.type) {
      case 'goto': if (this.heroNear(s.p, s.r)) this.nextStep(); break;
      case 'defeat': case 'stealth':
        if (s.type === 'stealth' && g.ai.groupAlerted(st.group)) { this.failMission('the guards raised the alarm'); return; }
        if (g.ai.groupDefeated(st.group)) this.nextStep();
        break;
      case 'tether': {
        for (const b of st.beams) {
          if (b.secured) continue;
          for (const r of h.tether.ropes) if (r.attached && r.col === b.col) {
            b.secured = true;
            // leave a visible stabilizing line from the beam up to the deck railing
            const line = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), new THREE.MeshStandardMaterial({ color: 0xd8c8a0, emissive: 0x806030 }));
            const top = new THREE.Vector3(b.p.x, 1.2, b.p.z + (b.p.z > g.layout.bridgeZ ? -1.5 : 1.5));
            line.position.copy(top).add(b.p).multiplyScalar(0.5); line.scale.y = top.distanceTo(b.p); line.lookAt(top); line.rotateX(Math.PI / 2);
            g.scene.add(line); b.lines.push(line);
            g.world.moveDynamic(b.col, b.p.x, b.p.y + 0.36, b.p.z, 0, dt);
            g.progress.style(20, 'Section secured'); g.audio.sfx('clank');
          }
        }
        const left = st.beams.filter((b) => !b.secured);
        if (!left.length) this.nextStep(); else g.ui.setWaypoint(left[0].p);
        break;
      }
      case 'interact': case 'puzzle': {
        for (const n of st.nodes) {
          if (!this.heroNear(n.p, 3.5)) continue;
          g.ui.prompt('[E] ' + (s.type === 'puzzle' ? 'Rotate relay' : 'Restore junction'));
          if (this.interactPressed()) {
            if (s.type === 'interact') { this.objs.setNode(n, true); g.audio.sfx('zap'); }
            else { n.state = (n.state % 4) + 1; this.objs.setNode(n, n.state === s.pattern[st.nodes.indexOf(n)], [0x8080ff, 0xff8040, 0xffe040, 0x40ff80, 0x40e0ff][n.state]); g.audio.sfx('clank'); g.ui.hint('Relay ' + (st.nodes.indexOf(n) + 1) + ': ' + '◆'.repeat(n.state)); }
          }
        }
        const done = s.type === 'interact' ? st.nodes.every((n) => n.done) : st.nodes.every((n, k) => n.state === s.pattern[k]);
        if (s.type === 'puzzle' && g.settings.puzzleHints && st.t > 45 && !st.hinted) { st.hinted = true; g.ui.hint('Hint: press [E] on each relay until its diamonds match the pattern. (Accessibility: puzzle skip in Pause > Accessibility)'); }
        if (done) this.nextStep();
        else { const n = st.nodes.find((n) => (s.type === 'interact' ? !n.done : true)); if (n) g.ui.setWaypoint(n.p); }
        break;
      }
      case 'switch': if (g.heroName === s.to) this.nextStep(); break;
      case 'chase': {
        st.timer -= dt;
        const d = st.drone;
        g.ui.setObjective(s.text + '  ' + Math.ceil(st.timer) + 's');
        if (d) g.ui.setWaypoint(d.pos);
        if (d && d.caught) { g.progress.style(50, 'Drone caught'); this.nextStep(); }
        else if (st.timer <= 0 || (d && d.escaped)) this.failMission('the drone escaped');
        break;
      }
      case 'rescue': {
        for (const c of st.civs) if (!c.saved && !c.carried && this.heroNear(c.pos, 3)) { g.ui.prompt('[E] Pick up civilian'); if (this.interactPressed() && !st.carrying) { c.carried = true; st.carrying = c; g.audio.sfx('ui'); } }
        if (st.carrying) {
          const c = st.carrying; c.pos.copy(h.pos).add(new THREE.Vector3(0, 0.3, 0));
          g.ui.setWaypoint(s.safe);
          if (h.pos.distanceTo(s.safe) < 9 && h.grounded) { c.carried = false; c.saved = true; st.carrying = null; st.saved++; g.crowd.victimSaved(c, s.safe); g.progress.style(25, 'Civilian saved'); g.audio.sfx('reward'); }
        } else { const n = st.civs.find((c) => !c.saved); if (n) g.ui.setWaypoint(n.pos); }
        g.ui.setObjective(s.text + '  (' + st.saved + '/' + st.civs.length + ')');
        if (st.saved >= st.civs.length) this.nextStep();
        break;
      }
      case 'rings': {
        st.timer -= dt;
        const r = st.rings[st.k];
        g.ui.setObjective(s.text + '  ' + (st.k) + '/' + st.rings.length + '  ' + Math.ceil(st.timer) + 's');
        if (r) { g.ui.setWaypoint(r.p); if (h.pos.distanceTo(r.p) < r.r + 1.5) { r.passed = true; r.mesh.material.color.set(0x40ff80); r.mesh.material.emissive.set(0x40ff80); st.k++; g.audio.sfx('perfect'); g.progress.style(15, 'Ring'); } }
        if (st.k >= st.rings.length) this.nextStep();
        else if (st.timer <= 0) this.failMission('out of time');
        break;
      }
      case 'stopveh': {
        const v = st.veh;
        if (v) { g.ui.setWaypoint(v.pos); g.ui.setObjective(s.text + '  speed ' + Math.round(v.speed * 3.6) + ' km/h'); }
        if (v && v.stopped) { g.progress.style(40, 'Vehicle stopped'); this.nextStep(); }
        if (v && v.crashed) this.failMission('the vehicle crashed');
        break;
      }
      case 'tensionbridge': if (g.combat && g.combat.bridgeUsed) this.nextStep(); break;
      case 'boss': if (st.boss && st.boss.phaseDone) this.nextStep(); break;
      case 'wait': st.timer -= dt; if (st.timer <= 0) this.nextStep(); break;
    }
  }
  /* ---------------------------------------------------------------- dynamic crimes (Incident Director) */
  updateCrimes(dt) {
    const g = this.game;
    if (this.crime) {
      const c = this.crime; c.t += dt;
      const h = g.hero.ctrl;
      const done = this.evalCrime(c, dt);
      if (done === true) this.endCrime(true);
      else if (done === false || c.t > c.limit) this.endCrime(false);
      return;
    }
    if(g.cityLife&&g.cityLife.incident)return;
    this.crimeT -= dt;
    if (this.crimeT > 0) return;
    // director budget: district trust lowers frequency, repetition avoided, performance-aware
    const h = g.hero.ctrl, dist = g.layout.district(h.pos.x, h.pos.z);
    const trust = g.progress.trustAt(h.pos);
    this.crimeT = TL.lerp(55, 120, trust / 100) * (g.fps < 35 ? 1.5 : 1);
    const types = ['assault', 'pursuit', 'theft', 'structural', 'drones', 'transit', 'waterfront'];
    let type;
    do { type = types[Math.floor(Math.random() * types.length)]; } while (type === this.lastCrime && Math.random() < 0.8);
    if (type === 'waterfront' && Math.abs(h.pos.x - 240) > 350) type = 'assault';
    if (type === 'transit' && dist !== 'brooklyn' && Math.random() < 0.6) type = 'pursuit';
    this.startCrime(type);
  }
  crimeSpot(minD, maxD, roof) {
    const g = this.game, h = g.hero.ctrl.pos, L = g.layout;
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, d = TL.lerp(minD, maxD, Math.random());
      const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
      if (L.isWater(x, z) || Math.abs(x) > 760 || Math.abs(z) > 760) continue;
      // snap to a street (road centerline + sidewalk offset)
      const sx = Math.round(x / 80) * 80 + 9.5, sz = Math.round(z / 80) * 80 + 30;
      if (L.isWater(sx, sz)) continue;
      if (roof) {
        const hit = g.world.raycast(sx + 30, 400, sz, 0, -1, 0, 400, null);
        if (hit && hit.col && hit.y > 12) return new THREE.Vector3(sx + 30, hit.y + 1, sz);
        continue;
      }
      return new THREE.Vector3(sx, 1, sz);
    }
    return new THREE.Vector3(h.x + 60, 1, h.z);
  }
  startCrime(type) {
    if (this.active || this.activeActivity || this.crime || this.game.routes && this.game.routes.active || this.game.encounters && this.game.encounters.active) return false;
    const g = this.game;
    const c = { type, t: 0, limit: 150, optional: null, optionalDone: true, variant: Math.floor(Math.random() * 3) };
    const names = { assault: 'Street assault', pursuit: 'Vehicle pursuit', theft: 'Rooftop tech theft', structural: 'Structural emergency', drones: 'Drone swarm', transit: 'Transit incident', waterfront: 'Waterfront rescue' };
    c.title = names[type];
    switch (type) {
      case 'assault': c.p = this.crimeSpot(90, 220); c.group = g.ai.spawnGroup(['enforcer', 'enforcer', 'pursuer'].concat(c.variant ? ['shield'] : []), c.p, {});
        c.victim = g.crowd.spawnVictim(c.p.clone().add(new THREE.Vector3(2, 0, 1))); c.optional = 'Protect the civilian'; break;
      case 'pursuit': c.veh = g.traffic.spawnRunaway(c.variant === 2 ? 'truck' : 'car', g.hero.ctrl.pos, true); c.p = c.veh.pos; c.optional = 'Stop it without a crash'; break;
      case 'theft': c.p = this.crimeSpot(120, 260, true); c.group = g.ai.spawnGroup(['operator', 'enforcer', 'marksman'], c.p, { roof: true, stealth: true }); c.optional = 'Start with a stealth takedown'; break;
      case 'structural': {
        c.p = this.crimeSpot(80, 200); const top = c.p.clone().add(new THREE.Vector3(0, 14, 0));
        c.beam = this.objs.beam(top, 6, 'sign'); c.limit = 40; c.optional = 'Secure it within 20 s'; break;
      }
      case 'drones': c.p = this.crimeSpot(100, 220).add(new THREE.Vector3(0, 25, 0)); c.group = g.ai.spawnGroup(['drone', 'drone', 'drone', 'drone'].concat(c.variant ? ['drone', 'drone'] : []), c.p, {}); c.optional = 'Down them all with tether pulls or abilities'; break;
      case 'transit': c.veh = g.traffic.spawnRunaway('bus', g.hero.ctrl.pos, true); c.p = c.veh.pos; c.title = 'Transit incident: runaway bus'; c.optional = 'No collisions'; break;
      case 'waterfront': { const z = g.hero.ctrl.pos.z + (Math.random() - 0.5) * 200; c.p = new THREE.Vector3(240 + (Math.random() - 0.5) * 80, TL.C.WATER_Y + 0.3, z); c.victim = g.crowd.spawnVictim(c.p, true); c.safe = new THREE.Vector3(g.layout.rx1 + 8, 1, z); c.safeM = this.objs.marker(c.safe, 0x40ff80, 20); c.limit = 90; c.optional = 'Rescue within 45 s'; break; }
    }
    this.crime = c; this.lastCrime = type;
    this.crimeMarker = this.objs.marker(c.p.clone ? c.p.clone() : c.p, 0xff5040, 80);
    g.ui.crimeAlert(c.title, c.optional);
    this.pushFeed('Crime reported: ' + c.title, 'crime');
    g.audio.sfx('alert');
  }
  evalCrime(c, dt) {
    const g = this.game, h = g.hero.ctrl;
    if (this.crimeMarker && c.p) this.crimeMarker.mesh.position.set(c.p.x, c.p.y + 40, c.p.z);
    g.ui.setWaypoint(c.p);
    switch (c.type) {
      case 'assault': case 'theft': case 'drones':
        if (c.type === 'assault' && c.victim && c.victim.hurt) c.optionalDone = false;
        if (c.type === 'theft' && g.ai.groupAlerted(c.group) && !c.stealthDone) c.optionalDone = c.optionalDone && g.ai.groupTakedowns(c.group) > 0;
        return g.ai.groupDefeated(c.group) ? true : null;
      case 'pursuit': case 'transit':
        if (c.veh.crashed) c.optionalDone = false;
        return c.veh.stopped ? true : null;
      case 'structural': {
        for (const r of h.tether.ropes) if (r.attached && r.col === c.beam.col) { c.beam.secured = true; }
        if (c.beam.secured && !c.securedT) { c.securedT = c.t; if (c.t > 20) c.optionalDone = false; }
        if (c.securedT && c.t - c.securedT > 1.5) return true;
        return null;
      }
      case 'waterfront': {
        const v = c.victim;
        if (!v.carried && !v.saved && h.pos.distanceTo(v.pos) < 3.5) { g.ui.prompt('[E] Grab civilian'); if (this.interactPressed()) v.carried = true; }
        if (v.carried) { v.pos.copy(h.pos).add(new THREE.Vector3(0, 0.3, 0)); if (h.pos.distanceTo(c.safe) < 10 && h.grounded) { v.carried = false; v.saved = true; g.crowd.victimSaved(v, c.safe); if (c.t > 45) c.optionalDone = false; return true; } }
        return null;
      }
    }
    return null;
  }
  endCrime(success, silent) {
    const c = this.crime; if (!c) return;
    const g = this.game;
    if (c.group !== undefined) g.ai.despawnGroup(c.group, success);
    if (c.victim && !c.victim.saved) g.crowd.removeVictim(c.victim);
    if (c.veh) g.traffic.releaseRunaway(c.veh);
    if (c.beam) this.objs.remove(c.beam);
    if (c.safeM) this.objs.remove(c.safeM);
    if (this.crimeMarker) { this.objs.remove(this.crimeMarker); this.crimeMarker = null; }
    this.crime = null;
    g.ui.setWaypoint(null);
    if (silent) return;
    const d = g.layout.district(c.p.x, c.p.z);
    if (success) {
      const xp = 150 + (c.optionalDone ? 100 : 0);
      g.progress.addXP(xp, c.title + (c.optionalDone ? ' + bonus' : ''));
      g.progress.changeTrust(d === 'river' ? 'core' : d, c.optionalDone ? 6 : 3);
      g.progress.stat('crimes'); this.crimesDone++;
      g.ui.crimeResult(true, c.title, c.optionalDone);
      g.crowd.celebrate(c.p);
      this.pushFeed('Resolved: ' + c.title, 'crime');
    } else {
      g.progress.changeTrust(d === 'river' ? 'core' : d, -3);
      g.ui.crimeResult(false, c.title);
      this.pushFeed('Failed: ' + c.title, 'crime');
    }
  }
  /* ---------------------------------------------------------------- activities + collectibles */
  buildActivities() {
    const rng = new TL.RNG(this.game.seed * 31 + 7), L = this.L(), V = (x, y, z) => new THREE.Vector3(x, y, z);
    const A = [];
    // swing/glide trials: ring courses
    const trial = (name, x, z, kind) => { const pts = []; for (let k = 0; k < 7; k++) pts.push(V(x + Math.sin(k * 0.9) * 60, (kind === 'glide' ? 120 - k * 12 : 30 + rng.range(0, 25)), z + k * 45)); A.push({ id: 'trial_' + name, type: 'trial', name: (kind === 'glide' ? 'Glide trial: ' : 'Swing trial: ') + name, p: pts[0], pts, par: kind === 'glide' ? 60 : 45 }); };
    trial('Avenue Sprint', -120, -500, 'swing'); trial('Midtown Weave', -250, 150, 'swing'); trial('Queens Descent', 520, 300, 'glide'); trial('Waterfront Run', 380, -600, 'swing');
    // drone chases
    for (let k = 0; k < 3; k++) { const x = rng.range(-600, 600), z = rng.range(-600, 600); if (L.isWater(x, z)) continue; A.push({ id: 'drone_' + k, type: 'dronechase', name: 'Drone chase #' + (k + 1), p: V(x, 40, z) }); }
    // enemy outposts
    for (let k = 0; k < 4; k++) { const b = { i: rng.int(-9, 9), j: rng.int(-9, 9) }; const c = L.blockCenter(b.i, b.j); if (L.isBlockWater(b.i, b.j) || L.inPark(b.i, b.j)) continue; A.push({ id: 'outpost_' + k, type: 'outpost', name: 'Meridian outpost #' + (k + 1), p: V(c.x, 1, c.z - 36) }); }
    // tension puzzles: secure 3 swinging beams in time
    for (let k = 0; k < 3; k++) { const x = rng.range(-500, 700), z = rng.range(-600, 600); if (L.isWater(x, z)) continue; A.push({ id: 'tpuzzle_' + k, type: 'tpuzzle', name: 'Tension puzzle #' + (k + 1), p: V(Math.round(x / 80) * 80, 1, Math.round(z / 80) * 80 + 30) }); }
    // signal triangulation: scan at three spots
    for (let k = 0; k < 3; k++) { const c = V(rng.range(-600, 700), 0, rng.range(-600, 600)); A.push({ id: 'signal_' + k, type: 'signal', name: 'Signal triangulation #' + (k + 1), p: c.clone().setY(40), pts: [0, 1, 2].map((q) => c.clone().add(V(Math.cos(q * 2.1) * 90, 30, Math.sin(q * 2.1) * 90))) }); }
    // community requests
    const req = ['Lost delivery drone', 'Stolen bike parts', 'Missing cat collar', 'Dropped camera'];
    for (let k = 0; k < 4; k++) { const x = rng.range(-600, 700), z = rng.range(-600, 600); if (L.isWater(x, z)) continue; A.push({ id: 'req_' + k, type: 'request', name: 'Request: ' + req[k], p: V(Math.round(x / 80) * 80 + 10, 1, Math.round(z / 80) * 80 + 20), item: V(x + rng.range(-60, 60), rng.range(20, 60), z + rng.range(-60, 60)) }); }
    this.activities = A.filter((a) => a && !L.isWater(a.p.x, a.p.z));
    // hidden tech caches on rooftops (revealed by scan)
    for (let k = 0; k < 24; k++) this.caches.push({ id: 'cache_' + k, p: V(rng.range(-700, 750), 0, rng.range(-700, 700)), found: false, placed: false });
  }
  updateActivities(dt) {
    const g = this.game, h = g.hero.ctrl;
    // place caches onto real rooftops lazily (needs loaded colliders)
    for (const c of this.caches) {
      if (c.placed || c.found || this.cacheFound.has(c.id)) continue;
      if (Math.abs(c.p.x - h.pos.x) + Math.abs(c.p.z - h.pos.z) > 200) continue;
      const hit = g.world.raycast(c.p.x, 450, c.p.z, 0, -1, 0, 460, null);
      if (hit) { c.p.y = hit.y + 1.0; c.placed = true; c.obj = this.objs.item(c.p, 0x40e0ff); c.obj.mesh.visible = false; }
    }
    for (const c of this.caches) if (c.obj && !c.found && h.pos.distanceTo(c.p) < 2.5) { c.found = true; this.cacheFound.add(c.id); this.objs.remove(c.obj); g.progress.addXP(80, 'Tech cache'); g.progress.stat('caches'); g.audio.sfx('reward'); }
    const act = this.activeActivity;
    if (!act) {
      if (this.active || this.crime) return;
      for (const a of this.activities) {
        if (this.activityDone.has(a.id)) continue;
        if (h.pos.distanceTo(a.p) < 7) { g.ui.prompt('[E] Start ' + a.name); if (this.interactPressed()) this.startActivity(a); break; }
      }
      return;
    }
    act.t += dt;
    const st = act.st;
    switch (act.a.type) {
      case 'trial': case 'signal': {
        const pts = act.a.pts, k = st.k;
        g.ui.setObjective(act.a.name + '  ' + k + '/' + pts.length + '  ' + act.t.toFixed(1) + 's (par ' + (act.a.par || '-') + ')');
        g.ui.setWaypoint(pts[k]);
        if (act.a.type === 'trial' && h.pos.distanceTo(pts[k]) < 8) { st.rings[k].mesh.material.color.set(0x40ff80); st.k++; g.audio.sfx('perfect'); }
        if (act.a.type === 'signal' && h.pos.distanceTo(pts[k]) < 25 && st.scanned !== k && g.ui.lastScanT > act.t0 + 0.1 && g.ui.lastScanT > (st.lastT || 0)) { st.lastT = g.ui.lastScanT; st.k++; g.audio.sfx('scan'); g.ui.hint('Signal fix ' + st.k + '/3'); }
        if (st.k >= pts.length) this.endActivity(true, act.a.par && act.t <= act.a.par);
        break;
      }
      case 'dronechase': if (st.drone && st.drone.caught) this.endActivity(true, act.t < 40); else if (act.t > 90 || (st.drone && st.drone.escaped)) this.endActivity(false); if (st.drone) g.ui.setWaypoint(st.drone.pos); break;
      case 'outpost': if (g.ai.groupDefeated(st.group)) this.endActivity(true, !g.ai.groupAlerted(st.group)); break;
      case 'tpuzzle': {
        for (const b of st.beams) for (const r of h.tether.ropes) if (r.attached && r.col === b.col && !b.secured) { b.secured = true; g.audio.sfx('clank'); }
        const left = st.beams.filter((b) => !b.secured);
        g.ui.setObjective(act.a.name + ': secure the swinging beams  ' + (3 - left.length) + '/3  ' + Math.ceil(60 - act.t) + 's');
        if (!left.length) this.endActivity(true, act.t < 30); else if (act.t > 60) this.endActivity(false); else g.ui.setWaypoint(left[0].p);
        break;
      }
      case 'request': {
        if (!st.have) { g.ui.setWaypoint(act.a.item); if (h.pos.distanceTo(act.a.item) < 3) { st.have = true; this.objs.remove(st.item); g.audio.sfx('ui'); g.ui.hint('Item recovered — return it'); } }
        else { g.ui.setWaypoint(act.a.p); if (h.pos.distanceTo(act.a.p) < 5) this.endActivity(true, act.t < 60); }
        break;
      }
    }
  }
  startActivity(a) {
    if (this.active || this.activeActivity || this.crime || this.game.routes && this.game.routes.active || this.game.encounters && this.game.encounters.active) return false;
    const g = this.game, st = {};
    this.activeActivity = { a, t: 0, st, t0: g.ui.lastScanT || 0 };
    switch (a.type) {
      case 'trial': st.k = 0; st.rings = a.pts.map((p, k) => this.objs.ring(p, 0.4 * k, 7)); break;
      case 'signal': st.k = 0; g.ui.hint('Reach each signal zone and press [C] to scan'); break;
      case 'dronechase': st.drone = g.ai.spawnCarrierDrone([a.p, a.p.clone().add(new THREE.Vector3(120, 10, 60)), a.p.clone().add(new THREE.Vector3(200, 20, -80)), a.p.clone().add(new THREE.Vector3(80, 30, -220)), a.p.clone().add(new THREE.Vector3(-60, 25, -300))]); break;
      case 'outpost': st.group = g.ai.spawnGroup(['enforcer', 'marksman', 'shield', 'heavy', 'operator'], a.p.clone().add(new THREE.Vector3(0, 0, 20)), { stealth: true }); break;
      case 'tpuzzle': st.beams = [0, 1, 2].map((k) => this.objs.beam(a.p.clone().add(new THREE.Vector3(-14 + k * 14, 16 + k * 3, 0)), 5, 'tp' + k)); break;
      case 'request': st.item = this.objs.item(a.item); break;
    }
    g.ui.toast('Activity: ' + a.name);
  }
  endActivity(ok, bonus) {
    const act = this.activeActivity, g = this.game, st = act.st;
    if (st.rings) for (const r of st.rings) this.objs.remove(r);
    if (st.beams) for (const b of st.beams) this.objs.remove(b);
    if (st.item) this.objs.remove(st.item);
    if (st.drone) g.ai.despawnDrone(st.drone);
    if (st.group !== undefined) g.ai.despawnGroup(st.group, ok);
    this.activeActivity = null;
    g.ui.setObjective(''); g.ui.setWaypoint(null);
    if (ok) { this.activityDone.add(act.a.id); g.progress.addXP(bonus ? 260 : 180, act.a.name + (bonus ? ' (gold)' : '')); g.progress.changeTrust(g.layout.district(act.a.p.x, act.a.p.z), 4); g.audio.sfx('reward'); }
    else { g.ui.toast('Activity failed — try again anytime'); g.audio.sfx('fail'); }
  }
  photoTaken(camPos) {
    const g = this.game;
    for (const lm of g.streamer.landmarks) {
      const id = 'photo_' + lm.name;
      if (this.activityDone.has(id)) continue;
      if (camPos.distanceTo(new THREE.Vector3(lm.x, lm.y, lm.z)) < 200) { this.activityDone.add(id); g.progress.addXP(120, 'Photo landmark: ' + lm.name); g.progress.stat('photos'); return lm.name; }
    }
    return null;
  }
  pushFeed(text, kind) { this.feed.unshift({ text, kind, t: new Date().toLocaleTimeString().slice(0, 5) }); if (this.feed.length > 30) this.feed.pop(); }
  serialize() { return { completed: [...this.completed], crimes: this.crimesDone, activities: [...this.activityDone], caches: [...this.cacheFound] }; }
  deserialize(d) { this.completed = new Set(d.completed || []); this.crimesDone = d.crimes || 0; this.activityDone = new Set(d.activities || []); this.cacheFound = new Set(d.caches || []); for (const c of this.caches) if (this.cacheFound.has(c.id)) c.found = true; }
};
