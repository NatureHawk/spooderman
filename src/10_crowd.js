/* =====================================================================================
   CrowdManager — living sidewalks.
   * ~180 simulated agents near the hero on block sidewalk loops; the nearest ~18 are articulated
     skinned HD pedestrians (3 body types, varied clothes/skin/hair/hats/bags/umbrellas/phones),
     the rest are instanced low-poly silhouettes (instance-coloured).
   * Routines: walk, wait at crosswalks (signals), cross, idle, phone, talk, sit, jog, umbrellas in rain.
   * Reactions: look up, cheer, wave, photograph the hero, selfies/high-fives on [E], avoid hard landings,
     thank/complain by district trust. Danger (combat, alerts, explosions): flee, cower, resume later.
   * Victims for crimes/missions (carryable), celebrate after rescues.
   ===================================================================================== */
'use strict';

TL.Ped = class {
  constructor() { this.pos = new THREE.Vector3(); this.reset(); }
  reset() {
    this.alive = true; this.i = 0; this.j = 0; this.t = 0; this.dir = 1; this.speed = 1.3; this.mode = 'walk'; this.modeT = 0;
    this.yaw = 0; this.fear = 0; this.fleeFrom = null; this.skin = null; this.batch = null; this.idx = -1; this.near = false;
    this.variant = 'm'; this.colors = null; this.hat = false; this.bag = false; this.victim = false; this.jog = false;
    this.cross = null; this.react = 0; this.notice=null; this.lookAt=null; this.socialUntil=0;
  }
};

