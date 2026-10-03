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
  // Adjacent LODs share complementary screen-door coverage in a narrow distance band.
  // No transparent sorting, extra textures, or persistent transition allocations.
  blend(distance, bounds, out = {}) {
    for (let i = 0; i < bounds.length; i++) {
      const width = Math.max(6, Math.min(24, bounds[i] * 0.08));
      if (distance < bounds[i] - width) return Object.assign(out, { near: i, far: i, mix: 0 });
      if (distance < bounds[i] + width) {
        const t = (distance - bounds[i] + width) / (2 * width);
        return Object.assign(out, { near: i, far: i + 1, mix: t * t * (3 - 2 * t) });
      }
    }
    return Object.assign(out, { near: bounds.length, far: bounds.length, mix: 0 });
  },
  dither: `
    float tlTreeNoise = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
    if (vTreeLod.y < 0.0 ? tlTreeNoise < vTreeLod.x : tlTreeNoise >= vTreeLod.x) discard;
  `,
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
    varying float vAO; varying vec2 vTreeLod;
    #ifdef USE_INSTANCING
      attribute vec2 aTreeLod;
    #endif
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
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vAO = aW.x; vTreeLod = vec2(1.0);\n #ifdef USE_INSTANCING\n vTreeLod = aTreeLod;\n #endif')
      .replace('#include <project_vertex>', PROJECT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec2 vTreeLod;')
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n' + TL.Trees.dither);
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
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + ALPHA + '\n diffuseColor.rgb *= (0.5 + 0.5 * vAO) * 1.12;   // canopy AO floor (graphics pass: was 0.3; life pass 0.5: interiors read green, not black)')
      // foliage lights as a volume: crown normals on both faces (no back-face flip)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float tlBack = pow(max(dot(-geometry.viewDir, uSunV), 0.0), 4.0);
          float tlWrap = max(-dot(normal, uSunV), 0.0);
          float tlDay = clamp(length(uSunC), 0.0, 1.2);
          // thin leaves transmit sunlight (back / wrap term) and catch sky light from every side (fill): canopy undersides stay green, not black
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (uSunC * (tlBack * 0.5 + tlWrap * 0.4) * vAO * vAO + vec3(0.19, 0.25, 0.17) * (0.35 + 0.65 * vAO) * tlDay);
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

/* ------------------------------------------------------------------ distant impostors
   Far trees (beyond ~360 m) are single camera-facing billboards. The views are baked at load: every model is rendered from
   8 azimuths (orthographic, lit from the camera's upper left) into one atlas; at run time a billboard picks the baked view that
   matches the angle between the camera and the tree's own yaw, so rotating around a far tree still shows its real crown shape.
   Cost: 1 instanced draw for all of them, 2 triangles per tree. */
