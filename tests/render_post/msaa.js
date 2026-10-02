'use strict';
const { launch, start, setScene, SCENES } = require('../graphics_bench/lib');
Object.assign(SCENES, require('./scenes.json'));
(async () => {
  const { browser, page } = await launch({ headless: true, w: 1600, h: 900 });
  try {
    await start(page, 'THREADLINE.html', 'ultra'); await setScene(page, process.argv[2] || 'street');
    console.log(JSON.stringify(await page.evaluate(async () => {
      const P = TL.Post, r = TL.game.renderer, gl = r.getContext(), wait = (ms) => new Promise((x) => setTimeout(x, ms)), out = {};
      for (const f of Object.keys(P.flags)) P.flags[f] = 0; TL.Render.cfg = null;
      for (const s of [4, 2, 0, 'orig', 4, 2, 0, 'orig', 4, 2, 0, 'orig']) {
        if (s === 'orig') P.tier = 0; else { P.tier = 3; P.samples = s; }
        for (let i = 0; i < 20; i++) { BENCH.render(); BENCH.sync(); }
        const qs = []; for (let i = 0; i < 40; i++) { const q = gl.createQuery(); gl.beginQuery(BENCH.tq.TIME_ELAPSED_EXT, q); BENCH.render(); gl.endQuery(BENCH.tq.TIME_ELAPSED_EXT); BENCH.sync(); qs.push(q); if (i % 5 === 4) await wait(0); }
        await wait(30); const v = qs.map((q) => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b); (out[s] = out[s] || []).push(+v[20].toFixed(2));
      }
      return out;
    })));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
