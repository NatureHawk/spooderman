/* =====================================================================================
   PERFORMANCE — keeps the merged v2 features from stalling the game (loads after 21b_reflect.js).
   1. Reflection probe sees only the big static scenery (NYC buildings, scan tiles, ground, landmarks, quay walls, water,
      sky, lights). It used to draw every pedestrian, car, prop and instanced kit a second time per face, each in its own
      shader variant (a render target means no tone mapping + linear output = a different program), so new materials
      compiled mid-game and every face cost a full scene. Small or moving things are a few pixels in a 96–128 px cube anyway.
   2. Warm-up while the loading screen is still shown (game:start) and right after a quality change: the main pass,
      a full probe cube and one frame through the post stack are rendered once, so their shader programs compile
      before play instead of as multi-second freezes in the first seconds.
   ===================================================================================== */
'use strict';

TL.Perf = {
  PROBE_LAYER: 5,
  secondaryScale: 1, frameMs: 16.7, _slow: 0, _fast: 0,
  // Real requestAnimationFrame intervals, supplied by Game.loop. Ignore tab returns
  // and debugger pauses; require sustained pressure and slow recovery to avoid pumping.
  observeFrame(dt) {
    if (!(dt > 0) || dt > 0.25) return;
    const ms = dt * 1000;
    this.frameMs += (ms - this.frameMs) * 0.04;
    if (this.frameMs > 27) { this._slow++; this._fast = 0; }
    else if (this.frameMs < 21) { this._fast++; this._slow = 0; }
    else { this._slow = Math.max(0, this._slow - 1); this._fast = 0; }
    if (this._slow > 45) { this.secondaryScale = this.frameMs > 42 ? 3 : 2; this._slow = 0; }
    if (this._fast > 180) { this.secondaryScale = Math.max(1, this.secondaryScale - 1); this._fast = 0; }
  },
  secondaryBusy(g) {
    return !!(g && g.streamer && g.streamer.lowRender && g.streamer.lowRender.preparedThisFrame > 0);
  },
  probeMinRadius: 20,                                  // metres: static meshes at least this big are probe scenery
  /* put the probe-worthy objects on the probe layer (cheap; re-run every full cube so streamed tiles join) */
  tagProbe(g) {
    const L = this.PROBE_LAYER, minR = this.probeMinRadius;
    g.scene.traverse((o) => {
      if (o.__tlProbe !== undefined) { if (o.__tlProbe) o.layers.enable(L); return; }
      let on = false;
      if (o.isLight) on = true;
      else if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.geometry) {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const bs = o.geometry.boundingSphere;
        on = !!bs && bs.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) >= minR && (o.matrixAutoUpdate === false || o.frustumCulled === false);
      }
      if (g.env && o === g.env.sky) on = true;
      if (g.water && o === g.water) on = true;
      if (o.material && o.material === g.waterMat) on = true;
      o.__tlProbe = on;
      if (on) o.layers.enable(L);
    });
  },
  probeCameras() {
    const R = TL.Render; if (!R || !R.cc) return;
    for (const c of R.cc.children) c.layers.set(this.PROBE_LAYER);
  },
  /* laptops with two GPUs: Chrome often draws WebGL on the integrated one even though the game asks for high
     performance (3-4x slower here). Say so once per session, with the fix. */
  gpuHint(g) {
    if (this._hinted || !g || !g.renderer) return;
    try {
      const gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      this.gpu = name;
      if (/Intel|UHD|Iris|Radeon\(TM\) Graphics|Vega \d+ Graphics/i.test(name) && g.quality !== 'low') {
        this._hinted = true;
        g.ui.toast('Running on integrated graphics (' + name.replace(/^ANGLE \(|\(0x.*$/g, '').trim() + '). If your PC has a gaming GPU: Windows Settings › Display › Graphics › Chrome › High performance, then restart Chrome — about 3x the frame rate.');
      }
    } catch (e) { /* no debug info: skip */ }
  },
  /* compile + first-use everything while the loading screen is up */
  warm(g) {
    if (!g || !g.renderer || !g.scene || !g.camera) return;
    const r = g.renderer, t0 = performance.now();
    try {
      g.scene.updateMatrixWorld(true);
      r.compile(g.scene, g.camera);
      const R = TL.Render;
      if (R && R.cfg && R.cfg.mode === 'scene') {
        R.build(r);
        this.tagProbe(g); this.probeCameras();
        R._center.copy(g.camera.position);
        for (let f = 0; f < 6; f++) R.captureFace(r, g.scene, g.camera, f);
        // the first full cube replaces scene.environment with the probe's prefiltered map, whose size differs from the
        // sky map's: every standard material gets a new shader key then. Do that swap now and compile against it.
        R.publish(r, g.scene);
        r.compile(g.scene, g.camera);
        for (let f = 0; f < 6; f++) R.captureFace(r, g.scene, g.camera, f);
        R.face = 0;
      }
      TL.Comic.render(r, g.scene, g.camera);           // post stack passes (bloom, AO, grade, shafts) on their first use
      r.compile(g.scene, g.camera);
    } catch (e) { TL.logError(e, 'warm'); }
    console.log('[perf] warm-up ' + (performance.now() - t0).toFixed(0) + ' ms, ' + r.info.programs.length + ' shader programs');
  },
};

{
  const R = TL.Render;
  if (R && R.captureFace) {
    const capture = R.captureFace;
    R.captureFace = function (r, scene, camera, f) {
      const g = TL.game;
      if (f === 0 || !this.__tagged) { TL.Perf.tagProbe(g); this.__tagged = true; }
      TL.Perf.probeCameras();
      return capture.call(this, r, scene, camera, f);
    };
  }
  TL.bus.on('game:start', () => { TL.Perf.warm(TL.game); TL.Perf.gpuHint(TL.game); });
  const aq = TL.Game.prototype.applyQuality;
  TL.Game.prototype.applyQuality = function (q) {
    aq.call(this, q);
    if (this.state === 'play' || this.state === 'paused') TL.Perf.warm(this);
  };
}
