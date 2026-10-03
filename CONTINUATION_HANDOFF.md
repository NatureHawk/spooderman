# THREADLINE v2 — authoritative continuation handoff

Updated: 2026-10-04, Asia/Calcutta. Read this FIRST if the conversation is lost.

## User intent and final outcome

Work in `C:\Users\PRIYANSHU\Pictures\spoodermanv2` (the user explicitly designated this as the main worktree). The terminal may start in the older `spooderman` directory: do not confuse them. Build only `THREADLINE.html` via `node tools/build.js`; never rebuild other `THREADLINE_*.html`. Preserve all existing uncommitted changes. No deployment or commit requested.

Deliver a convincing, traversable Manhattan superhero playground while preserving the realistic city. Twenty construction buildings are committed scope. Each must use its actual building mesh and footprint and have an individually specified design, not a small repeated rooftop kit. Import entire source buildings into Blender, preserve originals, remove finished upper roofs/facades, and build unfinished structural floors, distinct setbacks/courtyards/cores, partial walls, exposed beams/rebar, timber centering and column formwork. Place visible pallets of wood, leaning wall panels, rebar stock, cement sacks, cable coils and restrained tarps in deliberate working areas. Avoid cluttering the entire city. Use moving cranes from the procedural world with supported roof/perimeter/street footings and real moving anchors.

Water tanks belong on completed neighbouring roofs ONLY, never unfinished construction buildings. Pipe traversal must preserve incoming speed and include a full longitudinal corkscrew, with mechanical legs packed clear. Keep improved wall crawling/running and web-held wall-running momentum. Preserve fixes to the horizon line showing through facades and the blue/black sun core. Verify the user's actual Edge seed and ambient-occlusion settings; this remains unverified.

## Latest user feedback — highest priority

1. The initial five-site rooftop kits were rejected as white structures on finished roofs, too sparse and generic; zip passage lacked spin and killed momentum.
2. A first twenty-building Blender pass was rejected as repeated sheets that did not fit each building. Do not restore or ship it.
3. The corrected building BID117 was visually approved on October4: user said they liked it much more. Its real footprint, incomplete top floor, exposed framing/formwork and visible material stacks are the accepted direction. Apply equivalent quality with individual layouts to the other nineteen.
4. User warns many imported buildings lack wall sides. Their latest screenshot shows several finished supporting buildings open on multiple sides. **This affects imported finished-roof tank buildings as well as construction buildings.** Six construction footprint loops needed source party-wall closure, but that does NOT mean their visible facade meshes have been repaired. Audit ALL imported construction and finished-support meshes from all sides; distinguish intentional construction openings from missing exterior faces. Repair exposed exterior gaps in Blender and runtime export, check normals and adjacency. Preserve intentional open upper structure. Do not blindly copy source meshes into game.
5. User explicitly requested this handoff be written BEFORE continuing.

## Honest current status — final integration, October4

The twenty-building construction rebuild is now exported into Blender and built into the main THREADLINE.html. All20 designs,163 stock groups,20 moving cranes and20 separate finished-roof tanks are present. All40 source shells were audited;25 missing-facade repairs were executed in Blender and integrated in the game. Both visual crown refinements (BID130/118) are exported and built. The asset is NO LONGER the old mixed partial pack.

The final built-game480passage matrix,20route/reward checks,20movingcranes,UI/resource/error checks passed. ActualE corkscrew tests passed on bothrigs. All20 Blender renders and game overviews were reviewed; additional focused views cover nine crowns and eight repaired facade regions. Focused images have zeroGL/runtimeerrors. Root additionally inspected focused crown92/crown499 and repaired facade169/389. The primary complete20-building Blender review and20-game-overview review are finished; neighbours still partly obscure some contextual views, as documented.

Only the actual user's Edge runtime seed/AO/settings check remains unverified: no connected Edge surface or debugport was available. Do not confuse verified Chrome MAN/High tests with the user's live Edge state. No Edge settings were changed.

