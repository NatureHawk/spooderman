# Manhattan construction rebuild — October 4, 2026

Playable output: [THREADLINE.html](THREADLINE.html). Editable Blender scene: [Manhattan_Construction_20.blend](source/construction/Manhattan_Construction_20.blend). Only the main HTML was rebuilt.

## What changed

Twenty individually specified construction buildings now replace the upper finished portions of actual Manhattan buildings. Their floor outlines follow the source footprint, with different cores, courtyards, setbacks, partial walls and incomplete casting floors. Visible work areas include163 supported groups of timber pallets, leaning panels, rebar, cement sacks and cables, plus formwork and restrained tarps. The two largest visually sparse crowns were refined after review.

Twenty moving cranes use the procedural-world crane assets, supported roof/perimeter footings, dynamic colliders and moving web anchors. Twenty water tanks stand on separate finished roofs; none remain on unfinished buildings. Routes connect the construction sites to nearby traversal openings.

Audited40 source buildings from four directions. Twenty-five had genuine missing exterior faces. Added1281 repair triangles and191 narrow boundary colliders, preserving setbacks, courtyards and deliberately open construction floors. Original meshes are preserved in Blender.

Pipe traversal now preserves full captured incoming speed along a checked curved approach and uses a complete360-degree corkscrew. Both hero rigs pack their limbs/mechanical legs through the opening. Actual E input from an active swing enters the passage; invalid entry keeps normal web behavior. Existing wall-crawl, retained-web wall-run, sun and facade-horizon fixes remain in source.

## Verification

- Final asset audit:20 construction models,20 separate finished-roof tanks,163 staged stock groups, zero unfinished-site tanks.
- Exact architectural tests:20 footprint caps,152 floor openings,5267 contained floor colliders, supported detail groups and valid pipe anchors.
- Final built-game playtest:20 sites,20 routes/reward checks,80 route checkpoints,20 moving cranes, map/CITYLINK discovery, zero skipped tanks.
- All480 built-game passage cases pass across40 openings, both heroes, both directions and15/35/60m/s. Minimum speed retention99.6726% in this matrix.
- Actual game E-key test:12 swing entries, complete corkscrew and speed traces pass. This ran before the final two visual-only casting refinements; the entire480-case matrix ran again on the final build.
- Individually reviewed all20 Blender renders. Reviewed20 game overviews and3 tank views. Additional focused views captured nine crowns and eight textured repaired facade regions, with no runtime/GL errors. Neighbours still partly occlude some dense-city views; separate four-direction shell checks cover their geometry.
- Final source/build equality:55 modules. Main HTML116.62MB. Source syntax and whitespace checks pass.
- Final fixed-camera1280×720 High test:90 frames, median16.5ms, p9017.2ms, p9919.1ms. Geometry/texture/program counts stable at2743/140/223. No runtime or WebGL errors. This is a single synchronized rendering sample, not a general gameplay frame-rate guarantee. Construction on/off timing was noisy and does not support an FPS-improvement claim.

## Evidence and controls

- `evidence/construction/report.json`: final built-game routes, cranes, UI, cameras, resources and timing.
- `evidence/construction/built_city_passages.json`: final480 actual built-game passage cases.
- `evidence/construction/zip_revision/actual_game_tick_metrics.json`: E-key entry and spin evidence.
- `evidence/construction/blender_final/`: individual Blender building renders.
- `evidence/construction/facade_audit/all_sides_1.png` through `all_sides_4.png`: all40 source shells, before/after and four directions.
- `evidence/construction/blender_facade_repair_report.json`: actual executed Blender repair record.
- Worksite runs are available through CITYLINK and map diamonds. Use existing E interactions at starts and valid pipe/tank approaches.

## Remaining limitation

The user's actual running Edge tab was not accessible through the connected browser tools and exposed no debugging port. Its current live seed, AO override and quality settings remain unverified. Automated gameplay checks used Chrome with seedMAN and High quality; they do not establish the user's Edge settings. No Edge settings were changed.

For continuation or changes, read [CONTINUATION_HANDOFF.md](CONTINUATION_HANDOFF.md), which records ownership, source files, safe export commands, historical rejected versions and the latest integration state.
