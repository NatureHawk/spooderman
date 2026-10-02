'use strict';
/* node tests/life/perf.js <html|-> [quality] [label]
   Per-system CPU time (ms / frame) and frame rate at fixed chase-camera spots, measured over 6 s each.
   Wraps crowd.update, streamer.update, traffic.update and renderer.render of the running game. */
const fs = require('fs'), path = require('path');
const { open, stand, unfree, sleep } = require('./lib.js');
const html = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : undefined, quality = process.argv[3] || 'high', label = process.argv[4] || 'perf';
const SPOTS = [
  { name: 'fidi_street', x: 60, z: 330, yaw: 1.0, pitch: 0.05, dist: 8, hour: 12.5 },
  { name: 'battery_park', x: 235, z: 650, yaw: 0.6, pitch: -0.05, dist: 9, hour: 14 },
  { name: 'seaport_pier', x: 500, z: 300, yaw: -1.57, pitch: -0.05, dist: 9, hour: 14 },
  { name: 'trees_street', x: -52, z: -217, yaw: -2.2, pitch: 0.05, dist: 9, hour: 14 },
];
(async () => {
  const { b, p } = await open({ html, quality });
  const out = [];
  try {
    await p.evaluate(() => {
      const g = TL.game, acc = (TL.__perf = {}), wrap = (obj, key, name) => {
        const f = obj[key]; if (!f || f.__w) return;
        obj[key] = function (...a) { const t = performance.now(); const r = f.apply(this, a); acc[name] = (acc[name] || 0) + performance.now() - t; return r; }; obj[key].__w = true;
      };
      wrap(g.crowd, 'update', 'crowd'); wrap(g.traffic, 'update', 'traffic'); wrap(g.streamer, 'update', 'streamer'); wrap(g.renderer, 'render', 'render');
      if (g.cityLife) wrap(g.cityLife, 'update', 'cityLife');
      if (g.crowd.life) { wrap(g.crowd.life, 'think', 'life.think'); wrap(g.crowd.life, 'spawn', 'life.spawn'); wrap(g.crowd.life, 'begin', 'life.begin'); }
      const w = g.streamer; if (w.harbor) wrap(w.harbor, 'update', 'harbor');
      let n = 0; const loop = () => { n++; TL.__frames = n; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    });
    for (const s of SPOTS.filter((q) => !process.env.SPOT || q.name === process.env.SPOT)) {
      await p.evaluate((hour) => { const e = TL.game.env; e.hour = hour; e.forced = 'clear'; e.rain = 0; e.wet = 0; }, s.hour);
      await unfree(p);
      await stand(p, s.x, s.z, s.yaw, s.pitch, s.dist);
      await sleep(6000);                                           // settle (spawn, streaming)
      const r = await p.evaluate(async () => {
        const acc = TL.__perf; for (const k in acc) acc[k] = 0; const f0 = TL.__frames, t0 = performance.now();
        await new Promise((res) => setTimeout(res, 6000));
        const fr = TL.__frames - f0, ms = performance.now() - t0, o = { fps: +(fr / ms * 1000).toFixed(1), peds: TL.game.crowd.peds.length, calls: TL.game.renderer.info.render.calls, tris: TL.game.renderer.info.render.triangles };
        for (const k in acc) o[k] = +(acc[k] / Math.max(fr, 1)).toFixed(2);
        return o;
      });
      r.spot = s.name; out.push(r); console.log(JSON.stringify(r));
    }
  } finally { await b.close(); }
  fs.mkdirSync(path.resolve(__dirname, '../../evidence/life'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../../evidence/life/' + label + '_' + quality + '.json'), JSON.stringify(out, null, 1));
})();
