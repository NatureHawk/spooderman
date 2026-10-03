/* =====================================================================================
   POST STACK — HDR-tailed scene pass, ambient occlusion, bloom, colour grade, vignette, grain, light shafts, comic hand-off.
     low     the original look, untouched (this module stands down: the original render path runs, nothing here is bound)
     medium  bloom (5 levels) + colour grade + vignette
     high    + ambient occlusion (GTAO, half res, 1 slice) + light shafts (via the atmosphere tier) + sky probe API
     ultra   + 2-slice AO + 7-level bloom + film grain
   Pipeline (all half-float, MSAA scene target):
     scene -> sceneRT (colour + depth texture)           the target is flagged like an XR target so r149 keeps the screen's sRGB output
                                                           encoding inside it: every shader (fog and blending included) then writes exactly
                                                           what it writes to the canvas, i.e. display values. The tone curve is ACES exactly as
                                                           before plus a soft tail above white, kept >1 in the half-float target, so bloom can
                                                           tell a glint from a white wall. With every effect off the image equals the original.
     AO     depth -> half-res GTAO (normals rebuilt from depth: correct for scan buildings, instanced kits and skinned heroes alike,
            because depth is what was actually drawn) -> depth-aware blur -> bilateral upsample in the composite
     bloom  soft-knee threshold + Karis average -> 13-tap dual-filter pyramid -> tent upsample; the composite removes the bright part
            from the image and adds the blurred copy back, so total energy is conserved
     SSR    (ultra) half-res depth ray march on water and on wet, upward-facing ground; hit colour comes from the scene colour target
            itself, the result REPLACES a Fresnel-weighted fraction of the pixel (the probe/analytic sky is already in it), so nothing doubles
     comp   SSR, AO * image + bloom + shafts -> grade -> vignette -> grain, to the screen
            (or, with the comic filter on, converted to linear into a target the comic filter then reads: TL.Comic.setUniforms)
   Sky pixels (depth == 1) are never darkened and never contribute occlusion; AO blur/upsample weights are depth aware, so there is
   no halo around silhouettes against the sky or a distant background.
   ===================================================================================== */
'use strict';

TL.Post = {
  tier: 0, cfg: null,
  samples: 4,                                          // MSAA samples of the scene target
  defaultHour: 17.5,                                   // new games start in golden hour (17:30) from medium up
  TIER: { low: 0, medium: 1, high: 2, ultra: 3 },
  TIERS: [null,
    { name: 'medium', bloom: { levels: 4, k: 0.40, thr: 0.94, knee: 0.05, scatter: 0.62 }, vig: 0.08, grain: 0, ao: null },
    { name: 'high', bloom: { levels: 5, k: 0.42, thr: 0.94, knee: 0.05, scatter: 0.64 }, vig: 0.1, grain: 0,
      ao: { slices: 1, steps: 6, radius: 2.2, power: 1.25, strength: 1.0 } },
    { name: 'ultra', bloom: { levels: 6, k: 0.45, thr: 0.94, knee: 0.05, scatter: 0.66 }, vig: 0.12, grain: 0.03,
      ao: { slices: 2, steps: 8, radius: 2.6, power: 1.3, strength: 1.0 }, ssr: { steps: 40, maxDist: 320, strength: 0.7 } },
  ],
  /* per-effect switches (benchmarks and A/B diffs flip these; 1 = on if the tier has it) */
  flags: { ao: 1, bloom: 1, grade: 1, vignette: 1, grain: 1, shafts: 1, ssr: 1 },
  tail: { knee: 4.0, gain: 0.08 },                     // soft highlight tail above ACES white (exposed radiance units)
};

/* ------------------------------------------------------------------ custom tone curve: ACES + highlight tail */
{
  const T = TL.Post.tail;
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    'vec3 CustomToneMapping( vec3 color ) { return ACESFilmicToneMapping( color ) + ' + T.gain.toFixed(4) + ' * max( color * toneMappingExposure - ' + T.knee.toFixed(2) + ', 0.0 ); }');
}

/* ------------------------------------------------------------------ shaders */
TL.Post.VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

TL.Post.GLSL_COMMON = `
float tlLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 tlToSRGB(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, step(c, vec3(0.0031308))); }
vec3 tlFromSRGB(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045))); }
float tlIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
/* bloom works in a pseudo-HDR space: the display value is run back up a Reinhard curve (c = H / (1 + H)), so a window or lamp that the tone
   curve clipped at ~1.0 carries the energy it really had; blurred copies are added back in that space and the result is mapped down again.
   Anything the bloom does not touch round-trips exactly. Values above 0.992 (the highlight tail) continue linearly. */
float tlToH1(float c) { c = max(c, 0.0); return c < 0.992 ? c / (1.0 - c) : 124.0 * c / 0.992; }
float tlFromH1(float h) { h = max(h, 0.0); return h < 124.0 ? h / (1.0 + h) : 0.992 * h / 124.0; }
// applied to the brightest channel and carried over by ratio, so hue never shifts
vec3 tlToH(vec3 c) { c = max(c, 0.0); float m = max(max(c.r, c.g), c.b); return m < 1e-4 ? c : c * (tlToH1(m) / m); }
vec3 tlFromH(vec3 h) { h = max(h, 0.0); float m = max(max(h.r, h.g), h.b); return m < 1e-4 ? h : h * (tlFromH1(m) / m); }
vec3 tlBright(vec3 c, float thr, float knee) {                       // the part of the image that glows (in H units): pixels above the threshold, soft shoulder
  float br = max(max(c.r, c.g), c.b);
  return min(tlToH(c), vec3(400.0)) * smoothstep(thr - knee, thr + knee, br);
}`;

