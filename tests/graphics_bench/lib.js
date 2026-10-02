/* THREADLINE graphics bench harness (hardware Chrome via ANGLE/D3D11).
   - seeded Math.random + the game's own rAF loop stopped; the harness drives tick(1/60) itself, so every build sees the
     same simulation state for the same script
   - scenes are camera poses chosen in the scan map (seed MAN), quality 'high', pixel ratio 1 */
'use strict';
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const HARNESS = 'C:/Users/PRIYAN~1/AppData/Local/Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness';
const puppeteer = require(path.join(HARNESS, 'node_modules/puppeteer-core'));
// three's object UUIDs draw from Math.random: give them their own stream so renderer-side object creation (a new material,
// a render target...) never shifts the game's seeded simulation between builds
const THREE_JS = fs.readFileSync(path.join(HARNESS, 'node_modules/three/build/three.min.js'), 'utf8').replace(/4294967295\*Math\.random\(\)/g, '4294967295*__uuidRand()');

async function launch(opts = {}) {
  const W = opts.w || 1600, H = opts.h || 900;
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: opts.headless ? 'new' : false, protocolTimeout: 600000,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--window-size=' + (W + 16) + ',' + (H + 140)],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); if (opts.log) console.log('[page]', m.text()); });
  await page.setRequestInterception(true);
  page.on('request', (r) => r.url().includes('/three@') ? r.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/javascript', body: THREE_JS }) : r.continue());
  await page.evaluateOnNewDocument(() => {
    let s = 0x2545F491;           // mulberry32: deterministic Math.random for every build
    let u = 0x1234567; window.__uuidRand = () => { u = (u * 1103515245 + 12345) >>> 0; return u / 4294967296; };
    Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    try { localStorage.clear(); } catch (e) {}
  });
  return { browser, page };
}

/* boot the build, start seed MAN at the given quality, stop the game's rAF loop (the harness renders) */
async function start(page, html, quality = 'high') {
  if (process.env.PRE) await page.evaluateOnNewDocument((c) => { window.__preStart = new Function(c); }, process.env.PRE);
  await page.goto(pathToFileURL(path.resolve(html)).href);
  await page.waitForFunction(() => window.__TL && TL.game && TL.game.state === 'title', { timeout: 180000, polling: 500 });
  await page.evaluate(async (quality) => {
    const g = TL.game;
    window.__raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;               // game loop stops after its next frame
    await new Promise((r) => setTimeout(r, 100));
    TL.Input.prototype.lock = function () {};
    g.settings.quality = quality; g.settings.showFps = false;
    await TL.ScanData.load();
    if (window.__preStart) window.__preStart();
    g.startGame({ seed: 'MAN' });
    if (g.ui.modal) g.ui.closeModal(true);
    g.state = 'play';
    for (const e of [...document.body.children]) if (e !== g.renderer.domElement && e.tagName !== 'SCRIPT') e.style.display = 'none';
    g.renderer.domElement.style.display = 'block';
    g.resize();
  }, quality);
  await installBenchApi(page);
}

async function installBenchApi(page) {
  await page.evaluate(() => {
    const g = TL.game, r = g.renderer, gl = r.getContext();
    const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const px = new Uint8Array(4);
    const mc = new MessageChannel(), waiters = []; mc.port1.onmessage = () => { const w = waiters.shift(); if (w) w(); };
    const yieldTask = () => new Promise((res) => { waiters.push(res); mc.port2.postMessage(0); });
    const B = window.BENCH = {
      gl, tq,
      sync() { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); },
      /* simulate n fixed steps (no input) */
      sim(n, dt = 1 / 60) { for (let i = 0; i < n; i++) { g.state = 'play'; g.tick(dt); } },
      setFilter(style, level) { TL.Comic.style = style; TL.Comic.level = level; },
      pose: null,
      applyPose() { const P = B.pose; if (!P) return; g.camera.position.set(P.cam[0], P.cam[1], P.cam[2]); g.camera.lookAt(P.at[0], P.at[1], P.at[2]); g.camera.fov = P.fov || 68; g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(); },
      render() { B.applyPose(); TL.Comic.render(r, g.scene, g.camera); },
      /* uncapped throughput: n renders back to back, one readPixels sync at the end (CPU submit + GPU) */
      throughput(n) { B.render(); B.render(); B.sync(); const t0 = performance.now(); for (let i = 0; i < n; i++) B.render(); B.sync(); return (performance.now() - t0) / n; },
      /* GPU time of fn() via TIME_ELAPSED queries; returns sorted ms list */
      async gpuTime(fn, n) {
        const qs = [];
        for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(tq.TIME_ELAPSED_EXT); qs.push(q); B.sync(); }
        const out = [];
        for (const q of qs) {
          let k = 0; while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && k++ < 500) await new Promise((res) => setTimeout(res, 20));
          if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(q);
        }
        return out.sort((a, b) => a - b);
      },
      /* interleaved A/B/C timing under sustained load: fns = {name: fn}; each round runs every fn once (order rotates),
         each wrapped in its own TIME_ELAPSED query, no CPU<->GPU sync inside the run (GPU stays at boost clocks).
         Returns {name: {gpu: stats, cpu: stats}} — cpu = JS submit time of fn (no GPU wait). */
      async interleave(fns, rounds = 40, warm = 60) {
        const names = Object.keys(fns), first = fns[names[0]];
        for (let i = 0; i < warm; i++) { for (const k of names) fns[k](); B.sync(); }
        if (gl.isContextLost()) throw new Error('webgl context lost');
        B.sync();
        const qs = [], cpu = {}; for (const k of names) cpu[k] = [];
        for (let r = 0; r < rounds; r++) {
          for (let j = 0; j < names.length; j++) {
            const k = names[(j + r) % names.length];
            const q = gl.createQuery(); const t0 = performance.now();
            gl.beginQuery(tq.TIME_ELAPSED_EXT, q); fns[k](); gl.endQuery(tq.TIME_ELAPSED_EXT);
            cpu[k].push(performance.now() - t0); qs.push([k, q]);
          }
          B.sync();                                 // ~5 frames in flight max: never near the 2 s Windows TDR
          if (r % 4 === 3) await yieldTask();
        }
        B.sync();
        if (gl.isContextLost()) throw new Error('webgl context lost');
        const gpu = {}; for (const k of names) gpu[k] = [];
        let disjoint = 0;
        { const last = qs[qs.length - 1][1]; let n = 0; while (!gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE) && n++ < 500) await new Promise((res) => setTimeout(res, 20)); }
        for (const [k, q] of qs) {
          let n = 0; while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && n++ < 50) await new Promise((res) => setTimeout(res, 20));
          gpu[k].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
        }
        if (gl.getParameter(tq.GPU_DISJOINT_EXT)) disjoint = 1;
        const out = {}; for (const k of names) out[k] = { gpu: B.stats(gpu[k]), cpu: B.stats(cpu[k]) };
        out._disjoint = disjoint;
        return out;
      },
      stats(a) { a = a.slice().sort((x, y) => x - y); const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))]; return { n: a.length, med: +q(0.5).toFixed(3), p10: +q(0.1).toFixed(3), p90: +q(0.9).toFixed(3), p99: +q(0.99).toFixed(3), mean: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3) }; },
      /* pixels of the canvas after one render (for filter-equivalence diffs) */
      grab() { B.render(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); return { w, h, a }; },
      info() { const i = r.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, texs: i.memory.textures, progs: i.programs.length, w: gl.drawingBufferWidth, h: gl.drawingBufferHeight }; },
    };
  });
}

