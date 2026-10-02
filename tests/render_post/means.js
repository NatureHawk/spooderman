'use strict';
const { launch, start, setScene, SCENES } = require('../graphics_bench/lib');
Object.assign(SCENES, require('./scenes.json'));
(async () => {
  const { browser, page } = await launch({ headless: true, w: 1280, h: 720 });
  try {
    await start(page, 'THREADLINE.html', 'low');
    for (const sc of process.argv[2].split(',')) for (const q of ['low', 'medium', 'high', 'ultra', 'low']) {
      await page.evaluate((q) => TL.game.applyQuality(q), q);
      await setScene(page, sc);
      const r = await page.evaluate(() => {
        for (let i = 0; i < 14; i++) { BENCH.render(); BENCH.sync(); }
        const gl = BENCH.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a);
        let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2];
        const e = TL.game.env; return { mean: +(s / (a.length / 4) / 3).toFixed(1), hour: +e.hour.toFixed(2), night: +e.night.toFixed(3), exp: TL.game.renderer.toneMappingExposure, w };
      });
      console.log(sc, q, JSON.stringify(r));
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
