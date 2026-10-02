/* =====================================================================================
   SCAN TREES — detailed tree models replacing the scan's photogrammetry tree blobs (seed MAN).
   Models: tools/hd/trees_gen.py (London plane, honey locust, pin oak, American elm, linden; 3 LODs each:
   full branch tubes + folded twig cards / limbs + clump cards / trunk + a few clumps).
   Layout: tools/scan/build_scan.py detects the scan's canopies, splits them into single trees and cuts
   their triangles out of the scan tiles (extra/trees_layout.json).
   TL.Trees.load()   decode geometry + textures from TL.Extra
   TL.TreeField      instanced rendering: per (model, LOD) InstancedMesh pairs (bark / leaves) refilled
                     each frame from a distance + frustum pass; wind sway in the vertex shader; alpha-tested
                     leaves with crown normals, leaf-density AO and sun translucency; thin trunk colliders.
   ===================================================================================== */
'use strict';

TL.Trees = {
  /* -> { meta, models: [{ name, sp, H, R, col, lods: [{ bark, leaf }] }], atlas, bark: { sp: [map, normal] }, layout } */
  async load(step) {
    const X = TL.Extra;
    if (!X || !X.has('trees_models.json') || !X.has('trees_models.bin.gz')) return null;
    step && step(0.97, 'Growing trees');
    const meta = await X.json('trees_models.json');
    const bin = await X.buffer('trees_models.bin.gz');
    const layout = X.has('trees_layout.json') ? await X.json('trees_layout.json') : null;
    const imgs = {};
    const want = [meta.atlas.file];
    for (const sp of meta.species) for (const f of meta.bark[sp]) want.push(f);
    await Promise.all(want.map(async (f) => { if (X.has(f)) imgs[f] = await X.image(f); }));
    const models = meta.models.map((m) => Object.assign({}, m, {
      lods: m.lods.map((L) => ({ bark: L.bark && this.geometry(bin, L.bark, 1 / 1024), leaf: L.leaf && this.geometry(bin, L.leaf, 1 / 65535) })),
    }));
    return { meta, models, imgs, layout };
  },
  geometry(B, p, uvs) {
    const n = p.n, pos = new Int16Array(B, p.pos, n * 3), nrm = new Int8Array(B, p.nrm, n * 4), uv = new Uint16Array(B, p.uv, n * 2);
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      P[k * 3] = pos[k * 3] / 1000; P[k * 3 + 1] = pos[k * 3 + 1] / 1000; P[k * 3 + 2] = pos[k * 3 + 2] / 1000;
      N[k * 3] = nrm[k * 4] / 127; N[k * 3 + 1] = nrm[k * 4 + 1] / 127; N[k * 3 + 2] = nrm[k * 4 + 2] / 127;
      U[k * 2] = uv[k * 2] * uvs; U[k * 2 + 1] = uv[k * 2 + 1] * uvs;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    g.setAttribute('aW', new THREE.BufferAttribute(new Uint8Array(B, p.col, n * 4), 4, true));   // ao, sway, phase, flutter
    g.setIndex(new THREE.BufferAttribute(p.i32 ? new Uint32Array(B, p.idx, p.i) : new Uint16Array(B, p.idx, p.i), 1));
    g.computeBoundingSphere();
    return g;
  },
};

/* ------------------------------------------------------------------ materials
   Shared uniforms: uTime, uWind (xz = direction * strength 0..1, y = gust), uSunV (view-space sun dir),
   uSunC (sun colour * intensity). Wind is applied in world space after the instance transform:
   whole-tree bend ~ height^2, per-branch sway (aW.y weight, aW.z phase), leaf flutter (aW.w). */