/* ---- bloom: first level = soft threshold + Karis-weighted 13-tap, then plain 13-tap; upsample = 3x3 tent */
TL.Post.DOWN_FRAG = `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr, uKnee;
${TL.Post.GLSL_COMMON}
vec3 smp(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
#ifdef PREFILTER
  c = tlBright(c, uThr, uKnee);
#endif
  return c;
}
void main() {
  vec3 a = smp(vec2(-2.0, -2.0)), b = smp(vec2(0.0, -2.0)), c = smp(vec2(2.0, -2.0));
  vec3 d = smp(vec2(-2.0, 0.0)), e = smp(vec2(0.0, 0.0)), f = smp(vec2(2.0, 0.0));
  vec3 g = smp(vec2(-2.0, 2.0)), h = smp(vec2(0.0, 2.0)), i = smp(vec2(2.0, 2.0));
  vec3 j = smp(vec2(-1.0, -1.0)), k = smp(vec2(1.0, -1.0)), l = smp(vec2(-1.0, 1.0)), m = smp(vec2(1.0, 1.0));
#ifdef PREFILTER
  vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
  float w0 = 0.125 / (1.0 + tlLuma(g0)), w1 = 0.125 / (1.0 + tlLuma(g1)), w2 = 0.125 / (1.0 + tlLuma(g2)), w3 = 0.125 / (1.0 + tlLuma(g3)), w4 = 0.5 / (1.0 + tlLuma(g4));
  gl_FragColor = vec4((g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4), 1.0);
#else
  gl_FragColor = vec4((a + b + d + e) * 0.03125 + (b + c + e + f) * 0.03125 + (d + e + g + h) * 0.03125 + (e + f + h + i) * 0.03125 + (j + k + l + m) * 0.125, 1.0);
#endif
}`;
TL.Post.UP_FRAG = `
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uScatter;
void main() {
  vec2 t = uTexel;
  vec3 s = texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb;
  s += 2.0 * (texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb);
  s += 4.0 * texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4(s * (uScatter / 16.0), 1.0);
}`;

/* ---- ambient occlusion: GTAO (Jimenez et al. 2016) with the XeGTAO falloff, normals from depth */
TL.Post.AO_FRAG = `
varying vec2 vUv; uniform sampler2D tDepth; uniform vec2 uRes, uTan;
uniform float uNear, uFar, uRadius, uFocal, uPower, uStrength, uSunK, uFadeNear, uFadeFar; uniform vec3 uSunV;
${TL.Post.GLSL_COMMON}
#define PI 3.14159265
float linZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
vec3 vp(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTan * z, -z); }
float zAt(vec2 uv) { return linZ(textureLod(tDepth, uv, 0.0).x); }
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 >= 0.999999) { gl_FragColor = vec4(1.0, uFar, 0.0, 1.0); return; }          // sky: no AO, far depth so blurs never reach it
  float zC = linZ(d0);
  if (zC > uFadeFar) { gl_FragColor = vec4(1.0, zC, 0.0, 1.0); return; }
  float rpx = min(uRadius * uFocal / zC, 140.0);                                     // radius in full-res pixels
  if (rpx < 2.5) { gl_FragColor = vec4(1.0, zC, 0.0, 1.0); return; }
  vec3 P = vp(vUv, zC);
  vec2 px = 1.0 / uRes;
  // normal from depth: per axis use the neighbour with the smaller depth step (no smearing over silhouettes)
  float zL = zAt(vUv - vec2(px.x, 0.0)), zR = zAt(vUv + vec2(px.x, 0.0)), zD = zAt(vUv - vec2(0.0, px.y)), zU = zAt(vUv + vec2(0.0, px.y));
  vec3 dX = abs(zL - zC) < abs(zR - zC) ? P - vp(vUv - vec2(px.x, 0.0), zL) : vp(vUv + vec2(px.x, 0.0), zR) - P;
  vec3 dY = abs(zD - zC) < abs(zU - zC) ? P - vp(vUv - vec2(0.0, px.y), zD) : vp(vUv + vec2(0.0, px.y), zU) - P;
  vec3 N = normalize(cross(dX, dY));
  vec3 V = normalize(-P);
  if (dot(N, V) < 0.0) N = -N;
  float fRange = 0.615 * uRadius, fMul = -1.0 / fRange, fAdd = (uRadius - fRange) / fRange + 1.0;
  float n1 = tlIGN(gl_FragCoord.xy), n2 = tlIGN(gl_FragCoord.yx + 17.0);
  float vis = 0.0;
  for (int s = 0; s < SLICES; s++) {
    float phi = (float(s) + n1) * PI / float(SLICES);
    vec2 om = vec2(cos(phi), sin(phi));
    vec3 dir3 = vec3(om, 0.0);
    vec3 ortho = dir3 - dot(dir3, V) * V;
    vec3 axis = normalize(cross(ortho, V));
    vec3 pN = N - axis * dot(N, axis);
    float pl = length(pN);
    float sg = sign(dot(ortho, pN));
    float cosN = clamp(dot(pN, V) / max(pl, 1e-5), 0.0, 1.0);
    float n = sg * acos(cosN);
    float lc0 = cos(n + PI * 0.5), lc1 = cos(n - PI * 0.5);
    float hc0 = lc0, hc1 = lc1;
    for (int k = 0; k < STEPS; k++) {
      float t = (float(k) + n2) / float(STEPS); t *= t;
      vec2 off = om * (t * rpx + 1.5) * px;
      vec2 u0 = vUv + off, u1 = vUv - off;
      vec3 e0 = vp(u0, zAt(u0)) - P, e1 = vp(u1, zAt(u1)) - P;
      float l0 = max(length(e0), 1e-4), l1 = max(length(e1), 1e-4);
      float w0 = clamp(l0 * fMul + fAdd, 0.0, 1.0), w1 = clamp(l1 * fMul + fAdd, 0.0, 1.0);   // far occluders fade out: no halos, no over-darkening
      hc0 = max(hc0, mix(lc0, dot(e0, V) / l0, w0));
      hc1 = max(hc1, mix(lc1, dot(e1, V) / l1, w1));
    }
    pl = mix(pl, 1.0, 0.05);
    float h0 = -acos(clamp(hc1, -1.0, 1.0)), h1 = acos(clamp(hc0, -1.0, 1.0));
    h0 = n + clamp(h0 - n, -PI * 0.5, PI * 0.5); h1 = n + clamp(h1 - n, -PI * 0.5, PI * 0.5);
    vis += pl * ((cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) + (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n))) * 0.25;
  }
  float ao = pow(clamp(vis / float(SLICES), 0.0, 1.0), uPower);
  ao = 1.0 - (1.0 - ao) * uStrength;
  float sunF = clamp(dot(N, uSunV), 0.0, 1.0) * uSunK;                                // direct sun already lights this face: occlude less
  ao = 1.0 - (1.0 - ao) * (1.0 - 0.5 * sunF);
  ao = mix(1.0, ao, 1.0 - smoothstep(uFadeNear, uFadeFar, zC));
  gl_FragColor = vec4(ao, zC, 0.0, 1.0);
}`;
TL.Post.AOBLUR_FRAG = `
varying vec2 vUv; uniform sampler2D tAO; uniform vec2 uDir;
void main() {
  vec2 c = texture2D(tAO, vUv).rg;
  float sum = c.x, ws = 1.0, tol = 0.012 * c.y + 0.03;
  for (int i = 1; i <= 3; i++) {
    float g = exp(-float(i * i) * 0.22);
    vec2 a = textureLod(tAO, vUv + uDir * float(i), 0.0).rg, b = textureLod(tAO, vUv - uDir * float(i), 0.0).rg;
    float wa = g * exp(-abs(a.y - c.y) / tol), wb = g * exp(-abs(b.y - c.y) / tol);
    sum += a.x * wa + b.x * wb; ws += wa + wb;
  }
  gl_FragColor = vec4(sum / ws, c.y, 0.0, 1.0);
}`;

