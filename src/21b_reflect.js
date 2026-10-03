/* =====================================================================================
   REFLECTIONS — one shared reflection probe + the API shaders hook into (TL.Render).
     low     nothing here runs (the original sky-only environment map in 16_game.js stays in charge)
     medium  sky probe (64^2 cube of the sky dome) for TL.Render shaders; scene.environment is still the original sky PMREM
     high    scene probe: the sky *and the skyline* captured around the camera (96^2, one face every 6 frames), prefiltered into
             scene.environment, so cars, hero suits, wet streets and roofs reflect buildings and the real time-of-day light
     ultra   128^2 faces every 4 frames; plus screen-space reflections (21c / TL.Post) on water and wet ground
   The probe is scene-referred linear radiance: what the lighting sums to BEFORE exposure and tone mapping (fog included, hero/rain hidden,
   sky alpha = 0 so shaders can tell sky from geometry), i.e. the same convention as the original sky environment map. scene.environment
   is therefore tone-mapped once, by the materials that sample it.

   ---- API for other modules (e.g. the building-glass material) -------------------------------------------------------
   TL.Render.tier                 0 when off, else 1..3 (medium..ultra)
   TL.Render.probe                THREE.WebGLCubeRenderTarget (mip-mapped); .texture is a samplerCube; null until the first update
   TL.Render.envMap               scene.environment as prefiltered by the probe (what MeshStandardMaterial samples), or null
   TL.Render.U                    shared uniforms { tlProbe, tlProbeP }  (plain objects, safe to reuse in any material)
   TL.Render.install(shader, o)   from material.onBeforeCompile( shader ): adds the uniforms and the GLSL below to a fragment shader
                                  (inserted after #include <common>, or at the top when the shader has none). o.defines = true also
                                  injects #define TL_RENDER so you can #ifdef the call.
   GLSL once installed:
     vec4 tlProbeSample(vec3 dirWorld, float roughness)   rgb = scene-referred radiance seen along the world direction (blurred by
                                                           roughness 0..1), a = 1 where the probe saw geometry, 0 where it saw sky
     vec3 tlReflect(vec3 dirWorld, float roughness, vec3 skyFallback)
                                                           for shaders that output scene-referred radiance (MeshStandardMaterial
                                                           patches): skyFallback where the probe saw sky (keep your own analytic sky
                                                           there), the probe where it saw buildings
     vec3 tlReflectDisplay(vec3 dirWorld, float roughness, vec3 skyFallbackDisplay)
                                                           same for shaders that write display values straight to gl_FragColor (the
                                                           sky / water ShaderMaterials): the probe is tone-mapped with the renderer's
                                                           curve (and exposure) first, so it matches the rest of the picture
     Both return the fallback unchanged when the probe is off (tier low/medium), so they are always safe to call.
   Direction convention: world space, reflect(-V, N). The probe sits at the camera, so it is exact for distant geometry
   (skyline in water / glass) and plausible for near surfaces.
   ===================================================================================== */
'use strict';

TL.Render = {
  tier: 0, probe: null,
  U: { tlProbe: { value: null }, tlProbeP: { value: { x: 0, y: 6, z: 1, w: 0 } } },     // P: x on, y max lod, z intensity
  TIERS: [null, { size: 64, mode: 'sky', period: 0 }, { size: 96, mode: 'scene', period: 6 }, { size: 128, mode: 'scene', period: 4 }],
  GLSL: `
uniform samplerCube tlProbe; uniform vec4 tlProbeP;
vec4 tlProbeSample( vec3 d, float rough ) { return textureLod( tlProbe, d, clamp( rough, 0.0, 1.0 ) * tlProbeP.y ); }
vec3 tlReflect( vec3 d, float rough, vec3 skyFallback ) {
  if ( tlProbeP.x < 0.5 ) return skyFallback;
  vec4 p = tlProbeSample( d, rough );
  return mix( skyFallback, p.rgb * tlProbeP.z, p.a );
}
vec3 tlReflectDisplay( vec3 d, float rough, vec3 skyFallback ) {
  if ( tlProbeP.x < 0.5 ) return skyFallback;
  vec4 p = tlProbeSample( d, rough );
#ifdef TONE_MAPPING
  vec3 disp = toneMapping( p.rgb * tlProbeP.z );
#else
  vec3 disp = clamp( p.rgb * tlProbeP.z, 0.0, 1.0 );
#endif
  return mix( skyFallback, disp, p.a );
}`,
  captureFar: 520,                                   // the probe sees 520 m: beyond that it is fog, and the face cost is geometry-bound
  frame: 0, face: 0, _center: new THREE.Vector3(), _hidden: [],
};

