'use strict';
/* node tests/life/hero_probe.js <label> [html]  -> hero reactions in the real game: fly-by, hard landing (gather), fight (scatter), rain.
   Prints act / anim histograms around each trigger and saves frames evidence/life/<label>/hero_<scenario>_N.png */
const fs = require('fs'), path = require('path');
const { open, stand, free, unfree, sleep } = require('./lib.js');
const label = process.argv[2] || 'hero', html = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : undefined;
(async () => {
  const out = path.resolve(__dirname, '../../evidence/life', label); fs.mkdirSync(out, { recursive: true });
  const { b, p } = await open({ html });
  const hist = () => p.evaluate(() => { const a = {}, m = {}; for (const q of TL.game.crowd.peds) if (q.L) { a[q.L.act] = (a[q.L.act] || 0) + 1; m[q.anim] = (m[q.anim] || 0) + 1; } return { acts: a, anims: m, n: TL.game.crowd.peds.length }; });
  const shot = async (n, k, cam) => { if (cam) await free(p, cam.pos, cam.look, 58); await p.screenshot({ path: path.join(out, 'hero_' + n + '_' + k + '.png') }); };
  try {
    // crowded spot: Bowling Green at lunch
    await p.evaluate(() => { const e = TL.game.env; e.hour = 13; e.forced = 'clear'; e.rain = 0; });
    await stand(p, -11, 452, 0, 0, 7); await sleep(15000);
    // densest cluster of walkers within 150 m becomes the stage
    const P = await p.evaluate(() => { const ps = TL.game.crowd.peds.filter((q) => q.L); let best = null, bn = -1; for (const a of ps) { let n = 0; for (const c of ps) if (Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) < 14) n++; if (n > bn) { bn = n; best = a; } } return { x: best.pos.x, y: best.pos.y, z: best.pos.z, n: bn }; });
    console.log('stage', JSON.stringify(P));
    await p.evaluate((P) => { const h = TL.game.hero.ctrl; h.teleport(P.x, P.y + 1.3, P.z); h.vel.set(0, 0, 0); TL.game.streamer.forceLoadAround(h.pos, 100); }, P); await sleep(2500);
    console.log('baseline', JSON.stringify(await hist()));
    // 1) fly-by: hero swings 14 m above the street at speed
    await p.evaluate((P0) => { const h = TL.game.hero.ctrl; h.teleport(P0.x - 30, P0.y + 14, P0.z); h.vel.set(26, 0, 0); }, P);
    for (let k = 0; k < 8; k++) { await sleep(400); await p.evaluate((P0) => { const h = TL.game.hero.ctrl; h.teleport(P0.x - 12 + k0(), P0.y + 14, P0.z); h.vel.set(26, 0, 0); function k0() { return 0; } }, P); }
    console.log('flyby', JSON.stringify(await hist())); await shot('flyby', 0);
    // 2) hard landing in the crowd
    await p.evaluate((P) => { const g = TL.game, h = g.hero.ctrl; h.teleport(P.x, P.y + 1.3, P.z); h.vel.set(0, 0, 0); g.crowd.onHeroLand(h.pos.clone(), 32); g.cityLife.emit('land', h.pos.clone(), 1); }, P);
    await sleep(1500); await shot('landing', 0, { pos: [P.x + 9, P.y + 8, P.z + 9], look: [P.x, P.y + 1, P.z] });
    await sleep(4000); console.log('landing', JSON.stringify(await hist())); await shot('landing', 1); await sleep(5000); await shot('landing', 2);
    // 3) fight: a pack of enemies arrives
    await unfree(p);
    await p.evaluate((P) => { const g = TL.game, h = g.hero.ctrl; h.teleport(P.x, P.y + 1.3, P.z); g.ai.spawnGroup(['enforcer', 'enforcer', 'marksman'], new THREE.Vector3(P.x, P.y + 1, P.z + 9), {}); for (const e of g.ai.enemies) e.state = 'alert'; }, P);
    await sleep(2500); console.log('fight+2.5s', JSON.stringify(await hist())); await shot('fight', 0, { pos: [P.x + 10, P.y + 7, P.z + 3], look: [P.x, P.y + 1, P.z + 4] });
    await sleep(4000); console.log('fight+6.5s', JSON.stringify(await hist())); await shot('fight', 1);
    await p.evaluate(() => { for (const e of TL.game.ai.enemies) if (e.alive) e.defeat('test'); });
    await sleep(25000); console.log('after fight +25s', JSON.stringify(await hist()));
    // 4) rain
    await unfree(p);
    await p.evaluate(() => { const e = TL.game.env; e.forced = 'rain'; e.rain = 1; e.wet = 1; });
    await sleep(25000); console.log('rain', JSON.stringify(await hist())); await shot('rain', 0, { pos: [P.x + 8, P.y + 3, P.z + 8], look: [P.x, P.y + 1.2, P.z] });
    console.log('errors', await p.evaluate(() => TL.errors.length));
  } finally { await b.close(); }
})();
