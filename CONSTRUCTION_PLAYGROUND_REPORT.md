> CURRENT STATUS — October4: The twenty-building rebuild is exported and built. See [CONSTRUCTION_REBUILD_REPORT.md](CONSTRUCTION_REBUILD_REPORT.md) for the current result and [CONTINUATION_HANDOFF.md](CONTINUATION_HANDOFF.md) for continuation. The older completion claims below are historical. The user's live Edge seed/AO/settings remain unverified.

# Manhattan construction playground

Built into the main `THREADLINE.html` in `spoodermanv2`. The realistic MAN scan remains the base map.

## What changed

Five rooftop sites add exposed concrete floors and columns, lattice tower cranes, suspended hollow pipe loads, and water towers with open steel supports. Sites must be at least 235 m apart, with the nearest approximately 198 m from spawn. Most of the skyline remains untouched. Geometry is original and generated locally; no commercial game map or assets were imported.

Each site has four checkpoints and an optional worksite run. First completion awards 180 XP once; repeat runs chase medals, split times and a saved personal-best ghost. New orange start markers are only 4 m tall and appear nearby or when selected as a waypoint. The map and CITYLINK expose the sites without adding permanent distant beacons.

Zip-through now preserves incoming longitudinal speed, checks the full exit before accepting a passage, and releases before steering can turn a fast exit back toward the rim. It can begin directly from a swing. Blocked or absent passages leave the existing swing web alone. The web anchors lie on actual pipe rims or tower legs.

Local video references informed a two-hand reach and pull, compact knees/elbows through the opening, and a short opening release after the far rim. Poses follow distance through the passage. Both heroes are supported; mechanical legs pack for clearance and preserve the player's manual retraction setting.

## Controls

- **M:** orange diamonds locate the sites; clicking one targets its real starting height.
- **K → Worksite runs:** pick a site waypoint.
- **E near a start:** begin the optional run. **Backspace:** restart.
- **E while airborne or swinging toward a clear opening:** zip through the pipe or beneath the tower.
- Normal swing and point-zip controls target the crane members. Open floors remain available for free exploration.

## Evidence and checks

- `tests/construction_test.js`: five placements on actual scan roofs; broad start support, standing clearance through frame openings,1,025 capsule sweep samples through pipe/tower lanes, anchors on real member faces, finite geometry and cleanup.
- `tests/construction_worksites_test.js`: five actual scan routes with twenty usable checkpoints and full pipe approaches.
- `tests/worksites_test.js`:11 lifecycle, reward, save, interaction priority and marker visibility checks. Existing24 route checks pass.
- `tests/construction_traversal_test.js`:70 physics cases, including speed/direction/frame-rate coverage and safe swing-to-passage activation.
- `tests/construction_geometry_traversal_test.js`:128 complete passages through the authored kit plus ordinary crane swing/point-zip targeting.
- `tests/construction_zip_animation_test.js`: six actual rig sequences covering direction and mechanical-leg settings.
- `tests/construction_zip_mesh_test.js`:24 high-detail skin and mechanical-link/claw sequences, both passages, directions and19/65m/s; measured maximum penetration0.000000m.
- `evidence/construction/zip/`:60 rendered character frames and metrics, reviewed for reach, entry, bore, exit and release.
- Existing physics31, contact43, launch and reference traversal suites pass.
- Final `tests/worksite_browser.js` passes in the built game: all five routes, actual E keyboard input without accidental launch, once-only rewards and replay persistence, CITYLINK discovery, filter behavior and exact-height map waypoints. All five unobstructed city screenshots and the map screenshot were inspected. Runtime and WebGL errors were empty.
- Final HTML exactly includes all51 source modules. Only the main output was built.

Initial integration found two rejected starts caused by scan mesh/collider height differences. Starts now use the authored concrete decks. A real maintenance landing supports the crane finish; clearance checks remain strict.

The browser route-completion check scripts positions through ordered checkpoints to test scoring, rewards and persistence. Separate physics and mesh tests exercise actual passage movement; automated route completion is not a claim of a manual timed playthrough.

## Rendering budget

Five sites share materials and merged geometry: 35 draws before frustum culling, 43,088 triangles and 2,195 narrow collision members. One-time placement measured approximately 190 ms in the scan CPU test, with a bounded candidate search. Rendering resources and measured scene timing are recorded in `evidence/construction/report.json`. These measurements do not promise a frame rate on other settings or hardware.

Final browser spacing was 345.6 m minimum. At 1280×720 High, 90 synchronized renders had 17.2 ms median and 20.5 ms p90. A short alternating same-camera comparison measured 17.3 ms median with construction visible versus 17.0 ms hidden; this small difference is within normal run variation. Geometry/texture/program counts remained 1902/129/197 before and after the stability run. This measures the selected static scene, not full-city gameplay performance.

## References

The direction follows the expanded traversal playground discussed in [PlayStation's Spider-Man2 gameplay overview](https://blog.playstation.com/2023/09/14/marvels-spider-man-2-new-state-of-play-trailer-gameplay-details/) and the exposed slabs, columns and crane structures visible in [construction-area reference imagery](https://www.actugaming.net/soluce-la-flamme-marvels-spider-man-2-596460/). Local motion-reference frame sheets are saved under `evidence/construction/reference/`.
