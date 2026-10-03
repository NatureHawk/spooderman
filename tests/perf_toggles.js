'use strict';
/* node tests/perf_toggles.js [quality]  ->  fps of the running game with one High/Ultra feature switched off at a time,
   interleaved (2 rounds) at fixed chase-camera spots. Finds what the frame rate is spent on. */
const { open, stand, unfree, sleep } = require('./life/lib.js');
const quality = process.argv[2] || 'high';
const SPOTS = [{ name: 'fidi_street', x: 60, z: 330, yaw: 1.0, pitch: 0.05, dist: 8 }, { name: 'trees_street', x: -52, z: -217, yaw: -2.2, pitch: 0.05, dist: 9 }];
const CONF = {
  full: () => {},
  noProbe: () => { TL.Render.setTier(1); },
  noAO: () => { TL.Post.flags.ao = 0; },
  noShafts: () => { TL.Post.flags.shafts = 0; },
  noRooms: () => { const m = TL.game.streamer.nycMat; m.defines.TL_BQ = 1; m.needsUpdate = true; },
  noMSAA: () => { TL.Post.samples = 0; },
  noShadows: () => { TL.game.renderer.shadowMap.enabled = false; },
  noPost: () => { TL.Post.tier = 0; },
};
(async () => {
  const { b, p } = await open({ quality });
  try {
    await p.evaluate(() => { let n = 0; const loop = () => { n++; TL.__frames = n; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    for (const s of SPOTS) {
      await p.evaluate(() => { const e = TL.game.env; e.hour = 14; e.forced = 'clear'; e.rain = 0; e.wet = 0; });
      await unfree(p); await stand(p, s.x, s.z, s.yaw, s.pitch, s.dist); await sleep(8000);
      const res = {};
      for (let round = 0; round < 2; round++) for (const [k, f] of Object.entries(CONF)) {
        await p.evaluate((q, src) => { TL.game.applyQuality(q); TL.Post.flags.ao = 1; TL.Post.flags.shafts = 1; TL.Post.samples = 4; TL.game.renderer.shadowMap.enabled = q === 'high' || q === 'ultra'; eval('(' + src + ')')(); }, quality, f.toString());
        await sleep(2500);
        const fps = await p.evaluate(async () => { const f0 = TL.__frames, t0 = performance.now(); await new Promise((r) => setTimeout(r, 3500)); return (TL.__frames - f0) / (performance.now() - t0) * 1000; });
        (res[k] = res[k] || []).push(+fps.toFixed(1));
      }
      console.log(s.name, JSON.stringify(res));
    }
  } finally { await b.close(); }
})();
