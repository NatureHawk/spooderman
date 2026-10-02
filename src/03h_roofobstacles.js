/* =====================================================================================
   ROOFTOP RUNNING OBSTACLES (seed MAN) — small, real roof furniture across the open running lines
   that 03g_rooftops deliberately keeps clear of large equipment: condensate / gas pipe runs on
   sleepers (step-over), guard railings (one-hand / speed vault, narrow perch top), insulated ducts
   (one-hand vault) and electrical cabinet banks (two-hand vault).
   Placement uses the actual roof triangles (TL.Rooftops.fits): every footprint plus a landing margin
   sits on exposed roof at one level, clear of existing equipment. Colliders match the visible parts.
   Registered as a ScanHooks.build step after the rooftop kits (03g) have placed their equipment.
   ===================================================================================== */
'use strict';
TL.RoofObstacles = {
  TYPES: {
    //        half length range, collider half height, half depth, landing margin, perch type
    pipes: { len: [1.6, 3.0], hy: 0.19, hz: 0.16, margin: 1.1, weight: 0.42 },
    rail: { len: [1.8, 3.2], hy: 0.48, hz: 0.05, margin: 1.3, weight: 0.24, support: 'rail' },
    duct: { len: [1.4, 2.6], hy: 0.36, hz: 0.3, margin: 1.3, weight: 0.22 },
    cabinet: { len: [1.0, 1.3], hy: 0.62, hz: 0.45, margin: 1.5, weight: 0.12 },
  },
  materials() {
    const m = (color, rough, metal) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    return { steel: m(0x8b9396, 0.55, 0.55), dark: m(0x2b3236, 0.78, 0.3), galv: m(0xa7adaa, 0.45, 0.7), insul: m(0xb9bbb4, 0.68, 0.15), yellow: m(0xc39a2a, 0.6, 0.2), cab: m(0x6d7470, 0.62, 0.35) };
  },
  /* unit geometry per type (length 1 along local x, scaled per instance in x) */
  kits() {
    const M = this.materials(), out = {};
    const make = (name, fn) => {
      const parts = {};
      const add = (mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z); (parts[mat] || (parts[mat] = [])).push(geo); };
      fn({ add, box: (m, w, h, d, x, y, z) => add(m, new THREE.BoxGeometry(w, h, d), x, y, z), pipe: (m, r, len, y, z) => add(m, new THREE.CylinderGeometry(r, r, len, 12), 0, y, z, 0, 0, Math.PI / 2) });
      out[name] = Object.entries(parts).map(([mat, gs]) => {
        const data = { position: [], normal: [], uv: [] };
        for (const raw of gs) { const g = raw.index ? raw.toNonIndexed() : raw; for (const k of Object.keys(data)) data[k].push(...g.attributes[k].array); if (g !== raw) g.dispose(); raw.dispose(); }
        const g = new THREE.BufferGeometry(); for (const [k, a] of Object.entries(data)) g.setAttribute(k, new THREE.Float32BufferAttribute(a, k === 'uv' ? 2 : 3)); g.computeBoundingSphere();
        return { geometry: g, material: M[mat] };
      });
    };
    // unit length 2 (x in [-1,1]); sleepers are added per instance length by repeating along a scaled run
    make('pipes', ({ box, pipe }) => {
      pipe('steel', 0.085, 2, 0.27, -0.06); pipe('yellow', 0.055, 2, 0.24, 0.1);
      for (const x of [-0.8, 0, 0.8]) { box('dark', 0.12, 0.16, 0.34, x, 0.08, 0); box('dark', 0.05, 0.2, 0.05, x, 0.24, -0.06); }
    });
    make('rail', ({ box, pipe }) => {
      pipe('galv', 0.025, 2, 0.95, 0); pipe('galv', 0.02, 2, 0.5, 0); box('galv', 2, 0.05, 0.05, 0, 0.09, 0);
      for (const x of [-0.98, 0, 0.98]) { box('galv', 0.045, 0.95, 0.045, x, 0.475, 0); box('dark', 0.16, 0.03, 0.16, x, 0.015, 0); }
    });
    make('duct', ({ box }) => {
      box('insul', 2, 0.58, 0.56, 0, 0.42, 0);
      for (const x of [-0.75, -0.25, 0.25, 0.75]) box('steel', 0.025, 0.6, 0.58, x, 0.42, 0);
      for (const x of [-0.8, 0.8]) box('dark', 0.1, 0.13, 0.6, x, 0.065, 0);
    });
    make('cabinet', ({ box }) => {
      box('cab', 2, 1.16, 0.86, 0, 0.62, 0); box('dark', 2.04, 0.06, 0.9, 0, 1.22, 0); box('dark', 2, 0.04, 0.9, 0, 0.02, 0);
      for (const x of [-0.5, 0, 0.5]) box('dark', 0.02, 1.0, 0.88, x, 0.62, 0);
      for (const x of [-0.75, -0.25, 0.25, 0.75]) box('steel', 0.08, 0.03, 0.04, x, 0.75, 0.45);
    });
    return out;
  },
  build(world) {
    const R = world.roofState, RT = TL.Rooftops; if (!R || !R.analyses) return;
    const kits = this.kits(), buckets = new Map(), placed = [];
    R.obstacles = placed;
    const used = (R.placements || []).map((p) => ({ x: p.x, z: p.z, y: p.y, r: Math.hypot(p.hx || 1, p.hz || 1) }));
    for (const A of R.analyses) {
      let seed = A.b.id * 7919 + 13;
      for (const L of A.levels) {
        if (L.area < 140 || L.y < 6) continue;
        const want = (L.area > 420 ? 2 : 1) + (RT.hash(A.b.id * 3 + 1) < 0.35 ? 1 : 0);
        const c = Math.cos(A.yaw), s = Math.sin(A.yaw), mx = (L.minX + L.maxX) * 0.5, mz = (L.minZ + L.maxZ) * 0.5;
        let n = 0;
        for (let attempt = 0; attempt < 40 && n < want; attempt++) {
          // weighted type pick
          let r = RT.hash(seed++), type = 'pipes';
          for (const [k, T] of Object.entries(this.TYPES)) { if (r < T.weight) { type = k; break; } r -= T.weight; }
          const T = this.TYPES[type], hx = T.len[0] + RT.hash(seed++) * (T.len[1] - T.len[0]);
          // across one of the two central running lines, offset along it so the run meets it head-on
          const along = RT.hash(seed++) < 0.5, off = (RT.hash(seed++) - 0.5) * (along ? (L.maxX - L.minX) : (L.maxZ - L.minZ)) * 0.6;
          const lu = along ? off : 0, lv = along ? 0 : off, yaw = A.yaw + (along ? Math.PI / 2 : 0);
          const x = mx + lu * c + lv * s, z = mz - lu * s + lv * c;
          if (!RT.fits(A, x, z, L.y, hx, T.hz, yaw, T.margin)) continue;
          if (used.some((u) => Math.abs(u.y - L.y) < 2.5 && Math.hypot(x - u.x, z - u.z) < u.r + hx + T.margin)) continue;
          used.push({ x, z, y: L.y, r: hx });
          const m = new THREE.Matrix4().compose(new THREE.Vector3(x, L.y + 0.01, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(hx, 1, 1));
          (buckets.get(type) || buckets.set(type, []).get(type)).push(m);
          const col = world.world.addStatic(x, L.y + 0.01 + T.hy, z, hx, T.hy, T.hz, yaw, { kind: 'building', src: 'rooftop', bid: A.b.id, climb: false, anchor: false, perch: true, roofObstacle: type });
          if (T.support) col.supportType = T.support;
          R.colliders.push(col);
          placed.push({ type, bid: A.b.id, x, y: L.y, z, hx, hz: T.hz, h: T.hy * 2, yaw, col });
          n++;
        }
      }
    }
    for (const [name, mats] of buckets) for (const part of kits[name]) {
      const m = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
      mats.forEach((mt, i) => m.setMatrixAt(i, mt)); m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; m.castShadow = m.receiveShadow = true;
      m.name = 'Rooftop obstacle ' + name; world.scene.add(m); (R.meshes || (R.meshes = [])).push(m);
    }
  },
};
if (TL.ScanHooks) TL.ScanHooks.build.push((world) => TL.RoofObstacles.build(world));
