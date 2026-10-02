'use strict';
/* node tests/life/shots.js <label> [html|-] [name,name] [views.json]  ->  evidence/life/<label>/<name>.png
   A view is { name, x, z, yaw, pitch, dist, hour, wait } (chase camera at the hero) or adds
   free: { pos:[x,y,z], look:[x,y,z], fov } for a detached camera (hero stays at x,z so streaming follows). */
const fs = require('fs'), path = require('path');
const { open, stand, free, unfree, sleep } = require('./lib.js');
const label = process.argv[2] || 'before', html = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : undefined, only = process.argv[4] ? process.argv[4].split(',') : null;
const VIEWS = JSON.parse(fs.readFileSync(path.resolve(process.argv[5] || path.join(__dirname, 'views.json')), 'utf8'));
(async () => {
  const out = path.resolve(__dirname, '../../evidence/life', label); fs.mkdirSync(out, { recursive: true });
  const { b, p } = await open({ html });
  try {
    for (const v of VIEWS) {
      if (only && !only.includes(v.name)) continue;
      await p.evaluate((hour, rain) => { const e = TL.game.env; e.hour = hour; e.forced = rain ? 'rain' : 'clear'; if (!rain) { e.rain = 0; e.wet = 0; } }, v.hour === undefined ? 14 : v.hour, !!v.rain);
      await unfree(p);
      await stand(p, v.x, v.z, v.yaw || 0, v.pitch || 0, v.dist);
      if (v.free) await free(p, v.free.pos, v.free.look, v.free.fov);
      await sleep(v.wait || 4500);
      await p.screenshot({ path: path.join(out, v.name + '.png') });
      console.log(v.name, JSON.stringify(await p.evaluate(() => ({ errs: TL.errors.length, peds: TL.game.crowd.count, trees: TL.game.streamer.stats && TL.game.streamer.stats.trees, fps: +TL.game.fps.toFixed(1) }))));
    }
  } finally { await b.close(); }
})();