/* ---- screen-space reflections: water + wet ground, normals from depth, perspective-correct linear march + binary refinement */
TL.Post.SSR_FRAG = `
varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform vec2 uRes, uTan;
uniform float uNear, uFar, uWet, uTime, uWaterY, uMaxDist, uStrength; uniform mat3 uV2W, uW2V; uniform vec3 uCamPos;
${TL.Post.GLSL_COMMON}
float linZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
vec3 vp(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTan * z, -z); }
float zAt(vec2 uv) { return linZ(textureLod(tDepth, uv, 0.0).x); }
vec2 proj(vec3 p) { return (p.xy / (-p.z)) / uTan * 0.5 + 0.5; }
float hn(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hn(i), hn(i + vec2(1, 0)), f.x), mix(hn(i + vec2(0, 1)), hn(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  gl_FragColor = vec4(0.0);
  if (d0 >= 0.999999) return;
  float zC = linZ(d0);
  vec3 P = vp(vUv, zC);
  vec2 px = 1.0 / uRes;
  float zL = zAt(vUv - vec2(px.x, 0.0)), zR = zAt(vUv + vec2(px.x, 0.0)), zD = zAt(vUv - vec2(0.0, px.y)), zU = zAt(vUv + vec2(0.0, px.y));
  vec3 dX = abs(zL - zC) < abs(zR - zC) ? P - vp(vUv - vec2(px.x, 0.0), zL) : vp(vUv + vec2(px.x, 0.0), zR) - P;
  vec3 dY = abs(zD - zC) < abs(zU - zC) ? P - vp(vUv - vec2(0.0, px.y), zD) : vp(vUv + vec2(0.0, px.y), zU) - P;
  vec3 N = normalize(cross(dX, dY));
  vec3 Nw = normalize(uV2W * N), Pw = uCamPos + uV2W * P;
  float water = (abs(Pw.y - uWaterY) < 0.35 && Nw.y > 0.9) ? 1.0 : 0.0;
  float wet = uWet * smoothstep(0.93, 0.985, Nw.y) * (1.0 - water);
  float m = max(water, wet * 0.55);
  if (m < 0.01) return;
  // the depth normal is flat: bend it with the surface's own ripples (waves on water, puddle shimmer on wet ground)
  vec2 q = Pw.xz; float dist = zC;
  vec2 g = water > 0.5
    ? vec2(sin(q.x * 0.9 + uTime * 1.1) + 0.6 * sin(q.x * 2.3 - q.y * 1.7 + uTime * 1.9), sin(q.y * 1.1 + uTime * 0.8) + 0.6 * sin(q.y * 2.7 + q.x * 1.3 + uTime * 1.5)) * (0.045 / (1.0 + dist * 0.012))
    : (vec2(vn(q * 3.0), vn(q * 3.0 + 17.0)) - 0.5) * 0.05;
  vec3 Nv = normalize(uW2V * normalize(Nw + vec3(g.x, 0.0, g.y)));
  vec3 V = normalize(-P);
  float NV = max(dot(Nv, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
  vec3 R = normalize(reflect(-V, Nv));
  if (R.z > -0.02) return;                                                            // heading back toward the camera: nothing on screen to hit
  float tEnd = uMaxDist;
  if (P.z + R.z * tEnd > -uNear) tEnd = (-uNear - P.z) / R.z * 0.99;
  vec3 P1 = P + R * tEnd;
  vec2 s0 = proj(P), s1 = proj(P1);
  float k0 = 1.0 / (-P.z), k1 = 1.0 / (-P1.z);
  float jit = tlIGN(gl_FragCoord.xy);
  float tPrev = 0.0, tHit = -1.0;
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.3 + 0.7 * jit) / float(STEPS); t = t * t * 0.6 + t * 0.4;     // denser near the surface
    vec2 suv = mix(s0, s1, t);
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float rz = 1.0 / mix(k0, k1, t);
    float diff = rz - zAt(suv);
    if (diff > 0.0 && diff < max(0.6, rz * 0.04)) {
      float lo = tPrev, hi = t;
      for (int j = 0; j < 5; j++) { float mid = 0.5 * (lo + hi); float rzm = 1.0 / mix(k0, k1, mid); if (rzm - zAt(mix(s0, s1, mid)) > 0.0) hi = mid; else lo = mid; }
      tHit = hi; break;
    }
    tPrev = t;
  }
  if (tHit < 0.0) return;
  vec2 huv = mix(s0, s1, tHit);
  if (textureLod(tDepth, huv, 0.0).x >= 0.999999) return;                            // the sky is already in the pixel (probe / analytic sky)
  vec2 e = abs(huv - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.75, 1.0, max(e.x, e.y));
  float far = 1.0 - smoothstep(0.5, 1.0, tHit);
  // rough surfaces smear their reflection with distance travelled: a small cross filter that grows with the ray length (and with wetness' roughness)
  vec2 bl = px * (1.5 + 10.0 * tHit) * (water > 0.5 ? 0.6 : 1.0);
  vec3 hit = (textureLod(tColor, huv, 0.0).rgb * 2.0 + textureLod(tColor, huv + vec2(bl.x, 0.0), 0.0).rgb + textureLod(tColor, huv - vec2(bl.x, 0.0), 0.0).rgb
            + textureLod(tColor, huv + vec2(0.0, bl.y), 0.0).rgb + textureLod(tColor, huv - vec2(0.0, bl.y), 0.0).rgb) / 6.0;
  gl_FragColor = vec4(hit, clamp(F * m * edge * far * uStrength, 0.0, 0.9));
}`;

