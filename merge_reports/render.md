# MERGE_REPORT — rendering-quality pass (AO, bloom + grade, reflections)

Worktree `C:\Users\PRIYANSHU\Pictures\spooderman_render`, branch `claude/render-post` (own git repo; main and the other worktrees untouched).
Baseline hashes: see [BASELINE.md](BASELINE.md). Not merged into main — steps at the end.

## What it does

Quality-tier rule (yours): **Low = the original look, untouched**; each tier adds more; Ultra has everything.

| | low | medium | high | ultra |
|---|---|---|---|---|
| post stack runs | no (original path, bit-identical) | yes | yes | yes |
| colour grade (warm highlights / cool shadows, time-of-day + weather aware) + vignette | – | ✔ | ✔ | ✔ |
| bloom (soft threshold, energy conserving) | – | 4 levels | 5 levels | 6 levels |
| ambient occlusion (GTAO, depth-aware blur, bilateral upsample) | – | – | 1 slice x 6 steps | 2 slices x 8 steps |
| film grain | – | – | – | ✔ |
| light shafts (existing atmosphere feature, now inside the stack) | – | – | ✔ | ✔ (half res, 64 taps) |
| reflection probe -> `scene.environment` (cars, hero suits, wet streets, roofs reflect the skyline + real light) | original sky-only map | sky probe API only | 96^2 scene probe | 128^2 scene probe |
| water reflects the skyline (probe geometry over the analytic sky) | – | – | ✔ | ✔ |
| SSR on water + rain-wet ground | – | – | – | ✔ |
| new-game start hour | 16:30 (original) | 17:30 | 17:30 | 17:30 |

