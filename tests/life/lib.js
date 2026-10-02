'use strict';
/* Shared headless-Chrome helpers for the trees / waterfront / crowd checks (GPU via ANGLE d3d11).
   TL_HARNESS=<dir containing node_modules/puppeteer-core> overrides the default harness location. */
const fs = require('fs'), path = require('path');
const harness = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA, 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer = require(path.join(harness, 'node_modules/puppeteer-core'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(opts) {
  opts = opts || {};
  const html = path.resolve(opts.html || path.join(__dirname, '../../THREADLINE.html'));
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 180000,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + path.join(process.env.TEMP, 'tl_life_profile_' + process.pid)] });
  const p = await b.newPage();
  await p.setViewport({ width: opts.w || 1280, height: opts.h || 720 });
  if (process.env.TL_STACKS) await p.evaluateOnNewDocument(() => { const ce = console.error; console.error = (...a) => ce.apply(console, [...a.map((x) => (x && x.message) || x), new Error().stack.split(String.fromCharCode(10)).slice(2, 9).join(' <- ')]); });
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  p.on('console', async (m) => { if (m.type() === 'error' || m.type() === 'warning') { let t = m.text(); try { const a = await Promise.all(m.args().map((h) => h.evaluate((e) => (e && e.message) || String(e)).catch(() => ''))); t += ' | ' + a.join(' ').slice(0, 300); } catch (e) {} console.log('console.' + m.type(), t.slice(0, 400)); } });
  await p.goto('file:///' + html.split(String.fromCharCode(92)).join('/'), { timeout: 240000 });
  await p.waitForFunction(() => window.TL && TL.game && TL.game.state === 'title', { timeout: 240000 });
  await p.evaluate((q) => {
    document.getElementById('qSel').value = q; document.getElementById('seedIn').value = 'MAN';
    [...document.querySelectorAll('#titleMenu button')].find((x) => x.textContent.startsWith('New Game')).click();
  }, opts.quality || 'high');
  await p.waitForFunction(() => ['play', 'paused'].includes(TL.game.state), { timeout: 240000 });
  await p.evaluate((hour) => {
    const g = TL.game; if (g.ui.modal) g.ui.closeModal(true); g.state = 'play'; g.settings.autoFollow = 0; g.missions.crimeT = 9999;
    g.input.lock = () => {}; clearTimeout(g.input._lockT); g.ui.showResume(false);
    if (g.cityLife) g.cityLife.incidentT = 9999;
    g.env.hour = hour; g.env.forced = 'clear';
  }, opts.hour === undefined ? 14 : opts.hour);
  return { b, p };
}
/* put the hero on the ground at (x,z) and aim the chase camera */
async function stand(p, x, z, yaw, pitch, dist) {
  await p.evaluate((x, z, yaw, pitch, dist) => {
    const g = TL.game, h = g.hero.ctrl;
    const y = (g.streamer.groundAt ? g.streamer.groundAt(x, z) : 0);
    h.teleport(x, y + 1.2, z); h.vel && h.vel.set(0, 0, 0);
    g.rig.yaw = yaw; g.rig.pitch = pitch; if (dist) { g.rig.dist = dist; g.rig.curDist = dist; }
    g.streamer.forceLoadAround(h.pos, 100);
  }, x, z, yaw, pitch, dist);
}
/* detached camera (the hero stays where it is so streaming / crowd focus follow): pos/look are world points */
async function free(p, pos, look, fov) {
  await p.evaluate((pos, look, fov) => {
    const g = TL.game, r = g.rig;
    if (!r._origUpdate) r._origUpdate = r.update.bind(r);
    r._free = { pos, look, fov };
    r.update = function (dt, hero) {
      r._origUpdate(dt, hero);
      const f = r._free; if (!f) return;
      r.cam.position.set(f.pos[0], f.pos[1], f.pos[2]); r.cam.lookAt(f.look[0], f.look[1], f.look[2]);
      if (f.fov && r.cam.fov !== f.fov) { r.cam.fov = f.fov; r.cam.updateProjectionMatrix(); }
      r.cam.updateMatrixWorld(true);
    };
  }, pos, look, fov || 60);
}
async function unfree(p) { await p.evaluate(() => { const r = TL.game.rig; r._free = null; r.cam.fov = 60; r.cam.updateProjectionMatrix(); }); }
module.exports = { open, stand, free, unfree, sleep, puppeteer };
