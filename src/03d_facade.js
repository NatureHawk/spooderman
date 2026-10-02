/* =====================================================================================
   NYC FACADE LOOK — crisp window grid + glass reflections over the baked photo atlas (seed MAN).
   tools/scan/facade_detail.py measured, per wall of every NYC building, the window layout its photo shows (floor and
   bay lines, window size, which cells really hold a window, each window's glass colour; punched / ribbon / curtain wall)
   and separated the wall surface from the baked window detail. Here windows are drawn analytically from the world position:
   straight, anti-aliased edges at any distance, recessed reveals, dark glass with sky reflection + fresnel, and lights
   at night in the real window cells. Rebuilt walls retain source colour and broad weathering, without a second photo
   window pattern beneath the glass. Walls without a detected pattern keep the photo untouched.
   Data: #tl-extra facade_meta.json + facade_data.bin.gz (uint32 per-triangle record | f32 RGBA records | u8 RGBA cells).
   Record (RGBA32F texels): 0 tan.xz, s origin, type | 1 nCols, nRows, colBase, rowBase | 2 cellBase, Pu, Pv, - |
   3 first col edge, first row edge, presence fraction, glass coverage | 4 frame rgb, glass luma |
   cols: (edge0, edge1, win0, win1) along s | rows: same along y. Cells (RGBA8): glass sRGB colour, a = window present.
   ===================================================================================== */
'use strict';

