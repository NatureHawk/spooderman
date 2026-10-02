/* =====================================================================================
   LIFE PROPS — hot-dog carts, brownstone stoops, bus shelters and the waterfront kit (seed MAN).
   Models: tools/hd/life_props.py (+ life_water.py) -> extra/life_models.{json,bin.gz} + life_tex_*.webp
   Placements come from sources registered in TL.LifeProps.sources (each returns [{ model, list:[{x,y,z,yaw,s,tint}], dist, shadow, col }]):
     crowd_nav.json carts / stoops / shelters (tools/scan/crowd_nav.py) and the waterfront module (tools/scan/waterfront.py).
   One InstancedMesh per (model, material); instances are re-binned by distance + frustum when the camera moves.
   ===================================================================================== */
'use strict';

TL.LifeProps = {
  sources: [],
  /* decode geometry + textures from TL.Extra -> { meta, buf, imgs } */
  async load() {
    const X = TL.Extra;
    if (!X || !X.has('life_models.json') || !X.has('life_models.bin.gz')) return null;
    const meta = await X.json('life_models.json'), buf = await X.buffer('life_models.bin.gz'), imgs = {};
    const want = new Set();
    for (const m of Object.values(meta.mats)) { if (m.map) want.add(m.map); if (m.alphaMap) want.add(m.alphaMap); }
    await Promise.all([...want].map(async (f) => { if (X.has(f)) imgs[f] = await X.image(f); }));
    return { meta, buf, imgs };
  },
  geometry(buf, p) {
    const n = p.n, g = new THREE.BufferGeometry();
    const nrm = new Int8Array(buf, p.nrm, n * 4), N = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { N[k * 3] = nrm[k * 4] / 127; N[k * 3 + 1] = nrm[k * 4 + 1] / 127; N[k * 3 + 2] = nrm[k * 4 + 2] / 127; }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, p.pos, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, p.uv, n * 2), 2));
    g.setIndex(new THREE.BufferAttribute(p.i32 ? new Uint32Array(buf, p.idx, p.i) : new Uint16Array(buf, p.idx, p.i), 1));
    g.computeBoundingSphere();
    return g;
  },
  material(info, imgs, renderer) {
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const tex = (f, srgb) => { if (!f || !imgs[f]) return null; const t = new THREE.Texture(imgs[f]); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso; t.needsUpdate = true; return t; };
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(info.color[0], info.color[1], info.color[2]), roughness: info.rough, metalness: info.metal, side: THREE.DoubleSide });
    if (info.map) { m.map = tex(info.map, true); m.color.setRGB(1, 1, 1); }
    if (info.alphaMap) { m.alphaMap = tex(info.alphaMap, false); m.alphaTest = 0.5; m.shadowSide = THREE.DoubleSide; }
    if (info.emit) { m.emissive = new THREE.Color(info.emit[0], info.emit[1], info.emit[2]); m.emissiveIntensity = info.emit[3] || 1; }
    if (info.alpha) { m.transparent = true; m.opacity = info.alpha; m.depthWrite = false; }
    return m;
  },
};

/* the instanced set for one model: all placements, culled per frame */
TL.LifePropSet = class {
  constructor(scene, renderer, data, model, spec) {
    const M = data.meta.models[model]; this.model = model; this.spec = spec; this.list = spec.list;
    const n = this.list.length;
    this.mat = new Float32Array(n * 16); this.bs = new Float32Array(n * 4);
    const bb = M.bbox, cx = (bb[0][0] + bb[1][0]) / 2, cy = (bb[0][1] + bb[1][1]) / 2, cz = (bb[0][2] + bb[1][2]) / 2;
    const rad = Math.hypot(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1], bb[1][2] - bb[0][2]) / 2;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Vector3();
    this.list.forEach((t, i) => {
      const k = t.s || 1;
      p.set(t.x, t.y, t.z); q.setFromAxisAngle(up, t.yaw || 0); s.set(k, k, k); m4.compose(p, q, s); m4.toArray(this.mat, i * 16);
      c.set(cx * k, cy * k, cz * k).applyQuaternion(q);
      this.bs[i * 4] = t.x + c.x; this.bs[i * 4 + 1] = t.y + c.y; this.bs[i * 4 + 2] = t.z + c.z; this.bs[i * 4 + 3] = rad * k;
    });
    this.meshes = [];
    this.attr = [];
    for (const part of M.parts) {
      const info = data.meta.mats[part.mat];
      const g = TL.LifeProps.geometry(data.buf, part), mat = TL.LifeProps.material(info, data.imgs, renderer);
      const im = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 16), 16); im.setUsage(THREE.DynamicDrawUsage);
      const mesh = new THREE.InstancedMesh(g, mat, Math.max(1, n));
      mesh.instanceMatrix = im; mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      mesh.castShadow = spec.shadow === true && !info.alpha; mesh.receiveShadow = true; mesh.visible = false;      // shadows only for props that are worth a shadow pass (spec.shadow === true) mesh.name = 'LIFE_' + model + '_' + part.mat;
      scene.add(mesh); this.meshes.push(mesh); this.attr.push(im);
    }
    this.dist = spec.dist || 150; this.shadowDist = spec.shadowDist || 70;
    this._fr = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._cp = new THREE.Vector3(1e9, 0, 0); this._cq = new THREE.Quaternion(); this.dirty = true; this.visible = 0;
  }
  update(camera) {
    const cp = camera.position;
    if (!this.dirty && this._cp.distanceToSquared(cp) < 0.5 && Math.abs(this._cq.dot(camera.quaternion)) > 0.99995) return;
    this._cp.copy(cp); this._cq.copy(camera.quaternion); this.dirty = false;
    this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this._fr.setFromProjectionMatrix(this._pm);
    const F = this._fr.planes, bs = this.bs, mat = this.mat; let o = 0;
    for (let i = 0; i < this.list.length; i++) {
      const x = bs[i * 4], y = bs[i * 4 + 1], z = bs[i * 4 + 2], r = bs[i * 4 + 3];
      const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      if (d > this.dist) continue;
      let ok = true;
      for (let k = 0; k < 6; k++) { const pl = F[k]; if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -r) { ok = false; break; } }
      if (!ok && d > 12) continue;
      for (const im of this.attr) im.array.set(mat.subarray(i * 16, i * 16 + 16), o * 16);
      o++;
    }
    this.visible = o;
    for (let k = 0; k < this.meshes.length; k++) { this.meshes[k].count = o; this.meshes[k].visible = o > 0; if (o) { this.attr[k].needsUpdate = true; this.attr[k].updateRange.count = o * 16; } }
  }
  dispose(scene) { for (const m of this.meshes) { scene.remove(m); m.geometry.dispose(); } }
};

