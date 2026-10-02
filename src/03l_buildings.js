/* =====================================================================================
   BUILDING MATERIALS — real wall materials + furnished interiors behind the windows (seed MAN, quality medium+).
   tools/scan/building_styles.py gave every NYC building an architectural style from the city's PLUTO tax lots (year built,
   building class, floors): brick walk-up, loft, prewar tower, art deco, postwar office, glass tower, modern residential,
   civic. tools/scan/walltex_pack.py packed 34 CC0 wall materials (ambientCG: brick, ashlar limestone, granite, concrete)
   with their real-world scale. Here each building draws one material from its style's pool, picking among those closest
   to its own scan colour, with its own scale / offset, tinted toward the scan colour; the photo's brightness survives as
   weathering, its colour smears do not. High / ultra add parallax rooms behind the glass (walls, floor, ceiling lights,
   furniture, blinds and curtains), lit at night.
   Tiers (user rule): low = the previous look, untouched (TL_BQ undefined); medium = materials; high = + rooms + relief;
   ultra = + richer rooms (furniture, second light row).
   Data: #tl-extra bstyle.json, walltex_meta.json, walltex_albedo.webp, walltex_normal.webp
   ===================================================================================== */
'use strict';

TL.Buildings = {
  ok: false, tier: 0, TIER: { low: 0, medium: 1, high: 2, ultra: 3 },
  /* style -> [kind, weight] pool (kinds from walltex_meta: brick | ashlar | granite | concrete) */
  POOLS: [
    [['brick', 1]],                                              // 0 brick walk-up
    [['brick', 0.7], ['ashlar', 0.3]],                           // 1 loft
    [['ashlar', 0.55], ['brick', 0.45]],                         // 2 prewar tower
    [['brick', 0.6], ['ashlar', 0.4]],                           // 3 art deco
    [['concrete', 0.5], ['brick', 0.3], ['ashlar', 0.2]],        // 4 postwar office
    [['concrete', 0.6], ['ashlar', 0.25], ['granite', 0.15]],    // 5 glass tower (piers / spandrels)
    [['brick', 0.5], ['concrete', 0.5]],                         // 6 modern residential
    [['ashlar', 0.6], ['granite', 0.2], ['concrete', 0.2]],      // 7 civic
  ],
  async load(data) {
    this.ok = false;
    const E = TL.Extra;
    if (!data.nyc || !E.has('bstyle.json') || !E.has('walltex_meta.json') || !E.has('walltex_albedo.webp')) return;
    const [st, meta, alb, nor] = await Promise.all([E.json('bstyle.json'), E.json('walltex_meta.json'), E.image('walltex_albedo.webp'), E.image('walltex_normal.webp')]);
    this.meta = meta; this.imgs = [alb, nor]; this.arr = {};
    // per building (4 texels): material layer, metres per tile, seed, style | 1 / material mean rgb, material luma |
    // photo colour rgb, curtain-wall spandrel (-1 = no curtain wall) | floor height, mullion pitch, mullion finish, base y
    const B = data.nyc.buildings, rec = new Float32Array(B.length * 16), idx = new Map();
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const mats = meta.mats;
    B.forEach((b, i) => {
      idx.set(b, i);
      const s = st.b[String(b.id)], style = s ? s.s : (b.h > 80 ? 5 : b.h > 40 ? 2 : 0);
      const col = [lin(((b.c >> 16) & 255) / 255), lin(((b.c >> 8) & 255) / 255), lin((b.c & 255) / 255)];
      const L = Math.max(luma(col), 1e-3), ch = col.map((v) => v / L);
      const rng = new TL.RNG(b.id * 7919 + 17);
      // kind from the style's pool, then the best colour matches of that kind (chroma first, brightness second)
      let r = rng.next(), kind = 'brick';
      for (const [k, w] of this.POOLS[style]) { kind = k; if ((r -= w) <= 0) break; }
      const cand = mats.map((m, li) => ({ li, m })).filter((o) => o.m.kind === kind).map((o) => {
        const ml = Math.max(luma(o.m.mean), 1e-3), mc = o.m.mean.map((v) => v / ml);
        const d = Math.hypot(mc[0] - ch[0], mc[1] - ch[1], mc[2] - ch[2]) + 0.25 * Math.abs(Math.log(ml / L));
        return { li: o.li, d: d * 0.5 + rng.next() * 0.3 };   // colour match counts, but variety wins ties
      }).sort((a, c) => a.d - c.d);
      const pick = cand[Math.min(cand.length - 1, Math.floor(rng.next() * Math.min(6, cand.length)))] || { li: 0 };
      const m = mats[pick.li], ml = Math.max(luma(m.mean), 1e-3);
      // tint: brightness of the scan, 75 % of its hue (the material keeps its own character)
      const o = i * 16;
      rec[o] = pick.li; rec[o + 1] = m.scale * (0.9 + rng.next() * 0.25); rec[o + 2] = rng.next() * 97; rec[o + 3] = style;
      // the shader tints toward the (blurred) photo colour: it needs 1 / material mean and the material's luma
      for (let c = 0; c < 3; c++) rec[o + 4 + c] = 1 / Math.max(m.mean[c], 1e-3);
      rec[o + 7] = ml;
      // curtain wall (glass towers; some tall modern residential): photo colour = glass tint, floor height, mullion pitch,
      // spandrel band height (0 = floor-to-ceiling glass), mullion finish (0 dark bronze .. 1 bright aluminium)
      // postwar / modern buildings whose scan colour reads as glass (blue / green over red) are curtain walls too
      const glassy = col[2] > col[0] * 1.08 || col[1] > col[0] * 1.1;
      const curtain = style === 5 || ((style === 4 || style === 6) && glassy) || (style === 6 && b.h > 60 && rng.next() < 0.5);
      for (let c = 0; c < 3; c++) rec[o + 8 + c] = col[c];
      rec[o + 11] = curtain ? (rng.next() < 0.45 ? 0 : 0.55 + rng.next() * 0.7) : -1;
      rec[o + 12] = TL.clamp(b.fh || 3.9, 3.3, 4.6); rec[o + 13] = 1.2 + rng.next() * 0.45; rec[o + 14] = rng.next();
      { const T = new Float32Array(data.nycBin, b.o, b.n * 9); let mn = 1e9; for (let k = 1; k < T.length; k += 3) mn = Math.min(mn, T[k]); rec[o + 15] = mn; }
    });
    this.idx = idx;
    this.footprints(B, data.nycBin);
    // majority wall colour per building side (tools/scan/wall_colors.py): u8 sRGB per nyc.bin triangle, 0 = none
    this.wallCol = null;
    if (E.has('wallcol.bin.gz')) {
      const wc = new Uint8Array(await E.buffer('wallcol.bin.gz'));
      let ntri = 0; for (const b of B) ntri += b.n;
      if (wc.length === ntri * 3) {
        this.wallCol = wc; this.triStart = new Map(); let t = 0;
        for (const b of B) { this.triStart.set(b, t); t += b.n; }
      } else console.warn('[buildings] wallcol.bin does not match nyc.bin — re-run tools/scan/wall_colors.py');
    }
    const W = 2048, H = Math.ceil(B.length * 4 / W);
    const tex = new Float32Array(W * H * 4); tex.set(rec);
    this.recTex = new THREE.DataTexture(tex, W, H, THREE.RGBAFormat, THREE.FloatType);
    this.recTex.magFilter = this.recTex.minFilter = THREE.NearestFilter; this.recTex.generateMipmaps = false; this.recTex.needsUpdate = true;
    this.uAlb = { value: null }; this.uNor = { value: null }; this.uRec = { value: this.recTex };
    this.ok = true;
  },
  /* top-down map of which building stands where (2 m cells, building index + 1), from every roof triangle: used to
     leave lot-line / party walls blank (a wall with a building right in front of it never gets rule-placed windows) */
  footprints(B, bin) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const b of B) { x0 = Math.min(x0, b.x - 200); z0 = Math.min(z0, b.z - 200); x1 = Math.max(x1, b.x + 200); z1 = Math.max(z1, b.z + 200); }
    const C = 2, nx = Math.ceil((x1 - x0) / C), nz = Math.ceil((z1 - z0) / C), grid = new Uint16Array(nx * nz);
    B.forEach((b, bi) => {
      const T = new Float32Array(bin, b.o, b.n * 9);
      for (let o = 0; o < T.length; o += 9) {
        const ax = T[o + 3] - T[o], ay = T[o + 4] - T[o + 1], az = T[o + 5] - T[o + 2], bx = T[o + 6] - T[o], by = T[o + 7] - T[o + 1], bz = T[o + 8] - T[o + 2];
        const ny = az * bx - ax * bz, l = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx) || 1;
        if (Math.abs(ny / l) < 0.6) continue;
        const px = [T[o], T[o + 3], T[o + 6]], pz = [T[o + 2], T[o + 5], T[o + 8]];
        const i0 = Math.max(0, Math.floor((Math.min(...px) - x0) / C)), i1 = Math.min(nx - 1, Math.floor((Math.max(...px) - x0) / C));
        const j0 = Math.max(0, Math.floor((Math.min(...pz) - z0) / C)), j1 = Math.min(nz - 1, Math.floor((Math.max(...pz) - z0) / C));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + 0.5) * C, z = z0 + (j + 0.5) * C;
          const d1 = (x - px[1]) * (pz[0] - pz[1]) - (px[0] - px[1]) * (z - pz[1]), d2 = (x - px[2]) * (pz[1] - pz[2]) - (px[1] - px[2]) * (z - pz[2]), d3 = (x - px[0]) * (pz[2] - pz[0]) - (px[2] - px[0]) * (z - pz[0]);
          if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) grid[j * nx + i] = bi + 1;
        }
      }
    });
    this.fp = { x0, z0, C, nx, nz, grid };
  },
  /* is the open air in front of wall point (x, z) along outward normal (nx, nz)? probes 2..5 m out */
  open(x, z, nx, nz) {
    const F = this.fp;
    for (const d of [2.5, 4.5]) {
      const i = Math.floor((x + nx * d - F.x0) / F.C), j = Math.floor((z + nz * d - F.z0) / F.C);
      if (i < 0 || j < 0 || i >= F.nx || j >= F.nz) continue;
      if (F.grid[j * F.nx + i]) return false;
    }
    return true;
  },
  /* texture array of the atlas layers at `size` px (medium 256, high/ultra 512); built once per size */
  array(size) {
    if (this.arr[size]) return this.arr[size];
    const M = this.meta, G = M.grid, T = M.tile, n = M.n, out = [];
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    for (const im of this.imgs) {
      const data = new Uint8Array(size * size * 4 * n);
      for (let i = 0; i < n; i++) {
        cx.clearRect(0, 0, size, size);
        cx.drawImage(im, (i % G) * T, Math.floor(i / G) * T, T, T, 0, 0, size, size);
        data.set(cx.getImageData(0, 0, size, size).data, i * size * size * 4);
      }
      const t = new THREE.DataArrayTexture(data, size, size, n);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8;
      t.needsUpdate = true; out.push(t);
    }
    return (this.arr[size] = out);
  },
  /* per-vertex building index (+1) for one NYC tile */
  tile(g, list) {
    if (!this.ok) return;
    const a = new Float32Array(g.attributes.position.count); let v = 0;
    for (const b of list) { const i = this.idx.has(b) ? this.idx.get(b) + 1 : 0; for (let k = 0; k < b.n * 3; k++) a[v++] = i; }
    g.setAttribute('aBld', new THREE.BufferAttribute(a, 1));
    const wc = new Uint8Array(g.attributes.position.count * 3); v = 0;
    if (this.wallCol) for (const b of list) {
      const t0 = this.triStart.get(b);
      for (let k = 0; k < b.n; k++) {
        const o = (t0 + k) * 3;
        for (let j = 0; j < 3; j++, v += 3) { wc[v] = this.wallCol[o]; wc[v + 1] = this.wallCol[o + 1]; wc[v + 2] = this.wallCol[o + 2]; }
      }
    }
    g.setAttribute('aWallCol', new THREE.BufferAttribute(wc, 3, true));
    // extent of each flat wall (same plane of the same building): u range along the shader's wall tangent + y range,
    // so rule-placed windows centre their bays on the wall and stop short of corners, parapets and setbacks
    const P = g.attributes.position.array, span = new Float32Array(g.attributes.position.count * 4);
    let t = 0;
    for (const b of list) {
      const planes = new Map(), keys = new Array(b.n);
      for (let k = 0; k < b.n; k++, t++) {
        const o = t * 9;
        const ax = P[o + 3] - P[o], ay = P[o + 4] - P[o + 1], az = P[o + 5] - P[o + 2], bx = P[o + 6] - P[o], by = P[o + 7] - P[o + 1], bz = P[o + 8] - P[o + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        if (Math.abs(ny) > 0.6) continue;
        let tx = -nz, tz = nx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        if (Math.abs(tx) > Math.abs(tz) ? tx < 0 : tz < 0) { tx = -tx; tz = -tz; }
        const ang = Math.round(Math.atan2(tz, tx) * 90 / Math.PI), d = Math.round((P[o] * -tz + P[o + 2] * tx) * 2);
        const key = ang + ',' + d; keys[k] = key;
        let e = planes.get(key); if (!e) { planes.set(key, (e = [1e9, -1e9, 1e9, -1e9])); e.n = [nx, nz, tx, tz, P[o] * -tz + P[o + 2] * tx]; }
        for (let j = 0; j < 3; j++) {
          const x = P[o + j * 3], y = P[o + j * 3 + 1], z = P[o + j * 3 + 2], u = x * tx + z * tz;
          e[0] = Math.min(e[0], u); e[1] = Math.max(e[1], u); e[2] = Math.min(e[2], y); e[3] = Math.max(e[3], y);
        }
      }
      // lot-line / party walls: the outward side is mostly another building -> no rule windows (span 0)
      for (const e of planes.values()) {
        if (!this.fp) break;
        const [nx, nz, tx, tz, d] = e.n; let open = 0, tot = 0;
        for (const f of [0.2, 0.5, 0.8]) {
          const u = e[0] + (e[1] - e[0]) * f, x = tx * u - tz * d, z = tz * u + tx * d;
          // the stored normal can point inward (triangle winding): use whichever side is not this building
          const own = this.fp.grid[Math.floor((z - nz * 1.0 - this.fp.z0) / this.fp.C) * this.fp.nx + Math.floor((x - nx * 1.0 - this.fp.x0) / this.fp.C)];
          const sx = own ? 1 : -1;
          tot++; if (this.open(x, z, nx * sx, nz * sx)) open++;
        }
        if (open * 2 < tot) e[1] = e[0];
      }
      for (let k = 0; k < b.n; k++) {
        const e = keys[k] && planes.get(keys[k]); if (!e) continue;
        const o = (t - b.n + k) * 12;
        for (let j = 0; j < 3; j++) span.set(e, o + j * 4);
      }
    }
    g.setAttribute('aWallSpan', new THREE.BufferAttribute(span, 4));
  },
  /* switch the facade material to the game's quality tier */
  setTier(world) {
    const m = world && world.nycMat;
    const t = this.ok && m && m.userData.bq ? this.TIER[world.game.quality] || 0 : 0;
    this.tier = t;
    if (!m || !m.userData.bq) return;
    if (t) { const [a, n] = this.array(t === 1 ? 256 : 512); this.uAlb.value = a; this.uNor.value = n; }
    m.defines = m.defines || {};
    if (t) m.defines.TL_BQ = t; else delete m.defines.TL_BQ;
    m.needsUpdate = true;
  },
};

