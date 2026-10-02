/* =====================================================================================
   ASSETS — decodes the Blender-exported library embedded in this file.
   Format (tools/hd/export_tla.py): gzip(binary) as base64 + JSON manifest.
   Per asset & LOD ('lo' = original low-poly set, 'mid' = decimated, 'hi' = full detail):
     int16 positions (bbox-quantized), int8 normals, uint8 material index per vertex,
     optional uint8x4 bone indices + weights, uint16/uint32 indices, palette [r,g,b,slot,emit,rough,metal].
   Materials: one MeshStandardMaterial family with shader hooks for
     * slot recolouring (hero suits / outfits / NPC clothing / vehicle paint via uniforms or instanceColor)
     * per-vertex emissive, roughness and metalness from the palette
   ===================================================================================== */
'use strict';

TL.Assets = {
  man: null, bin: null, cache: new Map(), mats: new Map(), ready: false,
  SLOT_BODY: 7,

  async load(onProgress) {
    const jEl = document.getElementById('tl-assets-json');
    const bEl = document.getElementById('tl-assets-bin');
    if (!jEl || !bEl || !bEl.textContent.trim()) throw new Error('Embedded asset data missing');
    this.man = JSON.parse(jEl.textContent);
    onProgress && onProgress(0.1, 'Decoding asset library');
    const b64 = bEl.textContent.replace(/\s+/g, '');
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    onProgress && onProgress(0.3, 'Decompressing geometry');
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser lacks DecompressionStream (needed to unpack the embedded 3D assets). Please use a current Chrome, Edge, Firefox or Safari.');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    this.bin = await new Response(stream).arrayBuffer();
    // user-supplied model packs: heroes (pack 1) and road vehicles (pack 2) — separate binaries + textures, override procedural entries
    this.texImgs = {}; this.packs = {};
    for (const [id, pk] of [['hero', 1], ['veh', 2]]) {
      const hj = document.getElementById('tl-' + id + '-json');
      if (!hj || hj.textContent.trim().charAt(0) !== '{') continue;
      onProgress && onProgress(0.45, 'Decoding ' + (pk === 1 ? 'hero' : 'vehicle') + ' models');
      const hm = JSON.parse(hj.textContent);
      const hb = document.getElementById('tl-' + id + '-bin').textContent.replace(/\s+/g, '');
      const hraw = Uint8Array.from(atob(hb), (c) => c.charCodeAt(0));
      this.packs[pk] = await new Response(new Blob([hraw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      for (const k in hm.assets) this.man.assets[k] = hm.assets[k];
      const te = document.getElementById('tl-' + id + '-tex');
      const tj = te && te.textContent.trim().charAt(0) === '{' ? JSON.parse(te.textContent) : {};
      await Promise.all(Object.keys(tj).map((k) => { const im = new Image(); im.src = 'data:image/webp;base64,' + tj[k]; return im.decode().then(() => { this.texImgs[k] = im; }); }));
    }
    onProgress && onProgress(0.6, 'Assets ready');
    this.ready = true;
  },
  has(name, lod) { const a = this.man && this.man.assets[name]; return !!(a && (lod ? a[lod] : true)); },
  entry(name, lod) {
    const a = this.man.assets[name]; if (!a) return null;
    if (lod && a[lod]) return a[lod];
    return a.hi || a.mid || a.lo;
  },
  /* LOD choice by quality preset: low uses the original low-poly set (when present) */
  pickLod(name, quality, far) {
    const a = this.man.assets[name]; if (!a) return null;
    if (quality === 'low') return a.lo ? 'lo' : (a.mid ? 'mid' : 'hi');
    if (quality === 'medium' || far) return a.mid ? 'mid' : (a.hi ? 'hi' : 'lo');
    return a.hi ? 'hi' : (a.mid ? 'mid' : 'lo');
  },
  srgb(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); },
  /* Build (and cache) a BufferGeometry for an asset LOD. Attributes: position, normal, color,
     aSlot (slot id + 8*emissive), aRM (roughness, metalness), [skinIndex, skinWeight]. */
  geo(name, lod) {
    const key = name + '|' + (lod || '');
    if (this.cache.has(key)) return this.cache.get(key);
    const e = this.entry(name, lod);
    if (!e) return null;
    const buf = e.hb ? this.packs[e.hb] : this.bin;
    const vc = e.vc, ic = e.ic;
    const pos = new Int16Array(buf, e.pos, vc * 3), nor = new Int8Array(buf, e.nor, vc * 4), mat = new Uint8Array(buf, e.mat, vc);
    const P = new Float32Array(vc * 3), N = new Float32Array(vc * 3), C = new Float32Array(vc * 3), SL = new Float32Array(vc), RM = new Float32Array(vc * 2);
    const ctr = e.ctr, half = e.half;
    const pal = e.pal.map((p) => [this.srgb(p[0]), this.srgb(p[1]), this.srgb(p[2]), p[3], p[4], p[5], p[6]]);
    for (let i = 0; i < vc; i++) {
      P[i * 3] = ctr[0] + (pos[i * 3] / 32767) * half[0];
      P[i * 3 + 1] = ctr[1] + (pos[i * 3 + 1] / 32767) * half[1];
      P[i * 3 + 2] = ctr[2] + (pos[i * 3 + 2] / 32767) * half[2];
      N[i * 3] = nor[i * 4] / 127; N[i * 3 + 1] = nor[i * 4 + 1] / 127; N[i * 3 + 2] = nor[i * 4 + 2] / 127;
      const m = pal[Math.min(mat[i], pal.length - 1)];
      C[i * 3] = m[0]; C[i * 3 + 1] = m[1]; C[i * 3 + 2] = m[2];
      SL[i] = m[3] + (m[4] ? 8 : 0);
      RM[i * 2] = m[5]; RM[i * 2 + 1] = m[6];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('aSlot', new THREE.BufferAttribute(SL, 1));
    g.setAttribute('aRM', new THREE.BufferAttribute(RM, 2));
    const idx = e.big ? new Uint32Array(buf.slice(e.idx, e.idx + ic * 4)) : new Uint16Array(buf.slice(e.idx, e.idx + ic * 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    if (e.bi !== undefined) {
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(buf.slice(e.bi, e.bi + vc * 4)), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(Array.from(new Uint8Array(buf, e.bw, vc * 4), (w) => w / 255)), 4));
    }
    if (e.uv !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf.slice(e.uv, e.uv + vc * 8)), 2));
    if (e.groups) for (const q of e.groups) g.addGroup(q[0], q[1], q[2]);
    g.computeBoundingSphere(); g.computeBoundingBox();
    g.userData = { name, lod: e.lod, tex: e.tex || null, cols: e.cols || [], socks: e.socks || {}, extra: e.extra || {}, bones: e.bones || null, wheels: e.wheels || null, tris: ic / 3 };
    this.cache.set(key, g);
    return g;
  },
  info(name) { const e = this.entry(name, 'lo') || this.entry(name); return e || {}; },

  /* ---------------------------------------------------------------- materials
     opts: { slots: {1: THREE.Color, ...}, instBody: bool (instanceColor -> body slot), skinned, emit, transparent } */
  material(opts) {
    opts = opts || {};
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, transparent: !!opts.transparent, opacity: opts.opacity || 1 });
    const slotCols = [];
    for (let i = 0; i < 8; i++) slotCols.push(new THREE.Color(opts.slots && opts.slots[i] ? opts.slots[i] : 0x808080));
    m.userData.uSlots = { value: slotCols };
    m.userData.uEmit = { value: opts.emit !== undefined ? opts.emit : 1.6 };
    m.userData.uGlow = { value: new THREE.Color(1, 1, 1) };
    m.userData.uHit = { value: 0 };
    const instBody = !!opts.instBody;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uSlots = m.userData.uSlots; sh.uniforms.uEmit = m.userData.uEmit; sh.uniforms.uHit = m.userData.uHit;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSlot;\nattribute vec2 aRM;\nuniform vec3 uSlots[8];\nvarying float vEmitF;\nvarying vec2 vRM;')
        .replace('#include <color_vertex>', `
          vColor = color;
          float sl = mod(aSlot, 8.0);
          vEmitF = step(7.5, aSlot);
          int si = int(sl + 0.5);
          if (si > 0) { vColor = uSlots[si]; }
          ${instBody ? '#ifdef USE_INSTANCING_COLOR\n if (si == 7 || si == 1) vColor = instanceColor;\n#endif' : ''}
          vRM = aRM;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vEmitF;\nvarying vec2 vRM;\nuniform float uEmit;\nuniform float uHit;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(vRM.x, 0.04, 1.0);')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * vEmitF * uEmit + vec3(uHit);');
    };
    m.customProgramCacheKey = () => 'tl-std-' + (instBody ? 'ib' : 'n');
    return m;
  },
  /* Textured assets (the user-supplied WEAVER model): one MeshStandardMaterial per texture set, matching the geometry's
     groups. Textures: diffuse (sRGB), normal (UE style, green down), ORM (R occlusion, G roughness, B metal). */
  texture(key, srgb) {
    const im = this.texImgs && this.texImgs[key]; if (!im) return null;
    this._tc = this._tc || {};
    const ck = key + (srgb ? 's' : 'l');
    if (this._tc[ck]) return this._tc[ck];
    const t = new THREE.Texture(im);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.needsUpdate = true;
    return (this._tc[ck] = t);
  },
  texMats(geo) {
    const spec = geo.userData.tex; if (!spec) return null;
    if (geo.userData.mats) return geo.userData.mats;
    const list = spec.map((s) => {
      const o = { roughness: s.rough !== undefined ? s.rough : 0.5, metalness: s.metal !== undefined ? s.metal : 0.4, side: THREE.FrontSide };
      if (s.d) {
        o.map = this.texture(s.d, true);
        if (s.n) { o.normalMap = this.texture(s.n, false); o.normalScale = new THREE.Vector2(1, -1); }
        if (s.o) { o.roughnessMap = o.metalnessMap = this.texture(s.o, false); o.roughness = 1; o.metalness = 1; }
      } else if (s.c) o.color = new THREE.Color(this.srgb(s.c[0]), this.srgb(s.c[1]), this.srgb(s.c[2]));
      const m = new THREE.MeshStandardMaterial(o); m.userData.texSet = true;
      if (s.e) { m.emissiveMap = this.texture(s.e, true); m.emissive.set(0xffffff); m.emissiveIntensity = 0; m.userData.night = 1.3; }       // lit at night (bus lamps ...)
      else if (s.emit) { m.emissive.copy(m.color); m.emissiveIntensity = 0; m.userData.glow = s.emit; m.userData.flash = s.flash || null; }   // lamps / light bars
      return m;
    });
    geo.userData.mats = list.length === 1 ? list[0] : list;
    return geo.userData.mats;
  },
  setSlots(mat, slots) { for (const k in slots) mat.userData.uSlots.value[k].set(slots[k]); },

  /* Static mesh for an asset (shared geometry + given material). */
  mesh(name, lod, mat) {
    const g = this.geo(name, lod); if (!g) return null;
    const m = new THREE.Mesh(g, mat || this.shared('default'));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  },
  shared(key, opts) {
    if (!this.mats.has(key)) this.mats.set(key, this.material(opts));
    return this.mats.get(key);
  },
  /* Skinned character: builds a fresh bone hierarchy for this instance (geometry is shared).
     Bones are placed at the exported joint heads with identity rest rotations (game space),
     so procedural animation can set local quaternions directly. */
  skinned(name, lod, mat) {
    const g = this.geo(name, lod); if (!g || !g.userData.bones) return null;
    const defs = g.userData.bones;
    const bones = [], byName = {};
    for (const d of defs) { const b = new THREE.Bone(); b.name = d.name; bones.push(b); byName[d.name] = b; }
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i], b = bones[i];
      if (d.parent && byName[d.parent]) {
        const pd = defs.find((x) => x.name === d.parent);
        b.position.set(d.head[0] - pd.head[0], d.head[1] - pd.head[1], d.head[2] - pd.head[2]);
        byName[d.parent].add(b);
      } else b.position.set(d.head[0], d.head[1], d.head[2]);
      b.userData.rest = b.position.clone();
      b.userData.tail = new THREE.Vector3(d.tail[0] - d.head[0], d.tail[1] - d.head[1], d.tail[2] - d.head[2]);
    }
    const mesh = new THREE.SkinnedMesh(g, mat);
    const roots = bones.filter((b) => !b.parent);
    roots.forEach((r) => mesh.add(r));
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true; mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    return { mesh, bones: byName, list: bones, socks: g.userData.socks, defs };
  },
};

/* ------------------------------------------------------------------ instanced batches with slot allocation
   One InstancedMesh per (asset, lod, material); chunks/agents allocate and free slots.
   Freed slots are swapped with the last live instance to keep the draw range compact. */
TL.InstanceBatch = class {
  constructor(scene, geo, mat, capacity, opts) {
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = !(opts && opts.noShadow); this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.cap = capacity; this.owners = new Array(capacity);
    this.hasColor = !!(opts && opts.color);
    if (this.hasColor) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
  }
  alloc(owner, matrix, color) {
    if (this.mesh.count >= this.cap) return -1;
    const i = this.mesh.count++;
    this.owners[i] = owner;
    owner.idx = i; owner.batch = this;
    this.mesh.setMatrixAt(i, matrix);
    if (color && this.hasColor) this.mesh.setColorAt(i, color);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.hasColor) this.mesh.instanceColor.needsUpdate = true;
    return i;
  }
  set(owner, matrix) { if (owner.batch !== this || owner.idx < 0) return; this.mesh.setMatrixAt(owner.idx, matrix); this.mesh.instanceMatrix.needsUpdate = true; }
  color(owner, c) { if (owner.batch !== this || owner.idx < 0 || !this.hasColor) return; this.mesh.setColorAt(owner.idx, c); this.mesh.instanceColor.needsUpdate = true; }
  free(owner) {
    if (owner.batch !== this || owner.idx < 0) return;
    const i = owner.idx, last = this.mesh.count - 1;
    if (i !== last) {
      this.mesh.getMatrixAt(last, this._m); this.mesh.setMatrixAt(i, this._m);
      if (this.hasColor) { const c = new THREE.Color(); this.mesh.getColorAt(last, c); this.mesh.setColorAt(i, c); }
      const o = this.owners[last]; this.owners[i] = o; o.idx = i;
    }
    this.owners[last] = null; this.mesh.count--; owner.idx = -1; owner.batch = null;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.hasColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.mesh); this.mesh.dispose(); }
};
