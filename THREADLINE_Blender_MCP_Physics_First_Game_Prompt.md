Build a cinematic open-world web-swinging superhero game that runs in the browser. Deliver it as a SINGLE self-contained HTML file using Three.js from a stable CDN (cdnjs/jsDelivr/unpkg). No npm, bundler, build tools, local server, external model files, or separate CSS/JS. It must run by opening the HTML file while online.

Comment every major system and keep the single-file code modular with classes such as Game, Input, WorldStreamer, CityGenerator, CollisionWorld, HeroController, TetherSystem, TraversalStateMachine, CameraRig, CombatSystem, AIManager, CrowdManager, TrafficManager, MissionManager, UIManager, AudioManager, SaveManager, and ObjectPool.

Implement CORE fully and robustly. Then implement as much STRETCH content as possible WITHOUT breaking CORE. Anything omitted must have a clear `// STUB: ...` comment and must not leave a broken button or fake feature.

════════ ORIGINALITY & TARGET ════════
Create an original game with the feature density and movement fantasy of a modern console open-world web-swinging action game, but do NOT copy Marvel/Spider-Man characters, names, logos, suits, stories, dialogue, UI, music, animations, maps, villains, or assets. Never use Peter Parker, Miles Morales, Venom, Oscorp, or recognizable franchise costumes.

Working title: THREADLINE: CITY UNDER TENSION.

Heroes:
- WEAVER: rescue engineer using synthetic filament and four compact mechanical tension arms; heavy, precise, defensive; slate/amber identity.
- PULSE: robotics developer whose conductive suit stores kinetic/electrical energy; fast and acrobatic; teal/copper identity.

Use my **Blender MCP extensively for major 3D asset creation and preparation** instead of trying to fake all important geometry procedurally in Three.js.

Use Blender MCP to create and prepare:
- The two original playable heroes
- Modular buildings and rooftops
- Bridges, cranes, signs, fire escapes, pipes, HVAC units, water tanks, etc.
- Roads, sidewalks, props, vehicles, boats and drones
- Environmental pieces needed for traversal
- Simplified collision meshes/proxies where useful
- Hero rigs and simple traversal/combat poses where practical
- Reusable modular city pieces that can be instanced/streamed efficiently

Keep the visual style original and optimized for browser performance.

Use Three.js/runtime code for lightweight procedural detail, CanvasTexture assets, procedural shaders, particles, dynamic VFX, debug visualization, runtime materials, Web Audio, and other effects where appropriate.

**IMPORTANT:** Blender is primarily for creating and preparing assets. The actual gameplay physics and traversal must run in the browser in real time. Do NOT fake traversal with prerecorded animation paths or scripted motion.

If Blender-generated assets are used, keep the final deliverable compatible with the existing single-file HTML requirement. Prefer baking/embedding required asset data into the final HTML or otherwise making the result self-contained. Do not leave required external `.blend`, `.glb`, `.gltf`, texture, script, or asset dependencies unless they are explicitly embedded into the final HTML.

### PHYSICS-FIRST DEVELOPMENT PRIORITY

The highest priority of the entire project is **physical traversal quality**.

Do NOT spend significant development time polishing menus, dialogue, cosmetic systems, huge crowds, missions, or secondary effects until the core traversal system feels physically convincing.

Development priority:

1. Real tether/web attachment
2. Rope/tether physics
3. Momentum preservation
4. Player collision and anti-tunneling
5. Swing acceleration and energy transfer
6. Release behavior
7. Reel-in/reel-out
8. Directional steering
9. Moving-anchor physics
10. Corner wrapping
11. Point launch
12. Slingshot physics
13. Wall running and wall transitions
14. Glide physics
15. Chaining traversal states without losing momentum
16. Only then expand combat, AI, crowds, missions, UI and polish

Build a **small traversal test environment first** using Blender MCP. It should contain representative buildings, roof edges, poles, cranes, bridge structures, moving platforms/vehicles, narrow alleys, walls, ceilings, long gaps, and anchors at multiple heights.