TL.TreeImpostors = {
  V: 8, T: 96,
  bake(renderer, data, mats, scene) {
    const V = this.V, T = this.T, M = data.models, nM = M.length;
    const rt = new THREE.WebGLRenderTarget(V * T, nM * T, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, format: THREE.RGBAFormat, depthBuffer: true });
    // saved state
    const old = { rt: renderer.getRenderTarget(), vp: renderer.getViewport(new THREE.Vector4()), sc: renderer.getScissor(new THREE.Vector4()), st: renderer.getScissorTest(), ac: renderer.autoClear, cc: renderer.getClearColor(new THREE.Color()), ca: renderer.getClearAlpha(), sm: renderer.shadowMap.enabled };
    const U = mats.U, u0 = { t: U.uTime.value, w: U.uWind.value.clone(), sv: U.uSunV.value.clone(), sc: U.uSunC.value.clone() };
    U.uTime.value = 0; U.uWind.value.set(0, 0, 0); U.uSunV.value.set(-0.45, 0.65, 0.62).normalize(); U.uSunC.value.setRGB(1.0, 0.98, 0.92);
    renderer.shadowMap.enabled = false;
    const sc = new THREE.Scene();
    sc.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dl = new THREE.DirectionalLight(0xfff4e0, 1.1); sc.add(dl); sc.add(dl.target);
    renderer.setRenderTarget(rt); renderer.autoClear = false; renderer.setClearColor(new THREE.Color(0.26, 0.34, 0.2), 0);
    renderer.setScissorTest(true);
    const info = [];
    for (let mi = 0; mi < nM; mi++) {
      const md = M[mi], L = md.lods[1] || md.lods[0], grp = new THREE.Group();
      for (const key of ['bark', 'leaf']) {
        if (!L[key]) continue;
        const m = new THREE.Mesh(L[key], key === 'leaf' ? mats.leaf : mats.bark[md.sp]); m.frustumCulled = false; grp.add(m);
      }
      sc.add(grp);
      const box = new THREE.Box3(); for (const key of ['bark', 'leaf']) if (L[key]) { L[key].computeBoundingBox(); box.union(L[key].boundingBox); }
      const rw = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z), y0 = Math.min(box.min.y, 0), y1 = box.max.y, half = Math.max(rw, (y1 - y0) / 2) * 1.04, ymid = (y0 + y1) / 2;
      info.push({ half, ymid });
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 400);
      for (let k = 0; k < V; k++) {
        const a = k * Math.PI * 2 / V;
        cam.position.set(Math.sin(a) * 120, ymid, Math.cos(a) * 120); cam.up.set(0, 1, 0); cam.lookAt(0, ymid, 0); cam.updateMatrixWorld(true);
        // light from the camera's upper left, the same in every view
        const r = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
        dl.position.set(Math.sin(a) * 60 - r.x * 40, ymid + 60, Math.cos(a) * 60 - r.z * 40); dl.target.position.set(0, ymid, 0); dl.target.updateMatrixWorld(true);
        renderer.setViewport(k * T, mi * T, T, T); renderer.setScissor(k * T, mi * T, T, T);
        renderer.clear(true, true, false);
        renderer.render(sc, cam);
      }
      sc.remove(grp);
    }
    // restore
    renderer.setRenderTarget(old.rt); renderer.setViewport(old.vp); renderer.setScissor(old.sc); renderer.setScissorTest(old.st); renderer.autoClear = old.ac; renderer.setClearColor(old.cc, old.ca); renderer.shadowMap.enabled = old.sm;
    U.uTime.value = u0.t; U.uWind.value.copy(u0.w); U.uSunV.value.copy(u0.sv); U.uSunC.value.copy(u0.sc);
    rt.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return { rt, info };
  },
  /* instanced billboard mesh for up to `cap` trees */
  create(scene, renderer, data, mats, cap) {
    const baked = this.bake(renderer, data, mats, scene), V = this.V, nM = data.models.length;
    const g = new THREE.PlaneGeometry(1, 1);
    const aImp = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aImp.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aImp', aImp);
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2); fade.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aTreeLod', fade);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tAtlas: { value: baked.rt.texture }, uSunC: mats.U.uSunC }]),
      vertexShader: `
        attribute vec4 aImp; attribute vec2 aTreeLod; varying vec2 vTreeLod;
        varying vec2 vUv; varying vec3 vTint;
        #include <fog_pars_vertex>
        void main() {
          vTreeLod = aTreeLod;
          vec3 base = instanceMatrix[3].xyz;
          float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
          float yaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
          vec3 toCam = cameraPosition - base; float tl = max(length(toCam.xz), 1e-3);
          vec3 right = vec3(toCam.z, 0.0, -toCam.x) / tl;
          float rel = atan(toCam.x, toCam.z) - yaw;
          float k = mod(floor(rel / ${(Math.PI * 2 / V).toFixed(6)} + 0.5), ${V}.0);
          vUv = vec2((k + position.x + 0.5) / ${V}.0, (aImp.x + position.y + 0.5) / ${nM}.0);
          vTint = instanceColor;
          vec3 wp = base + right * (position.x * 2.0 * aImp.y * sx) + vec3(0.0, (aImp.z + position.y * 2.0 * aImp.y) * sy, 0.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D tAtlas; uniform vec3 uSunC; varying vec2 vTreeLod;
        varying vec2 vUv; varying vec3 vTint;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(tAtlas, vUv);
          if (c.a < 0.45) discard;
          ${TL.Trees.dither}
          float day = clamp(length(uSunC), 0.0, 1.2);
          gl_FragColor = vec4(c.rgb * vTint * (0.34 + 0.66 * day), 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
          #include <fog_fragment>
        }`,
      fog: true, side: THREE.DoubleSide,
    });
    mat.uniforms.tAtlas.value = baked.rt.texture; mat.uniforms.uSunC = mats.U.uSunC;        // UniformsUtils.merge clones textures / colours: point back at the shared ones
    const mesh = new THREE.InstancedMesh(g, mat, cap);
    mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = 'TREE_IMPOSTORS';
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    return { mesh, aImp, fade, info: baked.info, rt: baked.rt };
  },
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
        const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2); fade.setUsage(THREE.DynamicDrawUsage);
        const G = { im, ic, fade, n: 0, parts: [] };
        const L = md.lods[l];
        for (const key of ['bark', 'leaf']) {
          const g = L[key]; if (!g) continue;
          const view = TL.CellInstancing.view(g, g.boundingSphere);
          view.setAttribute('aTreeLod', fade);
          const mesh = new THREE.InstancedMesh(view, key === 'leaf' ? this.mats.leaf : this.mats.bark[md.sp], cap);
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
    this.imp = null;
    if (opts.impostors !== false) { try { this.imp = TL.TreeImpostors.create(scene, renderer, data, this.mats, Math.max(1, n)); } catch (e) { TL.logError ? TL.logError(e, 'tree impostors') : console.error(e); } }
    this._frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._v = new THREE.Vector3();
    this._camPos = new THREE.Vector3(1e9, 0, 0); this._camQ = new THREE.Quaternion(); this.dirty = true;
    this.stats = { visible: 0, lod: [0, 0, 0, 0] };
  }
  setQuality(q) {
    this.quality = q;
    const k = { low: 0.55, medium: 0.8, high: 1, ultra: 1.35 }[q] || 1;
    this.d0 = 42 * k; this.d1 = 150 * k; this.d2 = 360 * k; this.dMax = 1500;
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
    const d0 = this.d0, d1 = this.d1, d2 = this.imp ? this.d2 : 1e9, dM = this.dMax, bounds = this.imp ? [d0, d1, d2] : [d0, d1];
    let vis = 0; const lc = this.stats.lod; lc[0] = lc[1] = lc[2] = lc[3] = 0;
    let ni = 0; const IM = this.imp, mod = this.data.models;
    for (let i = 0; i < list.length; i++) {
      const x = bs[i * 4], y = bs[i * 4 + 1], z = bs[i * 4 + 2], r = bs[i * 4 + 3];
      const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      if (d > dM) { this.lod[i] = -1; continue; }
      let inside = true;
      for (let k = 0; k < 6; k++) { const pl = F[k]; if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -r) { inside = false; break; } }
      if (!inside && d > 30) { this.lod[i] = -1; continue; }         // near trees stay for their shadows
      const blend = TL.Trees.blend(d, bounds, this._blend || (this._blend = {}));
      this.lod[i] = blend.mix > 0.5 ? blend.far : blend.near;
      for (let side = 0; side < (blend.near === blend.far ? 1 : 2); side++) {
        const l = side ? blend.far : blend.near;
        const amount = blend.near === blend.far ? 1 : blend.mix;
        const role = blend.near === blend.far || side ? 1 : -1;
        if (l === 3) {
          IM.mesh.instanceMatrix.array.set(mat.subarray(i * 16, i * 16 + 16), ni * 16);
          IM.mesh.instanceColor.array.set(tint.subarray(i * 3, i * 3 + 3), ni * 3);
          const inf = IM.info[list[i].m]; IM.aImp.array[ni * 4] = list[i].m; IM.aImp.array[ni * 4 + 1] = inf.half; IM.aImp.array[ni * 4 + 2] = inf.ymid;
          IM.fade.array[ni * 2] = amount; IM.fade.array[ni * 2 + 1] = role;
          ni++; lc[3]++; continue;
        }
        const G = this.groups[list[i].m][l], o = G.n++;
        G.im.array.set(mat.subarray(i * 16, i * 16 + 16), o * 16);
        G.ic.array.set(tint.subarray(i * 3, i * 3 + 3), o * 3);
        G.fade.array[o * 2] = amount; G.fade.array[o * 2 + 1] = role;
        lc[l]++;
      }
      vis++;
    }
    for (const row of this.groups) for (const G of row) {
      for (const m of G.parts) m.count = G.n;
      if (G.n) { G.im.needsUpdate = true; G.ic.needsUpdate = true; G.fade.needsUpdate = true; G.fade.updateRange.count = G.n * 2; G.im.updateRange.count = G.n * 16; G.ic.updateRange.count = G.n * 3; }
    }
    if (IM) { IM.mesh.count = ni; IM.mesh.visible = ni > 0; if (ni) { IM.mesh.instanceMatrix.needsUpdate = true; IM.mesh.instanceColor.needsUpdate = true; IM.aImp.needsUpdate = true; IM.fade.needsUpdate = true; IM.fade.updateRange.count = ni * 2; IM.mesh.instanceMatrix.updateRange.count = ni * 16; IM.mesh.instanceColor.updateRange.count = ni * 3; IM.aImp.updateRange.count = ni * 4; } }
    this.stats.visible = vis;
  }
  dispose() {
    for (const m of this.meshes) { this.scene.remove(m); m.dispose && m.dispose(); m.geometry.dispose(); }
    if (this.imp) { this.scene.remove(this.imp.mesh); this.imp.mesh.dispose(); this.imp.mesh.geometry.dispose(); this.imp.mesh.material.dispose(); this.imp.rt.dispose(); }
    const materials = new Set([this.mats.leaf, this.mats.leafDepth, this.mats.barkDepth, ...Object.values(this.mats.bark)]), textures = new Set();
    for (const m of materials) { for (const value of Object.values(m)) if (value && value.isTexture) textures.add(value); m.dispose(); }
    for (const texture of textures) texture.dispose();
    this.meshes.length = 0; this.groups.length = 0; this.imp = null;
  }
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
      // individuals per role (name, name_v2, name_v3 ...): one per tree by a position hash, so a stand does not read as clones
      const roles = L.models.map((n) => names.reduce((a, m, i) => (m === n || m.indexOf(n + '_v') === 0 ? a.concat(i) : a), []));
      const list = [];
      for (const t of L.trees) {                         // [x, z, model, yaw, scale, sx, r, g, b]
        let mi = idx[t[2]]; if (mi < 0) continue;
        const rl = roles[t[2]]; if (rl.length > 1) mi = rl[(Math.abs(Math.floor(t[0] * 73.1 + t[1] * 131.7)) % 997) % rl.length];
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
