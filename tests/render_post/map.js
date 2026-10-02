'use strict';
const { launch, start } = require('../graphics_bench/lib');
(async () => {
  const { browser, page } = await launch({ headless: true, w: 800, h: 450 });
  try {
    await start(page, 'THREADLINE.html', 'low');
    const rows = await page.evaluate(() => {
      const g = TL.game, w = g.world, out = [];
      for (let z = -700; z <= 700; z += 50) { let s = ''; for (let x = -700; x <= 700; x += 25) { const h = w.raycast(x, 400, z, 0, -1, 0, 800); s += !h ? '~' : h.y <= -2.5 ? '~' : h.y < 3 ? '.' : '#'; } out.push(z + ' ' + s); }
      return out;
    });
    console.log(rows.join('\n'));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