Do not move on to large-scale world content until the traversal physics can reliably pass the required swing, release, collision, and high-speed tests.

### PHYSICS MUST BE REAL, NOT SCRIPTED

Never simulate web swinging by simply moving the player along a predefined animation curve.

The player must maintain a real physical position and velocity and must be integrated by the physics simulation.

The tether must:
- Attach to actual visible collision geometry
- Have a real world-space anchor position
- Maintain a physical rope length
- Apply tension only when the rope is stretched
- Never push the player away from the anchor
- Preserve tangential velocity
- Constrain radial motion physically
- Support momentum conservation during release
- Support gravity and air resistance
- Support reel-in/reel-out
- Account for moving anchors
- Remain numerically stable at high velocity

Use a fixed physics timestep and physics substeps. Protect against instability, NaN values, infinite forces, explosive jitter, and tunneling.

### SWINGING SHOULD FEEL PHYSICAL

The swing system should behave like a real pendulum attached to a moving player.

At minimum calculate:
- Player position
- Player velocity
- Anchor position
- Relative position
- Rope direction
- Rope length
- Maximum rope length
- Relative velocity
- Radial velocity
- Tangential velocity
- Gravity
- Tension
- Reel velocity
- Steering forces
- Air resistance
- Moving-anchor velocity where applicable

Swinging should naturally allow the player to:
- Build speed through swing pumping
- Lose speed when steering poorly
- Convert height into horizontal speed
- Convert horizontal speed into height
- Dive to gain speed
- Pull upward to trade speed for altitude
- Release with the actual physical velocity at the moment of release
- Catch another real anchor while moving quickly

Do not clamp the player to an artificial swing arc unless required as a numerical stabilization technique. Any stabilization must preserve believable momentum and energy.

### ANCHOR SELECTION MUST USE REAL GEOMETRY

When the player requests a tether:
- Cast rays/spheres in a camera-directed search cone.
- Consider camera direction, movement direction, velocity, turning side, player height, clearance, distance, visibility, and line-of-sight.
- Prefer real surfaces and structural points that make physical sense for swinging.
- Reject anchors that are too low, too close, too far, obstructed, unstable, or likely to cause collision problems.
- Never attach to the sky, arbitrary invisible points, or fake helper points without corresponding visible geometry.
- When possible, store moving anchors in target-local space and update them every physics step.
- Support buildings, bridge beams, cranes, poles, vehicles, drones, and boss/environment anchors where physically appropriate.

### PHYSICS DEBUG MODE

Create a dedicated physics debug mode showing:
- Player velocity vector
- Gravity vector
- Rope direction
- Rope length
- Maximum rope length
- Tension force
- Radial velocity
- Tangential velocity
- Current anchor
- Candidate anchors
- Collision normals
- Player collision capsule
- Current traversal state
- Physics timestep/substep count

Add controls to pause physics frame-by-frame and inspect individual simulation steps.

### PHYSICS VALIDATION LOOP

After implementing each major traversal feature:
1. Run the relevant physics test.
2. Inspect for jitter, tunneling, unstable forces, NaN/Infinity values, momentum loss, and state-transition failures.
3. Fix the physics before adding unrelated features.
4. Repeat until stable.
5. Only then expand the world or feature set.

The goal is for traversal to feel **weighty, responsive, momentum-driven, and physically coherent**, not merely visually similar to a superhero-swinging game.

════════ WEB RUNTIME & BOOTSTRAP — BUILD FIRST ════════
- Use a classic CDN `<script>` build of Three.js that works from `file://`; avoid ES modules and local fetches.
- Put HTML, CSS, shaders, workers, data, and JS in one file. Inline workers via Blob URLs.
- Provide a polished title screen with New Game, Continue, seed, quality, controls, and Start. Start from a click so Pointer Lock/Web Audio initialize correctly.
- Show an error panel if WebGL or CDN loading fails.
- Use a seeded PRNG, fixed physics timestep, and render interpolation.
- Support resize, fullscreen, Pointer Lock recovery, pause on focus loss, keyboard/mouse, and gamepad.

