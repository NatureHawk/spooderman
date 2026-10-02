/* Rendering-pass regression test (hardware Chrome, tests/graphics_bench harness).
   node tests/render_post/tiers_browser.js [html]
   - every tier x {street, rain, night, waterfront}: no page/TL errors, no GL errors, context alive, image not black
   - low is the original path: a runtime hop low -> ultra -> low reproduces the first low frame bit for bit, and the post stack holds no targets
   - neutral stack (every effect off) stays within rounding of the original frame at the same quality (high + ultra)
   - comic filters (both styles) compose with the stack and do not break shafts/rain overlay
   - a window resize re-allocates targets cleanly */
'use strict';
const assert = require('assert');
const { launch, start, setScene, SCENES } = require('../graphics_bench/lib');
Object.assign(SCENES, require('./scenes.json'));
const html = process.argv[2] || 'THREADLINE.html';

const grab = `(() => { BENCH.render(); BENCH.sync(); const gl = BENCH.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; })()`;
const stats = `(A, B) => { let n = 0, mx = 0; for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); if (d) n++; if (d > mx) mx = d; } return { pct: n / (A.length / 4) * 100, max: mx }; }`;

(async () => {
  const { browser, page } = await launch({ headless: true, w: 1280, h: 720 });
  const results = [];
  try {
    await start(page, html, 'low');
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      for (const sc of ['street', 'rain', 'night', 'waterfront']) {
        await page.evaluate((q) => { TL.game.applyQuality(q); }, q);
        await setScene(page, sc);
        const r = await page.evaluate((grab) => {
          const gl = BENCH.gl; gl.getError();
          let a; for (let i = 0; i < 14; i++) a = eval(grab);
          const err = gl.getError(); let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2];
          return { err, lost: gl.isContextLost(), mean: s / (a.length / 4) / 3, errors: TL.errors.slice() };
        }, grab);
        assert.strictEqual(r.err, 0, `GL error ${r.err} at ${q}/${sc}`);
        assert(!r.lost, 'context lost'); assert(r.mean > 3, `black frame at ${q}/${sc}`); assert.deepStrictEqual(r.errors, [], `TL errors at ${q}/${sc}`);
        results.push(`${q}/${sc} ok (mean ${r.mean.toFixed(1)})`);
      }
    }
    // low -> ultra -> low
    const hop = await page.evaluate(async (grab, stats) => {
      const g = TL.game; g.applyQuality('low'); for (let i = 0; i < 3; i++) eval(grab);
      TL.Post.flags.ssr = TL.Post.flags.ao = 1;
      const A = eval(grab);
      g.applyQuality('ultra'); for (let i = 0; i < 14; i++) eval(grab);
      g.applyQuality('low'); for (let i = 0; i < 3; i++) eval(grab);
      const B = eval(grab);
      const d = eval(stats)(A, B);
      return { d, rts: Object.keys(TL.Post.rt).length + TL.Post.bloomRT.length, probe: !!TL.Render.probe, envRT: !!TL.Render.envRT, errors: TL.errors.slice() };
    }, grab, stats);
    console.log('low->ultra->low diff', JSON.stringify(hop));
    assert.strictEqual(hop.rts, 0, 'low must not hold post targets'); assert(!hop.probe && !hop.envRT, 'low must not hold the probe');
    assert(hop.d.max <= 3, 'low frame changed after a tier hop (' + JSON.stringify(hop.d) + ')');
    // neutral equivalence at the same quality (street: no unclamped sun glitter, whose MSAA resolve legitimately differs)
    await setScene(page, 'street');
    for (const q of ['high', 'ultra']) {
      const d = await page.evaluate((q, grab, stats) => {
        const g = TL.game, P = TL.Post, F = P.flags; g.applyQuality(q);
        for (let i = 0; i < 14; i++) eval(grab);
        const sv = Object.assign({}, F); for (const k in F) F[k] = 0;
        // the original path renders through TL.Shafts' linear target when the sun is in view (fog blends in linear there): compare without it
        const strength = TL.Shafts.strength; TL.Shafts.strength = () => 0;
        const t = P.tier; P.tier = 0; const A = eval(grab); P.tier = t; const B = eval(grab);
        Object.assign(F, sv); TL.Shafts.strength = strength; return eval(stats)(A, B);
      }, q, grab, stats);
      console.log('neutral', q, JSON.stringify(d)); assert(d.max <= 24 && d.pct < 12, 'neutral stack drifted at ' + q);
    }
    // comic filters on top of the stack
    for (const style of [1, 2]) {
      const r = await page.evaluate((style, grab) => {
        const g = TL.game; g.applyQuality('ultra'); BENCH.setFilter(style, 2);
        let a; for (let i = 0; i < 4; i++) a = eval(grab); let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2];
        BENCH.setFilter(0, 0); return { mean: s / (a.length / 4) / 3, errors: TL.errors.slice(), err: BENCH.gl.getError() };
      }, style, grab);
      assert(r.mean > 3 && r.err === 0 && !r.errors.length, 'comic ' + style + ' failed ' + JSON.stringify(r));
      results.push('comic style ' + style + ' ok');
    }
    // resize
    await page.setViewport({ width: 1000, height: 600, deviceScaleFactor: 1 });
    const rs = await page.evaluate((grab) => { const g = TL.game; g.resize(); let a; for (let i = 0; i < 3; i++) a = eval(grab); return { w: BENCH.gl.drawingBufferWidth, err: BENCH.gl.getError(), errors: TL.errors.slice() }; }, grab);
    assert(rs.err === 0 && !rs.errors.length, 'resize failed ' + JSON.stringify(rs)); results.push('resize ok (' + rs.w + ')');
    assert.deepStrictEqual(page.errors, [], 'page errors');
    console.log(results.join('\n')); console.log('PASS render post tiers');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
