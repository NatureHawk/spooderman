# MERGE_REPORT — trees, waterfront, crowd (worktree `spooderman_life`, branch `claude/trees-water-crowd`)

Written for: whoever merges this into main (not merged here; main and the other worktrees were not touched).
Cut from main on 2026-10-02 (baseline commit `a0bd459`). `BASELINE.md` lists the sha256 of every pre-existing file this branch modifies (regenerate with `python tools/life_baseline.py` to see whether main drifted).

## What changed, in one page

| Area | Before | Now |
|---|---|---|
| **Pedestrians** | ~190 walkers on jittery wall-hugging block loops; crossings = wait 10 s then teleport to the next loop; "sit" anywhere (people sat in the street); sliding feet; one speed | Real sidewalk roadmap (21k nodes) built from the sidewalk raster; velocity-steered walkers (accelerate, round corners, keep right, pass oncoming people, stop for the hero); stride cadence = true ground speed; 4 classes × district × time-of-day density; groups of 2–4; **498 real painted crosswalks** tied to the traffic signal of their junction; kerb queues; 292 benches + 160 stoop slots + 230 promenade-bench slots + lawn + bus shelters to sit in; **hot-dog carts with a vendor and a customer queue**; photo / phone / chat stops; look-up / point / film at the hero; crowd gathers around hard landings; fear spreads and scatters from fights, then recovers; rain thins the street, opens umbrellas, sends people to shelters |
| **Waterfront** | stair-stepped 2 m raster edge, nothing under it, floating scan shards (a red ship hull hovering over the Seaport) | smooth quay line + granite quay wall to 3.9 m below the water, deck apron closing the stair-steps (layout treats it as land), 4 454 railing runs, 463 bollards, 286 lamps, 108 life rings, 140 ladders, 230 promenade benches, 8 floating finger docks with gangways, 35 berths with moored boats (tall ship at the old scan-hull spot), **moving harbour traffic**: Staten Island ferries, NY Waterway ferries, tug + barge, tour boats, water taxis, sailboats/yachts on smoothed routes with fading wakes, bobbing, moving colliders |
| **Trees** | 8 models, 3 LODs, dark canopy undersides | +8 individuals (16 models, picked per tree by position hash), brighter translucency/sky fill (undersides read green), **baked 8-view impostor LOD** beyond ~360 m (1 draw call, 2 tris per tree), draw distance 900 → 1500 m |

## Files

### Modified (small, surgical)
* `src/10_crowd.js` — **13 changed lines**: construct `TL.CrowdLife` when a roadmap exists; `spawnAround`/`think`/`despawn`/`onHeroLand` delegate to it; `render` uses `p.anim`, `p.sink` and `TL.NPC_PHONE_MODES` when present. The old loop behaviour is untouched and still drives the generated grid maps. **Nothing about PED_* models, skins, `getSkin`, `assignSkins`, palettes or extras was changed** (merge-safe with the pedestrian-model agent; see "Interactions").
* `src/03c_trees.js` — foliage light model, variant selection per tree, `TL.TreeImpostors` + 4-level LOD in `TreeField`.
* `tools/build.js` — module order: `10c_crowdnav, 10d_crowdlife, 10e_npcposes, 03l_lifeprops, 03m_waterfront` right after `10_crowd.js`.
* `tools/hd/trees_gen.py` — 8 `variant(...)` models appended (same roles, other seeds/proportions).

### Added
* Runtime: `src/10c_crowdnav.js` (roadmap, A*, density/district queries), `src/10d_crowdlife.js` (behaviour), `src/10e_npcposes.js` (new NPC poses layered over `TL.NPCAnimator` without editing `06_anim.js`: walkphone walkeat film point order serve sit sitphone siteat sitread sitrelax sitground), `src/03l_lifeprops.js` (instanced prop sets: carts, stoops, shelters + registry other modules feed), `src/03m_waterfront.js` (quay wall, apron, layout patch, scan-shard cleanup, harbour traffic).
* Pipeline: `tools/scan/crowd_nav.py`, `tools/scan/waterfront.py`, `tools/hd/life_export.py`, `tools/hd/life_props.py`, `tools/hd/life_water.py`, `tools/life_baseline.py`.
* Tests: `tests/crowd_life_test.js`, `tests/waterfront_test.js`, `tests/life/{lib,shots,crowd_probe,hero_probe,perf,toggle,eval}.js` + `views.json`.
* Data in `build/extra/` (own files, **not** in `assets.bin`): `crowd_nav.json`, `crowd_nav.bin.gz`, `life_models.json`, `life_models.bin.gz`, `life_tex_hot-dog.webp`, `life_tex_props.webp`, `life_alpha_props.webp`, `waterfront_meta.json`, `waterfront_data.bin.gz`, `waterfront_wall.webp`, `waterfront_deck.webp`; regenerated `trees_models.json`, `trees_models.bin.gz`, `trees_leaf.webp`, `trees_bark*.webp`, `trees_barkn*.webp` (`trees_layout.json` unchanged).
* The hot-dog cart is the user's model `src/new-york-hot-dog-cart` (unzipped by `life_props.py`, scaled ×1.25, textures re-encoded to 1024 px WebP).