════════ CORE — IMPLEMENT FULLY ════════

WORLD & RENDERING
- Build one continuous, procedurally generated New York-style city about 1.5–2 km across, divided into streamed chunks.
- Districts:
  1. Manhattan-style core: glass/stone towers, plazas, dense avenues, rooftop gardens, water towers, HVAC, cranes, large park.
  2. Brooklyn-style waterfront: brick apartments, brownstones, warehouses, markets, boardwalk, rail structures.
  3. Queens-style industrial/technology zone: factories, research campus, highways, depots, broad gaps and glide routes.
- Include a river, suspension bridge, alleys, rooftops, fire escapes, parks, construction zones, underpasses, and mission interiors.
- Generate roads, sidewalks, blocks, lots, zoning, varied footprints/heights, facades, roofs, signs, street props, traffic lanes, pedestrian paths, anchors, and rooftop arenas from the seed.
- Avoid identical boxes. Use setbacks, cornices, varied windows/materials, balconies, scaffolds, tanks, vents, and billboards.
- Stream chunks around the player and preload in the velocity direction. Cleanly unload distant chunks.
- Use InstancedMesh, object pools, frustum/distance culling, fog, LOD, and simplified collision proxies.
- Provide Low/Medium/High/Ultra presets and configurable render distance.

PHYSICAL WEB/TETHER SYSTEM — HIGHEST PRIORITY
- Visibly shoot a synthetic web/filament from the correct wrist to REAL collision geometry. Never attach to sky, invisible arbitrary points, or obstructed points.
- On swing input, cast rays/spheres in a cone using camera direction, movement, velocity, turn side, height, clearance, and distance. Score candidates and choose a valid building, bridge, crane, vehicle, drone, or boss anchor.
- Reject anchors that are low, close, distant, blocked, unstable, or collision-prone.
- Animate line extension, attach at the hit point, and alternate arms according to side/body pose.
- Store moving anchors in target-local space and update each physics step.
- Use pendulum physics. For player P, anchor A, D=P-A, distance d, direction n, rope length L, and relative velocity V, apply inward spring/damper tension ONLY when d>L. The rope pulls but never pushes. Preserve tangential velocity and use safe positional correction.
- Support reel-in/out, tangent pumping, lateral steering, diving, speed/height conversion, force clamps, and substeps.
- Release instantly and preserve actual velocity; never replace it with a scripted vector.
- Add Swing Assistance 0–100. Higher values improve valid-anchor choice, cornering, intent, and ground avoidance while still requiring real anchors.
- Render a procedural curve/tube with tension straightening, slack sag, vibration, impact particles, and LOD.
- Add stable corner wrapping with temporary bend points and moving anchors with mass-aware behavior.
- Add dual-anchor slingshot: select two real points, fire two lines, pull back, show tension, and release into a steerable launch.
- Debug toggle: candidates, chosen anchor, length, tension, and velocity.

PLAYER, COLLISION & CONTROLS
- Pointer Lock third-person controls: WASD move, mouse look, Space jump/point-launch timing, Shift swing, Ctrl dive, Z glide, X slingshot, left-click attack, right-click aim, Q dodge, F parry, E tether/interact, R gadget, C scan, V hero switch, M map, P photo mode, Esc pause.
- Add equivalent gamepad controls and remapping.
- Use capsule collision, gravity, slope/ground checks, swept high-speed collision, step-up, ledge recovery, and anti-tunneling.
- Keep movement responsive without discarding momentum. Severe impacts cause recovery, not clipping or instant death.

UNIFIED TRAVERSAL
Use one state machine for idle, sprint, jump, fall, dive, swing, reel, release, glide, wall run/crawl, ceiling crawl, parkour, point launch, slingshot, perch, water skim, tricks, and recovery.

