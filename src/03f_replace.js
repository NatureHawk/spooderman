/* =====================================================================================
   BUILDING REPLACEMENT — modelled buildings (src/new-york-city CityGen block) swapped in for NYC buildings of matching size (seed MAN). Registers into TL.ScanHooks.
   tools/scan/replace_buildings.py split the CityGen model into buildings, matched them to NYC DCP buildings whose width,
   depth and main-roof height are each within 92% (and whose footprint / roof profile really have the same shape, iconic
   buildings excluded), and fitted each one onto the real footprint (yaw + <= 8% scale per axis).
   Data (#tl-extra): repl_meta.json  parts (per candidate x class: vertex ranges), inst (bid, cand, x, z, yaw, sx, sy, sz),
                                     boxes (x, top, z, hx, hz, yaw, bid), replaced ids
                     repl_geo.bin.gz  per part: position f32x3 | uv f32x2 | atlas rect f32x4 | colour u8x3 | pbr u8x4
                     repl_atlas.webp  shared RGBA atlas: rgb colour; alpha = coverage (cut-out parts) or 0 on window glass
   Rendering: one InstancedMesh per candidate x class (opaque / cut-out / glass) — a candidate used twice is one draw.
   Tiling materials keep their repeat through the atlas (fract + textureGrad per vertex rect); walls get the NYC photo-lit
   emissive share by day (world.mat.emissiveIntensity) so they sit at the same brightness, and lit windows at night.
   ===================================================================================== */
'use strict';