The sections below preserve implementation history and the safe continuation workflow. Their earlier pending tasks describe intermediate checkpoints; use this current-status section and the final report to determine what still needs work. Do not redo completed exports or restore rejected blueprints.

Current delivery report: CONSTRUCTION_REBUILD_REPORT.md. Main HTML116.62MB, exact55source modules verified. Editable scene: source/construction/Manhattan_Construction_20.blend.

## Workspace and tools

- Repo: `C:\Users\PRIYANSHU\Pictures\spoodermanv2`.
- Blender user-enabled MCP addon listens on127.0.0.1:9876. Direct local socket bridge `node tools/blender/bridge.js <python-file>` sends execute_code; noargument gets scene info. Timeout900000ms. A client timeout does not prove Blender stopped: inspect progress before rerunning.
- Blender scene: `THREADLINE — 20 construction buildings`. Original default Scene preserved.
- Editable file: `source/construction/Manhattan_Construction_20.blend`.
- Source construction collections: `TL_SITE_01_BID_117` etc. Preserved full originals hidden, cut working meshes retained, `AUTHORING ORIGIN <bid>` provides transform.
- Finished roof collections: `TL_FINISHED_ROOF_<bid>` and `FINISHED TOWER ORIGIN <bid>`.
- Coordinates: Three Y-up to Blender `(x,-z,y)`; Blender origin Z rotation equals site yaw.
- Main author/export: `tools/blender/author_buildings.py`. Imports blueprint JSON, expands detailed props, creates real Blender objects, merges export by material. Supports boxes/beams/arbitrary footprint triangles/open pipes/tanks/hoops; direct bmesh bevel (no slow per-object depsgraph evaluation).
- Partial rebuild controlled by scene custom property `threadlineRebuildIndices`; currently `[0]` from proof. **Clear this for final all20 export**. Proof wrapper overrides blueprint0 from structural_proof117; final normal exporter reads blueprint files.
- `tools/blender/proof117.py` runs partial export and renders proof. It hides other TL_SITE collections but currently leaves finished-roof collections visible; restore visibility / set intentional proof visibility as needed. Own proof camera/sun created. No original user objects deleted.
- Asset: `build/extra/construction_authored.json.gz`, version3, `{sites,towers,siteLinks}`. Build embeds extras automatically.
- Progress: `evidence/construction/blender_progress.json` reports last rebuilt index/object/triangle count.
- Relevant skills already used: local three-webgl-game, game-playtest and plugin-management. User requested online skill installation; existing progress docs record official OpenAI source. Do not migrate engine. Do not expose Blender addon API keys or use paid asset services.

## Team / ownership at handoff

User explicitly authorized subagents. Existing agents share files; coordinate rather than overwrite.

- `/root/render_fixes`: ACTIVE; owns `src/03n_construction.js`, original scan clipping integrations in03b/03d/03g/03l, exact footprint extraction and individually authored structural plans. It has user approval to finish remaining19, promised two batches, estimated15–20min. Owns `tools/author_construction_exact.py`, `evidence/construction/footprints_exact.json`, `structural_proof_117.json`, blueprint outputs. Must also account for latest missing-facade warning (not yet assigned at moment this file was written).
- `/root/wall_physics`: ACTIVE; owns cranes03o, finished tanks03p, supporting tests/routes integration and deliberate visible stock placements. Coordinates new staging on actual final floors. Has updated build order/disposal. Latest20 finished tower placements regenerated for10m clear approaches. Full480 passage test passes on previous/current fixture but must repeat final geometry.
- `/root/wall_animation`: completed current tasks, available. Owns detailed props helper and test harness changes; original-request audit done. No GPU running.
- Root: Blender import/export/render integration, overall visual review, docs, final build and integrated game verification.

## Completed source work and evidence (reverify final build)

### Momentum and corkscrew

Files `04c_reference.js`, `04_physics.js`, `06e_reference_anim.js`, `06_anim.js`, narrow `16_game.js` Input.latchEdges change. Captures full total incoming speed, validates curved approach, moves via normal collision substeps, clears stale competing constraints, performs full2π longitudinal spin and packs spider legs. Actual E from SWING now enters valid passage; invalid E retains web/reel and consumes stale edge.

