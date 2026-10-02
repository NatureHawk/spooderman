/* =====================================================================================
   VFX — RopeRenderer (procedural filament tube: extension, tension straightening, slack sag,
   vibration, corner bends, LOD), ParticleSystem (pooled GPU points), RainSystem, WindStreaks,
   ScanPulse. Particles never allocate in the hot loop.
   ===================================================================================== */
'use strict';

TL.RopeRenderer = class {
  constructor(scene, color, segs, radial) {
    this.segs = segs || 64; this.radial = radial || 5; this.strands=4;
    const strandVerts = (this.segs + 1) * this.radial;
    const vcount = strandVerts*this.strands;
    this.pos = new Float32Array(vcount * 3);
    const idx = [];
    for(let strand=0;strand<this.strands;strand++)for (let i = 0; i < this.segs; i++) for (let k = 0; k < this.radial; k++) {
      const base=strand*strandVerts;
      const a = base+i * this.radial + k, b = base+i * this.radial + (k + 1) % this.radial, c = a + this.radial, d = b + this.radial;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setIndex(idx);
    this.mat = new THREE.MeshStandardMaterial({color:0xeef0ed,emissive:0xeef0ed,emissiveIntensity:.12,roughness:.72,metalness:0});
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.pts = []; for (let i = 0; i <= this.segs; i++) this.pts.push(new THREE.Vector3());
    this.vib = 0; this.vibPhase = 0; this.t = 0;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._n = new THREE.Vector3(); this._bn = new THREE.Vector3(); this._tg = new THREE.Vector3();
    this.radius = .013;
    this.wasActive=false;this.wasAttached=false;this.attachAge=0;this.lastShotT=0;
  }
  pluck(a) { this.vib = Math.min(1, this.vib + a); }
  /* from: wrist, rope: TL.Rope, player pos. extension 0..1 while the line is flying. */
  update(dt, from, rope, extension) {
    this.t += dt;
    if (!rope || !rope.active) { this.hide();this.wasActive=false; return; }
    this.mesh.visible = true;
    if(!this.wasActive||rope.shotT<this.lastShotT){this.wasAttached=false;this.attachAge=0;}
    this.attachAge=rope.attached?(this.wasAttached?this.attachAge+dt:0):0;
    this.wasAttached=rope.attached;this.wasActive=true;this.lastShotT=rope.shotT;
    const S = this.segs;
    // path: wrist -> bends (reverse order) -> anchor
    const path = [from];
    for (let i = rope.bends.length - 1; i >= 0; i--) path.push(rope.bends[i]);
    path.push(rope.anchor);
    let total = 0; const lens = [];
    for (let i = 0; i < path.length - 1; i++) { const l = path[i].distanceTo(path[i + 1]); lens.push(l); total += l; }
    const ext = TL.clamp(extension, 0, 1);
    const slack = rope.attached ? Math.max(0, rope.freeLen() - path[0].distanceTo(path[1])) : 0;
    const taut = rope.attached ? TL.clamp(rope.tension / 60, 0, 1) : 0;
    this.vib = Math.max(0, this.vib - dt * 1.5);
    this.vibPhase += dt * (18 + 30 * taut);
    for (let i = 0; i <= S; i++) {
      const u = (i / S) * ext;
      // locate along polyline
      let d = u * total, seg = 0;
      while (seg < lens.length - 1 && d > lens[seg]) { d -= lens[seg]; seg++; }
      const f = lens[seg] > 1e-5 ? d / lens[seg] : 0;
      const p = this.pts[i].copy(path[seg]).lerp(path[seg + 1], TL.clamp(f, 0, 1));
      // slack sag (parabola, gravity-down) on the first free segment, straightening under tension
      if (seg === 0 && rope.attached) {
        const s = Math.sin(f * Math.PI);
        p.y -= s * Math.min(slack * 0.5, 6) * (1 - taut);
      }
      if (!rope.attached) { const s = Math.sin(u * Math.PI); p.y -= s * 0.4 * (1 - ext); }
      // vibration (plucked string modes)
      const env = Math.sin((i / S) * Math.PI);
      const vib = this.vib * env * 0.25 * Math.sin(this.vibPhase + i * 0.6);
      // A travelling loose coil collapses quickly as the freshly fired web loads.
      // Bend/anchor vertices stay on their actual contact points.
      const settle=rope.attached?Math.exp(-this.attachAge*16):1;
      const ripple=env*Math.sin(f*Math.PI)*(.18*settle+.025*(1-taut));
      this._tg.copy(path[seg+1]).sub(path[seg]).normalize();
      this._n.set(0,1,0);if(Math.abs(this._tg.y)>.9)this._n.set(1,0,0);
      this._bn.crossVectors(this._tg,this._n).normalize();this._n.crossVectors(this._bn,this._tg).normalize();
      const phase=i/S*Math.PI*10-this.t*23;
      p.addScaledVector(this._n,ripple*Math.sin(phase));p.addScaledVector(this._bn,ripple*Math.cos(phase));
      p.x += vib; p.z += vib * 0.5; p.y += vib * 0.3;
    }
    // sweep a small circle along the polyline
    const R = this.radius * (1 + 0.3 * (1 - taut));
    let o = 0;
    for(let strand=0;strand<this.strands;strand++)for (let i = 0; i <= S; i++) {
      const p = this.pts[i];
      const q = this.pts[Math.min(S, i + 1)], pr = this.pts[Math.max(0, i - 1)];
      this._tg.copy(q).sub(pr).normalize();
      if (!Number.isFinite(this._tg.x) || this._tg.lengthSq() < 1e-6) this._tg.set(0, 1, 0);
      this._n.set(0, 1, 0); if (Math.abs(this._tg.y) > 0.9) this._n.set(1, 0, 0);
      this._bn.crossVectors(this._tg, this._n).normalize(); this._n.crossVectors(this._bn, this._tg).normalize();
      // Three fine filaments braid around a tapered core. The irregular lobes
      // catch highlights without making the loaded line a thick glowing cable.
      const u=i/S,phase=u*Math.PI*14+(strand-1)*Math.PI*2/3;
      const envelope=Math.sin(Math.PI*u);
      const spread=strand===0?0:envelope*(.019+.035*(1-taut)+.05*(rope.attached?Math.exp(-this.attachAge*16):1));
      const cn=Math.cos(phase)*spread,cb=Math.sin(phase)*spread;
      const thickness=(strand===0?R:R*.45)*( .82+.18*Math.sin(u*43+strand*2)**2)*( .6+.4*Math.sin(Math.PI*u)**.3);
      for (let k = 0; k < this.radial; k++) {
        const a = (k / this.radial) * Math.PI * 2, c = Math.cos(a) * thickness+cn, s = Math.sin(a) * thickness+cb;
        this.pos[o++] = p.x + this._n.x * c + this._bn.x * s;
        this.pos[o++] = p.y + this._n.y * c + this._bn.y * s;
        this.pos[o++] = p.z + this._n.z * c + this._bn.z * s;
      }
    }
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.computeVertexNormals();
  }
  hide() { this.mesh.visible = false; }
  setColor(c) { const silk=new THREE.Color(0xf1f2ef).lerp(new THREE.Color(c),.08);this.mat.color.copy(silk);this.mat.emissive.copy(silk); }
};

/* ------------------------------------------------------------------ pooled GPU particles */
TL.ParticleSystem = class {
  constructor(scene, max) {
    this.max = max || 3000;
    const g = new THREE.BufferGeometry();
    this.P = new Float32Array(this.max * 3); this.C = new Float32Array(this.max * 4); this.Sz = new Float32Array(this.max);
    this.V = new Float32Array(this.max * 3); this.life = new Float32Array(this.max); this.maxLife = new Float32Array(this.max);
    this.grav = new Float32Array(this.max); this.drag = new Float32Array(this.max); this.size0 = new Float32Array(this.max); this.grow = new Float32Array(this.max);
    g.setAttribute('position', new THREE.BufferAttribute(this.P, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.Sz, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uComicLin: TL.ComicLin },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale / max(0.5, -mv.z); }`,
      fragmentShader: `varying vec4 vC; uniform float uComicLin; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(uComicLin > 0.5 ? pow(vC.rgb, vec3(2.2)) : vC.rgb, vC.a * (1.0 - r*4.0)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.head = 0; this.alive = 0;
    this.normalMat = null;
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a, grav, drag, grow) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.V[i * 3] = vx; this.V[i * 3 + 1] = vy; this.V[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size0[i] = size; this.grow[i] = grow || 0;
    this.C[i * 4] = r; this.C[i * 4 + 1] = g; this.C[i * 4 + 2] = b; this.C[i * 4 + 3] = a;
    this.grav[i] = grav || 0; this.drag[i] = drag || 0;
  }
  burst(p, n, spread, speed, life, size, col, opts) {
    opts = opts || {};
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      let dx = rr * Math.cos(th), dy = u, dz = rr * Math.sin(th);
      if (opts.dir) { dx = dx * spread + opts.dir.x; dy = dy * spread + opts.dir.y; dz = dz * spread + opts.dir.z; }
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.emit(p.x, p.y, p.z, dx * sp, dy * sp + (opts.up || 0), dz * sp, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8),
        col[0], col[1], col[2], opts.alpha || 1, opts.grav || 0, opts.drag || 1.5, opts.grow || 0);
    }
  }
  launchBurst(p, velocity, power) {
    // A low expanding pressure puff, with a narrow wake rising behind the hero.
    for(let i=0;i<42;i++) {
      const angle=i/42*Math.PI*2,r=.25+Math.random()*.35;
      const x=Math.cos(angle),z=Math.sin(angle),sp=(4+Math.random()*4)*power;
      this.emit(p.x+x*r,p.y+.07,p.z+z*r,x*sp,.4+Math.random(),z*sp,.4+Math.random()*.25,
        .28+Math.random()*.2,.88,.91,.94,.22,0,2.5,3.5);
    }
    this.burst(p,18,.35,3,.38,.18,[.92,.96,1],{dir:velocity.clone().normalize(),alpha:.24,up:1,drag:2,grow:2});
  }
  update(dt) {
    const P = this.P, V = this.V, C = this.C;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.Sz[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const dg = Math.exp(-this.drag[i] * dt);
      V[i * 3] *= dg; V[i * 3 + 1] = V[i * 3 + 1] * dg - this.grav[i] * dt; V[i * 3 + 2] *= dg;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      this.Sz[i] = this.size0[i] * (1 + this.grow[i] * (1 - t)) * Math.min(1, t * 4);
      C[i * 4 + 3] = Math.min(C[i * 4 + 3], t * 1.5);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
};

// Brief loose web filaments left at the ledge. They peel away and fade rather
// than keeping a physics rope attached after the arms finish pushing off.
TL.LaunchFX = class {
  constructor(scene) {
    this.t=1;this.duration=.48;this.origin=new THREE.Vector3();this.velocity=new THREE.Vector3();
    this.positions=new Float32Array(2*18*2*3);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3));
    this.mat=new THREE.LineBasicMaterial({color:0xe9f5ff,transparent:true,opacity:0,depthWrite:false});
    this.mesh=new THREE.LineSegments(geometry,this.mat);this.mesh.frustumCulled=false;this.mesh.visible=false;scene.add(this.mesh);
  }
  fire(origin,velocity,reduced) {
    this.origin.copy(origin);this.velocity.copy(velocity);this.t=0;this.reduced=!!reduced;
    this.mesh.visible=true;
  }
  update(dt,hero) {
    this.t+=dt;
    if(this.t>=this.duration||!hero||![TL.TS.AIR,TL.TS.LAUNCH].includes(hero.ctrl.state)) {this.mesh.visible=false;return;}
    const u=this.t/this.duration,p=this.positions;
    this.mat.opacity=(this.reduced?.22:.55)*(1-u)*(1-u);
    let n=0;
    for(const [hand,sgn] of [['L',1],['R',-1]]) {
      const wrist=hero.anim.handWorld[hand],start=this.origin.clone();start.x+=sgn*.26;
      // Detach from the wrist early; the remaining strands recoil into the wake.
      const end=wrist.clone().lerp(start,TL.smooth(.12,.48,this.t)*.65);
      for(let i=0;i<18;i++)for(const f of [i/18,(i+1)/18]) {
        const sag=Math.sin(f*Math.PI);
        p[n++]=TL.lerp(start.x,end.x,f)+sgn*sag*.1*Math.sin(f*28-this.t*22)*u;
        p[n++]=TL.lerp(start.y,end.y,f)-sag*u*.7;
        p[n++]=TL.lerp(start.z,end.z,f)+sag*.08*Math.sin(f*19+this.t*17)*u;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate=true;
  }
};

/* ------------------------------------------------------------------ rain (camera-local line streaks + splashes) */
TL.RainSystem = class {
  constructor(scene, count) {
    this.count = count || 4000;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.count * 6);
    this.seed = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) { this.seed[i * 3] = Math.random() * 80 - 40; this.seed[i * 3 + 1] = Math.random() * 50; this.seed[i * 3 + 2] = Math.random() * 80 - 40; }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.22, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
    // Snow is a separate soft point field, never slowed-down rain streaks.
    this.snowPos = new Float32Array(this.count * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { pixelScale: { value: 540 } },
      vertexShader: `uniform float pixelScale; varying float fade;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.0);
          fade=smoothstep(1.0,4.0,-p.z)*(1.0-smoothstep(22.0,42.0,-p.z));
          gl_PointSize=clamp(pixelScale*0.10/max(1.0,-p.z),1.5,5.0);
          gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying float fade;
        void main(){float d=length(gl_PointCoord-0.5)*2.0;
          float a=(1.0-smoothstep(0.12,1.0,d))*fade*0.48;
          gl_FragColor=vec4(0.82,0.87,0.94,a);}`
    }));
    this.snow.frustumCulled = false; this.snow.visible = false; scene.add(this.snow);
    this.intensity = 0; this.t = 0;
  }
  renderOverlay(renderer, camera, depth) {
    if (!this.overlay) {
      this.overlay = new THREE.Scene();
      const uniforms = { tDepth: { value: depth }, resolution: { value: new THREE.Vector2() }, pixelScale: { value: 540 } };
      const occlude = 'if(gl_FragCoord.z > texture2D(tDepth,gl_FragCoord.xy/resolution).x + 0.000001)discard;';
      const sm = this.snow.material.clone(); sm.uniforms = uniforms; sm.depthTest = false;
      sm.fragmentShader = 'uniform sampler2D tDepth; uniform vec2 resolution;\n' + sm.fragmentShader.replace('void main(){', 'void main(){'+occlude);
      const rm = new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:false,uniforms,
        vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:'uniform sampler2D tDepth; uniform vec2 resolution; void main(){'+occlude+'gl_FragColor=vec4(0.65,0.73,0.82,0.22);}' });
      this.overlaySnow = new THREE.Points(this.snow.geometry,sm);
      this.overlayRain = new THREE.LineSegments(this.mesh.geometry,rm);
      this.overlaySnow.frustumCulled = this.overlayRain.frustumCulled = false;
      this.overlay.add(this.overlaySnow,this.overlayRain);this.overlayUniforms=uniforms;
    }
    this.overlayUniforms.tDepth.value=depth;
    renderer.getDrawingBufferSize(this.overlayUniforms.resolution.value);
    this.overlayUniforms.pixelScale.value=renderer.domElement.height;
    this.overlaySnow.visible=this.snow.visible;this.overlayRain.visible=this.mesh.visible;
    const clear=renderer.autoClear;renderer.autoClear=false;
    try {renderer.render(this.overlay,camera);} finally {renderer.autoClear=clear;}
  }
  update(dt, camPos, wind, intensity, snow = false) {
    this.intensity = intensity;
    this.mesh.visible = !snow && intensity > 0.02;
    this.snow.visible = snow && intensity > 0.02;
    if (!this.mesh.visible && !this.snow.visible) return;
    this.t += dt;
    const n = Math.floor(this.count * TL.clamp(intensity, 0, 1) * (snow ? 0.24 : 1));
    if (snow) {
      const wrap = (v, span) => ((v % span) + span) % span - span * 0.5;
      for(let i=0;i<n;i++){
        const j=i*3, phase=this.seed[j+1], t=this.t;
        this.snowPos[j]=camPos.x+wrap(this.seed[j]+t*wind.x*0.025+Math.sin(t*0.7+phase)*0.7-camPos.x,80);
        this.snowPos[j+1]=camPos.y+wrap(phase-t*(1.2+(i%7)*0.13)-camPos.y,50);
        this.snowPos[j+2]=camPos.z+wrap(this.seed[j+2]+t*wind.z*0.025+Math.cos(t*0.5+phase)*0.5-camPos.z,80);
      }
      this.snow.geometry.setDrawRange(0,n);
      this.snow.geometry.attributes.position.needsUpdate=true;
      const renderer=TL.game&&TL.game.renderer;
      if(renderer)this.snow.material.uniforms.pixelScale.value=renderer.domElement.height;
      return;
    }
    this.mesh.geometry.setDrawRange(0,n*2);
    const P = this.pos, fall = 28, wx = wind.x * 0.08, wz = wind.z * 0.08;
    for (let i = 0; i < n; i++) {
      const sx = this.seed[i * 3], sz = this.seed[i * 3 + 2];
      const y = 25 - ((this.seed[i * 3 + 1] + this.t * fall) % 50);
      const x = camPos.x + ((sx + camPos.x * 0.0) % 80), z = camPos.z + sz;
      P[i * 6] = x; P[i * 6 + 1] = camPos.y + y; P[i * 6 + 2] = z;
      P[i * 6 + 3] = x - wx * 0.35; P[i * 6 + 4] = camPos.y + y + 0.4; P[i * 6 + 5] = z - wz * 0.35;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
};

/* ------------------------------------------------------------------ scan pulse (expanding ring) */
TL.ScanPulse = class {
  constructor(scene) {
    const g = new THREE.RingGeometry(0.95, 1.0, 96); g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.mesh.visible = false; scene.add(this.mesh); this.t = -1;
  }
  fire(p) { this.t = 0; this.mesh.position.copy(p); this.mesh.visible = true; }
  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const r = this.t * 120;
    this.mesh.scale.set(r, 1, r); this.mesh.material.opacity = Math.max(0, 0.8 - this.t * 0.6);
    if (this.t > 1.5) { this.t = -1; this.mesh.visible = false; }
  }
};