TL.Facade = {
  ok: false,
  /* same fingerprint as facade_detail.py stamp(): refuse data made for another nyc.bin */
  stamp(nyc, bin) {
    const w = new Uint32Array(bin, 0, bin.byteLength >> 2);
    let h = 2166136261;
    for (let i = 0; i < w.length; i += 61) h = Math.imul((h ^ w[i]) >>> 0, 16777619) >>> 0;
    let ntri = 0; for (const b of nyc.buildings) ntri += b.n;
    return { nb: nyc.buildings.length, ntri, hash: h };
  },
  async load(data) {
    this.ok = false;
    if (!data.nyc || !TL.Extra.has('facade_meta.json') || !TL.Extra.has('facade_data.bin.gz')) return;
    const meta = await TL.Extra.json('facade_meta.json');
    const st = this.stamp(data.nyc, data.nycBin);
    if (!meta || meta.stamp.nb !== st.nb || meta.stamp.ntri !== st.ntri || meta.stamp.hash !== st.hash) {
      console.warn('[facade] facade data does not match nyc.bin — re-run tools/scan/facade_detail.py; showing the plain photo');
      return;
    }
    const buf = await TL.Extra.buffer('facade_data.bin.gz');
    const o1 = meta.ntri * 4, o2 = o1 + meta.nrec * 16;
    this.triRec = new Uint32Array(buf, 0, meta.ntri);
    const TW = meta.texW, th = Math.max(1, Math.ceil(meta.nrec / TW));
    const rec = new Float32Array(TW * th * 4); rec.set(new Float32Array(buf, o1, meta.nrec * 4));
    this.recTex = new THREE.DataTexture(rec, TW, th, THREE.RGBAFormat, THREE.FloatType);
    const CW = meta.cellW, ch = Math.max(1, Math.ceil(meta.ncell / CW));
    const cel = new Uint8Array(CW * ch * 4); cel.set(new Uint8Array(buf, o2, meta.ncell * 4));
    this.cellTex = new THREE.DataTexture(cel, CW, ch, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [this.recTex, this.cellTex]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    this.distanceTex = null;
    if (meta.wallSurface >= 2 && TL.Extra.has('facade_distance.webp')) {
      this.distanceTex = new THREE.Texture(await TL.Extra.image('facade_distance.webp'));
      this.distanceTex.encoding = THREE.sRGBEncoding;
      this.distanceTex.needsUpdate = true;
    }
    this.start = new Map(); let s = 0;
    for (const b of data.nyc.buildings) { this.start.set(b, s); s += b.n; }
    this.meta = meta; this.ok = true;
  },
  /* per-vertex record index (+1; 0 = plain photo) for one NYC tile */
  tile(world, g, list) {
    if (!this.ok) return;
    const a = new Float32Array(g.attributes.position.count); let v = 0;
    for (const b of list) {
      const s = this.start.get(b);
      for (let k = 0; k < b.n; k++, v += 3) { const r = s === undefined ? 0 : this.triRec[s + k]; a[v] = a[v + 1] = a[v + 2] = r; }
    }
    g.setAttribute('aFacRec', new THREE.BufferAttribute(a, 1));
  },
  material(world, atlas) {
    const base = { map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.72, color: 0x2a2a2a, side: THREE.DoubleSide };
    if (!this.ok) return new THREE.MeshLambertMaterial(base);
    const m = new THREE.MeshStandardMaterial(Object.assign(base, { roughness: 0.9, metalness: 0 }));
    const U = world.mats.uniforms, F = this;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uNight: U.uNight, uWet: U.uWet, uSkyH: U.uSkyH, uSkyZ: U.uSkyZ, uInvExp: TL.invExpU, uFacRec: { value: F.recTex }, uFacCell: { value: F.cellTex } });
      const BQ = TL.Buildings && TL.Buildings.ok ? TL.Buildings : null;      // building materials + rooms (03l_buildings.js)
      if (BQ) Object.assign(sh.uniforms, { uBqAlb: BQ.uAlb, uBqNor: BQ.uNor, uBqRec: BQ.uRec });
      sh.uniforms.uSunW = (world.game.env && world.game.env.skyU.uSunDir) || { value: new THREE.Vector3(0, 1, 0) };   // world sun direction
      sh.uniforms.uFacDistance = { value: F.distanceTex || atlas };
      sh.uniforms.uFacDistanceReady = { value: F.distanceTex ? 1 : 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFacRec;\nflat varying float vFacRec;\nvarying vec3 vFWP;\n#ifdef TL_BQ\nattribute float aBld;\nflat varying float vBld;\nflat varying vec3 vBqN;\nattribute vec3 aWallCol;\nflat varying vec3 vWallCol;\nattribute vec4 aWallSpan;\nflat varying vec4 vWallSpan;\n#endif')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacRec = aFacRec;\nvFWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef TL_BQ\nvBld = aBld;\nvBqN = normalize(mat3(modelMatrix) * objectNormal);\nvWallCol = aWallCol;\nvWallSpan = aWallSpan;\n#endif');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n#define TEXW ' + F.meta.texW + '\n#define CELLW ' + F.meta.cellW + '\n' + F.GLSL_COMMON + (BQ ? BQ.GLSL_COMMON : '\nconst float bqOn = 0.0;\n'))
        .replace('#include <map_fragment>', F.GLSL_MAP)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.9, 0.55, uWet), facRough, facGlass);')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= mix(facWall, facGlassEmit, facGlass);\ntotalEmissiveRadiance += facLamp;')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor = mix(material.specularColor, facF0, facGlass);')
        // no image-based light: walls carry the photo's own light (as the plain Lambert look did); the glass gets its
        // sky reflection analytically in GLSL_MAP (fresnel on the facade plane) -> cheaper, and never a black hole
        .replace('#include <lights_fragment_maps>', '');
    };
    m.customProgramCacheKey = () => 'tl-nyc-facade-6-bq' + ((m.defines && m.defines.TL_BQ) || 0);
    m.userData.bq = !!(TL.Buildings && TL.Buildings.ok);
    return m;
  },
};

