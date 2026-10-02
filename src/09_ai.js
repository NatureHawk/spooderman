/* =====================================================================================
   AIManager — THE MERIDIAN faction + THE WARDEN boss + carrier drones.
   Enemy types: enforcer, pursuer, shield, heavy, marksman, operator, drone (suppression), captain.
   Perception: vision cone + line of sight, hearing (noise events), suspicion -> alert -> search
   (last-known position), group communication, reaction to missing allies. Combat: attack tokens
   (readable fights), flanking rings, shield units guard ranged units, anti-air reactions,
   shape-coded telegraphs (◆ dodge, ▲ parry, ● ranged, ✖ unblockable). Non-lethal defeat.
   ===================================================================================== */
'use strict';

TL.ENEMY_TYPES = {
  enforcer: { hp: 60, speed: 4.2, run: 6.5, mass: 90, weapon: 'baton', accent: 0xc2462e, melee: true, dmg: 12, warn: 'parry', threat: 1 },
  pursuer:  { hp: 50, speed: 5.5, run: 9.5, mass: 75, weapon: null, accent: 0xe08a20, melee: true, dmg: 10, warn: 'dodge', threat: 1.2, agile: true },
  shield:   { hp: 90, speed: 3.6, run: 5.5, mass: 110, weapon: 'shield', accent: 0x3a78c8, melee: true, dmg: 12, warn: 'parry', threat: 1.1, shield: true },
  heavy:    { hp: 180, speed: 3.0, run: 4.8, mass: 220, weapon: null, accent: 0xe0c030, melee: true, dmg: 24, warn: 'unblockable', threat: 1.6, heavy: true, armor: 0.5 },
  marksman: { hp: 45, speed: 3.8, run: 6.0, mass: 80, weapon: 'rifle', accent: 0x9a4ad0, ranged: true, dmg: 14, warn: 'ranged', threat: 1.4, range: 38 },
  operator: { hp: 55, speed: 3.8, run: 6.0, mass: 85, weapon: 'pack', accent: 0x3ab070, ranged: true, dmg: 8, warn: 'ranged', threat: 1.3, range: 26, summons: true },
  captain:  { hp: 240, speed: 4.5, run: 7.5, mass: 120, weapon: 'baton', accent: 0xe0b040, melee: true, ranged: true, dmg: 18, warn: 'parry', threat: 2.2, elite: true, range: 22, armor: 0.3 },
  drone:    { hp: 30, speed: 7, run: 11, mass: 12, weapon: null, accent: 0xff4a2a, ranged: true, flying: true, dmg: 6, warn: 'ranged', threat: 0.8, range: 30 },
};