/* ---- light shafts (same model as TL.Shafts in 20_atmos.js, reading this stack's colour + depth) */
TL.Post.RAYS_FRAG = `
varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform vec2 uSun; uniform float uAspect;
${TL.Post.GLSL_COMMON}
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 dlt = (uSun - vUv) / float(TAPS) * 0.92;
  vec2 uv = vUv + dlt * h(gl_FragCoord.xy);
  float acc = 0.0, wgt = 1.0;
  for (int i = 0; i < TAPS; i++) {
    float sky = step(0.99999, textureLod(tDepth, uv, 0.0).x);
    vec3 c = tlFromSRGB(textureLod(tColor, uv, 0.0).rgb);
    vec2 o = (uv - uSun) * vec2(uAspect, 1.0);
    acc += sky * smoothstep(0.35, 1.2, dot(c, vec3(0.333))) * exp(-dot(o, o) * 3.5) * wgt;
    wgt *= 0.975; uv += dlt;
  }
  gl_FragColor = vec4(vec3(acc / float(TAPS)), 1.0);
}`;

/* ---- composite */
TL.Post.COMP_FRAG = `
varying vec2 vUv;
uniform sampler2D tScene, tBloom, tAO, tDepth, tRays, tSSR;
uniform vec2 uRes, uAoRes, uSsrRes; uniform float uNear, uFar, uSsrOn;
uniform float uBloomK, uBloomNorm, uThr, uKnee, uAoOn, uRaysOn, uOut, uGradeMix, uVig, uGrain, uFrame, uAspect;
uniform vec3 uRaysCol, uShadowTint, uHighTint, uLift, uGain;
uniform float uSat, uContrast, uGamma, uExposure, uDebug;
${TL.Post.GLSL_COMMON}
float linZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
/* depth-aware 2x2 upsample of the half-res AO (R = occlusion, G = linear depth) */
float aoUp(vec2 uv, float zc) {
  vec2 p = uv * uAoRes - 0.5; vec2 i0 = floor(p); vec2 f = p - i0;
  float sum = 0.0, ws = 0.0, tol = 0.02 * zc + 0.04;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    ivec2 ip = clamp(ivec2(i0) + ivec2(i, j), ivec2(0), ivec2(uAoRes) - 1);
    vec2 s = texelFetch(tAO, ip, 0).rg;
    float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) * exp(-abs(s.y - zc) / tol) + 1e-5;
    sum += s.x * w; ws += w;
  }
  return sum / ws;
}
/* depth-aware 2x2 upsample of the half-res SSR (rgb = reflected colour, a = replacement weight) */
vec4 ssrUp(vec2 uv, float zc) {
  vec2 p = uv * uSsrRes - 0.5; vec2 i0 = floor(p); vec2 f = p - i0;
  vec4 sum = vec4(0.0); float ws = 0.0, tol = 0.02 * zc + 0.05;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    ivec2 ip = clamp(ivec2(i0) + ivec2(i, j), ivec2(0), ivec2(uSsrRes) - 1);
    float sz = linZ(texelFetch(tDepth, ivec2((vec2(ip) + 0.5) / uSsrRes * uRes), 0).x);
    float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) * exp(-abs(sz - zc) / tol) + 1e-5;
    sum += texelFetch(tSSR, ip, 0) * w; ws += w;
  }
  return sum / ws;
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  bool sky = d >= 0.999999;
  if (uSsrOn > 0.5 && !sky) { vec4 s = ssrUp(vUv, linZ(d)); c = mix(c, s.rgb, s.a); }
  // ambient occlusion (never on the sky); the image is in display space, the AO pass already outputs a display-space multiplier
  if (uAoOn > 0.5 && !sky) c *= aoUp(vUv, linZ(d));
  if (uDebug > 1.5 && uDebug < 2.5) { gl_FragColor = vec4(texture2D(tBloom, vUv).rgb * uBloomNorm, 1.0); return; }
  if (uDebug > 0.5 && uDebug < 1.5) { gl_FragColor = vec4(vec3(!sky && uAoOn > 0.5 ? aoUp(vUv, linZ(d)) : 1.0), 1.0); return; }
  // bloom: remove the bright part and add its blurred copy back (energy conserving)
  if (uBloomK > 0.0) c = tlFromH(min(tlToH(c), vec3(400.0)) + uBloomK * (texture2D(tBloom, vUv).rgb * uBloomNorm - tlBright(c, uThr, uKnee)));
  c = max(c, 0.0);
  if (uRaysOn > 0.5) c = tlToSRGB(tlFromSRGB(clamp(c, 0.0, 1.0)) + uRaysCol * texture2D(tRays, vUv).r) + max(c - 1.0, 0.0);   // shafts add in linear light, as in 20_atmos.js
  vec3 g = c * uExposure;
  vec3 g0 = g;
  float l = tlLuma(g);
  g *= mix(vec3(1.0), uShadowTint, 1.0 - smoothstep(0.0, 0.5, l)) * mix(vec3(1.0), uHighTint, smoothstep(0.4, 1.0, l));
  g = pow(max(g * uGain + uLift, 0.0), vec3(1.0 / uGamma));
  float l2 = tlLuma(g); g = mix(vec3(l2), g, uSat);
  // The scene and bloom retain HDR highlights. The cubic is only monotonic on [0, 1];
  // evaluating it above white inverts the sun into a blue/black disc.
  vec3 curveInput = clamp(g, 0.0, 1.0);
  g = mix(g, curveInput * curveInput * (3.0 - 2.0 * curveInput), uContrast);
  g = mix(g0, g, uGradeMix);
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  g *= 1.0 - uVig * smoothstep(0.40, 1.25, length(q) * 1.15);
  if (uGrain > 0.0) g += (tlIGN(gl_FragCoord.xy + uFrame * 5.588) + tlIGN(gl_FragCoord.yx - uFrame * 3.17) - 1.0) * uGrain * (1.0 - 0.8 * l);
  g = clamp(g, 0.0, 1.0);
  gl_FragColor = vec4(uOut > 0.5 ? tlFromSRGB(g) : g, 1.0);                             // screen: sRGB; comic hand-off: linear
}`;

