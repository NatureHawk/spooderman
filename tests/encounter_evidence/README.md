# Route and encounter evidence

`node tests/routes_test.js` passes 24 checks covering ordered gates, alternate approaches, split comparison, faster/slower PB replacement, legacy and malformed save data, bounded replay sampling, ghost and new-game disposal, and movement-dependent mastery bonuses.

`node tests/encounters_test.js` passes 10 checks loading the real collision, hero, traffic, crowd, and encounter implementations. Only the rendering adapter uses placeholder meshes. Completion uses each encounter's update and E interaction path; the vehicle test advances real TrafficManager.drive braking. It covers cardinal/rotated roofs, failure/cancel/retry, conflicting objectives, blocked/unloaded surfaces, bounded persistence, one reward per success, repeated cleanup, and ambient incidents yielding only after a replacement encounter validates successfully.

`node tests/encounters_browser.js` boots the built main HTML in Chrome with the actual Lower Manhattan colliders, actors, materials, UI, and traffic. It records the three encounter completions, validates alternate gate approaches against the scan, records/restores/restarts a PB replay, and saves screenshots. Hero approaches in this integration test are scripted position samples; this is objective/interaction and render validation, not proof of manual traversal proficiency or physics performance. The traffic stopping path uses its actual drive/brake integration.

Images: rooftop.png, rescue.png, runaway.png, alternate_gates.png, pb_ghost.png. Results are saved in results.json after a complete browser pass.

`node tests/ghost_browser.js` is a focused PB record/restore/restart visual pass. It checks a collision-clear camera position and waits for the countdown overlay to end before photographing the six-part translucent guide; its metadata is in pb_ghost_result.json.