- Wall movement uses actual normals and predictive probes; support vertical/horizontal runs, corners, roof/ceiling transitions, leap-off, and combat entry.
- Momentum-preserving vaults, mantles, rail hops, gap jumps, and obstacle clears.
- Point Launch: target a valid edge, fire short lines, pull toward it, then convert timed jump input into speed.
- Glide with original triangular membranes and model lift, drag, pitch, roll, dive acceleration, pull-up conversion, stalls, altitude loss, and steering. No free flight.
- Add wind tunnels/updrafts around avenues, bridges, rivers, roofs, vents, and towers, shown through particles, debris, cloth, distortion, and audio.
- Support swing → trick → glide → dive → swing → point launch → wall run → slingshot without landing.
- Add flips, rolls, corkscrews, inverted dives, style XP, water skimming, spray, and anchor recovery.

CAMERA & ANIMATION
- Responsive third-person camera with collision avoidance, velocity look-ahead, speed FOV, subtle roll, recentering, wall orientation, combat framing, and no sudden flips.
- Expose sensitivity, inversion, shake, FOV effect, auto-follow, and swing-camera intensity.
- Animate articulated low-poly heroes procedurally with pose blending, springs, hand targeting, wall-contact approximations, body lean, and velocity-driven limbs.
- Swing poses react to rope side/tension, acceleration, arc phase, and velocity. Give WEAVER a powerful style and PULSE an acrobatic style.

TWO HEROES & SWITCHING
- Distinct speed, animations, VFX, audio, abilities, and combat priorities.
- Switch in free roam: raise camera to a fast city overview, stream the other location, move to the hero, and return control in about three seconds without a loading screen.
- Preserve time, weather, progression, crimes, and world state. Allow the inactive hero to appear as an AI partner in selected crimes.

WEAVER: Vector Slam, Tension Sweep, Multi-Bind, Defensive Lattice, Structural Throw, Zero-Slack ultimate.
PULSE: Chain Discharge, Kinetic Burst, Ion Dash, Magnetic Pull, Pulse Dive, Charged Tether, Resonance Cascade ultimate.
Use cooldowns/charges and original VFX.

COMBAT
- Light/heavy chains, launcher, aerial combo, tether strike/pull, disarm, wall bounce, ground slam, environmental throw, dodge/perfect dodge, parry/perfect parry, finisher, healing, knockback, hit stop, and cancel windows.
- Soft targeting by camera, input, distance, threat, and height; optional hard lock.
- Original shape-coded warnings for dodgeable, parryable, ranged, and unblockable attacks. Do not rely on color alone.
- Health, Focus for healing/finishers, and ability charge.
- Gadgets:
  - Adhesive Burst: restrain target.
  - Convergence Node: pull enemies/objects together.
  - Lift Drone: launch targets.
  - Tension Mine: pull target to a surface.
  - Add Echo Decoy and Disruptor Dart if stable.
- Pull/throw bins, barriers, pipes, signs, crates, and weapons with mass-aware physics.

ENEMIES & BOSS
Create THE MERIDIAN faction:
- Basic enforcer, agile pursuer, shield unit, heavy, marksman, drone operator, suppression drone, elite captain.
- Enemies coordinate, flank, guard ranged units, react to aerial attacks, search last-known positions, and use attack tokens for readable combat.
- Add melee/ranged damage, stagger, armor, health bars, knockback, non-lethal defeat, pooling, and drops.
- Boss: THE WARDEN, a municipal-construction exoskeleton. Phase 1 street combat; phase 2 skyscraper exterior chase; phase 3 crane/suspended-platform fight. Require parry, walls, gliding, moving anchors, environmental tethers, and both heroes. Add checkpoints and clear telegraphs.

STEALTH
- Vision, hearing, suspicion, alert, search, combat, communication, and last-known-position states.
- Perch/hide on roofs, beams, walls, ceilings, streetlights, and cover.
- TENSION BRIDGE: choose two real points, fire a taut walkable line, stand/perch on it, and perform single or dual non-lethal takedowns.
- Add perch, wall, ceiling, cover, aerial, environmental, and dual takedowns.
- Enemies investigate noises/missing allies without perfect knowledge.