/* ------------------------------------------------------------------ helpers */
TL.Post.supported = function (r) {
  if (this._sup === undefined) {
    this._sup = !!(r.capabilities.isWebGL2 && (r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float')));
  }
  return this._sup;
};
TL.Post.active = function () {
  const g = TL.game; return !!(this.tier > 0 && g && g.env && g.renderer && g.scene && this.supported(g.renderer));
};
TL.Post.mkRT = function (w, h, o) {
  o = o || {};
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: !!o.depth, stencilBuffer: false, samples: o.samples || 0, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  if (o.depth) rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  // r149 reads a target's output encoding from texture.encoding only for XR targets: flag it so shaders encode to sRGB in here as on the canvas
  if (o.display) { rt.isXRRenderTarget = true; rt.texture.encoding = THREE.sRGBEncoding; }
  return rt;
};
TL.Post.fsMat = function (frag, uniforms, defines, extra) {
  return new THREE.ShaderMaterial(Object.assign({ uniforms, defines: defines || {}, vertexShader: this.VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false, fog: false }, extra || {}));
};
TL.Post.init = function (r) {
  const V2 = () => ({ value: new THREE.Vector2() }), V3 = (x, y, z) => ({ value: new THREE.Vector3(x, y, z) });
  this._sz = new THREE.Vector2(); this._v = new THREE.Vector3(); this._m = new THREE.Vector3(); this._fogC = new THREE.Color();
  this.mats = {
    downPre: this.fsMat(this.DOWN_FRAG, { tSrc: { value: null }, uTexel: V2(), uThr: { value: 1 }, uKnee: { value: 0.5 } }, { PREFILTER: 1 }),
    down: this.fsMat(this.DOWN_FRAG, { tSrc: { value: null }, uTexel: V2(), uThr: { value: 1 }, uKnee: { value: 0.5 } }),
    up: this.fsMat(this.UP_FRAG, { tSrc: { value: null }, uTexel: V2(), uScatter: { value: 0.7 } }, {}, { blending: THREE.AdditiveBlending, transparent: true }),
    ao: this.fsMat(this.AO_FRAG, { tDepth: { value: null }, uRes: V2(), uTan: V2(), uNear: { value: 0.1 }, uFar: { value: 2400 }, uRadius: { value: 2 }, uFocal: { value: 800 }, uPower: { value: 1.5 }, uStrength: { value: 1 },
      uSunK: { value: 0 }, uFadeNear: { value: 110 }, uFadeFar: { value: 230 }, uSunV: V3(0, 1, 0) }, { SLICES: 1, STEPS: 6 }),
    ssr: this.fsMat(this.SSR_FRAG, { tColor: { value: null }, tDepth: { value: null }, uRes: V2(), uTan: V2(), uNear: { value: 0.1 }, uFar: { value: 2400 }, uWet: { value: 0 }, uTime: { value: 0 }, uWaterY: { value: -3 },
      uMaxDist: { value: 300 }, uStrength: { value: 0.8 }, uV2W: { value: new THREE.Matrix3() }, uW2V: { value: new THREE.Matrix3() }, uCamPos: V3(0, 0, 0) }, { STEPS: 40 }),
    aoBlur: this.fsMat(this.AOBLUR_FRAG, { tAO: { value: null }, uDir: V2() }),
    rays: this.fsMat(this.RAYS_FRAG, { tColor: { value: null }, tDepth: { value: null }, uSun: V2(), uAspect: { value: 1 } }, { TAPS: 32 }),
    comp: this.fsMat(this.COMP_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tAO: { value: null }, tDepth: { value: null }, tRays: { value: null },
      tSSR: { value: null }, uRes: V2(), uAoRes: V2(), uSsrRes: V2(), uSsrOn: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 2400 }, uBloomK: { value: 0 }, uBloomNorm: { value: 1 }, uThr: { value: 1 }, uKnee: { value: 0.5 },
      uAoOn: { value: 0 }, uRaysOn: { value: 0 }, uOut: { value: 0 }, uGradeMix: { value: 1 }, uVig: { value: 0 }, uGrain: { value: 0 }, uFrame: { value: 0 }, uAspect: { value: 1 },
      uRaysCol: V3(0, 0, 0), uShadowTint: V3(1, 1, 1), uHighTint: V3(1, 1, 1), uLift: V3(0, 0, 0), uGain: V3(1, 1, 1), uSat: { value: 1 }, uContrast: { value: 0 }, uGamma: { value: 1 }, uExposure: { value: 1 }, uDebug: { value: 0 },
    }),
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  this.quad = new THREE.Mesh(g, this.mats.comp); this.quad.frustumCulled = false;
  this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this.scene = new THREE.Scene(); this.scene.add(this.quad);
  this.rt = {}; this.bloomRT = []; this.grade = { sh: new THREE.Vector3(1, 1, 1), hi: new THREE.Vector3(1, 1, 1), lift: new THREE.Vector3(), gain: new THREE.Vector3(1, 1, 1), sat: 1, con: 0, gam: 1, exp: 1 };
  this._frame = 0;
};
/* (re)allocate targets for the drawing-buffer size and the tier's needs */
TL.Post.ensure = function (r) {
  const W = this._sz.x, H = this._sz.y, cfg = this.cfg, R = this.rt;
  const key = W + 'x' + H + ':' + this.tier + ':' + this.samples;
  if (this._key === key) return;
  this._key = key;
  for (const k in R) { R[k].dispose(); delete R[k]; }
  for (const b of this.bloomRT) b.dispose();
  this.bloomRT = [];
  R.scene = this.mkRT(W, H, { depth: true, samples: this.samples, display: true });
  const bw = Math.max(1, W >> 1), bh = Math.max(1, H >> 1);
  for (let i = 0; i < cfg.bloom.levels; i++) this.bloomRT.push(this.mkRT(Math.max(1, bw >> i), Math.max(1, bh >> i)));
  if (cfg.ao) { R.ao0 = this.mkRT(bw, bh); R.ao1 = this.mkRT(bw, bh); }
  if (cfg.ssr) R.ssr = this.mkRT(bw, bh);
  R.rays = this.mkRT(Math.max(1, W >> 2), Math.max(1, H >> 2));
  R.ldr = this.mkRT(W, H);                                 // linear hand-off target for the comic filter
};
TL.Post.pass = function (r, mat, target, label) {
  this.quad.material = mat; r.setRenderTarget(target);
  if (this.prof && label) this.timed(r, label, () => r.render(this.scene, this.cam)); else r.render(this.scene, this.cam);
};
/* optional per-stage GPU timing (benchmarks): set TL.Post.prof = { q: [] }, render, then TL.Post.profResult() */
TL.Post.timed = function (r, label, fn) {
  const gl = r.getContext(), ext = this._tq || (this._tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'));
  if (!ext) { fn(); return; }
  const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); try { fn(); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); this.prof.q.push([label, q]); }
};
TL.Post.profResult = function (r) {
  const gl = r.getContext(), out = {}; let n = 0;
  for (const [k, q] of this.prof.q) {
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return null;
    out[k] = (out[k] || 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q);
  }
  this.prof.q.length = 0; return out;
};

