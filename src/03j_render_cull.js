/* =====================================================================================
   RENDER CULLING for the citywide instanced kits (rooftop equipment / parapets / cornices / roof obstacles / any other
   module that pushes into world.roofState.meshes — build.js places this file after all of them).
   Those modules build one InstancedMesh per kit part for the whole map with frustum culling off
   (three r149 culls an InstancedMesh by its geometry's own bounds only), so every instance in the city was drawn in the
   camera pass and again in the sun's shadow pass every frame (~22 ms GPU of a ~40 ms frame on a GTX 1660 Ti).
   Here each such mesh is split into spatial cells: the cells share the part's geometry buffers and material and carry
   the true bounds of their own instances, so three's frustum culling (camera and shadow camera) can skip them.
   Rendering only: instance matrices, materials, colliders and placement data are untouched.
   ===================================================================================== */
'use strict';

TL.CellInstancing = {
  CELL: 128,                        // metres; one draw call per occupied cell per kit part
  /* geometry view with its own bounds; attributes / index are the same objects -> same GPU buffers */
  view(g, sphere) {
    const v = new THREE.BufferGeometry();
    v.index = g.index;
    for (const k in g.attributes) v.attributes[k] = g.attributes[k];
    v.morphAttributes = g.morphAttributes; v.groups = g.groups; v.drawRange = g.drawRange; v.userData = g.userData;
    v.boundingSphere = sphere;
    v.name = g.name;
    return v;
  },
  /* split one InstancedMesh into per-cell InstancedMeshes; returns the new meshes (the caller swaps them in) */
  split(m, cell) {
    const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    const gs = g.boundingSphere, M = new THREE.Matrix4(), c = new THREE.Vector3(), cells = new Map();
    m.updateMatrixWorld(true);
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, M); M.premultiply(m.matrixWorld);
      c.copy(gs.center).applyMatrix4(M);
      const k = Math.floor(c.x / cell) + ',' + Math.floor(c.z / cell);
      let e = cells.get(k); if (!e) cells.set(k, (e = { idx: [], pts: [] }));
      e.idx.push(i); e.pts.push(c.x, c.y, c.z, gs.radius * M.getMaxScaleOnAxis());
    }
    const out = [];
    for (const e of cells.values()) {
      // bounds: box of the instance spheres' centres, then the radius that encloses every instance sphere
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let j = 0; j < e.pts.length; j += 4) { const x = e.pts[j], y = e.pts[j + 1], z = e.pts[j + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const ctr = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      let rad = 0;
      for (let j = 0; j < e.pts.length; j += 4) rad = Math.max(rad, Math.hypot(e.pts[j] - ctr.x, e.pts[j + 1] - ctr.y, e.pts[j + 2] - ctr.z) + e.pts[j + 3]);
      const n = e.idx.length, im = new THREE.InstancedMesh(this.view(g, new THREE.Sphere(ctr, rad)), m.material, n);
      const src = m.instanceMatrix.array, dst = im.instanceMatrix.array;
      for (let j = 0; j < n; j++) for (let q = 0; q < 16; q++) dst[j * 16 + q] = src[e.idx[j] * 16 + q];
      if (m.instanceColor) {
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        const cs = m.instanceColor.array, cd = im.instanceColor.array;
        for (let j = 0; j < n; j++) for (let q = 0; q < 3; q++) cd[j * 3 + q] = cs[e.idx[j] * 3 + q];
      }
      im.name = m.name; im.castShadow = m.castShadow; im.receiveShadow = m.receiveShadow; im.renderOrder = m.renderOrder;
      im.layers.mask = m.layers.mask; im.visible = m.visible; im.userData = m.userData;
      im.matrixAutoUpdate = false; im.matrix.copy(m.matrix); im.matrixWorld.copy(m.matrixWorld);   // instance data are world-space already
      im.frustumCulled = true;
      out.push(im);
    }
    return out;
  },
  /* replace every static, uncullable InstancedMesh in `list` (in place) */
  apply(list, cell) {
    let before = 0, after = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!m.isInstancedMesh || m.frustumCulled || m.count < 2 || !m.parent) continue;
      const parts = this.split(m, cell || this.CELL), parent = m.parent;
      parent.remove(m);
      for (const p of parts) parent.add(p);
      list.splice(i, 1, ...parts);
      m.dispose();
      before++; after += parts.length;
    }
    return { before, after };
  },
};

if (TL.ScanHooks) TL.ScanHooks.build.push((world) => {
  const R = world.roofState;
  if (!R || !R.meshes) return;
  try { world.stats.cellInstancing = TL.CellInstancing.apply(R.meshes); }
  catch (e) { TL.logError ? TL.logError(e, 'cellInstancing') : console.error(e); }
});

