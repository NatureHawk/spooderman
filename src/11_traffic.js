/* =====================================================================================
   TrafficManager — cars, fictional "Metro Cab" taxis, vans, buses, trucks, motorcycles, emergency
   vehicles (sirens), river boats, elevated train. Right-hand lanes on the 80 m road grid, signals at
   every intersection, turns, lane changes, car-following braking, incident avoidance, rain behaviour.
   Every vehicle is a moving collider: the hero can land/run on it or tether it (heavy vehicles brake
   under rope tension — used to stop runaway vehicles). Pooled + instanced; far vehicles skip wheels.
   ===================================================================================== */
'use strict';

/* signal phase at intersection (x,z) — shared with pedestrians */
TL.signalState = function (x, z, t) {
  const off = (TL.hash2(Math.round(x / 80), Math.round(z / 80), 99) % 3000) / 100;
  const c = (t + off) % 30;
  const ns = c < 12 ? 'green' : c < 14.5 ? 'yellow' : 'red';
  const ew = c >= 15 && c < 27 ? 'green' : c >= 27 && c < 29.5 ? 'yellow' : 'red';
  return { ns, ew, nsWalk: ns === 'green' && c < 9 ? 'walk' : 'stop', get ewWalk() { return ew === 'green' && c < 24 ? 'walk' : 'stop'; },
    get nsP() { return this.ew === 'green' ? 'walk' : 'stop'; } };
};

TL.VEHICLE_TYPES = {
  car: { asset: 'VEH_sedan', lo: 'car_sedan', wheelR: 0.335, wheel: 'VEH_wheel_car', len: 4.85, wid: 1.95, h: 1.5, mass: 1400, speed: 13, colors: [0x8a1f24, 0x2a4a6a, 0xd8d4c8, 0x1a1a1c, 0x5a6a5a, 0x9aa0a6, 0x6a4a2a, 0x3a3a60] },
  taxi: { asset: 'VEH_taxi', lo: 'car_taxi', wheelR: 0.325, wheel: 'VEH_wheel_cv', len: 5.4, wid: 1.95, h: 1.7, mass: 1450, speed: 14, colors: [0xffffff] },
  police: { asset: 'VEH_police', lo: 'car_police', wheelR: 0.32, wheel: 'VEH_wheel_cv', len: 5.4, wid: 1.95, h: 1.65, mass: 1600, speed: 16, colors: [0xffffff], siren: true },
  van: { asset: 'VEH_van', lo: 'van', wheel: null, len: 4.4, wid: 2.0, h: 1.75, mass: 2600, speed: 12, colors: [0xffffff] },
  ambulance: { asset: 'VEH_ambulance', lo: 'ambulance', wheel: null, len: 5.8, wid: 2.3, h: 2.3, mass: 3500, speed: 16, colors: [0xffffff], siren: true },
  bus: { asset: 'VEH_bus', lo: 'bus', wheelR: 0.505, wheel: 'VEH_wheel_bus', len: 10.8, wid: 2.6, h: 2.7, mass: 12000, speed: 10, colors: [0xffffff] },
  truck: { asset: 'VEH_truck', lo: 'truck', wheel: null, len: 6.4, wid: 2.5, h: 2.9, mass: 9000, speed: 10, colors: [0xffffff] },
  moto: { asset: 'VEH_moto', lo: 'motorcycle', wheel: null, len: 2.1, wid: 0.8, h: 1.2, mass: 250, speed: 15, colors: [0x2a2a2a, 0x8a1f24, 0x2a6aa8] },
};

TL.Vehicle = class {
  constructor() { this.pos = new THREE.Vector3(); this.reset(); }
  reset() { this.active = false; this.incident=false; this.type = 'car'; this.seg = null; this.lane = 0; this.s = 0; this.speed = 0; this.target = 13; this.yaw = 0; this.col = null; this.idx = -1; this.batch = null; this.wheels = null; this.brake = 0; this.runaway = false; this.stopped = false; this.crashed = false; this.dist = 0; this.laneT = 0; this.honkT = 0; this.color = null; }
};