/* ------------------------------------------------------------------ grade follows the time of day and weather */
TL.Post.updateGrade = function (env, comicOn) {
  const G = this.grade, night = env.night || 0, rain = env.rain || 0, sd = env.skyU.uSunDir.value;
  const golden = TL.smooth(0.45, 0.05, sd.y) * (1 - night), day = (1 - night);
  // warm highlights / cool shadows; the split deepens in golden hour, rain pulls everything cooler and flatter
  G.hi.set(TL.lerp(1.05, 1.13, golden), 1.0, TL.lerp(0.95, 0.80, golden)).lerp(this._m.set(0.97, 1.0, 1.06), night).lerp(this._m.set(0.97, 1.0, 1.04), rain * 0.6 * day);
  G.sh.set(TL.lerp(0.95, 0.90, golden), TL.lerp(0.985, 0.98, golden), TL.lerp(1.06, 1.12, golden)).lerp(this._m.set(0.90, 0.98, 1.12), night);
  G.lift.set(0.0, 0.002, 0.008).multiplyScalar(0.5 + golden * 0.5 + night);
  G.gain.set(1.0 + 0.03 * golden, 1.0, 1.0 - 0.025 * golden);
  G.gam = 1.0 - 0.02 * night;
  G.sat = TL.lerp(1.07, 1.12, golden) - 0.22 * rain * day + 0.04 * night;
  G.con = TL.lerp(0.14, 0.2, golden) * (1 - 0.3 * rain) + 0.08 * night;
  G.exp = 1;
};