/* ------------------------------------------------------------------ crowd_nav placements: carts, stoops, shelters */
TL.LifeProps.sources.push((world) => {
  const N = world.crowdNav; if (!N) return [];
  const yawOf = (nx, nz) => Math.atan2(-nz, nx);                    // maps the model's +X onto (nx, nz)
  const ground = (x, z) => Math.max(0, world.layout.ground(x, z));
  const out = [];
  out.push({ model: 'cart', dist: 170, shadow: true, list: N.carts.map((c) => { const q = (c.qd || 1); return { x: c.x, y: ground(c.x, c.z), z: c.z, yaw: yawOf(c.n[0], c.n[1]) + (q < 0 ? 0 : 0) }; }),
    col: { hx: 0.42, hy: 0.62, hz: 0.95, cy: 0.62 } });
  if (N.stoops.length) out.push({ model: 'stoop', dist: 160, shadow: true, list: N.stoops.map((s) => ({ x: s.x, y: ground(s.x, s.z), z: s.z, yaw: yawOf(s.n[0], s.n[1]) })), col: { hx: 0.9, hy: 0.45, hz: 0.95, cx: 0.5, cy: 0.45, hx2: 0.5 } });
  if (N.shelters.length) out.push({ model: 'shelter', dist: 190, shadow: true, list: N.shelters.map((s) => ({ x: s.x, y: ground(s.x, s.z), z: s.z, yaw: yawOf(s.out[0], s.out[1]) })), col: { hx: 0.9, hy: 0.08, hz: 1.95, cy: 2.5 } });
  return out;
});

if (TL.ScanHooks) {
  TL.ScanHooks.load.push(async (data) => {
    try { data.lifeModels = await TL.LifeProps.load(); } catch (e) { TL.logError ? TL.logError(e, 'life props') : console.error(e); data.lifeModels = null; }
  });
  TL.ScanHooks.build.push((world) => {
    const D = world.data.lifeModels; if (!D) return;
    try {
      world.lifeSets = [];
      for (const src of TL.LifeProps.sources) {
        for (const spec of src(world)) {
          if (!spec.list.length || !D.meta.models[spec.model]) continue;
          world.lifeSets.push(new TL.LifePropSet(world.scene, world.game.renderer, D, spec.model, spec));
          if (spec.col) {                                              // simple static colliders so the hero can land / perch on them
            const c = spec.col;
            for (const t of spec.list) {
              const cy = Math.cos(t.yaw), sy = Math.sin(t.yaw), ox = (c.cx || 0), oz = 0;
              world.world.addStatic(t.x + ox * cy + oz * sy, t.y + (c.cy || 0.5), t.z - ox * sy + oz * cy, c.hx2 || c.hx, c.hy, c.hz, t.yaw, { kind: 'prop', climb: true, anchor: true, src: 'life' });
            }
          }
        }
      }
      world.stats.lifeProps = world.lifeSets.reduce((a, s) => a + s.list.length, 0);
    } catch (e) { TL.logError ? TL.logError(e, 'life props') : console.error(e); }
  });
  TL.ScanHooks.update.push((world) => {
    if (!world.lifeSets) return;
    const cam = world.game.camera;
    for (const s of world.lifeSets) s.update(cam);
  });
}
