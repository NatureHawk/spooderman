/* dump the reflection probe as equirect images (rgb and alpha): node probeview.js --scene waterfront --out shots/probe */
'use strict';
const fs = require('fs'), path = require('path');
const { launch, start, setScene, SCENES } = require('../graphics_bench/lib');
Object.assign(SCENES, require('./scenes.json'));
const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
(async () => {
  const { browser, page } = await launch({ headless: true, w: 1024, h: 512 });
  try {
    await start(page, args.html || 'THREADLINE.html', args.quality || 'ultra');
    await setScene(page, args.scene || 'waterfront');
    await page.evaluate((all) => { for (let i = 0; i < 16; i++) { BENCH.render(); BENCH.sync(); } if (all) { const P = TL.Render, g = TL.game; P._center.copy(g.camera.position); for (let f = 0; f < 6; f++) P.captureFace(g.renderer, g.scene, g.camera, f); BENCH.sync(); } }, !!args.all);
    fs.mkdirSync(args.out || 'shots/probe', { recursive: true });
    for (const mode of ['rgb', 'alpha']) {
      await page.evaluate((mode) => {
        const g = TL.game, r = g.renderer, P = TL.Render;
        const m = new THREE.ShaderMaterial({ uniforms: { t: { value: P.probe.texture }, a: { value: mode === 'alpha' ? 1 : 0 } }, depthTest: false, toneMapped: false,
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }',
          fragmentShader: 'varying vec2 vUv; uniform samplerCube t; uniform float a; void main(){ float lon = (vUv.x - 0.5) * 6.2831853, lat = (vUv.y - 0.5) * 3.14159265; vec3 d = vec3(sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat)); vec4 c = textureLod(t, d, 0.0); gl_FragColor = a > 0.5 ? vec4(vec3(c.a), 1.) : vec4(pow(clamp(c.rgb,0.,1.), vec3(1./2.2)), 1.); }' });
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
        const s = new THREE.Scene(); s.add(new THREE.Mesh(geo, m)); s.children[0].frustumCulled = false;
        r.setRenderTarget(null); r.render(s, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); BENCH.sync();
      }, mode);
      await page.screenshot({ path: path.join(args.out || 'shots/probe', (args.scene || 'waterfront') + '_' + mode + '.png') });
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
