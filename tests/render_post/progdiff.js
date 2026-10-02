'use strict';
const fs = require('fs');
const { launch, start, setScene } = require('../graphics_bench/lib');
(async () => {
  const { browser, page } = await launch({ headless: true, w: 1600, h: 900 });
  try {
    await start(page, 'THREADLINE.html', 'ultra');
    await setScene(page, 'street');
    const out = await page.evaluate(() => {
      const g = TL.game, r = g.renderer, gl = r.getContext();
      const P = TL.Post; const t = P.tier;
      P.tier = 0; BENCH.render(); BENCH.sync();
      const before = new Set(r.info.programs.map((p) => p.id));
      P.tier = t; BENCH.render(); BENCH.sync();
      const src = (p) => gl.getAttachedShaders(p.program).map((s) => gl.getShaderSource(s));
      const all = r.info.programs.map((p) => ({ id: p.id, key: p.cacheKey.slice(0, 80), fs: src(p)[1] || '', vs: src(p)[0] || '', isNew: !before.has(p.id) }));
      return all;
    });
    fs.writeFileSync('shots/progs.json', JSON.stringify(out));
    console.log(out.length, 'programs;', out.filter((o) => o.isNew).length, 'new');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
