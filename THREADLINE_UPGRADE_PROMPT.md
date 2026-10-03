# THREADLINE v2 — Make the City a Playground

## Construction rebuild — October 4

Replace the rejected rooftop kits with twenty individually designed renovations of actual Manhattan building meshes. Import each complete source building into Blender, preserve its original, remove its upper finished facade/roof, and fit new lower structural floors to the exact cut-plane outline. Use individually placed courtyards, cores, setbacks, partial facades and loading areas. The highest working floor must read as unfinished: partial concrete pours, exposed beams/rebar, timber centering, rising formwork and columns. Avoid repeated bare slab stacks.

Stage visible timber pallets, leaning wall panels, rebar bundles, cement bags, cable coils and restrained blue tarps in deliberate working zones. Shared detailed props are acceptable; building architecture must be individually specified. Keep traversal paths clear. Water tanks belong exclusively on verified completed neighbouring roofs. Use moving procedural-world crane assets with physical support and real moving anchors, including perimeter or street placement when appropriate.

Preserve full incoming speed through pipe passages and show a complete corkscrew rotation on both heroes. Keep existing web-held wall runs, wall crawling and rendering fixes. Inspect a corrected Blender proof before exporting all twenty buildings, then inspect the actual built game, test all passage directions/speeds, moving cranes, routes and persistence. Build only the main THREADLINE.html. Do not call this rebuild complete until those checks pass.

## Mission

Deliver a complete, playable upgrade to the existing superhero traversal game. Every swing should communicate weight, every surface should offer a route, and every journey should offer a reason to take the harder, more exciting line. Implement all six workstreams below, integrate them, test the built game, repair failures, and deliver the actual playable result.

The user explicitly authorized parallel agents, relevant online skill installation, and sustained implementation from start to finish. This document is an execution brief, not a substitute for implementation.

## Workspace and preservation

- Main worktree: `C:\Users\PRIYANSHU\Pictures\spoodermanv2`.
- Ship only the main `THREADLINE.html`; maintain editable source and tests. Do not rebuild other `THREADLINE_*.html` variants or deploy anything.
- Preserve all existing uncommitted fixes: continuous facade reflections, correct HDR sun, facade hand/foot planting, and web-held wall runs.
- Keep the existing Three.js runtime, assets, physics, controls, save format compatibility, and procedural/Lower Manhattan modes. Apply downloaded skill guidance to this established architecture; a framework or physics-engine migration is outside this upgrade.
- Keep simulation authoritative. Animation, sound, camera effects, ghosts, and scenery must not secretly accelerate, teleport, or collide with the player.
- Preserve accessibility controls, including reduced motion and audio volume. New UI must be compact and explain useful player actions.

## 1. Continuous surface traversal

Extend the existing collision/contact system so fast movement can flow around building corners, over roof lips, and between walls and ceilings where actual geometry supports it. Preserve tangent speed and the attached web during eligible swing-wall transitions. Support clean rejection when another facade, low ceiling, pole, or blocked roof makes a transition unsafe. Keep ordinary jumping and releasing predictable.

Acceptance: exercise both heroes, cardinal and rotated geometry, convex corners, roof/parapet exits, wall/ceiling handoffs, blocked paths, and different time steps. No tunnelling, free speed gain, forced stop into a crawl, or fake anchor in empty sky. Demonstrate a wall-run/corner/roof departure with a subsequent real web catch.

## 2. Expressive traversal animation

Improve anticipatory web reach, weight shifts through turns and rope loading, fast dive silhouettes, and brief free-hand surface skims. Build on the planted wall gait rather than replacing it. Mechanical legs must cooperate with the human body, respect manual retraction, and articulate coherently through new contacts.

Acceptance: both rope hands and both hero rigs; wrists meet visible webs; recovery limbs lift instead of sliding; no wall penetration or invalid bone transforms; transitions blend and exit cleanly. Add meaningful pose/IK checks and inspect rendered sequences.

## 3. Speed, material, and impact feedback

Use the existing sound/camera/feedback layers to make speed, tension, and clearance legible. Add smoothly mixed wind, distinct glass/brick/metal foot contacts, restrained rope-creak/load feedback, and directional near-wall/catch accents. Favor readable sound and subtle camera response over permanent speed-line clutter.

Acceptance: volumes bounded, no per-frame sound spam, no new impulse in physics, pause/resume and hero switching safe, reduced-motion honored, low-speed play quiet, strong effects reserved for meaningful motion.

## 4. Traversal mastery and replayability

Expand the current route system with alternate checkpoint approaches or route choices, persistent personal-best ghosts, split comparison, and bounded bonuses for clean wall/corner runs, low swings, and well-timed releases. Existing route results and best times remain compatible. Ghosts are visual guides with bounded memory, no colliders, and proper disposal.

Acceptance: finish/restart/abort/save/reload; faster best replaces the replay, slower runs do not; no score farming at rest; alternate routes are understandable and physically reachable; ghost display does not obscure aiming or count as gameplay geometry.

## 5. Traversal-driven street encounters

Add small replayable encounters using existing systems and assets: a rooftop chase, a runaway vehicle interception, and an elevated rescue. Each must have a visible objective, meaningful traversal interaction, success/failure/retry behavior, and a bounded reward. Discover them naturally and through existing mission UI where appropriate. Avoid spawning on inaccessible or occupied geometry.

Acceptance: each encounter can be started and completed through its actual update/interaction path, can fail or be cancelled cleanly, awards rewards once, cleans up actors/markers, and does not interfere with an active route or main mission.

## 6. City atmosphere and frame pacing

Refine distance transitions, reflections, street activity presentation, and environmental lighting using the current material/streaming architecture. Eliminate obvious popping where feasible with bounded LOD/fade changes. Add measured scheduling or quality safeguards for expensive secondary effects so new visual detail does not create recurring frame spikes. Preserve the corrected sun and facade horizon.

Acceptance: daylight/night/rain, supported quality levels, city and procedural mode, warm shader behavior, stable resource counts over repeated updates, and representative before/after timing. Record real measurements and limits rather than promising a frame rate.

## Working method

1. Read local instructions and existing implementations before extending them.
2. Install relevant skills from a traceable public source; read the downloaded instructions and apply the parts suitable for this codebase.
3. Assign non-overlapping ownership: traversal/animation, routes/encounters, and graphics/performance; the primary agent owns shared build/game wiring, feedback, integration, and final verification.
4. Implement bounded, coherent features with explicit interfaces. Coordinate before touching shared files. Do not overwrite another worker's edits.
5. Maintain `UPGRADE_PROGRESS.md` with completed work, current issues, test commands/results, and next actions so work survives context changes.
6. Run targeted real-source tests during development, then the relevant existing regression suite. Test boundary cases rather than assertions that merely restate implementation.
7. Build only `THREADLINE.html`, run real browser playtests, inspect screenshots, collect console errors and frame/resource evidence, fix failures, and rebuild after final source edits.

## Definition of done

All six workstreams have working player-visible improvements in the built game. Their integration is exercised, important existing behavior remains intact, new objectives can be completed, persistence and cleanup work, and no known critical regression is left hidden. Save a concise delivery report with controls, evidence, validation, and honest remaining limitations. Finish by linking the playable HTML, this prompt, and the report.