TL.TreeMaterials = function (renderer, data) {
  const U = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(0.3, 0, 0.1) }, uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunC: { value: new THREE.Color(1, 1, 1) } };
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (img, srgb, rep) => {
    if (!img) return null;
    const t = new THREE.Texture(img);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso; t.needsUpdate = true;
    return t;
  };
  const WIND_V = `
    attribute vec4 aW;
    uniform float uTime; uniform vec3 uWind;
    varying float vAO;
    vec3 tlWind(vec3 wp, vec3 ip, float scaleY) {
      float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
      float h = max(wp.y - ip.y, 0.0);
      float s = length(uWind.xz);
      vec2 wd = s > 1e-4 ? uWind.xz / s : vec2(1.0, 0.0);
      float gust = 0.5 + 0.5 * sin(uTime * 0.37 + ph) * sin(uTime * 0.61 + ph * 1.7) + uWind.y;
      float k = h * h / (400.0 * max(scaleY, 0.3));
      float bend = s * (0.35 + 0.65 * gust) * 0.5 * k + sin(uTime * 1.3 + ph) * (0.04 + 0.08 * s) * k;
      wp.xz += wd * bend;
      wp.y -= bend * bend * 0.5 / max(h, 1.0);
      float bp = aW.z * 6.2831 + ph;
      vec3 sw = vec3(sin(uTime * 1.9 + bp), 0.5 * sin(uTime * 2.3 + bp * 1.3), cos(uTime * 1.6 + bp * 0.7));
      wp += sw * aW.y * (0.035 + 0.11 * s * (0.6 + 0.6 * gust));
      float f = sin(uTime * (8.0 + 3.0 * aW.z) + aW.z * 60.0 + dot(wp, vec3(1.7, 2.3, 1.1)));
      wp += vec3(0.4, 1.0, 0.3) * f * aW.w * (0.012 + 0.03 * s);
      return wp;
    }`;
  const PROJECT = `
    vec4 mvPosition = vec4(transformed, 1.0);
    vec3 tlIP = vec3(0.0); float tlSY = 1.0;
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
      tlIP = instanceMatrix[3].xyz; tlSY = length(instanceMatrix[1].xyz);
    #endif
    mvPosition = modelMatrix * mvPosition;
    mvPosition.xyz = tlWind(mvPosition.xyz, tlIP, tlSY);
    vec4 tlWorld = mvPosition;
    mvPosition = viewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;`;
  const patchV = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_V)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vAO = aW.x;')
      .replace('#include <project_vertex>', PROJECT);
    // shadow / depth passes derive worldPosition from the instance transform again: keep them consistent
    sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', `
      #if defined( USE_SHADOWMAP ) || defined( USE_ENVMAP ) || defined( USE_TRANSMISSION ) || defined( DISTANCE )
        vec4 worldPosition = tlWorld;
      #endif`);
  };
  // alpha kept stable under minification (mip-level coverage boost) and sharpened for alpha-to-coverage
  const ALPHA = `
    #ifdef USE_MAP
      vec2 tlTs = vec2(textureSize(map, 0));
      vec2 tlDx = dFdx(vUv * tlTs), tlDy = dFdy(vUv * tlTs);
      float tlMip = max(0.0, 0.5 * log2(max(dot(tlDx, tlDx), dot(tlDy, tlDy))));
      diffuseColor.a *= 1.0 + tlMip * 0.22;
    #endif`;
  const leaf = new THREE.MeshLambertMaterial({ map: tex(data.imgs[data.meta.atlas.file], true), alphaTest: 0.42, side: THREE.DoubleSide });
  leaf.shadowSide = THREE.DoubleSide;
  leaf.onBeforeCompile = (sh) => {
    patchV(sh);
    sh.uniforms.uSunV = U.uSunV; sh.uniforms.uSunC = U.uSunC;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vAO; uniform vec3 uSunV; uniform vec3 uSunC;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + ALPHA + '\n diffuseColor.rgb *= 0.42 + 0.58 * vAO;   // canopy AO floor (graphics pass: was 0.3, interiors read near-black)')
      // foliage lights as a volume: crown normals on both faces (no back-face flip)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float tlBack = pow(max(dot(-geometry.viewDir, uSunV), 0.0), 4.0);
          float tlWrap = max(-dot(normal, uSunV), 0.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunC * (tlBack * 0.35 + tlWrap * 0.16) * vAO * vAO;
        }`);
  };
  leaf.customProgramCacheKey = () => 'tl-tree-leaf';
  const depth = (map) => {
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: map || null, alphaTest: map ? 0.42 : 0 });
    d.onBeforeCompile = (sh) => { patchV(sh); };
    d.customProgramCacheKey = () => 'tl-tree-depth' + (map ? '-a' : '');
    return d;
  };
  const leafDepth = depth(leaf.map);
  const barkDepth = depth(null);
  const bark = {};
  for (const sp of data.meta.species) {
    const [fm, fn] = data.meta.bark[sp];
    const m = new THREE.MeshStandardMaterial({ map: tex(data.imgs[fm], true, true), normalMap: tex(data.imgs[fn], false, true), roughness: 0.93, metalness: 0 });
    m.normalScale.set(1.2, 1.2);
    m.onBeforeCompile = (sh) => {
      patchV(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying float vAO;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= 0.42 + 0.58 * vAO;   // canopy AO floor (graphics pass: was 0.3, interiors read near-black)');
    };
    m.customProgramCacheKey = () => 'tl-tree-bark';
    bark[sp] = m;
  }
  return { U, leaf, leafDepth, bark, barkDepth };
};

/* ------------------------------------------------------------------ the forest */
TL.TreeField = class {
  /* data from TL.Trees.load; list = [{x, y, z, m (model index), yaw, s, sx, tint:[r,g,b]}] */
  constructor(scene, renderer, data, list, opts) {
    opts = opts || {};
    this.scene = scene; this.data = data; this.list = list;
    this.mats = TL.TreeMaterials(renderer, data);
    this.quality = opts.quality || 'high';
    this.setQuality(this.quality);
    this.t = 0;
    const M = data.models, nM = M.length;
    // per tree: world matrix (16), tint, bounding sphere, LOD state
    const n = list.length;
    this.mat = new Float32Array(n * 16); this.tint = new Float32Array(n * 3);
    this.bs = new Float32Array(n * 4); this.lod = new Int8Array(n).fill(-1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const counts = new Array(nM).fill(0);
    list.forEach((t, i) => {
      const md = M[t.m];
      p.set(t.x, t.y || 0, t.z); q.setFromAxisAngle(up, t.yaw || 0); s.set(t.s * (t.sx || 1), t.s, t.s * (t.sx || 1));
      m4.compose(p, q, s); m4.toArray(this.mat, i * 16);
      const tc = t.tint || [1, 1, 1];
      this.tint[i * 3] = tc[0]; this.tint[i * 3 + 1] = tc[1]; this.tint[i * 3 + 2] = tc[2];
      this.bs[i * 4] = t.x; this.bs[i * 4 + 1] = (t.y || 0) + md.H * t.s * 0.55; this.bs[i * 4 + 2] = t.z;
      this.bs[i * 4 + 3] = Math.max(md.R * t.s * (t.sx || 1), md.H * t.s * 0.55) * 1.1;
      counts[t.m]++;
    });
    // instanced meshes: one bark + one leaf mesh per (model, LOD), sharing the instance buffers
    this.groups = [];
    this.meshes = [];
    for (let mi = 0; mi < nM; mi++) {
      const md = M[mi], row = [];
      for (let l = 0; l < md.lods.length; l++) {
        const cap = Math.max(1, counts[mi]);
        const im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); im.setUsage(THREE.DynamicDrawUsage);
        const ic = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); ic.setUsage(THREE.DynamicDrawUsage);
        const G = { im, ic, n: 0, parts: [] };
        const L = md.lods[l];
        for (const key of ['bark', 'leaf']) {
          const g = L[key]; if (!g) continue;
          const mesh = new THREE.InstancedMesh(g, key === 'leaf' ? this.mats.leaf : this.mats.bark[md.sp], cap);
          mesh.instanceMatrix = im;
          if (key === 'leaf') mesh.instanceColor = ic;
          mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
          mesh.castShadow = l < 2; mesh.receiveShadow = true;
          mesh.customDepthMaterial = key === 'leaf' ? this.mats.leafDepth : this.mats.barkDepth;
          mesh.name = 'TREE_' + md.name + '_L' + l + '_' + key;
          scene.add(mesh); G.parts.push(mesh); this.meshes.push(mesh);
        }
        row.push(G);
      }
      this.groups.push(row);
    }
    this._frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._v = new THREE.Vector3();
    this._camPos = new THREE.Vector3(1e9, 0, 0); this._camQ = new THREE.Quaternion(); this.dirty = true;
    this.stats = { visible: 0, lod: [0, 0, 0] };
  }
  setQuality(q) {
    this.quality = q;
    const k = { low: 0.55, medium: 0.8, high: 1, ultra: 1.35 }[q] || 1;
    this.d0 = 42 * k; this.d1 = 150 * k; this.dMax = 900;
    this.dirty = true;
  }
  /* env: { sunDir (world, towards the sun), sunColor (THREE.Color incl. intensity), wind: THREE.Vector3 (m/s), rain 0..1 } */
  update(camera, dt, env) {
    this.t += dt;
    const U = this.mats.U;
    U.uTime.value = this.t;
    if (env) {
      const w = env.wind, sp = w ? Math.hypot(w.x, w.z) : 2;
      const str = TL.clamp(0.18 + sp / 12 + (env.rain || 0) * 0.35, 0, 1);
      if (w && sp > 1e-3) U.uWind.value.set(w.x / sp * str, (env.rain || 0) * 0.3, w.z / sp * str); else U.uWind.value.set(str, 0, 0);
      if (env.sunDir) U.uSunV.value.copy(env.sunDir).transformDirection(camera.matrixWorldInverse);
      if (env.sunColor) U.uSunC.value.copy(env.sunColor);
    }
    // re-bin instances when the camera moved / turned enough
    const cp = camera.position;
    const moved = this._camPos.distanceToSquared(cp) > 0.25 || Math.abs(this._camQ.dot(camera.quaternion)) < 0.99995;
    if (!moved && !this.dirty) return;
    this._camPos.copy(cp); this._camQ.copy(camera.quaternion); this.dirty = false;
    this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    const F = this._frustum.planes, list = this.list, bs = this.bs, mat = this.mat, tint = this.tint;
    for (const row of this.groups) for (const G of row) G.n = 0;
    const d0 = this.d0, d1 = this.d1, dM = this.dMax, H = 4;
    let vis = 0; const lc = this.stats.lod; lc[0] = lc[1] = lc[2] = 0;
    for (let i = 0; i < list.length; i++) {
      const x = bs[i * 4], y = bs[i * 4 + 1], z = bs[i * 4 + 2], r = bs[i * 4 + 3];
      const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      if (d > dM) { this.lod[i] = -1; continue; }
      let inside = true;
      for (let k = 0; k < 6; k++) { const pl = F[k]; if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -r) { inside = false; break; } }
      if (!inside && d > 30) { this.lod[i] = -1; continue; }         // near trees stay for their shadows
      // hysteresis around the LOD boundaries
      const prev = this.lod[i];
      let l = d < d0 ? 0 : d < d1 ? 1 : 2;
      if (prev >= 0 && l !== prev) { const b = l > prev ? (prev === 0 ? d0 : d1) : (l === 0 ? d0 : d1); if (Math.abs(d - b) < H) l = prev; }
      this.lod[i] = l;
      const G = this.groups[list[i].m][l]; const o = G.n++;
      G.im.array.set(mat.subarray(i * 16, i * 16 + 16), o * 16);
      G.ic.array[o * 3] = tint[i * 3]; G.ic.array[o * 3 + 1] = tint[i * 3 + 1]; G.ic.array[o * 3 + 2] = tint[i * 3 + 2];
      vis++; lc[l]++;
    }
    for (const row of this.groups) for (const G of row) {
      for (const m of G.parts) m.count = G.n;
      if (G.n) { G.im.needsUpdate = true; G.ic.needsUpdate = true; G.im.updateRange.count = G.n * 16; G.ic.updateRange.count = G.n * 3; }
    }
    this.stats.visible = vis;
  }
  dispose() { for (const m of this.meshes) { this.scene.remove(m); m.dispose && m.dispose(); } }
};

/* ------------------------------------------------------------------ scan-world hooks */
if (TL.ScanHooks) {
  TL.ScanHooks.load.push(async (data, step) => {
    try { data.trees = await TL.Trees.load(step); } catch (e) { TL.logError ? TL.logError(e, 'trees') : console.error(e); data.trees = null; }
  });
  TL.ScanHooks.build.push((world) => {
    const T = world.data.trees; if (!T || !T.layout) return;
    try {
      const L = T.layout, names = T.models.map((m) => m.name), idx = L.models.map((n) => names.indexOf(n));
      const list = [];
      for (const t of L.trees) {                         // [x, z, model, yaw, scale, sx, r, g, b]
        const mi = idx[t[2]]; if (mi < 0) continue;
        list.push({ x: t[0], y: 0, z: t[1], m: mi, yaw: t[3], s: t[4], sx: t[5], tint: [t[6], t[7], t[8]] });
      }
      world.trees = new TL.TreeField(world.scene, world.game.renderer, T, list, { quality: world.quality });
      // thin trunk colliders: webs can anchor, the hero can land / crawl; crowns stay open
      for (const t of list) {
        const md = T.models[t.m], c = md.col, s = t.s, cy = Math.cos(t.yaw || 0), sy = Math.sin(t.yaw || 0);
        const r = Math.max(0.12, c.r * s * (t.sx || 1)), h = c.h * s;
        const ox = (c.x * cy + c.z * sy) * s * (t.sx || 1), oz = (-c.x * sy + c.z * cy) * s * (t.sx || 1);
        world.world.addStatic(t.x + ox, h / 2 - 0.5, t.z + oz, r, h / 2 + 0.5, r, t.yaw || 0, { kind: 'tree', climb: true, anchor: true, src: 'tree' });
      }
      world.stats.trees = list.length;
    } catch (e) { TL.logError ? TL.logError(e, 'trees') : console.error(e); }
  });
  TL.ScanHooks.update.push((world, focus, vel, dt) => {
    const T = world.trees; if (!T) return;
    const g = world.game, e = g.env, cam = g.camera;
    if (world.quality !== T.quality) T.setQuality(world.quality);
    const env = T._env || (T._env = { sunDir: new THREE.Vector3(), sunColor: new THREE.Color(), wind: null, rain: 0 });
    if (e) {
      env.sunDir.copy(e.sun.position).sub(e.sun.target.position).normalize();
      env.sunColor.copy(e.sun.color).multiplyScalar(e.sun.intensity);
      env.rain = e.rain || 0;
    }
    env.wind = g.wind ? g.wind.base : null;
    T.update(cam, dt, env);
  });
}
