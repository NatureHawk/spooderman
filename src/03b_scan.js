/* =====================================================================================
   SCAN MAP (seed "MAN") — the Lower Manhattan photogrammetry scan as a standalone world.
   ScanData   decodes the embedded scan (tiles, collision boxes, land mask, 8K atlas, top-down map)
   ScanLayout CityLayout stand-in: land/water + flat ground from the scan's land mask (no grid, no river)
   ScanWorld  WorldStreamer stand-in: textured scan tiles + heightfield-derived box colliders
   Data is produced by tools/scan/build_scan.py (world metres, ground y = 0, scan centred on the origin).
   ===================================================================================== */
'use strict';

/* Extra embedded data (tools/build.js packs <build>/extra/* into #tl-extra as name -> base64).
   buffer(name) gunzips names ending in .gz; image(name) decodes webp/png/jpg; json(name) parses. */
TL.Extra = {
  _m: null,
  map() { if (!this._m) { const el = document.getElementById('tl-extra'); const t = el ? el.textContent.trim() : ''; this._m = t.charAt(0) === '{' ? JSON.parse(t) : {}; } return this._m; },
  has(n) { return !!this.map()[n]; },
  async buffer(n) {
    const b = this.map()[n]; if (!b) return null;
    const raw = await (await fetch('data:application/octet-stream;base64,' + b)).arrayBuffer();
    return n.endsWith('.gz') ? new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : raw;
  },
  async text(n) { const b = await this.buffer(n); return b ? new TextDecoder().decode(b) : null; },
  async json(n) { const t = await this.text(n); return t ? JSON.parse(t) : null; },
  async image(n) {
    const b = this.map()[n]; if (!b) return null;
    const type = n.endsWith('.png') ? 'image/png' : n.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
    const im = new Image(); im.src = 'data:' + type + ';base64,' + b; await im.decode(); return im;
  },
};
/* Extension points for the scan world, filled by later modules (03c_trees.js, 03d_facade.js):
   load(data, step)          async, at the end of ScanData.load (decode extra data)
   build(world)              at the end of the ScanWorld constructor (add meshes / colliders)
   update(world, focus, vel, dt)   every frame
   nycMaterial(world, atlasTexture) -> THREE.Material   replaces the NYC building material when set
   nycTile(world, geometry, buildings)  per NYC tile before its mesh is made (buildings = nyc.json entries in triangle order)
   preNYC(world)             before the NYC buildings are made: add building ids to world.replaced to hide them (+ their colliders)
   groundMaterial(world, geometry, defaultMaterial) -> THREE.Material   replaces the street/ground material (geometry has uv into the ground image) */
TL.ScanHooks = { load: [], build: [], update: [], preNYC: [], nycMaterial: null, nycTile: null, groundMaterial: null };

TL.SCAN_SEED = 'MAN';
TL.parseSeed = function (v) {
  const s = String(v == null ? '' : v).trim();
  if (s.toUpperCase() === TL.SCAN_SEED) return TL.SCAN_SEED;
  return parseInt(s, 10) || 1337;
};

