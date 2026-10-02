/* =====================================================================================
   GLIDE — web wings, deploy sequence, wing-tip vortex trails.
   Reference: Marvel's Spider-Man 2 wing glide (first seconds): at the top of the jump both hands go overhead, the
   arms are thrown out wide, a web wing snaps open between each arm and the body (white strand grid, translucent
   film), the hero tips forward into a fast glide, wing tips throw off thin white vapour streaks.

   Pieces (all visual — physics lives in 04_physics.js startGlide / glideForces, hero.glide.t = seconds since opening):
     TL.glidePose / glideRootPitch / glideStiff   the pose sequence (clap overhead -> arms thrown out -> glide -> bank/dive/flare)
     TL.Membranes (replaces the old flat triangles)   two procedural web wings spanning shoulder-elbow-wrist and body-ankle
     TL.GlideFX                                   shock ring + fibre burst on opening, wing-tip vortex trails
   ===================================================================================== */
'use strict';

/* ------------------------------------------------------------------ pose */
TL.glideRootPitch = function (hero) {
  const g = hero.glide;
  // upright (tipping a little back from the pop) -> prone, head-first along the flight path
  return TL.lerp(0.3, Math.PI / 2 - 0.25 - g.pitch, TL.smooth(0.16, 0.8, g.t));
};
TL.glideStiff = function (rig, hero) {
  const t = hero.glide.t;
  if (t < 0.6) for (const s of ['L', 'R']) { rig.boneStiff['uarm' + s] = 34; rig.boneStiff['farm' + s] = 34; rig.boneStiff['hand' + s] = 30; }
};
/* model space: +X = character left, +Y up, +Z forward. returns {spineLean, spineTwist, headBack} */
TL.glidePose = function (an, hero, put, D, flut) {
  const g = hero.glide, t = g.t, rig = an.rig;
  const sm = TL.smooth;
  const rl = TL.clamp(g.roll, -1, 1);
  const sweep = TL.clamp((-g.pitch - 0.15) / 0.7, 0, 1);      // diving: arms swept back
  const flare = TL.clamp((g.pitch - 0.08) / 0.5, 0, 1);       // pulling up: arms forward / up, wings catch the air
  const wA = 1 - sm(0.08, 0.17, t);                           // hands overhead
  const wC = sm(0.28, 0.46, t);                               // settled glide
  const wB = Math.max(0, 1 - wA - wC);                        // arms thrown out wide
  const bob = Math.sin(an.t * 2.3) * 0.03 + Math.sin(an.t * 5.1 + 1) * 0.015;
  const mix = (a, b, c) => a.clone().multiplyScalar(wA).addScaledVector(b, wB).addScaledVector(c, wC).normalize();
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', bank = rl * s * 0.3, k = s > 0 ? 1 : 3;
    const uA = D(0.3 * s, 1, 0.08), fA = D(-0.38 * s, 1, 0.1);                       // clap overhead
    const uB = D(s, 0.28, 0.22), fB = D(s, 0.22, 0.16);                              // thrown wide
    const uC = D(s, 0.05 + bank + bob + flare * 0.22, -0.1 - sweep * 0.55 + flare * 0.3);
    const fC = D(s, 0.02 + bank * 0.7 + bob * 1.4 + flare * 0.15, -0.2 - sweep * 0.5 + flare * 0.2);
    put('uarm' + L, flut(mix(uA, uB, uC), k)); put('farm' + L, flut(mix(fA, fB, fC), k + 1));
    // legs: knees tucked under the clap, then together and trailing; sway against the bank
    const sw = -rl * 0.1;
    const thA = D(0.12 * s, -1, 0.1), shA = D(0.1 * s, -0.8, -0.6);
    const thC = D(0.1 * s + sw, -1, -0.1 - sweep * 0.1), shC = D(0.08 * s + sw, -1, -0.28 - sweep * 0.1);
    const lw = 1 - wC;
    put('thigh' + L, thC.clone().lerp(thA, lw).normalize()); put('shin' + L, shC.clone().lerp(shA, lw).normalize());
    put('foot' + L, D(0, -0.8, 0.55));
  }
  rig.hipsOffT.set(0, 0, 0);
  return {
    spineLean: TL.lerp(0.05, -0.1 + flare * 0.15 + sweep * 0.1, wC), spineTwist: -rl * 0.18 * wC,
    headBack: TL.lerp(0.1, 0.35, sm(0.1, 0.5, t)),
  };
};

