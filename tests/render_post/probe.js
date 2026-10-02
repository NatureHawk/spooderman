/* in-session A/B: render the scene through the original path (tier 0) and through the post stack (neutral flags), diff in-page.
   node tests/render_post/probe.js --scene street --quality ultra --exp "name1=js;name2=js"  (each experiment js runs before BOTH renders) */
'use strict';
const { launch, start, setScene } = require('../graphics_bench/lib');
const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
(async () => {
  const { browser, page } = await launch({ headless: true, w: 1600, h: 900 });
  try {
    await start(page, args.html || 'THREADLINE.html', args.quality || 'ultra');
    await setScene(page, args.scene || 'street');
    const exps = (args.exp || 'none=0').split(';').map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; });
    for (const [name, js] of exps) {
      const res = await page.evaluate((js) => {
        const g = TL.game, P = TL.Post, F = P.flags;
        const save = {}; for (const k in F) save[k] = F[k];
        const t = P.tier;
        eval(js);
        const grab = () => { BENCH.render(); BENCH.sync(); const w = BENCH.gl.drawingBufferWidth, h = BENCH.gl.drawingBufferHeight, a = new Uint8Array(w * h * 4); BENCH.gl.readPixels(0, 0, w, h, BENCH.gl.RGBA, BENCH.gl.UNSIGNED_BYTE, a); return a; };
        for (let i = 0; i < 2; i++) { BENCH.render(); BENCH.sync(); }
        P.tier = 0; const A = grab();
        P.tier = t; for (const k of ['ao', 'bloom', 'grade', 'vignette', 'grain', 'shafts']) F[k] = 0; const B = grab();
        let n = 0, sum = 0, mx = 0; const N = A.length / 4;
        for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); if (d) n++; sum += d; if (d > mx) mx = d; }
        for (const k in save) F[k] = save[k];
        return { diffPct: +(n / N * 100).toFixed(3), mean: +(sum / N).toFixed(4), max: mx };
      }, js);
      console.log(name.padEnd(28), JSON.stringify(res));
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