Tests: zip_input_test.js, zip_momentum_test.js, zip_corkscrew_test.js, construction_zip_animation_test.js, construction_zip_mesh_test.js; `zip_game_tick_browser.js` now tests built HTML without source injection. Prior real-game twelve cases at15/35/60m/s and both rigs/directions passed;60m/s worst59.781,35 worst34.970. Saved `evidence/construction/zip_revision/actual_game_tick_metrics.json`, full_city_passages.json and quarter/half/threequarter screenshots. Prior full-city480 cases/40gates worst99.67% speed. These results predate final revised geometry and do not certify it.

### Cranes

`src/03o_construction_cranes.js` uses actual procedural S_crane_mast/jib/hook assets, safe supported footings, bounded slew, pendulum hook/cable, matching dynamic colliders and anchor velocity. Updated by simulation fixed steps (physicsDriven prevents doubleupdate). Current tests11checks and browser helper. New true-footprint perimeter footing search added. Final20 need rerun.

### Finished-roof tanks

`tools/relocate_construction_towers.js`, `tools/construction_tower_tools.js`, `src/03p_finished_towers.js`. `evidence/construction/relocated_towers.json` contains20 tanks on20 distinct finished roofs, no construction IDs,20siteLinks, zero skipped. Validates support, nearby solids and full10m approach width. `finished_tower_template.json` preserved original tank template. Do not regenerate from stripped construction models without template.

Load order03n→03p→03o integrated in tools/build.js; FinishedTowers.dispose before Construction.dispose integrated in16_game. Author exporter imports actual supporting buildings and exports tank meshes separately. Supporting source buildings visibly have missing facade sides: outstanding repair.

### Routes / persistence

12b_routes/12d_worksites support20 sites,32PB cap, geometry signature invalidates stale ghosts/PBs but one-time worksiteRewards ledger remains separate. Site links insert nearby finished tank into construction route. Tests13worksite/24base earlier pass, then current20 routes80checkpoints fixture passed. Recheck after final geometry/IDs.

### Detail props

`tools/blender/detail_parts.py`: `expand_details(model,tags=None)` expands explicit model.details entries for pallet_bundle, panel_rack, rebar_bundle, cement_bags, cable_coil. Real boards/fork pockets/straps/nails, leaning ribbed panels, rods, shaped sacks and loops. Existing box/beam/footprint shapes only, matching colliders, idempotent. Tests construction_detail_test.py passes5types×3angles; `evidence/construction/detail_preview.png` visually reviewed. Shared detailed prop components okay; no generic shared building architecture.

### Original render/wall fixes

Agent audit just confirmed horizon fix in03d_facade,03l_buildings,03f_replace with continuous sky/street blend; horizon_fixed.png clean. Sun HDR grading clamp21_post.js around328 prevents cubic highlight inversion; sun_fixed.png clean. tests/render_post/artifacts_regression.js covers three facade shaders and14×white HDR monotonicity. Current wall_animation7groups, handswing14, swing_wall9, surface_flow33 CPU checks pass. Existing wall_metrics.json covers crawl/run/web and mechanical legs on/off, errors[]. These should remain unchanged through construction work.

**Edge-specific seed/AO remains unverified.** All known automated browser runs used Chrome. Do not claim they establish user's actual Edge state. Inspect actual Edge tab/storage/runtime via authorized browser tools when possible; report exact observed seed/AO/quality and uncertainty.

## Exact building IDs and data

Construction index→bid:0→117,1→147,2→130,3→169,4→499,5→173,6→598,7→212,8→205,9→92,10→178,11→697,12→418,13→127,14→228,15→425,16→472,17→242,18→124,19→118.

`building_manifest.json` includes original positions/UVs, clipped triangles, x/z/yaw/cutY/baseY/originalTop. Do not overwrite it casually by running older exporter selection logic.

