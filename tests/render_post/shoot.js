/* Screenshot driver for the rendering-quality pass (hardware Chrome, same harness as tests/graphics_bench).
   node tests/render_post/shoot.js --html THREADLINE.html --quality ultra --scenes street,rain --out shots/new [--hour 17.5] [--filter 1:2] [--js "code run after setScene"]
   Each scene is rendered a few times (the post stack has temporal-free passes, but the env probe needs a couple of updates) and saved as <out>/<scene>[_tag].png */
'use strict';
const fs = require('fs'), path = require('path');
const { launch, start, setScene, SCENES } = require('../graphics_bench/lib');
Object.assign(SCENES, require('./scenes.json'));
const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const html = args.html || 'THREADLINE.html', quality = args.quality || 'high', out = args.out || 'shots/out';
const scenes = (args.scenes || 'street').split(','), tag = args.tag ? '_' + args.tag : '';
const W = +(args.w || 1600), H = +(args.h || 900);
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const { browser, page } = await launch({ headless: true, w: W, h: H, log: !!args.log });
  try {
    await start(page, html, quality);
    for (const sc of scenes) {
      const extra = {}; if (args.hour) extra.hour = +args.hour;
      await setScene(page, sc, extra);
      if (args.filter) { const [s, l] = args.filter.split(':').map(Number); await page.evaluate((s, l) => BENCH.setFilter(s, l), s, l); }
      if (args.js) await page.evaluate(args.js);
      await page.evaluate(() => { const g = TL.game; g.env.updateEnv(); for (let i = 0; i < 16; i++) { BENCH.render(); BENCH.sync(); } });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      await page.evaluate(() => { BENCH.render(); BENCH.sync(); });
      const file = path.join(out, sc + tag + '.png');
      await page.screenshot({ path: file });
      const info = await page.evaluate(() => ({ info: BENCH.info(), errors: TL.errors && TL.errors.slice(0, 3) }));
      console.log(sc, file, JSON.stringify(info));
    }
    if (page.errors.length) console.log('page errors:', page.errors.slice(0, 5));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
