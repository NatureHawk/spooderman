'use strict';
const { launch, start } = require('../graphics_bench/lib');
(async () => {
  const { browser, page } = await launch({ headless: true, w: 640, h: 360 });
  try {
    for (const q of ['low', 'medium', 'ultra']) { await start(page, 'THREADLINE.html', q); console.log(q, await page.evaluate(() => TL.game.env.hour)); await page.reload(); }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
