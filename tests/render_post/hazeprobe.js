'use strict';
const { launch, start, setScene } = require('../graphics_bench/lib');
(async () => {
  const { browser, page } = await launch({ headless: true, w: 1600, h: 900 });
  try {
    await start(page, 'THREADLINE.html', process.argv[2] || 'ultra');
    await setScene(page, process.argv[3] || 'street');
    const out = await page.evaluate(() => {
      const g = TL.game, r = g.renderer, gl = r.getContext(), P = TL.Post, F = P.flags, t = P.tier;
      for (const k of ['ao', 'bloom', 'grade', 'vignette', 'grain', 'shafts']) F[k] = 0;
      const px = (x, y) => { const a = new Uint8Array(4); gl.readPixels(x, gl.drawingBufferHeight - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); return Array.from(a.slice(0, 3)).join(','); };
      const pts = [[200, 440], [170, 420], [160, 300], [350, 100], [700, 700]];
      const res = {};
      const run = (name) => {
        P.tier = 0; BENCH.render(); BENCH.sync(); const a = pts.map((p) => px(...p));
        P.tier = t; BENCH.render(); BENCH.sync(); const b = pts.map((p) => px(...p));
        res[name] = { orig: a.join(' | '), post: b.join(' | ') };
      };
      const fog = g.scene.fog, hz = TL.Atmos.hz.p, x0 = hz.x, w0 = hz.w;
      run('default');
      hz.x = 0; run('hz.x=0'); hz.x = x0;
      g.scene.fog = null; run('no fog'); g.scene.fog = fog;
      g.scene.fog = null; hz.x = 0; run('no fog, no haze'); hz.x = x0; g.scene.fog = fog;
      g.renderer.shadowMap.enabled = false; run('no shadow'); g.renderer.shadowMap.enabled = true;
      return res;
    });
    for (const k in out) console.log(k.padEnd(18), '\n   orig', out[k].orig, '\n   post', out[k].post);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