TL.Enemy = class {
  constructor(mgr, type, pos, group, opts) {
    this.mgr = mgr; this.game = mgr.game; this.type = type; this.def = TL.ENEMY_TYPES[type]; this.group = group;
    const d = this.def;
    this.hp = d.hp; this.maxHp = d.hp; this.mass = d.mass; this.weapon = d.weapon; this.threat = d.threat;
    this.pos = pos.clone(); this.vel = new THREE.Vector3(); this.yaw = Math.random() * 6.28; this.home = pos.clone();
    this.alive = true; this.state = opts.stealth ? 'patrol' : 'alert'; this.aware = opts.stealth ? 0 : 1;
    this.stun = this.stun.bind(this);
    this.stunT = 0; this.staggerT = 0; this.restrained = 0; this.jamT = 0; this.downT = 0;
    this.airborne = false; this.attacking = false; this.atk = null; this.token = false; this.cool = 1 + Math.random() * 2;
    this.lastKnown = null; this.searchT = 0; this.flankAng = Math.random() * 6.28; this.patrolT = 0;
    this.takedownBy = null; this.stealthSpawn = !!opts.stealth;
    this.flyH = d.flying ? pos.y : 0;
    this.buildVisual();
    // dynamic collider so heroes can tether (pull/strike) and land on heavies
    this.col = this.game.world.addDynamic(this.pos.x, this.pos.y + 0.95, this.pos.z, 0.35, 0.95, 0.35, 0, { kind: d.flying ? 'drone' : 'enemy', mass: this.mass, anchor: true, climb: false, solid: false, owner: this });
  }
  buildVisual() {
    const g = this.game, d = this.def;
    if (d.flying) {
      this.mat = TL.Assets.material({ slots: { 1: 0x2a2c30, 3: d.accent } });
      this.mesh = TL.Assets.mesh('VEH_drone_sup', TL.Assets.pickLod('VEH_drone_sup', g.quality), this.mat);
      g.scene.add(this.mesh);
      return;
    }
    this.mat = TL.Assets.material({ slots: { 1: d.heavy ? 0x3a3530 : 0x2a2c30, 2: 0x44484e, 3: d.accent, 4: 0x151617, 5: 0xff4a2a } });
    const name = d.heavy ? 'MER_heavy' : 'MER_base';
    this.sk = TL.Assets.skinned(name, g.quality === 'ultra' || g.quality === 'high' ? 'hi' : 'mid', this.mat);
    this.anim = new TL.NPCAnimator(this.sk);
    g.scene.add(this.sk.mesh);
    if (d.elite) this.sk.mesh.scale.setScalar(1.08);
    const hand = this.sk.bones.handR, back = this.sk.bones.chest;
    const gear = (asset, bone, off, rot) => {
      const m = TL.Assets.mesh(asset, TL.Assets.pickLod(asset, g.quality), this.mat); if (!m || !bone) return null;
      bone.add(m); m.position.copy(off); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); return m;
    };
    const handPos = this.sk.bones.handR ? new THREE.Vector3(0, -0.08, 0) : new THREE.Vector3();
    if (this.weapon === 'baton') this.gearMesh = gear('GEAR_baton', hand, handPos, [Math.PI / 2, 0, 0]);
    if (this.weapon === 'rifle') this.gearMesh = gear('GEAR_rifle', hand, handPos, [0, Math.PI, 0]);
    if (this.weapon === 'shield') this.gearMesh = gear('GEAR_shield', this.sk.bones.handL, new THREE.Vector3(0, -0.05, 0.12), [0, Math.PI, 0]);
    if (this.weapon === 'pack') this.gearMesh = gear('GEAR_pack', back, new THREE.Vector3(0, -1.35, 0), null);
    if (d.elite) gear('GEAR_cape', this.sk.bones.neck, new THREE.Vector3(0, -1.55, 0), null);
  }
  get warn() { return this.atk ? this.atk.warn : null; }
  /* ---------------------------------------------------------------- damage & status */
  hit(dmg, kb, kind) {
    if (!this.alive) return 'dead';
    const d = this.def, g = this.game, h = g.hero.ctrl;
    // shield units block frontal light hits (heavy, launcher, aerial and gadgets break through)
    if (d.shield && this.weapon === 'shield' && this.stunT <= 0 && (kind === 'light' || kind === 'kick')) {
      const to = h.pos.clone().sub(this.pos).normalize();
      if (to.dot(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))) > 0.3 && h.pos.y - this.pos.y < 2) { this.aggro(); return 'blocked'; }
    }
    if (d.heavy && (kind === 'light' || kind === 'kick') && this.staggerT <= 0) { dmg *= 0.5; kb = kb.clone().multiplyScalar(0.15); }
    dmg *= 1 - (d.armor || 0) * (this.staggerT > 0 ? 0 : 1);
    this.hp -= dmg;
    this.vel.add(kb.clone().multiplyScalar(90 / this.mass));
    if (kb.y > 3 || kind === 'launch' || kind === 'knockdown') this.airborne = true;
    if (this.atk && kind !== 'shock') this.cancelAttack();
    this.staggerT = Math.max(this.staggerT, kind === 'heavy' || kind === 'knockdown' ? 0.8 : 0.25);
    this.hitFlash = 0.12;
    this.aggro();
    if (this.hp <= 0) this.defeat(kind);
    return 'hit';
  }
  defeat(reason) {
    if (!this.alive) return;
    this.alive = false; this.state = 'down'; this.downT = 0; this.atk = null; this.attacking = false;
    if (this.token) this.mgr.releaseToken(this);
    this.takedownBy = reason;
    const g = this.game;
    g.progress.addXP(this.def.elite ? 60 : 20, '');
    g.combat.charge = Math.min(100, g.combat.charge + 8);
    // non-lethal: webbed up / restrained, drones drop
    if (!this.def.flying) this.webbed = this.makeWebCocoon();
    if (/takedown/.test(reason)) { this.mgr.groupStat(this.group, 'takedowns'); this.mgr.noise(this.pos, 8, 'takedown'); }
    else this.mgr.noise(this.pos, 22, 'fight');
    if (Math.random() < 0.35) this.mgr.drop(this.pos);
    this.col.anchor = false;
  }
  makeWebCocoon() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.9, transparent: true, opacity: 0.75 }));
    m.scale.set(0.9, 0.45, 1.6); this.game.scene.add(m); return m;
  }
  stagger(t) { this.staggerT = Math.max(this.staggerT, t); this.cancelAttack(); }
  stun(t) { this.stunT = Math.max(this.stunT, t); this.cancelAttack(); }
  restrain(t) { if (!this.alive) return; this.restrained = Math.max(this.restrained, t); this.cancelAttack(); if (this.restrained > 6 && this.hp < this.maxHp * 0.5) this.defeat('bind'); }
  jam(t) { this.jamT = Math.max(this.jamT, t); }
  disarm() {
    if (!this.weapon) return;
    if (this.gearMesh && this.gearMesh.parent) this.gearMesh.parent.remove(this.gearMesh);
    this.weapon = null; if (this.def.shield) this.def = Object.assign({}, this.def, { shield: false });
    if (this.def.ranged && !this.def.melee) this.def = Object.assign({}, this.def, { ranged: false, melee: true, warn: 'parry' });
    this.stagger(0.6); this.game.audio.sfx('clank');
  }
  pullToward(p, sp) { const d = p.clone().sub(this.pos); d.y = 0; d.normalize(); this.vel.set(d.x * sp, 5, d.z * sp); this.airborne = true; this.cancelAttack(); }
  snapToSurface() {
    const W = this.game.world;
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const h = W.raycast(this.pos.x, this.pos.y + 1, this.pos.z, dx, 0, dz, 12, (c) => c.solid); if (h && (!best || h.t < best.t)) best = Object.assign({}, h); }
    if (best) { this.pos.set(best.x - Math.sign(best.x - this.pos.x) * 0.4, this.pos.y, best.z - Math.sign(best.z - this.pos.z) * 0.4); }
    this.restrain(14); this.defeat('mine');
  }
  applyImpulse(x, y, z) { this.vel.x += x; this.vel.y += y; this.vel.z += z; if (y > 2) this.airborne = true; }
  cancelAttack() { if (this.atk) { this.atk = null; this.attacking = false; } if (this.token) this.mgr.releaseToken(this); }
  aggro() { if (this.state !== 'down') { if (this.state !== 'alert') this.mgr.onAlert(this); this.state = 'alert'; this.aware = 1; this.lastKnown = this.game.hero.ctrl.pos.clone(); } }
  /* ---------------------------------------------------------------- update */
  update(dt) {
    const g = this.game, h = g.hero.ctrl, d = this.def, W = g.world;
    this.hitFlash = Math.max(0, (this.hitFlash || 0) - dt);
    if (this.mat) this.mat.userData.uHit.value = this.hitFlash > 0 ? (this.game.settings.reducedFlashes ? 0.08 : 0.22) : (this.game.settings.outlines && this.alive ? 0.06 : 0);
    if (!this.alive) {
      this.downT += dt;
      if (this.webbed) { this.webbed.position.set(this.pos.x, this.pos.y + 0.35, this.pos.z); this.webbed.rotation.y = this.yaw; }
      this.physics(dt);
      if (d.flying) { this.pos.y -= 0; }
      this.render(dt, 'down');
      return;
    }
    this.stunT -= dt; this.staggerT -= dt; this.restrained -= dt; this.jamT -= dt; this.cool -= dt;
    const toH = h.pos.clone().sub(this.pos); const dist = toH.length();
    const disabled = this.stunT > 0 || this.staggerT > 0 || this.restrained > 0 || this.airborne;
    // perception
    if (this.state !== 'alert') this.perceive(dt, dist, toH);
    let mode = 'idle', speed = 0;
    if (!disabled) {
      if (this.state === 'patrol') {
        this.patrolT -= dt;
        if (this.patrolT <= 0) { this.patrolT = 4 + Math.random() * 4; this.patrolTo = this.home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16)); }
        if (this.patrolTo) { speed = this.moveTo(this.patrolTo, d.speed * 0.5, dt); mode = speed > 0.2 ? 'walk' : 'idle'; }
      } else if (this.state === 'suspicious' || this.state === 'search') {
        const tgt = this.lastKnown || this.home;
        speed = this.moveTo(tgt, d.speed * 0.8, dt); mode = speed > 0.2 ? 'walk' : 'idle';
        this.searchT -= dt;
        if (this.searchT <= 0 && this.state === 'search') { this.state = 'patrol'; this.aware = 0.3; }
      } else if (this.state === 'alert') {
        const r = this.combatThink(dt, dist, toH); mode = r.mode; speed = r.speed;
      }
    } else mode = this.restrained > 0 ? 'restrained' : this.airborne ? 'stagger' : 'stagger';
    // resolve pending attack
    if (this.atk && !disabled) {
      const a = this.atk; a.t += dt;
      this.yaw = TL.dampAngle(this.yaw, Math.atan2(toH.x, toH.z), 8, dt);
      mode = a.ranged ? 'aim' : a.t > a.windup ? 'strike' : 'guard';
      if (a.t >= a.windup && !a.done) {
        a.done = true;
        if (a.ranged) this.fire(a);
        else if (dist < a.reach) {
          const kb = toH.clone().normalize().multiplyScalar(-6).setY(3);
          const r = g.combat.hurtHero(this.def.dmg * (g.missions.active ? 1 : 0.85), a.warn, this, a.warn === 'unblockable' ? kb.multiplyScalar(2) : kb);
          if (r === 'dodged') g.progress.style(8, 'Dodge');
        }
      }
      if (a.t > a.windup + 0.35) { this.atk = null; this.attacking = false; this.mgr.releaseToken(this); this.cool = 1.2 + Math.random() * 1.5; }
    }
    this.physics(dt);
    this.render(dt, mode, speed);
  }
  perceive(dt, dist, toH) {
    const g = this.game, h = g.hero.ctrl;
    const night = g.env.night || 0;
    const range = (this.def.flying ? 34 : 28) * (1 - night * 0.3) * (h.state === TL.TS.PERCH || h.state === TL.TS.CEIL ? 0.55 : 1);
    let see = 0;
    if (dist < range) {
      const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const dir = toH.clone().normalize();
      const cone = f.dot(dir);
      const above = toH.y > 6 ? 0.5 : 1;                               // enemies rarely look up
      if (cone > 0.45 || dist < 3) {
        const eye = this.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
        if (g.world.segmentClear(eye, h.pos, null, 0.5)) see = (1 - dist / range) * above * (cone > 0.8 ? 1.4 : 1);
      }
    }
    if (see > 0) {
      this.aware += see * dt * 1.4 * (g.combat.decoys.length ? 0.4 : 1);
      this.lastKnown = h.pos.clone();
      if (this.aware > 0.35 && this.state === 'patrol') { this.state = 'suspicious'; this.searchT = 8; }
      if (this.aware >= 1) this.aggro();
    } else this.aware = Math.max(0, this.aware - dt * 0.08);
  }
  combatThink(dt, dist, toH) {
    const g = this.game, d = this.def, h = g.hero.ctrl, M = this.mgr;
    let mode = 'guard', speed = 0;
    this.lastKnown = h.pos.clone();
    const heroAir = h.pos.y - this.pos.y > 4;
    this.yaw = TL.dampAngle(this.yaw, Math.atan2(toH.x, toH.z), 6, dt);
    // lose track if the hero is far and out of sight -> search last known position
    if (dist > 70) { this.state = 'search'; this.searchT = 12; return { mode, speed }; }
    const wantRanged = d.ranged && (!d.melee || dist > 8 || heroAir) && this.jamT <= 0;
    if (!this.atk && this.cool <= 0 && M.requestToken(this, wantRanged)) {
      if (wantRanged && dist < (d.range || 30)) this.beginAttack(true);
      else if (!wantRanged && dist < 3.4) this.beginAttack(false);
      else M.releaseToken(this);
    }
    if (this.atk) return { mode: 'guard', speed: 0 };
    // positioning: melee closes when holding a token, otherwise circles (flank ring); ranged keeps distance,
    // shield units stand between the hero and the nearest ranged ally
    let tgt;
    if (d.shield) { const r = M.nearestRangedAlly(this); tgt = r ? r.pos.clone().lerp(h.pos, 0.35) : h.pos.clone(); }
    else if (wantRanged) {
      const want = d.flying ? 14 : 18;
      const dir = toH.clone().setY(0).normalize();
      tgt = h.pos.clone().addScaledVector(dir, -want).add(new THREE.Vector3(Math.cos(this.flankAng) * 5, 0, Math.sin(this.flankAng) * 5));
    } else {
      this.flankAng += dt * 0.3 * (this.group % 2 ? 1 : -1);
      const ring = this.token || M.tokensFree(false) ? 2.2 : 6.5;
      tgt = h.pos.clone().add(new THREE.Vector3(Math.cos(this.flankAng) * ring, 0, Math.sin(this.flankAng) * ring));
    }
    speed = this.moveTo(tgt, dist > 12 ? d.run : d.speed, dt);
    mode = speed > 4.5 ? 'run' : speed > 0.3 ? 'walk' : (wantRanged ? 'aim' : 'guard');
    if (d.summons && !this.summoned && dist < 40) { this.summoned = true; M.spawnGroup(['drone', 'drone'], this.pos.clone().add(new THREE.Vector3(0, 12, 0)), { join: this.group }); }
    return { mode, speed };
  }
  beginAttack(ranged) {
    const d = this.def;
    const heavySlam = d.heavy && Math.random() < 0.55;
    const warn = ranged ? 'ranged' : heavySlam ? 'unblockable' : (d.agile ? 'dodge' : d.warn === 'unblockable' ? 'parry' : d.warn);
    this.atk = { ranged, warn, t: 0, windup: ranged ? 0.9 : heavySlam ? 1.0 : d.agile ? 0.5 : 0.7, reach: heavySlam ? 4.5 : 3.2, done: false };
    this.attacking = true;
    this.game.ui.telegraph(this, warn);
  }
  fire(a) {
    const g = this.game, h = g.hero.ctrl;
    const from = this.pos.clone().add(new THREE.Vector3(0, this.def.flying ? 0 : 1.5, 0));
    const to = h.pos.clone();
    const clear = g.world.segmentClear(from, to, null, 0.8);
    g.audio.sfx(this.def.flying ? 'laser' : 'gun');
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, clear ? to : from.clone().lerp(to, 0.5)]), new THREE.LineBasicMaterial({ color: 0xff5030 }));
    g.scene.add(line); setTimeout(() => g.scene.remove(line), 90);
    if (clear && from.distanceTo(to) < (this.def.range || 30) + 6) g.combat.hurtHero(this.def.dmg, 'ranged', this, null);
  }
  moveTo(p, sp, dt) {
    const d = p.clone().sub(this.pos); if (!this.def.flying) d.y = 0;
    const L = d.length();
    if (L < 0.6) { this.vel.x *= 0.8; this.vel.z *= 0.8; return 0; }
    d.multiplyScalar(1 / L);
    // separation from allies
    for (const o of this.mgr.enemies) if (o !== this && o.alive) { const s = this.pos.clone().sub(o.pos); const l = s.length(); if (l < 1.6 && l > 1e-3) d.addScaledVector(s.multiplyScalar(1 / l), (1.6 - l) * 0.8); }
    const want = Math.min(sp, L * 2);
    this.vel.x = TL.damp(this.vel.x, d.x * want, 6, dt); this.vel.z = TL.damp(this.vel.z, d.z * want, 6, dt);
    if (this.def.flying) this.vel.y = TL.damp(this.vel.y, d.y * want, 4, dt);
    if (!this.atk) this.yaw = TL.dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 8, dt);
    return Math.hypot(this.vel.x, this.vel.z);
  }
  physics(dt) {
    const g = this.game, W = g.world, d = this.def;
    if (d.flying && this.alive && !this.airborne) {
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = TL.damp(this.pos.y, Math.max(this.flyH, g.hero.ctrl.pos.y + 6), 1.5, dt);
    } else {
      this.vel.y -= TL.C.G * dt;
      this.pos.addScaledVector(this.vel, dt);
      // ground under the enemy (street or roof), via downward ray
      const hit = W.raycast(this.pos.x, this.pos.y + 1.2, this.pos.z, 0, -1, 0, 60, (c) => c.solid && c !== this.col && c.kind !== 'enemy');
      const gy = hit ? hit.y : W.ground(this.pos.x, this.pos.z);
      if (this.pos.y <= gy) {
        this.pos.y = gy;
        if (this.airborne && this.vel.y < -12) { this.hp -= 8; this.staggerT = Math.max(this.staggerT, 0.9); if (this.hp <= 0 && this.alive) this.defeat('fall'); }
        this.vel.y = 0; this.airborne = false;
        this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt);
      }
      if (W.isWaterSafe && W.waterFn(this.pos.x, this.pos.z) && this.pos.y < TL.C.WATER_Y) { this.defeat('water'); }
      // keep out of buildings (sphere push)
      if (!this._cands) this._cands = [];
      W.query(this.pos.x - 2, this.pos.z - 2, this.pos.x + 2, this.pos.z + 2, this._cands);
      const cands = this._cands.filter((c) => c.kind !== 'enemy' && c.kind !== 'drone' && c.solid);
      this._pv = this._pv || new THREE.Vector3();
      this._pv.copy(this.pos); this._pv.y += 0.9;
      W.resolveSphere(this._pv, this.vel, 0, 0.4, cands, [], 0);
      this.pos.x = this._pv.x; this.pos.z = this._pv.z;
      if (!this.alive && d.flying) { if (this.pos.y <= gy + 0.01) this.vel.set(0, 0, 0); }
    }
    this.col.cx = this.pos.x; this.col.cy = this.pos.y + (d.flying ? 0 : 0.95); this.col.cz = this.pos.z;
    this.col.vx = this.vel.x; this.col.vy = this.vel.y; this.col.vz = this.vel.z;
  }
  render(dt, mode, speed) {
    if (this.def.flying) {
      if (this.mesh) { this.mesh.position.copy(this.pos); this.mesh.rotation.set(this.vel.z * 0.03, this.yaw, -this.vel.x * 0.03); }
      return;
    }
    const far = this.pos.distanceTo(this.game.camera.position) > 90;
    if (far && this.game.frame % 3 !== 0) { this.sk.mesh.position.copy(this.pos); return; }
    this.anim.update(far ? dt * 3 : dt, this.pos, this.yaw, speed || 0, mode, this.atk ? TL.clamp((this.atk.t - this.atk.windup + 0.2) / 0.4, 0, 1) : 0);
    this.sk.mesh.visible = this.downT < 25;
  }
  dispose() {
    const s = this.game.scene;
    if (this.mesh) s.remove(this.mesh);
    if (this.sk) s.remove(this.sk.mesh);
    if (this.webbed) s.remove(this.webbed);
    this.game.world.removeDynamic(this.col);
    this.game.ui.clearTelegraph(this);
  }
};

