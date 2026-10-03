/* GPU regressions: HDR solar highlights stay bright; facade reflections remain continuous at the horizon. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { launch } = require('../graphics_bench/lib');
(async () => {
  const { browser, page } = await launch({ headless: true, w: 256, h: 64 });
  try {
    await page.goto('data:text/html,<script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>');
    await page.waitForFunction(() => window.THREE);
    await page.evaluate(() => {
      window.TL = { Game: function () {}, Environment: function () {}, Comic: { render() {} } };
      TL.Game.prototype.applyQuality = function () {};
      TL.Game.prototype.startGame = function () {};
      TL.Environment.prototype.update = function () {};
    });
    for (const file of ['20_atmos.js', '21_post.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8') });
    const reflectionSources = ['03d_facade.js', '03l_buildings.js', '03f_replace.js'].map(file => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'));
    const result = await page.evaluate((reflectionSources) => {
      const r = new THREE.WebGLRenderer({ antialias: false });
      r.setSize(8, 1); document.body.appendChild(r.domElement);
      TL.Post.init(r);
      const values = [0.2, 0.5, 0.9, 1, 2, 4, 8, 14];
      const data = new Float32Array(values.flatMap(v => [v, v * 0.94, v * 0.8, 1]));
      const tex = new THREE.DataTexture(data, 8, 1, THREE.RGBAFormat, THREE.FloatType);
      tex.needsUpdate = true;
      const mat = TL.Post.mats.comp, U = mat.uniforms;
      for (const name of ['tScene', 'tBloom', 'tAO', 'tDepth', 'tRays', 'tSSR']) U[name].value = tex;
      U.uContrast.value = 0.2;
      U.uGradeMix.value = 1;
      U.uRes.value.set(8, 1);
      U.uShadowTint.value.set(0.95, 0.985, 1.06);
      U.uHighTint.value.set(1.05, 1, 0.95);
      U.uSat.value = 1.07;
      const target = new THREE.WebGLRenderTarget(8, 1);
      TL.Post.quad.material = mat;
      r.setRenderTarget(target); r.render(TL.Post.scene, TL.Post.cam);
      const pixels = new Uint8Array(32); r.readRenderTargetPixels(target, 0, 0, 8, 1, pixels);
      const reflectionPixels = [];
      for (const source of reflectionSources) {
        const expr = source.match(/vec3 (?:rpSky|sky) = mix\(uSkyH[^;]+;\s*(?:rpSky|sky) = mix[^;]+;/)[0];
        const output = expr.includes('rpSky') ? 'rpSky' : 'sky';
        const reflectMat = TL.Post.fsMat(`varying vec2 vUv;
          void main() {
            vec3 uSkyH = vec3(0.5), uSkyZ = vec3(0.2, 0.3, 0.6);
            float y = (vUv.x - 0.5) * 0.002;
            vec3 Rr = vec3(0.0, y, 0.0), rpR = Rr;
            ${expr}
            gl_FragColor = vec4(${output}, 1.0);
          }`, {});
        TL.Post.quad.material = reflectMat;
        r.render(TL.Post.scene, TL.Post.cam);
        const p = new Uint8Array(32); r.readRenderTargetPixels(target, 0, 0, 8, 1, p);
        reflectionPixels.push(Array.from(p));
      }
      return { pixels: Array.from(pixels), reflectionPixels, glError: r.getContext().getError() };
    }, reflectionSources);
    assert.equal(result.glError, 0, 'GPU error');
    for (let i = 1; i < 8; i++) for (let c = 0; c < 3; c++) assert(result.pixels[i * 4 + c] >= result.pixels[(i - 1) * 4 + c], 'HDR grade inverted a brighter highlight');
    assert.deepEqual(result.pixels.slice(-4), [255, 255, 255, 255], 'sun core must stay white');
    for (const pixels of result.reflectionPixels) for (let c = 0; c < 3; c++) assert(Math.abs(pixels[12 + c] - pixels[16 + c]) <= 2, 'reflection horizon has a brightness step');
    assert(!page.errors.length, page.errors.join('\n'));
    console.log('PASS: GPU HDR highlights stay monotonic through 14x white; solar core is white; all three facade reflection shaders cross the horizon continuously, without WebGL errors.');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