TL.Render.install = function (shader, o) {
  Object.assign(shader.uniforms, this.U);
  const decl = (o && o.defines ? '#define TL_RENDER\n' : '') + this.GLSL + '\n';
  if (shader.fragmentShader.includes('#include <common>')) shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + decl);
  else shader.fragmentShader = decl + shader.fragmentShader;
};

Object.defineProperty(TL.Render, 'envMap', { get() { return TL.game && TL.game.scene ? TL.game.scene.environment : null; } });

TL.Render.setTier = function (t) {
  const g = TL.game, hadEnv = !!this.envRT;
  this.tier = t; this.cfg = this.TIERS[t] || null;
  this.U.tlProbeP.value.x = 0;
  // leaving the scene probe (or the whole stack): hand scene.environment back to the original sky-only map (rebuilt next frame)
  if (hadEnv && t < 2 && g && g.scene) { g.scene.environment = null; if (g.env) g.env.envT = 999; }
  if (!t || t < 2) { if (this.envRT) { this.envRT.dispose(); this.envRT = null; } }
  if (!t && this.probe) this.dispose();
  this._ready = false; this.face = 0; this._cycle = false; this._pendingFilter = false;
};
TL.Render.dispose = function () {
  if (this.probe) { this.probe.dispose(); this.probe = null; }
  if (this.captureProbe) { this.captureProbe.dispose(); this.captureProbe = null; }
  if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
  if (this.blurRT) { this.blurRT.dispose(); this.blurRT = null; }
  this.U.tlProbe.value = null; this._ready = false;
};

TL.Render.build = function (r) {
  const size = this.cfg.size;
  if (this.probe && this.probe.width === size) return;
  if (this.probe) this.probe.dispose();
  if (this.captureProbe) this.captureProbe.dispose();
  const make = () => new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  this.probe = make();
  this.captureProbe = this.cfg.mode === 'scene' ? make() : null;
  this.cc = new THREE.CubeCamera(0.3, 2400, this.captureProbe || this.probe);
  this.U.tlProbe.value = this.probe.texture;
  this.U.tlProbeP.value.y = Math.log2(size);
  if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(r);
  this._ready = false; this.face = 0;
};

/* hero visuals, ropes and weather are not part of the world the probe sees */
TL.Render.hide = function (g) {
  const H = this._hidden; H.length = 0;
  const off = (o) => { if (o && o.visible) { o.visible = false; H.push(o); } };
  for (const k in g.heroes || {}) { const h = g.heroes[k]; off(h.sk && h.sk.mesh); off(h.anim && h.anim.arms && h.anim.arms.group); for (const rp of h.ropes || []) off(rp.mesh || rp.line || rp.group); }
  if (g.rain) { off(g.rain.mesh); off(g.rain.snow); }
};
TL.Render.unhide = function () { for (const o of this._hidden) o.visible = true; this._hidden.length = 0; };

/* Complete a coherent cube, then swap the two fixed buffers. Water never samples a
   cube with a mix of old/new camera positions. Prefiltering runs on its own frame. */
TL.Render.publish = function (r, scene) {
  if (this.captureProbe) {
    const old = this.probe; this.probe = this.captureProbe; this.captureProbe = old;
    this.cc.renderTarget = this.captureProbe;
  }
  this.U.tlProbe.value = this.probe.texture;
  this.envRT = this.pmrem.fromCubemap(this.blurCube(r).texture, this.envRT);
  scene.environment = this.envRT.texture;
  this.U.tlProbeP.value.x = 1; this.U.tlProbeP.value.z = 1;
  this._ready = true; this._pendingFilter = false; this._cycle = false; this.face = 0;
  this._publishedAt = performance.now();
  (this._publishedCenter || (this._publishedCenter = new THREE.Vector3())).copy(this._center);
  const env = TL.game && TL.game.env;
  if (env) {
    (this._publishedSun || (this._publishedSun = new THREE.Vector3())).copy(env.skyU.uSunDir.value);
    this._publishedRain = env.rain || 0;
  }
  this.stats = this.stats || { faces: 0, filters: 0, skipped: 0 };
  this.stats.filters++;
};
TL.Render.needsRefresh = function (camera, env, now) {
  return !this._ready || !this._publishedCenter || camera.position.distanceToSquared(this._publishedCenter) > 144
    || !this._publishedSun || this._publishedSun.dot(env.skyU.uSunDir.value) < 0.9997
    || Math.abs((env.rain || 0) - (this._publishedRain || 0)) > 0.1
    || now - (this._publishedAt || 0) > 5000;
};
/* Secondary work shares the shader-streaming budget and adapts only its refresh
   cadence under sustained slow frames; simulation and selected quality stay intact. */
