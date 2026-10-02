/* =====================================================================================
   CombatSystem — player-side combat, abilities, gadgets, throwables, stealth takedowns, Tension Bridge.
   * Attacks: light chain (4), heavy, launcher, aerial combo, ground slam, tether strike / pull,
     disarm, wall bounce, environmental throw, finisher, heal. Hit stop + cancel windows.
   * Defense: dodge (perfect dodge window -> slow-mo), parry (perfect parry -> stagger/counter).
   * Soft targeting (camera, input, distance, threat, height) + optional hard lock.
   * Heroes: WEAVER Vector Slam / Tension Sweep / Multi-Bind / Defensive Lattice / Structural Throw /
     Zero-Slack (ult).  PULSE Chain Discharge / Kinetic Burst / Ion Dash / Magnetic Pull / Pulse Dive /
     Charged Tether / Resonance Cascade (ult).
   * Gadgets: Adhesive Burst, Convergence Node, Lift Drone, Tension Mine, Echo Decoy, Disruptor Dart.
   ===================================================================================== */
'use strict';

TL.ABILITIES = {
  WEAVER: [
    { id: 'slam', name: 'Vector Slam', key: 1, cd: 7, desc: 'Leap and drive all four arms into the ground: shockwave knockdown.' },
    { id: 'sweep', name: 'Tension Sweep', key: 2, cd: 6, desc: 'Arms sweep a taut filament around you, knocking enemies away.' },
    { id: 'bind', name: 'Multi-Bind', key: 3, cd: 10, desc: 'Restrain up to three nearby enemies to surfaces.' },
    { id: 'lattice', name: 'Defensive Lattice', key: 'A1', cd: 12, desc: '[Aim+1] A woven shield that blocks shots and reflects them.' },
    { id: 'throw', name: 'Structural Throw', key: 'A2', cd: 5, desc: '[Aim+2] Rip the nearest heavy object loose and hurl it.' },
    { id: 'ult', name: 'Zero-Slack', key: 4, cd: 0, ult: true, desc: '[4, full charge] Every enemy nearby is lashed and slammed together.' },
  ],
  PULSE: [
    { id: 'chain', name: 'Chain Discharge', key: 1, cd: 6, desc: 'Arc of stored energy jumping between enemies.' },
    { id: 'burst', name: 'Kinetic Burst', key: 2, cd: 7, desc: 'Release stored kinetic energy as a radial blast.' },
    { id: 'dash', name: 'Ion Dash', key: 3, cd: 4, desc: 'Electrified dash through enemies.' },
    { id: 'magnet', name: 'Magnetic Pull', key: 'A1', cd: 8, desc: '[Aim+1] Yank weapons and light enemies toward you.' },
    { id: 'ctether', name: 'Charged Tether', key: 'A2', cd: 6, desc: '[Aim+2] A conductive tether that stuns the target.' },
    { id: 'pdive', name: 'Pulse Dive', key: 'D', cd: 5, desc: '[Dive + Attack in air] Plunge down with an electric impact.' },
    { id: 'ult', name: 'Resonance Cascade', key: 4, cd: 0, ult: true, desc: '[4, full charge] Massive resonance wave stuns every enemy nearby.' },
  ],
};
TL.GADGETS = [
  { id: 'adhesive', name: 'Adhesive Burst', desc: 'Restrain a target in fast-setting filament.', cap: [0, 3, 4, 5] },
  { id: 'node', name: 'Convergence Node', desc: 'Pulls enemies and loose objects together.', cap: [0, 2, 3, 4] },
  { id: 'lift', name: 'Lift Drone', desc: 'Launches targets into the air.', cap: [0, 2, 3, 4] },
  { id: 'mine', name: 'Tension Mine', desc: 'Snaps an enemy to the nearest surface.', cap: [0, 2, 3, 4] },
  { id: 'decoy', name: 'Echo Decoy', desc: 'Holographic hero decoy that draws attention.', cap: [0, 1, 2, 3] },
  { id: 'dart', name: 'Disruptor Dart', desc: 'Disables drones and jams firearms.', cap: [0, 2, 3, 4] },
];