/* ------------------------------------------------------------------ web wing texture */
TL.WebTexture = function () {
  const N = 1024, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d');
  x.clearRect(0, 0, N, N);
  x.fillStyle = 'rgba(132,158,204,0.5)'; x.fillRect(0, 0, N, N);              // the film between the strands (reads against a bright sky)
  x.lineCap = 'round';
  const K = 8, J = 11;                                                          // spokes (along the wing), rings (across)
  const arcs = (xs, lw, col, sag) => {
    x.lineWidth = lw; x.strokeStyle = col;
    for (let k = 0; k < K; k++) {
      const y0 = k / K * N, y1 = (k + 1) / K * N;
      x.beginPath(); x.moveTo(xs, y0); x.quadraticCurveTo(xs - sag, (y0 + y1) / 2, xs, y1); x.stroke();
    }
  };
  // fine secondary strands
  x.strokeStyle = 'rgba(255,255,255,0.4)'; x.lineWidth = 2.4;
  for (let k = 0; k < K; k++) { const y = (k + 0.5) / K * N; x.beginPath(); x.moveTo(0, y); x.lineTo(N, y); x.stroke(); }
  for (let j = 0; j < J; j++) arcs(Math.pow((j + 0.5) / J, 0.9) * N, 2.4, 'rgba(255,255,255,0.4)', 14);
  // main strands: spokes + catenary rings (each ring sags toward the apex between spokes, like a real orb web)
  x.strokeStyle = 'rgba(255,255,255,1)'; x.lineWidth = 10;
  for (let k = 0; k <= K; k++) { const y = k / K * N; x.beginPath(); x.moveTo(0, y); x.lineTo(N, y); x.stroke(); }
  for (let j = 1; j <= J; j++) arcs(Math.pow(j / J, 0.9) * N, 7, 'rgba(255,255,255,1)', 50 * (0.4 + j / J));
  // glints at the strand crossings
  x.fillStyle = 'rgba(255,255,255,1)';
  for (let j = 1; j <= J; j++) for (let k = 1; k < K; k++) { x.beginPath(); x.arc(Math.pow(j / J, 0.9) * N, k / K * N, 6, 0, 7); x.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
};

/* ------------------------------------------------------------------ web wings (replace the flat glide triangles) */
TL.Membranes = class {
  constructor(scene, color) {
    this.NS = 16; this.NV = 8;
    const per = (this.NS + 1) * (this.NV + 1), total = per * 2;
    this.pos = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2), idx = [];
    for (let w = 0; w < 2; w++) for (let i = 0; i <= this.NS; i++) for (let j = 0; j <= this.NV; j++) {
      const n = w * per + i * (this.NV + 1) + j; uv[n * 2] = i / this.NS; uv[n * 2 + 1] = j / this.NV;
      if (i < this.NS && j < this.NV) { const a = n, b = n + 1, c = n + this.NV + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.tex = TL.WebTexture();
    this.web = new THREE.MeshStandardMaterial({ map: this.tex, emissiveMap: this.tex, emissive: 0xffffff, emissiveIntensity: 0.16, color: 0xf2f6fc,
      transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.55, metalness: 0 });
    // the outfit code colours `mat`; the web stays white with a hint of the outfit accent
    this.mat = { color: { set: (c) => { this.web.color.set(0xf2f6fc).lerp(new THREE.Color(c), 0.08); } } };
    this.mesh = new THREE.Mesh(g, this.web); this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.amount = 0; this.sp = { x: 0, v: 0 }; this.t = 0; this.owner = null;
    this._A = []; this._B = []; for (let i = 0; i <= this.NS; i++) { this._A.push(new THREE.Vector3()); this._B.push(new THREE.Vector3()); }
    this._n = new THREE.Vector3(); this._u = new THREE.Vector3(); this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
  }
  /* polyline a->b->c sampled at NS+1 points by arc length */
  _path(a, b, c, out, ext) {
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c), L = l1 + l2 || 1;
    for (let i = 0; i <= this.NS; i++) {
      const d = i / this.NS * ext * L;
      if (d <= l1) out[i].lerpVectors(a, b, l1 > 1e-6 ? d / l1 : 0); else out[i].lerpVectors(b, c, l2 > 1e-6 ? (d - l1) / l2 : 0);
    }
  }
  update(dt, pts, show) {
    dt = Math.min(dt, 0.05); this.t += dt;
    const hero = this.owner && this.owner._hero, g = hero ? hero.glide : null;
    const gt = g ? g.t : 9;
    const dodge=hero?.reference?.action;
    const fold=dodge?.kind==='wing_dodge'?Math.sin(Math.PI*TL.clamp(dodge.t/dodge.duration,0,1)):0;
    const target = show && gt > 0.15 ? 1-.82*fold : 0;
    const k = target ? 130 : 280, c = target ? 9 : 34, sp = this.sp;      // underdamped when opening: snaps open and overshoots
    for (let n = 0; n < 3; n++) { const h = dt / 3; sp.v += (k * (target - sp.x) - c * sp.v) * h; sp.x += sp.v * h; }
    this.amount = TL.clamp(sp.x, 0, 1.4);
    this.mesh.visible = this.amount > 0.02;
    if (!this.mesh.visible) return;
    const ext = TL.clamp(this.amount, 0, 1), over = Math.max(0, this.amount - 1);
    const speed = hero ? hero.vel.length() : 20, spdK = TL.clamp((speed - 12) / 30, 0, 1);
    const dep = Math.exp(-Math.max(0, gt - 0.15) * 2.2);
    const E = { L: pts.elL, R: pts.elR };
    const P = this.pos, NS = this.NS, NV = this.NV, per = (NS + 1) * (NV + 1);
    for (let w = 0; w < 2; w++) {
      const L = w === 0;
      const S = L ? pts.shL : pts.shR, Wr = L ? pts.wrL : pts.wrR, H = L ? pts.hipL : pts.hipR, An = L ? pts.anL : pts.anR;
      const El = E[L ? 'L' : 'R'] || this._q.copy(S).lerp(Wr, 0.5);
      this._path(S, El, Wr, this._A, ext);
      this._path(S, H, An, this._B, ext);
      // wing normal, pointing up in world space (the canopy fills upward)
      this._n.crossVectors(this._p.copy(Wr).sub(S), this._q.copy(An).sub(S)).normalize();
      if (this._n.y < 0) this._n.negate();
      const bil = (0.1 + 0.05 * spdK + 0.2 * over + 0.12 * dep) * 1.0;
      const fl = 0.012 + 0.03 * dep + 0.012 * spdK;
      const wl = Wr.distanceTo(An);
      for (let i = 0; i <= NS; i++) {
        const si = i / NS, a = this._A[i], b = this._B[i];
        const w1 = Math.pow(Math.sin(Math.PI * Math.min(1, si * 1.08)), 0.8);
        const edge = TL.smooth(0.55, 1, si);
        for (let j = 0; j <= NV; j++) {
          const v = j / NV, vEff = v * TL.lerp(0.4, 1, ext);
          const n = w * per + i * (NV + 1) + j;
          const x = TL.lerp(a.x, b.x, vEff), y = TL.lerp(a.y, b.y, vEff), z = TL.lerp(a.z, b.z, vEff);
          const w2 = Math.pow(Math.sin(Math.PI * Math.min(1, vEff)), 0.8);
          const flap = fl * Math.sin(this.t * (15 + speed * 0.25) + si * 7 + v * 4 + w * 1.7) * v * si;
          const off = bil * w1 * w2 * ext + flap;
          // free edge scallops inward between the wrist and the ankle, like strands pulled taut between two anchors
          const sc = 0.1 * Math.sin(Math.PI * v) * edge * wl;
          P[n * 3] = x + this._n.x * off + (S.x - Wr.x) / (Wr.distanceTo(S) + 1e-4) * sc;
          P[n * 3 + 1] = y + this._n.y * off + (S.y - Wr.y) / (Wr.distanceTo(S) + 1e-4) * sc;
          P[n * 3 + 2] = z + this._n.z * off + (S.z - Wr.z) / (Wr.distanceTo(S) + 1e-4) * sc;
        }
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
  dispose(scene) { scene.remove(this.mesh); }
};

/* Elbows and the animator hand-off: HeroAnimator.update is wrapped so the wings know their owner/hero and get elbow points. */
(() => {
  const upd = TL.HeroAnimator.prototype.update;
  TL.HeroAnimator.prototype.update = function (dt, hero, bodyPos, cam) {
    this._hero = hero;
    if (!this._glideWired) { this._glideWired = true; this.membranes.owner = this; this.glideFx = new TL.GlideFX(this.scene); }
    upd.call(this, dt, hero, bodyPos, cam);
    this.glideFx.update(dt, this, hero);
  };
})();

/* ------------------------------------------------------------------ opening burst + wing-tip vortex trails */
TL.GlideFX = class {
  constructor(scene) {
    this.scene = scene;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xe4f2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.visible = false; this.ring.frustumCulled = false; scene.add(this.ring); this.rt = 9;
    // trails: per wing tip, a straight core line and two helices (wing-tip vortices)
    this.N = 40; this.tips = [];
    for (let side = 0; side < 2; side++) {
      const t = { hist: [], lines: [], acc: 0 };
      for (let k = 0; k < 3; k++) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3));
        const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        l.frustumCulled = false; l.visible = false; scene.add(l); t.lines.push(l);
      }
      this.tips.push(t);
    }
    this.pt = 9; this.vis = 0; this.t = 0;
    this._v = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._d = new THREE.Vector3();
  }
  fire(an, hero) {
    const v = this._v.copy(hero.vel), sp = v.length() || 1; v.divideScalar(sp);
    this.ring.position.copy(an.meshPos).addScaledVector(new THREE.Vector3(0, 1, 0), 0.9);
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v);
    this.rt = 0; this.ring.visible = true;
    const P = TL.game && TL.game.particles;
    if (P) {
      const r = this._r.crossVectors(v, new THREE.Vector3(0, 1, 0)); if (r.lengthSq() < 1e-4) r.set(1, 0, 0); r.normalize();
      const u = this._u.crossVectors(r, v).normalize();
      const o = an.meshPos;
      for (let i = 0; i < 64; i++) {                       // fibres thrown outward as the web catches the air, left trailing behind
        const a = Math.random() * Math.PI * 2, out = 3 + Math.random() * 6, c = Math.cos(a), s = Math.sin(a);
        P.emit(o.x + (r.x * c + u.x * s) * 0.5, o.y + 1 + (r.y * c + u.y * s) * 0.5, o.z + (r.z * c + u.z * s) * 0.5,
          (r.x * c + u.x * s) * out + hero.vel.x * 0.45, (r.y * c + u.y * s) * out + hero.vel.y * 0.45, (r.z * c + u.z * s) * out + hero.vel.z * 0.45,
          0.4 + Math.random() * 0.35, 0.035 + Math.random() * 0.05, 0.92, 0.96, 1, 0.5, 0, 2.2, 1.2);
      }
    }
  }
  update(dt, an, hero) {
    this.t += dt;
    const g = hero.glide, inGlide = hero.state === TL.TS.GLIDE;
    if (inGlide && g.t < this.pt) this.fire(an, hero);
    this.pt = inGlide ? g.t : 9;
    // shock ring
    if (this.rt < 1) {
      this.rt += dt / 0.5;
      const u = TL.clamp(this.rt, 0, 1), e = 1 - (1 - u) * (1 - u) * (1 - u);
      this.ring.scale.setScalar(0.6 + 2.6 * e); this.ring.material.opacity = 0.4 * (1 - u) * (1 - u);
      this.ring.position.addScaledVector(hero.vel, dt * 0.35);
      if (u >= 1) this.ring.visible = false;
    }
    // vortex trails
    const speed = hero.vel.length();
    const want = inGlide && g.t > 0.3 ? TL.smooth(30, 52, speed) * 0.45 : 0;
    this.vis = TL.damp(this.vis, want, want > this.vis ? 6 : 10, dt);
    const N = this.N;
    for (let side = 0; side < 2; side++) {
      const tp = this.tips[side], hand = an.handWorld[side ? 'R' : 'L'];
      tp.acc += dt;
      if (this.vis > 0.02 && tp.acc > 1 / 50) {
        tp.acc = 0; tp.hist.unshift(hand.clone()); if (tp.hist.length > N) tp.hist.pop();
      } else if (this.vis <= 0.02 && tp.hist.length) { tp.hist.pop(); tp.hist.pop(); }
      const n = tp.hist.length, show = this.vis > 0.02 && n > 2;
      const right = this._r.set(1, 0, 0).applyQuaternion(an.rootQ), up = this._u.set(0, 1, 0).applyQuaternion(an.rootQ);
      for (let k = 0; k < 3; k++) {
        const l = tp.lines[k]; l.visible = show; if (!show) continue;
        const pa = l.geometry.attributes.position.array, ca = l.geometry.attributes.color.array;
        for (let i = 0; i < N; i++) {
          const h = tp.hist[Math.min(i, n - 1)], f = i / (N - 1), r = k === 0 ? 0 : 0.015 + 0.11 * f, ph = i * 0.62 + this.t * 6 + (k === 2 ? Math.PI : 0) + side * 1.7;
          const cs = Math.cos(ph) * r, sn = Math.sin(ph) * r;
          pa[i * 3] = h.x + right.x * cs + up.x * sn; pa[i * 3 + 1] = h.y + right.y * cs + up.y * sn; pa[i * 3 + 2] = h.z + right.z * cs + up.z * sn;
          const b = Math.pow(1 - f, 1.6) * this.vis * (k === 0 ? 0.9 : 0.55) * (i >= n ? 0 : 1);
          ca[i * 3] = b * 0.9; ca[i * 3 + 1] = b * 0.96; ca[i * 3 + 2] = b;
        }
        l.geometry.attributes.position.needsUpdate = true; l.geometry.attributes.color.needsUpdate = true;
      }
    }
  }
};

