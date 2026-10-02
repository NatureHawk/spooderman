'use strict';
/* node tests/life/crowd_probe.js <label> [html|-] [scenario,scenario]
   Drops the hero in a district, waits for a behaviour to appear, frames it with a free camera and saves a short frame
   sequence (evidence/life/<label>/crowd_<scenario>_N.png) plus a stats line.  Scenarios: see SCEN. */
const fs = require('fs'), path = require('path');
const { open, stand, free, unfree, sleep } = require('./lib.js');
const label = process.argv[2] || 'crowd', html = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : undefined, only = process.argv[4] ? process.argv[4].split(',') : null;
const SCEN = {
  waitcross: { x: 60, z: 330, hour: 8.5, act: 'waitcross', min: 3 },
  cross: { x: 60, z: 330, hour: 12.5, act: 'cross', min: 2 },
  sit: { x: 235, z: 690, hour: 13, act: 'sit', min: 1 },
  lawn: { x: 215, z: 640, hour: 14, act: 'lawn', min: 1 },
  queue: { x: 89, z: 313, hour: 12.5, act: 'queue', min: 1 },
  group: { x: -10, z: 440, hour: 13, act: 'group', min: 1 },
  stoop: { x: -326, z: 428, hour: 17, act: 'sit', seat: 'stoop', min: 1 },
  shelter: { x: -124, z: 320, hour: 12, act: 'shelter', rain: true, min: 1 },
  rainwalk: { x: 60, z: 330, hour: 12, act: 'walk', rain: true, min: 4 },
  vendor: { x: 89, z: 313, hour: 12.5, act: 'vendor', min: 1 },
};
(async () => {
  const out = path.resolve(__dirname, '../../evidence/life', label); fs.mkdirSync(out, { recursive: true });
  const { b, p } = await open({ html });
  try {
    for (const [name, S] of Object.entries(SCEN)) {
      if (only && !only.includes(name)) continue;
      await unfree(p);
      await p.evaluate((h, rain) => { const e = TL.game.env; e.hour = h; e.forced = rain ? 'rain' : 'clear'; e.rain = rain ? 1 : 0; e.wet = rain ? 1 : 0; }, S.hour, !!S.rain);
      await stand(p, S.x, S.z, 0, 0, 6);
      await p.evaluate(() => { const g = TL.game; g.hero.ctrl.pos.y += 60; });         // hero hovers out of the way (no avoidance, no greet)
      let found = null;
      for (let i = 0; i < 90 && !found; i++) {
        await sleep(1000);
        found = await p.evaluate((S) => {
          const g = TL.game, peds = g.crowd.peds, hp = g.hero.ctrl.pos;
          const ok = peds.filter((q) => q.L && (S.act === 'group' ? q.L.group && q.L.group.members.length > 1 && q.L.act === 'walk' : q.L.act === S.act && (!S.seat || (q.L.seat && q.L.seat.type === S.seat))) && Math.hypot(q.pos.x - hp.x, q.pos.z - hp.z) < 70);
          if (ok.length < S.min) return null;
          const q = ok[0];
          return { x: q.pos.x, y: q.pos.y, z: q.pos.z, n: ok.length, yaw: q.yaw };
        }, S);
      }
      if (!found) { console.log(name, 'NOT FOUND in 90 s'); continue; }
      console.log(name, 'found', JSON.stringify(found));
      for (let k = 0; k < 4; k++) {
        // keep re-framing on the same pedestrian group (they move): follow the first match each time
        const f = await p.evaluate((S) => {
          const g = TL.game, hp = g.hero.ctrl.pos;
          const ok = g.crowd.peds.filter((q) => q.L && (S.act === 'group' ? q.L.group && q.L.group.members.length > 1 : q.L.act === S.act && (!S.seat || (q.L.seat && q.L.seat.type === S.seat))));
          ok.sort((a, b) => Math.hypot(a.pos.x - hp.x, a.pos.z - hp.z) - Math.hypot(b.pos.x - hp.x, b.pos.z - hp.z));
          const q = ok[0]; if (!q) return null;
          return { x: q.pos.x, y: q.pos.y, z: q.pos.z, yaw: q.yaw };
        }, S);
        if (f) {
          await p.evaluate((f) => { const h = TL.game.hero.ctrl; h.teleport(f.x + 12, f.y + 60, f.z); h.vel.set(0, 0, 0); }, f);
          // choose the clearest side to shoot from (rays against the collision world), camera 2 m up
          const cam = await p.evaluate((f) => {
            const g = TL.game; let best = null;
            for (let k = 0; k < 12; k++) {
              const a = f.yaw + 0.9 + k * 0.52, dx = Math.sin(a), dz = Math.cos(a);
              const hit = g.world.raycast(f.x, f.y + 1.6, f.z, dx, 0.18, dz, 6.5, (c) => c.solid, {}, { noGround: true });
              const len = hit ? Math.hypot(hit.x - f.x, hit.z - f.z) - 0.4 : 6.5;
              if (!best || len > best.len) best = { len, dx, dz };
            }
            const L = Math.min(5.8, Math.max(2.5, best.len));
            return [f.x + best.dx * L, f.y + 1.9, f.z + best.dz * L];
          }, f);
          await free(p, cam, [f.x, f.y + 1.0, f.z], 58);
        }
        await sleep(900);
        await p.screenshot({ path: path.join(out, 'crowd_' + name + '_' + k + '.png') });
        await sleep(1500);
      }
      const st = await p.evaluate(() => { const L = TL.game.crowd.life, acts = {}; for (const q of TL.game.crowd.peds) if (q.L) acts[q.L.act] = (acts[q.L.act] || 0) + 1; return { peds: TL.game.crowd.peds.length, want: L.wantNow, acts, stats: L.stats, fps: +TL.game.fps.toFixed(1), errs: TL.errors.length }; });
      console.log(name, JSON.stringify(st));
    }
  } finally { await b.close(); }
})();
