'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert');
const { pathToFileURL } = require('url');
const harness = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer = require(path.join(harness, 'node_modules/puppeteer-core'));
(async () => {
  console.log('Starting browser check');
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, userDataDir: path.join(__dirname, '.browser-profile'), timeout: 30000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => {errors.push(e.message);console.log('PAGE ERROR',e.message);});
    await page.setViewport({ width: 1200, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().includes('/three@')) req.respond({ status: 200, headers: {'access-control-allow-origin':'*'}, contentType: 'application/javascript', body: fs.readFileSync(path.join(harness, 'node_modules/three/build/three.min.js')) });
      else req.continue();
    });
    console.log('Loading game');
    await page.goto(pathToFileURL(path.join(__dirname, '../THREADLINE.html')).href, { timeout: 120000 });
    await page.waitForFunction(() => window.__TL && window.__TL.game.state === 'title', { timeout: 30000 });
    console.log('Game ready; checking both hands');
    const result = await page.evaluate(() => {
      const TL=window.__TL;
      const g = TL.game;
      TL.Input.prototype.lock = function () {};
      g.startGame({ seed: 12345 }); g.physPaused = true;
      const h = g.hero.ctrl, i = g.input;
      h.teleport(0, 150, 0); h.vel.set(0, 0, 15);
      g.world.addStatic(24, 170, 20, 7, 40, 30, 0, { kind: 'building' });
      g.world.addStatic(-24, 170, 20, 7, 40, 30, 0, { kind: 'building' });
      g.rig.fwd.set(0, 0, 1); g.rig.right.set(-1, 0, 0);
      i.keys.add('ShiftLeft'); i.pressedCode('ShiftLeft'); i.latchEdges(i.buildIntent(g.rig));
      const noShiftShot = !i.intent.swingPressed;
      const shots = [];
      for (const button of ['Mouse0', 'Mouse2']) {
        i.pressedCode(button); const it = i.buildIntent(g.rig); i.latchEdges(it);
        h.step(1 / 120, it); i.clearEdges(it);
        for (let k = 0; k < 30; k++) { h.step(1 / 120, it); g.hero.renderUpdate(1 / 120, 1); }
        const r = h.tether.main;
        shots.push({ hand: r.hand, attached: r.attached, anchorX: r.anchor.x, finite: Object.values(g.hero.anim.handWorld).every(TL.finite3), attacks: i.peek('attack') });
      }
      // Leave a readable side view for visual inspection of the loaded wrist and balancing arm.
      g.rig.yaw = Math.PI * 0.65; g.rig.pitch = -0.1; g.rig.dist = 4;
      for (let k = 0; k < 20; k++) g.rig.update(1 / 60, { pos: g.hero.renderPos, vel: h.vel, state: h.state, facing: h.facing, wallN: h.wallN, glide: h.glide });
      g.renderer.render(g.scene, g.camera);
      return { noShiftShot, shots, errors: TL.errors };
    });
    assert(result.noShiftShot); assert.equal(result.shots[0].hand, 'L'); assert.equal(result.shots[1].hand, 'R');
    assert(result.shots.every(s => s.attached && s.finite && !s.attacks));
    assert.equal(result.errors.length, 0); assert.equal(errors.length, 0);
    await page.screenshot({ path: path.join(__dirname, 'hand_swing_preview.png') });
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