/* ------------------------------------------------------------------ frame */
TL.Post.render = function (r, scene, camera) {
  if (!this.mats) this.init(r);
  const g = TL.game, env = g.env, cfg = this.cfg, F = this.flags, R = this.rt, M = this.mats;
  r.getDrawingBufferSize(this._sz);
  this.ensure(r);
  const W = this._sz.x, H = this._sz.y, comic = TL.Comic, comicOn = !!(comic.style && comic.level);
  const weather = g.rain, rainVis = weather && weather.mesh.visible, snowVis = weather && weather.snow.visible;
  const prevAuto = r.autoClear, prevTM = r.toneMapping;
  this._frame++;
  if (TL.Render && TL.Render.tier) { if (this.prof) this.timed(r, 'probe', () => TL.Render.update(r, scene, camera)); else TL.Render.update(r, scene, camera); }       // reflection probe (21b_reflect.js)
  /* 1. scene -> HDR-tailed target (comic filter on: rain/snow are drawn after the filter, as before) */
  if (comicOn && weather) { weather.mesh.visible = false; weather.snow.visible = false; }
  // r149 converts the fog colour to sRGB only when drawing to the canvas (getRenderTarget() === null); inside this display-encoded target
  // it would stay linear and the fog would come out darker than the original. Hand the shaders the encoded colour for this pass.
  const fog = scene.fog, fogLin = fog ? this._fogC.copy(fog.color) : null;
  try {
    if (fog) fog.color.convertLinearToSRGB();
    r.toneMapping = this.aces ? prevTM : THREE.CustomToneMapping;
    r.setRenderTarget(R.scene);
    if (this.prof) this.timed(r, 'scene', () => r.render(scene, camera)); else r.render(scene, camera);
  } finally {
    if (fog) fog.color.copy(fogLin);
    r.toneMapping = prevTM;
    if (comicOn && weather) { weather.mesh.visible = rainVis; weather.snow.visible = snowVis; }
  }
  r.autoClear = false;
  try {
    const sceneTex = R.scene.texture, depthTex = R.scene.depthTexture;
    /* 2. ambient occlusion (half res) */
    const aoOn = !!(cfg.ao && F.ao);
    if (aoOn) {
      const A = cfg.ao, U = M.ao.uniforms, P = camera.projectionMatrix.elements;
      if (M.ao.defines.SLICES !== A.slices || M.ao.defines.STEPS !== A.steps) { M.ao.defines.SLICES = A.slices; M.ao.defines.STEPS = A.steps; M.ao.needsUpdate = true; }
      U.tDepth.value = depthTex; U.uRes.value.set(W, H); U.uTan.value.set(1 / P[0], 1 / P[5]);
      U.uNear.value = camera.near; U.uFar.value = camera.far; U.uRadius.value = A.radius; U.uFocal.value = 0.5 * H * P[5];
      U.uPower.value = A.power; U.uStrength.value = A.strength;
      this._v.copy(env.skyU.uSunDir.value).transformDirection(camera.matrixWorldInverse); U.uSunV.value.copy(this._v);
      U.uSunK.value = (1 - (env.night || 0)) * (1 - 0.8 * (env.rain || 0));
      this.pass(r, M.ao, R.ao0, 'ao');
      const bw = R.ao0.width, bh = R.ao0.height, B = M.aoBlur.uniforms;
      B.tAO.value = R.ao0.texture; B.uDir.value.set(1 / bw, 0); this.pass(r, M.aoBlur, R.ao1, 'ao');
      B.tAO.value = R.ao1.texture; B.uDir.value.set(0, 1 / bh); this.pass(r, M.aoBlur, R.ao0, 'ao');
    }
    /* 2b. screen-space reflections (ultra) */
    const ssrOn = !!(cfg.ssr && F.ssr);
    if (ssrOn) {
      const S = cfg.ssr, U = M.ssr.uniforms, P = camera.projectionMatrix.elements, e = camera.matrixWorld.elements;
      if (M.ssr.defines.STEPS !== S.steps) { M.ssr.defines.STEPS = S.steps; M.ssr.needsUpdate = true; }
      U.tColor.value = sceneTex; U.tDepth.value = depthTex; U.uRes.value.set(W, H); U.uTan.value.set(1 / P[0], 1 / P[5]);
      U.uNear.value = camera.near; U.uFar.value = camera.far; U.uWet.value = env.wet || 0; U.uTime.value = g.time || 0; U.uWaterY.value = TL.C.WATER_Y;
      U.uMaxDist.value = S.maxDist; U.uStrength.value = S.strength;
      U.uV2W.value.set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]);       // camera rotation: Matrix3.set takes rows, elements are column-major
      U.uW2V.value.copy(U.uV2W.value).transpose();
      U.uCamPos.value.set(e[12], e[13], e[14]);
      this.pass(r, M.ssr, R.ssr, 'ssr');
    }
    /* 3. bloom pyramid */
    const bl = cfg.bloom, bloomOn = !!(bl && F.bloom), L = this.bloomRT;
    const thr = bl ? bl.thr - 0.08 * (env.night || 0) : 1;     // at night the lights stand out against the dark: glow starts a little lower
    let norm = 1;
    if (bloomOn) {
      let U = M.downPre.uniforms; U.tSrc.value = sceneTex; U.uTexel.value.set(1 / W, 1 / H); U.uThr.value = thr; U.uKnee.value = bl.knee;
      this.pass(r, M.downPre, L[0], 'bloom');
      for (let i = 1; i < L.length; i++) { U = M.down.uniforms; U.tSrc.value = L[i - 1].texture; U.uTexel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height); this.pass(r, M.down, L[i], 'bloom'); }
      for (let i = L.length - 2; i >= 0; i--) { U = M.up.uniforms; U.tSrc.value = L[i + 1].texture; U.uTexel.value.set(1 / L[i + 1].width, 1 / L[i + 1].height); U.uScatter.value = bl.scatter; this.pass(r, M.up, L[i], 'bloom'); }
      norm = 0; for (let i = 0; i < L.length; i++) norm += Math.pow(bl.scatter, i);
      norm = 1 / norm;
    }
    /* 4. light shafts (atmosphere tier high+, not under the comic filter) */
    let raysOn = false, k = 0;
    if (F.shafts && !comicOn && TL.Atmos && TL.Atmos.tier >= 2 && TL.Shafts) k = TL.Shafts.strength(camera);
    if (k >= 0.01) {
      raysOn = true;
      const tier = TL.Atmos.tier, div = tier >= 3 ? 2 : 4, rw = Math.max(1, Math.floor(W / div)), rh = Math.max(1, Math.floor(H / div));
      if (R.rays.width !== rw || R.rays.height !== rh) R.rays.setSize(rw, rh);
      const taps = tier >= 3 ? 64 : 32;
      if (M.rays.defines.TAPS !== taps) { M.rays.defines.TAPS = taps; M.rays.needsUpdate = true; }
      const sd = env.skyU.uSunDir.value, U = M.rays.uniforms;
      this._v.copy(camera.position).addScaledVector(sd, 1000).project(camera);
      U.tColor.value = sceneTex; U.tDepth.value = depthTex; U.uSun.value.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5); U.uAspect.value = W / H;
      this.pass(r, M.rays, R.rays, 'shafts');
    }
    /* 5. composite (+ grade) to the screen, or to the linear target the comic filter reads */
    this.updateGrade(env, comicOn);
    const C = M.comp.uniforms, G = this.grade, gradeOn = !!F.grade;
    C.tScene.value = sceneTex; C.tDepth.value = depthTex; C.tBloom.value = bloomOn ? L[0].texture : sceneTex; C.tAO.value = aoOn ? R.ao0.texture : sceneTex; C.tRays.value = R.rays.texture;
    C.uRes.value.set(W, H); C.uAoRes.value.set(aoOn ? R.ao0.width : 1, aoOn ? R.ao0.height : 1); C.uNear.value = camera.near; C.uFar.value = camera.far;
    C.uBloomK.value = bloomOn ? bl.k : 0; C.uBloomNorm.value = norm; C.uThr.value = thr; C.uKnee.value = bl ? bl.knee : 0.5;
    C.uAoOn.value = aoOn ? 1 : 0; C.uSsrOn.value = ssrOn ? 1 : 0; C.tSSR.value = ssrOn ? R.ssr.texture : sceneTex; C.uSsrRes.value.set(ssrOn ? R.ssr.width : 1, ssrOn ? R.ssr.height : 1); C.uRaysOn.value = raysOn ? 1 : 0;
    if (raysOn) { const sc = env.skyU.uSunCol.value, m = k * (TL.Atmos.tier >= 3 ? 2.4 : 1.9) * (1 + 0.4 * env.skyU.uGolden.value); C.uRaysCol.value.set(sc.r * m, sc.g * m, sc.b * m); }
    C.uOut.value = comicOn ? 1 : 0; C.uGradeMix.value = gradeOn ? (comicOn ? 0.6 : 1) : 0;
    C.uShadowTint.value.copy(G.sh); C.uHighTint.value.copy(G.hi); C.uLift.value.copy(G.lift); C.uGain.value.copy(G.gain);
    C.uDebug.value = this.debug || 0; C.uSat.value = G.sat; C.uContrast.value = G.con; C.uGamma.value = G.gam; C.uExposure.value = G.exp;
    C.uVig.value = (!comicOn && F.vignette) ? cfg.vig : 0; C.uGrain.value = (!comicOn && F.grain) ? cfg.grain : 0;
    C.uFrame.value = this._frame % 64; C.uAspect.value = W / H;
    this.pass(r, M.comp, comicOn ? R.ldr : null, 'composite');
    /* 6. comic filter reads the graded linear image + this stack's depth */
    if (comicOn) {
      const CU = comic.setUniforms(r, camera);
      const ct = CU.tColor.value, cd = CU.tDepth.value;
      CU.tColor.value = R.ldr.texture; CU.tDepth.value = depthTex;
      try { r.setRenderTarget(null); r.render(comic.scene, comic.cam); } finally { CU.tColor.value = ct; CU.tDepth.value = cd; }
      if (weather && (rainVis || snowVis)) weather.renderOverlay(r, camera, depthTex);
    }
  } finally { r.autoClear = prevAuto; r.setRenderTarget(null); }
};

