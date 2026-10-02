/* =====================================================================================
   STREETS — road/sidewalk surfaces + street furniture from src/street (seed MAN). Registers into TL.ScanHooks.
   Data: tools/scan/streets.py -> #tl-extra streets_meta.json + streets_data.bin.gz + streets_*.webp.
   Surfaces  the flat scan ground stays as the roadbed (asphalt from the street set, gutters, wet patches);
             sidewalks / plazas / parks are a slab 15 cm up with granite curb faces along every real roadbed edge.
             Fragment shaders find the nearest curb segment exactly (4 m grid -> 8 segment ids -> segment table):
             flags aligned to their own curb, granite curb top, gutter grime, joints with a bevel (bump).
   Paint     lane lines / high-visibility crosswalks / stop bars / manholes / grates / tree pits as decal quads
             (pulled a hair towards the camera in the vertex shader, so they never z-fight at range).
   Props     the street set's cobra-head lights, signal masts, lanterns, parking signs, hydrants, meters,
             mailboxes, litter baskets, bollards + the city pack's bench / bike rack: one InstancedMesh per type
             (and a reduced LOD for the masts / lights), per-frame distance + frustum pass; lamp glow at night
             (emissive lenses, additive glow sprites, light pools painted on the ground); thin pole colliders.
   Physics   the world ground function returns +15 cm on the slab, pedestrians' sidewalk loops follow it.
   ===================================================================================== */
'use strict';

TL.Streets = {
  ok: false,
  async load(step) {
    const X = TL.Extra;
    if (!X || !X.has('streets_meta.json') || !X.has('streets_data.bin.gz')) return null;
    step && step(0.975, 'Laying the streets');
    const meta = await X.json('streets_meta.json');
    const buf = await X.buffer('streets_data.bin.gz');
    const T = { Float32Array, Uint8Array, Int16Array, Int32Array, Uint16Array };
    const arr = {};
    for (const [k, p] of Object.entries(meta.parts)) {
      const C = { float32: Float32Array, uint8: Uint8Array, int16: Int16Array, int32: Int32Array, uint16: Uint16Array }[p.t];
      arr[k] = new C(buf, p.o, p.n);
    }
    const names = ['streets_asphalt.webp', 'streets_flags.webp', 'streets_grime.webp', 'streets_wear.webp', 'streets_covers.webp', 'streets_grass.webp', 'streets_kit.webp', 'streets_assets.webp'];
    const imgs = {};
    await Promise.all(names.map(async (n) => { if (X.has(n)) imgs[n] = await X.image(n); }));
    void T;
    this.data = { meta, arr, imgs };
    this.ok = true;
    return this.data;
  },
  /* 1 on the raised slab (sidewalks, plazas, parks) */
  raised(x, z) {
    const D = this.data; if (!D) return 0;
    const F = D.meta.frame, c = Math.floor((x - F.x0) / F.rc), r = Math.floor((z - F.z0) / F.rc);
    if (c < 0 || r < 0 || c >= F.w || r >= F.h) return 0;
    const i = r * F.w + c;
    return (D.arr.raised[i >> 3] >> (i & 7)) & 1;
  },
};

/* ------------------------------------------------------------------ shared shader code */
TL.StreetShaders = {
  common: `
    uniform sampler2D tSeg; uniform sampler2D tGrid; uniform sampler2D tPool;
    uniform vec4 uGrid; uniform vec4 uPoolF; uniform float uSegW;
    uniform float uNight; uniform float uWet; uniform float uTime;
    float tlHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float tlNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(tlHash(i), tlHash(i + vec2(1, 0)), u.x), mix(tlHash(i + vec2(0, 1)), tlHash(i + vec2(1, 1)), u.x), u.y); }
    float tlFbm(vec2 p) { return tlNoise(p) * 0.55 + tlNoise(p * 2.13 + 7.1) * 0.3 + tlNoise(p * 4.37 + 3.3) * 0.15; }
    // nearest curb segment: x = distance, y = u along its paving frame, zw = frame direction (road on its right);
    // side = v (distance from the frame's curb line, + on the sidewalk), h = chain hash
    vec4 tlCurb(vec2 p, out float h, out float side) {
      vec4 r = vec4(1e4, 0.0, 1.0, 0.0); h = 0.0; side = 0.0;
      ivec2 g = ivec2(floor((p - uGrid.xy) / uGrid.z));
      if (g.x < 0 || g.y < 0 || float(g.x) >= uGrid.w || g.y >= textureSize(tGrid, 0).y) return r;
      vec4 i0 = texelFetch(tGrid, ivec2(g.x * 2, g.y), 0), i1 = texelFetch(tGrid, ivec2(g.x * 2 + 1, g.y), 0);
      int SW = int(uSegW);
      for (int k = 0; k < 8; k++) {
        float id = k < 4 ? i0[k] : i1[k - 4];
        if (id < 0.0) break;
        int ii = int(id) * 2;
        ivec2 tc = ivec2(ii % SW, ii / SW);
        vec4 ab = texelFetch(tSeg, tc, 0); vec4 sh = texelFetch(tSeg, tc + ivec2(1, 0), 0);
        vec2 a = ab.xy, d = ab.zw - ab.xy; float L2 = max(dot(d, d), 1e-8);
        float t = clamp(dot(p - a, d) / L2, 0.0, 1.0);
        vec2 q = a + d * t; float dist = length(p - q);
        if (dist < r.x) {
          // paving frame of the segment's straight run: u along it (phase-continuous), v away from its curb line
          vec2 fd = vec2(cos(sh.z), sin(sh.z)), po = p - sh.xy;
          r = vec4(dist, dot(po, fd), fd); h = sh.w; side = dot(po, vec2(fd.y, -fd.x));
        }
      }
      return r;
    }
    float tlPool(vec2 p) { return texture(tPool, (p - uPoolF.xy) / uPoolF.zw).r * 1.6; }
    vec3 tlBumpN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
      vec3 vSigmaX = dFdx(surf_pos), vSigmaY = dFdy(surf_pos), vN = surf_norm;
      vec3 R1 = cross(vSigmaY, vN), R2 = cross(vN, vSigmaX);
      float fDet = dot(vSigmaX, R1) * faceDir;
      vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
      return normalize(abs(fDet) * surf_norm - vGrad);
    }
    // granite (curb stone): grey with pink feldspar + dark mica speckle, sawn joints every 1.83 m
    vec3 tlGranite(vec2 p, float along, out float hj) {
      float n1 = tlNoise(p * 260.0), n2 = tlNoise(p * 90.0 + 3.0), n3 = tlNoise(p * 18.0);
      vec3 c = vec3(0.50, 0.49, 0.47) * (0.86 + 0.22 * n3);
      c = mix(c, vec3(0.62, 0.52, 0.48), smoothstep(0.62, 0.8, n2) * 0.6);
      c = mix(c, vec3(0.16, 0.16, 0.17), smoothstep(0.72, 0.9, n1) * 0.8);
      c = mix(c, vec3(0.80, 0.79, 0.76), smoothstep(0.80, 0.95, tlNoise(p * 310.0 + 9.0)) * 0.6);
      float j = abs(fract(along / 1.83 + 0.5) - 0.5) * 1.83;
      hj = smoothstep(0.004, 0.014, j);
      return c * mix(0.55, 1.0, hj);
    }
  `,
  vert: (inst) => ({
    pars: `varying vec3 vWp;\n#include <common>`,
    main: `#include <project_vertex>\n vWp = (modelMatrix * ${inst ? 'instanceMatrix * ' : ''}vec4(transformed, 1.0)).xyz;`,
  }),
};

