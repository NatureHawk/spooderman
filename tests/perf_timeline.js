'use strict';
/* node tests/perf_timeline.js [quality]: per-second fps, shader program count and the slowest per-frame hooks after
   standing at a fresh spot (finds start-up / streaming stalls). */
const { open, stand, unfree, sleep } = require('./life/lib.js');
(async () => {
  const { b, p } = await open({ quality: process.argv[2] || 'high', html: process.argv[3] });
  try {
    await p.evaluate(() => {
      const g = TL.game, acc = (TL.__acc = {}), wrap = (obj, key, name) => { const f = obj[key]; if (!f) return; obj[key] = function (...a) { const t = performance.now(); const r = f.apply(this, a); acc[name] = (acc[name] || 0) + performance.now() - t; return r; }; };
      TL.ScanHooks.update.forEach((f, i) => { TL.ScanHooks.update[i] = function (...a) { const t = performance.now(); const r = f.apply(this, a); const n = 'hook' + i + ':' + (f.name || f.toString().slice(0, 40).replace(/\s+/g, ' ')); acc[n] = (acc[n] || 0) + performance.now() - t; return r; }; });
      const w = g.streamer; for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(w))) if (/^(update|stream|build|tick|refresh)/i.test(k) && typeof w[k] === 'function') wrap(w, k, 'streamer.' + k);
      wrap(g.renderer, 'render', 'render'); if (TL.Render) wrap(TL.Render, 'update', 'probe.update'); if (TL.Post && TL.Post.render) wrap(TL.Post, 'render', 'post.render');
      let n = 0; const loop = () => { n++; TL.__frames = n; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    });
    await p.evaluate(() => { const e = TL.game.env; e.hour = 14; e.forced = 'clear'; });
    await unfree(p); await stand(p, 60, 330, 1.0, 0.05, 8);
    const before = await p.evaluate(() => TL.game.renderer.info.programs.map((x) => x.cacheKey));
    for (let s = 0; s < +(process.env.SECS || 30); s++) {
      const r = await p.evaluate(async () => { const acc = TL.__acc; for (const k in acc) acc[k] = 0; const f0 = TL.__frames; await new Promise((res) => setTimeout(res, 1000));
        const fr = Math.max(1, TL.__frames - f0), top = Object.entries(acc).map(([k, v]) => [k, v / fr]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k.slice(0, 50) + '=' + v.toFixed(1));
        return { fps: TL.__frames - f0, progs: TL.game.renderer.info.programs.length, top }; });
      console.log('t' + s, r.fps, 'progs', r.progs, r.top.join('  '));
    }
  const news = await p.evaluate((before) => { const B = new Set(before); return TL.game.renderer.info.programs.filter((x) => !B.has(x.cacheKey)).map((x) => x.name + ' | ' + x.cacheKey.slice(0, 60).replace(/,/g, ' ')); }, before);
    const who = await p.evaluate((before) => { const B = new Set(before), r = TL.game.renderer, out = {};
      TL.game.scene.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { const pr = r.properties.get(m); const cp = pr && pr.currentProgram; if (!cp || B.has(cp.cacheKey)) continue;
        let n = o.name || ''; let q = o; while (!n && q.parent && q.parent !== TL.game.scene) { q = q.parent; n = q.name || ''; }
        const k = m.type + ':' + (m.name || '') + ' obj=' + (n || o.type) + (o.isInstancedMesh ? ' inst' : '') + (o.isSkinnedMesh ? ' skin' : '') + (o.__tlProbe ? ' probe' : '');
        out[k] = (out[k] || 0) + 1; } }); return out; }, before);
    console.log('WHO', JSON.stringify(who).slice(0, 2500));
    const cnt = {}; for (const n of news) { const k = n.split(' | ')[0]; cnt[k] = (cnt[k] || 0) + 1; } console.log('NEW PROGRAMS', news.length, JSON.stringify(cnt));
  } finally { await b.close(); }
})();