TL.Render.update = function (r, scene, camera) {
  const cfg = this.cfg, g = TL.game, env = g && g.env;
  if (!cfg || !env) return;
  this.build(r); this.frame++;
  const now = performance.now(), P = this.U.tlProbeP.value;
  const perf = TL.Perf, scale = perf ? perf.secondaryScale || 1 : 1;
  const busy = perf && perf.secondaryBusy(g);
  this.stats = this.stats || { faces: 0, filters: 0, skipped: 0 };
  if (cfg.mode === 'sky') {
    if (this._ready && now - (this._skyAt || 0) < 2000 * scale) return;
    if (busy && this._ready) return;
    this.captureSky(r, camera); this._skyAt = now;
    P.x = 1; P.z = 1; this._ready = true;
    return;
  }
  if (this._pendingFilter) {
    // Never combine the last scene capture with six blur draws plus PMREM.
    if (!busy || this.frame - this._pendingFrame > 18) this.publish(r, scene);
    return;
  }
  if (!this._cycle && !this.needsRefresh(camera, env, now)) { this.stats.skipped++; return; }
  const period = cfg.period * scale;
  if (this.frame % period !== 0) return;
  // Bound deferral: a busy streaming corridor still refreshes within a few frames.
  if (busy && (this._deferred = (this._deferred || 0) + 1) < 3) { this.stats.skipped++; return; }
  this._deferred = 0;
  if (!this._cycle) { this._center.copy(camera.position); this._cycle = true; }
  this.captureFace(r, scene, camera, this.face); this.stats.faces++;
  this.face = (this.face + 1) % 6;
  if (this.face === 0) { this._pendingFilter = true; this._pendingFrame = this.frame; }
};

/* the prefiltered environment is built from a 32^2 box-filtered copy of the probe (mip 2): the standard materials' mirror-like wet surfaces,
   bumped by their normal maps, would otherwise sparkle on every building edge of a 128^2 capture */
TL.Render.blurCube = function (r) {
  if (!this.blurRT) {
    this.blurRT = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: THREE.LinearFilter });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uFace: { value: 0 }, uLod: { value: 2 } }, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // GL cube face table (spec 3.8.10): the direction through texel (s, t) of face f
      fragmentShader: `varying vec2 vUv; uniform samplerCube tSrc; uniform float uFace, uLod;
        void main() {
          float s = vUv.x * 2.0 - 1.0, t = vUv.y * 2.0 - 1.0; vec3 d;
          if (uFace < 0.5) d = vec3(1.0, -t, -s); else if (uFace < 1.5) d = vec3(-1.0, -t, s); else if (uFace < 2.5) d = vec3(s, 1.0, t);
          else if (uFace < 3.5) d = vec3(s, -1.0, -t); else if (uFace < 4.5) d = vec3(s, -t, 1.0); else d = vec3(-s, -t, -1.0);
          gl_FragColor = textureLod(tSrc, d, uLod);
        }` });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.blurQuad = new THREE.Mesh(g, this.blurMat); this.blurQuad.frustumCulled = false;
    this.blurScene = new THREE.Scene(); this.blurScene.add(this.blurQuad);
    this.blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  const prev = r.getRenderTarget(), auto = r.autoClear, tm = r.toneMapping;
  this.blurMat.uniforms.tSrc.value = this.probe.texture; this.blurMat.uniforms.uLod.value = Math.max(0, Math.log2(this.probe.width / 32));
  try { r.autoClear = false; r.toneMapping = THREE.NoToneMapping; for (let f = 0; f < 6; f++) { this.blurMat.uniforms.uFace.value = f; r.setRenderTarget(this.blurRT, f); r.render(this.blurScene, this.blurCam); } }
  finally { r.setRenderTarget(prev); r.autoClear = auto; r.toneMapping = tm; }
  return this.blurRT;
};

TL.Render.captureSky = function (r, camera) {
  if (!this.skyScene) {
    this.skyScene = new THREE.Scene();
    const env = TL.game.env;
    this.skyMesh = env.sky.clone(); this.skyMesh.material = env.sky.material; this.skyMesh.frustumCulled = false;
    this.skyScene.add(this.skyMesh);
  }
  const env = TL.game.env, rt = this.probe, prevTarget = r.getRenderTarget(), prevTM = r.toneMapping, prevAuto = r.autoClear;
  this.skyMesh.position.set(0, 0, 0); this.skyMesh.scale.setScalar(1);
  this.cc.position.set(0, 0, 0); this.cc.updateMatrixWorld(true);
  const stars = env.skyU.uStars.value; env.skyU.uStars.value = 0;
  try { r.toneMapping = THREE.NoToneMapping; r.autoClear = true; TL.ComicLin.value = 1; this.cc.update(r, this.skyScene); }
  finally { env.skyU.uStars.value = stars; TL.ComicLin.value = 0; r.toneMapping = prevTM; r.autoClear = prevAuto; r.setRenderTarget(prevTarget); }
};

