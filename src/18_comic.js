/* =====================================================================================
   COMIC FILTER — cel-shaded comic-book post process (off by default).
     [0]  cycles the 60s comic look:        off -> light -> medium -> full -> off
          (bold black ink, posterised flat colour, saturated print palette, halftone dots in the shadows, paper tone)
     [9]  cycles the Ultimate Spider-Man look: off -> light -> medium -> full -> off
          (painterly flattening (Kuwahara), soft 3-band cel shading, punchy colour, dark-tinted outlines)
   One extra render target (colour + depth); outlines come from depth only (silhouettes = relative depth jumps, creases =
   Laplacian of inverse depth, which is zero on any flat surface) plus colour edges for interior ink, faded with distance.
   r149 tone-maps into render targets but leaves them linear, so the pass ends with the sRGB conversion.
   ===================================================================================== */
'use strict';

TL.Comic = {
  style: 0, level: 0,                       // style 0 off | 1 = 60s | 2 = Ultimate
  NAMES: ['', '60s comic', 'Ultimate comic'], LEVELS: ['', 'light', 'medium', 'full'],
  rt: null, quad: null, cam: null, mat: null, _sz: null,
  init(r) {
    const gl2 = r.capabilities.isWebGL2;
    this._sz = new THREE.Vector2();
    r.getDrawingBufferSize(this._sz);
    this.rt = new THREE.WebGLRenderTarget(this._sz.x, this._sz.y, { type: THREE.HalfFloatType, depthBuffer: true, samples: gl2 ? 4 : 0 });
    this.rt.depthTexture = new THREE.DepthTexture(this._sz.x, this._sz.y, THREE.UnsignedIntType);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, uRes: { value: new THREE.Vector2() },
        uNear: { value: 0.1 }, uFar: { value: 2400 }, uStyle: { value: 1 }, uStr: { value: 1 }, uScale: { value: 1 }, uNight: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: TL.Comic.FRAG, depthTest: false, depthWrite: false, toneMapped: false,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(g, this.mat); this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
  },
  /* per-frame filter uniforms; the post stack (21_post.js) also uses this to feed the filter its own colour + depth */
  setUniforms(r, camera) {
    if (!this.rt) this.init(r);
    r.getDrawingBufferSize(this._sz);
    const U = this.mat.uniforms;
    U.uRes.value.copy(this._sz); U.uNear.value = camera.near; U.uFar.value = camera.far;
    U.uStyle.value = this.style; U.uStr.value = [0, 0.45, 0.75, 1][this.level];
    U.uScale.value = Math.max(1, this._sz.y / 720);
    U.uNight.value = (TL.game && TL.game.env && TL.game.env.night) || 0;
    return U;
  },
  render(r, scene, camera) {
    if (!this.style || !this.level) { TL.ComicLin.value = 0; r.render(scene, camera); return; }
    if (!this.rt) this.init(r);
    r.getDrawingBufferSize(this._sz);
    if (this.rt.width !== this._sz.x || this.rt.height !== this._sz.y) this.rt.setSize(this._sz.x, this._sz.y);
    this.setUniforms(r, camera);
    TL.ComicLin.value = 1;
    const weather = TL.game && TL.game.rain;
    const rainVisible = weather && weather.mesh.visible, snowVisible = weather && weather.snow.visible;
    if (weather) { weather.mesh.visible = false; weather.snow.visible = false; }
    try { r.setRenderTarget(this.rt); r.render(scene, camera); }
    finally { if (weather) { weather.mesh.visible = rainVisible; weather.snow.visible = snowVisible; } }
    r.setRenderTarget(null); r.render(this.scene, this.cam);
    TL.ComicLin.value = 0;
    if (weather && (rainVisible || snowVisible)) weather.renderOverlay(r, camera, this.rt.depthTexture);
  },
  cycle(style) {
    if (this.style !== style) { this.style = style; this.level = 1; }
    else if (++this.level > 3) { this.style = 0; this.level = 0; }
    const msg = this.style ? 'Comic filter: ' + this.NAMES[this.style] + ' — ' + this.LEVELS[this.level] : 'Comic filter: off';
    if (TL.game && TL.game.ui) TL.game.ui.toast(msg);
  },
};
/* raw additive shaders (particles, street glows) write display values; inside the comic target they are linearised first */
TL.ComicLin = { value: 0 };