/* fragment: helpers + record access */
TL.Facade.GLSL_COMMON = `
flat varying float vFacRec; varying vec3 vFWP;
uniform highp sampler2D uFacRec; uniform sampler2D uFacCell; uniform float uNight, uWet, uInvExp; uniform vec3 uSkyH, uSkyZ; uniform vec3 uSunW;
uniform sampler2D uFacDistance; uniform float uFacDistanceReady;
vec4 facRecAt(int i) { return texelFetch(uFacRec, ivec2(i % TEXW, i / TEXW), 0); }
float facHash(int n) { uint x = uint(n) * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; x = (x >> 22u) ^ x; return float(x) / 4294967295.0; }
vec3 facLin(vec3 c) { return mix(c * 0.0773993808, pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)), step(0.04045, c)); }
/* coverage of the box [a,b] by a pixel footprint of width w centred on x (analytic anti-aliasing) */
float facBox(float x, float a, float b, float w) { return clamp((min(x + w * 0.5, b) - max(x - w * 0.5, a)) / w, 0.0, 1.0); }
// A periodic joint integrated over the pixel footprint; fades before subpixel moire.
float facJoint(float x, float period, float width, float footprint) {
  float d = abs(mod(x + period * 0.5, period) - period * 0.5);
  return facBox(d, -width * 0.5, width * 0.5, max(footprint, 1e-4))
    * (1.0 - smoothstep(period * 0.18, period * 0.48, footprint));
}
float facGlass; float facRough; vec3 facF0; vec3 facWall; vec3 facGlassEmit; vec3 facLamp;
`;