TL.CrowdManager = class {
  constructor(game) {
    this.game = game;
    this.max = game.quality === 'low' ? 90 : game.quality === 'medium' ? 140 : 190;
    this.nearMax = game.quality === 'low' ? 8 : game.quality === 'medium' ? 12 : 18;
    this.peds = []; this.pool = new TL.ObjectPool(() => new TL.Ped(), (p) => p.reset());
    this.skinPool = { m: [], f: [], h: [] };
    this.victims = [];
    this.rng = new TL.RNG(game.seed * 7 + 3);
    this.nav = (game.streamer && game.streamer.nav) || null;     // scan map: sidewalk loops around the real blocks
    this.lodBatch = null;
    this.t = 0; this.assignT = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color();
    const lodName = TL.Assets.has('ped_lod') ? 'ped_lod' : null;
    if (lodName) {
      const mat = TL.Assets.material({ slots: {}, instBody: true });
      this.lodBatch = new TL.InstanceBatch(game.scene, TL.Assets.geo(lodName, 'lo'), mat, this.max + 20, { color: true, noShadow: true });
    }
    this.umbrellaGeo = TL.Assets.geo('umbrella', 'lo');
    this.phoneGeo = TL.Assets.geo('phone', 'lo');
    this.hatGeo = TL.Assets.geo('ped_hat', 'lo');
    this.bagGeo = TL.Assets.geo('ped_bag', 'lo');
    this.palette = {
      shirts: [0x3d6a8e, 0x8e3d3d, 0xd8d4c8, 0x2a2a2e, 0x6a8e3d, 0xc8a040, 0x7a4a8a, 0x40a0a0, 0xe07040, 0x5a5a60, 0xb8c8d8],
      pants: [0x2b2d33, 0x3a4a6a, 0x5a4a3a, 0x202020, 0x6a6a6a, 0x8a7a5a],
      skin: [0xf0c8a8, 0xd8a888, 0xb9876a, 0x8a5a40, 0x5e3a26, 0x3e2618],
    };
  }
  /* sidewalk loop of block (i,j): rectangle at 9.6 m inside the cell edges; t in [0,4) along the edges */
  loopPos(i, j, t, out) {
    if (this.nav) return this.nav.loopPos(i, t, out);
    const C = 80, x0 = i * C + 9.6, z0 = j * C + 9.6, S = C - 19.2;
    const e = Math.floor(t) % 4, f = t - Math.floor(t);
    if (e === 0) out.set(x0 + S * f, 0, z0); else if (e === 1) out.set(x0 + S, 0, z0 + S * f);
    else if (e === 2) out.set(x0 + S * (1 - f), 0, z0 + S); else out.set(x0, 0, z0 + S * (1 - f));
    return out;
  }
  spawnAround(focus) {
    const L = this.game.layout, rng = this.rng;
    for (let k = 0; k < 8 && this.peds.length < this.max; k++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(40, 190);
      const x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
      let i = Math.floor(x / 80), j = Math.floor(z / 80);
      if (this.nav) { i = this.nav.nearestLoop(x, z, 60); j = 0; if (i < 0) continue; }
      else if (L.isBlockWater(i, j) || Math.abs(x) > 790 || Math.abs(z) > 790) continue;
      const p = this.pool.get();
      p.i = i; p.j = j; p.t = rng.range(0, 4); p.dir = rng.chance(0.5) ? 1 : -1;
      p.variant = rng.pick(['m', 'm', 'f', 'f', 'h']);
      p.jog = rng.chance(0.08);
      p.speed = p.jog ? rng.range(2.8, 3.6) : rng.range(1.1, 1.6);
      p.colors = { shirt: rng.pick(this.palette.shirts), pants: rng.pick(this.palette.pants), skin: rng.pick(this.palette.skin) };
      p.hat = rng.chance(0.2); p.bag = rng.chance(0.3);
      p.mode = rng.chance(0.85) ? 'walk' : rng.pick(['phone', 'talk', 'idle', 'sit']);
      p.modeT = rng.range(4, 20);
      this.loopPos(p.i, p.j, p.t, p.pos);
      this.peds.push(p);
    }
  }
  /* ---------------------------------------------------------------- skinned pool for near peds */
  getSkin(v) {
    const pool = this.skinPool[v];
    const free = pool.find((s) => !s.owner);
    if (free) return free;
    if (pool.length >= Math.ceil(this.nearMax / 2) + 2) return null;
    const mat = TL.Assets.material({ slots: {} });
    const lod = this.game.quality === 'ultra' ? 'hi' : 'mid';
    const sk = TL.Assets.skinned('PED_' + v, lod, mat); if (!sk) return null;
    sk.mesh.castShadow = this.game.quality !== 'low';
    this.game.scene.add(sk.mesh);
    const s = { sk, mat, anim: new TL.NPCAnimator(sk), owner: null, v, extra: {} };
    const hand = sk.bones.handR;
    if (this.umbrellaGeo && hand) { const u = new THREE.Mesh(this.umbrellaGeo, mat); u.position.set(0, -0.08, 0); hand.add(u); s.extra.umbrella = u; }
    if (this.phoneGeo && hand) { const u = new THREE.Mesh(this.phoneGeo, TL.Assets.shared('world')); u.position.set(0, -0.1, 0.03); hand.add(u); s.extra.phone = u; }
    if (this.hatGeo && sk.bones.head) { const u = new THREE.Mesh(this.hatGeo, mat); u.position.set(0, -0.1, 0); sk.bones.head.add(u); s.extra.hat = u; }
    pool.push(s);
    return s;
  }
  assignSkins() {
    const cam = this.game.camera.position;
    const sorted = this.peds.filter((p) => p.alive).sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    const want = new Set(sorted.slice(0, this.nearMax).filter((p) => p.pos.distanceTo(cam) < 70));
    for (const p of this.peds) if (p.skin && !want.has(p)) { p.skin.owner = null; p.skin.sk.mesh.visible = false; p.skin = null; }
    for (const p of want) if (!p.skin) {
      const s = this.getSkin(p.variant); if (!s) continue;
      s.owner = p; p.skin = s; s.sk.mesh.visible = true;
      TL.Assets.setSlots(s.mat, { 6: p.colors.skin, 7: p.colors.shirt, 2: p.colors.pants });
      if (s.extra.hat) s.extra.hat.visible = p.hat;
    }
  }
  /* ---------------------------------------------------------------- update */
  update(dt, focus) {
    const g = this.game;
    this.t += dt;
    if (this.peds.length < this.max) this.spawnAround(focus);
    const raining = g.env.rain > 0.4;
    const danger = this.dangerPoints();
    const h = g.hero.ctrl;
    for (let k = this.peds.length - 1; k >= 0; k--) {
      const p = this.peds[k];
      if (p.pos.distanceTo(focus) > 230 || !p.alive) { this.despawn(p, k); continue; }
      this.think(p, dt, danger, h, raining);
    }
    this.assignT -= dt;
    if (this.assignT <= 0) { this.assignT = 0.4; this.assignSkins(); }
    // render
    for (const p of this.peds) this.render(p, dt, raining);
    for (const v of this.victims) this.renderVictim(v, dt);
  }
  dangerPoints() {
    const g = this.game, out = [];
    for (const e of g.ai.enemies) if (e.alive && e.state === 'alert') out.push(e.pos);
    if (g.ai.boss && g.ai.boss.alive && g.ai.boss.phase) out.push(g.ai.boss.pos);
    if (g.missions.crime && g.missions.crime.p) out.push(g.missions.crime.p);
    return out;
  }
  think(p, dt, danger, h, raining) {
    const g = this.game;
    p.modeT -= dt; p.react = Math.max(0, p.react - dt);
    // danger: never walk calmly through combat
    let near = null, nd = 28;
    for (const d of danger) { const dd = Math.hypot(d.x - p.pos.x, d.z - p.pos.z); if (dd < nd && Math.abs(d.y-p.pos.y)<12 && (!g.cityLife || g.cityLife.visible(p.pos.clone().add(new THREE.Vector3(0,1.5,0)),d.clone().add(new THREE.Vector3(0,1,0))))) { nd = dd; near = d; } }
    if (near) { p.fear = Math.min(1, p.fear + dt * 2); p.fleeFrom = near.clone(); }
    else p.fear = Math.max(0, p.fear - dt * 0.05);
    if (p.fear > 0.3) {
      if (p.fear > 0.8 && nd < 10 && Math.random() < 0.01) { p.mode = 'cower'; p.modeT = 6; }
      if (p.mode !== 'cower') {
        // flee along the sidewalk away from the danger (choose direction that increases distance)
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        this.loopPos(p.i, p.j, (p.t + 0.02 + 4) % 4, a); this.loopPos(p.i, p.j, (p.t - 0.02 + 4) % 4, b);
        p.dir = a.distanceTo(p.fleeFrom) > b.distanceTo(p.fleeFrom) ? 1 : -1;
        p.mode = 'flee'; p.speed = 4.5;
        if (Math.random() < 0.002) g.ui.caption('Civilian: "Somebody call emergency services!"', 'Civilian');
      }
    } else if (p.mode === 'flee' || p.mode === 'cower') { if (p.modeT <= 0 || p.fear < 0.05) { p.mode = 'walk'; p.speed = p.jog ? 3.2 : 1.3; } }
    if(g.cityLife)g.cityLife.react(p,dt);
    const hd=p.pos.distanceTo(h.pos);
    // interaction: greeting / high-five / selfie with [E]
    if (hd < 2.6 && p.fear < 0.3 && g.hero.ctrl.state === TL.TS.GROUND && !g.missions.active && !(g.cityLife&&g.cityLife.incident)) {
      g.ui.prompt('[E] Greet');
      if (g.input.consume('interact')) {
        const kind = ['High-five', 'Selfie', 'Greeting'][Math.floor(Math.random() * 3)];
        p.mode = kind === 'Selfie' ? 'photo' : 'wave'; p.modeT = 2.5; p.react = 20;
        g.progress.changeTrust(g.layout.district(p.pos.x, p.pos.z), 0.5); g.progress.style(5, kind);
        g.ui.caption('Civilian: "' + (kind === 'Selfie' ? 'Say cheese!' : kind === 'High-five' ? 'Up top!' : 'Have a good one!') + '"', 'Civilian');
        g.hero.anim.startAction('cast', 0.4);
      }
    }
    // routines
    if (p.mode === 'walk' || p.mode === 'flee') {
      const len = this.nav ? this.nav.loops[p.i].per / 4 : 61.6;
      const prevEdge = Math.floor(p.t);
      p.t += p.dir * (p.speed * (raining && p.mode === 'walk' ? 1.2 : 1)) * dt / len;
      p.t = (p.t + 4) % 4;
      const edge = Math.floor(p.t);
      if (edge !== prevEdge && p.mode === 'walk') {
        // at a corner: maybe cross to the neighbour block (wait for the signal)
        if (Math.random() < 0.35) {
          if (this.nav) {
            const ni = this.nav.neighbourLoop(p.i, p.pos, 30);
            if (ni >= 0) { p.cross = { ni, nj: 0, wait: 0 }; p.mode = 'wait'; p.modeT = 30; }
          } else {
            const corner = p.dir > 0 ? edge : prevEdge;
            const offs = [[-1, -1], [1, -1], [1, 1], [-1, 1]][corner % 4];
            const ni = p.i + (Math.random() < 0.5 ? offs[0] : 0), nj = p.j + (ni === p.i ? offs[1] : 0);
            if (!g.layout.isBlockWater(ni, nj)) { p.cross = { ni, nj, wait: 0 }; p.mode = 'wait'; p.modeT = 30; }
          }
        } else if (Math.random() < 0.15) { p.mode = Math.random() < 0.5 ? 'phone' : 'idle'; p.modeT = 3 + Math.random() * 6; }
      }
      this.loopPos(p.i, p.j, p.t, p.pos);
      const ahead = new THREE.Vector3(); this.loopPos(p.i, p.j, (p.t + p.dir * 0.02 + 4) % 4, ahead);
      p.yaw = Math.atan2(ahead.x - p.pos.x, ahead.z - p.pos.z);
      // avoid hard-landing zones: step aside
      if (hd < 3) { p.pos.x += (p.pos.x - h.pos.x) * 0.1; p.pos.z += (p.pos.z - h.pos.z) * 0.1; }
    } else if (p.mode === 'wait') {
      const ew = p.cross.ni !== p.i;
      const sig = TL.signalState(p.i * 80 + 80, p.j * 80 + 80, this.t);
      if ((ew ? sig.ew : sig.ns) === 'walk' || p.modeT <= 20) {
        // cross: jump to the neighbouring block's loop at the matching corner
        const pos = p.pos.clone();
        p.i = p.cross.ni; p.j = p.cross.nj; p.cross = null;
        let best = 0, bd = 1e9; const tmp = new THREE.Vector3(), n = this.nav ? 64 : 4;
        for (let k = 0; k < n; k++) { this.loopPos(p.i, p.j, k * 4 / n, tmp); const d = tmp.distanceTo(pos); if (d < bd) { bd = d; best = k * 4 / n; } }
        p.t = best + 0.001; p.mode = 'walk';
      }
    } else if (p.modeT <= 0) { p.mode = 'walk'; p.speed = p.jog ? 3.2 : 1.3; }
  }
  render(p, dt, raining) {
    const mode = p.mode === 'look' ? 'look' : p.mode === 'wait' ? 'idle' : p.mode === 'walk' ? (p.jog ? 'run' : 'walk') : p.mode;
    if (p.skin) {
      const s = p.skin;
      if (!p.lookAt && (p.mode === 'cheer' || p.mode === 'wave' || p.mode === 'photo')) {
        const h = this.game.hero.ctrl.pos; p.yaw = TL.dampAngle(p.yaw, Math.atan2(h.x - p.pos.x, h.z - p.pos.z), 5, dt);
      }
      s.anim.update(dt, p.pos, p.yaw, p.mode === 'flee' ? 4.5 : p.speed, mode);
      if (s.extra.umbrella) s.extra.umbrella.visible = raining && (mode === 'walk' || mode === 'idle');
      if (s.extra.phone) s.extra.phone.visible = mode === 'phone' || mode === 'photo';
      if (p.batch) p.batch.free(p);
      return;
    }
    if (!this.lodBatch) return;
    this._q.setFromAxisAngle(TL._UP || (TL._UP = new THREE.Vector3(0, 1, 0)), p.yaw);
    const bob = mode === 'walk' || mode === 'flee' || mode === 'run' ? Math.abs(Math.sin(this.t * 8 + p.t * 50)) * 0.05 : 0;
    this._m.compose(new THREE.Vector3(p.pos.x, p.pos.y + bob - (mode === 'cower' ? 0.5 : 0), p.pos.z), this._q, this._s);
    if (!p.batch) { this._c.set(p.colors.shirt); this.lodBatch.alloc(p, this._m, this._c); }
    else this.lodBatch.set(p, this._m);
  }
  despawn(p, k) {
    if (p.batch) p.batch.free(p);
    if (p.skin) { p.skin.owner = null; p.skin.sk.mesh.visible = false; p.skin = null; }
    this.peds.splice(k, 1); this.pool.release(p);
  }
  /* ---------------------------------------------------------------- events */
  onHeroLand(pos, impact) { if(this.game.cityLife)this.game.cityLife.emit('land',pos,impact/35); }
  celebrate(pos) { if(this.game.cityLife)this.game.cityLife.emit('rescue',pos,1); }
  /* ---------------------------------------------------------------- victims (crimes / missions) */
  spawnVictim(pos, water) {
    const v = { pos: pos.clone(), carried: false, saved: false, hurt: false, water: !!water, t: 0 };
    const mat = TL.Assets.material({ slots: { 6: 0xd8a888, 7: 0xe07040, 2: 0x3a4a6a } });
    v.sk = TL.Assets.skinned(Math.random() < 0.5 ? 'PED_m' : 'PED_f', 'mid', mat);
    if (v.sk) { this.game.scene.add(v.sk.mesh); v.anim = new TL.NPCAnimator(v.sk); }
    v.beacon = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 4), new THREE.MeshBasicMaterial({ color: 0x40ff80 }));
    v.beacon.rotation.x = Math.PI; this.game.scene.add(v.beacon);
    this.victims.push(v);
    return v;
  }
  renderVictim(v, dt) {
    v.t += dt;
    if (v.water && !v.carried && !v.saved) v.pos.y = TL.C.WATER_Y - 0.6 + Math.sin(v.t * 2) * 0.1;
    const mode = v.saved ? 'cheer' : v.carried ? 'restrained' : v.water ? 'cheer' : 'cower';
    if (v.anim) v.anim.update(dt, v.pos, v.carried ? this.game.hero.ctrl.facing : 0, 0, mode);
    v.beacon.position.set(v.pos.x, v.pos.y + 2.6 + Math.sin(v.t * 3) * 0.2, v.pos.z); v.beacon.visible = !v.saved && !v.carried;
    // victims get hurt if enemies stand next to them too long (optional objective)
    if (!v.saved) for (const e of this.game.ai.enemies) if (e.alive && e.state === 'alert' && e.pos.distanceTo(v.pos) < 2) { v.hurtT = (v.hurtT || 0) + dt; if (v.hurtT > 8) v.hurt = true; }
    if (v.saved) { v.walkT = (v.walkT || 0) + dt; if (v.walkT > 6) this.removeVictim(v); }
  }
  victimSaved(v, safe) { v.saved = true; v.pos.copy(safe); this.game.ui.caption('Civilian: "Thank you! Thank you so much!"', 'Civilian'); }
  removeVictim(v) { if (v.sk) this.game.scene.remove(v.sk.mesh); this.game.scene.remove(v.beacon); this.victims = this.victims.filter((x) => x !== v); }
  get count() { return this.peds.length; }
};