PEDESTRIANS & LIVING CITY
- About 20–40 articulated pedestrians near the player, 100–300 simplified medium-range agents, and distant instanced silhouettes.
- Vary bodies, clothes, bags, hats, uniforms, colors, and walks.
- Agents use sidewalks/crosswalks, wait at lights, sit, talk, use phones, jog, visit vendors, enter selected doors, use umbrellas, and avoid obstacles.
- They look up, cheer, wave, photograph the hero, request selfies/high-fives, avoid hard landings, thank the hero, or complain.
- During danger they flee, hide, call emergency services, and resume routines afterward. Never walk calmly through combat.

TRAFFIC
- Cars, fictional taxis, vans, buses, trucks, motorcycles, emergency vehicles, boats, and visible rail traffic.
- Lane graphs, signals, turns, crossings, lane changes, braking, avoidance, sirens, and weather behavior.
- Pool and LOD traffic; far vehicles may be kinematic.
- Hero can land/run on vehicles, tether heavy vehicles, chase criminals, disable attackers, and stop a runaway vehicle.

MISSIONS, CRIMES & ACTIVITIES
Incident Director uses district, time, weather, repetition, distance, story, and performance budget.

Dynamic crimes:
- Street assault
- Vehicle pursuit
- Rooftop technology theft
- Structural emergency
- Drone swarm
- Transit incident
- Waterfront rescue

Each needs variations, civilians, optional goals, rewards, and completion.

Missions:
1. BRIDGE UNDER LOAD: tutorial/rescue; swing through traffic, stabilize bridge pieces with visible tethers, fight on moving sections, switch heroes, restore power, chase a carrier drone, save civilians.
2. SILENT FREQUENCY: rooftop/ceiling stealth, Tension Bridges, security puzzle, interior combat, industrial chase.
3. CITY IN RESONANCE: rainy-night blackout, evacuation, unstable wind routes, rooftop battle, vehicle sequence, interior, and WARDEN boss.

Activities:
- Swing/glide trials, drone chases, enemy outposts, tension puzzles, signal triangulation, community requests, photo landmarks, hidden tech caches.

SCAN & WORLD FEEDBACK
- Scan pulse highlights nearby crimes, objectives, enemies, rescue civilians, puzzle objects, and selected anchors.
- Civilian interactions: greeting, high-five, selfie, lost item, short rescue request.
- District trust changes dialogue, enemy frequency, repairs, and civilian confidence.

PROGRESSION & OUTFITS
- XP, City Trust, upgrade points.
- Three compact skill trees: shared traversal, WEAVER, PULSE.
- Meaningful gadget upgrades.
- At least four original outfits per hero with three procedural palettes; cosmetic only.
- Working menus for abilities, gadgets, suits, mission log, districts, and controls.

LIGHTING, WEATHER, VFX & AUDIO
- Morning/day/golden-hour/night cycle with sun/moon, sky gradient, fog, lit windows, street/vehicle lights, and dark nights.
- Clear, rain, and rainy-night states; rain changes road wetness/reflections, particles, wind, crowds, traffic, and audio.
- Procedural materials for glass, concrete, brick, asphalt, metal, water, suits, windows, and wetness.
- Particles for web shots, sparks, electricity, wind, rain, dust, debris, splashes, hits, and speed.
- Procedural Web Audio for wind, tether tension, shots, impacts, traffic, sirens, rain, abilities, UI, and adaptive ambience.
- Avoid excessive bloom, unreadable blur, or prerecorded fake sequences.

UI/HUD
- Crosshair, health/Focus/abilities/gadgets, objective, warnings, mini-map, hero indicator, combo/style, FPS, XYZ, speed, district, weather, and time.
- Full map with districts, missions, crimes, activities, filters, completion, and waypoint.
- CITYLINK panel for incidents/community requests.
- Pause/help overlay.
- Photo Mode: pause, free/orbit camera, FOV, roll, exposure, focus/DOF approximation, filters, pose, time preview, hide HUD.
- Mouse, keyboard, and gamepad navigation; no dead buttons.

