/* mean/NaN-ish brightness of the canvas under flag combinations: node stat.js --scene skyline --hour 17.5 --exp "a=js;b=js" */
'use strict';
const { launch, start, setScene } = require('../graphics_bench/lib');
const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
(async () => {
  const { browser, page } = await launch({ headless: true, w: 1600, h: 900 });
  try {
    await start(page, args.html || 'THREADLINE.html', args.quality || 'ultra');
    await setScene(page, args.scene || 'street', args.hour ? { hour: +args.hour } : {});
    for (const e of (args.exp || 'x=0').split('|')) {
      const i = e.indexOf('='), name = e.slice(0, i), js = e.slice(i + 1);
      const r = await page.evaluate((js) => {
        const F = TL.Post.flags; for (const k in F) F[k] = 1; TL.Post.debug = 0; eval(js);
        BENCH.render(); BENCH.sync(); const gl = BENCH.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
        let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2]; return +(s / (a.length / 4) / 3).toFixed(2);
      }, js);
      console.log(name.padEnd(14), r);
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
