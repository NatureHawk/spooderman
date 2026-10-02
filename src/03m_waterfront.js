/* =====================================================================================
   WATERFRONT — quay wall, smooth deck edge, railings, bollards, lamps, ladders, benches, moored boats and the moving
   harbour traffic (ferries, tugs with barges, tour boats, water taxis, sailboats) for the scan map (seed MAN).
   Data: tools/scan/waterfront.py -> extra/waterfront_meta.json + waterfront_data.bin.gz + waterfront_wall/deck.webp
         tools/hd/life_props.py + life_water.py -> extra/life_models.* (models used here: rail_*, bollard, lamp, ring, ladder,
         wf_bench and the boats)
   Water SHADING is 20_atmos.js; this module owns the geometry and props only.
     quay wall   granite blocks from the deck to 3.9 m below the water along the smoothed shoreline
     apron       a narrow deck that fills the 2 m stair-steps of the scan's land mask; the layout treats it as land
     harbour     TL.Harbor: vessels follow smoothed routes, bob / roll, leave a fading wake, are moving colliders
   ===================================================================================== */
'use strict';

TL.Waterfront = {
  async load() {
    const X = TL.Extra;
    if (!X || !X.has('waterfront_meta.json') || !X.has('waterfront_data.bin.gz')) return null;
    const meta = await X.json('waterfront_meta.json'), buf = await X.buffer('waterfront_data.bin.gz');
    const T = { float32: Float32Array, uint8: Uint8Array };
    const a = {};
    for (const [k, p] of Object.entries(meta.parts)) a[k] = new T[p.t](buf, p.o, p.n);
    const imgs = {};
    for (const f of ['waterfront_wall.webp', 'waterfront_deck.webp']) if (X.has(f)) imgs[f] = await X.image(f);
    return { meta, a, imgs };
  },
  tex(img, renderer) {
    const t = new THREE.Texture(img); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true; return t;
  },
  /* one-time: meshes + the apron treated as land by the layout */
  ensure(world) {
    if (world.waterfront) return world.waterfront;
    const D = world.data.waterfront; if (!D) return null;
    const WF = world.waterfront = { D, meshes: [] }, r = world.game.renderer, a = D.a, F = D.meta.frame;
    const mk = (pos, nrm, uv, mat, name, shadow) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); else g.computeVertexNormals();
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.name = name; m.receiveShadow = true; m.castShadow = !!shadow; m.matrixAutoUpdate = false;
      world.scene.add(m); WF.meshes.push(m); return m;
    };
    if (a.wall_p.length) {
      const t = this.tex(D.imgs['waterfront_wall.webp'], r);
      const wallMat = WF.wallMat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });      // the wall faces the water and sits in shade: lit like the scan (baked-in light)
      mk(a.wall_p, a.wall_n, a.wall_uv, wallMat, 'WF_wall', false);
    }
    if (a.apron_p.length) {
      const t = this.tex(D.imgs['waterfront_deck.webp'], r);
      mk(a.apron_p, null, a.apron_uv, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0 }), 'WF_apron', false);
    }
    // apron bit raster -> layout
    const bits = a.apron_bits, W = F.w, H = F.h;
    const has = (x, z) => {
      const c = Math.floor((x - F.x0) / F.rc), rr = Math.floor((z - F.z0) / F.rc);
      if (c < 0 || rr < 0 || c >= W || rr >= H) return false;
      const i = rr * W + c; return (bits[i >> 3] >> (i & 7)) & 1;
    };
    WF.apron = has;
    const L = world.layout, isW = L.isWater.bind(L), g0 = L.ground.bind(L), S = TL.Streets;
    L.isWater = (x, z) => isW(x, z) && !has(x, z);
    L.ground = (x, z) => {
      const g = g0(x, z);
      if (g < -1 && has(x, z)) return S && S.data && (S.raised(x - 2.4, z) || S.raised(x + 2.4, z) || S.raised(x, z - 2.4) || S.raised(x, z + 2.4)) ? D.meta.deckY : -0.02;
      return g;
    };
    this.cleanScan(world, D.meta.scanClean || []);
    return WF;
  },
  /* drop leftover scan shards (tall-ship hull, mooring lines ...) inside the given x/z boxes: tile triangles + their heightfield colliders */
  cleanScan(world, boxes) {
    if (!boxes.length || !world.group) return;
    const inside = (x, z) => { for (const b of boxes) if (x > b[0] && x < b[1] && z > b[2] && z < b[3]) return true; return false; };
    let removed = 0;
    for (const m of world.group.children) {
      const g = m.geometry, bs = g.boundingSphere; if (!bs) continue;
      let hit = false; for (const b of boxes) if (bs.center.x + bs.radius > b[0] && bs.center.x - bs.radius < b[1] && bs.center.z + bs.radius > b[2] && bs.center.z - bs.radius < b[3]) hit = true;
      if (!hit) continue;
      const P = g.attributes.position.array, I = g.index.array, keep = [];
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
        if (cy > 0.3 && inside(cx, cz)) { removed++; continue; }
        keep.push(I[t], I[t + 1], I[t + 2]);
      }
      if (keep.length !== I.length) g.setIndex(new THREE.BufferAttribute(I instanceof Uint32Array ? new Uint32Array(keep) : new Uint16Array(keep), 1));
    }
    let cols = 0;
    for (const b of boxes) {
      const list = world.world.query(b[0], b[2], b[1], b[3], []);
      for (const c of list) if (c.src === 'scan' && c.cx > b[0] && c.cx < b[1] && c.cz > b[2] && c.cz < b[3]) { world.world.removeStatic(c); cols++; }
    }
    world.stats.scanCleaned = { tris: removed, colliders: cols };
  },
};

