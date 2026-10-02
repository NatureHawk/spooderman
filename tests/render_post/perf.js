/* GPU cost of every stage per tier, measured with timer queries around each pass (TL.Post.prof), in one session.
   node tests/render_post/perf.js [--html THREADLINE.html] [--tiers medium,high,ultra] [--scenes street,rain,waterfront] [--frames 240] [--w 1600 --h 900]
   For each tier/scene: frames run through the full stack (every effect of the tier on) and through a neutral stack (all effects off: scene target +
   composite only), plus the original render path (TL.Post.tier = 0) at the same quality. ms/frame = mean over the frames of the summed pass times.
   'scene' differs from 'orig' by MSAA-target + custom tone curve; 'probe' is the amortised reflection-probe work (cube faces + prefilter).
   A/A check: the same stage measured in two separate batches of the same variant. */
'use strict';
const fs = require('fs'), path = require('path');
const { launch, start, setScene, SCENES } = require('../graphics_bench/lib');
Object.assign(SCENES, require('./scenes.json'));
const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const tiers = (args.tiers || 'medium,high,ultra').split(','), scenes = (args.scenes || 'street,rain,waterfront').split(','), frames = +(args.frames || 240);

(async () => {
  const { browser, page } = await launch({ headless: true, w: +(args.w || 1600), h: +(args.h || 900) });
  const out = {};
  try {
    await start(page, args.html || 'THREADLINE.html', 'low');
    for (const q of tiers) {
      await page.evaluate((q) => TL.game.applyQuality(q), q);
      for (const sc of scenes) {
        await setScene(page, sc);
        await page.evaluate(() => { for (let i = 0; i < 24; i++) { BENCH.render(); BENCH.sync(); } });
        const res = await page.evaluate(async (frames) => {
          const g = TL.game, r = g.renderer, P = TL.Post, R = TL.Render, F = P.flags, t = P.tier, cfg = R.cfg, keys = Object.keys(F);
          const wait = (ms) => new Promise((x) => setTimeout(x, ms));
          // Variants are interleaved frame by frame (orig, neutral, full, orig, ...) inside every batch so GPU clock / thermal state is shared by all of
          // them; batches hold 24 'full' frames = one whole probe cycle (6 faces x period 4). Per stage the MEDIAN batch is reported.
          const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
          const gl = r.getContext(), tq = BENCH.tq;
          const on = () => { P.tier = t; R.cfg = cfg; for (const k of keys) F[k] = 1; };
          const off = () => { P.tier = t; R.cfg = null; for (const k of keys) F[k] = 0; };
          const per = { full: {}, neutral: {}, orig: [] };
          for (let b = 0; b < frames / 24; b++) {
            const acc = { full: {}, neutral: {}, orig: 0 }, origQ = [];
            for (let i = 0; i < 24; i++) {
              for (const v of ['orig', 'neutral', 'full']) {
                if (v === 'orig') { P.tier = 0; const q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); BENCH.render(); gl.endQuery(tq.TIME_ELAPSED_EXT); origQ.push(q); P.tier = t; continue; }
                (v === 'full' ? on : off)(); P.prof = { q: [] }; BENCH.render(); (acc[v].q = acc[v].q || []).push(...P.prof.q); P.prof = null;
              }
              if (i % 4 === 3) BENCH.sync();
            }
            BENCH.sync(); await wait(0);
            for (const v of ['neutral', 'full']) {
              let ok = true; const sum = {};
              for (const [k, q] of acc[v].q || []) { let tries = 0; while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && tries++ < 300) await wait(10); sum[k] = (sum[k] || 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q); }
              for (const k in sum) (per[v][k] = per[v][k] || []).push(sum[k] / 24);
            }
            let o = 0; for (const q of origQ) { let tries = 0; while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && tries++ < 300) await wait(10); o += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q); }
            per.orig.push(o / 24);
            if (gl.isContextLost()) throw new Error('context lost');
          }
          on();
          const sumUp = (o) => { const acc = {}; for (const k in o) acc[k] = +med(o[k]).toFixed(3); acc.total = +Object.values(acc).reduce((x, y) => x + y, 0).toFixed(3); return acc; };
          return { full: sumUp(per.full), neutral: sumUp(per.neutral), orig: +med(per.orig).toFixed(3) };
        }, frames);
        out[q + '/' + sc] = res;
        const f = res.full, n = res.neutral;
        console.log(`${q}/${sc}: orig frame ${res.orig} ms | stack full ${f.total} | neutral ${n.total}`);
        console.log('   ' + Object.keys(f).filter((k) => k !== 'total').map((k) => `${k} ${f[k]}${n[k] !== undefined ? ' (neutral ' + n[k] + ')' : ''}`).join(' | '));
      }
    }
    fs.mkdirSync('shots', { recursive: true }); fs.writeFileSync(path.join('shots', 'perf.json'), JSON.stringify(out, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