TL.Replace = {
  ok: false,
  async load(data) {
    this.ok = false;
    if (!data.nyc || !TL.Extra.has('repl_meta.json') || !TL.Extra.has('repl_geo.bin.gz') || !TL.Extra.has('repl_atlas.webp')) return;
    const meta = await TL.Extra.json('repl_meta.json');
    // keyed on building ids: drop instances whose building is gone from this nyc.json (data made for another build)
    const have = new Set(data.nyc.buildings.map((b) => b.id));
    meta.inst = meta.inst.filter((i) => have.has(i.bid));
    if (!meta.inst.length) return;
    this.meta = meta;
    this.buf = await TL.Extra.buffer('repl_geo.bin.gz');
    this.img = await TL.Extra.image('repl_atlas.webp');
    this.ok = true;
  },

  material(world, cls) {
    const U = world.mats.uniforms, R = this;
    if (cls === 'glass') {
      return new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    }
    const m = new THREE.MeshStandardMaterial({ map: this.tex, vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    if (cls === 'alpha') { m.alphaTest = 0.5; }
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uNight: U.uNight, uWet: U.uWet, uSkyH: U.uSkyH, uSkyZ: U.uSkyZ, uDay: R.uDay, uDiffuse: R.uDiffuse });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nattribute vec4 aPbr;\nvarying vec4 vRect;\nvarying vec4 vPbr;\nvarying vec3 vRWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRect = aRect; vPbr = aPbr;\nvec4 rwp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nrwp = instanceMatrix * rwp;\n#endif\nvRWP = (modelMatrix * rwp).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec4 vRect; varying vec4 vPbr; varying vec3 vRWP;
uniform float uNight, uWet, uDay, uDiffuse; uniform vec3 uSkyH, uSkyZ;
float rpHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rpWin; vec3 rpAlb;`)
        .replace('#include <map_fragment>', `
  vec4 rpTex = vec4(1.0);
  if (vRect.x >= 0.0) {
    if (vRect.z > 0.0) {                                  // tiling material: wrap inside its atlas rect
      vec2 t = vRect.xy + fract(vUv) * vRect.zw;
      rpTex = textureGrad(map, t, dFdx(vUv) * vRect.zw, dFdy(vUv) * vRect.zw);
    } else rpTex = texture2D(map, vUv);                   // pre-mapped into the atlas
  }
  diffuseColor.rgb *= rpTex.rgb;
  #ifdef USE_ALPHATEST
    diffuseColor.a *= rpTex.a;
    rpWin = 0.0;
  #else
    // window glass: atlas alpha 0 on window panes (win flag 1) or the whole surface (curtain-wall panels, flag 2)
    rpWin = vPbr.z > 0.75 ? 1.0 : vPbr.z > 0.25 ? 1.0 - rpTex.a : 0.0;
  #endif
`)
        // after the vertex (base colour factor) and instance (tint) colours: the emissive photo-lit share uses the final albedo
        .replace('#include <color_fragment>', `#include <color_fragment>
  rpAlb = diffuseColor.rgb;
  diffuseColor.rgb *= uDiffuse;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(vPbr.x, vPbr.x * 0.6, uWet), 0.12, rpWin);')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(vPbr.y, 0.0, rpWin);')
        // like the NYC facade material: no image-based light (walls carry the photo-lit share; glass gets its sky
        // reflection analytically below) -> same brightness as the buildings around, day and night
        .replace('#include <lights_fragment_maps>', '')
        .replace('#include <emissivemap_fragment>', `
  // photo-lit share like the NYC buildings around (their emissive day factor), glass stays dark and reflective;
  // night: about a quarter of the windows lit, per window cell (world grid ~1.5 m x 3.4 m storeys)
  totalEmissiveRadiance = rpAlb * uDay * (1.0 - 0.75 * rpWin);
  // window glass reflects the sky like the NYC facades' glass (analytic: no reflection probe needed)
  vec3 rpV = normalize(vViewPosition), rpN = normalize(normal);
  vec3 rpR = inverseTransformDirection(reflect(-rpV, rpN), viewMatrix);
  float rpF = 0.08 + 0.92 * pow(1.0 - clamp(abs(dot(rpN, rpV)), 0.0, 1.0), 5.0);
  vec3 rpSky = rpR.y > 0.0 ? mix(uSkyH, uSkyZ, pow(clamp(rpR.y, 0.0, 1.0), 0.6)) : uSkyH * mix(0.45, 0.15, clamp(-rpR.y * 2.5, 0.0, 1.0));
  totalEmissiveRadiance += rpSky * (0.22 + 0.6 * rpF) * rpWin * (1.0 - 0.85 * smoothstep(0.05, 0.6, uNight));
  vec3 cell = floor(vRWP / vec3(1.5, 3.4, 1.5));
  float hsh = rpHash(cell), lit = step(hsh, 0.28) * smoothstep(0.05, 0.6, uNight);
  vec3 lamp = (rpHash(cell + 7.0) < 0.72 ? vec3(1.0, 0.72, 0.42) : vec3(0.82, 0.9, 1.0)) * (0.35 + 0.65 * rpHash(cell + 13.0));
  totalEmissiveRadiance += lamp * lit * rpWin * 0.9;`);
    };
    m.customProgramCacheKey = () => 'tl-repl-' + cls;
    return m;
  },

  build(world) {
    if (!this.ok) return;
    const M = this.meta, B = this.buf, r = world.game.renderer;
    const tex = new THREE.Texture(this.img);
    tex.encoding = THREE.sRGBEncoding; tex.flipY = false;               // glTF UVs: origin top-left
    tex.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true;
    this.tex = tex;
    this.uDay = { value: 0.6 }; this.uDiffuse = { value: 0.45 };
    const mats = { opaque: this.material(world, 'opaque'), alpha: this.material(world, 'alpha'), glass: this.material(world, 'glass') };
    this.mats = mats;
    const byCand = new Map();
    for (const i of M.inst) { if (!byCand.has(i.cand)) byCand.set(i.cand, []); byCand.get(i.cand).push(i); }
    const col = new THREE.Color(), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.meshes = [];
    for (const P of M.parts) {
      const list = byCand.get(P.cand); if (!list) continue;
      const g = new THREE.BufferGeometry(), n = P.n * 3;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(B, P.p, n * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(B, P.uv, n * 2), 2));
      g.setAttribute('aRect', new THREE.BufferAttribute(new Float32Array(B, P.rc, n * 4), 4));
      g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(B, P.c, n * 3), 3, true));
      g.setAttribute('aPbr', new THREE.BufferAttribute(new Uint8Array(B, P.pb, n * 4), 4, true));
      g.computeVertexNormals();                                          // non-indexed: flat, like the source
      g.computeBoundingSphere();
      const mesh = new THREE.InstancedMesh(g, mats[P.cls], list.length);
      // world-space bounds over all instances (InstancedMesh culls with the geometry's own sphere)
      const bs = g.boundingSphere, pts = [];
      list.forEach((it, k) => {
        q.setFromAxisAngle(up, it.yaw); s.set(it.sx, it.sy, it.sz); p.set(it.x, 0, it.z);
        mtx.compose(p, q, s); mesh.setMatrixAt(k, mtx);
        if (it.tint) mesh.setColorAt(k, col.setRGB(it.tint[0], it.tint[1], it.tint[2]));   // toward the real building's colour
        pts.push(bs.center.clone().applyMatrix4(mtx));
      });
      const c = pts.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / pts.length);
      let rad = 0; for (const v of pts) rad = Math.max(rad, v.distanceTo(c));
      g.boundingSphere = new THREE.Sphere(c, rad + bs.radius * 1.1);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = P.cls !== 'glass'; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      mesh.name = 'REPL_' + P.cand + '_' + P.cls;
      world.scene.add(mesh); this.meshes.push(mesh);
    }
    // colliders following each model's tiers (the NYC building's own boxes were dropped through world.replaced)
    for (const b of M.boxes) {
      if (!world.replaced.has(b[6])) continue;
      const top = b[1], hy = (top + 1) / 2;
      world.world.addStatic(b[0], top - hy, b[2], b[3], hy, b[4], b[5], { kind: 'building', climb: true, src: 'repl', bid: b[6] });
    }
    world.stats.replaced = M.inst.length;
  },

  update(world) {
    if (!this.ok || !this.uDay) return;
    // the NYC material's emissive day factor (0.1 night .. 0.72 clear day): same photo-lit share on the models
    const e = world.mat ? world.mat.emissiveIntensity : 0.72;
    this.uDay.value = e * 0.85;
  },
};

if (TL.ScanHooks) {
  TL.ScanHooks.load.push(async (data) => {
    try { await TL.Replace.load(data); } catch (e) { TL.Replace.ok = false; TL.logError ? TL.logError(e, 'replace') : console.error(e); }
  });
  TL.ScanHooks.preNYC.push((world) => {
    if (!TL.Replace.ok) return;
    for (const i of TL.Replace.meta.inst) world.replaced.add(i.bid);
  });
  TL.ScanHooks.build.push((world) => {
    try { TL.Replace.build(world); } catch (e) { TL.logError ? TL.logError(e, 'replace') : console.error(e); }
  });
  TL.ScanHooks.update.push((world) => TL.Replace.update(world));
}