/* ------------------------------------------------------------------ moving instanced set (harbour vessels) */
TL.LifeDynamicSet = class {
  constructor(scene, renderer, data, model, capacity) {
    const M = data.meta.models[model]; this.model = model; this.cap = capacity; this.meshes = []; this.attr = [];
    for (const part of M.parts) {
      const g = TL.LifeProps.geometry(data.buf, part), mat = TL.LifeProps.material(data.meta.mats[part.mat], data.imgs, renderer);
      const im = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16); im.setUsage(THREE.DynamicDrawUsage);
      const mesh = new THREE.InstancedMesh(g, mat, capacity); mesh.instanceMatrix = im; mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.visible = false; mesh.name = 'HARBOR_' + model + '_' + part.mat;
      scene.add(mesh); this.meshes.push(mesh); this.attr.push(im);
    }
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(m4) { for (const im of this.attr) im.array.set(m4.elements, this.n * 16); this.n++; }
  end() { for (let k = 0; k < this.meshes.length; k++) { this.meshes[k].visible = this.n > 0; this.meshes[k].count = this.n; this.attr[k].needsUpdate = this.n > 0; if (this.n) this.attr[k].updateRange.count = this.n * 16; } }
};

/* ------------------------------------------------------------------ harbour traffic */
TL.Harbor = class {
  constructor(world, data, life) {
    this.world = world; this.game = world.game; this.t = 0;
    const meta = data.meta, scene = world.scene, rng = new TL.RNG(4242);
    const dims = { ferry_si: [78, 18], ferry_nyw: [36, 9], tug_tow: [66, 11.5], tour: [30, 8], taxi: [14, 4.2], sailboat: [15, 4.6], yacht: [22, 6], tug: [24, 8] };
    this.routes = [];
    for (const [name, R] of Object.entries(meta.routes)) {
      // smooth the control polyline (Chaikin x3), then cumulative length
      let P = R.pts.map((p) => [p[0], p[1]]);
      for (let it = 0; it < 3; it++) {
        const Q = [P[0]];
        for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; Q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
        if (R.loop) { const a = P[P.length - 1], b = P[0]; Q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); Q.shift(); } else Q.push(P[P.length - 1]);
        P = Q;
      }
      if (R.loop) P.push(P[0]);
      const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      this.routes.push({ name, R, P, cum, len: cum[cum.length - 1] });
    }
    this.sets = {}; this.vessels = [];
    const count = {};
    for (const rt of this.routes) {
      const n = rt.R.loop ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const type = rt.R.types[(k + (rng.next() * rt.R.types.length | 0)) % rt.R.types.length];
        if (!life.lifeModels.meta.models[type]) continue;
        const cyc = rt.R.loop ? rt.len / rt.R.speed : Math.max(rt.R.period || 0, rt.len / rt.R.speed + 30);
        this.vessels.push({ rt, type, phase: rng.next() * cyc, cyc, ph: rng.next() * 6.28, k, dims: dims[type] || [20, 6], pos: [0, 0], yaw: 0, active: false, trail: [] });
        count[type] = (count[type] || 0) + 1;
      }
    }
    for (const [type, n] of Object.entries(count)) this.sets[type] = new TL.LifeDynamicSet(scene, world.game.renderer, life.lifeModels, type, n);
    // wakes: one fading ribbon per vessel
    this.wakeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
    for (const v of this.vessels) {
      const N = 26, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      v.wake = new THREE.Mesh(g, this.wakeMat); v.wake.frustumCulled = false; v.wake.renderOrder = 2; v.wake.visible = false; scene.add(v.wake); v.wakeN = N;
      v.col = world.world.addDynamic(0, -50, 0, v.dims[1] / 2 * 0.85, 1.3, v.dims[0] / 2 * 0.9, 0, { kind: 'vehicle', mass: 200000, anchor: true, climb: true, src: 'harbor' });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }
  /* camera frustum test on the vessel's ground position (radius = half length) */
  inView(x, z, len) {
    const cam = this.game.camera, f = this._fr || (this._fr = new THREE.Frustum()), pm = this._pm || (this._pm = new THREE.Matrix4());
    if (this._frT !== this.t) { this._frT = this.t; pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); f.setFromProjectionMatrix(pm); }
    const r = len * 0.5 + 6, y = TL.C.WATER_Y + 3;
    for (let k = 0; k < 6; k++) { const pl = f.planes[k]; if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -r) return false; }
    return true;
  }
  at(rt, s, out) {
    const c = rt.cum, P = rt.P; let lo = 0, hi = c.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const f = (s - c[lo]) / ((c[hi] - c[lo]) || 1);
    out[0] = P[lo][0] + (P[hi][0] - P[lo][0]) * f; out[1] = P[lo][1] + (P[hi][1] - P[lo][1]) * f; return out;
  }
  update(dt, focus) {
    this.t += dt; const T = this.t, W = TL.C.WATER_Y, tmpA = [0, 0], tmpB = [0, 0];
    for (const s of Object.values(this.sets)) s.begin();
    for (const v of this.vessels) {
      const rt = v.rt, R = rt.R, tt = (T + v.phase) % v.cyc;
      let s = tt * R.speed;
      if (R.loop) s = s % rt.len;
      v.active = R.loop || s < rt.len;
      if (!v.active) { v.wake.visible = false; v.col.pos && v.col.pos.set(0, -80, 0); this.world.world.moveDynamic(v.col, 0, -80, 0, 0, dt); continue; }
      this.at(rt, s, tmpA); this.at(rt, (s + 6) % (R.loop ? rt.len : 1e9) || s + 6, tmpB);
      if (!R.loop && s + 6 > rt.len) { this.at(rt, s - 6, tmpB); const dx = tmpA[0] - tmpB[0], dz = tmpA[1] - tmpB[1]; tmpB[0] = tmpA[0] + dx; tmpB[1] = tmpA[1] + dz; }
      const yaw = Math.atan2(tmpB[0] - tmpA[0], tmpB[1] - tmpA[1]);
      let dy = yaw - v.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      v.yaw = v.active && v.seen ? v.yaw + dy * Math.min(1, dt * 1.5) : yaw; v.seen = true;
      v.pos[0] = tmpA[0]; v.pos[1] = tmpA[1];
      const d = Math.hypot(tmpA[0] - focus.x, tmpA[1] - focus.z);
      const y = W + Math.sin(T * 0.8 + v.ph) * 0.11;
      this.world.world.moveDynamic(v.col, tmpA[0], y + 1.1, tmpA[1], v.yaw, dt);
      if (d > 900 || !this.inView(tmpA[0], tmpA[1], v.dims[0])) { v.wake.visible = d < 300; if (d >= 300) continue; if (!this.inView(tmpA[0], tmpA[1], v.dims[0] + 80)) { v.wake.visible = false; continue; } }
      const set = this.sets[v.type];
      const roll = Math.sin(T * 0.6 + v.ph) * 0.018 + (dy * 0.4), pitch = Math.sin(T * 0.7 + v.ph * 1.7) * 0.007;
      this._e.set(pitch, v.yaw, roll, 'YXZ'); this._q.setFromEuler(this._e); this._p.set(tmpA[0], y, tmpA[1]);
      this._m.compose(this._p, this._q, this._s); set.push(this._m);
      // wake ribbon behind the stern
      const N = v.wakeN, pos = v.wake.geometry.attributes.position.array, col = v.wake.geometry.attributes.color.array, L = v.dims[0], B = v.dims[1];
      for (let i = 0; i < N; i++) {
        const back = L * 0.42 + i * (2.2 + L * 0.03);
        let sb = s - back; if (R.loop) sb = ((sb % rt.len) + rt.len) % rt.len; else sb = Math.max(0, sb);
        this.at(rt, sb, tmpB); this.at(rt, Math.min(rt.len, sb + 3), tmpA);
        let hx = tmpA[0] - tmpB[0], hz = tmpA[1] - tmpB[1]; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
        const w = B * 0.45 + i * (0.55 + B * 0.035);
        pos[i * 6] = tmpB[0] - hz * w; pos[i * 6 + 1] = W + 0.07; pos[i * 6 + 2] = tmpB[1] + hx * w;
        pos[i * 6 + 3] = tmpB[0] + hz * w; pos[i * 6 + 4] = W + 0.07; pos[i * 6 + 5] = tmpB[1] - hx * w;
        const a = Math.max(0, 1 - i / (N - 1)) ** 1.6 * Math.min(1, R.speed / 4) * 0.34;
        for (let k = 0; k < 2; k++) { const o = (i * 2 + k) * 4; col[o] = 0.92; col[o + 1] = 0.96; col[o + 2] = 0.98; col[o + 3] = a * (k ? 1 : 1); }
      }
      v.wake.geometry.attributes.position.needsUpdate = true; v.wake.geometry.attributes.color.needsUpdate = true; v.wake.visible = true;
    }
    for (const s of Object.values(this.sets)) s.end();
  }
};