PERSISTENCE
- Save seed, hero positions, selected hero, story, activities, trust, skills, gadgets, outfits, settings, controls, and accessibility to localStorage.
- Autosave, Continue, Reset World, Export Save JSON, Import Save JSON. JSON is the fallback if file:// storage is unavailable.

ACCESSIBILITY
- Remapping, hold/toggle controls, Swing Assistance, aim/chase assist, dodge/parry timing, QTE autocomplete, puzzle hints/skip, game-speed options.
- Subtitle size/background/speaker labels and captions.
- High contrast, outlines, color-independent warnings, UI scale, center dot, reduced motion/flashes, camera/FOV controls.
- Separate audio channels, mono option, and machine-readable HTML labels.

PERFORMANCE & STABILITY
- Target 60 FPS at 1080p on a strong desktop and graceful 30+ FPS on lower presets.
- Fixed-step physics, interpolation, spatial hashes, pooling, instancing, chunk/AI LOD, raycast budgets, no hot-loop allocations, and GPU cleanup.
- Do not let fast traversal outrun collision/streaming.
- Debug panel: FPS, frame time, draw calls, chunks, agents, vehicles, enemies, rope tension, memory estimate.
- Catch runtime errors and show them in an on-screen console.

════════ STRETCH — ONLY AFTER CORE IS STABLE ════════
- Fast travel with in-engine transition
- New Game Plus and mission replay
- More interiors, crimes, enemies, bosses, gadgets, suits, and tricks
- Fire/rescue simulation and destructible set pieces
- Reactive procedural radio commentary
- Advanced partner combos and crowds
- Snow/fog storms
- Browser gamepad haptics
- Replay editor/cinematic paths
- Optional local ZIP loader for user-supplied original assets
- WebXR spectator mode

Mark omissions as `// STUB: feature and intended implementation`.

════════ REQUIRED TESTS ════════
Before claiming completion:
- Open HTML directly; title screen starts; no fatal errors.
- Spawn on a textured rooftop overlooking a populated city.
- Attach only to visible real geometry, including one moving anchor.
- Chain five swings with preserved release momentum.
- Verify rope at low/high/variable timing; no NaN, infinite force, or explosive jitter.
- Complete swing → trick → glide → dive → swing → point launch → wall run → slingshot without a stuck state.
- Test wall/ceiling transitions and high-speed collision.
- Switch heroes and use all core abilities.
- Fight every enemy type; dodge, parry, air combo, gadget, finisher, throw.
- Complete stealth using Tension Bridge and dual takedown.
- Verify crowds react/flee and traffic follows signals/avoids incidents.
- Complete at least three crimes, all missions, and boss checkpoints.
- Save/reload/export/import and persist settings.
- Stress-test maximum speed for chunk gaps, runaway spawns, and memory growth.
- Verify every visible button.

════════ DELIVERABLE ════════
Return ONE `.html` file and nothing else required. Prioritize:
1. **Real geometry-attached tether/web shooting, rope physics, collision, and traversal**
2. **Momentum preservation, high-speed stability, moving anchors, and traversal chaining**
3. **Blender MCP-created traversal-ready geometry and efficient collision proxies**
4. Chunk streaming, city generation, and performance
5. Pedestrians and traffic
6. Combat, stealth, enemies, gadgets, hero switching
7. Missions, crimes, progression, persistence
8. Lighting, weather, audio, UI, photo mode, accessibility
9. Stretch content

**IMPLEMENTATION PRINCIPLE:** Build the traversal prototype and physics loop before broadening scope. A smaller city with excellent physical swinging, collision, and momentum is preferable to a huge feature set built on scripted movement.

The result must be a genuine game, not a mock-up, slideshow, prerecorded video, or text prototype. It must let me open the file, enter a living New York-style city, shoot visible webs, swing from real anchors, wall-run, glide, fight, use stealth, switch heroes, complete crimes/missions, and save progress. Comment every major system and clearly mark all stubs.