/* ------------------------------------------------------------------ tier application + hooks */
TL.Post.apply = function (game) {
  const t = this.TIER[game.quality] || 0;
  this.tier = t; this.cfg = this.TIERS[t]; this._key = null;
  if (!t) this.release();
};
/* low: nothing of this stack stays allocated */
TL.Post.release = function () {
  for (const k in this.rt || {}) { this.rt[k].dispose(); delete this.rt[k]; }
  for (const b of this.bloomRT || []) b.dispose();
  this.bloomRT = [];
};
{
  const applyQuality = TL.Game.prototype.applyQuality;
  TL.Game.prototype.applyQuality = function (q) { applyQuality.call(this, q); TL.Post.apply(this); };
  const startGame = TL.Game.prototype.startGame;
  TL.Game.prototype.startGame = function (opts) {
    const out = startGame.call(this, opts);
    if (!(opts && opts.data) && TL.Post.tier > 0 && this.env) this.env.hour = TL.Post.defaultHour;
    return out;
  };
  const prev = TL.Comic.render;
  TL.Comic.render = function (r, scene, camera) {
    if (!TL.Post.active()) { prev.call(this, r, scene, camera); return; }       // low (or no WebGL2): the original path, untouched
    TL.Post.render(r, scene, camera);
  };
}
