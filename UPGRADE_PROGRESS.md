> CURRENT STATUS — October4: The twenty-building rebuild is exported and built. See [CONSTRUCTION_REBUILD_REPORT.md](CONSTRUCTION_REBUILD_REPORT.md) for the current result and [CONTINUATION_HANDOFF.md](CONTINUATION_HANDOFF.md) for continuation. The older completion claims below are historical. The user's live Edge seed/AO/settings remain unverified.

# THREADLINE upgrade progress

## Request
Implement all six workstreams in `THREADLINE_UPGRADE_PROMPT.md`; install relevant online skills and finish implementation, integration, and verification in the v2 worktree.

## Baseline
- Prior rendering and web-wall traversal changes are present and must be preserved.
- Existing Node regressions passed in the preceding work; six wall pose browser previews and sky/facade GPU checks passed.
- Main build command: `node tools/build.js`.
- Browser tests need escalated execution on this Windows host; existing `tests/graphics_bench/lib.js` provides Chrome/Three.js dependencies.

## Status
- [x] Save execution prompt.
- [x] Download and read relevant game development/playtesting skills.
- [x] Continuous traversal and expressive animation.
- [x] Material/speed/impact feedback.
- [x] Route choices, ghosts, splits, and skill scoring.
- [x] Three traversal encounters.
- [x] Atmosphere and render scheduling implementation.
- [x] Integration, browser evidence, regression tests, and final build.

## Validation and issues
Installed `three-webgl-game` and `game-playtest` from https://github.com/openai/plugins/tree/main/plugins/game-studio/skills using the system installer. Read both installed skills and architecture/playtest references. Existing engine retained as explicitly scoped.

First integration build includes:
- Geometry-validated corners, fast roof carry, and ceiling transitions (traversal agent finishing expression animation).
- Material footsteps, directional near-wall wind/camera accents, bounded tension mix, pause/mute repairs.
- Persistent bounded PB guide, split comparisons, alternate route gates, traversal skill bonuses.
- Rooftop courier chase, real runaway car intervention, elevated carry/delivery rescue; CITYLINK, pause, save, and E-priority hooks.
- Dithered tree LOD, crowd skin hysteresis, coherent reflection capture scheduling and adaptive secondary cadence.

Checks passed so far:
- `node tests/traversal_feedback_test.js`: all3 groups, read-only physics, cooldown/reset, materials, mute, reduced motion.
- `node tests/traversal_audio_browser.js`: real Web Audio rendering, four audible surface profiles, no clipping, master mute produces exact silence.
- Agent: routes23, encounters9, surface flow22, physics31, swing-wall9, graphics upgrades and culling regression.

Final integration:
- Broad regression batch passed (physics, contact/IK, swing-wall, aerial/launch, routes, encounters, crowd/city, waterfront, culling, graphics and feedback).
- Latest focused results: surface flow33, contact animation43, expression12, routes24, encounters10; all pass.
- Built-game browser checks passed CITYLINK, compact layout, real keyboard movement, pause, reduced motion and save integration.
- All three encounters completed through update/interaction paths against real Manhattan assets. PB replay persisted/reloaded with31 samples and8 splits; three alternate gates validated. Browser errors empty.
- All24 quality/weather/world graphics combinations passed. Resource counts stable across180 repeated renders per world.
- 71 actual-character surface/expression frames captured. Visual review found ceiling fingertips clipping at an edge; source repaired, regressions pass, focused recapture pending.
- Final main HTML built81.71MB; exact source inclusion checked for10 key integration modules. No variant HTML outputs rebuilt.
- Delivery report saved as `THREADLINE_UPGRADE_REPORT.md`.
- Final usability repair: ambient incidents yield only after an encounter starts successfully; failed starts preserve the ambient incident. Targeted test passes; main HTML rebuilt with repair.

Latest verification:
- Isolated render timing finished; median unchanged16.3ms, p90 improved20.5→18.6ms, p99 worsened23.0→26.8ms. Same-scene reflection scheduling A/B p99 improved22.7→21.0ms. Full results and limits recorded in report.
- Final unobstructed PB ghost screenshot inspected; persisted/reloaded guide visible and browser errors empty.
- Main-game E input through actual tick picks up civilian without launching a web; final browser integration passed.

Complete: ceiling mesh repair rebuilt and visually verified in the final HTML. All15 final ceiling captures have zero measured mesh penetration (both rigs, mechanical legs on/off), with no runtime errors;71 traversal/expression PNGs retained. Source/build equality passed for all49 bundled modules, and `git diff --check` passed. No requested work remains pending. See `THREADLINE_UPGRADE_REPORT.md` for controls, evidence, and measured performance limits.

## Active follow-up: sparse Manhattan construction playground

- User requested construction frames, cranes, suspended pipes and zip-through water towers, then emphasized restrained density and video-referenced web-zip animation.
- Current plan: maximum five separated roof-supported sites, real narrow colliders and anchors, one optional route per site, orange map/minimap diamonds and CITYLINK discovery. Preserve all earlier upgrades and current Manhattan appearance.
- Geometry, traversal/animation and routes delegated separately; root owns UI, build integration and browser validation.
- Added UI site filtering and map clicks snapping to real start height; route starts take E priority before nearby discovery prompts.
- Build registers new03n construction and12d worksite modules; final main HTML rebuild pending geometry completion.
- First regression pass: physics31, contact43, routes24, worksites10, passage physics68, zip/launch and reference traversal suites all pass.
- Pending: real-scan placement/collider validation, route completion against generated sites, built-game screenshots/density review, video-based animation verification, resource/performance checks, final build and delivery report.

Completed follow-up:
- Five sites, at least345.6m actual separation; all five runs have four validated checkpoints. Starts use real authored decks; crane finishes have maintenance landings.
- Video-referenced zip poses, swing-to-passage input, bidirectional momentum preservation and clear exits delivered.70 passage checks,128 exact-kit traversals,24 full skin/mechanical mesh sequences pass; zero measured penetration.
- Built-game E input, five route reward/PB/save checks, map filtering/exact-height waypoints and CITYLINK discovery pass.60 character frames and five unobstructed city captures inspected.
- Stable resources1902 geometries/129 textures/197 programs across90 renders, no runtime/WebGL errors.1280×720 High fixed scene median17.2ms; construction on/off medians17.3/17.0ms, not a general FPS guarantee.
- Main THREADLINE.html rebuilt81.73MB with51 modules; exact source inclusion and whitespace checks pass. No variants built. Report: CONSTRUCTION_PLAYGROUND_REPORT.md. No follow-up work remains pending.