window.addEventListener('keydown', (e) => {
  const g = TL.game; if (!g || (g.state !== 'play' && g.state !== 'paused') || e.repeat) return;
  if (g.input && g.input.rebinding) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.code === 'Digit0' || e.code === 'Numpad0') TL.Comic.cycle(1);
  else if (e.code === 'Digit9' || e.code === 'Numpad9') TL.Comic.cycle(2);
});

TL.Comic.FRAG = (/* glsl */`
varying vec2 vUv;
uniform sampler2D tColor, tDepth;
uniform vec2 uRes; uniform float uNear, uFar, uStyle, uStr, uScale, uNight;

float dist(vec2 uv) { float d = texture2DLodEXT(tDepth, uv, 0.0).x; return uNear * uFar / (uFar - d * (uFar - uNear)); }
vec3 toSRGB(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, step(c, vec3(0.0031308))); }
vec3 col(vec2 uv) { return toSRGB(texture2DLodEXT(tColor, uv, 0.0).rgb); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 sat(vec3 c, float s) { float l = luma(c); return clamp(mix(vec3(l), c, s), 0.0, 1.0); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

/* painterly flattening: 4-quadrant Kuwahara, radius 2 (pick the quadrant with the lowest variance).
   The four 3x3 quadrants overlap on a 5x5 grid: each of the 25 distinct taps is fetched + sRGB-converted once (was 36) and added
   straight into every quadrant that contains it. Taps stream row |y| = 0,1,2 / column |x| = 0,1,2, so each quadrant still sums
   its 9 taps in the original j-outer / i-inner order (bit-identical result) with only 8 accumulators live. Unrolled by the
   generator at the end of this file. */
vec3 kuwahara(vec2 uv, vec2 px) {
KUWA_BODY
}

void main() {
  vec2 px = 1.0 / uRes;
  vec3 src = col(vUv);
  float z = dist(vUv);
  bool sky = z > uFar * 0.95;
  float s60 = step(0.5, uStyle) * step(uStyle, 1.5);           // 1 = 60s, else Ultimate

  /* ---------------- outlines */
  float th = (s60 > 0.5 ? 1.5 : 1.1) * uScale * mix(0.8, 1.0, uStr);
  vec2 o = px * th;
  float zl = dist(vUv - vec2(o.x, 0.0)), zr = dist(vUv + vec2(o.x, 0.0)), zd = dist(vUv - vec2(0.0, o.y)), zu = dist(vUv + vec2(0.0, o.y));
  float jump = max(max(zl - z, zr - z), max(zd - z, zu - z)) / z;               // only the near side of a depth step gets ink
  float sil = smoothstep(0.06, 0.16, jump);
  float iz = 1.0 / z;
  float lap = abs(1.0 / zl + 1.0 / zr + 1.0 / zu + 1.0 / zd - 4.0 * iz) / iz;     // 0 on planes, spikes on creases
  float crease = smoothstep(0.012, 0.045, lap) * (1.0 - sil);
  // colour edges: interior ink (Sobel on luminance)
  float tl = luma(col(vUv + vec2(-o.x, o.y))), tc = luma(col(vUv + vec2(0.0, o.y))), tr = luma(col(vUv + vec2(o.x, o.y)));
  float ml = luma(col(vUv - vec2(o.x, 0.0))), mr = luma(col(vUv + vec2(o.x, 0.0)));
  float bl = luma(col(vUv - o)), bc = luma(col(vUv - vec2(0.0, o.y))), br = luma(col(vUv + vec2(o.x, -o.y)));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br, gy = tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
  float cedge = smoothstep(s60 > 0.5 ? 0.32 : 0.45, s60 > 0.5 ? 0.6 : 0.8, length(vec2(gx, gy)));
  float near = 1.0 - smoothstep(60.0, 420.0, z);                                   // detail ink only up close
  float far = 1.0 - smoothstep(500.0, 1400.0, z);
  float ink = max(sil * far, max(crease * near * 0.9, cedge * near * (s60 > 0.5 ? 0.85 : 0.55)));
  if (sky) ink = 0.0;
  ink *= uStr;

  /* ---------------- colour */
  vec3 c;
  if (s60 > 0.5) {
    // print palette: flat fills from a posterised LUMINANCE (hue kept: no colour banding), saturated inks, halftone dots in the
    // mid-shadows, deep blacks only in the darkest pockets, warm paper
    vec3 b = src;
    float L = max(luma(b), 1e-3);
    float levels = mix(6.0, 4.0, uStr);
    float Lq = (floor(L * levels) + 0.5) / levels;
    Lq = mix(L, Lq, 0.8);
    vec3 flatC = b * (Lq / L);
    c = sat(flatC, mix(1.35, 1.6, uStr));
    // halftone: 45-degree dot screen, dots grow toward the shadows
    float cell = 5.0 * uScale;
    vec2 p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / cell;
    vec2 f = fract(p) - 0.5;
    float tone = smoothstep(0.55, 0.12, L);                       // 0 in the light, 1 in deep shadow
    float rad = sqrt(tone) * 0.6, aa = 0.07;
    float dotm = (1.0 - smoothstep(rad - aa, rad + aa, length(f))) * step(0.02, tone);
    c = mix(c, c * 0.3, dotm * 0.8);
    c = mix(c, vec3(0.03, 0.025, 0.04), smoothstep(0.07, 0.02, L) * 0.85);   // solid blacks only in the deepest pockets
    // paper: warm tint + fibre grain in the light areas
    vec3 paper = vec3(1.0, 0.965, 0.885);
    c = c * mix(vec3(1.0), paper, 0.55) + (h21(floor(gl_FragCoord.xy / (1.5 * uScale))) - 0.5) * 0.03 * smoothstep(0.4, 0.9, L);
    if (sky) c = mix(sat(src, 1.2), sat(src, 1.2) * paper, 0.5);
  } else {
    // Ultimate: painterly flat regions, soft 3-band cel shading, punchy colour
    vec3 k = kuwahara(vUv, px * uScale * mix(0.8, 1.2, uStr));
    float L = luma(k);
    float band = L < 0.18 ? 0.12 : L < 0.45 ? 0.36 : L < 0.75 ? 0.62 : 0.88;
    float soft = mix(L, band, mix(0.6, 0.85, uStr));
    vec3 cel = k * (soft / max(L, 1e-3));
    c = sat(mix(k, cel, 0.8), mix(1.25, 1.45, uStr));
    c = mix(c, c * vec3(0.92, 0.95, 1.08), 0.25 * smoothstep(0.45, 0.1, L));   // cool shadows
    if (sky) c = sat(k, 1.15);
  }
  c = mix(src, c, uStr);

  /* ---------------- ink */
  vec3 inkCol = s60 > 0.5 ? vec3(0.03, 0.025, 0.02) : mix(vec3(0.06, 0.04, 0.09), vec3(0.02, 0.02, 0.05), uNight);
  c = mix(c, inkCol, clamp(ink, 0.0, 1.0));
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`).replace('KUWA_BODY', (() => {
  // quadrant q: dir = (q == 1 || q == 3 ? +1 : -1, q >= 2 ? +1 : -1); it holds tap (x, y) when x * dir.x >= 0 && y * dir.y >= 0
  const NL = String.fromCharCode(10), D = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  let b = '  vec3 c, s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0), q0 = vec3(0.0), q1 = vec3(0.0), q2 = vec3(0.0), q3 = vec3(0.0);' + NL;
  for (let j = 0; j <= 2; j++) for (const y of j ? [-j, j] : [0]) for (let i = 0; i <= 2; i++) for (const x of i ? [-i, i] : [0]) {
    b += '  c = col(uv + vec2(' + x.toFixed(1) + ', ' + y.toFixed(1) + ') * px);';
    for (let q = 0; q < 4; q++) if (x * D[q][0] >= 0 && y * D[q][1] >= 0) b += ' s' + q + ' += c; q' + q + ' += c * c;';
    b += NL;
  }
  b += '  vec3 m[4]; float v[4]; vec3 var;' + NL;
  for (let q = 0; q < 4; q++) b += '  s' + q + ' /= 9.0; q' + q + ' /= 9.0; m[' + q + '] = s' + q + '; var = abs(q' + q + ' - s' + q + ' * s' + q + '); v[' + q + '] = var.r + var.g + var.b;' + NL;
  b += '  vec3 best = m[0]; float bv = v[0];' + NL + '  for (int q = 1; q < 4; q++) if (v[q] < bv) { bv = v[q]; best = m[q]; }' + NL + '  return best;';
  return b;
})());