`footprints_exact.json` records actual cut-plane loops/holes, bounds/areas and party-wall closure provenance. BID117 actual3445m² versus rejected rectangle1250m². Other real footprints can be5000–7800m². Old hx/hz do NOT frame them. Final model.bounds/hx/hz must reflect actual footprint; runtime and cameras updated to use these.

Proof117: full footprint~66.8×51.6m; lower floors conform, courtyard/lift openings, setbacks, structural grid, upper floor~43% poured, exposed beams and timber centering, core/wall piers above top, rising columns/formwork,10visible staged stockgroups. Exact cut datum slab closes retained building top. Agent improving collider polygon containment and recording courtyard rings/indices.

## Remaining ordered work

1. Finish this durable handoff and verify it exists (current immediate task).
2. Tell agents latest missing-wall requirement. Audit and repair all exposed missing facade sides for20 construction and20 finished-roof support buildings. The screenshot demonstrates actual missing geometry; closed2D footprint alone is insufficient. Check in neighbourhood context, outward normals and collision consistency. Keep preserved originals for comparison.
3. Finish19 individual architecture designs, supported visible material staging, true bounding metadata, exact cap/void collision checks. Do not clone117 layout; each footprint and working-floor sequence must differ deliberately.
4. Review new buildings in Blender from enough angles, including their repaired lower shells. Clear partial rebuild property and restore intended collection visibility; run full export. Confirm all20 correct models and20 separate tanks in gzip, no unfinished tanks, valid part/solid indices, supported crane/pipe gantries and no floating stock.
5. Build ONLY `node tools/build.js` after asset/source complete. Check exact source inclusion and source syntax. No variant output.
6. Run final CPU tests appropriate to geometry/movement/cranes/towers/routes and repair failures. Run ONE GPU job at a time. No shader warmup overlap with Blender renders.
7. Run `tests/worksite_browser.js` (updated20site adaptive framing,3finished tower shots, route/reward interactions, crane motion, full-city passage helper, resource stability/render cost). Run actual built `tests/zip_game_tick_browser.js` for E and spin if not folded into main helper. Inspect actual screenshots for ALL20, not only successful test text. Missing facades must be visibly checked from multiple sides; add views if harness single view hides a gap.
8. Verify actual Edge seed/AO/quality settings. This is pending, not satisfied by Chrome results.
9. Update stale docs (UPGRADE_PROGRESS.md, CONSTRUCTION_PLAYGROUND_REPORT.md, THREADLINE_UPGRADE_REPORT.md) with final honest state and evidence. THREADLINE_UPGRADE_PROMPT.md was just updated to20scope, earlier reports still describe historical5site pass.
10. Deliver concise result with link to mainHTML, key changes and real validation; name remaining limitations if any. Do not say complete unless actual rebuilt gameplay/visuals passed.

## Testing operational notes

- Hardware Chrome/Puppeteer harness: tests/graphics_bench/lib.js. Puppeteer package under `%LOCALAPPDATA%/Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness/node_modules`.
- Browser startup/fullMAN shader warmup can take2–3minutes. Combine helpers in one browser session. Avoid repeated boots.
- `checkBuiltCityPassages(page,20)` from tests/construction_city_passages.js; `checkCraneMotion(page)` from construction_cranes_browser.js; `checkInteractions(page)` from worksites_browser.js.
- Fullcity helpers updated for20 sites and separate finished tower gates; verify current code rather than assume older checks.
- worksite_browser adaptive24azimuth×4elevation search uses actual mesh bounds and flags incomplete framing. Need all-side facade views beyond one best screenshot when necessary.
- Windows sandbox cwd may permit only oldworktree; writes/build/browser/Blender calls forv2 have used require_escalated with task-specific authorization. Avoid destructive commands, keep edits confined to explicitly named v2 repo. Never delete original source meshes/user scene.

## Crosscheck checklist for successor