TL.Render.captureFace = function (r, scene, camera, f) {
  const g = TL.game, env = g.env, rt = this.captureProbe || this.probe, tex = rt.texture, cc = this.cc;
  const prevTarget = r.getRenderTarget(), prevTM = r.toneMapping, prevAuto = r.autoClear, prevShadowAuto = r.shadowMap.autoUpdate, prevShadowDirty = r.shadowMap.needsUpdate;
  const sky = env.sky, sm = sky.material, smBlend = sm.blending, smT = sm.transparent;
  const savedPos = sky.position.clone(), savedScale = sky.scale.x;
  cc.position.copy(this._center); cc.updateMatrixWorld(true);
  const far = Math.min(camera.far, this.captureFar);
  cc.near = 0.3; cc.far = far;
  for (const c of cc.children) { c.near = 0.3; c.far = far; c.updateProjectionMatrix(); }
  this.hide(g);
  // shaders sampling the probe must not have it bound while it is the render target (feedback loop = the draw is dropped)
  if (!this.dummy) this.dummy = new THREE.WebGLCubeRenderTarget(2, { type: THREE.HalfFloatType });
  this.U.tlProbe.value = this.dummy.texture;
  // sky pixels get alpha 0 (colour untouched) so shaders can tell sky from geometry
  sm.blending = THREE.CustomBlending; sm.blendEquation = THREE.AddEquation; sm.blendSrc = THREE.OneFactor; sm.blendDst = THREE.ZeroFactor;
  sm.blendEquationAlpha = THREE.AddEquation; sm.blendSrcAlpha = THREE.ZeroFactor; sm.blendDstAlpha = THREE.ZeroFactor;
  // the dome (r 1500 x the main pass's scale) must sit inside the probe's short far plane, or it is clipped and the probe's
  // sky is the black clear colour: every upward-facing standard material then lights from a black sky (dark roofs / streets)
  sky.position.copy(this._center); sky.scale.setScalar((far * 0.9) / 1500);
  const stars = env.skyU.uStars.value; env.skyU.uStars.value = 0;
  const gm = tex.generateMipmaps; tex.generateMipmaps = f === 5;
  try {
    r.toneMapping = THREE.NoToneMapping; r.autoClear = true; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; TL.ComicLin.value = 1;
    r.setRenderTarget(rt, f); r.render(scene, cc.children[f]);
  } finally {
    tex.generateMipmaps = gm; env.skyU.uStars.value = stars; TL.ComicLin.value = 0;
    sm.blending = smBlend; sm.transparent = smT; sky.position.copy(savedPos); sky.scale.setScalar(savedScale);
    this.unhide(); this.U.tlProbe.value = this.probe.texture;
    r.toneMapping = prevTM; r.autoClear = prevAuto; r.shadowMap.autoUpdate = prevShadowAuto; r.shadowMap.needsUpdate = prevShadowDirty;
    r.setRenderTarget(prevTarget);
  }
};

/* ------------------------------------------------------------------ hooks */
{
  // while the scene probe owns scene.environment (high+), the original sky-only PMREM refresh must not overwrite it
  const updateEnv = TL.Environment.prototype.updateEnv;
  TL.Environment.prototype.updateEnv = function () { if (TL.Render.tier >= 2 && TL.Render._ready) return; updateEnv.call(this); };
  // the Atmosphere water shader reflects the probe's geometry (skyline) on top of its own analytic sky when the probe is on
  const A = TL.Atmos;
  if (A && A.WATER_FRAG) {
    A.WATER_FRAG = A.WATER_FRAG.replace('vec3 refl = tlSky( R, REFL_CLOUDS );', `vec3 refl = tlSky( R, REFL_CLOUDS );
#ifdef TL_PROBE
  refl = tlReflectDisplay( vec3( R.x, max( R.y, 0.035 ), R.z ), 0.03 + 0.12 * uRain, refl );
#endif`).replace('varying vec3 vW;\n', 'varying vec3 vW;\n#ifdef TL_PROBE\n' + TL.Render.GLSL + '\n#endif\n');
  }
}

TL.Render.applyQuality = function (game) {
  const t = TL.Post.TIER[game.quality] || 0;
  this.setTier(t);
  const wm = game.waterMat;
  if (wm && TL.Atmos && wm.fragmentShader === TL.Atmos.WATER_FRAG) {
    const on = t >= 2;
    Object.assign(wm.uniforms, this.U);
    if (!!wm.defines.TL_PROBE !== on) { if (on) wm.defines.TL_PROBE = 1; else delete wm.defines.TL_PROBE; wm.needsUpdate = true; }
  }
};
{
  const apply = TL.Post.apply;
  TL.Post.apply = function (game) { apply.call(this, game); TL.Render.applyQuality(game); };
}
