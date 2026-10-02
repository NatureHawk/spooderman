/* Traversal routes in the real game (seed MAN). Run: node tests/routes_browser.js
   Checkpoint clearance against the loaded city colliders, start prompt + [E], countdown freeze, pause does
   not advance time, restart, finish -> results modal, PB saved to localStorage and restored on Continue,
   exit cleans up. Uses the GPU (d3d11) because the scan city is too large for SwiftShader. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), { pathToFileURL } = require('url');
const harness = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA, 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer = require(path.join(harness, 'node_modules/puppeteer-core'));
const GAME = process.env.GAME || path.join(__dirname, '../THREADLINE.html');
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, protocolTimeout: 900000,
    userDataDir: path.join(__dirname, '.browser-profile-routes'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 960, height: 540 }); await page.setRequestInterception(true);
    page.on('request', (r) => r.url().includes('/three@') ? r.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/javascript', body: fs.readFileSync(path.join(harness, 'node_modules/three/build/three.min.js')) }) : r.continue());
    const boot = async (cont) => {
      await page.goto(pathToFileURL(GAME).href, { timeout: 300000 });
      await page.waitForFunction(() => window.__TL && window.__TL.game.state === 'title', { timeout: 300000 });
      await page.evaluate(async (cont) => {
        const TL = window.__TL, g = TL.game; TL.Input.prototype.lock = function () {};
        await TL.ScanData.load(); g.startGame(cont ? { data: g.save.load() } : { seed: 'MAN' }); window.requestAnimationFrame = () => 0;
      }, cont);
    };
    await boot(false);
    await page.evaluate(() => { try { localStorage.removeItem('threadline_save_v1'); } catch (e) {} });
    // 1) geometry: every checkpoint is in free space; zones and perches sit above a real surface
    const geo = await page.evaluate(() => {
      const g = TL.game, W = g.world, C = TL.Contact, out = [];
      for (const d of g.routes.defs) for (const [i, c] of d.cps.entries()) {
        const pts = [[c.x, c.y, c.z]];
        if (c.kind === 'gate') { const px = -c.n[1], pz = c.n[0]; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = c.r * 0.7; pts.push([c.x + px * Math.cos(a) * r, c.y + Math.sin(a) * r, c.z + pz * Math.cos(a) * r]); } }
        const cands = C.gather(W, c.x - c.r - 1, c.z - c.r - 1, c.x + c.r + 1, c.z + c.r + 1);
        let blocked = 0; for (const p of pts) if (cands.some((col) => col.solid && C.sphereIn(col, p[0], p[1], p[2], 0.3))) blocked++;
        const down = c.kind !== 'gate' ? W.raycast(c.x, c.y, c.z, 0, -1, 0, 3, (q) => q.solid, null, {}) : null;
        out.push({ route: d.id, i, kind: c.kind, centerFree: blocked === 0 || (c.kind === 'gate' && blocked <= 1), blocked, support: c.kind === 'gate' ? true : !!down });
      }
      return out;
    });
    for (const r of geo) { assert(r.centerFree, r.route + ' checkpoint ' + r.i + ' intersects city geometry (' + r.blocked + ' samples)'); assert(r.support, r.route + ' zone ' + r.i + ' has no surface under it'); }
    console.log('PASS ' + geo.length + ' checkpoints across ' + new Set(geo.map((g) => g.route)).size + ' routes are in free space; zones sit on real surfaces');
    // 2) start prompt, countdown, run, pause, restart, finish, PB
    const flow = await page.evaluate(() => {
      const g = TL.game, R = g.routes, d = R.defs[0], h = g.hero.ctrl, step = (n, dt) => { for (let i = 0; i < n; i++) { g.state = g.state === 'paused' ? 'paused' : 'play'; g.tick(dt || 1 / 60); g.input.endFrame(); } };
      h.teleport(d.start.x + 1, d.start.y + TL.C.FEET + 0.05, d.start.z); h.fsm.set(TL.TS.GROUND); h.grounded = true;
      step(10);
      const prompt = document.getElementById('prompt').textContent;
      g.input.pressed.add('interact'); step(1);
      const started = !!R.active, frozen = h.frozen, markers = R.marks.length;
      step(120); const stillCounting = R.active.phase === 'countdown' && R.active.time === 0;
      step(80); const running = R.active.phase === 'run' && !h.frozen;
      step(60); const t1 = R.active.time;
      g.pause(true); step(120); const tPaused = R.active.time;
      g.pause(false); step(30); const tResumed = R.active.time;
      // restart mid-run
      R.active.k = 2; R.active.score.add('launch', 200, 'x'); R.restart();
      const rs = { time: R.active.time, k: R.active.k, bonus: R.active.score.bonus, phase: R.active.phase, markers: R.marks.length, frozen: h.frozen };
      step(200);
      // finish quickly by placing the hero on each checkpoint in order through the real update
      for (const c of d.cps) {
        const p = new THREE.Vector3(c.x, c.y, c.z);
        if (c.kind === 'gate') { R.active.prev.set(c.x - c.n[0] * 2, c.y, c.z - c.n[1] * 2); h.pos.set(c.x + c.n[0] * 2, c.y, c.z + c.n[1] * 2); }
        else { h.pos.copy(p); }
        h.frozen = true; R.update(1 / 60); h.frozen = false;
      }
      const res = R.lastResult, modal = document.querySelector('#modals .modal h2');
      return { prompt, started, frozen, markers, stillCounting, running, t1, tPaused, tResumed, rs, res: res && { t: res.t, medal: res.medal, total: res.total }, modal: modal && modal.textContent,
        stored: (() => { try { return JSON.parse(localStorage.getItem('threadline_save_v1')).routes; } catch (e) { return null; } })() };
    });
    assert(/Start route: Rooftop Flow/.test(flow.prompt), 'start prompt: ' + flow.prompt);
    assert(flow.started && flow.frozen && flow.markers === 6 && flow.stillCounting && flow.running);
    assert(flow.t1 > 0.9 && Math.abs(flow.tPaused - flow.t1) < 1e-9, 'pausing does not advance route time (' + flow.t1 + ' -> ' + flow.tPaused + ')');
    assert(flow.tResumed > flow.tPaused, 'time continues after resume');
    assert(flow.rs.time === 0 && flow.rs.k === 0 && flow.rs.bonus === 0 && flow.rs.phase === 'countdown' && flow.rs.markers === 6 && flow.rs.frozen, 'restart clears state');
    assert(flow.res && /COMPLETE/.test(flow.modal || ''), 'results modal shown');
    assert(flow.stored && flow.stored.best && flow.stored.best.rooftop_flow, 'PB written through the save system');
    console.log('PASS start prompt, countdown freeze, pause-safe timer, restart, results modal, PB saved', JSON.stringify(flow.res));
    // 3) Continue: the PB comes back
    await boot(true);
    const back = await page.evaluate(() => TL.game.routes.best);
    assert.deepEqual(back.rooftop_flow, flow.stored.best.rooftop_flow);
    console.log('PASS personal best restored after reload / Continue', JSON.stringify(back.rooftop_flow));
    // 4) exit cleans up; free roam has no route state
    const ex = await page.evaluate(() => { const g = TL.game, R = g.routes; R.begin(R.defs[1]); R.exit(); return { active: !!R.active, marks: R.marks.length, frozen: g.hero.ctrl.frozen, hud: document.getElementById('routeHud').style.display, starts: R.startMarks.every((s) => s.g.visible) }; });
    assert(!ex.active && ex.marks === 0 && !ex.frozen && ex.hud === 'none' && ex.starts);
    console.log('PASS exit removes markers / HUD and unfreezes; start markers return');
    assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => TL.errors), []);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