- Read git status/diffs; many changes predate current construction turn and must be preserved.
- Read live agent messages before assuming their work has finished.
- Inspect blueprint modification times and Blender progress; partial asset is not final.
- Confirm exactly20 constructionIDs, zero tanks onthem, finished tower support IDs distinct.
- Confirm actual closed exterior walls where source missing, intentional open upper floors, and correct facade/collision normals.
- Confirm source and finalHTML are in sync after build.
- Separate old evidence from fresh final-geometry evidence.
- Update this file as work progresses so it remains the source of truth.

## Updates after initial handoff write

- Missing-wall repair assigned to wall_animation: new audit_repair_facades.py, repair JSON/gzip,03q_facade_repairs.js and Blender repair_facades.py. Root will integrate build hook and invoke Blender repair. Preserve original meshes and cover actual missing exterior polygons at each height band.
- Renderer delivered first ten exact structural designs into structural_blueprints_20.json; currently partial, wait for all20. Blender exporter now selects that file only when it contains exactly20 sites, otherwise keeps earlier inputs.
- Browser surface inventory exposes only Codex in-app browser and MCP Apps, no connected Edge tab. Actual user's Edge seed/AO remains unverified; do not infer it from Chrome.

## Earlier six-workstream upgrade — preserve, do not redo blindly

The original all-game upgrade also covered material footsteps/wind/tension feedback, persistent PB ghosts/splits/alternate routes, rooftop courier/runaway vehicle/elevated rescue encounters, and LOD/reflection/frame-pacing improvements. These were previously implemented and integrated; details, controls and evidence live in THREADLINE_UPGRADE_REPORT.md and THREADLINE_UPGRADE_PROMPT.md. Prior broad regressions and24quality/weather/world combinations passed; do not erase these features while rebuilding construction. Original performance was mixed (median16.3ms unchanged, p90 improved, p99 worsened in one overall comparison); do not claim universal FPS improvement. Reports now carry an explicit current-status notice so historical completion cannot be mistaken for the ongoing rebuild.

- Fresh root CPU checks: zip input,48momentum sequences, corkscrew, finished towers and12crane checks passed. Momentum evidence write initially hit sandbox EPERM, then reran with authorized permissions and exit0.
- Edge exposes neither a connected browser surface nor a remote debugging port; actual live seed/AO remains unverified.
- All20structural drafts delivered; physics agent applying163visible stockgroups and renderer optimizing inflated floor collider decomposition. Full export must wait for their ready signals.

## Facade repair audit completed in source — October4 follow-up

Owner wall_animation added `tools/audit_repair_facades.py`, `src/03q_facade_repairs.js`, `tools/blender/repair_facades.py`. The audit covers all20 construction IDs and all20 finished tank-support IDs from the manifest/relocated-tower data. **25 of40** have substantive absent exterior faces. Original scan binaries/meshes remain unchanged. Repairs reconstruct only original horizontal roof/terrace boundary walls in each height interval, subtract existing vertical triangle coverage, preserve courtyard holes/setbacks, and cap construction repairs at cutY. They are not building bounding-box fills.

Data: `evidence/construction/facade_repairs.json`, embedded `build/extra/construction_facade_repairs.json.gz`. There are25 overlay meshes and191 thin boundary collision segments. Runtime reuses the existing city facade material and building-style/window fallback; do not ship plain gray diagnostic material. Register03q after03p/03o and dispose facade repairs before world teardown. Root is integrating those hooks.

Blender: run `tools/blender/repair_facades.py` after author_buildings.py. It creates tagged additive wall objects, preserves finished-building originals before applying working facade materials, keeps hidden construction originals, and saves the editable blend plus `blender_facade_repair_report.json`. Script syntax checked; **root must execute and inspect final Blender output**.

Verified:
- `python tests/facade_repair_test.py`: all40 original roof-profile exterior coverage audits have0 remaining substantive missing area after repairs; new outward triangle normals, unchanged source data, no construction patch above cutY.
- `node tests/facade_repair_runtime_test.js`:25 meshes,191 exact boundary ray/collider probes, source metadata preservation, city-style interface and cleanup pass.
- `node tests/facade_repair_browser.js`: rendered320 geometry views (four directions before/after for40 shells), no browser errors. Allfour contact sheets visually inspected. Repairs close true exposed source gaps (especially finishedBID389); stepped profiles, courtyards and intentional cut-plane openings remain. Evidence: `evidence/construction/facade_audit/all_sides_1.png` through`all_sides_4.png`, individual`bid_<id>.png`. Amber is diagnostic highlighting, not runtime facade color.
- Final integrated textured-game facade appearance and final Blender execution are still pending. Geometry preview does not claim the final HTML is built or visually passed.

