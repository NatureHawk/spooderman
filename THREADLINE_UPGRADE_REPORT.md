> CURRENT STATUS — October4: The twenty-building rebuild is exported and built. See [CONSTRUCTION_REBUILD_REPORT.md](CONSTRUCTION_REBUILD_REPORT.md) for the current result and [CONTINUATION_HANDOFF.md](CONTINUATION_HANDOFF.md) for continuation. The older completion claims below are historical. The user's live Edge seed/AO/settings remain unverified.

# THREADLINE v2 — upgrade delivery

The playable output is `THREADLINE.html` in this directory. Only this main gameplay build was rebuilt. Editable source, focused regression tests, and browser evidence accompany it.

## What changed

| Area | Delivered behavior |
| --- | --- |
| Surface traversal | Geometry-checked convex corners, fast roof/parapet exits, and wall/ceiling handoffs. Eligible wall contact retains the attached web and tangential movement. Blocked paths reject the transition. |
| Character animation | Planted human hands/feet and mechanical legs; smoother turns and rope loading; anticipatory web reach; brief free-hand wall skims; streamlined dives. Both heroes and manual leg retraction are covered. Ceiling palms and soles have explicit underside clearance. |
| Feedback | Material-specific contact sounds, speed/proximity wind, directional near-wall camera accents, and rope-load strain. New effects are bounded and respect mute, pause, and reduced motion. |
| Routes | Persistent personal-best humanoid guides, split comparisons, three alternate low approaches in Street Canyon, and diminishing movement-dependent traversal bonuses. Replay samples are bounded and old saves remain readable. |
| Encounters | Rooftop courier chase, runaway vehicle interception, and elevated pickup/carry/delivery rescue. Each has actual interaction conditions, success/failure, cancellation/retry, one-time rewards, and cleanup. |
| City presentation | Dithered tree detail transitions, pedestrian detail hysteresis, smoother lower-sky lighting, and coherent reflection captures. Secondary render work adapts to sustained frame pressure without changing physics. |

The earlier facade-horizon and HDR sun fixes are preserved, together with the original web-held wall-run changes.

## Try it

1. Open the main `THREADLINE.html` and start or continue a game.
2. Hold the normal swing input into an eligible wall and keep steering along it. Steer around a clear corner, run upward over a clear roof lip, or transition onto a real overhead surface. Space pushes off.
3. Press **J** to compare mechanical legs deployed/retracted; **V** switches hero.
4. Press **K** for CITYLINK. **City in motion** offers the three encounters. Follow the waypoint and use **E** when the nearby interaction prompt appears. Pause offers cancellation/retry.
5. Start a traversal route from CITYLINK or its start marker. Finish once to record a personal best, then replay against its pale guide and split times. Street Canyon accepts either its gold high gates or cyan low alternatives. **Backspace** restarts a route.
6. **F1** explains controls; **F4** opens performance diagnostics. Existing remapping remains available.

## Verification

- The broad Node regression batch passed across physics, contact/IK, swing-wall movement, launch/aerial behavior, routes, encounters, crowd/city activity, waterfront, culling, graphics scheduling, and feedback.
- Focused checks include 33 surface-flow cases, 43 contact-animation checks, 12 expressive-animation scenarios, 24 route cases, and 10 encounter scenarios. Coverage includes rotated geometry, multiple time steps, blocked paths, release mid-corner, real post-roof web catches, malformed/legacy saves, reward duplication, repeated cleanup, and ambient-event priority.
- The ceiling regression checks every vertex of the actual high-detail character meshes through handoff, gait, and edge departure at 60/120 Hz. Both heroes recorded zero penetration in those tested sequences, and animation left physical position/velocity unchanged.
- Inspected 71 rendered traversal/expression frames. The final 15 ceiling captures also recorded zero mesh penetration across both heroes and mechanical-leg toggles; full-weight skim palm error was under 0.8 mm. No runtime errors were reported.
- Real Web Audio rendering exercised four audible material profiles, bounded output, and exact silence at master mute.
- Built-game browser integration exercised CITYLINK, compact-window layout, keyboard movement, pause, reduced motion, and save branches without runtime errors. The normal E input through the main game tick picked up a real rescue civilian without also launching a web.
- The graphics browser matrix passed all 24 combinations: four quality settings, daylight/night/rain, and scan/procedural worlds. Warm resource counts remained unchanged through 180 repeated renders in each world.
- Browser encounter validation completed all three objectives against the actual Manhattan geometry and assets. Approaches were scripted position samples; the interactions and vehicle drive/braking used the game systems. This is automated integration evidence, not a claim of a full manual playthrough.

## Measured rendering cost

Isolated hardware Chrome/D3D11, GTX 1660 Ti, High quality, 960×540, fixed view, 96 GPU-synchronized frames:

| Metric | Before | Final |
| --- | ---: | ---: |
| Median | 16.3 ms | 16.3 ms |
| Mean | 16.81 ms | 15.834 ms |
| 90th percentile | 20.5 ms | 18.6 ms |
| 99th percentile | 23.0 ms | 26.8 ms |

The median is unchanged and the final 99th percentile is worse in this short run; these results do not establish an overall FPS improvement. A separate alternating comparison within the same upgraded scene isolated the reflection scheduler (288 frames per mode): recurring scheduling measured median 14.6 / p90 19.1 / p99 22.7 ms; paced scheduling measured median 14.6 / p90 18.8 / p99 21.0 ms. Once the fixed view was current, redundant reflection work dropped from 48 face captures and 6 filters to zero. Moving views and light changes still refresh reflections. These are local render measurements, not a guarantee for full gameplay or other hardware. Raw evidence: `evidence/upgrade_graphics/before.json` and `after_quick.json`.

## Evidence and reproducibility

- `tests/surface_flow_test.js`, `tests/traversal_expression_test.js`, `tests/contact_anim_test.js`, `tests/ceiling_mesh_test.js`
- `tests/routes_test.js`, `tests/encounters_test.js`, `tests/encounters_browser.js`, `tests/ghost_browser.js`
- `tests/traversal_feedback_test.js`, `tests/traversal_audio_browser.js`
- `tests/graphics_upgrade_test.js`, `tests/graphics_upgrade_browser.js`
- `tests/upgrade_integration_browser.js`, `tests/surface_flow_browser.js`
- Browser captures/results: `evidence/upgrade`, `evidence/upgrade_graphics`, `tests/encounter_evidence`.
- Main build: `node tools/build.js`.

The final main HTML was browser-tested after the ceiling repair and checked against all 49 bundled source modules. `git diff --check` passed.

## Installed skills

Downloaded and read the official OpenAI plugin skills [three-webgl-game](https://github.com/openai/plugins/tree/main/plugins/game-studio/skills/three-webgl-game) and [game-playtest](https://github.com/openai/plugins/tree/main/plugins/game-studio/skills/game-playtest). They are installed under `C:\Users\PRIYANSHU\.codex\skills`. Their simulation/render separation and browser verification guidance were applied to the existing engine.

The execution brief is `THREADLINE_UPGRADE_PROMPT.md`. This upgrade retains the existing engine and assets; the self-contained main HTML remains about 81.71 MB, so initial loading cost remains substantial. Encounters safely decline to start if the nearby geometry cannot support their objective.
