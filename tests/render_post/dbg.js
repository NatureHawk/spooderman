'use strict';
const { launch, start, setScene, SCENES } = require('../graphics_bench/lib');
Object.assign(SCENES, require('./scenes.json'));
(async () => {
  const { browser, page } = await launch({ headless: true, w: 800, h: 450 });
  try {
    await start(page, 'THREADLINE.html', 'ultra');
    await setScene(page, process.argv[2] || 'waterfront');
    console.log(JSON.stringify(await page.evaluate((code) => { for (let i = 0; i < 16; i++) { BENCH.render(); BENCH.sync(); } return eval(code); }, process.argv[3] || '0')));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