TL.Throwable = class {
  constructor(game, col) {
    this.game = game; this.col = col;
    this.mesh = TL.Assets.mesh(col.asset || 'P_crate', col.lod || 'hi', TL.Assets.shared('world'));
    if (this.mesh) game.scene.add(this.mesh);
    if (col.owner && col.owner.batch) col.owner.batch.free(col.owner);
    this.pos = new THREE.Vector3(col.cx, col.cy - col.hy, col.cz); this.vel = new THREE.Vector3();
    this.mass = Math.max(20, col.hx * col.hy * col.hz * 8 * 120);
    this.state = 'pull'; this.t = 0; this.spin = new THREE.Vector3(Math.random(), Math.random(), Math.random());
    game.world.removeStatic(col);
    this.r = Math.max(col.hx, col.hy, col.hz);
  }
  update(dt, hero) {
    this.t += dt;
    const G = TL.C.G;
    if (this.state === 'pull') {
      // pulled along the tether toward the hand, then held floating in front
      const hold = hero.pos.clone().add(new THREE.Vector3(Math.sin(hero.facing) * 1.8, 1.4, Math.cos(hero.facing) * 1.8));
      const d = hold.clone().sub(this.pos); const L = d.length();
      this.vel.lerp(d.multiplyScalar(TL.clamp(8 / Math.max(L, 0.5), 2, 12)), 1 - Math.exp(-8 * dt));
      if (L < 0.8) this.state = 'held';
    } else if (this.state === 'held') {
      const hold = hero.pos.clone().add(new THREE.Vector3(Math.sin(hero.facing) * 1.6, 1.5, Math.cos(hero.facing) * 1.6));
      this.pos.lerp(hold, 1 - Math.exp(-14 * dt)); this.vel.set(0, 0, 0);
    } else if (this.state === 'thrown') {
      this.vel.y -= G * dt; this.vel.multiplyScalar(1 - 0.05 * dt);
      // hit enemies along the path (mass-aware damage + knockback)
      const hit = this.game.ai.hitSphere(this.pos, this.r + 0.8, (e) => {
        const dmg = TL.clamp(this.vel.length() * this.mass * 0.0025, 10, 90) * (this.game.progress.has('w_throw') ? 1.4 : 1);
        e.hit(dmg, this.vel.clone().normalize().multiplyScalar(TL.clamp(this.mass / 60, 4, 16)), 'throw');
      });
      const gy = this.game.world.ground(this.pos.x, this.pos.z);
      if (hit || this.pos.y - this.r < gy || this.t > 5) { this.game.particles.burst(this.pos, 18, 1, 6, 0.6, 0.3, [0.6, 0.5, 0.4], { grav: 8 }); this.game.audio.sfx('heavyhit'); this.state = 'done'; }
    }
    if (this.state !== 'held') this.pos.addScaledVector(this.vel, dt);
    if (this.mesh) { this.mesh.position.copy(this.pos); if (this.state !== 'held') { this.mesh.rotation.x += this.spin.x * dt * 4; this.mesh.rotation.z += this.spin.z * dt * 4; } }
  }
  throwAt(target, from) {
    this.state = 'thrown'; this.t = 0;
    const tgt = target ? target.clone().add(new THREE.Vector3(0, 1, 0)) : from.clone().add(new THREE.Vector3(0, 0, 20));
    const d = tgt.clone().sub(this.pos); const dist = d.length();
    const sp = TL.clamp(28 - this.mass * 0.01, 16, 32), tt = dist / sp;
    this.vel.copy(d).multiplyScalar(1 / tt); this.vel.y += 0.5 * TL.C.G * tt;
  }
  dispose() { if (this.mesh) this.game.scene.remove(this.mesh); }
};