/* scene presets: hero placement + env + camera pose (camera set explicitly, not by the rig) */
const SCENES = require('./scenes.json');
async function setScene(page, name, extra = {}) {
  const S = Object.assign({}, SCENES[name], extra);
  await page.evaluate((S) => {
    const g = TL.game, e = g.env, h = g.hero.ctrl;
    e.hour = S.hour; e.forced = S.rain ? 'rain' : 'clear'; e.weather = e.forced; e.rain = e.rainTarget = S.rain ? 1 : 0; e.wet = S.rain ? 1 : 0; e.weatherT = 1e9; e.dayLen = 1e12;
    h.teleport(S.hero[0], S.hero[1], S.hero[2]); h.vel.set(0, 0, 0);
    if (S.facing !== undefined) h.facing = S.facing;
    BENCH.pose = S.cam ? { cam: S.cam, at: S.at, fov: S.fov } : null;
    e.envT = 999;
  }, S);
  await page.evaluate((n) => BENCH.sim(n), S.settle || 150);
  if (S.chase) await page.evaluate((S) => {     // chase pose: behind/above the hero along yaw, pulled in front of walls
    const g = TL.game, p = g.hero.ctrl.pos, [yaw, dist, up, look] = S.chase;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), hx = p.x, hy = p.y + 0.6, hz = p.z;
    let cx = hx - fx * dist, cy = hy + up, cz = hz - fz * dist;
    const dx = cx - hx, dy = cy - hy, dz = cz - hz, L = Math.hypot(dx, dy, dz);
    const hit = g.world.raycast(hx, hy, hz, dx / L, dy / L, dz / L, L + 0.6);
    if (hit) { const k = Math.max(0.5, hit.t - 0.6) / L; cx = hx + dx * k; cy = hy + dy * k; cz = hz + dz * k; }
    BENCH.pose = { cam: [cx, cy, cz], at: [hx + fx * 25, hy + (look || 1.5), hz + fz * 25], fov: S.fov };
  }, S);
  await page.evaluate(() => { const g = TL.game; g.env.envT = 999; g.env.update(0, g.hero.ctrl.pos); g.env.update(0, g.hero.ctrl.pos); });
}

module.exports = { launch, start, setScene, SCENES };