### Ambient occlusion (`src/21_post.js`)
GTAO (Jimenez 2016) with the XeGTAO falloff, half resolution. **Normals are rebuilt from depth** (per axis the neighbour with the smaller depth
step), so every kind of geometry is handled by construction — scan buildings, the instanced rooftop kits, skinned heroes, trees — because depth is what
was actually drawn; no second geometry pass, no override materials. No halo against the sky: sky pixels (depth == 1) are skipped and write a far depth,
occluders beyond the falloff radius are ignored, the blur and the upsample are depth-weighted, and the composite never touches sky pixels. AO is faded
out with distance (110 -> 230 m, where fog takes over) and weakened where the sun already lights a face (the scan photos carry baked light; this
keeps the scan's look). Debug view: `TL.Post.debug = 1`.

### Bloom + grade
Bloom works in a pseudo-HDR space (display value run back up a Reinhard curve, hue-preserving) so a window or lamp that the tone curve clipped keeps
the energy it had; a soft-knee threshold + Karis average feeds a 13-tap dual-filter pyramid, tent upsample. The composite removes the bright part from
the image and adds the blurred copy back (total energy conserved; pixels the bloom does not touch round-trip exactly). The scene target is
display-referred like the canvas (see "How it stays identical"), plus a soft highlight tail above ACES white so sun glints / sun disc / specular sparkle
stay > 1 for bloom. Grade = split-tone (warm highlights / cool shadows), lift/gamma/gain, saturation, gentle S-curve, all driven by time of day and
weather (golden hour deepens the split, rain desaturates and cools, night goes blue); vignette; triangular film grain on Ultra.

### Reflections (`src/21b_reflect.js`)
One shared **probe**: a mip-mapped cube around the camera, scene-referred linear radiance (same convention as the original sky env map), hero/ropes/rain
hidden, sky alpha = 0 so a shader can tell sky from geometry. High/Ultra capture the real scene one face every 6/4 frames (<= 520 m, shadow maps not
re-rendered), then prefilter a 32^2 box-filtered copy (mirror-like wet surfaces would otherwise sparkle on every building edge of a 128^2 capture) into
`scene.environment` with PMREM. Everything that samples `scene.environment` — vehicles, hero suits, wet streets and roofs — now reflects the skyline and
the real light colour instead of a sky gradient. The Atmosphere water shader mixes the probe's geometry into its analytic sky (waves bend it).
Medium keeps the original sky env map and only provides the sky probe to the API.
**SSR (Ultra)**: half-res depth ray march (40 steps + 5 binary refinements, perspective-correct), normals from depth bent by the surface's own ripples,
on water and on rain-wet upward-facing ground; the hit colour comes from the scene colour target; the result *replaces* a Fresnel-weighted fraction of the
pixel (the probe/analytic sky is already in it), so nothing is counted twice. Hits on the sky are ignored; edge/distance fades; depth-aware upsample.
Vehicles / glass are covered by the probe; SSR on them would need a per-material reflectivity mask (see API note below) — not done.

### Reflection API for the buildings agent (glass) — `TL.Render`
```js
TL.Render.tier            // 0 off, 1..3 = medium..ultra
TL.Render.probe           // WebGLCubeRenderTarget (mip-mapped); .texture = samplerCube (null until the first update)
TL.Render.envMap          // scene.environment as prefiltered from the probe (what MeshStandardMaterial samples)
TL.Render.U               // shared plain-object uniforms { tlProbe, tlProbeP }   (tlProbeP: x on, y max lod, z intensity)
TL.Render.install(shader, { defines: true })   // from material.onBeforeCompile: adds the uniforms + GLSL (after #include <common>)
```
GLSL after `install`:
```glsl
vec4 tlProbeSample(vec3 dirWorld, float roughness)            // rgb scene-referred radiance, a = 1 geometry / 0 sky
vec3 tlReflect(vec3 dirWorld, float roughness, vec3 skyFallback)          // MeshStandard-style shaders (scene-referred output)
vec3 tlReflectDisplay(vec3 dirWorld, float roughness, vec3 skyFallbackDisplay) // ShaderMaterials that write display values (sky/water style)
```
Both return the fallback unchanged when the probe is off (low/medium), so calling them is always safe. Usage in a glass patch, e.g. in
`GLSL_MAP` of `03d_facade.js`: `vec3 R = reflect(Vw, N3); glassRefl = tlReflect(R, 0.04, glassRefl);` (analytic sky stays where the probe saw sky).
The probe sits at the camera: exact for distant geometry (skyline in glass/water), plausible for near surfaces. Do not sample `tlProbe` from a material
rendered *into* the probe (feedback loop); the capture swaps in a dummy cube for that. The existing `TL.Atmos` water shader is the worked example
(`21b_reflect.js`, bottom: it patches `TL.Atmos.WATER_FRAG` at load; no edit to `20_atmos.js`).

## How it stays identical when it should
* **Low**: `TL.Comic.render` wrapper calls the previous implementation untouched when `TL.Post.tier == 0`; nothing is allocated (`TL.Post.release`,
  `TL.Render.dispose`). Verified bit-for-bit: 0 differing pixels between the baseline build and this branch at Low (street + rain, separate sessions), and after a runtime hop low -> ultra -> low in one session.
* **Neutral stack** (every effect off, tier >= medium): within rounding of the original frame (street, ultra: mean 0.05/255, max 12 on MSAA edges). Getting
  there needed two r149 specifics worth knowing: (1) a render target is linear unless flagged as an XR target, so the scene target is flagged
  (`isXRRenderTarget`, `texture.encoding = sRGB`) so every shader — fog, blending, sky/water `linearToOutputTexel` — writes what it writes to the canvas;
  (2) r149 converts the fog colour to sRGB only when drawing to the canvas, so the fog colour is handed to the shaders pre-encoded for that pass.
  Side effect: the original comic/shafts targets blend fog in *linear* (slightly different haze); inside the stack fog blends like the canvas, so the comic
  filter now sees the same haze as the plain image.
* Physics/animation untouched (`04_*`, `06_*`); `node tests/{physics,contact,routes}_test.js` pass (31 / 43 / 17).

## Integration with the comic filter and the atmosphere
* **Comic**: `TL.Comic.render` is wrapped (like `20_atmos.js` does). With the filter on, the stack renders scene -> AO/bloom/grade -> a *linear* target, and
  the comic filter reads that (+ the stack's depth) through the new `TL.Comic.setUniforms(r, camera)` (the only change to `18_comic.js`). Grade runs at 60 %
  under the filter, no vignette/grain; rain/snow are hidden during the scene pass and drawn afterwards exactly as before.
* **Atmosphere**: tier-0 shafts untouched; from `high`, the stack runs the same ray march itself (it owns the scene target) and adds it in linear light
  as `20_atmos.js` did. `TL.Shafts.render` is therefore not reached when the stack is active. Haze, clouds, wave water are untouched.

## Performance (GPU ms / frame at 1600x900, hardware Chrome D3D11, timer queries per pass)
`tests/render_post/perf.js`: variants interleaved frame by frame (orig / neutral / full) in one session, 240 frames = 10 whole probe cycles, **median**
batch per stage. Cross-run noise of the whole-frame numbers is large (±10-30 %, GPU clocks + Codex using the GPU); the per-pass numbers are what to read.
Add-on cost = the pass rows. ("scene overhead" = MSAA half-float target + resolve + custom curve vs the canvas: within noise, 0 to +0.5 ms.)

| tier / scene | bloom | AO | SSR | shafts | composite (grade+vig+grain) | probe (amortised) | **sum of passes** |
|---|---|---|---|---|---|---|---|
| medium / street | 0.12 | – | – | – | 0.09 | – | **0.2** |
| medium / rain | 0.12 | – | – | – | 0.10 | – | **0.2** |
| medium / waterfront | 0.16 | – | – | – | 0.09 | – | **0.25** |
| high / street | 0.24 | 0.37 | – | – | 0.18 | 1.60 | **2.4** |
| high / rain | 0.25 | 0.34 | – | – | 0.21 | 1.62 | **2.4** |
| high / waterfront (sun in view) | 0.59 | 0.36 | – | 0.32 | 0.30 | 1.79 | **3.4** |
| ultra / street | 0.39 | 0.84 | 0.06 | – | 0.25 | 2.70 | **4.2** |
| ultra / rain (wet ground) | 0.25 | 0.62 | 0.24 | – | 0.30 | 2.15 | **3.6** |
| ultra / waterfront (sun in view) | 0.33 | 0.38 | 0.19 | 1.01 | 0.33 | 1.65 | **3.9** |

Per effect on top of a neutral stack: grade+vignette+grain are ALU inside the composite (0.1-0.2 ms); bloom 0.12-0.6; AO 0.35-0.85; SSR 0.06 (dry) to
0.25 (wet/water — only masked pixels march); shafts (existing feature) 0.3 high / 1.0 ultra; the reflection probe is the most expensive piece
(1.6-2.7 ms/frame averaged, GPU + CPU submit of 128^2 scene faces; it is geometry bound). Knobs: `TL.Render.TIERS[t].period` (frames between faces),
`TL.Render.captureFar`, `TL.Post.TIERS[t]` (levels / steps / slices / radius), `TL.Post.samples` (MSAA of the scene target). A/A check in the same
harness (`neutral` vs `neutral`) was within ±0.1 ms per pass. First enable of a tier compiles the new shader variants (like the comic filter: several
seconds cold, then cached).

## Verification run
* `node tests/render_post/tiers_browser.js` (GPU): every tier x {street, rain, night, waterfront}: no page/TL errors, no GL errors, context alive; Low hop
  is bit-exact and holds no targets; neutral stack within rounding; both comic styles compose; resize reallocates cleanly. **PASS**.
* `tests/render_post/shoot.js / probe.js / probeview.js / perf.js / diff.py` are the screenshot, in-session A/B, probe-dump and benchmark drivers.

## Screenshots (before = untouched baseline build, after = this branch; Ultra, 1600x900, same seeds)
Files in `evidence/render_post/` named `<scene>_<base|new>_<day|golden|night|rain>.png`:
* **day** (14:00): `street`, `skyline`, `waterfront_day`
* **golden hour** (17:30): `golden_street`, `skyline`, `waterfront`, `heroclose` (hero suit)
* **night**: `night`, `waterfront_night`
* **rain**: `rain`, `rainlow` (low camera, wet street, 17:30), `rainlow_night`
Tier ladder (low/medium/high/ultra, 17:30) for the waterfront and the low rain street: `evidence/render_post/ladder_<scene>_1low … 4ultra.png`.
Start hour check: new game starts at 16:30 on Low, 17:30 on medium+ (`TL.Post.defaultHour`; saved games keep their own time).

## Known limits / honest notes
* Windows' glow at night is modest by design (the facade shader's emissive is already clipped at ACES white before the stack sees it).
* SSR is water + wet ground only (no per-material reflectivity mask exists); vehicles/hero suits get the probe, not SSR.
* The probe is at the camera: building reflections in near flat surfaces are approximate; update latency is 24-36 frames at 128^2/96^2.
* AO is applied in display space (after tone mapping), weakened on sun-facing surfaces; it can darken particles drawn over occluded background.
* The first frames after switching to high/ultra hitch while shader variants compile.

## Merge steps (main folder is not git; Codex edits it concurrently — do this when it is idle, or copy into a new worktree)
1. Copy `src/21_post.js`, `src/21b_reflect.js` into main `src/`.
2. `src/18_comic.js`: apply the one change (new `setUniforms(r, camera)` method; `render()` calls it instead of the inline uniform block). If main's
   `18_comic.js` still has the baseline hash in BASELINE.md, simply copy the file; otherwise patch by hand (the hunk is ~10 lines at the top of `render`).
3. `tools/build.js`: after the line adding `20_atmos.js` add
   ```js
   order.splice(order.indexOf('20_atmos.js')+1,0,'21_post.js');
   order.splice(order.indexOf('21_post.js')+1,0,'21b_reflect.js');
   ```
   (order must stay: `18_comic.js`, `20_atmos.js`, `21_post.js`, `21b_reflect.js` — the stack wraps `TL.Comic.render` and patches `TL.Atmos.WATER_FRAG`.)
4. No edit to `16_game.js`, `index.html` or any physics/animation file.
5. Copy `tests/render_post/` (optional), `node tools/build.js`, run `node tests/physics_test.js contact_test.js routes_test.js` and
   `node tests/render_post/tiers_browser.js`.