/* replaces <map_fragment>: wall (photo) vs window (analytic) for this fragment */
TL.Facade.GLSL_MAP = `
  vec4 facAtl = texture2D(map, vUv);
  facWall = facAtl.rgb; facGlass = 0.0; facRough = 0.08; facF0 = vec3(0.05); facGlassEmit = vec3(0.0); facLamp = vec3(0.0);
#ifdef TL_BQ
  bqInit(facAtl.rgb, texture2D(map, vUv, 3.0).rgb);                 // + the photo lightly blurred (~3 m): the wall colour
  facWall = bqWall;
#endif
  int facBase = int(vFacRec + 0.5) - 1;
#ifdef TL_BQ
  if (bqCurtain > 0.5) facBase = -1;                                 // glass towers: a curtain wall instead (bqCurtainShade)
#endif
  if (facBase >= 0) {
    // Near walls have only the rebuilt windows. Restore original architectural
    // shading gradually in the distant skyline, where its photo detail reads well.
    float photoDistance = smoothstep(110.0, 220.0, distance(cameraPosition, vFWP)) * uFacDistanceReady * (1.0 - bqOn);
    vec3 photoSurface = texture2D(uFacDistance, vUv).rgb;
    vec4 h0 = facRecAt(facBase), h1 = facRecAt(facBase + 1), h2 = facRecAt(facBase + 2), h3 = facRecAt(facBase + 3);
    int typ = int(h0.w + 0.5);
    vec2 T2 = h0.xy;
    float s = dot(vFWP.xz, T2) - h0.z, y = vFWP.y;
    float fs = max(fwidth(s), 1e-4), fy = max(fwidth(y), 1e-4);
    int nC = int(h1.x + 0.5), nR = int(h1.y + 0.5), cB = int(h1.z + 0.5), rB = int(h1.w + 0.5);
    float Pu = h2.y, Pv = h2.z;
    // column / row containing the fragment (near-regular lines: guess from the mean spacing, then walk)
    int ci = clamp(int(floor((s - h3.x) / Pu)), 0, nC - 1);
    vec4 C = facRecAt(cB + ci);
    for (int k = 0; k < 6; k++) {
      if (s < C.x && ci > 0) { ci--; C = facRecAt(cB + ci); }
      else if (s >= C.y && ci < nC - 1) { ci++; C = facRecAt(cB + ci); }
      else break;
    }
    int ri = clamp(int(floor((y - h3.y) / Pv)), 0, nR - 1);
    vec4 R = facRecAt(rB + ri);
    for (int k = 0; k < 6; k++) {
      if (y < R.x && ri > 0) { ri--; R = facRecAt(rB + ri); }
      else if (y >= R.y && ri < nR - 1) { ri++; R = facRecAt(rB + ri); }
      else break;
    }
    bool inGrid = s >= C.x && s < C.y && y >= R.x && y < R.y;
    int cell = int(h2.x + 0.5) + ri * nC + ci;
    float pres = 0.0; vec3 gc = vec3(0.05);
    if (inGrid) { vec4 cc = texelFetch(uFacCell, ivec2(cell % CELLW, cell / CELLW), 0); pres = step(0.5, cc.a); gc = facLin(cc.rgb); }
    float gridIn = facBox(s, C.x, C.y, fs) * facBox(y, R.x, R.y, fy);
    float cellFar = smoothstep(0.3, 1.0, max(fs / max(C.w - C.z, 0.3), fy / max(R.w - R.z, 0.3)));   // window under ~2 px
    float gridFar = smoothstep(0.35, 1.0, max(fs / Pu, fy / Pv));                                    // whole cells under ~2 px
    // opening in the wall, and the recessed glass seen through it (parallax: reveals show at grazing angles)
    float W = facBox(s, C.z, C.w, fs) * facBox(y, R.z, R.w, fy) * pres;
    vec3 N3 = vec3(T2.y, 0.0, -T2.x);
    if (dot(N3, cameraPosition - vFWP) < 0.0) N3 = -N3;                // outward = the camera's side
    vec3 Vw = normalize(vFWP - cameraPosition);
    float depth = typ == 1 ? 0.22 : typ == 2 ? 0.07 : 0.03;
    float vn = max(dot(Vw, -N3), 0.08);
    float gs = s + dot(Vw, vec3(T2.x, 0.0, T2.y)) / vn * depth, gy = y + Vw.y / vn * depth;
    float og = facBox(gs, C.z, C.w, fs) * facBox(gy, R.z, R.w, fy);
    float revShade = gy > R.w ? 0.42 : gy < R.z ? 1.0 : 0.68;           // soffit dark, sill sky-lit, jambs between
    // frame + pane divisions (meeting rail on tall sashes, mullions on wide openings / at ribbon + curtain bays)
    float ww = C.w - C.z, wh = R.w - R.z, fr = typ == 1 ? 0.06 : 0.035;
    float inner = facBox(gs, C.z + fr, C.w - fr, fs) * facBox(gy, R.z + fr, R.w - fr, fy);
    float bars = 0.0;
    if (typ == 1) {
      if (wh > ww * 1.15) bars = facBox(gy, R.z + wh * 0.52 - 0.03, R.z + wh * 0.52 + 0.03, fy);
      if (ww > 1.7) { float n = floor(ww / 1.1); for (int k = 1; k < 6; k++) { if (float(k) >= n) break; float x = C.z + ww * float(k) / n; bars = max(bars, facBox(gs, x - 0.03, x + 0.03, fs)); } }
    } else if (typ == 3) bars = facBox(gy, R.z + wh * 0.78 - 0.025, R.z + wh * 0.78 + 0.025, fy);
    float gNear = W * og * inner * (1.0 - bars);
    float fNear = W * og - gNear;
    float rNear = W * (1.0 - og);
    // distance: resolved -> this cell's coverage -> the facade's average (no moire, no popping)
    float cov = clamp(h3.w, 0.0, 1.0);
    float gM = mix(mix(gNear, pres * cov * 0.85, cellFar), h3.z * cov * 0.85 * gridIn, gridFar);
    float fM = mix(mix(fNear, pres * cov * 0.15, cellFar), h3.z * cov * 0.15 * gridIn, gridFar);
    float rM = rNear * (1.0 - cellFar);
    vec3 wallSurface = facAtl.rgb;
#ifdef TL_BQ
    wallSurface = bqWall;
#endif
    // Material detail belongs to the wall, never to a second window texture.
    // Source palette selects brick vs stone; floor/bay accents follow THIS facade's measured grid.
    if (typ == 1 && bqOn < 0.5) {                                      // photo walls only: the building materials carry their own courses
      vec3 sourceTone = facRecAt(facBase + 4).rgb;
      float brick = smoothstep(0.055, 0.15, sourceTone.r - sourceTone.b)
        * (1.0 - smoothstep(0.6, 0.8, sourceTone.g));
      float course = mix(0.65, 0.085, brick), block = mix(1.35, 0.26, brick);
      float row = floor(y / course);
      float jointY = facJoint(y, course, mix(0.012, 0.008, brick), fy);
      float jointX = facJoint(s + mod(row, 2.0) * block * 0.5, block, mix(0.012, 0.008, brick), fs);
      float joints = max(jointY, jointX);
      float blockTone = facHash(int(floor((s + mod(row, 2.0) * block * 0.5) / block)) + int(row) * 131);
      float surfaceFade = (1.0 - smoothstep(course * 0.2, course * 0.65, max(fs, fy))) * (1.0 - photoDistance);
      wallSurface *= 1.0 + (blockTone - 0.5) * mix(0.07, 0.16, brick) * surfaceFade;
      wallSurface *= 1.0 - joints * mix(0.12, 0.2, brick);
    }
    if (typ == 1) {
      // Subtle vertical piers and spandrels give the measured bays depth at medium range.
      float pier = max(facBox(s, C.x, C.x + 0.15, fs), facBox(s, C.y - 0.15, C.y, fs));
      float floorSeam = facBox(y, R.x - 0.025, R.x + 0.025, fy);
      wallSurface *= 1.0 + (pier * 0.07 - floorSeam * 0.12) * gridIn * (1.0 - gridFar);
      float sillSpan = facBox(s, C.z - 0.09, C.w + 0.09, fs) * pres;
      float sill = sillSpan * facBox(y, R.z - 0.10, R.z, fy);
      float underSill = sillSpan * facBox(y, R.z - 0.18, R.z - 0.10, fy);
      float lintel = sillSpan * facBox(y, R.w, R.w + 0.07, fy);
      wallSurface *= 1.0 + (sill * 0.20 + lintel * 0.08 - underSill * 0.22) * (1.0 - cellFar);
    }
    vec3 frameCol = mix(wallSurface, vec3(0.035, 0.036, 0.04), 0.6);
    if (typ == 3) {                                                    // curtain wall: spandrels + mullions are metal/glass panels
      vec3 sp = facLin(facRecAt(facBase + 4).rgb);
      frameCol = mix(sp, vec3(0.03), 0.3);
      fM = max(fM, gridIn * pres * (1.0 - gM) * (1.0 - cellFar) + gridIn * h3.z * (1.0 - cov) * cellFar);
    }
    facWall = mix(wallSurface, wallSurface * revShade, rM);
    facWall = mix(facWall, frameCol, clamp(fM, 0.0, 1.0));
    facGlass = clamp(gM, 0.0, 1.0);
    // glass: the photo's own window tone, pushed dark (a daylit room behind a pane reads near-black)
    float gl = dot(gc, vec3(0.2126, 0.7152, 0.0722));
    vec3 glassCol = mix(vec3(gl), gc, 0.7) * (typ == 3 ? 0.6 : 0.42);
    glassCol = mix(glassCol, facAtl.rgb * 0.3, gridFar);
    if (typ == 1) glassCol *= 0.7 + 0.3 * smoothstep(0.0, 0.3, R.w - gy);   // lintel shadow inside the recess
    vec3 roomLit = vec3(1.0);
#if defined(TL_BQ) && TL_BQ >= 2
    if (bqOn > 0.5 && cellFar < 0.999 && gM > 0.001) {                                 // a furnished room behind the pane (parallax)
      vec3 rv = vec3(dot(Vw, vec3(T2.x, 0.0, T2.y)), Vw.y, max(dot(Vw, -N3), 0.05));
      vec3 room = bqRoom(vec2(gs, gy), rv, C, R, cell, typ, roomLit);
      glassCol = mix(room, glassCol, cellFar);
      roomLit = mix(roomLit, vec3(1.0), cellFar);
    }
#endif
    // reflectivity: plain window glass ~5 %, curtain-wall coated glass higher and tinted by its real colour
    vec3 tint = gc / max(gl, 1e-3);
    facF0 = typ == 3 ? clamp(mix(vec3(0.16), tint * 0.18, 0.5), 0.08, 0.35) : vec3(typ == 2 ? 0.12 : 0.1);
    facRough = mix(typ == 3 ? 0.04 : 0.06, 0.3, gridFar);
    // lights at night: a stable subset of the real window cells
    float night = smoothstep(0.05, 0.6, uNight);
    float lit = step(facHash(cell), (typ == 3 ? 0.55 : 0.45) * night) * pres;
    float warm = facHash(cell * 7 + 3);
    vec3 lamp = (warm < 0.72 ? vec3(1.0, 0.72, 0.42) : vec3(0.82, 0.9, 1.0)) * (0.35 + 0.65 * facHash(cell * 13 + 5));
    float litM = mix(lit, 0.5 * night * h3.z, gridFar);
    facGlassEmit = glassCol * (1.0 - litM);
    facLamp = lamp * roomLit * litM * facGlass * 0.9 * uInvExp;
    // sky / street reflection with fresnel: glass looking up mirrors the sky, looking down the darker street canyon
    vec3 Rr = reflect(Vw, N3);
    float cosT = clamp(dot(-Vw, N3), 0.0, 1.0);
    float fres = facF0.g + (1.0 - facF0.g) * pow(1.0 - cosT, 5.0);
    vec3 sky = Rr.y > 0.0 ? mix(uSkyH, uSkyZ, pow(clamp(Rr.y, 0.0, 1.0), 0.6)) : mix(uSkyH * 0.5, uSkyH * 0.12, clamp(-Rr.y * 2.5, 0.0, 1.0));
    vec3 tintR = typ == 3 ? mix(vec3(1.0), clamp(tint, 0.5, 1.6), 0.5) : vec3(1.0);
    facLamp += sky * tintR * fres * facGlass * (1.0 - 0.6 * litM) * 0.9;
    // ---- street level: storefronts / entrances / loading doors under this wall's first measured floor (graphics pass).
    // Bays follow the wall's own measured columns (shopfront mullions line up with the windows above); the style is
    // picked per wall from its record; solid parts take their brightness from the photo's own wall tone.
    vec4 R0 = facRecAt(rB);
    float sfTop = min(R0.x, 4.6);
    if (sfTop > 3.1 && y < sfTop + 0.25 && photoDistance < 0.999) {
      float wl = dot(wallSurface, vec3(0.2126, 0.7152, 0.0722));
      float tone = clamp(wl / 0.18, 0.35, 1.6);                           // shaded wall -> darker shopfront, sunlit -> lighter
      float hw = facHash(facBase * 7 + 11), hc = facHash(facBase * 13 + ci * 29 + 5);
      int sty = typ == 3 ? 2 : (typ == 1 && hw < 0.22 ? 3 : (hw < 0.62 ? 0 : 1));   // 0 shop, 1 stone base + doors, 2 lobby glass, 3 loading
      // muted sign-band palette (dark green, oxblood, black, navy, bronze): stays calm under the comic filters' saturation boost
      vec3 fasc = hw < 0.2 ? vec3(0.022, 0.04, 0.03) : hw < 0.4 ? vec3(0.05, 0.02, 0.018) : hw < 0.6 ? vec3(0.014, 0.014, 0.016)
                : hw < 0.8 ? vec3(0.017, 0.02, 0.032) : vec3(0.06, 0.045, 0.03);
      vec3 stone = mix(wallSurface, vec3(dot(wallSurface, vec3(0.3333))), 0.5) * 0.82;
      bool inBay = s >= C.x && s < C.y;
      float bw = C.y - C.x, b0 = C.x + 0.22, b1 = C.y - 0.22;
      float zone = 1.0 - facBox(y, sfTop, sfTop + 0.25, fy);             // band fades into the wall above
      float kick = 0.45, fTop = sfTop - 0.12, fBot = sfTop - (sty == 2 ? 0.35 : 0.85);
      vec3 sfCol = stone; float sfGlass = 0.0; vec3 sfRoom = vec3(0.0), sfLamp = vec3(0.0); float sfLit = 0.0;
      float trim = facBox(y, fTop, sfTop, fy);
      float fascia = facBox(y, fBot, fTop, fy) * (inBay && sty != 1 ? 1.0 : 0.0);
      if (sty == 1) {                                                      // stone base: rusticated courses + plinth, no sign band
        float joint = facJoint(y, 0.6, 0.03, fy) * facBox(y, 0.5, fTop - 0.1, fy);
        sfCol = stone * (1.0 - joint * 0.35);
        sfCol = mix(sfCol, stone * 0.7, facBox(y, 0.0, 0.5, fy));
      }
      bool door = sty != 2 && (hc < (sty == 1 ? 0.3 : 0.2) || ci == nC / 2);
      if (inBay && bw > 1.6) {
        if (sty == 3 && hc < 0.55) {
          // roll-up loading door: ribbed shutter
          float sh = facBox(s, b0, b1, fs) * facBox(y, 0.02, min(3.4, fBot - 0.15), fy);
          float rib = facJoint(y, 0.085, 0.022, fy);
          vec3 metal = (hc < 0.3 ? vec3(0.09, 0.095, 0.1) : vec3(0.045, 0.07, 0.055)) * tone;
          sfCol = mix(sfCol, metal * (1.0 - rib * 0.45), sh);
        } else {
          // shopfront glazing between the piers (stone base: only the entrance); recessed door on some bays (parallax)
          float dW = min(1.9, bw * 0.45), dc = (C.x + C.y) * 0.5, d0 = dc - dW * 0.5, d1 = dc + dW * 0.5;
          float vn2 = max(dot(Vw, -N3), 0.08), rec = door ? 0.9 : 0.18;
          float ps = s + dot(Vw, vec3(T2.x, 0.0, T2.y)) / vn2 * rec, py = y + Vw.y / vn2 * rec;
          float gTop = fBot - 0.12, gBot = sty == 1 ? 1.1 : kick;
          float dOpen = door ? facBox(s, d0, d1, fs) * facBox(y, 0.02, gTop, fy) : 0.0;
          float open = sty == 1 ? dOpen : max(facBox(s, b0, b1, fs) * facBox(y, gBot, gTop, fy), dOpen);
          float seen = door ? facBox(ps, d0, d1, fs) * facBox(py, 0.02, gTop, fy) : facBox(ps, b0, b1, fs) * facBox(py, gBot, gTop, fy);
          float n = max(1.0, floor((b1 - b0) / 1.3)), mull = 0.0, mw = sty == 2 ? 0.02 : 0.035;
          for (int k = 1; k < 6; k++) { if (float(k) >= n) break; float x = b0 + (b1 - b0) * float(k) / n; if (!(door && x > d0 - 0.1 && x < d1 + 0.1)) mull = max(mull, facBox(ps, x - mw, x + mw, fs)); }
          float trans = facBox(py, 2.45, 2.52, fy) * step(2.9, gTop);
          float stile = door ? max(max(facBox(ps, d0, d0 + 0.07, fs), facBox(ps, d1 - 0.07, d1, fs)), facBox(ps, dc - 0.035, dc + 0.035, fs)) : 0.0;
          float frame = max(max(mull, trans), stile) * seen;
          vec3 frameC = (hw < 0.5 ? vec3(0.012, 0.012, 0.013) : vec3(0.05, 0.034, 0.02)) * tone;
          sfGlass = open * seen * (1.0 - frame);
          sfCol = mix(sfCol, frameC, open * frame);
          sfCol = mix(sfCol, stone * 0.55, open * (1.0 - seen));        // reveal: side walls of the recess
          // interior seen through the glass (parallax, 3.5 m deep): shelved back wall with stock, floor, ceiling light strips
          float din = rec + 3.5;
          float is = s + dot(Vw, vec3(T2.x, 0.0, T2.y)) / vn2 * din, iy = y + Vw.y / vn2 * din, ceilY = gTop + 0.3;
          float shelf = 1.0 - facJoint(iy, 0.42, 0.05, fy * 2.0) * step(iy, 2.0) * 0.6;
          int shRow = int(floor(iy / 0.42)); float bwid = 0.22 + 0.25 * facHash(shRow * 17 + facBase);
          float stock = 0.68 + 0.42 * facHash(int(floor(is / bwid + facHash(shRow + facBase * 3) * 7.0)) * 37 + shRow * 11 + facBase);
          vec3 inC = mix(vec3(0.78, 0.72, 0.62), vec3(0.62, 0.64, 0.68), hc) * (iy < 2.0 ? stock * shelf : 1.0);
          inC = mix(inC, vec3(0.32, 0.28, 0.24), step(iy, 0.0));
          float ceil = step(ceilY, iy);
          inC = mix(inC, vec3(0.45), ceil);
          float strips = ceil * (1.0 - smoothstep(0.05, 0.22, abs(fract(is / 1.8) - 0.5)));
          sfLit = step(facHash(facBase * 5 + ci * 3 + 1), 0.75) * night * (door ? 0.6 : 1.0);
          sfRoom = inC * mix(0.03, 0.045, hc) * (door ? 0.6 : 1.0) + vec3(strips * 0.06);
          sfLamp = (inC * 0.5 + vec3(1.2, 1.0, 0.8) * strips) * vec3(1.0, 0.8, 0.56) * sfLit;
        }
        sfCol = mix(sfCol, stone * 0.6, facBox(y, 0.0, kick, fy) * (1.0 - sfGlass) * (sty == 0 ? 1.0 : 0.0));   // kick plate
      }
      sfCol = mix(sfCol, fasc * tone, fascia * (1.0 - sfGlass));
      sfCol = mix(sfCol, stone * 1.25, trim);
      float fresS = 0.08 + 0.92 * pow(1.0 - cosT, 5.0);
      float k = zone * (1.0 - photoDistance);
      facWall = mix(facWall, sfCol, k);
      facGlass = mix(facGlass, sfGlass, k);
      facGlassEmit = mix(facGlassEmit, sfRoom, k);
      facLamp = mix(facLamp, (sky * fresS * 0.9 + sfLamp * (1.0 - fresS) * 0.55 * uInvExp) * sfGlass, k);
    }
    // Crossfade representations together; never keep a full-strength second grid
    // over the distant photo. Night illumination still follows the measured cells.
    facWall = mix(facWall, photoSurface, photoDistance);
    facGlass *= 1.0 - photoDistance;
    facLamp *= 1.0 - photoDistance * (1.0 - night);
  }
#ifdef TL_BQ
  bqCurtainShade();
#endif
  // sun-aware walls (graphics pass): the photo carries its capture-time light only. Walls turned away from the game's sun
  // get sky fill (dark navy lifted + partly neutralised), sunlit walls a small direct-light lift; walls only, day only.
  {
    vec3 Nw = normalize(cross(dFdx(vFWP), dFdy(vFWP)));
    if (dot(Nw, cameraPosition - vFWP) < 0.0) Nw = -Nw;
    float wallF = 1.0 - smoothstep(0.55, 0.85, abs(Nw.y));
    float day = smoothstep(-0.02, 0.25, uSunW.y) * (1.0 - uNight);
    float ndl = dot(Nw, normalize(uSunW));
    float wl = dot(facWall, vec3(0.2126, 0.7152, 0.0722));
    vec3 fill = mix(facWall, vec3(wl) * vec3(0.94, 0.97, 1.03), 0.3) * (1.0 + 0.55 * (1.0 - smoothstep(0.03, 0.2, wl)));
    float away = smoothstep(0.1, -0.3, ndl) * day * wallF;
    facWall = mix(facWall, fill, away) * (1.0 + 0.1 * max(ndl, 0.0) * day * wallF);
  }
  diffuseColor.rgb *= mix(facWall, facGlassEmit * 0.4, facGlass);
`;

TL.ScanHooks.load.push((data) => TL.Facade.load(data));
TL.ScanHooks.nycTile = (world, g, list) => TL.Facade.tile(world, g, list);
TL.ScanHooks.nycMaterial = (world, atlas) => TL.Facade.material(world, atlas);