/* ------------------------------------------------------------------ placements through the life-prop sets */
TL.LifeProps.sources.push((world) => {
  const WF = TL.Waterfront.ensure(world); if (!WF) return [];
  const D = WF.D, a = D.a, M = D.meta, ground = (x, z) => Math.max(-0.02, world.layout.ground(x, z)), out = [];
  const arr = (k, stride) => { const A = a['pl_' + k]; return A ? A : new Float32Array(0); };
  const list = (k, stride, fn) => { const A = arr(k), r = []; for (let i = 0; i + stride <= A.length; i += stride) r.push(fn(A, i)); return r; };
  const yawOut = (v) => v;
  out.push({ model: 'rail_iron', dist: 95, shadow: false, list: list('rail_iron', 4, (A, i) => ({ x: A[i], y: ground(A[i], A[i + 1]), z: A[i + 1], yaw: A[i + 2], s: 1 })) });
  out.push({ model: 'rail_cable', dist: 95, shadow: false, list: list('rail_cable', 4, (A, i) => ({ x: A[i], y: ground(A[i], A[i + 1]), z: A[i + 1], yaw: A[i + 2], s: 1 })) });
  out.push({ model: 'dock_finger', dist: 260, shadow: false, list: list('dock', 3, (A, i) => ({ x: A[i], y: 0.15, z: A[i + 1], yaw: A[i + 2] })), col: { hx: 7, hy: 0.15, hz: 1.2, cx: 8.5, cy: -2.95 } });
  out.push({ model: 'bollard', dist: 110, shadow: false, list: list('bollard', 3, (A, i) => ({ x: A[i], y: ground(A[i], A[i + 1]), z: A[i + 1], yaw: yawOut(A[i + 2]) })), col: { hx: 0.2, hy: 0.25, hz: 0.2, cy: 0.25 } });
  out.push({ model: 'lamp', dist: 150, shadow: true, list: list('lamp', 3, (A, i) => ({ x: A[i], y: ground(A[i], A[i + 1]), z: A[i + 1], yaw: A[i + 2] })), col: { hx: 0.09, hy: 2.2, hz: 0.09, cy: 2.2 } });
  out.push({ model: 'ring', dist: 90, shadow: false, list: list('ring', 3, (A, i) => ({ x: A[i], y: ground(A[i], A[i + 1]), z: A[i + 1], yaw: A[i + 2] })) });
  out.push({ model: 'ladder', dist: 90, shadow: false, list: list('ladder', 3, (A, i) => ({ x: A[i], y: ground(A[i], A[i + 1]), z: A[i + 1], yaw: A[i + 2] })) });
  out.push({ model: 'wf_bench', dist: 120, shadow: true, list: list('bench', 3, (A, i) => ({ x: A[i], y: ground(A[i], A[i + 1]), z: A[i + 1], yaw: A[i + 2] })), col: { hx: 0.3, hy: 0.25, hz: 0.9, cy: 0.25 } });
  // moored boats: static instances + a box the hero can land on
  const byType = {};
  for (const b of M.boats) (byType[b.type] || (byType[b.type] = [])).push(b);
  for (const [type, bs] of Object.entries(byType)) {
    out.push({ model: type, dist: 700, list: bs.map((b) => ({ x: b.x, y: TL.C.WATER_Y, z: b.z, yaw: b.yaw })), col: { hx: bs[0].beam * 0.44, hy: 1.4, hz: bs[0].len * 0.46, cy: 1.2 } });
  }
  return out;
});