/* ------------------------------------------------------------------ wind streaks
   A few soft, broad streaks of air at the screen edges, lying along the flight path so they radiate from the point you are
   heading toward (perspective does the rest). Only at real speed; centre of the screen stays clear. */
TL.GlideWind = class {
  constructor(scene) {
    this.N = 18;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.N * 12); this.col = new Float32Array(this.N * 12);
    const idx = []; for (let i = 0; i < this.N; i++) { const o = i * 4; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.visible = false; scene.add(this.mesh);
    this.s = []; for (let i = 0; i < this.N; i++) this.s.push({ x: 0, y: 0, d: 0, w: 1 }); this.init = false; this.vis = 0;
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._v = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._n = new THREE.Vector3(); this._c = new THREE.Vector3();
  }
  spawn(s, near) {
    const side = Math.random() < 0.5 ? -1 : 1;
    s.x = side * (2.6 + Math.random() * 4.2); s.y = (Math.random() - 0.5) * 5.5;
    s.d = near ? -4 + Math.random() * 40 : 36 + Math.random() * 10; s.w = 0.55 + Math.random() * 0.45;
  }
  update(dt, cam, vel, on) {
    const speed = vel.length();
    this.vis = TL.damp(this.vis, on ? TL.smooth(34, 58, speed) : 0, on ? 3 : 8, dt);
    this.mesh.visible = this.vis > 0.02;
    if (!this.mesh.visible) return;
    if (!this.init) { this.init = true; for (const s of this.s) this.spawn(s, true); }
    cam.getWorldDirection(this._f); this._r.crossVectors(this._f, cam.up).normalize(); this._u.crossVectors(this._r, this._f);
    this._v.copy(vel).normalize();                                  // flight direction
    const P = this.pos, C = this.col, c = cam.position, len = TL.clamp(speed * 0.07, 2.2, 5.5);
    for (let i = 0; i < this.N; i++) {
      const s = this.s[i];
      s.d -= speed * 0.5 * dt;
      if (s.d < -5) this.spawn(s, false);
      // anchor point: camera-relative on the sides, pushed ahead along the camera axis; streak lies along the flight direction
      this._c.copy(c).addScaledVector(this._r, s.x).addScaledVector(this._u, s.y).addScaledVector(this._f, s.d);
      this._a.copy(this._c); this._b.copy(this._c).addScaledVector(this._v, len);      // b is further ahead along the heading, a trails toward the camera
      this._n.subVectors(this._c, c).cross(this._v).normalize();                       // width direction faces the camera
      const wd = 0.1 * (0.6 + Math.max(s.d, 0) * 0.035) * s.w;                                      // broad: widens with distance so it reads on screen
      const fadeIn = TL.smooth(-5, 1.5, s.d) * (1 - TL.smooth(24, 38, s.d)), o = i * 12;
      const al = this.vis * 0.26 * s.w * fadeIn;
      const pts = [this._a, this._a, this._b, this._b], sg = [-1, 1, -1, 1], tail = [0, 0, 1, 1];
      for (let k = 0; k < 4; k++) {
        const q = k < 2 ? this._a : this._b;
        P[o + k * 3] = q.x + this._n.x * wd * sg[k]; P[o + k * 3 + 1] = q.y + this._n.y * wd * sg[k]; P[o + k * 3 + 2] = q.z + this._n.z * wd * sg[k];
        const a = tail[k] ? 0 : al;                                                     // tapers to nothing at the far end
        C[o + k * 3] = a * 0.82; C[o + k * 3 + 1] = a * 0.88; C[o + k * 3 + 2] = a;
      }
      void pts;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true;
  }
};
(() => {
  const upd = TL.CameraRig.prototype.update;
  TL.CameraRig.prototype.update = function (dt, hero) {
    upd.call(this, dt, hero);
    if (this.mode !== 'follow') { if (this._wind) this._wind.mesh.visible = false; return; }
    if (!this._wind) this._wind = new TL.GlideWind(TL.game.scene);
    const S = TL.TS, st = hero.state, sp = hero.vel.length();
    this._wind.update(dt, this.cam, hero.vel, (st === S.GLIDE || st === S.DIVE || (st === S.AIR && sp > 40)) && !(this.settings && this.settings.reducedMotion));
  };
})();
