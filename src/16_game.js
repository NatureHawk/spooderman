/* =====================================================================================
   GAME — bootstrap, Input, fixed-step loop (120 Hz physics + render interpolation),
   renderer/quality, sky + day/night + weather, water, hero ownership/switching, debug overlays,
   physics frame stepping, and a small automation API (window.__TL) used by the test harness.
   ===================================================================================== */
'use strict';

/* ------------------------------------------------------------------ INPUT */
TL.Input = class {
  constructor(game) {
    this.game = game;
    this.keys = new Set(); this.mouse = { dx: 0, dy: 0, buttons: new Set(), wheel: 0 };
    this.pressed = new Set(); this.released = new Set();
    this.locked = false; this.enabled = false;
    this.pad = null; this.padPrev = [];
    this.bindings = TL.Input.defaults();
    this.padBindings = TL.Input.padDefaults();
    this.toggles = {};
    this.rebinding = null;
    this.intent = {
      move: new THREE.Vector3(), moveLocal: { x: 0, y: 0 }, camFwd: new THREE.Vector3(0, 0, 1), camRight: new THREE.Vector3(1, 0, 0),
      jump: false, jumpHeld: false, swing: false, swingPressed: false, dive: false, glideToggle: false, sling: false, slingPressed: false,
      reelIn: 0, reelOut: 0, tether: false, launchTarget: null, sprint: false,
    };
    this.bind();
  }
  static defaults() {
    return {
      moveF: ['KeyW'], moveB: ['KeyS'], moveL: ['KeyA'], moveR: ['KeyD'], jump: ['Space'], swing: ['ShiftLeft', 'ShiftRight'],
      dive: ['ControlLeft', 'ControlRight'], glide: ['KeyZ'], sling: ['KeyX'], attack: ['Mouse0'], aim: ['Mouse2'], dodge: ['KeyQ'],
      parry: ['KeyF'], tether: ['KeyE'], gadget: ['KeyR'], gadgetCycle: ['Tab'], scan: ['KeyC'], heroSwitch: ['KeyV'], map: ['KeyM'],
      photo: ['KeyP'], pause: ['Escape'], reelIn: ['WheelUp'], reelOut: ['WheelDown'], ability1: ['Digit1'], ability2: ['Digit2'],
      ability3: ['Digit3'], ultimate: ['Digit4'], heal: ['KeyH'], finisher: ['KeyG'], lockOn: ['Mouse1', 'KeyL'], citylink: ['KeyK'], ironArms: ['KeyJ'],
      heavy: ['KeyT'], interact: ['KeyE'], spiderJump: ['KeyB'], spiderDash: ['KeyN'], debugPhys: ['F3'], debugPerf: ['F4'], physPause: ['BracketLeft'], physStep: ['BracketRight'], help: ['F1'], routeRestart: ['Backspace'],
    };
  }
  static padDefaults() {
    return { jump: 0, dodge: 1, attack: 2, tether: 3, gadget: 4, parry: 5, aim: 6, swing: 7, map: 8, pause: 9, dive: 10, lockOn: 11, scan: 12, heroSwitch: 13, glide: 14, sling: 15 };
  }
  bind() {
    const kd = (e) => {
      if (this.rebinding) { e.preventDefault(); this.finishRebind(e.code); return; }
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F1' || e.code === 'F3' || e.code === 'F4') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedCode(e.code);
      this.keys.add(e.code);
    };
    const ku = (e) => { this.keys.delete(e.code); this.releasedCode(e.code); };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    // Chromium (esp. on Windows) emits bogus huge movementX/Y when the locked cursor is re-centred or the lock has just
    // (re)started — that is the "camera snaps to a random position" glitch. Drop the first events after a lock and any
    // single event too large to be a real hand movement; clamp the rest.
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const now = performance.now();
      if (now < (this._lockIgnoreUntil || 0)) return;
      let mx = e.movementX || 0, my = e.movementY || 0;
      if (Math.abs(mx) > 900 || Math.abs(my) > 900) return;
      this.mouse.dx += Math.max(-300, Math.min(300, mx)); this.mouse.dy += Math.max(-300, Math.min(300, my));
    });
    window.addEventListener('mousedown', (e) => {
      if (this.rebinding) { e.preventDefault(); this.finishRebind('Mouse' + e.button); return; }
      if (!this.locked) return;
      const c = 'Mouse' + e.button; this.mouse.buttons.add(c); this.pressedCode(c);
    });
    window.addEventListener('mouseup', (e) => { const c = 'Mouse' + e.button; this.mouse.buttons.delete(c); this.releasedCode(c); });
    window.addEventListener('wheel', (e) => { if (this.locked) { const c = e.deltaY < 0 ? 'WheelUp' : 'WheelDown'; this.pressedCode(c); this.mouse.wheel += e.deltaY; } }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    this.game.canvas.addEventListener('mousedown', () => { const g = this.game; if (g.state === 'play' && !this.locked && !g.photoMode) this.lock(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.game.canvas;
      if (!this.locked) { this.pendingSwingHand = null; this.clearEdges(this.intent); this.mouse.buttons.clear(); }
      this._lockIgnoreUntil = performance.now() + 120; this.mouse.dx = 0; this.mouse.dy = 0;
      if (this.locked) this.game.ui.showResume(false);
      if (!this.locked && this.game.state === 'play' && !this.game.ui.modalOpen() && !this.game.photoMode) this.game.pause(true);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons.clear(); if (this.game.state === 'play') this.game.pause(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.game.state === 'play') this.game.pause(true); });
    window.addEventListener('gamepadconnected', (e) => { this.pad = e.gamepad.index; this.game.ui && this.game.ui.toast('Gamepad connected: ' + e.gamepad.id.slice(0, 30)); });
  }
  lock() {
    // browsers refuse pointer lock from an Escape keypress (and briefly after exiting); fall back to click-to-resume
    const g = this.game;
    // raw (unaccelerated) movement avoids the OS cursor-warp artefacts; older browsers reject the option -> plain lock
    try {
      let p; try { p = g.canvas.requestPointerLock({ unadjustedMovement: true }); } catch (e) { p = g.canvas.requestPointerLock(); }
      if (p && p.catch) p.catch(() => { try { const q = g.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (e) { /* ignore */ } });
    } catch (e) { /* ignore */ }
    clearTimeout(this._lockT);
    this._lockT = setTimeout(() => { if (!this.locked && g.state === 'play' && !g.photoMode) g.ui.showResume(true); }, 350);
  }
  actionOf(code) { const out = []; for (const a in this.bindings) if (this.bindings[a].indexOf(code) >= 0) out.push(a); return out; }
  pressedCode(code) {
    if (this.game.settings.swingMode === 'single' && this.down('swing') && (code === 'Mouse0' || code === 'Mouse2')) {
      this.pendingSwingHand = code === 'Mouse0' ? 'L' : 'R';
      this.pressed.delete('attack'); this.pressed.delete('aim');
      return;
    }
    for (const a of this.actionOf(code)) this.pressed.add(a);
  }
  releasedCode(code) { for (const a of this.actionOf(code)) this.released.add(a); }
  down(action) {
    if ((action === 'attack' || action === 'aim') && this.game.settings.swingMode === 'single' && this.down('swing')) return false;
    const b = this.bindings[action]; if (b) for (const c of b) if (this.keys.has(c) || this.mouse.buttons.has(c)) return true;
    if (this.padDown(action)) return true;
    return false;
  }
  consume(action) { if (this.pressed.has(action)) { this.pressed.delete(action); return true; } return false; }
  peek(action) { return this.pressed.has(action); }
  startRebind(action, cb) { this.rebinding = { action, cb }; }
  finishRebind(code) {
    const r = this.rebinding; this.rebinding = null;
    if (code !== 'Escape') { this.bindings[r.action] = [code]; }
    r.cb && r.cb(code);
  }
  padState() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads(); if (!pads) return null;
    const p = this.pad !== null ? pads[this.pad] : Array.from(pads).find((x) => x);
    return p || null;
  }
  padDown(action) { const p = this.padState(); if (!p) return false; const b = this.padBindings[action]; return b !== undefined && p.buttons[b] && p.buttons[b].pressed; }
  pollPad() {
    const p = this.padState(); if (!p) return;
    for (const a in this.padBindings) {
      const i = this.padBindings[a]; const now = p.buttons[i] && p.buttons[i].pressed; const was = this.padPrev[i];
      if (now && !was) this.pressed.add(a); if (!now && was) this.released.add(a);
    }
    this.padPrev = p.buttons.map((b) => b.pressed);
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const lx = dz(p.axes[2] || 0), ly = dz(p.axes[3] || 0);
    if (lx || ly) this.game.rig.look(lx * 14, ly * 10);
  }
  /* Build the traversal intent from devices + camera basis (called every render frame). */
  buildIntent(rig) {
    const it = this.intent, s = this.game.settings;
    let fx = 0, fy = 0;
    if (this.down('moveF')) fy += 1; if (this.down('moveB')) fy -= 1; if (this.down('moveR')) fx += 1; if (this.down('moveL')) fx -= 1;
    const p = this.padState();
    if (p) { const ax = p.axes[0] || 0, ay = p.axes[1] || 0; if (Math.abs(ax) > 0.15) fx += ax; if (Math.abs(ay) > 0.15) fy -= ay; }
    const ml = Math.hypot(fx, fy); if (ml > 1) { fx /= ml; fy /= ml; }
    it.moveLocal.x = fx; it.moveLocal.y = fy;
    const F = rig.moveFwd || new THREE.Vector3(0, 0, -1), R = rig.right;
    it.move.set(F.x * fy + R.x * fx, 0, F.z * fy + R.z * fx);
    it.camFwd.copy(rig.fwd); it.camRight.copy(R);
    it.jumpHeld = this.down('jump');
    it.singleHand = s.swingMode === 'single' && !this.padDown('swing');
    const swingHold = s.holdToggle && s.holdToggle.swing === 'toggle';
    if (swingHold && !it.singleHand) { if (this.peek('swing')) this.toggles.swing = !this.toggles.swing; it.swing = !!this.toggles.swing; }
    else it.swing = this.down('swing');
    if (it.singleHand && it.swing) { this.pressed.delete('attack'); this.pressed.delete('aim'); }
    it.sprint = this.down('swing') && this.game.hero && this.game.hero.ctrl.state === TL.TS.GROUND;
    it.dive = this.down('dive');
    it.sling = this.down('sling');
    it.reelIn = (this.down('tether') && this.game.hero && this.game.hero.ctrl.state === TL.TS.SWING ? 1 : 0);
    it.reelOut = 0;
    if (this.peek('reelIn')) { it.reelIn = Math.max(it.reelIn, 6); this.pressed.delete('reelIn'); }
    if (this.peek('reelOut')) { it.reelOut = 6; this.pressed.delete('reelOut'); }
    return it;
  }
  /* Edge flags are latched until a physics step consumes them. */
  latchEdges(it) {
    it.spiderJump=it.spiderJump||this.consume('spiderJump');it.spiderDash=it.spiderDash||this.consume('spiderDash');
    if(this.game.hero?.ctrl.state===TL.TS.GLIDE)it.wingDodge=it.wingDodge||this.consume('dodge');
    if(this.game.hero?.ctrl.state===TL.TS.SWING&&Math.abs(it.moveLocal.x)>.4)it.cornerTether=it.cornerTether||this.peek('tether');
    it.jump = it.jump || this.peek('jump');
    if (it.singleHand) {
      if (this.pendingSwingHand && it.swing) { it.swingPressed = true; it.swingHand = this.pendingSwingHand; }
      if (!it.swing) { it.swingPressed = false; it.swingHand = null; }
      this.pendingSwingHand = null;
    } else { it.swingPressed = it.swingPressed || this.peek('swing'); it.swingHand = null; this.pendingSwingHand = null; }
    it.glideToggle = it.glideToggle || this.peek('glide');
    it.slingPressed = it.slingPressed || this.peek('sling');
    it.tether = it.tether || (this.peek('tether') && !(this.game.hero && this.game.hero.ctrl.state === TL.TS.SWING) && !(this.game.ui && this.game.ui.promptActive) && !this.down('aim'));
    this.pressed.delete('jump'); this.pressed.delete('swing'); this.pressed.delete('glide'); this.pressed.delete('sling');
    if (it.tether || it.cornerTether) this.pressed.delete('tether');
  }
  clearEdges(it) { it.spiderJump=false;it.spiderDash=false;it.wingDodge=false;it.cornerTether=false; it.jump = false; it.swingPressed = false; it.swingHand = null; it.glideToggle = false; it.slingPressed = false; it.tether = false; }
  endFrame() {
    this.mouse.dx = 0; this.mouse.dy = 0; this.released.clear();
    // one-frame actions nobody consumed are dropped (physics edges are latched separately)
    for (const a of Array.from(this.pressed)) if (!(a === 'jump' || a === 'swing' || a === 'glide' || a === 'sling' || a === 'tether' || a === 'reelIn' || a === 'reelOut')) this.pressed.delete(a);
  }
};