if (TL.ScanHooks) {
  TL.ScanHooks.load.push(async (data) => {
    try { data.waterfront = await TL.Waterfront.load(); } catch (e) { TL.logError ? TL.logError(e, 'waterfront') : console.error(e); data.waterfront = null; }
  });
  TL.ScanHooks.build.push((world) => {
    try {
      const WF = TL.Waterfront.ensure(world); if (!WF || !world.data.lifeModels) return;
      world.harbor = new TL.Harbor(world, WF.D, world.data);
      world.stats.harbor = world.harbor.vessels.length;
    } catch (e) { TL.logError ? TL.logError(e, 'waterfront') : console.error(e); }
  });
  TL.ScanHooks.update.push((world, focus, vel, dt) => {
    if (world.harbor) world.harbor.update(dt, focus);
    const WF = world.waterfront, e = world.game.env;
    if (WF && WF.wallMat && e) WF.wallMat.emissiveIntensity = 0.05 + 0.3 * (1 - (e.night || 0)) * (1 - (e.rain || 0) * 0.3);
    if (world.lifeSets && e) {                                       // lamp heads glow after dark only
      if (!WF.lampMats) { WF.lampMats = []; for (const set of world.lifeSets) if (set.model === 'lamp') for (const m of set.meshes) if (m.material.emissive && m.name.indexOf('glow') >= 0) WF.lampMats.push(m.material); }
      const k = 2.4 * Math.min(1, (e.night || 0) * 1.6); for (const m of WF.lampMats) m.emissiveIntensity = k;
    }
  });
}
