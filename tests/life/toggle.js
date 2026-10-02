'use strict';
/* node tests/life/toggle.js x z yaw  -> fps with feature groups switched off one after another (finds what costs GPU time) */
const { open, stand, unfree, sleep } = require('./lib.js');
const [x, z, yaw] = [+process.argv[2] || 235, +process.argv[3] || 650, +process.argv[4] || 0.6];
(async () => {
  const { b, p } = await open({});
  try {
    await p.evaluate(() => { let n = 0; const loop = () => { TL.__frames = ++n; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    await unfree(p); await stand(p, x, z, yaw, -0.05, 9); await sleep(7000);
    const fps = () => p.evaluate(async () => { const f0 = TL.__frames, t0 = performance.now(); await new Promise((r) => setTimeout(r, 4000)); return +((TL.__frames - f0) / (performance.now() - t0) * 1000).toFixed(1); });
    const steps = {
      all: () => {},
      noLifeSets: () => { for (const s of TL.game.streamer.lifeSets || []) for (const m of s.meshes) m.visible = false; },
      noHarbor: () => { const h = TL.game.streamer.harbor; if (h) { for (const s of Object.values(h.sets)) for (const m of s.meshes) m.visible = false; for (const v of h.vessels) v.wake.visible = false; } },
      noWallApron: () => { for (const m of TL.game.streamer.waterfront.meshes) m.visible = false; },
      noTrees: () => { for (const m of TL.game.streamer.trees.meshes) m.visible = false; },
      noWake: () => { const h = TL.game.streamer.harbor; if (h) for (const v of h.vessels) { v.wake.visible = false; v.wake.geometry.setDrawRange(0, 0); } },
      noPeds: () => { for (const q of TL.game.crowd.peds) if (q.skin) q.skin.sk.mesh.visible = false; TL.game.crowd.lodBatch && (TL.game.crowd.lodBatch.mesh.visible = false); },
    };
    const order = process.argv[5] ? process.argv[5].split(',') : Object.keys(steps);
    for (const [k, f] of order.map((n) => [n, steps[n]])) { await p.evaluate(f); console.log(k, await fps()); }
  } finally { await b.close(); }
})();