## Data pipeline (order matters)

All steps honour `TL_BUILD_DIR`. Prerequisite: the existing MAN pipeline has been run (`streets.py`, `trees_layout`/`build_scan.py`, `build_nyc.py`).
```
python tools/hd/trees_gen.py                                   # ~7 min; only needed for the tree variants
python tools/scan/waterfront.py                                # quay wall, apron, placements, routes   -> waterfront_*.{json,bin.gz,webp}
blender -b --python tools/hd/life_props.py                     # cart, stoops, shelters, waterfront kit, boats -> life_models.* life_tex_*
python tools/scan/crowd_nav.py [--preview DIR]                 # roadmap, crossings, seats, carts, stoops, shelters (reads waterfront_meta.json) -> crowd_nav.*
node tools/build.js                                            # embeds everything in build/extra automatically
```
`tools/hd/life_props.py` with `LIFE_PREVIEW=<dir>` also renders contact images of every model.

## Merge steps (exact)

1. Check drift: `python tools/life_baseline.py C:\Users\PRIYANSHU\Pictures\spooderman` (flags rows "MAIN HAS CHANGED"). If none: plain copies below; otherwise apply `git diff a0bd459 -- <file>` of the modified file by hand.
2. Copy into main: `src/10c_crowdnav.js 10d_crowdlife.js 10e_npcposes.js 03l_lifeprops.js 03m_waterfront.js`; `tools/scan/crowd_nav.py waterfront.py`; `tools/hd/life_export.py life_props.py life_water.py`; `tools/life_baseline.py`; `tests/crowd_life_test.js waterfront_test.js tests/life/`.
3. Apply the four modified files (`src/10_crowd.js`, `src/03c_trees.js`, `tools/build.js`, `tools/hd/trees_gen.py`).
4. Copy the data files listed above from `spooderman_life\build\extra\` into main's `build\extra\` (or re-run the pipeline there). `trees_models.*` + `trees_leaf/bark*` must be copied **together** (indices of models changed).
5. `node tools/build.js` (main `THREADLINE.html` only), then `node tests/physics_test.js`, `city_activity_test.js`, `routes_test.js`, `crowd_life_test.js`, `waterfront_test.js`, `node tests/routes_browser.js`.
6. If the pedestrian-model agent has merged first nothing needs to change; if this merges first, they only touch `getSkin`/palette/extras code, which this diff does not.

## Interactions to know about
* **Pedestrian models (other agent):** `10e_npcposes.js` drives the rig by bone names (`hips spine chest neck head uarm/farm/hand L/R thigh/shin/foot L/R`, `hipsOffT`, `rig.apply`). A new skeleton must keep those. `p.sink` lowers the far-LOD silhouette for seated people (LOD figures cannot sit).
* **Atmosphere/water (other agent):** the water mesh/shader is untouched. The impostor shader uses the global fog chunks (`fog_pars/fog_vertex/fog_fragment`), so the height-haze patch applies to it. Wakes are plain translucent ribbons at `WATER_Y + 0.07`.
* **Hero physics:** no hero file changed. `03m_waterfront.js` wraps `layout.isWater` / `layout.ground` so the apron (a ≤2 m deck strip along the shore) counts as land — the hero walks to the quay edge instead of falling through the stair-steps. Boats and docks add colliders (`addStatic` for moored boats / docks / lamps, `addDynamic` + `moveDynamic` for sailing vessels).
* **CityLife (Codex):** unchanged. The crowd still honours `p.notice / p.lookAt / p.react / p.mode in {look,wave,photo,cower}`; `p.i` is a unique serial for roadmap walkers so `CityLife.social()` never pairs them up (they chat through their own groups).
* **Scan shards:** `03m` drops scan triangles inside two boxes (`SCAN_CLEAN` in `waterfront.py`) — the Peking-hull scan shards at the Seaport — and their heightfield colliders. The mapfix worktree's canopy-shard cleanup is independent of this.

## Behaviour reference (crowd)
Density = pavement area × crossings × district weight (Battery Park, Bowling Green, Financial District, Seaport, Civic Center, Tribeca) × per-class day curves (commuters 8:15/17:30 + lunch, tourists midday, locals evening, joggers 6:30/18:00); rain ×0.55. Classes change pace (0.85–3.4 m/s), clothes, stops and groups. Decisions per walker at the end of each route: seat (bench/stoop/promenade/lawn/shelter), cart queue (lunch/evening), photo/phone/chat stop, or a 70–260 m route toward a density-weighted goal (joggers prefer waterfront/park). Crossings: walkers cross only in the walk window **and** only if the conflicting direction stays red for ≥55 % of the crossing time; 7 % are jaywalkers who go after a patience timer and only through a gap; a moving car in front stops a walker mid-crossing.

## Tests, evidence, numbers
### Tests (all run on the final build)
`physics_test` 31 passed · `city_activity_test` 14 passed · `routes_test` 17 passed · `routes_browser` passed · `crowd_life_test` 6 passed (no teleports at 30/60 fps, walkers stay on the roadmap, 100 % of non-jaywalker crossings start in the walk window, kerb queues, exclusive seats, cart queue served one at a time, time-of-day/rain population, fear + recovery) · `waterfront_test` 5 passed (wall faces water, apron <= 2.2 m, props on deck, boats in water, routes in water).

### FPS per quality tier (GPU Chrome, 1280x720, chase camera, mean of 2 interleaved runs per build; "peds" = simulated pedestrians in range)
Run-to-run noise on this machine is large (the two repetitions of one cell differ by up to 2x because Codex and other agents share the GPU), so read this as "same ballpark", not as a precise delta. Differences that show up consistently: the branch simulates fewer pedestrians at quiet times (density follows time/district), costs ~+1 ms CPU for the crowd brains and adds ~35-60 draw calls near the waterfront; the far-tree impostor level saves triangles over the park.

| tier | spot | baseline fps (peds) | this branch fps (peds) |
|---|---|---|---|
| low | fidi_street | 108.0 (90) | 87.8 (70) |
| low | battery_park | 130.0 (90) | 95.9 (90) |
| low | seaport_pier | 146.7 (90) | 114.8 (55) |
| low | trees_street | 115.3 (90) | 107.3 (56) |
| medium | fidi_street | 80.9 (140) | 83.5 (109) |
| medium | battery_park | 77.1 (140) | 90.3 (140) |
| medium | seaport_pier | 105.8 (140) | 100.8 (86) |
| medium | trees_street | 92.7 (140) | 86.2 (86) |
| high | fidi_street | 44.8 (190) | 40.8 (148) |
| high | battery_park | 51.8 (190) | 48.3 (190) |
| high | seaport_pier | 63.8 (190) | 74.7 (117) |
| high | trees_street | 45.6 (190) | 60.0 (115) |
| ultra | fidi_street | 48.0 (190) | 34.8 (148) |
| ultra | battery_park | 54.1 (190) | 42.0 (190) |
| ultra | seaport_pier | 73.0 (190) | 66.8 (116) |
| ultra | trees_street | 56.0 (190) | 47.5 (115) |

Raw per-run JSON: `evidence/life/perf2_<rep>_<base|new>_<tier>.json`. Earlier single sequential run (`base_*.json` / `new_*.json`) showed bigger gaps; a reversed-order recheck at the low tier (new 98.9 / base 98.8-114 fps) showed those were noise. Per-system CPU timing is in the same JSON (`crowd`, `life.think`, `harbor`, `render`).

### Evidence (all in `evidence/life/`)
* `compare/*.jpg` — 13 before | after pairs (Battery Park shore and park, Seaport aerial + pier level, harbour, far trees, dock). Raw: `before/`, `after/`.
* `models/` — Blender contact images of every cart / stoop / shelter / waterfront / boat model.
* `nav/` — roadmap overlays (nodes, edges, crossings in yellow, benches green, carts magenta) for Financial District, Battery Park, Seaport; `wf/` shoreline overlays.
* Behaviour frames (4 frames, ~2.4 s apart, free camera): `crowd2/`, `crowd3/`, `crowd4/` (kerb queue at a crossing, seated pairs on a bench, lawn, stoop sitters, cart vendor, groups, umbrellas in rain, shelter), `hero3/` (fly-by, landing crowd, fight scatter, rain) with the matching act/animation histograms printed by `tests/life/hero_probe.js` (fight: 18 walkers flee within 2.5 s, all calm again 25 s later; landing: 5 gather in a ring; rain: street 150 -> 61 people, 8 in doorways).
* Reproduce: `node tests/life/shots.js <label> [html] [views]`, `crowd_probe.js`, `hero_probe.js`, `perf.js <html|-> <tier> <label>`.

### Known limits / follow-ups
* Far (LOD) pedestrians are single standing silhouettes: seated/queued people are only convincing inside the ~70 m skinned radius.
* Boats and the waterfront kit are procedural Blender models (no Sketchfab download was possible: Blender MCP was offline and the search found no usable harbour boats); the cart is the user's model.
* Stoops are placed on low-rise walls only (80); bus shelters 8; carts 28 (all data-driven in `crowd_nav.py`, trivial to raise).
* A car turning into a crosswalk can still brush a walker already in it (walkers stop for cars ahead of them within 5.5 m but cars brake only via the existing blocker rule).
* No new audio (foghorns, cart bells) was added.