TL.CombatSystem = class {
  constructor(game) {
    this.game = game;
    this.focus = 0.5; this.charge = 0; this.combo = 0; this.comboT = 0; this.chainIdx = 0;
    this.atkT = 0; this.atkDur = 0; this.atkType = null; this.atkHitDone = false; this.cancelable = true;
    this.dodgeT = 0; this.dodgeWindow = 0; this.parryT = 0; this.perfectT = 0; this.invuln = 0;
    this.target = null; this.lock = false;
    this.cd = {}; this.held = null; this.throwables = [];
    this.gadgetIdx = 0; this.gadgetCharges = {}; this.gadgetRecharge = {};
    this.bridge = null; this.bridgeUsed = false;
    this.lattice = 0; this.ultT = 0;
    this.decoys = [];
    this.refreshGadgets();
    this.healCost = 1;
  }
  refreshGadgets() {
    const lv = this.game.progress ? this.game.progress.gadgetLv : { adhesive: 1, node: 1, lift: 1, mine: 1, decoy: 0, dart: 0 };
    for (const gd of TL.GADGETS) { const cap = gd.cap[lv[gd.id] || 0]; this.gadgetCharges[gd.id] = Math.min(this.gadgetCharges[gd.id] !== undefined ? this.gadgetCharges[gd.id] : cap, cap); this.gadgetRecharge[gd.id] = this.gadgetRecharge[gd.id] || 0; }
  }
  gadgetCap(id) { const gd = TL.GADGETS.find((x) => x.id === id); const lv = this.game.progress.gadgetLv[id] || 0; return gd.cap[lv]; }
  hero() { return this.game.hero; }
  heroName() { return this.game.heroName; }
  /* ---------------------------------------------------------------- targeting */
  pickTarget(range) {
    const g = this.game, h = g.hero.ctrl, cam = g.rig;
    if (this.lock && this.target && this.target.alive && this.target.pos.distanceTo(h.pos) < 40) return this.target;
    let best = null, bs = -1e9;
    const inDir = g.input.intent.move.lengthSq() > 0.1 ? g.input.intent.move.clone().normalize() : null;
    for (const e of g.ai.enemies) {
      if (!e.alive || e.restrained > 0) continue;
      const d = e.pos.distanceTo(h.pos); if (d > (range || 18)) continue;
      const to = e.pos.clone().sub(h.pos); to.y = 0; to.normalize();
      const camF = new THREE.Vector3(cam.fwd.x, 0, cam.fwd.z).normalize();
      let s = to.dot(camF) * 8 - d * 0.6 + (e.threat || 1) * 2 - Math.abs(e.pos.y - h.pos.y) * 0.3;
      if (inDir) s += to.dot(inDir) * 6;
      if (e.attacking) s += 3;
      if (s > bs) { bs = s; best = e; }
    }
    this.target = best;
    return best;
  }
  focusPoint() { const t = this.target; return t && t.alive && t.pos.distanceTo(this.game.hero.ctrl.pos) < 20 && this.game.ai.inCombat ? t.pos : null; }
  /* ---------------------------------------------------------------- per-frame */
  update(dt, it) {
    const g = this.game, inp = g.input, hero = g.hero, h = hero.ctrl, S = TL.TS;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.chainIdx = 0; }
    this.dodgeT = Math.max(0, this.dodgeT - dt); this.parryT = Math.max(0, this.parryT - dt); this.invuln = Math.max(0, this.invuln - dt);
    this.lattice = Math.max(0, this.lattice - dt);
    if (this.perfectT > 0) { this.perfectT -= dt; }
    // gadget recharge
    for (const gd of TL.GADGETS) { const cap = this.gadgetCap(gd.id); if (this.gadgetCharges[gd.id] < cap) { this.gadgetRecharge[gd.id] += dt; if (this.gadgetRecharge[gd.id] > 14) { this.gadgetRecharge[gd.id] = 0; this.gadgetCharges[gd.id]++; } } }
    // passive focus/heal
    const inCombat = g.ai.inCombat;
    if (!inCombat) this.focus = Math.min(3, this.focus + dt * 0.02);
    if (!inCombat && h.health < h.maxHealth) h.health = Math.min(h.maxHealth, h.health + dt * 3);
    // ground slam / Pulse Dive: resolves on impact with the ground (or after a timeout)
    if (this.pendingSlam) {
      this.slamT = (this.slamT || 0) + dt;
      if (h.grounded || h.state === S.GROUND || h.state === S.RECOVER || this.slamT > 2.0) {
        this.pendingSlam = false;
        const pulse = this.heroName() === 'PULSE';
        const P = h.pos.clone();
        g.ai.forEachNear(P, pulse ? 7.5 : 6.5, (e, d) => {
          e.hit((pulse ? 22 : 26) * (1 - d / 9), e.pos.clone().sub(P).setY(0).normalize().multiplyScalar(6).setY(7), 'knockdown');
          if (pulse) e.stun(1.6);
        });
        this.ring(P, pulse ? 7.5 : 6.5, pulse ? [0.3, 1, 0.95] : [1, 0.7, 0.25]);
        g.particles.burst(P.clone().setY(P.y - 0.8), 40, 1, 9, 0.7, 0.45, [0.6, 0.55, 0.5], { up: 3, grav: 8 });
        g.rig.shake(0.8, 0.35); g.audio.sfx(pulse ? 'zap' : 'impact'); g.progress.style(25, pulse ? 'Pulse Dive' : 'Ground slam');
        this.atkType = null;
      }
    }
    // attack timeline
    if (this.atkType) {
      this.atkT += dt;
      if (!this.atkHitDone && this.atkT >= this.atkDur * 0.4) { this.atkHitDone = true; this.resolveHit(); }
      if (this.atkT >= this.atkDur) { this.atkType = null; }
    }
    const aiming = inp.down('aim');
    // hard lock
    if (inp.consume('lockOn')) { this.lock = !this.lock; if (this.lock) this.pickTarget(30); g.ui.toast(this.lock ? 'Target lock ON' : 'Target lock OFF'); }
    if (g.state !== 'play') return;
    // defensive inputs
    if (inp.consume('dodge')) this.doDodge(it);
    if (inp.consume('parry')) this.doParry();
    // abilities
    const n = this.heroName();
    for (const k of [1, 2, 3, 4]) if (inp.consume('ability' + k) || (k === 4 && inp.consume('ultimate'))) this.useAbility(k, aiming);
    if (inp.consume('gadgetCycle')) { this.gadgetIdx = (this.gadgetIdx + 1) % TL.GADGETS.length; g.ui.toast('Gadget: ' + TL.GADGETS[this.gadgetIdx].name); }
    if (inp.consume('gadget')) this.useGadget();
    if (inp.consume('heal')) this.heal();
    if (inp.consume('finisher')) this.finisher();
    // tether strike / pull while aiming (E)
    if (aiming && inp.peek('tether') && h.state !== S.SWING) { inp.consume('tether'); this.tetherPull(); }
    // attack / tricks / takedowns / throws
    if (inp.consume('heavy')) this.attack(true, it);
    if (inp.consume('attack')) {
      if (this.held) this.throwHeld();
      else if (!this.tryTakedown()) {
        const airborne = h.state === S.AIR || h.state === S.DIVE || h.state === S.GLIDE;
        const near = g.ai.nearestEnemy(h.pos, 14);
        if (airborne && !near) this.trick(it);
        else this.attack(false, it);
      }
    }
    // Tension Bridge: X while perched / on a roof edge with enemies around (stealth context)
    if (inp.peek('sling') && (h.state === S.PERCH || (h.state === S.GROUND && g.ai.stealthContext(h.pos)))) { inp.pressed.delete('sling'); it.slingPressed = false; this.makeTensionBridge(); }
    // held throwable / thrown objects
    for (const t of this.throwables) t.update(dt, h);
    this.throwables = this.throwables.filter((t) => { if (t.state === 'done') { t.dispose(); return false; } return true; });
    if (this.held && this.held.state === 'done') this.held = null;
    // ultimate duration effects
    if (this.ultT > 0) { this.ultT -= dt; }
    this.updateBridge(dt);
    this.updateDecoys(dt);
    // animation hooks
    if (hero.anim.arms) hero.anim.armsMode = this.lattice > 0 ? 'lattice' : (this.atkType && this.target ? 'strike' : null);
    if (hero.anim.arms && this.target) hero.anim.arms.focus = this.target.pos.clone().add(new THREE.Vector3(0, 1, 0));
    this.charge = Math.min(100, this.charge);
  }
  /* ---------------------------------------------------------------- attacks */
  attack(heavy, it) {
    const g = this.game, h = g.hero.ctrl, S = TL.TS;
    if (this.atkType && !(this.atkT > this.atkDur * 0.55)) return;      // cancel window: last 45% of an attack
    const t = this.pickTarget(heavy ? 12 : 16);
    const airborne = h.state === S.AIR || h.state === S.DIVE;
    // Pulse Dive / ground slam from the air
    if (airborne && (h.state === S.DIVE || it.dive)) {
      this.atkType = 'slam'; this.atkDur = 0.5; this.atkT = 0; this.atkHitDone = false;
      h.vel.set(h.vel.x * 0.3, -30, h.vel.z * 0.3);
      this.slamT = 0;
      g.hero.anim.startAction('slam', 0.5);
      this.pendingSlam = true;
      return;
    }
    const chain = ['light', 'kick', 'light', heavy ? 'heavy' : 'kick'];
    let type = heavy ? 'heavy' : chain[this.chainIdx % 4];
    // launcher: heavy on a grounded target while grounded
    if (heavy && t && !airborne && h.state === S.GROUND && this.combo >= 2) type = 'launcher';
    this.chainIdx++; this.comboT = 1.1;
    this.atkType = type; this.atkT = 0; this.atkHitDone = false;
    this.atkDur = type === 'heavy' || type === 'launcher' ? 0.55 : 0.32;
    if (this.heroName() === 'PULSE') this.atkDur *= 0.82;
    // lunge toward target (real impulse on the body)
    if (t) {
      const to = t.pos.clone().sub(h.pos); const d = to.length(); to.y = 0; to.normalize();
      h.facing = Math.atan2(to.x, to.z);
      if (d > 2.2 && d < 16) {
        const sp = Math.min(22, d * 3.2);
        h.vel.x = to.x * sp; h.vel.z = to.z * sp;
        if (airborne || t.airborne) h.vel.y = Math.max(h.vel.y, (t.pos.y - h.pos.y) * 3 + 2);
      }
      if (airborne) h.vel.y = Math.max(h.vel.y, 1.5);                 // air combo keeps the hero aloft
    }
    const side = this.chainIdx % 2 ? 1 : -1;
    g.hero.anim.startAction(type === 'kick' ? 'kick' : type, this.atkDur, t ? t.pos : null, side);
    g.audio.sfx('dodge');
  }
  resolveHit() {
    const g = this.game, h = g.hero.ctrl, t = this.target, type = this.atkType;
    const pw = this.heroName() === 'WEAVER' ? 1.2 : 1.0;
    if (this.pendingSlam) return;
    if (!t || !t.alive || t.pos.distanceTo(h.pos) > 3.6) return;
    const dmg = { light: 10, kick: 12, heavy: 22, launcher: 14 }[type] * pw;
    const dir = t.pos.clone().sub(h.pos); dir.y = 0; dir.normalize();
    let kb = dir.clone().multiplyScalar(type === 'heavy' ? 11 : 3.5);
    if (type === 'launcher') kb = new THREE.Vector3(0, 13, 0).addScaledVector(dir, 1);
    if (h.state === TL.TS.AIR && type === 'heavy') kb.y = -14;          // air finisher spikes down
    const res = t.hit(dmg, kb, type);
    if (res !== 'blocked') {
      this.onHitLanded(t, type === 'heavy' ? 0.09 : 0.045, dmg);
      if (type === 'launcher') { h.vel.y = 12.5; g.hero.anim.startAction('launcher', 0.4); }
      // wall bounce: knocked into a nearby wall
      const wall = g.world.raycast(t.pos.x, t.pos.y + 1, t.pos.z, kb.x, 0, kb.z, 3, (c) => c.solid);
      if (wall && type === 'heavy') { t.hit(10, kb.clone().multiplyScalar(-0.5), 'wallbounce'); g.progress.style(15, 'Wall bounce'); }
    } else { g.audio.sfx('clank'); g.hitStop = 0.03; }
  }
  onHitLanded(t, stop, dmg) {
    const g = this.game;
    g.hitStop = Math.max(g.hitStop, g.settings.reducedFlashes ? stop * 0.5 : stop);
    this.combo++; this.comboT = 1.4;
    this.focus = Math.min(3, this.focus + 0.06);
    this.charge = Math.min(100, this.charge + (this.game.progress.has('p_cap') && this.heroName() === 'PULSE' ? 5 : 4));
    g.audio.sfx(dmg > 18 ? 'heavyhit' : 'punch');
    g.particles.burst(t.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 10, 1, 6, 0.25, 0.22, this.heroName() === 'PULSE' ? [0.3, 1, 0.95] : [1, 0.75, 0.3]);
    g.rig.shake(dmg > 18 ? 0.35 : 0.15, 0.15);
    g.progress.style(4 + this.combo, this.combo > 4 ? this.combo + ' hit combo' : '');
  }
  trick(it) {
    const g = this.game, h = g.hero.ctrl;
    const ml = it.moveLocal;
    const kind = ml.y > 0.5 ? 'flip' : ml.y < -0.5 ? 'backflip' : Math.abs(ml.x) > 0.5 ? (ml.x > 0 ? 'corkscrew' : 'roll') : (h.vel.y < -8 ? 'inverted' : 'corkscrew');
    if (g.hero.anim.trick) return;
    g.hero.anim.startTrick(kind);
    h.trick = kind;
    g.progress.style(20, 'Trick: ' + kind);
  }
  /* ---------------------------------------------------------------- defense */
  doDodge(it) {
    const g = this.game, h = g.hero.ctrl;
    if (this.cd.dodge > 0) return;
    this.cd.dodge = 0.45; this.dodgeT = 0.35; this.invuln = 0.3;
    const d = it.move.lengthSq() > 0.1 ? it.move.clone().normalize() : new THREE.Vector3(-Math.sin(h.facing), 0, -Math.cos(h.facing));
    const sp = this.heroName() === 'PULSE' ? 16 : 13;
    h.vel.x = d.x * sp; h.vel.z = d.z * sp; if (h.grounded) h.vel.y = 2;
    g.hero.anim.startAction('dodge', 0.35);
    g.audio.sfx('dodge');
    // perfect dodge: an enemy attack is about to land
    const threat = g.ai.incomingThreat(h.pos, 0.28 * g.settings.dodgeWindow);
    if (threat) { this.perfectT = 1.2; g.hitStop = 0.35; g.audio.sfx('perfect'); g.progress.style(25, 'Perfect dodge'); this.focus = Math.min(3, this.focus + 0.25); g.ui.flash('#9ff'); }
  }
  doParry() {
    const g = this.game, h = g.hero.ctrl;
    if (this.cd.parry > 0) return;
    this.cd.parry = 0.6; this.parryT = 0.3 * g.settings.parryWindow;
    g.hero.anim.startAction('parry', 0.35);
    const threat = g.ai.incomingThreat(h.pos, 0.22 * g.settings.parryWindow, true);
    if (threat && threat.warn === 'parry') {
      // perfect parry: attacker staggered, counter window
      threat.e.stagger(1.6); this.focus = Math.min(3, this.focus + 0.35); this.invuln = 0.4;
      g.hitStop = 0.18; g.audio.sfx('parry'); g.progress.style(30, 'Perfect parry'); g.ui.flash('#ffe');
      threat.e.cancelAttack();
    }
  }
  /* called by AI when an attack connects */
  hurtHero(dmg, warn, from, kb) {
    const g = this.game, h = g.hero.ctrl;
    if (this.invuln > 0) return 'dodged';
    if (warn === 'parry' && this.parryT > 0) { from && from.stagger && from.stagger(1.0); g.audio.sfx('parry'); return 'parried'; }
    if (warn !== 'unblockable' && this.lattice > 0) { g.audio.sfx('zap'); return 'blocked'; }
    if (this.dodgeT > 0) return 'dodged';
    h.damage(dmg, warn);
    if (kb) { h.vel.add(kb); }
    this.combo = 0;
    g.rig.shake(0.5, 0.25); g.audio.sfx('hit');
    if (h.health <= 1.01) this.heroDown();
    return 'hit';
  }
  heroDown() {
    // non-lethal: the hero is knocked out and recovers at a nearby rooftop
    const g = this.game, h = g.hero.ctrl;
    g.ui.toast('You were overwhelmed — recovering nearby');
    const sp = g.streamer.spawnPoint();
    const back = h.pos.clone().add(new THREE.Vector3(0, 60, 0));
    h.teleport(back.x, Math.max(back.y, 60), back.z);
    h.health = h.maxHealth * 0.6;
    if (g.missions.active) g.missions.failMission('knocked out');
    void sp;
  }
  heal() {
    const g = this.game, h = g.hero.ctrl;
    if (this.focus < this.healCost || h.health >= h.maxHealth) { g.ui.hint('Not enough Focus to heal'); return; }
    this.focus -= this.healCost; h.health = Math.min(h.maxHealth, h.health + 40);
    g.particles.burst(h.pos, 20, 1, 3, 0.8, 0.25, [0.4, 1, 0.6], { up: 2 }); g.audio.sfx('reward');
  }
  finisher() {
    const g = this.game, h = g.hero.ctrl;
    if (this.focus < 1) { g.ui.hint('Finisher needs 1 Focus bar'); return; }
    const t = this.pickTarget(6); if (!t) return;
    this.focus -= 1;
    t.defeat('finisher');
    g.hero.anim.startAction('heavy', 0.6, t.pos);
    g.hitStop = 0.25; g.rig.shake(0.6, 0.3); g.audio.sfx('heavyhit'); g.progress.style(60, 'Finisher');
    g.qte && g.qte(0.5);
  }
  /* ---------------------------------------------------------------- tether strike / pull / throw */
  tetherPull() {
    const g = this.game, h = g.hero.ctrl, cam = g.rig;
    const t = this.pickTarget(28);
    if (t && t.alive) {
      // disarm armed enemies, yank light ones, zip toward heavy ones (tether strike)
      g.hero.anim.startAction('pull', 0.3, t.pos, 1);
      this.showLine(t.pos);
      g.audio.sfx('thwip');
      if (t.weapon && t.type !== 'heavy') { t.disarm(); g.progress.style(20, 'Disarm'); return; }
      if (t.mass < 150) { t.pullToward(h.pos, 18); g.progress.style(15, 'Tether pull'); }
      else { const to = t.pos.clone().sub(h.pos).normalize(); h.vel.copy(to.multiplyScalar(26)); h.vel.y += 3; this.chainIdx = 3; setTimeout(() => this.attack(true, g.input.intent), 200); g.progress.style(15, 'Tether strike'); }
      if (this.heroName() === 'PULSE' && this.cd.ctether <= 0 && g.input.down('aim')) { t.stun(2.0 * (g.progress.has('p_tether') ? 1.6 : 1)); }
      return;
    }
    // environmental: pull a throwable prop
    const W = g.streamer.throwables;
    let best = null, bd = 30;
    for (const c of W) {
      const p = new THREE.Vector3(c.cx, c.cy, c.cz);
      const to = p.clone().sub(g.camera.position); const d = to.length(); to.normalize();
      if (to.dot(cam.fwd) > 0.93 && d < bd + 15) { bd = d; best = c; }
    }
    if (best) {
      g.streamer.throwables = W.filter((c) => c !== best);
      const th = new TL.Throwable(g, best); this.throwables.push(th); this.held = th;
      this.showLine(th.pos); g.audio.sfx('thwip');
    }
  }
  throwHeld() {
    const g = this.game, t = this.pickTarget(40);
    this.held.throwAt(t ? t.pos : null, g.hero.ctrl.pos.clone().add(g.rig.fwd.clone().multiplyScalar(30)));
    this.held = null; g.hero.anim.startAction('heavy', 0.4); g.audio.sfx('dodge'); g.progress.style(15, 'Environmental throw');
  }
  showLine(p) {
    const g = this.game, h = g.hero;
    const hand = h.anim.handWorld.R;
    const geo = new THREE.BufferGeometry().setFromPoints([hand.clone(), p.clone().add(new THREE.Vector3(0, 1, 0))]);
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xe0f0ff }));
    g.scene.add(l); setTimeout(() => g.scene.remove(l), 180);
  }
  /* ---------------------------------------------------------------- abilities */
  useAbility(k, aiming) {
    const g = this.game, n = this.heroName(), h = g.hero.ctrl;
    const list = TL.ABILITIES[n];
    let ab = aiming && (k === 1 || k === 2) ? list.find((a) => a.key === 'A' + k) : list.find((a) => a.key === k);
    if (!ab) return;
    if (ab.ult) { if (this.charge < 100) { g.ui.hint('Ultimate needs full charge'); return; } this.charge = 0; }
    else if (this.cd[ab.id] > 0) { g.ui.hint(ab.name + ' recharging'); return; }
    let cd = ab.cd;
    if (ab.id === 'dash' && g.progress.has('p_ion')) cd *= 0.65;
    this.cd[ab.id] = cd;
    const P = h.pos, E = g.ai;
    const col = n === 'PULSE' ? [0.3, 1, 0.95] : [1, 0.7, 0.25];
    g.hero.anim.startAction('cast', 0.5);
    g.audio.sfx(ab.ult ? 'ultimate' : n === 'PULSE' ? 'zap' : 'clank');
    switch (ab.id) {
      case 'slam': {
        h.vel.y = 9; setTimeout(() => {
          const mul = g.progress.has('w_slam') ? 1.3 : 1;
          E.forEachNear(P, 8, (e, d) => e.hit(26 * mul * (1 - d / 10), e.pos.clone().sub(P).setY(0).normalize().multiplyScalar(9).setY(5), 'knockdown'));
          g.particles.burst(P.clone().setY(P.y - 0.8), 50, 1, 10, 0.8, 0.5, col, { up: 3, grav: 8 }); g.rig.shake(0.9, 0.4); g.audio.sfx('impact');
        }, 450);
        g.hero.anim.startAction('slam', 0.8); break;
      }
      case 'sweep': { const r = 7 * (g.progress.has('w_sweep') ? 1.4 : 1); E.forEachNear(P, r, (e) => e.hit(16, e.pos.clone().sub(P).setY(0).normalize().multiplyScalar(12).setY(3), 'sweep')); this.ring(P, r, col); break; }
      case 'bind': { let n2 = g.progress.has('w_bind') ? 4 : 3; E.forEachNear(P, 14, (e) => { if (n2-- > 0) e.restrain(12); }); break; }
      case 'lattice': this.lattice = 5 * (g.progress.has('w_lattice') ? 1.5 : 1); break;
      case 'throw': { if (!this.held) { this.tetherPull(); } break; }
      case 'ult': {
        if (n === 'WEAVER') { const vict = []; E.forEachNear(P, 25, (e) => vict.push(e)); vict.forEach((e) => { e.pullToward(P, 25); setTimeout(() => e.hit(60, new THREE.Vector3(0, 8, 0), 'knockdown'), 500); }); this.ultT = 5 + (g.progress.has('w_ult') ? 3 : 0); }
        else { const r = 22 * (g.progress.has('p_ult') ? 1.4 : 1); E.forEachNear(P, r, (e) => { e.stun(6); e.hit(35, e.pos.clone().sub(P).setY(0).normalize().multiplyScalar(6).setY(4), 'shock'); }); this.ring(P, r, col); }
        g.rig.shake(1.2, 0.6); g.hitStop = 0.4; g.progress.style(80, ab.name); break;
      }
      case 'chain': {
        let cur = this.pickTarget(18), jumps = g.progress.has('p_chain') ? 5 : 4; const hitSet = new Set(); let from = P.clone().setY(P.y + 1);
        while (cur && jumps-- > 0) { hitSet.add(cur); cur.hit(18, new THREE.Vector3(0, 2, 0), 'shock'); cur.stun(1.2); this.arc(from, cur.pos.clone().setY(cur.pos.y + 1)); from = cur.pos.clone().setY(cur.pos.y + 1); cur = E.nearestEnemy(cur.pos, 9, hitSet); }
        break;
      }
      case 'burst': E.forEachNear(P, 8, (e, d) => e.hit(22 * (1 - d / 10), e.pos.clone().sub(P).setY(0).normalize().multiplyScalar(14).setY(4), 'knockdown')); this.ring(P, 8, col); h.vel.y = Math.max(h.vel.y, 4); break;
      case 'dash': { const d = g.input.intent.move.lengthSq() > 0.1 ? g.input.intent.move.clone().normalize() : new THREE.Vector3(Math.sin(h.facing), 0, Math.cos(h.facing)); h.vel.x = d.x * 38; h.vel.z = d.z * 38; this.invuln = 0.35; setTimeout(() => E.forEachNear(h.pos, 4, (e) => { e.hit(14, d.clone().multiplyScalar(5), 'shock'); e.stun(1.0); }), 180); break; }
      case 'magnet': { const r = 16 * (g.progress.has('p_mag') ? 1.5 : 1); E.forEachNear(P, r, (e) => { if (e.weapon) e.disarm(); else if (e.mass < 150) e.pullToward(P, 16); }); this.ring(P, r, col); break; }
      case 'ctether': { const t = this.pickTarget(25); if (t) { this.showLine(t.pos); t.stun(2.5 * (g.progress.has('p_tether') ? 1.6 : 1)); t.hit(12, new THREE.Vector3(), 'shock'); this.arc(P.clone().setY(P.y + 1), t.pos.clone().setY(t.pos.y + 1)); } break; }
    }
    if (!ab.ult) this.charge = Math.min(100, this.charge + 3);
  }
  ring(p, r, col) {
    const g = this.game;
    for (let k = 0; k < 48; k++) { const a = k / 48 * Math.PI * 2; g.particles.emit(p.x, p.y - 0.6, p.z, Math.cos(a) * r * 2, 0.5, Math.sin(a) * r * 2, 0.5, 0.35, col[0], col[1], col[2], 1, 0, 2.5, 0); }
  }
  arc(a, b) {
    const g = this.game, pts = [];
    for (let k = 0; k <= 10; k++) { const p = a.clone().lerp(b, k / 10); if (k > 0 && k < 10) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8)); pts.push(p); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x80fff0 }));
    g.scene.add(l); setTimeout(() => g.scene.remove(l), 140);
    g.particles.burst(b, 8, 1, 4, 0.3, 0.2, [0.5, 1, 1]);
  }
  /* ---------------------------------------------------------------- gadgets */
  useGadget() {
    const g = this.game, gd = TL.GADGETS[this.gadgetIdx], h = g.hero.ctrl;
    if ((this.gadgetCharges[gd.id] || 0) <= 0) { g.ui.hint(gd.name + ': no charges' + (this.gadgetCap(gd.id) === 0 ? ' (upgrade in Gadgets menu)' : '')); return; }
    const t = this.pickTarget(30);
    const aim = t ? t.pos.clone() : h.pos.clone().add(g.rig.fwd.clone().multiplyScalar(15));
    this.gadgetCharges[gd.id]--;
    g.hero.anim.startAction('shoot', 0.3, aim, 1);
    g.audio.sfx('thwip');
    const E = g.ai, lv = g.progress.gadgetLv[gd.id];
    switch (gd.id) {
      case 'adhesive': if (t) { t.restrain(8 + lv * 2); E.forEachNear(t.pos, 1.5 + lv, (e) => e.restrain(6)); } break;
      case 'node': E.forEachNear(aim, 8 + lv * 2, (e) => e.pullToward(aim, 12)); this.ring(aim, 6, [0.9, 0.9, 1]); break;
      case 'lift': E.forEachNear(aim, 3 + lv, (e) => e.hit(8, new THREE.Vector3(0, 14 + lv * 2, 0), 'launch')); break;
      case 'mine': if (t) t.snapToSurface(); break;
      case 'decoy': this.decoys.push({ pos: aim.clone(), t: 8 + lv * 3 }); E.alertAll(aim, 'decoy'); break;
      case 'dart': E.forEachNear(aim, 5 + lv * 2, (e) => { if (e.type === 'drone') e.defeat('dart'); else e.jam(8); }); break;
    }
  }
  updateDecoys(dt) {
    for (const d of this.decoys) d.t -= dt;
    this.decoys = this.decoys.filter((d) => d.t > 0);
  }
  /* ---------------------------------------------------------------- stealth takedowns */
  tryTakedown() {
    const g = this.game, h = g.hero.ctrl, S = TL.TS;
    const cand = g.ai.takedownCandidates(h.pos, 7);
    if (!cand.length) return false;
    const e = cand[0];
    const above = h.pos.y - e.pos.y > 2.5;
    let kind = 'ground';
    if (h.state === S.PERCH || (above && this.bridge && this.bridge.on)) kind = 'perch';
    else if (h.state === S.WALL || h.state === S.CRAWL) kind = 'wall';
    else if (h.state === S.CEIL) kind = 'ceiling';
    else if (h.state === S.AIR || h.state === S.GLIDE || h.state === S.DIVE) kind = 'aerial';
    else if (g.world.raycast(e.pos.x, e.pos.y + 1, e.pos.z, e.pos.x - h.pos.x, 0, e.pos.z - h.pos.z, 3, (c) => c.solid)) kind = 'environmental';
    // dual takedown: a second unaware enemy close to the first
    const second = cand.find((o) => o !== e && o.pos.distanceTo(e.pos) < 4.5);
    e.defeat('takedown-' + kind);
    if (second && (kind === 'perch' || kind === 'aerial' || kind === 'ground')) { second.defeat('takedown-dual'); g.progress.style(80, 'Dual takedown'); g.progress.stat('takedowns'); }
    g.progress.style(40, (kind === 'environmental' ? 'Environmental' : kind[0].toUpperCase() + kind.slice(1)) + ' takedown');
    g.progress.stat('takedowns');
    g.hero.anim.startAction('heavy', 0.5, e.pos);
    g.audio.sfx('punch');
    if (kind === 'perch' || kind === 'aerial') { h.vel.set(0, 3, 0); }
    return true;
  }
  /* ---------------------------------------------------------------- TENSION BRIDGE */
  makeTensionBridge() {
    const g = this.game, h = g.hero.ctrl, W = g.world;
    // two real anchors across a gap at roughly the hero's height, left/right of the camera direction
    const f0 = new THREE.Vector3(g.rig.fwd.x, 0, g.rig.fwd.z).normalize();
    const origin = h.pos.clone().add(new THREE.Vector3(0, 0.5, 0));
    // search a fan of directions (yaw +-0.35 rad, pitch -0.45..0.25) for a real anchor across the gap
    let hitA = null, f = f0.clone();
    for (const pitch of [0.02, -0.12, 0.12, -0.25, 0.25, -0.45]) {
      for (const yaw of [0, 0.18, -0.18, 0.35, -0.35]) {
        const c = Math.cos(yaw), sn = Math.sin(yaw);
        const dx = f0.x * c + f0.z * sn, dz = -f0.x * sn + f0.z * c;
        const h2 = W.raycast(origin.x, origin.y, origin.z, dx * Math.cos(pitch), Math.sin(pitch), dz * Math.cos(pitch), 70, (cc) => cc.anchor && cc.solid, null, { noGround: true });
        if (h2 && h2.t > 6) { hitA = { x: h2.x, y: h2.y, z: h2.z }; f = new THREE.Vector3(dx, 0, dz); break; }
      }
      if (hitA) break;
    }
    const hitB = hitA ? W.raycast(origin.x, origin.y, origin.z, -f.x, 0.02, -f.z, 12, (c) => c.anchor && c.solid, null, { noGround: true }) : null;
    if (!hitA) { g.ui.hint('Tension Bridge: no anchor across the gap'); return; }
    const a = hitB ? new THREE.Vector3(hitB.x, hitB.y, hitB.z) : origin.clone().addScaledVector(f, -0.6);
    const b = new THREE.Vector3(hitA.x, hitA.y, hitA.z);
    if (a.distanceTo(b) < 6) { g.ui.hint('Tension Bridge needs a wider gap'); return; }
    this.clearBridge();
    const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), new THREE.MeshStandardMaterial({ color: 0xe8e0c8, emissive: 0x605030 }));
    mesh.position.copy(mid); mesh.lookAt(b); mesh.rotateX(Math.PI / 2); g.scene.add(mesh);
    // walkable/perchable collider: a thin box along the line (yaw-oriented)
    const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    const col = W.addDynamic(mid.x, mid.y - 0.05, mid.z, 0.08, 0.05 + Math.abs(Math.sin(pitch)) * len / 2, len / 2, yaw, { kind: 'bridge', mass: Infinity, anchor: true, perch: true });
    col.vx = col.vy = col.vz = col.wy = 0;
    this.bridge = { a, b, mesh, col, t: 0, on: false };
    this.bridgeUsed = true;
    g.audio.sfx('thwip'); g.progress.style(20, 'Tension Bridge');
    // snap onto the bridge as a perch at the nearest point
    const t = TL.clamp(h.pos.clone().sub(a).dot(b.clone().sub(a)) / (len * len), 0.1, 0.9);
    h.perchPoint.copy(a).lerp(b, t).add(new THREE.Vector3(0, TL.C.FEET - 0.05, 0));
    h.fsm.set(TL.TS.PERCH, 'tension-bridge'); h.vel.set(0, 0, 0);
    this.bridge.on = true;
  }
  updateBridge(dt) {
    const B = this.bridge; if (!B) return;
    B.t += dt;
    const h = this.game.hero.ctrl;
    B.on = h.state === TL.TS.PERCH && h.perchPoint.distanceTo(B.a.clone().lerp(B.b, 0.5)) < B.a.distanceTo(B.b);
    if (B.t > 120 || h.pos.distanceTo(B.a) > 200) this.clearBridge();
  }
  clearBridge() { const B = this.bridge; if (!B) return; this.game.scene.remove(B.mesh); this.game.world.removeDynamic(B.col); this.bridge = null; }
  serialize() { return { gadgetIdx: this.gadgetIdx, charges: this.gadgetCharges }; }
  deserialize(d) { this.gadgetIdx = d.gadgetIdx || 0; Object.assign(this.gadgetCharges, d.charges || {}); }
};