/* fragment helpers (only compiled with TL_BQ) — needs facLin / facHash / facBox / facJoint from TL.Facade.GLSL_COMMON */
TL.Buildings.GLSL_COMMON = `
#ifdef TL_BQ
flat varying float vBld; flat varying vec3 vBqN; flat varying vec3 vWallCol; flat varying vec4 vWallSpan;
uniform highp sampler2DArray uBqAlb, uBqNor; uniform highp sampler2D uBqRec;
float bqOn; vec3 bqWall; int bqStyle; float bqSeed;
// curtain wall of this fragment: on, glass coverage, cell rect (C: bay s0, s1, glass s0, s1 | R: floor y0, y1, glass y0, y1), tint
float bqCurtain; float bqCG; float bqFrame; float bqSill; vec4 bqC; vec4 bqR; int bqCell; vec3 bqTint; vec3 bqN; vec3 bqT; float bqMetal;
vec4 bqRecAt(int i) { return texelFetch(uBqRec, ivec2(i % 2048, i / 2048), 0); }
/* wall material for this fragment (walls only; roofs keep the photo) */
void bqInit(vec3 photo, vec3 blur) {
  bqOn = 0.0; bqWall = photo; bqStyle = 0; bqSeed = 0.0; bqCurtain = 0.0; bqCG = 0.0; bqCell = 0; bqFrame = 0.0; bqSill = 0.0;
  int bi = int(vBld + 0.5) - 1;
  if (bi < 0) return;
  // the triangle's own normal (screen derivatives are too noisy: their error times a world position of
  // hundreds of metres scrambles the texture coordinate)
  vec3 Nf = normalize(vBqN);
  if (dot(Nf, cameraPosition - vFWP) < 0.0) Nf = -Nf;
  if (abs(Nf.y) > 0.6) return;
  vec4 b0 = bqRecAt(bi * 4), b1 = bqRecAt(bi * 4 + 1), b2 = bqRecAt(bi * 4 + 2), b3 = bqRecAt(bi * 4 + 3);
  bqStyle = int(b0.w + 0.5); bqSeed = b0.z;
  vec3 T = normalize(vec3(-Nf.z, 0.0, Nf.x) + vec3(1e-5, 0.0, 0.0));
  if (abs(T.x) > abs(T.z) ? T.x < 0.0 : T.z < 0.0) T = -T;       // same direction from both sides of a wall
  float u = dot(vFWP, T);
  vec2 uv = vec2(u, vFWP.y) / b0.y + vec2(b0.z, b0.z * 0.37);
  float layer = b0.x;
  vec3 alb = facLin(texture(uBqAlb, vec3(uv, layer)).rgb);
  vec4 nr = texture(uBqNor, vec3(uv, layer), 1.5);            // biased: joints and block faces, not grain
  // colour = the scan photo's own colour (lightly blurred so sharp smears soften); the material only adds its surface
  // pattern as brightness (courses, joints, grain), never its hue. Weathering: the sharp photo's brightness vs the blur.
  // majority colour of this building side (wall_colors.py) when known: blotches are minorities and drop out; the photo
  // then only adds a gentle, tightly clamped brightness variation
  vec3 target = blur;
  float tight = 0.0;
  if (vWallCol.r + vWallCol.g + vWallCol.b > 0.01) { target = facLin(vWallCol); tight = 1.0; }
  float lb = mix(dot(blur, vec3(0.2126, 0.7152, 0.0722)), dot(target, vec3(0.2126, 0.7152, 0.0722)), tight);
  float detail = clamp(dot(alb, vec3(0.2126, 0.7152, 0.0722)) / max(b1.w, 1e-3), 0.35, 1.8);
  float pl = dot(photo, vec3(0.2126, 0.7152, 0.0722)) / max(lb, 1e-3);
  float wth = mix(clamp(pow(max(pl, 1e-3), 0.6), 0.7, 1.3), clamp(pow(max(pl, 1e-3), 0.3), 0.88, 1.12), tight);
  // soot / rain streaks: long vertical runs, heavier near the ground and under the roofline
  float col = floor(u * 1.7 + bqSeed);
  float streak = facHash(int(col) * 31 + int(bqSeed)) * smoothstep(0.0, 1.0, fract(vFWP.y * 0.031 + facHash(int(col) + 7)));
  float grime = 1.0 - 0.10 * streak - 0.08 * (1.0 - smoothstep(0.0, 5.0, vFWP.y));
  vec3 c = target * detail * wth * grime;
#if TL_BQ >= 2
  // relief: the photo carries the scene light, so the material's normal map only adds the difference it makes
  vec2 nxy = nr.xy * 2.0 - 1.0;
  vec3 Np = normalize(T * nxy.x + vec3(0.0, nxy.y, 0.0) + Nf * sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
  float day = smoothstep(-0.02, 0.25, uSunW.y) * (1.0 - uNight);
  vec3 Ls = normalize(uSunW);
  float rel = 1.0 + ((dot(Np, Ls) - dot(Nf, Ls)) * 0.45 * day + (Np.y - Nf.y) * 0.18)
            * (1.0 - smoothstep(25.0, 90.0, distance(cameraPosition, vFWP)));
  c *= clamp(rel, 0.55, 1.45);
#endif
  bqWall = c; bqOn = 1.0;
  bqN = Nf; bqT = T;
  if (b2.w >= 0.0 && vFWP.y > 0.5) {
    // curtain wall: floor bands + mullion bays in world metres, analytic anti-aliasing
    bqCurtain = 1.0;
    float fh = b3.x, mp = b3.y, sp = b2.w;
    float y = vFWP.y, fu = max(fwidth(u), 1e-4), fyy = max(fwidth(y), 1e-4);
    float fi = floor(y / fh), bi2 = floor(u / mp);
    float s0 = bi2 * mp, y0 = fi * fh;
    float mw = 0.035, tw = 0.05;
    bqC = vec4(s0, s0 + mp, s0 + mw, s0 + mp - mw);
    bqR = vec4(y0, y0 + fh, y0 + sp + tw, y0 + fh - tw);
    bqCell = int(fi) * 4099 + int(bi2) + int(bqSeed * 13.0);
    bqCG = facBox(u, bqC.z, bqC.w, fu) * facBox(y, bqR.z, bqR.w, fyy);
    // far away the mullions are sub-pixel: the average coverage instead of shimmering lines
    float far = smoothstep(0.3, 1.0, max(fu / mp, fyy / fh));
    bqCG = mix(bqCG, (1.0 - 2.0 * mw / mp) * (1.0 - (sp + 2.0 * tw) / fh), far);
    bqTint = target;
    bqMetal = b3.z;
    // mullions / spandrel panels: dark bronze .. anodised aluminium; spandrels take the photo colour
    vec3 metal = mix(vec3(0.03, 0.028, 0.026), vec3(0.32, 0.33, 0.34), bqMetal);
    vec3 span = mix(target * 0.8, metal, 0.35);
    float inSpan = facBox(y, y0, y0 + sp, fyy) * (sp > 0.0 ? 1.0 : 0.0);
    bqWall = mix(metal, span, inSpan) * wth;
  } else if (vFacRec < 0.5 && vWallSpan.y - vWallSpan.x > 1.8) {
    // no measured window pattern on this wall: windows by rule from the style (pitch, width, height, sill), bays centred
    // on the wall's own extent, floors from the building's base; the lowest floor gets shopfront-size glazing
    vec4 Pw = bqStyle == 0 ? vec4(2.3, 0.95, 1.65, 0.85) : bqStyle == 1 ? vec4(2.7, 1.45, 2.4, 0.7)
            : bqStyle == 4 ? vec4(1.6, 1.45, 1.5, 0.9) : bqStyle == 6 ? vec4(2.2, 1.6, 2.0, 0.6)
            : bqStyle == 7 ? vec4(3.0, 1.4, 2.6, 0.9) : vec4(1.9, 1.0, 1.8, 0.85);
    Pw.x *= 0.92 + 0.16 * fract(bqSeed * 0.37);
    float fh = b3.x * (bqStyle == 1 ? 1.12 : 1.0), yB = b3.w, y = vFWP.y;
    float spanW = vWallSpan.y - vWallSpan.x, n = floor((spanW - 0.8) / Pw.x);
    float s0 = vWallSpan.x + (spanW - n * Pw.x) * 0.5;
    float bi2 = floor((u - s0) / Pw.x), fi = floor((y - yB) / fh);
    if (n >= 1.0 && bi2 >= 0.0 && bi2 < n && fi >= 0.0 && y < vWallSpan.w - 0.9 && y > vWallSpan.z) {
      bool shop = fi < 0.5 && (bqStyle <= 1 || bqStyle == 6);
      float cx = s0 + (bi2 + 0.5) * Pw.x, w = shop ? Pw.x - 0.45 : Pw.y, h = shop ? fh - 1.25 : Pw.z, sill = shop ? 0.4 : Pw.w;
      float y0 = yB + fi * fh;
      bqC = vec4(cx - Pw.x * 0.5, cx + Pw.x * 0.5, cx - w * 0.5, cx + w * 0.5);
      bqR = vec4(y0, y0 + fh, y0 + sill, min(y0 + sill + h, vWallSpan.w - 0.9));
      bqCell = int(fi) * 4099 + int(bi2) + int(bqSeed * 13.0) + bi * 7;
      float fu = max(fwidth(u), 1e-4), fyy = max(fwidth(y), 1e-4);
      float present = step(0.06, facHash(bqCell * 3 + 11));
      bqCG = facBox(u, bqC.z + 0.07, bqC.w - 0.07, fu) * facBox(y, bqR.z + 0.07, bqR.w - 0.07, fyy) * present;
      bqFrame = facBox(u, bqC.z, bqC.w, fu) * facBox(y, bqR.z, bqR.w, fyy) * present - bqCG;
      bqSill = facBox(u, bqC.z - 0.08, bqC.w + 0.08, fu) * facBox(y, bqR.z - 0.12, bqR.z, fyy) * present;
      float far = smoothstep(0.3, 1.0, max(fu / Pw.x, fyy / fh));
      float cov = (w - 0.14) * (h - 0.14) / (Pw.x * fh) * 0.94;
      bqCG = mix(bqCG, cov, far); bqFrame *= 1.0 - far; bqSill *= 1.0 - far;
      bqTint = vec3(0.05, 0.055, 0.06); bqMetal = 0.0;
      bqCurtain = 2.0;
    }
  }
}
#if TL_BQ >= 2
/* a room behind the window: ray from the glass point p (s, y) along v (s, y, depth) inside the bay [C.x, C.y] x
   floor [R.x, R.y]; returns the daylit colour, lit = albedo under the room's own lamps */
vec3 bqRoom(vec2 p, vec3 v, vec4 C, vec4 R, int cell, int typ, out vec3 lit) {
  float h1 = facHash(cell * 3 + 1), h2 = facHash(cell * 5 + 2), h3 = facHash(cell * 11 + 3), h4 = facHash(cell * 17 + 9);
  bool office = bqStyle == 4 || bqStyle == 5 || (bqStyle == 2 && h4 < 0.6) || bqStyle == 7 || typ == 3;
  float D = office ? 6.0 + h2 * 6.0 : 3.2 + h2 * 2.0;
  float x0 = min(C.x, C.z - 0.6), x1 = max(C.y, C.w + 0.6);
  float y0 = R.x + 0.05, y1 = R.y - 0.3;
  p = clamp(p, vec2(x0, y0) + 0.01, vec2(x1, y1) - 0.01);            // the pane can poke past the bay: start inside the room
  vec3 iv = 1.0 / max(abs(v), vec3(1e-4)) * sign(v + 1e-6);
  float tx = ((v.x > 0.0 ? x1 : x0) - p.x) * iv.x;
  float ty = ((v.y > 0.0 ? y1 : y0) - p.y) * iv.y;
  float tz = D * iv.z;
  float t = clamp(min(min(tx, ty), tz), 0.0, 40.0);
  vec3 H = vec3(p, 0.0) + v * t;
  // palettes: residential = warm plaster / painted walls + wood floors; office = white / grey + carpet tiles
  vec3 wallC = office ? mix(vec3(0.62, 0.62, 0.6), vec3(0.5, 0.52, 0.55), h1)
                      : (h1 < 0.3 ? vec3(0.72, 0.64, 0.52) : h1 < 0.55 ? vec3(0.62, 0.66, 0.6) : h1 < 0.8 ? vec3(0.75, 0.72, 0.68) : vec3(0.55, 0.42, 0.36));
  vec3 floorC = office ? mix(vec3(0.16, 0.17, 0.19), vec3(0.24, 0.22, 0.2), h3) : mix(vec3(0.28, 0.16, 0.08), vec3(0.4, 0.27, 0.15), h3);
  vec3 alb;
  float glow = 0.0;                                   // ceiling fixtures (lit at night, faint by day)
  if (t >= tz - 1e-4) {
    alb = wallC;
    // furniture against the back wall: a low dark band (desks / sofa / shelves), a picture or a doorway
    float cxm = (x0 + x1) * 0.5;
    if (H.y < y0 + (office ? 0.75 : 0.85) && abs(H.x - cxm - (h4 - 0.5) * 1.2) < (office ? 1.6 : 1.1)) alb = office ? vec3(0.08, 0.08, 0.09) : mix(vec3(0.12, 0.08, 0.06), vec3(0.3, 0.12, 0.1), h2);
    else if (!office && abs(H.x - cxm + (h3 - 0.5)) < 0.45 && abs(H.y - y0 - 1.6) < 0.32 && h1 > 0.35) alb = mix(vec3(0.15, 0.2, 0.3), vec3(0.5, 0.3, 0.15), h4);
    else if (h4 > 0.7 && abs(H.x - x1 + 0.9) < 0.45 && H.y < y0 + 2.1) alb = wallC * 0.35;
#if TL_BQ >= 3
    if (office) alb *= 1.0 - 0.25 * facBox(H.y, y0 + 1.0, y0 + 1.25, 0.02) * step(0.4, h1);   // partition top rail
#endif
  } else if (t >= ty - 1e-4) {
    if (v.y > 0.0) {
      alb = vec3(0.78);
      float gx = office ? fract(H.x / 1.2) : abs(H.x - (x0 + x1) * 0.5) / 0.35;
      float gz = office ? fract(H.z / 2.4) : abs(H.z - D * 0.5) / 0.35;
      glow = office ? step(abs(gx - 0.5), 0.12) * step(abs(gz - 0.5), 0.3) : step(gx * gx + gz * gz, 1.0);
      alb = mix(alb, vec3(1.0), glow);
    } else {
      alb = floorC;
      if (office) alb *= 1.0 - 0.15 * max(facJoint(H.x, 0.6, 0.01, 0.01), facJoint(H.z, 0.6, 0.01, 0.01));
      else alb *= 1.0 - 0.18 * facJoint(H.x + floor(H.z / 1.2) * 0.4, 0.14, 0.008, 0.01);
#if TL_BQ >= 3
      float rugX = abs(H.x - (x0 + x1) * 0.5), rugZ = abs(H.z - D * 0.45);
      if (!office && h2 > 0.4 && rugX < 1.0 && rugZ < 0.8) alb = mix(vec3(0.35, 0.12, 0.1), vec3(0.2, 0.25, 0.35), h1);
#endif
    }
  } else alb = wallC * 0.82;
  // daylight through the window: falls off with depth; the floor near the window catches the most
  float dayL = 0.16 * exp(-H.z * 0.32) + 0.03;
  vec3 c = alb * dayL;
  lit = alb * (0.55 + 0.45 * exp(-abs(H.y - y1) * 0.6)) + vec3(glow * 1.2);
  // blinds (top-down, slatted) or curtains (residential side panels) on the glass itself
  float wh = R.w - R.z, ww = C.w - C.z;
  float bl = h1 > 0.45 ? (h3 * 0.75 + 0.05) : 0.0;
  if (office) bl = h4 > 0.55 ? h3 * 0.9 : 0.0;
  if (p.y > R.w - bl * wh) {
    vec3 bc = office ? vec3(0.6, 0.6, 0.58) : vec3(0.75, 0.7, 0.6);
    bc *= 1.0 - 0.3 * facJoint(p.y, 0.05, 0.008, 0.004);
    c = bc * 0.14; lit = bc * 0.5;
  } else if (!office && h2 > 0.5) {
    float cw = ww * (0.18 + 0.12 * h4);
    if (p.x < C.z + cw || p.x > C.w - cw) {
      vec3 cc = mix(vec3(0.7, 0.62, 0.5), vec3(0.45, 0.2, 0.18), step(0.75, h3));
      cc *= 1.0 - 0.2 * facJoint(p.x, 0.12, 0.05, 0.01);
      c = cc * 0.12; lit = cc * 0.55;
    }
  }
  if (typ == 3) c *= 0.55;                           // coated curtain-wall glass transmits less
  return c;
}
#endif
/* curtain-wall glass: sky reflection with fresnel over a dim office interior (rooms at high+), lit cells at night */
void bqCurtainShade() {
  if (bqCurtain < 0.5) return;
  vec3 Vw = normalize(vFWP - cameraPosition);
  float gl = dot(bqTint, vec3(0.2126, 0.7152, 0.0722));
  vec3 tint = clamp(bqTint / max(gl, 1e-3), 0.5, 1.6);
  vec3 glassCol = mix(vec3(gl), bqTint, 0.7) * 0.35;
  vec3 roomLit = vec3(1.0);
#if TL_BQ >= 2
  vec3 rv = vec3(dot(Vw, bqT), Vw.y, max(dot(Vw, -bqN), 0.05));
  float near = 1.0 - smoothstep(40.0, 90.0, distance(cameraPosition, vFWP));
  if (near > 0.0 && bqCG > 0.001) {
    vec3 room = bqRoom(vec2(dot(vFWP, bqT), vFWP.y), rv, bqC, bqR, bqCell, bqCurtain > 1.5 ? 1 : 3, roomLit);
    glassCol = mix(glassCol, room * tint, near);
    roomLit = mix(vec3(1.0), roomLit, near);
  }
#endif
  float night = smoothstep(0.05, 0.6, uNight);
  float lit = step(facHash(bqCell), 0.5 * night);
  vec3 lamp = (facHash(bqCell * 7 + 3) < 0.6 ? vec3(0.85, 0.92, 1.0) : vec3(1.0, 0.78, 0.5)) * (0.4 + 0.6 * facHash(bqCell * 13 + 5));
  vec3 Rr = reflect(Vw, bqN);
  float cosT = clamp(dot(-Vw, bqN), 0.0, 1.0);
  float f0 = bqCurtain > 1.5 ? 0.08 : 0.14 + 0.1 * bqMetal;
  float fres = f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);
  vec3 sky = Rr.y > 0.0 ? mix(uSkyH, uSkyZ, pow(clamp(Rr.y, 0.0, 1.0), 0.6)) : mix(uSkyH * 0.5, uSkyH * 0.12, clamp(-Rr.y * 2.5, 0.0, 1.0));
  facWall = bqWall;
  if (bqCurtain > 1.5) {                                             // punched window: dark frame, lighter stone sill
    facWall = mix(facWall, mix(bqWall, vec3(0.03, 0.03, 0.032), 0.65), clamp(bqFrame, 0.0, 1.0));
    facWall = mix(facWall, bqWall * 1.25, clamp(bqSill, 0.0, 1.0));
    tint = vec3(1.0);
  }
  facGlass = bqCG;
  facF0 = vec3(f0) * mix(vec3(1.0), tint, 0.5);
  facRough = 0.05;
  facGlassEmit = glassCol * (1.0 - lit);
  facLamp = (lamp * roomLit * lit * 0.9 * uInvExp + sky * mix(vec3(1.0), tint, 0.5) * fres * (1.0 - 0.6 * lit) * 0.9) * bqCG;
}
#else
const float bqOn = 0.0;
#endif
`;

TL.ScanHooks.load.push((data) => TL.Buildings.load(data));
{
  const prevTile = TL.ScanHooks.nycTile;
  TL.ScanHooks.nycTile = (world, g, list) => { if (prevTile) prevTile(world, g, list); TL.Buildings.tile(g, list); };
}
TL.ScanHooks.build.push((world) => {
  const game = world.game;
  TL.Buildings.setTier(world);
  if (!game._bqWrapped) {
    game._bqWrapped = true;
    const aq = game.applyQuality;
    game.applyQuality = function (q) { aq.call(this, q); if (this.streamer && this.streamer.nycMat) TL.Buildings.setTier(this.streamer); };
  }
});