/* ------------------------------------------------------------------ carrier drone (chase target) */
TL.CarrierDrone = class {
  constructor(mgr, route) {
    this.mgr = mgr; this.game = mgr.game; this.route = route.map((p) => p.clone()); this.k = 0;
    this.pos = route[0].clone(); this.vel = new THREE.Vector3(); this.caught = false; this.escaped = false; this.hp = 3;
    this.mat = TL.Assets.material({ slots: { 1: 0x2a2c30, 3: 0xc2462e } });
    this.mesh = TL.Assets.mesh('VEH_drone_carrier', TL.Assets.pickLod('VEH_drone_carrier', this.game.quality), this.mat);
    if (this.mesh) this.game.scene.add(this.mesh);
    this.col = this.game.world.addDynamic(this.pos.x, this.pos.y, this.pos.z, 1.6, 0.8, 1.2, 0, { kind: 'drone', mass: 80, anchor: true, climb: false, solid: false, owner: this });
    this.t = 0; this.tethered = 0;
  }
  applyImpulse(x, y, z) { this.vel.x += x * 0.3; this.vel.y += y * 0.3; this.vel.z += z * 0.3; }
  update(dt) {
    if (this.caught) return;
    this.t += dt;
    const g = this.game, h = g.hero.ctrl;
    const tgt = this.route[this.k];
    const d = tgt.clone().sub(this.pos); const L = d.length();
    const sp = 11 + Math.min(6, h.pos.distanceTo(this.pos) < 20 ? 5 : 0);
    if (L < 4) { this.k++; if (this.k >= this.route.length) { this.escaped = true; return; } }
    this.vel.lerp(d.normalize().multiplyScalar(sp), 1 - Math.exp(-1.5 * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y += Math.sin(this.t * 2) * 0.02;
    this.game.world.moveDynamic(this.col, this.pos.x, this.pos.y, this.pos.z, Math.atan2(this.vel.x, this.vel.z), dt);
    if (this.mesh) { this.mesh.position.copy(this.pos); this.mesh.rotation.y = Math.atan2(this.vel.x, this.vel.z) - Math.PI / 2; }
    // caught: tethered for a moment, or struck up close
    const tethered = h.tether.ropes.some((r) => r.attached && r.col === this.col);
    this.tethered = tethered ? this.tethered + dt : 0;
    if (this.tethered > 1.2 || (h.pos.distanceTo(this.pos) < 4.5 && g.combat.atkType)) {
      this.caught = true; g.particles.burst(this.pos, 40, 1, 8, 0.8, 0.4, [1, 0.6, 0.3]); g.audio.sfx('explode');
      if (this.mesh) this.mesh.rotation.z = 0.8;
    }
  }
  dispose() { if (this.mesh) this.game.scene.remove(this.mesh); this.game.world.removeDynamic(this.col); }
};

/* ------------------------------------------------------------------ THE WARDEN */
TL.Warden = class {
  constructor(mgr) {
    this.mgr = mgr; this.game = mgr.game;
    const g = this.game, L = g.layout;
    const site = L.blockCenter(L.special.wardenSite.i, L.special.wardenSite.j);
    this.site = new THREE.Vector3(site.x, 0, site.z);
    this.pos = this.site.clone().add(new THREE.Vector3(0, 0, 10)); this.yaw = 0; this.vel = new THREE.Vector3();
    this.hp = 400; this.maxHp = 400; this.phase = 0; this.phaseDone = false; this.state = 'idle'; this.t = 0;
    this.vulnerable = 0; this.atk = null; this.cool = 2; this.walk = 0;
    this.mat = TL.Assets.material({ slots: {} });
    this.root = new THREE.Group(); g.scene.add(this.root);
    const lod = g.quality === 'low' ? 'mid' : 'hi';
    const part = (n) => { const m = TL.Assets.mesh('WD_' + n, TL.Assets.pickLod('WD_' + n, g.quality), this.mat) || new THREE.Group(); return m; };
    // joint hierarchy (pivots authored in Blender at the joints; game space +Z forward)
    this.J = {};
    const J = this.J;
    J.pelvis = new THREE.Group(); J.pelvis.position.y = 3.05; this.root.add(J.pelvis); J.pelvis.add(part('pelvis'));
    J.torso = new THREE.Group(); J.torso.position.y = 0.3; J.pelvis.add(J.torso); J.torso.add(part('torso')); J.torso.add(part('back'));
    J.head = new THREE.Group(); J.head.position.set(0, 2.2, -0.05); J.torso.add(J.head); J.head.add(part('head'));
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R';
      J['sh' + k] = new THREE.Group(); J['sh' + k].position.set(s * 1.4, 1.85, -0.05); J.torso.add(J['sh' + k]); J['sh' + k].add(part('uarm'));
      J['el' + k] = new THREE.Group(); J['el' + k].position.set(0, -1.4, 0); J['sh' + k].add(J['el' + k]); J['el' + k].add(part('farm'));
      for (let f = 0; f < 3; f++) { const fg = new THREE.Group(); fg.position.y = -1.55; fg.rotation.y = f * 2.094; const inner = new THREE.Group(); inner.position.x = 0.2; inner.rotation.z = 0.3 * s; fg.add(inner); inner.add(part('finger')); J['el' + k].add(fg); }
      J['hip' + k] = new THREE.Group(); J['hip' + k].position.set(s * 0.72, 0, 0); J.pelvis.add(J['hip' + k]); J['hip' + k].add(part('thigh'));
      J['kn' + k] = new THREE.Group(); J['kn' + k].position.set(0, -1.35, 0); J['hip' + k].add(J['kn' + k]); J['kn' + k].add(part('shin'));
      J['an' + k] = new THREE.Group(); J['an' + k].position.set(0, -1.3, 0); J['kn' + k].add(J['an' + k]); J['an' + k].add(part('foot'));
    }
    void lod;
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // human pilot inside the canopy
    this.pilotMat = TL.Assets.material({ slots: { 1: 0x2a2c30, 2: 0x44484e, 3: 0xc2462e, 4: 0x151617, 5: 0xff4a2a } });
    this.pilot = TL.Assets.skinned('MER_base', 'mid', this.pilotMat);
    if (this.pilot) { J.torso.add(this.pilot.mesh); this.pilot.mesh.position.set(0, 0.6, 0.35); this.pilotAnim = new TL.NPCAnimator(this.pilot); }
    this.col = g.world.addDynamic(this.pos.x, this.pos.y + 3, this.pos.z, 1.3, 3, 1.0, 0, { kind: 'boss', mass: 20000, anchor: true, climb: true, solid: true, owner: this });
    this.weaverHit = false; this.pulseHit = false;
  }
  startPhase(n) {
    const g = this.game, L = g.layout;
    this.phase = n; this.phaseDone = false; this.hp = this.maxHp; this.t = 0; this.atk = null; this.vulnerable = 0; this.cool = 2;
    const tall = L.blockCenter(L.special.tallest.i, L.special.tallest.j);
    if (n === 1) { this.pos.copy(this.site).add(new THREE.Vector3(0, 0, 18)); }
    if (n === 2) { this.climbX = tall.x - 22.4; this.climbZ = tall.z; this.pos.set(this.climbX, 4, this.climbZ); this.hp = 300; }
    if (n === 3) { this.pos.copy(this.site).setY(48.4); this.hp = 450; this.weaverHit = false; this.pulseHit = false; }
    this.maxHp = this.hp;
    g.ui.bossBar('THE WARDEN — Phase ' + n, 1);
    g.ui.toast('Checkpoint saved');
  }
  hit(dmg, kb, kind) {
    const g = this.game;
    let mult = this.vulnerable > 0 ? 3 : 0.25;
    if (this.phase === 2) mult = g.hero.ctrl.pos.distanceTo(this.pos.clone().setY(this.pos.y + 3)) < 12 ? 1 : 0;
    if (this.phase === 3) {
      // needs both heroes: WEAVER's crane-hook slams stagger it; PULSE's charged attacks overload the core
      if (g.heroName === 'PULSE' && (kind === 'shock')) { this.pulseHit = true; mult = this.weaverHit ? 2.5 : 0.3; if (!this.weaverHit) g.ui.hint('The core is shielded — WEAVER must slam it with a crane hook first [V to switch]'); }
      else mult = this.vulnerable > 0 ? 1.2 : 0.15;
    }
    this.hp -= dmg * mult;
    if (mult > 0.5) { g.particles.burst(this.pos.clone().setY(this.pos.y + 4), 20, 1, 8, 0.4, 0.3, [1, 0.6, 0.2]); g.audio.sfx('heavyhit'); }
    else g.audio.sfx('clank');
    g.ui.bossBar(null, Math.max(0, this.hp / this.maxHp));
    if (this.hp <= 0 && !this.phaseDone) this.finishPhase();
    return mult > 0.5 ? 'hit' : 'blocked';
  }
  stagger(t) { this.vulnerable = Math.max(this.vulnerable, t + 1.5); this.atk = null; this.game.ui.hint('THE WARDEN is staggered — strike the reactor!'); }
  cancelAttack() { this.atk = null; }
  stun(t) { if (this.phase === 3 && this.game.heroName === 'PULSE') this.hit(20, new THREE.Vector3(), 'shock'); }
  restrain() {} disarm() {} jam() {} snapToSurface() {} pullToward() {} applyImpulse() {} defeat() { this.hit(60, new THREE.Vector3(), 'finisher'); }
  get alive() { return !this.phaseDone; }
  get type() { return 'boss'; }
  get mass() { return 20000; }
  get threat() { return 3; }
  get restrained() { return 0; }
  finishPhase() {
    const g = this.game;
    this.phaseDone = true;
    g.rig.shake(1.2, 0.8); g.audio.sfx('explode'); g.hitStop = 0.5;
    if (this.phase === 3) { g.ui.toast('THE WARDEN is down. The pilot is webbed up for the police.'); g.progress.addXP(800, 'Boss: THE WARDEN'); }
  }
  update(dt) {
    if (this.phaseDone && this.phase !== 3) return;
    const g = this.game, h = g.hero.ctrl;
    this.t += dt; this.vulnerable -= dt; this.cool -= dt;
    const toH = h.pos.clone().sub(this.pos); const dist = Math.hypot(toH.x, toH.z);
    let walk = 0;
    if (this.phase === 1) {
      this.yaw = TL.dampAngle(this.yaw, Math.atan2(toH.x, toH.z), 1.5, dt);
      if (!this.atk && this.vulnerable <= 0) {
        if (dist > 7) { const sp = 2.6; this.pos.x += Math.sin(this.yaw) * sp * dt; this.pos.z += Math.cos(this.yaw) * sp * dt; walk = sp; }
        if (this.cool <= 0) {
          const r = Math.random();
          const kind = dist < 7 ? (r < 0.5 ? 'swipe' : 'slam') : 'throw';
          this.atk = { kind, t: 0, windup: kind === 'slam' ? 1.2 : kind === 'swipe' ? 0.8 : 1.0, warn: kind === 'slam' ? 'unblockable' : kind === 'swipe' ? 'parry' : 'ranged', done: false };
          g.ui.telegraph(this, this.atk.warn); this.cool = 3;
        }
      }
    } else if (this.phase === 2) {
      // climbing the skyscraper exterior: hero must keep up and strike when close
      const top = 300;
      if (this.pos.y < top - 6) this.pos.y += dt * (dist < 30 ? 2.2 : 3.6);
      this.pos.x = this.climbX; this.pos.z = this.climbZ; this.yaw = -Math.PI / 2;
      if (this.cool <= 0) { this.atk = { kind: 'debris', t: 0, windup: 1.2, warn: 'ranged', done: false }; g.ui.telegraph(this, 'ranged'); this.cool = 3.5; }
      walk = 1.5;
    } else if (this.phase === 3) {
      this.yaw = TL.dampAngle(this.yaw, Math.atan2(toH.x, toH.z), 1, dt);
      // crane hooks swinging near the boss can be tethered and driven into it
      for (const c of g.streamer.cranes) {
        const hooked = h.tether.ropes.some((r) => r.attached && r.col === c.hc);
        if (hooked && c.hookPos.distanceTo(this.pos.clone().setY(this.pos.y + 3)) < 5 && c.hookVel.length() > 4 && g.heroName === 'WEAVER') {
          this.weaverHit = true; this.vulnerable = 5; this.hit(70, new THREE.Vector3(), 'hook'); c.hookVel.multiplyScalar(-0.4); g.progress.style(60, 'Crane hook slam');
          g.ui.hint('Core exposed — switch to PULSE [V] and overload it with Chain Discharge / Charged Tether');
        }
      }
      if (this.cool <= 0) { this.atk = { kind: 'throw', t: 0, windup: 1.0, warn: 'ranged', done: false }; g.ui.telegraph(this, 'ranged'); this.cool = 4; }
    }
    if (this.atk) {
      const a = this.atk; a.t += dt;
      if (a.t >= a.windup && !a.done) {
        a.done = true;
        if (a.kind === 'swipe' && dist < 7.5) g.combat.hurtHero(22, 'parry', this, toH.clone().setY(0).normalize().multiplyScalar(10).setY(4));
        else if (a.kind === 'slam') { if (dist < 8) g.combat.hurtHero(30, 'unblockable', this, toH.clone().setY(0).normalize().multiplyScalar(14).setY(8)); g.rig.shake(1.0, 0.5); g.particles.burst(this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 4, 0.2, Math.cos(this.yaw) * 4)), 50, 1, 10, 0.8, 0.5, [0.6, 0.55, 0.5], { up: 4, grav: 9 }); g.audio.sfx('impact'); }
        else { const from = this.pos.clone().setY(this.pos.y + 5); const clear = g.world.segmentClear(from, h.pos, this.col, 1); g.audio.sfx('gun'); if (clear && from.distanceTo(h.pos) < 60) g.combat.hurtHero(16, 'ranged', this, null); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, h.pos.clone()]), new THREE.LineBasicMaterial({ color: 0xffa040 })); g.scene.add(l); setTimeout(() => g.scene.remove(l), 120); }
      }
      if (a.t > a.windup + 0.6) { this.atk = null; g.ui.clearTelegraph(this); }
    }
    this.animate(dt, walk);
    this.game.world.moveDynamic(this.col, this.pos.x, this.pos.y + 3, this.pos.z, this.yaw, dt);
    if (this.pilotAnim) { this.pilotAnim.update(dt, this.pilot.mesh.position, 0, 0, 'pilot'); }
  }
  animate(dt, walk) {
    const J = this.J, t = this.t;
    this.walk += walk * dt * 1.2;
    const w = this.walk, a = this.atk;
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    const bob = walk > 0 ? Math.abs(Math.sin(w)) * 0.12 : Math.sin(t) * 0.03;
    J.pelvis.position.y = 3.05 - bob;
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R', ph = w + (s > 0 ? 0 : Math.PI);
      J['hip' + k].rotation.x = walk > 0 ? Math.sin(ph) * 0.45 : 0.08;
      J['kn' + k].rotation.x = walk > 0 ? -Math.max(0, -Math.cos(ph)) * 0.7 : -0.14;
      J['an' + k].rotation.x = walk > 0 ? Math.max(0, -Math.cos(ph)) * 0.3 : 0.06;
      let sx = walk > 0 ? -Math.sin(ph) * 0.3 : 0.15, sz = s * 0.25, ex = -0.4;
      if (a) {
        const u = TL.clamp(a.t / a.windup, 0, 1), hitp = a.t > a.windup;
        if (a.kind === 'slam') { sx = hitp ? 0.4 : -2.4 * u; ex = hitp ? -0.2 : -0.8; }
        if (a.kind === 'swipe' && s > 0) { sx = -1.2; sz = hitp ? -0.8 : 1.4 * u; ex = -0.3; }
        if ((a.kind === 'throw' || a.kind === 'debris') && s < 0) { sx = hitp ? -1.6 : -2.6 * u; ex = -1.0; }
      }
      if (this.phase === 2) { sx = -2.4 + Math.sin(t * 2 + (s > 0 ? 0 : Math.PI)) * 0.5; ex = -0.6; }
      J['sh' + k].rotation.set(sx, 0, sz); J['el' + k].rotation.x = ex;
    }
    J.torso.rotation.x = this.vulnerable > 0 ? 0.35 : (a && a.kind === 'slam' && a.t > a.windup ? 0.4 : 0);
    J.head.rotation.y = Math.sin(t * 0.7) * 0.3;
    if (this.phase === 2) { this.root.rotation.x = 0; }
  }
  dispose() { this.game.scene.remove(this.root); this.game.world.removeDynamic(this.col); this.game.ui.bossBar(null, -1); }
};