TL.TrafficManager = class {
  constructor(game) {
    this.game = game;
    this.max = game.quality === 'low' ? 35 : game.quality === 'medium' ? 55 : game.quality === 'high' ? 75 : 95;
    this.vehicles = []; this.pool = new TL.ObjectPool(() => new TL.Vehicle(), (v) => v.reset());
    this.batches = {}; this.wheelBatches = {};
    this.t = 0; this.rng = new TL.RNG(game.seed * 13 + 5);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color();
    this.laneOff = [2.1, 5.6];
    this.nav = (game.streamer && game.streamer.nav) || null;     // scan map: real street graph instead of the 80 m grid
    if (this.nav) { this.boats = []; this.train = null; } else { this.buildBoats(); this.buildTrain(); }
  }
  batchFor(type) {
    const T = TL.VEHICLE_TYPES[type], g = this.game;
    if (this.batches[type]) return this.batches[type];
    const low = g.quality === 'low' && TL.Assets.has(T.lo, 'lo');
    const geo = low ? TL.Assets.geo(T.lo, 'lo') : TL.Assets.geo(T.asset, TL.Assets.pickLod(T.asset, g.quality));
    if (!geo) return null;
    const textured = !!geo.userData.tex;      // user-supplied models wear their own textures; the recolourable slot material is for palette models
    const mat = textured ? TL.Assets.texMats(geo) : TL.Assets.material({ instBody: true, slots: {} });
    const b = new TL.InstanceBatch(g.scene, geo, mat, type === 'car' ? 60 : 24, { color: true });
    this.litMats = this.litMats || []; for (const m of [].concat(mat)) if (m.userData && (m.userData.night || m.userData.glow)) this.litMats.push(m);
    this.batches[type] = b;
    if (!low && T.wheel && TL.Assets.has(T.wheel)) { const wg = TL.Assets.geo(T.wheel, TL.Assets.pickLod(T.wheel, g.quality)); this.wheelBatches[type] = new TL.InstanceBatch(g.scene, wg, wg.userData.tex ? TL.Assets.texMats(wg) : TL.Assets.shared('world'), (type === 'car' ? 60 : 24) * 4, {}); }
    b.wheelsLocal = geo.userData.wheels || null;
    b.lowRot = low;
    return b;
  }
  /* segment: from node A to node B (axis-aligned), direction unit d, right-hand lane offset */
  makeSeg(ax, az, bx, bz) { const len = Math.hypot(bx - ax, bz - az) || 1e-3, dx = (bx - ax) / len, dz = (bz - az) / len; return { ax, az, bx, bz, dx, dz, len, ns: Math.abs(dz) > Math.abs(dx) }; }
  segPos(seg, s, lane, out) {
    // right-hand traffic: for travel direction (dx,dz) the driver's right is (-dz, dx) (y-up, facing +z => right = -x)
    const rx = -seg.dz, rz = seg.dx;
    const off = (seg.lanes || this.laneOff)[lane];
    return out.set(seg.ax + seg.dx * s + rx * off, 0, seg.az + seg.dz * s + rz * off);
  }
  spawnVehicle(focus, typeOverride, near) {
    const g = this.game, L = g.layout, rng = this.rng;
    for (let k = 0; k < 10; k++) {
      let seg;
      if (this.nav) { seg = this.nav.randomSeg(focus, 260, rng); if (!seg) continue; }
      else {
        const ix = Math.round((focus.x + rng.range(-260, 260)) / 80), iz = Math.round((focus.z + rng.range(-260, 260)) / 80);
        const dir = rng.int(0, 3), d = [[1, 0], [-1, 0], [0, 1], [0, -1]][dir];
        const ax = ix * 80, az = iz * 80, bx = ax + d[0] * 80, bz = az + d[1] * 80;
        if (!L.segOK(ax, az, bx, bz)) continue;
        seg = this.makeSeg(ax, az, bx, bz);
      }
      const ax = seg.ax, az = seg.az;
      const v = this.pool.get();
      v.active = true;
      const r = rng.next();
      v.type = typeOverride || (r < 0.5 ? 'car' : r < 0.66 ? 'taxi' : r < 0.74 ? 'van' : r < 0.8 ? 'bus' : r < 0.86 ? 'truck' : r < 0.93 ? 'moto' : r < 0.97 ? 'police' : 'ambulance');
      if (L.district(ax, az) === 'queens' && rng.chance(0.25)) v.type = 'truck';
      const T = TL.VEHICLE_TYPES[v.type];
      v.seg = seg; v.lane = v.type === 'bus' || v.type === 'truck' ? 0 : rng.int(0, 1); v.s = this.nav ? rng.range(0, seg.len) : rng.range(5, 60);
      v.target = T.speed * rng.range(0.85, 1.15); v.speed = v.target * 0.8;
      this.segPos(seg, v.s, v.lane, v.pos);
      if (v.pos.distanceTo(g.hero.ctrl.pos)<8 || this.vehicles.some(o=>o.active&&o.pos.distanceTo(v.pos)<(TL.VEHICLE_TYPES[o.type].len+T.len)*.5+3) || (!near && v.pos.distanceTo(focus) < 50)) { this.pool.release(v); continue; }
      v.yaw = Math.atan2(seg.dx, seg.dz);
      v.color = new THREE.Color(rng.pick(T.colors));
      v.col = g.world.addDynamic(v.pos.x, T.h / 2, v.pos.z, T.wid / 2, T.h / 2, T.len / 2, v.yaw, { kind: 'vehicle', mass: T.mass, anchor: true, climb: true, owner: v });
      v.col.walkTop = true;
      // rope tension on a vehicle acts as a brake scaled by its mass (heavy vehicles resist more)
      v.tetherDrag = (F, nx, ny, nz, h) => { v.brake += (F / T.mass) * h * 1.6; };
      this.vehicles.push(v);
      return v;
    }
    return null;
  }
  despawn(v, k) {
    if (v.batch) v.batch.free(v);
    if (v.wheels) for (const w of v.wheels) if (w.batch) w.batch.free(w);
    v.wheels = null;
    if (v.col) this.game.world.removeDynamic(v.col);
    if (k !== undefined) this.vehicles.splice(k, 1); else this.vehicles = this.vehicles.filter((x) => x !== v);
    this.pool.release(v);
  }
  nextSeg(v) {
    if (this.nav) return this.nav.nextSeg(v.seg, v.runaway);
    const L = this.game.layout, s = v.seg, bx = s.bx, bz = s.bz;
    const opts = [];
    const dirs = [[s.dx, s.dz, 'straight'], [-s.dz, s.dx, 'left'], [s.dz, -s.dx, 'right']];
    for (const [dx, dz, kind] of dirs) { const nx = bx + dx * 80, nz = bz + dz * 80; if (L.segOK(bx, bz, nx, nz)) opts.push({ seg: this.makeSeg(bx, bz, nx, nz), kind }); }
    if (!opts.length) { return this.makeSeg(bx, bz, s.ax, s.az); }   // dead end: U-turn
    const r = Math.random();
    const straight = opts.find((o) => o.kind === 'straight');
    if (straight && (r < 0.6 || v.runaway)) return straight.seg;
    return opts[Math.floor(Math.random() * opts.length)].seg;
  }
  update(dt, focus) {
    const g = this.game;
    this.t += dt;
    const rain = g.env.rain;
    if (this.vehicles.filter((v) => !v.runaway).length < this.max && Math.random() < 0.5) this.spawnVehicle(focus);
    let siren = 0, trafficNear = 0;
    const h = g.hero.ctrl;
    for (let k = this.vehicles.length - 1; k >= 0; k--) {
      const v = this.vehicles[k];
      const d = v.pos.distanceTo(focus);
      if (d > 320 && !v.runaway) { this.despawn(v, k); continue; }
      this.drive(v, dt, rain);
      const T = TL.VEHICLE_TYPES[v.type];
      if (T.siren && d < 150) siren = Math.max(siren, 1 - d / 150);
      if (d < 60) trafficNear += (1 - d / 60) * 0.25;
      this.render(v, d);
    }
    g.audio.sirenLevel = siren; g.audio.trafficLevel = Math.min(1, trafficNear);
    if (this.litMats) {      // bus lamps at night; police light bars flash while a siren is near
      const night = g.env.night || 0, fl = Math.sin(this.t * 11) > 0, fl2 = Math.sin(this.t * 11 + 3) > 0;
      for (const m of this.litMats) {
        const u = m.userData;
        if (u.night) m.emissiveIntensity = night * u.night;
        else if (u.flash) { m.emissive.setRGB(fl ? 1 : 0.05, fl ? 0.04 : 0.05, fl ? 0.04 : 0.9 * (fl2 ? 1 : 0.1)); m.emissiveIntensity = siren > 0.02 ? 1.6 : 0.0; }
        else m.emissiveIntensity = night * u.glow;
      }
    }
    this.updateBoats(dt); this.updateTrain(dt);
  }
  leaderGap(v) {
    let gap = 999;
    for (const o of this.vehicles) {
      if (o === v || !o.seg) continue;
      if (o.seg.ax === v.seg.ax && o.seg.az === v.seg.az && o.seg.dx === v.seg.dx && o.seg.dz === v.seg.dz && o.lane === v.lane && o.s > v.s) gap = Math.min(gap, o.s - v.s - (TL.VEHICLE_TYPES[o.type].len+TL.VEHICLE_TYPES[v.type].len)*.5);
      else if (o.seg.ax === v.seg.bx && o.seg.az === v.seg.bz && o.seg.dx === v.seg.dx && o.seg.dz === v.seg.dz && o.lane === v.lane) gap = Math.min(gap, v.seg.len - v.s + o.s - (TL.VEHICLE_TYPES[o.type].len+TL.VEHICLE_TYPES[v.type].len)*.5);
    }
    return gap;
  }
  drive(v, dt, rain) {
    const g = this.game, T = TL.VEHICLE_TYPES[v.type], seg = v.seg;
    let target = v.target * (1 - rain * 0.2);
    if (v.runaway) target = v.runTarget;
    // car following
    const gap = v.runaway ? 999 : this.leaderGap(v);
    if (gap < 30) target = Math.min(target, Math.max(0, (gap - 4) * 0.8));
    // Keep the existing lane: instant lane changes cut through queued vehicles.
    // signals: stop line 15 m before the intersection node
    const toEnd = seg.len - v.s;
    if (!v.runaway && seg.sig !== false && toEnd < 30 && toEnd > 12) {
      const sig = TL.signalState(seg.bx, seg.bz, this.t);
      const st = seg.ns ? sig.ns : sig.ew;
      if (st === 'red' || (st === 'yellow' && toEnd > 20)) {
        if (!T.siren) target = Math.min(target, Math.max(0, (toEnd - 15) * 0.9));
        else target = Math.min(target, 6);
      }
    }
    // incident avoidance: hero or fights on the road ahead -> brake and honk
    const ahead = this._ahead || (this._ahead = new THREE.Vector3());
    ahead.set(v.pos.x + Math.sin(v.yaw) * 10, 0, v.pos.z + Math.cos(v.yaw) * 10);
    const hp = g.hero.ctrl.pos;
    if (!v.runaway && Math.hypot(hp.x - ahead.x, hp.z - ahead.z) < 6 && hp.y < 3) { target = 0; v.honkT -= dt; if (v.honkT <= 0) { v.honkT = 3; if (v.pos.distanceTo(hp) < 40) g.audio.sfx('horn'); } }
    for (const e of g.ai.enemies) if (e.alive && e.state === 'alert' && Math.abs(e.pos.y-v.pos.y)<3 && Math.hypot(e.pos.x - ahead.x, e.pos.z - ahead.z) < 10) { target = 0; break; }
    if (v.runaway && v.brake > 0) { v.runTarget = Math.max(0, v.runTarget - v.brake * 2.2); }
    if(v.incident)target=0;
    // Longitudinal stopping distance, with a narrow lane corridor and vertical gate.
    let obstacle=999;
    const blockers=[g.hero.ctrl.pos,...(g.crowd?g.crowd.peds.filter(p=>p.alive).map(p=>p.pos):[])];
    for(const p of blockers){
      if(Math.abs(p.y-v.pos.y)>2.8)continue;
      const dx=p.x-v.pos.x,dz=p.z-v.pos.z,along=dx*seg.dx+dz*seg.dz,side=Math.abs(-dx*seg.dz+dz*seg.dx);
      if(along>0&&side<T.wid*.5+.55)obstacle=Math.min(obstacle,along-T.len*.5-.7);
    }
    if(!v.runaway)target=Math.min(target,Math.sqrt(2*5*Math.max(0,Math.min(gap-2,obstacle-1))));
    // integrate speed (tether drag acts as brake)
    const acc = target > v.speed ? 3.0 : 7.0;
    v.speed += TL.clamp(target - v.speed, -acc * dt, acc * dt);
    v.speed = Math.max(0, v.speed - v.brake);
    v.brake = 0;
    if (v.runaway && v.speed < 0.6 && v.runTarget < 1) { v.stopped = true; }
    let travel=v.speed*dt;
    if(!v.runaway)travel=Math.min(travel,Math.max(0,Math.min(gap-1.5,obstacle-.6)));
    if(travel<v.speed*dt)v.speed=travel/Math.max(dt,.001);
    v.s += travel; v.dist += travel;
    if (v.s >= seg.len) { v.s -= seg.len; v.seg = this.nextSeg(v); }
    const prev = v.pos.clone();
    this.segPos(v.seg, v.s, v.lane, v.pos);
    // smooth turns: yaw follows the motion direction, position eased across lane/segment switches
    const mv = v.pos.clone().sub(prev);
    if (mv.lengthSq() > 1e-6 && mv.length() < 8) v.yaw = TL.dampAngle(v.yaw, Math.atan2(mv.x, mv.z), 8, dt);
    else if (mv.length() >= 8) v.yaw = Math.atan2(v.seg.dx, v.seg.dz);
    g.world.moveDynamic(v.col, v.pos.x, T.h / 2, v.pos.z, v.yaw, dt);
  }
  render(v, d) {
    const b = this.batchFor(v.type); if (!b) return;
    const T = TL.VEHICLE_TYPES[v.type];
    // Blender vehicles face +X; rotate so +X aligns with travel yaw
    this._q.setFromAxisAngle(TL._UP || (TL._UP = new THREE.Vector3(0, 1, 0)), v.yaw - Math.PI / 2);
    this._m.compose(v.pos, this._q, this._s);
    if (!v.batch) b.alloc(v, this._m, v.color); else b.set(v, this._m);
    const wb = this.wheelBatches[v.type];
    if (wb && b.wheelsLocal && d < 140) {
      if (!v.wheels) { v.wheels = []; for (let k = 0; k < b.wheelsLocal.length * 2; k++) v.wheels.push({ idx: -1, batch: null }); }
      const spin = v.dist / (T.wheelR || 0.33);
      let k = 0;
      for (const w of b.wheelsLocal) for (const sg of [1, -1]) {
        // wheel sockets exported in vehicle-local game space; the wheel asset's outer face points +Z
        const lp = new THREE.Vector3(w[0], w[1], w[2] * sg);
        const outward = lp.z > 0 ? 1 : -1;
        const wp = lp.applyQuaternion(this._q).add(v.pos);
        const q = this._q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), outward > 0 ? 0 : Math.PI)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -spin * outward));
        const m = new THREE.Matrix4().compose(wp, q, this._s);
        const o = v.wheels[k++];
        if (!o.batch) wb.alloc(o, m); else wb.set(o, m);
      }
    } else if (v.wheels) { for (const w of v.wheels) if (w.batch) w.batch.free(w); v.wheels = null; }
  }
  /* ---------------------------------------------------------------- runaway / pursuit vehicles */
  spawnRunaway(kind, near, pursuit) {
    const type = kind === 'bus' ? 'bus' : kind === 'truck' ? 'truck' : kind === 'van' ? 'van' : 'car';
    const v = this.spawnVehicle(near.clone().add(new THREE.Vector3(60, 0, 60)), type, true);
    if (!v) return { pos: near.clone(), speed: 0, stopped: true, crashed: false };
    v.runaway = true; v.runTarget = type === 'bus' ? 20 : 26; v.speed = v.runTarget * 0.7;
    v.col.mass = TL.VEHICLE_TYPES[type].mass;
    if (pursuit) g_toastSafe(this.game, 'Getaway vehicle — tether it and hold to brake!');
    return v;
  }
  releaseRunaway(v) { if (v && v.runaway) { v.runaway = false; v.target = 0; setTimeout(() => { if (v.active) v.target = TL.VEHICLE_TYPES[v.type].speed; }, 8000); } }
  /* ---------------------------------------------------------------- boats + train */
  buildBoats() {
    const g = this.game;
    this.boats = [];
    const geo = TL.Assets.geo('VEH_boat', TL.Assets.pickLod('VEH_boat', g.quality)) || TL.Assets.geo('boat', 'lo');
    if (!geo) return;
    const mat = TL.Assets.material({ slots: { 7: 0x2a4a6a } });
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.scene.add(m);
      const b = { m, x: 200 + k * 25, z: -700 + k * 380, dir: k % 2 ? 1 : -1, speed: 6 + k, bob: k };
      b.col = g.world.addDynamic(b.x, TL.C.WATER_Y + 1, b.z, 1.6, 1.2, 4.7, 0, { kind: 'vehicle', mass: 6000, anchor: true, climb: true });
      this.boats.push(b);
    }
  }
  updateBoats(dt) {
    for (const b of this.boats) {
      b.z += b.dir * b.speed * dt; b.bob += dt;
      if (b.z > 780) b.dir = -1; if (b.z < -780) b.dir = 1;
      const y = TL.C.WATER_Y + Math.sin(b.bob * 1.3) * 0.15;
      b.m.position.set(b.x, y, b.z); b.m.rotation.set(Math.sin(b.bob) * 0.03, b.dir > 0 ? -Math.PI / 2 : Math.PI / 2, Math.sin(b.bob * 0.7) * 0.04);
      this.game.world.moveDynamic(b.col, b.x, y + 1, b.z, 0, dt);
    }
  }
  buildTrain() {
    const g = this.game, L = g.layout;
    const geo = TL.Assets.geo('VEH_train', TL.Assets.pickLod('VEH_train', g.quality)) || TL.Assets.geo('train_car', 'lo');
    this.train = null; if (!geo) return;
    const mat = TL.Assets.material({ slots: {} });
    const cars = [];
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.scene.add(m);
      const col = g.world.addDynamic(L.railX, 13, L.railZ0, 1.45, 1.7, 8.8, 0, { kind: 'vehicle', mass: 30000, anchor: true, climb: true });
      cars.push({ m, col });
    }
    this.train = { cars, s: 0, dir: 1, speed: 14, wait: 0 };
  }
  updateTrain(dt) {
    const T = this.train; if (!T) return;
    const L = this.game.layout, len = L.railZ1 - L.railZ0 - 60;
    if (T.wait > 0) T.wait -= dt;
    else { T.s += T.dir * T.speed * dt; if (T.s > len) { T.s = len; T.dir = -1; T.wait = 6; } if (T.s < 0) { T.s = 0; T.dir = 1; T.wait = 6; } }
    T.cars.forEach((c, k) => {
      const z = L.railZ0 + 30 + T.s - k * 18.2;
      c.m.position.set(L.railX, 11.25, z); c.m.rotation.y = -Math.PI / 2;
      this.game.world.moveDynamic(c.col, L.railX, 13, z, 0, dt);
    });
  }
  get count() { return this.vehicles.length; }
};
function g_toastSafe(g, msg) { if (g.ui) g.ui.toast(msg); }
