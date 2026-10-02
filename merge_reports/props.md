# Pedestrians and props — merge report

## Status and scope

Reviewable core asset upgrade in `C:\Users\PRIYANSHU\Pictures\spooderman_props`, branch `claude/peds-props`. Nothing has been merged into main. This is NOT completion of every item in the original broad brief: several additional fixtures are exported but not placed in the Manhattan map. Review the screenshots before integrating; the style is not uniformly photorealistic.

Untouched baseline commit: `c1a679ca3cf05394e0ebd4aeca3da29c1edba740`. Pre-edit SHA256 values are in `BASELINE.md`.

### Installed

- Ten textured pedestrian appearances: two office women, business man, casual man, construction worker, police officer, older man, weekend man, casual woman and student. Six are adapted scanned Renderpeople assets; the others are more stylized. These replace pedestrian models, not their AI.
- Existing 19-bone NPC skeletons and animation system retained. Skin weights retargeted to the original bones. High/Medium/Low budgets are approximately 7,000/3,000/1,300 triangles; each appearance has a derived approximately 350-triangle instanced far mesh. One atlased material per person, including roughness/metalness information. Existing bags, phones, umbrellas and hats remain controlled by existing behavior; built-in worker/police headgear suppresses duplicate random hats.
- Manhattan rooftop HVAC and low skylight/hatch visuals replaced. Existing water towers, ladders, vents, rails and obstacle kits retain their contact geometry with new weathered wood/metal/paint materials.
- Manhattan benches, hydrants, mailboxes, bins, newsboxes and bollards replaced using existing placements, bounds and colliders. No new collision or traversal shapes.
- Textured P_* replacements for the existing procedural prop library, including water tower, scaffold, lamps, traffic lights, fire escapes, ducts, hut and street furnishings. These only appear where the existing map actually places those P_* assets; this does not replace every Manhattan-specific streetlight.
- Asset credits available on the title screen; public source/license attribution in `THIRD_PARTY_ASSETS.md`.

### Still missing / not claimed as finished

- New newsstand, subway guard/entrance, blue rental bike/dock, steam stack and dish are in the library with browser screenshots, but do not have new Manhattan placements. The rental bike is not an authentic Citi Bike model. No underground subway interior.
- No child asset shipped: tested candidates did not meet visual/rig quality. No distinct new vendor/jogger costume for every behavior role. Existing rooftop workers use the existing default model call; a behavior integrator can explicitly assign the worker appearance later.
- Roof surfaces/building geometry are untouched. Weathered tiles improve existing equipment materials; this is not a new citywide gravel/tar roof system.
- Some small props retain baseline silhouettes with texture/finish improvements rather than entirely new geometry.
- Worker/police/elder styles are less realistic than the scanned office/casual people. Close-up production quality still needs art review. Do not advertise this as AAA or a complete replacement of all requested props.

## Changes and runtime data

Existing source files changed: `src/01_assets.js` (optional packs, textured skin/static/instanced materials), `src/10_crowd.js` (appearance selection, model pooling, far LOD batches and accessory attachment only), `tools/build.js` (embed packs/credits; load new source).

New source: `src/21_props.js` (appearance/LOD helpers and visual-only kit wrappers). Load after the original crowd, roof, street and UI classes, before boot. Keep any newer atmosphere/build modules in main's build list.

New runtime build data:

- `build/people.bin`, `build/people.json`, `build/people_tex.json`
- `build/props.bin`, `build/props.json`, `build/props_tex.json`
- `build/props_credits.json`

New supporting files: `tools/props/*.py`, `tests/props_assets_test.js`, `tests/props_browser.js`, `tests/props_bench_browser.js`, audit JSONs, `BASELINE.md`, `THIRD_PARTY_ASSETS.md`, this report and evidence. Raw downloads are in `source/props_external/`; prepared Blender files and intermediate textures are in `build/props_tex/`. Raw files are not needed to play/build from the final packs. Do not copy rejected experimental assets into the game.

Only this copy's `THREADLINE.html` was rebuilt. Main and multiplayer have not been modified. No 04_* or 06_* source, buildings, facades, trees or waterfront code changed.

## Validation

- Physics: 31 passed, 0 failed.
- Contact: 43 passed, 0 failed.
- Rooftops: passed.
- Routes: 17 passed, 0 failed.
- New asset validation: 149 asset/LOD records; valid indices, UVs, normalized weights, exact baseline NPC skeleton definitions, texture references and original prop collider/socket metadata.
- Headless Chrome/D3D11: all four tiers loaded/rendered without browser errors. Pedestrian gallery uses the existing NPC walk animator. Browser asset galleries and in-city street/roof captures are in `evidence/props/`.
- Tests prove data compatibility and basic runtime rendering, not exhaustive traversal through every instance or every animation.

### Measurements

1280 x 720 CSS viewport, filter off, headless Chrome with D3D11. Low internally 896 x 503; Medium 1088 x 612; High/Ultra 1280 x 720. Median of five 24-frame tick/render batches in a fixed street/roof setup, with GPU synchronization. These are harness throughput figures, not a promise of normal gameplay FPS on an Intel iGPU.