TL.ScanData = {
  ready: false,
  available() { const el = document.getElementById('tl-scan-json'); return !!(el && el.textContent.trim().charAt(0) === '{'); },
  async load(onProgress) {
    if (this.ready) return this;
    if (!this.available()) throw new Error('This build has no embedded Manhattan scan (run tools/scan/build_scan.py, then node tools/build.js)');
    const step = (p, m) => onProgress && onProgress(p, m);
    this.meta = JSON.parse(document.getElementById('tl-scan-json').textContent);
    step(0.1, 'Decoding the scan mesh');
    const b64 = document.getElementById('tl-scan-bin').textContent.replace(/\s+/g, '');
    const gz = await (await fetch('data:application/octet-stream;base64,' + b64)).arrayBuffer();
    this.bin = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    step(0.5, 'Decoding the 8K scan texture');
    const img = (id, type) => {
      const im = new Image();
      im.src = 'data:' + type + ';base64,' + document.getElementById(id).textContent.replace(/\s+/g, '');
      return im.decode().then(() => im);
    };
    [this.texImg, this.mapImg] = await Promise.all([img('tl-scan-tex', 'image/webp'), img('tl-scan-map', 'image/jpeg')]);
    // NYC official buildings (tools/scan/build_nyc.py) replacing the scan's own
    const nj = document.getElementById('tl-nyc-json');
    if (nj && nj.textContent.trim().charAt(0) === '{') {
      step(0.9, 'Decoding NYC buildings');
      this.nyc = JSON.parse(nj.textContent);
      const nb = document.getElementById('tl-nyc-bin').textContent.replace(/\s+/g, '');
      const ngz = await (await fetch('data:application/octet-stream;base64,' + nb)).arrayBuffer();
      this.nycBin = await new Response(new Blob([ngz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const ge = document.getElementById('tl-nyc-ground');
      if (ge && ge.textContent.trim()) this.groundImg = await img('tl-nyc-ground', 'image/jpeg');
      const ae = document.getElementById('tl-nyc-atlas');
      if (ae && ae.textContent.trim()) this.atlasImg = await img('tl-nyc-atlas', 'image/webp');
    }
    // hero landmarks (tools/scan/landmarks.py): downloaded models fitted onto real footprints
    const lj = document.getElementById('tl-lm-json');
    if (lj && lj.textContent.trim().charAt(0) === '{') {
      step(0.95, 'Decoding landmarks');
      this.lm = JSON.parse(lj.textContent);
      const lb = document.getElementById('tl-lm-bin').textContent.replace(/\s+/g, '');
      const lgz = await (await fetch('data:application/octet-stream;base64,' + lb)).arrayBuffer();
      this.lmBin = await new Response(new Blob([lgz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      for (const L of this.lm.landmarks) for (const P of L.parts) if (P.tex) { const im = new Image(); im.src = 'data:image/webp;base64,' + P.tex; await im.decode(); P.img = im; }
    }
    const M = this.meta, B = this.bin;
    this.boxRect = new Int16Array(B, M.boxes.rect, M.boxes.n * 4);
    this.boxH = new Uint16Array(B, M.boxes.h, M.boxes.n);
    this.land = new Uint8Array(B, M.land, M.nx * M.nz);
    for (const f of TL.ScanHooks.load) await f(this, step);
    step(1, 'Scan ready');
    this.ready = true;
    return this;
  },
  /* 1 over land (incl. piers), 0 over water / outside the scan */
  isLand(x, z) {
    const M = this.meta, i = Math.floor((x - M.ox) / M.cell), j = Math.floor((z - M.oz) / M.cell);
    if (i < 0 || j < 0 || i >= M.nx || j >= M.nz) return false;
    return this.land[j * M.nx + i] === 1;
  },
};

/* ------------------------------------------------------------------ layout stand-in */
TL.ScanLayout = class extends TL.CityLayout {
  constructor(data) {
    super(0);
    this.scanData = data;
    this.scan = true;
    const M = data.meta;
    this.half = Math.max(-M.min[0], M.max[0], -M.min[2], M.max[2]) + 40;
    this.rx0 = this.rx1 = 1e6; this.bridgeZ = 1e6;              // no river / bridge in this map
    this.park = { i0: 1, i1: 0, j0: 1, j1: 0 };                   // no generated park
  }
  district() { return 'lower manhattan'; }
  isRiverX() { return false; }
  onBridge() { return false; }
  isWater(x, z) { return !this.scanData.isLand(x, z); }
  isBlockWater(i, j) { const c = this.blockCenter(i, j); return this.isWater(c.x, c.z); }
  ground(x, z) { return this.isWater(x, z) ? TL.C.WATER_Y - 14 : 0; }
  roadNS() { return false; }
  roadEW() { return false; }
  segOK() { return false; }
};

/* ------------------------------------------------------------------ street graph + sidewalk loops
   Traffic drives the skeleton of the open street space (segments in TrafficManager's format, lanes
   scaled to each street's half-width, signals only at real junctions). Pedestrians walk loops traced
   around each building block; t in [0,4) maps onto the loop perimeter like the grid's block loops. */
TL.ScanNav = class {
  constructor(N) {
    this.nodes = N.nodes;                                   // [x, z, half-width]
    this.adj = N.nodes.map(() => []);
    for (const [a, b] of N.edges) { this.adj[a].push(b); this.adj[b].push(a); }
    this.edges = N.edges;
    this.loops = N.loops.map((pts) => {
      const cum = [0]; let cx = 0, cz = 0;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        cum.push(cum[k] + Math.hypot(b[0] - a[0], b[1] - a[1])); cx += a[0]; cz += a[1];
      }
      return { pts, cum, per: cum[pts.length], cx: cx / pts.length, cz: cz / pts.length };
    });
  }
  seg(a, b) {
    const A = this.nodes[a], B = this.nodes[b], len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1e-3;
    const dx = (B[0] - A[0]) / len, dz = (B[1] - A[1]) / len, hw = Math.min(A[2], B[2]);
    return { ax: A[0], az: A[1], bx: B[0], bz: B[1], dx, dz, len, ns: Math.abs(dz) > Math.abs(dx), a, b,
      sig: this.adj[b].length >= 3, lanes: [TL.clamp(hw * 0.25, 0.9, 2.1), TL.clamp(hw * 0.62, 2.0, 5.6)] };
  }
  randomSeg(focus, r, rng) {
    const near = [];
    for (let k = 0; k < this.edges.length; k++) {
      const A = this.nodes[this.edges[k][0]];
      if (Math.abs(A[0] - focus.x) < r && Math.abs(A[1] - focus.z) < r) near.push(k);
    }
    if (!near.length) return null;
    const e = this.edges[near[Math.floor(rng.next() * near.length)]];
    return rng.next() < 0.5 ? this.seg(e[0], e[1]) : this.seg(e[1], e[0]);
  }
  /* continue through node b: mostly the straightest option, U-turn at dead ends */
  nextSeg(s, straight) {
    const opts = this.adj[s.b].filter((n) => n !== s.a);
    if (!opts.length) return this.seg(s.b, s.a);
    let best = opts[0], bd = -2;
    for (const n of opts) {
      const B = this.nodes[n], P = this.nodes[s.b], l = Math.hypot(B[0] - P[0], B[1] - P[1]) || 1;
      const d = ((B[0] - P[0]) * s.dx + (B[1] - P[1]) * s.dz) / l;
      if (d > bd) { bd = d; best = n; }
    }
    return this.seg(s.b, straight || Math.random() < 0.6 ? best : opts[Math.floor(Math.random() * opts.length)]);
  }
  loopPos(i, t, out) {
    const L = this.loops[i], d = (((t % 4) + 4) % 4) / 4 * L.per, c = L.cum;
    let lo = 0, hi = L.pts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m] <= d) lo = m; else hi = m - 1; }
    const a = L.pts[lo], b = L.pts[(lo + 1) % L.pts.length], f = (d - c[lo]) / ((c[lo + 1] - c[lo]) || 1);
    return out.set(a[0] + (b[0] - a[0]) * f, 0, a[1] + (b[1] - a[1]) * f);
  }
  /* loop with a vertex closest to (x,z) within r, or -1 */
  nearestLoop(x, z, r, skip) {
    let best = -1, bd = r * r;
    for (let i = 0; i < this.loops.length; i++) {
      if (i === skip) continue;
      const L = this.loops[i];
      if (Math.abs(L.cx - x) > L.per / 2 + r || Math.abs(L.cz - z) > L.per / 2 + r) continue;
      for (const p of L.pts) { const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z); if (d < bd) { bd = d; best = i; } }
    }
    return best;
  }
  neighbourLoop(i, pos, r) { return this.nearestLoop(pos.x, pos.z, r, i); }
};

/* ------------------------------------------------------------------ world stand-in */
TL.ScanWorld = class {
  constructor(game) {
    this.game = game; this.scene = game.scene; this.world = game.world; this.layout = game.layout;
    this.data = TL.ScanData;
    this.mats = new TL.CityMaterials();         // Environment drives these uniforms every frame
    this.chunks = new Map(); this.cranes = []; this.lights = []; this.signals = []; this.landmarks = []; this.throwables = [];
    this.meshRadius = 640; this.propRadius = 240; this.colRadius = 240;
    this.quality = game.settings.quality || 'high';
    this.stats = { chunks: 0, loaded: 0, props: 0 };
    this.world.groundFn = (x, z) => this.layout.ground(x, z);
    this.world.waterFn = (x, z) => this.layout.isWater(x, z);
    this.nav = new TL.ScanNav(this.data.meta.nav);
    this.buildMaterial();
    this.buildTiles();
    this.buildColliders();
    this.buildGround();
    this.replaced = new Set();
    if (this.data.lm) for (const L of this.data.lm.landmarks) for (const id of L.replaces) this.replaced.add(id);
    for (const f of TL.ScanHooks.preNYC) f(this);                // e.g. add ids to this.replaced (hidden, no colliders)
    if (this.data.nyc) this.buildNYC();
    if (this.data.lm) this.buildLandmarks();
    for (const f of TL.ScanHooks.build) f(this);
  }
  /* flat land plane: streets / sidewalks / parks / kerbs painted from the NYC linework (build_nyc.py) */
  buildGround() {
    const M = this.data.meta, L = this.data.land, cs = M.cell, P = [], I = [], UV = [];
    const Gd = this.data.nyc && this.data.nyc.ground, gi = this.data.groundImg, y = gi ? -0.02 : -0.12;
    const uv = (x, z) => { if (Gd) UV.push((x - Gd.x0) / Gd.w, 1 - (z - Gd.z0) / Gd.h); else UV.push(0, 0); };
    for (let j = 0; j < M.nz; j++) {
      let i = 0;
      while (i < M.nx) {
        if (L[j * M.nx + i] !== 1) { i++; continue; }
        let i1 = i; while (i1 + 1 < M.nx && L[j * M.nx + i1 + 1] === 1) i1++;
        const x0 = M.ox + i * cs, x1 = M.ox + (i1 + 1) * cs, z0 = M.oz + j * cs, z1 = z0 + cs, b = P.length / 3;
        P.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
        uv(x0, z0); uv(x1, z0); uv(x1, z1); uv(x0, z1);
        I.push(b, b + 2, b + 1, b, b + 3, b + 2);
        i = i1 + 1;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
    let mat;
    if (gi) {
      const t = new THREE.Texture(gi);
      t.encoding = THREE.sRGBEncoding; t.anisotropy = Math.min(8, this.game.renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true;
      mat = new THREE.MeshLambertMaterial({ map: t });
    } else mat = new THREE.MeshLambertMaterial({ color: 0x3b3d40 });
    if (TL.ScanHooks.groundMaterial) mat = TL.ScanHooks.groundMaterial(this, g, mat) || mat;   // streets module
    this.ground = new THREE.Mesh(g, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }
  /* landmarks: their own baked texture, lit normally; colliders from their real shape */
  buildLandmarks() {
    const B = this.data.lmBin, r = this.game.renderer;
    for (const L of this.data.lm.landmarks) {
      for (const P of L.parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(B, P.o, P.n * 9), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(B, P.uo, P.n * 6), 2));
        g.computeVertexNormals(); g.computeBoundingSphere();
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.05, side: THREE.DoubleSide });
        mat.color.setRGB(P.color[0], P.color[1], P.color[2]);
        if (P.img) {
          const t = new THREE.Texture(P.img); t.encoding = THREE.sRGBEncoding;          // Blender UVs: origin bottom-left (flipY default)
          if (P.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy()); t.needsUpdate = true;
          mat.map = t;
          if (P.alpha) { mat.alphaTest = 0.5; mat.shadowSide = THREE.DoubleSide; }
        }
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.name = 'LM_' + L.name;
        this.scene.add(m);
      }
      const X = new Float32Array(B, L.bo, L.nb * 7);
      for (let k = 0; k < L.nb; k++) {
        const o = k * 7, top = X[o + 1], hy = (top + 1) / 2;
        this.world.addStatic(X[o], top - hy, X[o + 2], X[o + 3], hy, X[o + 4], X[o + 5], { kind: 'building', climb: true, src: 'lm' });
      }
      this.landmarks.push({ name: L.name.replace(/_/g, ' '), x: X[0], y: X[1], z: X[2] });
    }
  }
  /* NYC DCP buildings: flat-shaded triangles on the shared procedural facade material (windows, interiors,
     night lights, rain), one merged mesh per 160 m tile; per-building oriented box colliders */
  buildNYC() {
    const N = this.data.nyc, B = this.data.nycBin, tiles = new Map();
    for (const b of N.buildings) {
      if (this.replaced.has(b.id)) continue;
      const k = Math.floor(b.x / 160) + ',' + Math.floor(b.z / 160);
      if (!tiles.has(k)) tiles.set(k, []);
      tiles.get(k).push(b);
    }
    const col = new THREE.Color(), trim = new THREE.Color();
    this.nycMeshes = [];
    for (const list of tiles.values()) {
      let n = 0; for (const b of list) n += b.n;
      const P = new Float32Array(n * 9), Nn = new Float32Array(n * 9), C = new Float32Array(n * 9), Fa = new Float32Array(n * 12), Tr = new Float32Array(n * 9), UV = new Float32Array(n * 6);
      let t = 0;
      for (const b of list) {
        const T = new Float32Array(B, b.o, b.n * 9);
        P.set(T, t * 9);
        if (b.uo !== undefined) UV.set(new Float32Array(B, b.uo, b.n * 6), t * 6);
        if (this.nycMat) col.setRGB(1, 1, 1); else col.setHex(b.c);
        trim.setHex(b.t);
        for (let k = 0; k < b.n; k++, t++) {
          const o = k * 9;
          const ax = T[o + 3] - T[o], ay = T[o + 4] - T[o + 1], az = T[o + 5] - T[o + 2];
          const bx = T[o + 6] - T[o], by = T[o + 7] - T[o + 1], bz = T[o + 8] - T[o + 2];
          let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          for (let v = 0; v < 3; v++) {
            const q = t * 9 + v * 3, f = t * 12 + v * 4;
            Nn[q] = nx; Nn[q + 1] = ny; Nn[q + 2] = nz;
            C[q] = col.r; C[q + 1] = col.g; C[q + 2] = col.b;
            Tr[q] = trim.r; Tr[q + 1] = trim.g; Tr[q + 2] = trim.b;
            Fa[f] = b.st; Fa[f + 1] = b.fh; Fa[f + 2] = b.ww; Fa[f + 3] = b.sd;
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      g.setAttribute('aFac', new THREE.BufferAttribute(Fa, 4));
      g.setAttribute('aTrim', new THREE.BufferAttribute(Tr, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
      g.computeBoundingSphere();
      if (TL.ScanHooks.nycTile) TL.ScanHooks.nycTile(this, g, list);   // extra per-triangle attributes (list: buildings in triangle order)
      const m = new THREE.Mesh(g, this.nycMat || this.mats.facade);
      m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false;
      this.scene.add(m); this.nycMeshes.push(m);
    }
    const S = N.boxes.stride || 6, X = new Float32Array(B, N.boxes.o, N.boxes.n * S), skip = this.replaced;
    for (let k = 0; k < N.boxes.n; k++) {
      const o = k * S; if (S > 6 && skip.has(X[o + 6])) continue;
      const x = X[o], top = X[o + 1], z = X[o + 2], hy = (top + 1) / 2;
      this.world.addStatic(x, top - hy, z, X[o + 3], hy, X[o + 4], X[o + 5], { kind: 'building', climb: true, src: 'nyc', bid: S > 6 ? X[o + 6] : 0 });
    }
  }
  /* photogrammetry carries its own baked light: mostly emissive (scaled by time of day / weather),
     with a small lambert term so the sun, hemisphere and the hero's shadow still read on it */
  buildMaterial() {
    const img = this.data.texImg, r = this.game.renderer;
    const maxT = r.capabilities.maxTextureSize || 4096;
    const fit = (im, cap) => {
      cap = Math.min(cap, maxT);
      if (Math.max(im.width, im.height) <= cap) return im;
      const k = cap / Math.max(im.width, im.height), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im, 0, 0, cv.width, cv.height);
      return cv;
    };
    const capQ = { low: 2048, medium: 4096 }[this.quality] || 16384;
    // with NYC buildings the raw scan only covers trees / piers / the FDR: 4K is plenty
    const src = fit(img, this.data.atlasImg ? Math.min(capQ, 4096) : capQ);
    const tex = new THREE.Texture(src);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.tex = tex;
    this.mat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.72, color: 0x2a2a2a });
    // NYC buildings wear the scan's colour baked into their own atlas (build_nyc.py): same photo-lit look
    const ai = this.data.atlasImg;
    if (ai) {
      const at = new THREE.Texture(fit(ai, capQ));
      at.encoding = THREE.sRGBEncoding; at.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy()); at.needsUpdate = true;
      // real photo facades (brick, glass, stone, roofs) shown as-is: no procedural windows over them
      this.nycMat = TL.ScanHooks.nycMaterial ? TL.ScanHooks.nycMaterial(this, at)
        : new THREE.MeshLambertMaterial({ map: at, emissiveMap: at, emissive: 0xffffff, emissiveIntensity: 0.72, color: 0x2a2a2a, side: THREE.DoubleSide });
      this.nycMat.shadowSide = THREE.BackSide;
    }
  }
  buildTiles() {
    const M = this.data.meta, B = this.data.bin, mn = M.min, ext = [M.max[0] - mn[0], M.max[1] - mn[1], M.max[2] - mn[2]];
    this.group = new THREE.Group(); this.group.name = 'ManhattanScan';
    for (const t of M.tiles) {
      const q = new Uint16Array(B, t.pos, t.n * 3), pos = new Float32Array(t.n * 3);
      for (let k = 0; k < t.n; k++) {
        pos[k * 3] = mn[0] + q[k * 3] / 65535 * ext[0];
        pos[k * 3 + 1] = mn[1] + q[k * 3 + 1] / 65535 * ext[1];
        pos[k * 3 + 2] = mn[2] + q[k * 3 + 2] / 65535 * ext[2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(B, t.nrm, t.n * 3), 3, true));
      g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(B, t.uv, t.n * 2), 2, true));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(B, t.idx, t.i), 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.mat);
      m.receiveShadow = true; m.matrixAutoUpdate = false;
      this.group.add(m);
    }
    this.scene.add(this.group);
    this.stats.loaded = M.tiles.length;
  }
  /* heightfield boxes: bottom a metre under the ground, top at the (quantized) roof */
  buildColliders() {
    const M = this.data.meta, R = this.data.boxRect, H = this.data.boxH, cs = M.cell;
    for (let k = 0; k < M.boxes.n; k++) {
      const x0 = M.ox + R[k * 4] * cs, z0 = M.oz + R[k * 4 + 1] * cs, x1 = M.ox + (R[k * 4 + 2] + 1) * cs, z1 = M.oz + (R[k * 4 + 3] + 1) * cs;
      const top = H[k] / 10, hy = (top + 1) / 2;
      this.world.addStatic((x0 + x1) / 2, top - hy, (z0 + z1) / 2, (x1 - x0) / 2, hy, (z1 - z0) / 2, 0, { kind: 'building', climb: true, src: 'scan' });
    }
  }
  setQuality(q, dist) { this.meshRadius = dist; }
  update(focus, vel, dt) {
    const e = this.game.env; if (!e) return;
    const day = 1 - (e.night || 0), wet = e.rain || 0;
    this.mat.emissiveIntensity = 0.1 + 0.62 * day * (1 - wet * 0.35);
    if (this.nycMat && this.nycMat.emissiveIntensity !== undefined) this.nycMat.emissiveIntensity = this.mat.emissiveIntensity;
    for (const f of TL.ScanHooks.update) f(this, focus, vel, dt);
  }
  forceLoadAround() {}
  spawnPoint(alt) {
    const s = this.data.meta.spawn;
    return { x: s.x, y: s.y, z: s.z + (alt ? 6 : 0) };
  }
  chunkData() { return null; }
  /* closest land cell to p (ring search over the land mask) — water recovery target */
  nearestLand(p, maxR) {
    const M = this.data.meta, L = this.data.land, cs = M.cell;
    const ci = Math.floor((p.x - M.ox) / cs), cj = Math.floor((p.z - M.oz) / cs), R = Math.ceil((maxR || 200) / cs);
    let best = null, bd = Infinity;
    for (let r = 0; r <= R && !best; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= M.nx || j >= M.nz || L[j * M.nx + i] !== 1) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = { x: M.ox + (i + 0.5) * cs, z: M.oz + (j + 0.5) * cs }; }
      }
    }
    return best && { x: best.x, y: 0.4, z: best.z, d: Math.sqrt(bd) * cs };
  }
};