/* ------------------------------------------------------------------ SKY + LIGHTING + WEATHER */
TL.Environment = class {
  constructor(game) {
    this.game = game; const scene = game.scene;
    this.hour = 16.5; this.dayLen = 24 * 60;     // real seconds per full day (1 min = 1 game hour)
    this.weather = 'clear'; this.rain = 0; this.rainTarget = 0; this.forced = null;
    this.wet = 0; this.weatherT = 240;
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a342c, 0.8); scene.add(this.hemi);
    this.fog = new THREE.Fog(0xc0ccd8, 150, 700); scene.fog = this.fog;
    // sky dome with sun/moon discs and stars
    this.skyU = { uSunDir: { value: new THREE.Vector3() }, uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uNight: { value: 0 }, uMoonDir: { value: new THREE.Vector3() }, uStars: { value: 1 } };
    const skyG = new THREE.SphereGeometry(1500, 32, 16);
    this.sky = new THREE.Mesh(skyG, new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 uSunDir, uMoonDir, uHor, uZen; uniform float uNight, uStars;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){ vec3 d = normalize(vD); float t = clamp(d.y * 1.6, 0.0, 1.0);
          vec3 c = mix(uHor, uZen, pow(t, 0.7));
          float sd = max(dot(d, uSunDir), 0.0);
          c += vec3(1.0,0.85,0.6) * pow(sd, 900.0) * 8.0 * (1.0 - uNight) + vec3(1.0,0.7,0.4) * pow(sd, 8.0) * 0.25 * (1.0 - uNight);
          float md = max(dot(d, uMoonDir), 0.0); c += vec3(0.8,0.85,1.0) * pow(md, 1400.0) * 3.0 * uNight;
          vec3 g = floor(d * 400.0); float s = step(0.9975, h(g)) * uNight * t * uStars; c += vec3(s);
          if (d.y < 0.0) c = mix(uHor, uHor * 0.55, clamp(-d.y * 3.0, 0.0, 1.0));
          gl_FragColor = linearToOutputTexel(vec4(c, 1.0)); }`,
    }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -1;
    scene.add(this.sky);
    this.envT = 999; this.pmrem = null;
    this.state = 'day';
  }
  timeState(h) { return h < 6 || h >= 20.5 ? 'night' : h < 9 ? 'morning' : h < 17 ? 'day' : h < 20.5 ? 'golden' : 'night'; }
  update(dt, focus) {
    const g = this.game;
    this.hour = (this.hour + dt * 24 / this.dayLen) % 24;
    this.state = this.timeState(this.hour);
    // weather transitions (random unless forced by a mission)
    this.weatherT -= dt;
    if (this.forced) { this.weather = this.forced; }
    else if (this.weatherT <= 0) { this.weatherT = 180 + Math.random() * 240; this.weather = this.weatherPicker ? this.weatherPicker() : (Math.random() < 0.3 ? 'rain' : 'clear'); }
    this.rainTarget = this.weather === 'rain' ? 1 : 0;
    this.rain = TL.damp(this.rain, this.rainTarget, 0.25, dt);
    this.wet = TL.damp(this.wet, this.rain > 0.2 ? 1 : 0, this.rain > 0.2 ? 0.2 : 0.05, dt);
    // sun path
    const a = ((this.hour - 6) / 24) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(a) * 0.8, Math.sin(a), 0.35).normalize();
    const night = TL.smooth(0.05, -0.18, sunDir.y);
    const golden = TL.smooth(0.45, 0.05, sunDir.y) * (1 - night);
    this.night = night;
    const hor = new THREE.Color(0xc9d6e2).lerp(new THREE.Color(0xf0a060), golden * 0.8).lerp(new THREE.Color(0x0c1220), night);
    const zen = new THREE.Color(0x4f7fbf).lerp(new THREE.Color(0x4a5a8a), golden * 0.5).lerp(new THREE.Color(0x03050c), night);
    const grey = new THREE.Color(0x7c8590).lerp(new THREE.Color(0x10141c), night);
    hor.lerp(grey, this.rain * 0.7); zen.lerp(grey, this.rain * 0.75);
    this.skyU.uSunDir.value.copy(sunDir); this.skyU.uMoonDir.value.copy(sunDir).multiplyScalar(-1); this.skyU.uHor.value.copy(hor); this.skyU.uZen.value.copy(zen); this.skyU.uNight.value = night;
    this.sky.position.copy(g.camera.position);
    this.sky.scale.setScalar(Math.min(1, (g.camera.far * 0.9) / 1500));   // keep the dome inside the far plane on short render distances
    this.fog.color.copy(hor);
    const rd = g.streamer ? g.streamer.meshRadius : 500;
    this.fog.near = TL.lerp(rd * 0.3, rd * 0.12, this.rain); this.fog.far = TL.lerp(rd * 1.1, rd * 0.6, this.rain) * (1 - night * 0.2);
    // lights
    const sunUp = Math.max(0, sunDir.y);
    this.sun.intensity = (0.2 + 2.6 * TL.smooth(0, 0.25, sunUp)) * (1 - this.rain * 0.6) * (1 - night) + night * 0.35;
    this.sun.color.set(0xfff4e0).lerp(new THREE.Color(0xffa060), golden).lerp(new THREE.Color(0x9fb0ff), night);
    const ld = night > 0.5 ? this.skyU.uMoonDir.value : sunDir;
    this.sun.position.copy(focus).addScaledVector(ld, 300); this.sun.target.position.copy(focus);
    this.hemi.intensity = TL.lerp(0.9, 0.22, night) * (1 - this.rain * 0.3);
    this.hemi.color.copy(zen).lerp(new THREE.Color(0xffffff), 0.4); this.hemi.groundColor.set(0x3a342c).lerp(new THREE.Color(0x0a0a10), night);
    // night 'ISO boost': raise the camera exposure at night so the whole scene is readable but still clearly night;
    // lit windows are divided back down (TL.invExpU) so they keep their original brightness
    const nk = 1 + 3.0 * night;
    g.renderer.toneMappingExposure = (g.expBase || 1) * nk; TL.invExpU.value = 1 / nk;
    // city materials
    if (g.streamer) {
      const U = g.streamer.mats.uniforms;
      U.uNight.value = TL.smooth(0.15, -0.1, sunDir.y); U.uWet.value = this.wet; U.uSkyH.value.copy(hor); U.uSkyZ.value.copy(zen); U.uTime.value += dt;
    }
    if (g.waterU) { g.waterU.uSky.value.copy(zen); g.waterU.uHor.value.copy(hor); g.waterU.uSun.value.copy(sunDir); g.waterU.uNight.value = night; g.waterU.uRain.value = this.rain; g.waterU.uTime.value += dt; }
    // environment map for reflections (throttled)
    this.envT += dt;
    if (this.envT > 4 && g.quality !== 'low') { this.envT = 0; this.updateEnv(); }
  }
  updateEnv() {
    const g = this.game;
    try {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(g.renderer);
      if (!this.envScene) {
        this.envScene = new THREE.Scene(); this.envSky = this.sky.clone(); this.envSky.material = this.sky.material; this.envScene.add(this.envSky);
        // r149 PMREM builds a fresh MeshBasicMaterial for its background box on every fromScene() and disposes it after, which
        // released + relinked that program each update (~0.8 s stall every 4 s). An equivalent material that draws nothing keeps
        // the same program cached; the env map is unchanged.
        const keep = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)), new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false }));
        keep.frustumCulled = false; this.envScene.add(keep);
      }
      this.envSky.position.set(0, 0, 0);
      this.skyU.uStars.value = 0;                 // no stars in reflections (avoids speckled wet surfaces)
      const rt = this.pmrem.fromScene(this.envScene, 0.04);
      this.skyU.uStars.value = 1;
      // dispose the previous PMREM render target as a whole (texture + framebuffer + depth buffer): disposing only its
      // texture leaked a framebuffer + renderbuffer (and the texture's GL object) on every 4 s update
      const old = this.envRT || null;
      if (!old && g.scene.environment && g.scene.environment.dispose) g.scene.environment.dispose();
      g.scene.environment = rt.texture; this.envRT = rt;
      if (old) old.dispose();
    } catch (e) { TL.logError(e, 'env'); }
  }
};

/* ------------------------------------------------------------------ HERO WRAPPER (physics + visuals) */
TL.Hero = class {
  constructor(game, name) {
    this.game = game; this.name = name;
    this.stats = TL.HERO_STATS[name];
    this.ctrl = new TL.HeroController(game.world, this.stats);
    this.ctrl.wind = game.wind;
    this.renderPos = new THREE.Vector3();
    this.mat = TL.Assets.material({ slots: TL.Outfits.slots(name, 0, 0) });
    this.buildVisual();
    this.ropes = [new TL.RopeRenderer(game.scene, name === 'WEAVER' ? 0xd8c8a0 : 0xa8f0ff), new TL.RopeRenderer(game.scene, name === 'WEAVER' ? 0xd8c8a0 : 0xa8f0ff)];
    this.ctrl.onEvent = (e, a, b) => game.onHeroEvent(this, e, a, b);
    this.active = false;
    this.outfit = 0; this.palette = 0;
  }
  buildVisual() {
    const g = this.game;
    const armsRetracted = this.anim?.arms?.retracted || false;
    if (this.anim) { this.anim.dispose(g.scene); g.scene.remove(this.sk.mesh); }
    const lod = g.quality === 'low' || g.quality === 'medium' ? 'mid' : 'hi';
    // user-supplied WEAVER model wears its own textures; PULSE (and any untextured model) keeps the recolourable slot material
    const g0 = TL.Assets.geo(this.name, lod);
    this.textured = !!(g0 && g0.userData.tex);
    this.sk = TL.Assets.skinned(this.name, lod, this.textured ? TL.Assets.texMats(g0) : this.mat);
    g.scene.add(this.sk.mesh);
    this.anim = new TL.HeroAnimator(this.sk, this.name, g.scene, this.mat, g.quality);
    if(this.anim.arms)this.anim.arms.setRetracted(armsRetracted,true);
  }
  setOutfit(o, p) {
    this.outfit = o; this.palette = p; TL.Assets.setSlots(this.mat, TL.Outfits.slots(this.name, o, p));
    if (this.textured) {    // photographic suit: outfit 0 / palette 0 is the model as authored, the rest tint it
      const tint = (o || p) ? new THREE.Color(TL.Outfits.slots(this.name, o, p)[1]).lerp(new THREE.Color(0xffffff), 0.35) : new THREE.Color(0xffffff);
      const ms = [].concat(this.sk.mesh.material); for (const m of ms) m.color.copy(tint);
      if (this.anim && this.anim.arms) this.anim.arms.tint(tint);
    } for (const r of this.ropes) r.setColor(TL.Outfits.ropeColor(this.name, o, p)); if (this.anim) this.anim.membranes.mat.color.set(TL.Outfits.slots(this.name, o, p)[2]);
  }
  setVisible(v) { this.sk.mesh.visible = v; if (this.anim.arms) this.anim.arms.setVisible(v); this.anim.membranes.mesh.visible = v && this.anim.membranes.amount > 0.02; for (const r of this.ropes) if (!v) r.hide(); }
  renderUpdate(dt, alpha) {
    const c = this.ctrl;
    this.renderPos.lerpVectors(c.prevPos, c.pos, alpha);
    this.anim.update(dt, c, this.renderPos, this.game.rig);
    const ropes = c.tether.ropes;
    for (let i = 0; i < 2; i++) {
      const r = ropes[i];
      const hand = this.anim.handWorld[r.hand === 'L' ? 'L' : 'R'];
      const ext = r.attached ? 1 : r.shotDur > 0 ? r.shotT / r.shotDur : 1;
      this.ropes[i].update(dt, hand, r, ext);
    }
  }
};

/* ------------------------------------------------------------------ OUTFITS (cosmetic palettes) */
TL.Outfits = {
  // 4 outfits x 3 palettes per hero; slots: 1 primary, 2 secondary, 3 accent, 4 dark, 5 glow, 6 skin, 7 body
  defs: {
    WEAVER: [
      { name: 'Rescue Rig', pal: [[0x56606e, 0x2e343d, 0xd08a28, 0x17191d, 0xffb030], [0x4a5a4e, 0x2a322c, 0xe0a030, 0x141814, 0xffc040], [0x6a6e76, 0x33363c, 0xc07a20, 0x1a1b1e, 0xff9a20]] },
      { name: 'Night Shift', pal: [[0x22252b, 0x3a3f48, 0xd08a28, 0x0e0f11, 0xffa028], [0x1e2430, 0x343c4c, 0xb8c0cc, 0x0c0e12, 0xffd080], [0x2a2226, 0x40363a, 0xe06040, 0x100c0e, 0xff7040]] },
      { name: 'Hi-Vis Engineer', pal: [[0xd89a20, 0x2e343d, 0x56606e, 0x17191d, 0xfff0a0], [0xe0c030, 0x303438, 0x2a5a8a, 0x121416, 0xffffff], [0xe07030, 0x2c2e32, 0xd0d0d0, 0x141516, 0xffe0a0]] },
      { name: 'Slate Mk.II', pal: [[0x707884, 0x4a5058, 0xffb030, 0x202226, 0xffc860], [0x5c6a78, 0x404a56, 0x40c0ff, 0x1a1e24, 0x60d0ff], [0x7a7068, 0x50483f, 0xd8a050, 0x221e1a, 0xffc070]] },
    ],
    PULSE: [
      { name: 'Conductor', pal: [[0x1d2fa8, 0x14181c, 0xe6472a, 0x0a0c22, 0xff7a4a], [0x1a5a80, 0xc07840, 0xe8e0d0, 0x101418, 0x60d0ff], [0x2a7a5a, 0xa05a30, 0xf0f0e0, 0x121814, 0x80ffb0]] },
      { name: 'Overclock', pal: [[0x14181c, 0x1f6f78, 0xb0673a, 0x08090a, 0x40f0e0], [0x181420, 0x5a2a80, 0xd0a040, 0x0a080c, 0xc080ff], [0x201414, 0x802a2a, 0xe0c080, 0x0c0808, 0xff6060]] },
      { name: 'Copper Line', pal: [[0xb0673a, 0x1f6f78, 0xf0e0c8, 0x2a1c14, 0x60fff0], [0xc08040, 0x305070, 0xf8f0e0, 0x2a2014, 0x80e0ff], [0x9a5a30, 0x2a6a50, 0xe0d8c0, 0x201810, 0xa0ffc0]] },
      { name: 'Street Test', pal: [[0x3a4450, 0x1f6f78, 0xe8e8e8, 0x181c20, 0x40f0e0], [0x505a44, 0x707a30, 0xe8e0c0, 0x1c2016, 0xd0ff60], [0x4a3a50, 0x7a3a6a, 0xf0e0f0, 0x1c1420, 0xff80d0]] },
    ],
  },
  slots(hero, o, p) {
    const d = this.defs[hero][o % 4].pal[p % 3];
    return { 1: d[0], 2: d[1], 3: d[2], 4: d[3], 5: d[4], 6: 0xb9876a, 7: d[0] };
  },
  ropeColor(hero, o, p) { const d = this.defs[hero][o % 4].pal[p % 3]; return new THREE.Color(d[4]).lerp(new THREE.Color(0xffffff), 0.5); },
};

/* ------------------------------------------------------------------ GAME */
TL.Game = class {
  constructor() {
    this.state = 'boot';
    this.settings = TL.defaultSettings();
    this.quality = 'high';
    this.seed = 1337;
    this.physAcc = 0; this.physPaused = false; this.stepOnce = 0;
    this.time = 0; this.frame = 0; this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;
    this.photoMode = false;
    this.heroes = {}; this.hero = null;
    this.switching = false;
    this.hitStop = 0;
    this.progress = null;
  }
  /* ---------------------------------------------------------------- boot */
  async boot() {
    TL.V.init();
    const canvas = document.getElementById('gl');
    this.canvas = canvas;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { throw new Error('WebGL is not available: ' + e.message); }
    if (!renderer.getContext()) throw new Error('WebGL context could not be created');
    this.renderer = renderer;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 2400);
    window.addEventListener('resize', () => this.resize()); this.resize();
    this.ui = new TL.UIManager(this);
    this.save = new TL.SaveManager(this);
    this.save.loadSettings();
    this.ui.bootProgress(0.05, 'Unpacking Blender asset library…');
    await TL.Assets.load((p, m) => this.ui.bootProgress(0.05 + p * 0.8, m));
    this.ui.bootProgress(0.95, 'Ready');
    this.state = 'title';
    this.ui.showTitle();
    this.loop = this.loop.bind(this);
    this.last = TL.now();
    requestAnimationFrame(this.loop);
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.renderer) { this.renderer.setSize(w, h, false); }
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }
  applyQuality(q) {
    this.quality = q; this.settings.quality = q;
    const r = this.renderer;
    const px = { low: 0.7, medium: 0.85, high: 1, ultra: Math.min(2, window.devicePixelRatio || 1) }[q] || 1;
    r.setPixelRatio(px * (q === 'ultra' ? 1 : Math.min(1.25, window.devicePixelRatio || 1)));
    r.shadowMap.enabled = q === 'high' || q === 'ultra';
    if (this.env) { this.env.sun.castShadow = r.shadowMap.enabled; this.env.sun.shadow.mapSize.set(q === 'ultra' ? 4096 : 2048, q === 'ultra' ? 4096 : 2048); }
    const dist = TL.clamp(this.settings.renderDist, 200, q === 'low' ? 360 : q === 'medium' ? 480 : q === 'high' ? 640 : 900);
    if (this.streamer) this.streamer.setQuality(q, dist);
    this.camera.far = dist * 2.2 + 400; this.camera.updateProjectionMatrix();
    this.resize();
  }
  /* ---------------------------------------------------------------- new game / continue */
  startGame(opts) {
    opts = opts || {};
    const data = opts.data || null;
    this.seed = (data && data.seed) || opts.seed || this.seed;
    this.world = new TL.CollisionWorld();
    this.scanMode = this.seed === TL.SCAN_SEED;          // seed MAN: the Lower Manhattan scan instead of the generated city
    this.layout = this.scanMode ? new TL.ScanLayout(TL.ScanData) : new TL.CityLayout(this.seed);
    this.wind = new TL.WindField();
    this.env = new TL.Environment(this);
    this.buildWater();
    this.streamer = this.scanMode ? new TL.ScanWorld(this) : new TL.WorldStreamer(this);
    this.streamer.waterMat = this.waterMat;
    this.applyQuality(this.settings.quality);
    this.rig = new TL.CameraRig(this.camera, this.world); this.rig.settings = this.settings;
    this.input = this.input || new TL.Input(this);
    if (this.settings.bindings) this.input.bindings = Object.assign(TL.Input.defaults(), this.settings.bindings);
    // Upgrade the old J shortcut once; keep intentional new/custom bindings.
    if(this.settings.bindings && !this.settings.bindings.ironArms && this.input.bindings.citylink.includes('KeyJ'))
      this.input.bindings.citylink=this.input.bindings.citylink.map(k=>k==='KeyJ'?'KeyK':k);
    if (this.settings.padBindings) this.input.padBindings = Object.assign(TL.Input.padDefaults(), this.settings.padBindings);
    this.particles = new TL.ParticleSystem(this.scene, 4000);
    this.launchFX = new TL.LaunchFX(this.scene);
    this.rain = new TL.RainSystem(this.scene, 5000);
    this.scan = new TL.ScanPulse(this.scene);
    this.audio = this.audio || new TL.AudioManager(this);
    this.audio.init();
    this.progress = new TL.Progression(this);
    // heroes
    const sp = this.streamer.spawnPoint();
    this.heroes.WEAVER = new TL.Hero(this, 'WEAVER');
    this.heroes.PULSE = new TL.Hero(this, 'PULSE');
    this.heroes.WEAVER.ctrl.teleport(sp.x, sp.y + 0.2, sp.z);
    const pb = this.scanMode ? this.streamer.spawnPoint(true) : { x: 520, y: 40, z: -360 };
    this.heroes.PULSE.homePos = pb;
    this.heroes.PULSE.ctrl.teleport(pb.x, pb.y, pb.z);
    this.setActiveHero('WEAVER', true);
    this.combat = new TL.CombatSystem(this);
    this.ai = new TL.AIManager(this);
    this.crowd = new TL.CrowdManager(this);
    this.traffic = new TL.TrafficManager(this);
    this.missions = new TL.MissionManager(this);
    this.cityLife = new TL.CityLife(this);
    this.motionFeedback = new TL.MotionFeedback(this);
    if (this.scanMode) {       // free roam: no story, activities, caches or ambient crime in the scan (yet)
      this.missions.defs = {}; this.missions.activities = []; this.missions.caches = []; this.missions.feed = [];
      this.missions.crimeT = Infinity; this.ai.ambientT = Infinity;
    }
    if (this.routes) this.routes.exit();
    this.routes = TL.RouteChallenges ? new TL.RouteChallenges(this) : null;   // traversal routes (scan city)
    if (TL.installExtras) { TL.installExtras(this); TL.installWeatherExtras(this); }
    if (!this._catchBus) {
      // a strong web catch: restrained creak and a small camera give (respects reduced motion)
      this._catchBus = true;
      TL.bus.on('hero:catchload', (ctrl, k, hand) => { if (!this.hero || ctrl !== this.hero.ctrl) return; this.audio.sfx('catchload', k, { pan: hand === 'L' ? -0.25 : 0.25 }); this.rig.kickCatch(k); });
    }
    if (data) this.save.apply(data);
    this.streamer.forceLoadAround(this.hero.ctrl.pos, 100);
    this.env.updateEnv();
    this.state = 'play';
    this.ui.showHUD();
    this.input.lock();
    this.audio.resume();
    this.ui.toast(this.scanMode ? 'Lower Manhattan scan — free roam. [F1] controls · [M] map' : 'Welcome to the city. [F1] controls · [M] map · [K] CityLink');
    TL.bus.emit('game:start');
  }
  buildWater() {
    this.waterU = { uTime: { value: 0 }, uSky: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: 0 }, uRain: { value: 0 } };
    const U = this.waterU;
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, THREE.UniformsLib.fog), fog: true,
      vertexShader: `varying vec3 vW; #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(/#include <fog_pars_vertex>/, '\n#include <fog_pars_vertex>\n').replace(/#include <fog_vertex>/, '\n#include <fog_vertex>\n'),
      fragmentShader: `uniform float uTime, uNight, uRain; uniform vec3 uSky, uHor, uSun; varying vec3 vW;
        #include <fog_pars_fragment>
        float n(vec2 p){ return sin(p.x)*cos(p.y); }
        void main(){
          vec2 p = vW.xz * 0.08;
          float t = uTime;
          vec3 V = normalize(cameraPosition - vW);
          float dist = length(cameraPosition - vW);
          float amp = 1.0 / (1.0 + dist * 0.012);          // fade high-frequency waves with distance (no sparkle)
          vec3 N = normalize(vec3(
            amp * (0.12*cos(p.x*2.0 + t*0.9) + 0.06*cos(p.x*5.1 - p.y*3.3 + t*1.7) + 0.05*uRain*sin(p.x*23.0+t*9.0)),
            1.0,
            amp * (0.12*sin(p.y*2.3 + t*0.7) + 0.06*sin(p.y*4.7 + p.x*2.9 + t*1.3) + 0.05*uRain*cos(p.y*21.0+t*8.0))));
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          vec3 refl = mix(uHor, uSky, clamp(R.y*1.5, 0.0, 1.0));
          vec3 deep = mix(vec3(0.03,0.09,0.11), vec3(0.01,0.02,0.035), uNight);
          vec3 c = mix(deep, refl * 0.85, fres * 0.9);
          float sp = pow(max(dot(R, uSun), 0.0), 220.0) * (1.0 - uNight);
          c += vec3(1.0,0.9,0.7) * sp * 3.0;
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
          gl_FragColor = linearToOutputTexel(gl_FragColor);
        }`,
    });
    const g = new THREE.PlaneGeometry(4000, 4000, 1, 1); g.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(g, this.waterMat);
    this.water.position.y = TL.C.WATER_Y;
    this.scene.add(this.water);
  }
  setActiveHero(name, instant) {
    for (const k in this.heroes) { this.heroes[k].active = false; }
    this.hero = this.heroes[name]; this.hero.active = true;
    this.hero.ctrl.assist = this.settings.swingAssist;
    this.heroName = name;
    if (this.ui) this.ui.onHeroChanged(name);
    if (this.rig) { this.rig.smoothT.copy(this.hero.ctrl.pos); this.rig.yaw = this.hero.ctrl.facing + Math.PI; }
    TL.bus.emit('hero:active', name);
  }
  /* hero switch: overview camera flight (~3 s), stream the destination, no loading screen */
  switchHero() {
    if (this.switching || !this.hero) return;
    const other = this.heroName === 'WEAVER' ? 'PULSE' : 'WEAVER';
    const from = this.hero.ctrl.pos.clone(), to = this.heroes[other].ctrl.pos.clone();
    this.switching = true;
    this.heroes[other].ctrl.vel.set(0, 0, 0);
    this.audio.sfx('switch');
    this.rig.startOverview(from, to, () => {
      this.switching = false;
      this.streamer.forceLoadAround(to, 90);          // full detail + colliders where control resumes
      this.setActiveHero(other);
      this.ui.toast('Now playing: ' + other);
    });
  }
  pause(on) {
    if (this.state !== 'play' && this.state !== 'paused') return;
    if (on) { this.state = 'paused'; this.ui.showPause(); this.audio.duck(true); }
    else { this.state = 'play'; this.ui.hidePause(); this.input.lock(); this.audio.resume(); this.audio.duck(false); }
  }
  /* ---------------------------------------------------------------- hero events -> VFX/audio/style */
  onHeroEvent(hero, e, a, b) {
    if (!hero.active) return;
    if (this.routes) this.routes.onHeroEvent(hero, e, a, b);
    const P = this.particles, pos = hero.ctrl.pos;
    switch (e) {
      case 'webshot': this.audio.sfx('thwip', 1, { pan: a.hand === 'L' ? -0.35 : 0.35 }); if (hero.anim) { if (hero.ctrl.singleHandSwing) hero.anim.startWebShot(a); else hero.anim.startAction('shoot', 0.3, a.anchor, a.hand === 'L' ? 1 : -1); } break;
      case 'attach': { this.audio.sfx('attach', a.L, { pan: a.hand === 'L' ? -0.25 : 0.25 });P.burst(a.anchor, 10, 1, 6, 0.4, 0.25, [0.8, 0.9, 1]); hero.ropes[0].pluck(0.6); this.progress.stat('swings'); break; }
      case 'release': this.audio.sfx('release', a); break;
      case 'releaseboost': this.progress.style(20 + a * 20, 'Release boost'); this.audio.sfx('boost'); break;
      case 'launchboost': {
        const perfect=!!(a&&a.perfect),origin=a&&a.point||pos;
        this.progress.style(perfect?65:40,perfect?'Perfect point launch':'Point launch');
        this.audio.sfx('pointpush',perfect?1.15:1,{perfect});this.rig.kickLaunch(perfect);
        this.launchFX.fire(origin,hero.ctrl.vel,this.settings.reducedMotion);
        P.launchBurst(origin,hero.ctrl.vel,perfect?1.2:1);break;
      }
      case 'referenceboost': {
        this.audio.sfx(a==='dodge'?'release':'boost',.65);this.rig.kickCatch(.3);
        if(a!=='dodge'&&a!=='loop')this.launchFX.fire(pos,hero.ctrl.vel,this.settings.reducedMotion);
        break;
      }
      case 'zipgrip': this.audio.sfx('attach',16);hero.ropes.forEach(r=>r.pluck(.4));break;
      case 'zippull': this.audio.sfx('zippull');break;
      case 'pointcatch': this.audio.sfx('pointcatch');P.burst(a,8,1,1.5,.25,.12,[.8,.8,.78],{alpha:.3,up:.3});break;
      case 'pointlaunch': this.audio.sfx('thwip'); break;
      case 'slingfire': {
        this.progress.style(30, 'Slingshot');this.audio.sfx('pointpush',1.1);this.rig.kickLaunch(true);
        const p=pos.clone().setY(pos.y-TL.C.FEET);
        const v=hero.ctrl.vel.clone().add(new THREE.Vector3(Math.sin(hero.ctrl.facing)*24,5,Math.cos(hero.ctrl.facing)*24));
        this.launchFX.fire(p,v,this.settings.reducedMotion);P.launchBurst(p,v,1.15);break;
      }
      case 'sling': this.audio.sfx('thwip'); break;
      case 'land': case 'hardland': this.landFx(hero, a, b); break;
      case 'handplant': {
        const pl = b && b.hands && (b.hands[b.hand] || b.hands.L || b.hands.R);
        this.audio.sfx('plant', a === 'vault2' || a === 'climb' || a === 'mantle' ? 1 : 0.75);
        if (pl) P.burst(pl, 4, 0.4, 1.0, 0.3, 0.07, [0.62, 0.61, 0.58], { alpha: 0.25, up: 0.35 });
        break;
      }
      case 'corner': if (a) this.audio.sfx('wallgrab'); break;   // hands transfer around an outer corner
      case 'wallimpact': this.rig.shake(0.8, 0.3); this.audio.sfx('impact', a); break;
      case 'wall': this.audio.sfx('wallgrab'); break;
      case 'wallleap': this.progress.style(10, 'Wall leap'); break;
      case 'vault': this.progress.style(5, 'Vault'); break;
      case 'skim': P.burst(new THREE.Vector3(pos.x, TL.C.WATER_Y + 0.1, pos.z), 40, 1, 7, 0.9, 0.5, [0.7, 0.85, 0.95], { up: 5, grav: 9 }); this.audio.sfx('splash', 0.5); this.progress.style(15, 'Water skim'); break;
      case 'splash': P.burst(new THREE.Vector3(pos.x, TL.C.WATER_Y + 0.1, pos.z), 60, 1, 9, 1.0, 0.6, [0.7, 0.85, 0.95], { up: 6, grav: 9 }); this.audio.sfx('splash', 1); break;
      case 'waterrecover': this.recoverFromWater(hero); break;
      case 'glide': this.audio.sfx('wingsnap', a); this.rig.kickLaunch(false); this.rig.shake(0.35, 0.22); this.progress.style(8, 'Wing glide'); break;
      case 'noanchor': this.ui.hint('No anchor in reach'); break;
      case 'damage': this.ui.flashDamage(); break;
    }
  }
  /* landing feedback chosen by the landing kind and the surface; called once per physical contact */
  landFx(hero, impact, L) {
    const P = this.particles, pos = hero.ctrl.pos, kind = L ? L.kind : impact > 32 ? 'heavy' : 'crouch';
    const feet = new THREE.Vector3(pos.x, pos.y - TL.C.FEET + 0.02, pos.z);
    const gc = hero.ctrl.groundCol, metal = gc && gc.src === 'rooftop' && gc.hy < 1.2;   // equipment housings: no dust
    const col = L && L.surf === 'roof' ? [0.56, 0.55, 0.52] : [0.6, 0.58, 0.55], dust = metal ? 0 : 1;
    switch (kind) {
      case 'gentle': if (impact > 9) this.audio.sfx('land', impact * 0.6); break;
      case 'run': if (impact > 10 && dust) P.burst(feet, 5, 0.6, 2, 0.35, 0.22, col, { up: 0.6, grav: 3 }); this.audio.sfx('step', 9, { surf: 'ground' }); break;
      case 'narrow': this.audio.sfx('land', impact * 0.45); break;
      case 'crouch': if (dust) P.burst(feet, impact > 15 ? 11 : 6, 1, 3.2, 0.5, 0.3, col, { up: 0.9, grav: 3 }); this.audio.sfx(metal ? 'clank' : 'land', impact); break;
      case 'roll': if (dust) P.burst(feet, 8, 1, 2.6, 0.45, 0.28, col, { up: 0.7, grav: 3 }); this.audio.sfx('land', impact * 0.7); this.audio.sfx('roll', 1); break;
      case 'heavy': this.rig.shake(0.3, 0.22); if (dust) P.burst(feet, 22, 1, 6, 0.7, 0.42, col, { up: 1.6, grav: 6 }); this.audio.sfx('impact', impact); break;
    }
    if (impact > 12 && this.crowd) this.crowd.onHeroLand(pos, impact);
  }
  recoverFromWater(hero) {
    // anchor recovery: find the nearest bank/pier edge and point-launch to it (real geometry)
    const c = hero.ctrl, p = c.pos;
    if (this.scanMode) {
      const l = this.streamer.nearestLand(p, 400);
      if (l && l.d < 90) { c.startPointLaunch({ point: new THREE.Vector3(l.x, l.y, l.z), col: null, d: l.d }); this.ui.hint('Anchor recovery'); }
      else { const sp = this.streamer.spawnPoint(); c.teleport(sp.x, sp.y, sp.z); }
      return;
    }
    let best = null;
    for (const dx of [-1, 1]) {
      const x = dx < 0 ? this.layout.rx0 - 3 : this.layout.rx1 + 3;
      const pt = new THREE.Vector3(x, 0.4, p.z);
      const d = Math.abs(p.x - x);
      if (!best || d < best.d) best = { point: pt, col: null, d };
    }
    if (best && best.d < 90) { c.startPointLaunch(best); this.ui.hint('Anchor recovery'); }
    else { const sp = this.streamer.spawnPoint(); c.teleport(sp.x, sp.y, sp.z); }
  }
  /* ---------------------------------------------------------------- main loop */
  loop(t) {
    requestAnimationFrame(this.loop);
    let dt = (t - this.last) / 1000; this.last = t;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    try {
      if (this.state === 'play' || this.state === 'paused') this.tick(dt);
      else if (this.state === 'title') this.titleTick(dt);
      if (this.renderer && this.scene && this.camera) TL.Comic.render(this.renderer, this.scene, this.camera);
    } catch (e) { TL.logError(e, 'loop'); }
    if (this.input) this.input.endFrame();
    this.frame++;
  }
  titleTick(dt) {
    // slow orbit over an empty scene until the world is generated
    this.time += dt;
  }
  tick(dt) {
    const s = this.settings, playing = this.state === 'play' && !this.photoMode;
    this.rig.settings=s; // save imports/settings reloads may replace the settings object
    const inp = this.input;
    if (playing) {
      inp.pollPad();
      this.rig.look(inp.mouse.dx, inp.mouse.dy);
      this.handleGlobalKeys();
    } else this.handleMenuKeys();
    if (!playing || this.state!=='play') { if(this.photoMode)this.rig.update(dt,this.hero.ctrl); this.audio.update(dt); this.ui.update(dt); return; }
    // hit stop (combat feel)
    let simDt = dt * s.gameSpeed;
    if (this.hitStop > 0) { this.hitStop -= dt; simDt *= 0.08; }
    const hero = this.hero, c = hero.ctrl;
    const it = inp.buildIntent(this.rig);
    // E keeps its traversal meaning everywhere except a visible, reachable rescue.
    if(this.cityLife?.canAssist()&&inp.peek('interact')){it.tether=false;inp.pressed.delete('tether');}
    // point launch target preview
    it.launchTarget = null;
    if (playing && c.state !== TL.TS.SWING && c.state !== TL.TS.GROUND) {
      this._ltT = (this._ltT || 0) + dt;
      if (this._ltT > 0.1) { this._ltT = 0; this._lt = c.tether.findLaunchPoint(c, this.camera.position, this.rig.fwd, 42); }
      it.launchTarget = this._lt;
    } else this._lt = null;
    if (playing) inp.latchEdges(it);
    // fixed-step physics
    if (playing && !this.switching) {
      const step = 1 / TL.C.PHYS_HZ;
      if (this.physPaused) {
        if (this.stepOnce > 0) { this.stepOnce--; c.step(step, it); inp.clearEdges(it); }
        this.physAcc = 0;
      } else {
        this.physAcc += simDt;
        let n = 0;
        while (this.physAcc >= step && n < 12) {
          c.step(step, it); inp.clearEdges(it);
          this.physAcc -= step; n++;
        }
        if (n >= 12) this.physAcc = 0;
      }
      if (this.combat) this.combat.update(simDt, it);
    }
    const alpha = this.physPaused ? 1 : TL.clamp(this.physAcc / (1 / TL.C.PHYS_HZ), 0, 1);
    // inactive hero idles at its last position (kept simulated lightly)
    for (const k in this.heroes) { const h = this.heroes[k]; if (h !== hero) { h.ctrl.prevPos.copy(h.ctrl.pos); } }
    // world systems
    this.wind.update(simDt); this.wind.rain = this.env.rain;
    this.env.update(simDt, hero.renderPos.lengthSq() ? hero.renderPos : c.pos);
    const focus = this.switching && this.rig.overview ? this.camera.position : c.pos;
    this.streamer.update(focus, this.switching ? new THREE.Vector3() : c.vel, dt, this.switching);
    this.motionFeedback.update(simDt);
    this.cityLife.update(simDt);
    if (this.traffic) this.traffic.update(simDt, focus);
    if (this.crowd) this.crowd.update(simDt, focus);
    if (this.ai) this.ai.update(simDt);
    if (this.missions) this.missions.update(simDt);
    if (this.routes) this.routes.update(simDt);
    if (this.partner) this.partner.update(simDt);
    if (this.radio && this.state === 'play') this.radio.update(simDt);
    // visuals
    hero.renderUpdate(simDt, alpha);   // game time: slow-mo and hit stop slow the animation with the physics
    for (const k in this.heroes) { const h = this.heroes[k]; if (h !== hero) { h.renderUpdate(simDt, 1); } }
    this.rig.combatFocus = this.combat && this.combat.focusPoint();
    this.rig.update(dt, { pos: hero.renderPos, vel: c.vel, state: c.state, facing: c.facing, wallN: c.wallN, glide: c.glide,launch:c.launch,feedback:c.feedback,reference:c.reference });
    this.particles.update(simDt);
    this.launchFX.update(simDt,hero);
    this.rain.update(dt, this.camera.position, this.wind.base, this.env.rain * (this.quality === 'low' ? 0.4 : 1));
    this.scan.update(dt);
    this.speedFx(dt);
    this.audio.update(dt);
    this.ui.update(dt);
    if (this.progress) this.progress.update(dt);
    this.time += dt;
  }
  speedFx(dt) {
    const c = this.hero.ctrl, v = c.vel, sp = v.length();
    if (sp > 30 && this.settings.speedEffects>0 && !this.settings.reducedMotion && this.quality !== 'low') {
      this._speedParticles=(this._speedParticles||0)+dt*18*this.motionFeedback.energy*this.settings.speedEffects;
      const n=Math.min(3,Math.floor(this._speedParticles));this._speedParticles-=n;
      for (let k = 0; k < n; k++) {
        const p = this.camera.position;
        this.particles.emit(p.x + (Math.random() - 0.5) * 16 + v.x * 0.25, p.y + (Math.random() - 0.5) * 10 + v.y * 0.25, p.z + (Math.random() - 0.5) * 16 + v.z * 0.25,
          -v.x * 0.1, -v.y * 0.1, -v.z * 0.1, 0.35, 0.05, 0.8, 0.85, 1, 0.35, 0, 0, 3);
      }
    }
    // updraft visualization near the hero
    if(this.quality!=='low'&&Math.random()<.5)for(const field of this.wind.tunnels||[]){
      const p=c.pos.clone().sub(field.start),along=TL.clamp(p.dot(field.axis),0,field.length),nearest=field.start.clone().addScaledVector(field.axis,along);
      if(nearest.distanceTo(c.pos)>65)continue;
      const at=field.start.clone().addScaledVector(field.axis,TL.clamp(along+(Math.random()-.5)*65,0,field.length));
      const angle=Math.random()*Math.PI*2,r=field.radius*.75;
      at.x+=field.axis.z*Math.cos(angle)*r;at.z-=field.axis.x*Math.cos(angle)*r;at.y+=Math.sin(angle)*r;
      this.particles.emit(at.x,at.y,at.z,field.axis.x*25,field.axis.y*25,field.axis.z*25,1.1,.12,.73,.85,.92,.2,0,0,1.2);
    }
    if (this.quality !== 'low' && Math.random() < 0.6) {
      const p = c.pos;
      for (const u of this.wind.updrafts) {
        if (Math.abs(u.x - p.x) + Math.abs(u.z - p.z) > 55) continue;          // only near the hero (reads as noise far away)
        const a = Math.random() * 6.28, r = Math.random() * u.r;
        this.particles.emit(u.x + Math.cos(a) * r, u.h0 + Math.random() * 6, u.z + Math.sin(a) * r, 0, u.s * 0.5, 0, 1.8, 0.14, 0.8, 0.85, 0.9, 0.12, 0, 0.1, 1.5);
      }
    }
  }
  handleGlobalKeys() {
    const inp = this.input, ui = this.ui;
    if (inp.consume('pause')) { this.pause(true); return; }
    if (inp.consume('map')) { ui.openMap(); return; }
    if (inp.consume('citylink')) { ui.openCityLink(); return; }
    if (inp.consume('help')) { ui.openHelp(); return; }
    if (inp.consume('photo')) { this.enterPhotoMode(); return; }
    if (inp.consume('ironArms') && this.hero.anim.arms) {
      const arms=this.hero.anim.arms;arms.setRetracted(!arms.retracted);
    }
    if (inp.consume('heroSwitch')) this.switchHero();
    if (inp.consume('scan')) this.doScan();
    if (inp.consume('debugPhys')) { this.settings.debugPhysics = !this.settings.debugPhysics; }
    if (inp.consume('debugPerf')) { this.settings.debugPerf = !this.settings.debugPerf; }
    if (inp.consume('physPause')) { this.physPaused = !this.physPaused; ui.toast(this.physPaused ? 'Physics paused — ] steps one tick' : 'Physics running'); }
    if (inp.consume('physStep')) { this.physPaused = true; this.stepOnce++; }
  }
  handleMenuKeys() {
    const inp = this.input; if (!inp) return;
    if (inp.consume('pause')) { if (this.photoMode) this.exitPhotoMode(); else if (this.ui.modalOpen()) this.ui.closeModal(); else this.pause(false); }
  }
  doScan() {
    this.scan.fire(this.hero.ctrl.pos.clone().setY(this.hero.ctrl.pos.y - 0.9));
    this.audio.sfx('scan');
    this.ui.scanReveal(this.hero.ctrl.pos);
  }
  enterPhotoMode() {
    this.photoMode = true; this.state = 'paused';
    this.rig.enterPhoto(this.hero.ctrl);
    this.ui.openPhoto();
  }
  exitPhotoMode() { this.photoMode = false; this.rig.mode = 'follow'; this.ui.closePhoto(); this.state = 'play'; this.input.lock(); }
};

/* ------------------------------------------------------------------ BOOT */
TL.start = function () {
  window.addEventListener('error', (e) => TL.logError(e.error || e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => TL.logError(e.reason, 'promise'));
  if (typeof THREE === 'undefined') { TL.fatal('Three.js failed to load from the CDN. Check your internet connection and reload.'); return; }
  // proper colour management: hex colours are sRGB and converted to the linear working space
  if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
  const g = new TL.Game();
  TL.game = g;
  window.__TL = TL;
  g.boot().catch((e) => { TL.logError(e, 'boot'); TL.fatal(e.message || String(e)); });
};
TL.fatal = function (msg) {
  const el = document.getElementById('fatal');
  if (el) { el.style.display = 'flex'; el.querySelector('.msg').textContent = msg; }
};