| Quality | Baseline street FPS | After street FPS | Baseline roof FPS | After roof FPS |
|---|---:|---:|---:|---:|
| Low | 54.6 | 92.7 | 67.0 | 89.7 |
| Medium | 38.3 | 89.3 | 47.2 | 77.3 |
| High | 30.2 | 57.4 | 32.7 | 51.9 |
| Ultra | 40.0 | 57.2 | 38.8 | 48.0 |

IMPORTANT: baseline and final were separate sessions while the PC was shared with other work. Large timing differences and baseline tier ordering demonstrate substantial noise. This is not credible evidence of a speedup from the new assets. Re-run controlled A/B measurements before making a performance claim. The last source-accessory cleanup preserves the same triangle/material budgets; full tier timing was captured immediately before that cleanup, then the final pedestrian browser check was rerun.

Raw measurements: `evidence/props/before_performance.json`, `after_performance.json`. Medium final street: 284 calls, 560,312 triangles; roof: 482 calls, 1,031,547 triangles. These include the whole scene and shadow rendering, not just the new pack. The standalone HTML grew from approximately 60.54 MB to 72.01 MB. Texture atlases are 1024px per unique material set; weather tiles are 512px. Packs are embedded/decoded at startup, not streamed on demand.

## Visual evidence

- Same scene before/after: `evidence/props/before_medium_street.png`, `after_medium_street.png`, `before_medium_roof.png`, `after_medium_roof.png`. Other tiers have the same naming scheme.
- Final people: `after_people_0.png`, `after_people_2.png`, `after_people_4.png`, `after_people_6.png`, `after_people_8.png`.
- `runtime_P_*.png`: Three.js asset previews, NOT proof of placement in the map.
- `*_source.png`, `*_fitted.png`, `*_authored.png`, selected `*.blend.png`: source/Blender inspection evidence. Older images of rejected tourist/jogger/youth models are exploratory evidence, not the final roster. `after_people_10.png` is stale from an earlier roster and must not be used for acceptance.

## Exact integration steps for the main-folder owner

1. Back up current main source/build data and `THREADLINE.html`. Keep main's newer edits. Compare the three existing source hashes to `BASELINE.md`; differing hashes mean the patch must be reviewed against those edits.
2. Inspect `integration/peds-props.patch`. It contains only the three existing source changes plus new `src/21_props.js`; it does not contain the generated HTML or replace source folders wholesale.
3. In a shell rooted at main, check/apply using the isolated Git directory so a parent home-folder repository cannot alter path handling:

```powershell
$props = 'C:\Users\PRIYANSHU\Pictures\spooderman_props'
$main = 'C:\Users\PRIYANSHU\Pictures\spooderman'
git --git-dir="$props\.git" --work-tree="$main" apply --check "$props\integration\peds-props.patch"
# Only after a clean check and review:
git --git-dir="$props\.git" --work-tree="$main" apply "$props\integration\peds-props.patch"
```

If check fails, manually port the small loader/crowd/build hunks. Do not overwrite `10_crowd.js` or `tools/build.js` with this older snapshot. Preserve the behavior agent's changes. `TL.People.choose` hashes RNG state without advancing it; preserve that separation.

4. Copy exactly the seven runtime files listed above from this worktree's `build/` into main's build directory. Copy credits and the new tests/pipeline files as desired. Keep the raw source cache separately for regeneration. Retain attribution when distributing.
5. Run `node tools/build.js` in main, building only main `THREADLINE.html`, followed by the four requested regression tests and the new asset test. The browser helpers depend on the existing `tests/graphics_bench/lib.js` setup and puppeteer-core installation.
6. Inspect the same city shots and pedestrian gallery in main; test an equipment vault/mantle, quality changes, bags/umbrellas and far LOD transitions. Do not copy this worktree's generated HTML over a newer main build.
7. Rollback: restore the backed-up three sources/build output, remove the new module from the build list and remove/disable the optional people/props packs. Rebuild. Do not reset unrelated newer changes.

These commands are instructions for integration; they have NOT been executed against main.

## Regeneration order

Run in this worktree or a separately isolated checkout with the accepted source cache present. Exporters respect `TL_BUILD_DIR`; the existing base `build/assets.json` remains the reference for skeletons and colliders. Blender 4.3.2 and Python Pillow/numpy were used. The Blender MCP service was unavailable, so exports used headless Blender. Download helpers require the installed addon and its configured Sketchfab credentials; no credential is embedded in the game.

```powershell
$env:TL_BUILD_DIR = Join-Path (Get-Location) 'build'
$blender = 'C:\Program Files\Blender Foundation\Blender 4.3\blender.exe'
# Use a Python interpreter with Pillow and numpy.
python tools/props/surfaces.py
& $blender -b --python tools/props/people_export.py
& $blender -b --python tools/props/props_export.py
& $blender -b --python tools/props/finish_props.py
& $blender -b --python tools/props/author_fixtures.py
python tools/props/atlas_pack.py
python tools/props/surfaces.py
python tools/props/credits.py
node tools/build.js
node tests/props_assets_test.js
node tests/physics_test.js
node tests/contact_test.js
node tests/rooftops_test.js
node tests/routes_test.js
node tests/props_browser.js
node tests/props_bench_browser.js
```

The first surfaces pass supplies authoring textures; the second appends standalone kit textures after atlas packing. Export scripts can log rejected imports without failing the process: check the 10-person roster and asset validation before building. The repository retains exploratory search/download scripts; final CONFIG/asset manifests, not those exploratory searches, define what ships.