/* ------------------------------------------------------------------ manager */
TL.AIManager = class {
  constructor(game) {
    this.game = game; this.enemies = []; this.groups = new Map(); this.nextGroup = 1;
    this.drones = []; this.boss = null; this.inCombat = false;
    this.tokens = { melee: [], ranged: [] }; this.maxMelee = 2; this.maxRanged = 2;
    this.drops = []; this.ambientT = 20;
  }
  spawnGroup(types, at, opts) {
    opts = opts || {};
    const id = opts.join || this.nextGroup++;
    if (!this.groups.has(id)) this.groups.set(id, { id, members: [], alerted: false, takedowns: 0, stealth: !!opts.stealth, mission: !!opts.mission });
    const G = this.groups.get(id);
    types.forEach((t, k) => {
      const a = (k / types.length) * Math.PI * 2;
      const p = at.clone().add(new THREE.Vector3(Math.cos(a) * 4, TL.ENEMY_TYPES[t].flying ? 10 + k * 1.5 : 0, Math.sin(a) * 4));
      if (!TL.ENEMY_TYPES[t].flying) {
        const hit = this.game.world.raycast(p.x, p.y + 20, p.z, 0, -1, 0, 60, (c) => c.solid);
        p.y = hit ? hit.y : this.game.world.ground(p.x, p.z);
      }
      const e = new TL.Enemy(this, t, p, id, { stealth: opts.stealth });
      this.enemies.push(e); G.members.push(e);
    });
    return id;
  }
  despawnGroup(id, success) {
    const G = this.groups.get(id); if (!G) return;
    for (const e of G.members) { e.dispose(); const i = this.enemies.indexOf(e); if (i >= 0) this.enemies.splice(i, 1); }
    this.groups.delete(id);
  }
  groupDefeated(id) { const G = this.groups.get(id); return !G || G.members.every((e) => !e.alive); }
  groupAlerted(id) { const G = this.groups.get(id); return !!(G && G.alerted); }
  groupTakedowns(id) { const G = this.groups.get(id); return G ? G.takedowns : 0; }
  groupStat(id, k) { const G = this.groups.get(id); if (G) G[k] = (G[k] || 0) + 1; }
  onAlert(e) {
    const G = this.groups.get(e.group);
    if (G && !G.alerted) {
      G.alerted = true;
      this.game.audio.sfx('alert');
      if (G.stealth) this.game.ui.hint('You were spotted!');
      // communication: nearby allies join after a short delay
      setTimeout(() => { for (const o of G.members) if (o.alive && o.state !== 'alert' && o.pos.distanceTo(e.pos) < 30) o.aggro(); }, 700);
    }
  }
  noise(p, r, kind) {
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'alert') continue;
      if (e.pos.distanceTo(p) < r) { e.aware = Math.max(e.aware, kind === 'takedown' ? 0.5 : 0.8); e.lastKnown = p.clone(); e.state = 'search'; e.searchT = 10; }
    }
  }
  alertAll(p, reason) { for (const e of this.enemies) if (e.alive && e.pos.distanceTo(p) < 30) { e.lastKnown = p.clone(); if (reason === 'decoy') { e.state = 'search'; e.searchT = 8; } } }
  requestToken(e, ranged) {
    const list = ranged ? this.tokens.ranged : this.tokens.melee, max = ranged ? this.maxRanged : this.maxMelee;
    if (e.token) return true;
    if (list.length >= max) return false;
    list.push(e); e.token = ranged ? 'ranged' : 'melee'; return true;
  }
  releaseToken(e) { for (const k of ['melee', 'ranged']) { const i = this.tokens[k].indexOf(e); if (i >= 0) this.tokens[k].splice(i, 1); } e.token = false; }
  tokensFree(ranged) { return (ranged ? this.tokens.ranged.length < this.maxRanged : this.tokens.melee.length < this.maxMelee); }
  nearestRangedAlly(e) { let b = null, bd = 30; for (const o of this.enemies) if (o !== e && o.alive && o.def.ranged && !o.def.flying) { const d = o.pos.distanceTo(e.pos); if (d < bd) { bd = d; b = o; } } return b; }
  nearestEnemy(p, r, exclude) {
    let b = null, bd = r;
    const all = this.boss ? this.enemies.concat([this.boss]) : this.enemies;
    for (const e of all) { if (!e.alive || (exclude && exclude.has(e))) continue; const d = e.pos.distanceTo(p); if (d < bd) { bd = d; b = e; } }
    return b;
  }
  forEachNear(p, r, fn) {
    for (const e of this.enemies) { if (!e.alive) continue; const d = e.pos.distanceTo(p); if (d < r) fn(e, d); }
    if (this.boss && this.boss.alive) { const d = this.boss.pos.distanceTo(p); if (d < r + 3) fn(this.boss, Math.max(0, d - 3)); }
  }
  hitSphere(p, r, fn) { let any = false; this.forEachNear(p, r, (e) => { fn(e); any = true; }); return any; }
  incomingThreat(p, window, parry) {
    const all = this.boss ? this.enemies.concat([this.boss]) : this.enemies;
    for (const e of all) {
      const a = e.atk; if (!a || a.done) continue;
      const left = a.windup - a.t;
      if (left >= 0 && left <= window + 0.15 && e.pos.distanceTo(p) < (a.ranged || a.warn === 'ranged' ? 60 : 9)) return { e, warn: a.warn };
    }
    return null;
  }
  takedownCandidates(p, r) {
    return this.enemies.filter((e) => e.alive && e.state !== 'alert' && !e.def.flying && e.pos.distanceTo(p) < r && e.aware < 0.9).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
  }
  stealthContext(p) { return this.enemies.some((e) => e.alive && e.state !== 'alert' && e.pos.distanceTo(p) < 50); }
  spawnCarrierDrone(route) { const d = new TL.CarrierDrone(this, route); this.drones.push(d); return d; }
  despawnDrone(d) { d.dispose(); this.drones = this.drones.filter((x) => x !== d); }
  startBoss(phase) {
    if (!this.boss) this.boss = new TL.Warden(this);
    this.boss.startPhase(phase);
    const g = this.game, h = g.hero.ctrl;
    if (phase === 1) { const p = this.boss.site.clone().add(new THREE.Vector3(0, 1, -12)); if (h.pos.distanceTo(p) > 60) h.teleport(p.x, p.y, p.z); this.spawnGroup(['enforcer', 'enforcer'], this.boss.site.clone().add(new THREE.Vector3(10, 0, 0)), {}); }
    if (phase === 2) { const p = new THREE.Vector3(this.boss.climbX - 25, 10, this.boss.climbZ); h.teleport(p.x, p.y, p.z); g.ui.hint('Swing and wall-run up the tower to keep pace — strike it when close'); }
    if (phase === 3) { const p = this.boss.site.clone().add(new THREE.Vector3(-30, 50, -30)); h.teleport(p.x, p.y, p.z); g.ui.hint('WEAVER: tether a swinging crane hook and steer it into THE WARDEN'); }
    return this.boss;
  }
  endBoss() { if (this.boss && this.boss.phase === 3 && this.boss.phaseDone) { this.boss.dispose(); this.boss = null; } }
  drop(p) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshStandardMaterial({ color: 0x60ff90, emissive: 0x30c060 }));
    m.position.copy(p).setY(p.y + 0.6); this.game.scene.add(m); this.drops.push({ m, t: 20 });
  }
  update(dt) {
    const g = this.game, h = g.hero.ctrl;
    for (const e of this.enemies) e.update(dt);
    for (const d of this.drones) d.update(dt);
    if (this.boss) this.boss.update(dt);
    this.inCombat = this.enemies.some((e) => e.alive && e.state === 'alert' && e.pos.distanceTo(h.pos) < 45) || !!(this.boss && this.boss.alive && this.boss.phase);
    // health drops
    for (const d of this.drops) { d.t -= dt; d.m.rotation.y += dt * 3; if (d.m.position.distanceTo(h.pos) < 1.8) { h.health = Math.min(h.maxHealth, h.health + 15); g.combat.focus = Math.min(3, g.combat.focus + 0.2); d.t = 0; g.audio.sfx('ui'); } if (d.t <= 0) g.scene.remove(d.m); }
    this.drops = this.drops.filter((d) => d.t > 0);
    // cleanup long-defeated non-mission enemies
    for (const [id, G] of this.groups) if (!G.mission && G.members.every((e) => !e.alive && e.downT > 30)) this.despawnGroup(id);
    // ambient street patrols in low-trust districts
    this.ambientT -= dt;
    if (this.ambientT <= 0 && !g.missions.active && !g.missions.crime) {
      this.ambientT = 60;
      const trust = g.progress.trustAt(h.pos);
      if (Math.random() < 0.6 - trust / 200 && this.enemies.length < 10) {
        const p = g.missions.crimeSpot(120, 220);
        this.spawnGroup(['enforcer', 'pursuer'], p, { stealth: true });
      }
    }
  }
};