/* ------------------------------------------------------------------ materials */
TL.StreetMaterials = function (world, D) {
  const r = world.game.renderer, aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
  const M = D.meta, A = D.arr;
  const tex = (n, srgb, rep = true) => {
    const im = D.imgs[n]; if (!im) return null;
    const t = new THREE.Texture(im);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso; t.needsUpdate = true;
    return t;
  };
  // segment table: 2 RGBA32F texels per segment, rows of 2048
  const SW = 2048, ns = M.nseg, sh = Math.max(1, Math.ceil(ns * 2 / SW));
  const segData = new Float32Array(SW * sh * 4); segData.set(A.seg.subarray(0, ns * 8));
  const tSeg = new THREE.DataTexture(segData, SW, sh, THREE.RGBAFormat, THREE.FloatType);
  const G = M.grid, gd = new Float32Array(G.nx * 2 * G.nz * 4);
  for (let i = 0; i < G.nx * G.nz * 8; i++) gd[i] = A.grid[i];
  const tGrid = new THREE.DataTexture(gd, G.nx * 2, G.nz, THREE.RGBAFormat, THREE.FloatType);
  const P = M.pools, tPool = new THREE.DataTexture(A.pools, P.w, P.h, THREE.RedFormat, THREE.UnsignedByteType);
  for (const t of [tSeg, tGrid]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
  tPool.magFilter = tPool.minFilter = THREE.LinearFilter; tPool.generateMipmaps = false; tPool.needsUpdate = true;
  const F = M.frame;
  const U = this.uniforms = {
    tSeg: { value: tSeg }, tGrid: { value: tGrid }, tPool: { value: tPool }, uSegW: { value: SW },
    uGrid: { value: new THREE.Vector4(F.x0, F.z0, G.cell, G.nx) }, uPoolF: { value: new THREE.Vector4(F.x0, F.z0, P.w * P.cell, P.h * P.cell) },
    uNight: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 }, uSkyHw: { value: new THREE.Color(0.7, 0.75, 0.8) }, uSkyZw: { value: new THREE.Color(0.4, 0.5, 0.7) },
    tAsph: { value: tex('streets_asphalt.webp', true) }, tFlags: { value: tex('streets_flags.webp', true) }, tGrime: { value: tex('streets_grime.webp', false) },
    tWear: { value: tex('streets_wear.webp', false) }, tCovers: { value: tex('streets_covers.webp', true, false) }, tGrass: { value: tex('streets_grass.webp', true) },
  };
  this.kitTex = tex('streets_kit.webp', true); this.assetTex = tex('streets_assets.webp', true);
  const SH = TL.StreetShaders;
  const patch = (mat, uni, fragPars, albedo, rough, bump, emis, inst) => {
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uni);
      const v = SH.vert(inst);
      s.vertexShader = s.vertexShader.replace('#include <common>', v.pars).replace('#include <project_vertex>', v.main);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\n' + SH.common + fragPars)
        .replace('#include <map_fragment>', albedo)
        .replace('#include <roughnessmap_fragment>', rough)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + bump)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + emis);
    };
    mat.customProgramCacheKey = () => 'tlstreet' + albedo.length + fragPars.length + (inst ? 'i' : '');
    return mat;
  };

  /* ---------------- roadbed: the set's asphalt, aligned with its street, gutters along the curbs */
  this.ground = patch(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), U, `
    uniform sampler2D tAsph; uniform sampler2D tGrime; uniform sampler2D tFlags; uniform vec3 uSkyHw, uSkyZw;
    float gH; float gRough; vec3 gAlb; float gWetM;
    // wet sheen (graphics pass): analytic sky reflection, Fresnel of water, strongest in puddles / gutters
    vec3 tlWetSheen(float m, float k) { vec3 V = normalize(vWp - cameraPosition); float F = 0.02 + 0.98 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
      return mix(uSkyHw, uSkyZw, 0.2) * (1.0 - uNight * 0.85) * F * uWet * m * k; }
  `, `
    {
      vec2 p = vWp.xz;
      float dist = length(vWp - cameraPosition);
      float ch = 0.0, side = 0.0; vec4 cb = vec4(1e4, 0.0, 1.0, 0.0);
      if (dist < 320.0) cb = tlCurb(p, ch, side);
      // the set's strip texture runs along the street (streaks + wet patches with the traffic)
      vec2 dir = cb.x < 30.0 ? cb.zw : vec2(1.0, 0.0);
      mat2 R = mat2(dir.x, -dir.y, dir.y, dir.x);
      vec2 q = R * p;
      vec2 dx = R * dFdx(p), dy = R * dFdy(p);
      vec4 a1 = textureGrad(tAsph, q / 5.6, dx / 5.6, dy / 5.6);
      vec4 a2 = textureGrad(tAsph, q.yx / 13.7 + 0.31, dx.yx / 13.7, dy.yx / 13.7);
      float macro = texture(tGrime, p / 61.0).g * 0.6 + texture(tGrime, p / 23.0 + 0.4).r * 0.4;
      vec3 c = mix(a1.rgb, a2.rgb, 0.35) * (0.86 + 0.32 * macro);
      c *= mix(0.92, 1.06, tlNoise(p * 0.11));
      // patches / trench cuts: slightly darker, fresher asphalt rectangles
      vec2 pc = floor(q / vec2(9.0, 3.2));
      float patchy = step(0.86, tlHash(pc + ch * 31.0)) * step(abs(fract(q.y / 3.2) - 0.5), 0.36) * step(abs(fract(q.x / 9.0) - 0.5), 0.42);
      c = mix(c, c * 0.72 + vec3(0.012), patchy * step(1.2, cb.x));
      // gutter: concrete-ish lip and grime within ~0.5 m of the curb
      float gut = 1.0 - smoothstep(0.0, 0.55, cb.x);
      float grime = texture(tGrime, vec2(cb.y / 6.0, cb.x / 1.2 + ch)).r;
      c = mix(c, c * (0.55 + 0.25 * grime), gut * 0.85);
      gWetM = clamp(max(a1.a * 0.8, gut * 0.9) * smoothstep(0.25, 0.75, tlFbm(p * 0.07)) + gut * 0.5, 0.0, 1.0);
      gAlb = c;
      gH = (a1.r - 0.3) * 0.25 * (1.0 - patchy * 0.6) + patchy * 0.012;
      gRough = mix(0.93, 0.80, patchy);
    }
    diffuseColor.rgb = gAlb * mix(1.0, mix(0.7, 0.5, gWetM), uWet);   // wet asphalt darkens; standing water most
  `, `
    float roughnessFactor = mix(gRough, mix(0.32, 0.05, gWetM), uWet);
  `, `
    { float hh = gH * (1.0 - uWet * gWetM); vec2 dH = vec2(dFdx(hh), dFdy(hh)) * 0.6;
      normal = tlBumpN(-vViewPosition, normal, dH, faceDirection); }
  `, `
    totalEmissiveRadiance += gAlb * tlPool(vWp.xz) * vec3(1.0, 0.78, 0.52) * uNight * 0.9;
    totalEmissiveRadiance += tlWetSheen(mix(0.18, 1.0, gWetM), 0.7);
  `);

  /* ---------------- slab: flags aligned with their own curb, granite curb top, plaza pavers, park grass */
  this.slab = patch(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), U, `
    uniform sampler2D tFlags; uniform sampler2D tGrime; uniform sampler2D tGrass; uniform sampler2D tAsph; uniform vec3 uSkyHw, uSkyZw;
    vec3 tlWetSheen(float m, float k) { vec3 V = normalize(vWp - cameraPosition); float F = 0.02 + 0.98 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
      return mix(uSkyHw, uSkyZw, 0.2) * (1.0 - uNight * 0.85) * F * uWet * m * k; }
    varying float vK;
    float sH; float sRough; vec3 sAlb; float sWetM;
  `, `
    {
      vec2 p = vWp.xz;
      float dist = length(vWp - cameraPosition);
      float ch = 0.0, side = 0.0; vec4 cb = vec4(1e4, 0.0, 1.0, 0.0);
      if (dist < 300.0) cb = tlCurb(p, ch, side);
      float kind = floor(vK + 0.5);
      float near = step(cb.x, 16.0);
      // frame: u along the curb, v away from it (world aligned far from any curb)
      vec2 uv = near > 0.5 ? vec2(cb.y, side - 0.24) : p;
      float fs = kind > 0.5 ? 0.92 : 1.524;                     // 5 ft flags / plaza pavers
      vec2 cell = floor(uv / fs), f = fract(uv / fs);
      float hc = tlHash(cell + ch * 17.0);
      // the set's cracked flag tile (2x2 flags per tile): pick one of its four flags, mirror per flag
      vec2 fq = mix(f, 1.0 - f, step(0.5, vec2(tlHash(cell + 3.1), tlHash(cell + 5.7))));
      vec2 tuv = (fq + floor(vec2(hc, fract(hc * 7.0)) * 2.0)) * 0.5;
      // derivatives from the world position rotated into the frame (uv itself jumps on the corner seams)
      vec2 fdir = near > 0.5 ? cb.zw : vec2(1.0, 0.0), fl2 = vec2(fdir.y, -fdir.x);
      vec2 dpx = dFdx(p), dpy = dFdy(p);
      vec2 gx = vec2(dot(dpx, fdir), dot(dpx, fl2)) / fs * 0.5, gy = vec2(dot(dpy, fdir), dot(dpy, fl2)) / fs * 0.5;
      vec4 fl = textureGrad(tFlags, tuv, gx, gy);
      vec3 c = fl.rgb * (0.53 + 0.12 * hc) * vec3(1.0, 0.985, 0.95);
      c *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), step(0.7, fract(hc * 13.0)));
      // joints (8 mm, bevelled) + the set's cracks (alpha)
      vec2 e = min(f, 1.0 - f) * fs;
      float jw = (abs(dpx.x) + abs(dpx.y) + abs(dpy.x) + abs(dpy.y)) * 0.7;
      float joint = 1.0 - smoothstep(0.004, 0.012 + jw, min(e.x, e.y));
      float crack = (1.0 - smoothstep(0.08, 0.3, fl.a)) * step(0.45, fract(hc * 5.3));
      c *= 1.0 - joint * 0.45 - crack * 0.35;
      // grime + gum spots
      float gr = texture(tGrime, p / 7.3).r * 0.6 + texture(tGrime, p / 27.0 + 0.3).g * 0.4;
      c *= 0.78 + 0.3 * gr;
      vec2 gc = floor(p * 3.0); float gum = step(0.985, tlHash(gc + 0.7)) * (1.0 - smoothstep(0.05, 0.11, length(fract(p * 3.0) - 0.5 - (vec2(tlHash(gc + 1.3), tlHash(gc + 2.9)) - 0.5) * 0.6)));
      c = mix(c, vec3(0.13, 0.13, 0.14), gum * 0.75 * step(kind, 0.5));
      if (kind > 0.5 && kind < 1.5) c = c * vec3(1.02, 0.97, 0.9) * 0.95;           // plaza: warmer pavers
      float h = (1.0 - joint) * 0.02 - crack * 0.01 + fl.r * 0.012;
      float rough = 0.86;
      // park: grass + worn dirt
      if (kind > 1.5) {
        vec3 g1 = texture(tGrass, p / 3.1).rgb, g2 = texture(tGrass, p.yx / 9.7 + 0.2).rgb;
        vec3 gcol = mix(g1, g2, 0.4) * (0.62 + 0.4 * tlFbm(p * 0.09));
        gcol = mix(vec3(dot(gcol, vec3(0.3, 0.55, 0.15))), gcol, 0.78) * vec3(0.95, 0.97, 0.85);
        float dirt = smoothstep(0.62, 0.8, tlFbm(p * 0.05 + 4.0));
        c = mix(gcol, vec3(0.30, 0.25, 0.19) * (0.8 + 0.4 * gr), dirt * 0.7);
        h = tlNoise(p * 40.0) * 0.015; rough = 0.95;
      }
      // granite curb top: the first 24 cm behind the curb line (every kind)
      float hj;
      vec3 gcol = tlGranite(p, cb.y, hj);
      float curb = (1.0 - smoothstep(0.235, 0.245 + jw, cb.x)) * near;
      float lip = smoothstep(0.0, 0.03, cb.x);                    // rounded arris at the road edge
      c = mix(c, gcol * (0.75 + 0.25 * lip) * (0.85 + 0.25 * gr), curb);
      h = mix(h, hj * 0.01 + lip * 0.02, curb);
      rough = mix(rough, 0.62, curb);
      sAlb = c; sH = h; sRough = rough;
      sWetM = clamp(joint + crack + (1.0 - lip) * curb + smoothstep(0.55, 0.8, tlFbm(p * 0.13)) * 0.6, 0.0, 1.0);
    }
    diffuseColor.rgb = sAlb * mix(1.0, mix(0.74, 0.58, sWetM), uWet);
  `, `
    float roughnessFactor = mix(sRough, mix(0.38, 0.1, sWetM), uWet);
  `, `
    { vec2 dH = vec2(dFdx(sH), dFdy(sH)) * 0.7; normal = tlBumpN(-vViewPosition, normal, dH, faceDirection); }
  `, `
    totalEmissiveRadiance += sAlb * tlPool(vWp.xz) * vec3(1.0, 0.8, 0.55) * uNight * 0.9;
    totalEmissiveRadiance += tlWetSheen(mix(0.1, 0.7, sWetM), 0.45);
  `);
  const sv = this.slab.onBeforeCompile;
  this.slab.onBeforeCompile = (s) => {
    sv(s);
    s.vertexShader = s.vertexShader.replace('varying vec3 vWp;', 'varying vec3 vWp;\nattribute float aK;\nvarying float vK;').replace('#include <project_vertex>', '#include <project_vertex>\nvK = aK;');
  };

  /* ---------------- curb faces: granite, dirtier at the gutter; shore edges plain concrete */
  this.curb = patch(new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, side: THREE.DoubleSide }), U, `
    uniform sampler2D tGrime; varying vec2 vUv2; float cH; vec3 cAlb;
  `, `
    {
      float hj; vec3 g = tlGranite(vWp.xz + vWp.y * 3.1, vUv2.x, hj);
      float dirt = 1.0 - smoothstep(0.0, 0.7, vUv2.y);
      g *= mix(1.0, 0.45 + 0.3 * texture(tGrime, vec2(vUv2.x / 5.0, vUv2.y)).r, dirt);
      cAlb = g; cH = hj * 0.01;
    }
    diffuseColor.rgb = cAlb * mix(1.0, 0.6, uWet);
  `, `float roughnessFactor = mix(0.7, 0.2, uWet);`, `
    { vec2 dH = vec2(dFdx(cH), dFdy(cH)); normal = tlBumpN(-vViewPosition, normal, dH, faceDirection); }
  `, `
    totalEmissiveRadiance += cAlb * tlPool(vWp.xz) * vec3(1.0, 0.8, 0.55) * uNight * 0.7;
  `);
  const cv = this.curb.onBeforeCompile;
  this.curb.onBeforeCompile = (s) => {
    cv(s);
    s.vertexShader = s.vertexShader.replace('varying vec3 vWp;', 'varying vec3 vWp;\nattribute vec2 aUv2;\nvarying vec2 vUv2;').replace('#include <project_vertex>', '#include <project_vertex>\nvUv2 = aUv2;');
    s.fragmentShader = s.fragmentShader.replace('uniform sampler2D tGrime; varying vec2 vUv2;', 'uniform sampler2D tGrime; varying vec2 vUv2;');
  };

  /* ---------------- paint + covers + tree pits (decals): worn paint from the set's crosswalk bar */
  this.paint = (pull) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, side: THREE.DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aK; attribute vec2 aUv2; varying float vK; varying vec2 vUv2; varying vec3 vWp;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vK = aK; vUv2 = aUv2; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          mvPosition.xyz *= ${pull.toFixed(5)}; gl_Position = projectionMatrix * mvPosition;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vK; varying vec2 vUv2; varying vec3 vWp;\nuniform sampler2D tWear; uniform sampler2D tCovers; uniform sampler2D tGrime;\n' + SH.common + '\nvec3 pAlb; float pA; float pR;')
        .replace('#include <map_fragment>', `
          {
            float k = floor(vK + 0.5);
            vec2 p = vWp.xz;
            if (k < 3.5) {
              // paint: white / yellow; wear from the set's worn bar, scuffed by traffic; crisp anti-aliased edges
              vec3 col = k > 0.5 && k < 1.5 ? vec3(0.86, 0.62, 0.08) : vec3(0.88, 0.88, 0.85);
              float w = texture(tWear, vec2(vUv2.x / 3.05, vUv2.y)).r;
              float scuff = tlFbm(p * 1.7) * 0.6 + tlNoise(p * 9.0) * 0.4;
              float edge = min(vUv2.y, 1.0 - vUv2.y);
              float aa = smoothstep(0.0, fwidth(vUv2.y) * 1.2 + 1e-4, edge);
              pA = aa * clamp(0.35 + w * 0.9 - smoothstep(0.45, 0.85, scuff) * 0.55, 0.0, 1.0);
              pAlb = col * (0.85 + 0.15 * w); pR = 0.55;
            } else if (k < 7.5) {
              // covers atlas: 4 manhole 5 grate 6 cast-iron cover 7 steel plate
              float ci = k - 4.0; vec2 o = vec2(mod(ci, 2.0), 1.0 - floor(ci / 2.0)) * 0.5;
              vec4 t = texture(tCovers, o + clamp(vUv2, 0.01, 0.99) * 0.5);
              pAlb = t.rgb * 0.85; pA = t.a; pR = 0.45;
            } else {
              // tree pit: dark soil, leaf litter, a granite / steel edge
              vec2 e = min(vUv2, 1.0 - vUv2);
              float rim = 1.0 - smoothstep(0.04, 0.07, min(e.x * 2.2, e.y * 1.25));
              vec3 soil = vec3(0.16, 0.12, 0.09) * (0.7 + 0.6 * tlFbm(p * 6.0));
              soil = mix(soil, vec3(0.32, 0.24, 0.12), smoothstep(0.6, 0.8, tlNoise(p * 14.0)) * 0.5);
              pAlb = mix(soil, vec3(0.42, 0.41, 0.39), rim); pA = 1.0; pR = 0.95;
            }
          }
          diffuseColor.rgb = pAlb * mix(1.0, 0.7, uWet); diffuseColor.a = pA;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(pR, 0.15, uWet);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += pAlb * tlPool(vWp.xz) * vec3(1.0, 0.8, 0.55) * uNight * 0.9;');
    };
    m.customProgramCacheKey = () => 'tlpaint' + pull;
    return m;
  };

  /* ---------------- props: the set's texture sheet, dark parts, emissive lenses at night */
  this.prop = (texture, emitCol) => {
    const m = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7, metalness: 0.15, vertexColors: true, side: THREE.DoubleSide });
    m.onBeforeCompile = (s) => {
      s.uniforms.uNight = U.uNight; s.uniforms.uWet = U.uWet;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aE; varying float vE;').replace('#include <project_vertex>', '#include <project_vertex>\nvE = aE;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vE; uniform float uNight; uniform float uWet;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.7, 0.25, uWet);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += (vE > 0.8 ? vec3(${emitCol}) * 4.0 : diffuseColor.rgb * 2.5) * vE * smoothstep(0.1, 0.6, uNight);`);
    };
    m.customProgramCacheKey = () => 'tlprop';
    return m;
  };
};