/* -------------------------------------------------------------------------------------
   Render-time culling for TL.InstanceBatch (traffic vehicles + wheels, crowd LOD, activity props, generated-city props).
   A batch is one InstancedMesh for agents all over the city with frustum culling off, so every vehicle was drawn in the
   camera and shadow pass every frame. Same API and slot bookkeeping as before, but the authoritative matrices live in a
   private store; right before each render of the scene (scene.onBeforeRender: after world matrices, before the shadow
   and camera passes) the GPU buffer receives only the instances whose bounds touch the camera frustum or the sun's
   current shadow frustum, in their original order. Instances outside both cannot contribute a pixel.
   ------------------------------------------------------------------------------------- */
{
  const Base = TL.InstanceBatch;
  const _F = new THREE.Frustum(), _S = new THREE.Frustum(), _PV = new THREE.Matrix4(), _sph = new THREE.Sphere(), _M = new THREE.Matrix4();
  TL.InstanceBatch = class extends Base {
    constructor(scene, geo, mat, capacity, opts) {
      super(scene, geo, mat, capacity, opts);
      this.n = 0; this.scene = scene;
      this.store = new Float32Array(capacity * 16);
      this.cstore = this.hasColor ? new Float32Array(capacity * 3).fill(1) : null;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      this.sphere = geo.boundingSphere;
      TL.InstanceBatch.attach(scene, this);
    }
    alloc(owner, matrix, color) {
      if (this.n >= this.cap) return -1;
      const i = this.n++;
      this.owners[i] = owner; owner.idx = i; owner.batch = this;
      matrix.toArray(this.store, i * 16);
      if (color && this.hasColor) color.toArray(this.cstore, i * 3);
      return i;
    }
    set(owner, matrix) { if (owner.batch !== this || owner.idx < 0) return; matrix.toArray(this.store, owner.idx * 16); }
    color(owner, c) { if (owner.batch !== this || owner.idx < 0 || !this.hasColor) return; c.toArray(this.cstore, owner.idx * 3); }
    free(owner) {
      if (owner.batch !== this || owner.idx < 0) return;
      const i = owner.idx, last = this.n - 1;
      if (i !== last) {
        this.store.copyWithin(i * 16, last * 16, last * 16 + 16);
        if (this.hasColor) this.cstore.copyWithin(i * 3, last * 3, last * 3 + 3);
        const o = this.owners[last]; this.owners[i] = o; o.idx = i;
      }
      this.owners[last] = null; this.n--; owner.idx = -1; owner.batch = null;
    }
    dispose(scene) { TL.InstanceBatch.detach(this.scene, this); super.dispose(scene); }
    /* compact the visible instances into the GPU buffer */
    cull(F, S) {
      const m = this.mesh, src = this.store, dst = m.instanceMatrix.array, cs = this.cstore, cd = m.instanceColor && m.instanceColor.array;
      const shadow = S && m.castShadow, c0 = this.sphere.center, r0 = this.sphere.radius;
      let k = 0;
      for (let i = 0; i < this.n; i++) {
        const o = i * 16;
        _M.fromArray(src, o);
        _sph.center.copy(c0).applyMatrix4(_M); _sph.radius = r0 * _M.getMaxScaleOnAxis();
        if (!(F.intersectsSphere(_sph) || (shadow && S.intersectsSphere(_sph)))) continue;
        if (k !== i) { for (let q = 0; q < 16; q++) dst[k * 16 + q] = src[o + q]; if (cd) { cd[k * 3] = cs[i * 3]; cd[k * 3 + 1] = cs[i * 3 + 1]; cd[k * 3 + 2] = cs[i * 3 + 2]; } }
        else { for (let q = 0; q < 16; q++) dst[o + q] = src[o + q]; if (cd) { cd[i * 3] = cs[i * 3]; cd[i * 3 + 1] = cs[i * 3 + 1]; cd[i * 3 + 2] = cs[i * 3 + 2]; } }
        k++;
      }
      m.count = k;
      m.instanceMatrix.updateRange.offset = 0; m.instanceMatrix.updateRange.count = k * 16; m.instanceMatrix.needsUpdate = true;
      if (cd) { m.instanceColor.updateRange.offset = 0; m.instanceColor.updateRange.count = k * 3; m.instanceColor.needsUpdate = true; }
    }
    /* one onBeforeRender hook per scene drives all of its batches */
    static attach(scene, b) {
      let U = scene.userData.__instanceCull;
      if (!U) {
        U = scene.userData.__instanceCull = new Set();
        const prev = scene.onBeforeRender;
        scene.onBeforeRender = function (renderer, sc, camera, rt) {
          prev.call(this, renderer, sc, camera, rt);
          if (!U.size) return;
          _PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _F.setFromProjectionMatrix(_PV);
          let S = null;
          const sun = TL.game && TL.game.env && TL.game.env.sun;
          if (sun && sun.castShadow && renderer.shadowMap.enabled && sun.parent) {
            sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
            sun.shadow.updateMatrices(sun); S = _S.copy(sun.shadow.getFrustum());
          }
          for (const b of U) b.cull(_F, S);
        };
      }
      U.add(b);
    }
    static detach(scene, b) { const U = scene && scene.userData.__instanceCull; if (U) U.delete(b); }
  };
}