Additional narrow traversal repair: final new BID418 geometry exposed an old straight-chord validation bug on a curved zip approach. `04c_reference.remainingPassageClear` now checks the cached actual remaining curve against current colliders, preserving dynamic-blocker rejection. `zip_curve_clearance_test.js` passes both clear-curve/blocked-chord and new-curve-obstacle cases;48 momentum sequences still pass. Full-city rerun then exposed a separate real60m/s exit obstruction at construction12; renderer found a crown lintel and is fixing authored geometry. Do not weaken collision checks. Final480 cases need rerun after that repair.

Latest facade/traversal integration: renderer repaired actual crown lintels; final480 full-city sequences now PASS with all163 expanded stockgroups AND the191 new facade boundary colliders included. `construction_city_passage_test.js` explicitly loads03q into the full scan fixture. Both heroes/directions at15/35/60m/s pass40gate routes. `full_city_passages.json` refreshed. This resolves the earlier BID418 exit blocker noted above; final Blender/export/HTML visual checks remain outstanding.

## Current integration state — full export completed

- All20 construction buildings are now actually loaded in Blender (24,264 authored objects,728,608 triangles), not just blueprint files. Full export and repair scripts completed successfully;40 facade shells audited,25 patched,1281 repair triangles. Saved source/construction/Manhattan_Construction_20.blend.
- Main THREADLINE.html built116.52MB; exact inclusion verified for55source modules. No variants rebuilt.
- Built-game tests/worksite_browser.js PASS:20 sites with minimum94.81m center separation,20routes/rewards,20finished-roof tanks zero skips,20moving cranes,480real passage cases min99.6726% speed retention, map/CITYLINK, stable resources and no runtime/WebGL errors. Fixed1280×720High view median17.0ms, p9022.8ms,p9926.0ms; this is one synchronized render scene, not general FPS.
- All20 Blender renders individually reviewed by render_fixes. No visible floating parts, footprint mismatch or unintended lower wall gaps. Two visual refinements still being applied: BID130 broad bare crown and BID118 long sparse strip. Root authorized limited timber/rebar casting changes preserving props/traversal. Partial re-export indices2,19 then rebuild and relevant final tests required.
- wall_animation now reviewing actual game site_1..20 and finished_tower screenshots. Root is running actualE zip_game_tick_browser test. GPU onlyonejob at a time.
- Edge actual live settings still unverified: no connected Edge surface/debugport.

## Final build checkpoint

- Partial refinement export indices2/19 completed, partial-rebuild property cleared, scene saved. Final Blender asset9929824bytes. MainHTML rebuilt116.62MB with55source modules.
- Final full browser run passed20sites/20routes/20tanks/20cranes/480passages. Minimum speed retention99.6726%. Fixed-cameraHigh median16.5ms,p9017.2ms,p9919.1ms; stable2743geometries/140textures/223programs, noerrors.
- Focused visual evidence: evidence/construction/focused/report.json plusninecrowns/eightfacaderegions. Neighbours partly occlude somecityviews; isolated4directiongeometryreview covers shells separately.
- Preliminaryoverview pale horizon was a benchmark camera/environment synchronization artifact: environment sky followscamera duringenv.update butBENCH.render movedcameraafterupdate. Focusedharness correctedthis; no gameplay sourcefixneeded.

## Delivery state

Construction/game implementation is complete and saved. No further game or asset edits are pending. The only separate original request still unverified is the live Edge seed/AO/settings check. Use CONSTRUCTION_REBUILD_REPORT.md and the current-status section above; historical pending items below those sections describe earlier checkpoints.