/* ------------------------------------------------------------------ world: meshes, props, physics */
TL.StreetWorld = class {
  constructor(world, D, mats) {
    this.world = world; this.D = D; this.mats = mats; this.scene = world.scene;
    const M = D.meta, A = D.arr;
    this.meshes = [];
    const y = M.curbH;
    // slab
    {
      const xz = A.slab_xz, n = xz.length / 2, P = new Float32Array(n * 3), K = new Float32Array(n);
      for (let i = 0; i < n; i++) { P[i * 3] = xz[i * 2]; P[i * 3 + 1] = y; P[i * 3 + 2] = xz[i * 2 + 1]; K[i] = A.slab_k[i]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('aK', new THREE.BufferAttribute(K, 1));
      const N = new Float32Array(n * 3); for (let i = 0; i < n; i++) N[i * 3 + 1] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.computeBoundingSphere();
      this.add(new THREE.Mesh(g, mats.slab), true);
    }
    // curb faces
    {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(A.curb_p, 3));
      g.setAttribute('aUv2', new THREE.BufferAttribute(A.curb_uv, 2));
      g.computeVertexNormals(); g.computeBoundingSphere();
      this.add(new THREE.Mesh(g, mats.curb), true);
    }
    // decals: road paint + covers on the roadbed, tree pits on the slab
    const decal = (name, yy, pull) => {
      const xz = A[name + '_xz'], n = xz.length / 2, P = new Float32Array(n * 3), K = new Float32Array(n), N = new Float32Array(n * 3);
      const UV = new Float32Array(A[name + '_uv']);
      for (let i = 0; i < n; i++) { P[i * 3] = xz[i * 2]; P[i * 3 + 1] = yy; P[i * 3 + 2] = xz[i * 2 + 1]; K[i] = A[name + '_k'][i]; N[i * 3 + 1] = 1; }
      // wind every quad triangle to face up (front side seen from above)
      for (let t = 0; t < n; t += 3) {
        const ax = P[t * 3], az = P[t * 3 + 2], bx = P[t * 3 + 3], bz = P[t * 3 + 5], cx = P[t * 3 + 6], cz = P[t * 3 + 8];
        if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0) {
          for (let k = 0; k < 3; k++) { const o = P[t * 3 + 3 + k]; P[t * 3 + 3 + k] = P[t * 3 + 6 + k]; P[t * 3 + 6 + k] = o; }
          for (let k = 0; k < 2; k++) { const o = UV[t * 2 + 2 + k]; UV[t * 2 + 2 + k] = UV[t * 2 + 4 + k]; UV[t * 2 + 4 + k] = o; }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('aUv2', new THREE.BufferAttribute(UV, 2));
      g.setAttribute('aK', new THREE.BufferAttribute(K, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats.paint(pull)); m.renderOrder = 1;
      this.add(m, true);
    };
    decal('paint', M.groundY + 0.004, 0.9994);
    decal('roaddec', M.groundY + 0.003, 0.9993);
    decal('walkdec', y + 0.004, 0.9994);
    this.buildProps();
  }
  add(m, rs) { m.receiveShadow = !!rs; m.matrixAutoUpdate = false; m.updateMatrix(); this.scene.add(m); this.meshes.push(m); return m; }
  /* one InstancedMesh per prop type (+ a reduced LOD for the big ones); colliders on poles */
  buildProps() {
    const D = this.D, M = D.meta, A = D.arr, W = this.world;
    this.types = [];
    const warm = '1.0, 0.82, 0.55';
    const matKit = this.mats.prop(this.mats.kitTex, warm), matAsset = this.mats.prop(this.mats.assetTex, warm);
    const BIG = { light_a: 560, light_b: 560, signal: 520, lantern: 300, bench: 200, rack: 160, sign: 230, hydrant: 170, meter: 150, mailbox: 180, trash_a: 160, trash_b: 160, bollard: 150 };
    let colliders = 0;
    for (const [name, T] of Object.entries(M.props)) {
      if (!T.inst.length) continue;
      const V = A['p_' + name + '_v'], UV = A['p_' + name + '_uv'], Dk = A['p_' + name + '_d'], E = A['p_' + name + '_e'];
      const ntri = V.length / 9;
      const geo = (keep) => {
        const idx = []; for (let t = 0; t < ntri; t++) if (!keep || keep[t]) idx.push(t);
        const P = new Float32Array(idx.length * 9), U2 = new Float32Array(idx.length * 6), C = new Float32Array(idx.length * 9), Ee = new Float32Array(idx.length * 3);
        idx.forEach((t, j) => {
          P.set(V.subarray(t * 9, t * 9 + 9), j * 9); U2.set(UV.subarray(t * 6, t * 6 + 6), j * 6);
          const c = Dk[t] ? 0.07 : 1; for (let k = 0; k < 9; k++) C[j * 9 + k] = c;
          Ee[j * 3] = Ee[j * 3 + 1] = Ee[j * 3 + 2] = E[t] / 255;
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U2, 2));
        g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('aE', new THREE.BufferAttribute(Ee, 1));
        g.computeVertexNormals(); g.computeBoundingSphere();
        return g;
      };
      const g0 = geo(null);
      // LOD1: the biggest triangles (+ every emissive one) — the rest is sub-pixel past ~120 m
      let g1 = null;
      if (ntri > 100) {
        const ar = new Float32Array(ntri);
        for (let t = 0; t < ntri; t++) {
          const o = t * 9, ax = V[o + 3] - V[o], ay = V[o + 4] - V[o + 1], az = V[o + 5] - V[o + 2], bx = V[o + 6] - V[o], by = V[o + 7] - V[o + 1], bz = V[o + 8] - V[o + 2];
          ar[t] = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
        }
        const thr = Array.from(ar).sort((a, b) => b - a)[Math.floor(ntri * 0.3)];
        const keep = new Uint8Array(ntri); for (let t = 0; t < ntri; t++) keep[t] = ar[t] >= thr || E[t] > 0 ? 1 : 0;
        g1 = geo(keep);
      }
      const mat = T.tex === 'streets_assets.webp' ? matAsset : matKit;
      const n = T.inst.length;
      const mk = (g) => { const m = new THREE.InstancedMesh(g, mat, n); m.count = 0; m.frustumCulled = false; m.castShadow = T.h > 1.5; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(m); return m; };
      const ty = { name, T, n, lod0: mk(g0), lod1: g1 ? mk(g1) : null, far: BIG[name] || 200, near: g1 ? 110 : 1e9, r: Math.max(T.h, 1.5) };
      ty.pos = new Float32Array(n * 3); ty.yaw = new Float32Array(n);
      T.inst.forEach((it, i) => { ty.pos[i * 3] = it[0]; ty.pos[i * 3 + 1] = it[1]; ty.pos[i * 3 + 2] = it[2]; ty.yaw[i] = it[3]; });
      this.types.push(ty);
      // thin pole colliders: webs anchor, the hero can perch; never across the walkway
      if (T.col > 0) {
        for (let i = 0; i < n; i++) {
          const h = T.h; W.world.addStatic(ty.pos[i * 3], ty.pos[i * 3 + 1] + h / 2 - 0.3, ty.pos[i * 3 + 2], T.col, h / 2 + 0.3, T.col, 0, { kind: 'pole', climb: true, anchor: true, src: 'street' });
          colliders++;
        }
      }
    }
    // glow sprites over every lamp head (additive, night only)
    const heads = [];
    for (const ty of this.types) {
      if (!ty.T.emit || ty.T.emit === 'signal' && false) continue;
      const arm = ty.name === 'lantern' ? 0 : ty.T.arm * 0.88, hy = ty.name === 'lantern' ? ty.T.h * 0.86 : ty.T.h * 0.955;
      for (let i = 0; i < ty.n; i++) {
        const yw = ty.yaw[i];
        heads.push(ty.pos[i * 3] + Math.cos(yw) * arm, ty.pos[i * 3 + 1] + hy, ty.pos[i * 3 + 2] - Math.sin(yw) * arm, ty.name === 'lantern' ? 0.7 : 1);
      }
    }
    if (heads.length) {
      const n = heads.length / 4, P = new Float32Array(n * 3), S = new Float32Array(n);
      for (let i = 0; i < n; i++) { P[i * 3] = heads[i * 4]; P[i * 3 + 1] = heads[i * 4 + 1]; P[i * 3 + 2] = heads[i * 4 + 2]; S[i] = heads[i * 4 + 3]; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aS', new THREE.BufferAttribute(S, 1));
      g.computeBoundingSphere();
      this.glowU = { uNight: this.mats.uniforms.uNight, uScale: { value: 600 }, uComicLin: TL.ComicLin };
      const m = new THREE.ShaderMaterial({
        uniforms: this.glowU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aS; uniform float uScale; uniform float uNight; varying float vA;
          void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            float d = -mv.z; gl_PointSize = clamp(uScale * aS * 1.6 / max(d, 1.0), 2.0, 140.0);
            vA = smoothstep(0.15, 0.7, uNight) * (1.0 - smoothstep(500.0, 900.0, d)) * aS; }`,
        fragmentShader: `varying float vA; uniform float uComicLin; void main() { vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
          float a = exp(-r * r * 5.0) * 0.55 + exp(-r * r * 40.0) * 0.6; if (a * vA < 0.003) discard;
          vec3 gc = vec3(1.0, 0.8, 0.55) * a * vA; gl_FragColor = vec4(uComicLin > 0.5 ? pow(gc, vec3(2.2)) : gc, 1.0); }`,
      });
      this.glow = new THREE.Points(g, m); this.glow.frustumCulled = false; this.glow.renderOrder = 3;
      this.scene.add(this.glow);
    }
    this.stats = { colliders, types: this.types.length, inst: this.types.reduce((a, t) => a + t.n, 0) };
  }
  /* per frame: distance + frustum pass per prop type, LOD split */
  update(cam) {
    const fr = this._fr || (this._fr = new THREE.Frustum()), pm = this._pm || (this._pm = new THREE.Matrix4());
    pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
    const sph = this._s || (this._s = new THREE.Sphere()), m4 = this._m || (this._m = new THREE.Matrix4()), q = this._q || (this._q = new THREE.Quaternion()), up = this._up || (this._up = new THREE.Vector3(0, 1, 0)), v = this._v || (this._v = new THREE.Vector3()), one = this._one || (this._one = new THREE.Vector3(1, 1, 1));
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    let vis = 0, tris = 0;
    for (const ty of this.types) {
      let a = 0, b = 0; const f2 = ty.far * ty.far, n2 = ty.near * ty.near, P = ty.pos;
      for (let i = 0; i < ty.n; i++) {
        const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > f2) continue;
        sph.center.set(P[i * 3], P[i * 3 + 1] + ty.r * 0.5, P[i * 3 + 2]); sph.radius = ty.r;
        if (!fr.intersectsSphere(sph)) continue;
        q.setFromAxisAngle(up, ty.yaw[i]); v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); m4.compose(v, q, one);
        if (ty.lod1 && d2 > n2) ty.lod1.setMatrixAt(b++, m4); else ty.lod0.setMatrixAt(a++, m4);
      }
      ty.lod0.count = a; ty.lod0.instanceMatrix.needsUpdate = a > 0;
      if (ty.lod1) { ty.lod1.count = b; ty.lod1.instanceMatrix.needsUpdate = b > 0; }
      vis += a + b; tris += a * ty.T.tris + b * (ty.lod1 ? ty.lod1.geometry.attributes.position.count / 3 : 0);
    }
    this.stats.visible = vis; this.stats.tris = Math.round(tris);
  }
};

/* ------------------------------------------------------------------ scan-world hooks */
if (TL.ScanHooks) {
  TL.ScanHooks.load.push(async (data, step) => {
    try { data.streets = await TL.Streets.load(step); } catch (e) { TL.logError ? TL.logError(e, 'streets') : console.error(e); data.streets = null; }
  });
  // the flat land plane becomes the roadbed
  TL.ScanHooks.groundMaterial = (world, geometry, def) => {
    const D = world.data.streets; if (!D) return def;
    try {
      world.streetMats = new TL.StreetMaterials(world, D);
      const N = geometry.attributes.normal; if (!N) geometry.computeVertexNormals();
      return world.streetMats.ground;
    } catch (e) { TL.logError ? TL.logError(e, 'streets') : console.error(e); return def; }
  };
  TL.ScanHooks.build.push((world) => {
    const D = world.data.streets; if (!D || !world.streetMats) return;
    try {
      world.streets = new TL.StreetWorld(world, D, world.streetMats);
      // physics: +15 cm on sidewalks / plazas / parks
      // (world.world.groundFn calls layout.ground, so patching the layout covers the hero, AI, camera and traffic)
      const H = D.meta.curbH, S = TL.Streets;
      const lg = world.layout.ground.bind(world.layout);
      world.layout.ground = (x, z) => { const g = lg(x, z); return g > -1 && S.raised(x, z) ? g + H : g; };
      // pedestrians on the sidewalk loops stand on the slab
      if (world.nav && world.nav.loopPos) {
        const lp = world.nav.loopPos.bind(world.nav);
        world.nav.loopPos = (i, t, out) => { lp(i, t, out); out.y = S.raised(out.x, out.z) ? H : 0; return out; };
      }
      // traffic stays on the roadbed: lanes are pulled in until every sample along them is off the raised slabs, and streets that
      // are mostly sidewalk / plaza / park (the scan skeleton also runs through them) are never driven
      if (world.nav && world.nav.seg) {
        const nav = world.nav, segFn = nav.seg.bind(nav), cache = new Map();
        const onRoad = (s, off, t) => !S.raised(s.ax + s.dx * s.len * t - s.dz * off, s.az + s.dz * s.len * t + s.dx * off);
        nav.seg = (a, b) => {
          const k = a * 100003 + b; let r = cache.get(k);
          if (r) return r;
          r = segFn(a, b);
          const T = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92];
          let ok = 0; for (const t of T) if (onRoad(r, 0, t)) ok++;
          r.bad = ok < 5;
          r.lanes = r.lanes.map((off) => {
            for (let f = 1; f >= 0.3; f -= 0.1) { if (T.every((t) => onRoad(r, off * f + 0.95, t))) return off * f; }
            return Math.min(off, 0.5);
          });
          cache.set(k, r); return r;
        };
        const rs = nav.randomSeg.bind(nav), ns = nav.nextSeg.bind(nav);
        nav.randomSeg = (focus, rad, rng) => { for (let i = 0; i < 12; i++) { const r = rs(focus, rad, rng); if (r && !r.bad) return r; } return null; };
        nav.nextSeg = (sg, st) => { for (let i = 0; i < 10; i++) { const r = ns(sg, st); if (r && !r.bad) return r; } const back = nav.seg(sg.b, sg.a); return back.bad ? ns(sg, st) : back; };   // only sidewalk ahead: U-turn
      }
      world.stats.streets = world.streets.stats;
    } catch (e) { TL.logError ? TL.logError(e, 'streets') : console.error(e); }
  });
  TL.ScanHooks.update.push((world, focus, vel, dt) => {
    const S = world.streets; if (!S) return;
    const g = world.game, e = g.env, U = world.streetMats.uniforms;
    if (e) { U.uNight.value = e.night || 0; U.uWet.value = e.wet || 0; }
    if (e && e.skyU) { U.uSkyHw.value.copy(e.skyU.uHor.value); U.uSkyZw.value.copy(e.skyU.uZen.value); }
    U.uTime.value += dt;
    if (S.glowU) S.glowU.uScale.value = (g.renderer.domElement.height || 720) * 0.9;
    S.update(g.camera);
  });
}
