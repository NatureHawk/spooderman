/* Contact traversal validation (Node, real physics sources). Run: node tests/contact_test.js
   Obstacle reading + vault family, blocked exits, tunnelling, roof-edge climb, corner arcs,
   contextual landings (once-only events, roll safety, narrow support), airborne clearance tuck. */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const HARN = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE = require(path.join(HARN, 'node_modules/three/build/three.cjs'));
const SRC = path.join(__dirname, '..', 'src');
if (!global.TL || !TL.Contact) for (const f of ['00_core.js', '02_collision.js', '04_physics.js', '04b_contact.js', '04c_reference.js']) vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
TL.V.init();
const S = TL.TS;
let pass = 0, fail = 0;
function check(name, cond, info) { (cond ? pass++ : fail++); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  — ' + info : '')); }
function world() { const W = new TL.CollisionWorld(); W.groundFn = () => 0; return W; }
function intent(o) {
  return Object.assign({ move: new THREE.Vector3(), moveLocal: { x: 0, y: 0 }, camFwd: new THREE.Vector3(0, 0, 1), camRight: new THREE.Vector3(-1, 0, 0),
    jump: false, jumpHeld: false, swing: false, swingPressed: false, dive: false, glideToggle: false, sling: false, slingPressed: false, reelIn: 0, reelOut: 0, tether: false, launchTarget: null, sprint: false }, o || {});
}
function hero(W, name) { const h = new TL.HeroController(W, TL.HERO_STATS[name || 'PULSE']); h.wind = new TL.WindField(); h.wind.base.set(0, 0, 0); h.events = []; h.onEvent = (e, a, b) => h.events.push([e, a, b]); return h; }
function box(W, x, y0, z, w, hgt, d, props) { return W.addStatic(x, y0 + hgt / 2, z, w / 2, hgt / 2, d / 2, 0, Object.assign({ kind: 'building', climb: true }, props || {})); }
/* run along +z holding forward; returns trace */
function run(h, it, secs, dt, onStep) {
  dt = dt || 1 / 120; const tr = { states: new Set(), kinds: [], maxPen: 0, minZ: Infinity, path: [] };
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) {
    h.step(dt, it); it.jump = false; it.swingPressed = false;
    tr.states.add(h.state); if (h.action && tr.kinds[tr.kinds.length - 1] !== h.action.plan.kind) tr.kinds.push(h.action.plan.kind);
    tr.path.push(h.pos.clone()); tr.path[tr.path.length - 1].shape = h.shape;
    if (tr._act && !h.action && !tr.after) tr.after = { state: h.state, pos: h.pos.clone(), vel: h.vel.clone() };
    tr._act = !!h.action;
    if (onStep) onStep(h, i);
  }
  return tr;
}
function startRun(h, x, z, speed) { h.teleport(x, TL.C.FEET + 0.01, z); h.vel.set(0, 0, speed); h.grounded = true; h.fsm.set(S.GROUND); for (let i = 0; i < 3; i++) h.step(1 / 120, intent({ move: new THREE.Vector3(0, 0, 1), moveLocal: { x: 0, y: 1 }, sprint: speed > 10 })); }
/* deepest penetration of the body's actual collision shape (standing, folded or tucked) over a trace */
function maxPenetration(W, h, pts) {
  let worst = 0; const cands = [];
  for (const p of pts) {
    const sh = p.shape || TL.BodyShapes.stand;
    W.query(p.x - 2, p.z - 2, p.x + 2, p.z + 2, cands);
    for (const c of cands) for (let k = 0; k < sh.off.length; k++) {
      const L = c.toLocal(p.x, p.y + sh.off[k], p.z, { x: 0, y: 0, z: 0 });
      const dx = L.x - TL.clamp(L.x, -c.hx, c.hx), dy = L.y - TL.clamp(L.y, -c.hy, c.hy), dz = L.z - TL.clamp(L.z, -c.hz, c.hz);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), inside = dx === 0 && dy === 0 && dz === 0;
      worst = Math.max(worst, inside ? 1 : Math.max(0, sh.r[k] - 0.01 - d));
    }
  }
  return worst;
}
const fwd = (o) => intent(Object.assign({ move: new THREE.Vector3(0, 0, 1), moveLocal: { x: 0, y: 1 } }, o || {}));

// ------------------------------------------------------------------ vault family on real colliders
for (const name of ['WEAVER', 'PULSE']) {
  // one-hand vault over a waist-high railing
  { const W = world(); const rail = box(W, 0, 0, 6, 4, 0.92, 0.3); const h = hero(W, name); startRun(h, 0, 0, 6.5);
    let plan = null, handOK = false;
    const tr = run(h, fwd(), 2.0, 1 / 120, (h) => { if (h.action && !plan) { plan = h.action.plan; const p = plan.hands[plan.hand]; handOK = p && Math.abs(p.y - (rail.cy + rail.hy)) < 0.02 && Math.abs(p.z - (rail.cz - rail.hz)) < 0.2; } });
    check(name + ': waist rail -> one-hand vault, hand on the actual top, run continues', tr.kinds[0] === 'vault1' && handOK && h.pos.z > 8 && h.state === S.GROUND && Math.hypot(h.vel.x, h.vel.z) > 5.5,
      `kinds=${tr.kinds} hand=${plan && plan.hand} z=${h.pos.z.toFixed(2)} v=${Math.hypot(h.vel.x, h.vel.z).toFixed(1)} st=${h.state}`);
    check(name + ': vault body never intersects the rail', maxPenetration(W, h, tr.path) < 0.02, 'pen=' + maxPenetration(W, h, tr.path).toFixed(3));
  }
  // same rail with a wall right behind it: vault rejected, hero stops in front
  { const W = world(); box(W, 0, 0, 6, 4, 0.92, 0.3); box(W, 0, 0, 6.75, 6, 3.5, 0.4, { climb: false }); const h = hero(W, name); startRun(h, 0, 0, 6.5);
    const tr = run(h, fwd(), 2.0);
    check(name + ': blocked exit rejects the vault (stops before the rail)', !tr.states.has(S.VAULT) && h.pos.z < 6 - 0.15 + 0.02, `states=${[...tr.states]} z=${h.pos.z.toFixed(2)}`);
  }
  // low pipe: a step-over, speed kept
  { const W = world(); box(W, 0, 0, 5, 4, 0.36, 0.3); const h = hero(W, name); startRun(h, 0, 0, 6);
    const tr = run(h, fwd(), 1.6);
    check(name + ': low pipe -> step-over keeps travel', tr.kinds[0] === 'stepover' && h.pos.z > 7 && Math.hypot(h.vel.x, h.vel.z) > 5, `kinds=${tr.kinds} z=${h.pos.z.toFixed(2)} v=${Math.hypot(h.vel.x, h.vel.z).toFixed(1)}`);
  }
  // sprinting: speed vault
  { const W = world(); box(W, 0, 0, 8, 4, 0.95, 0.35); const h = hero(W, name); startRun(h, 0, 0, 11);
    const tr = run(h, fwd({ sprint: true }), 1.4);
    check(name + ': sprint -> lateral speed vault preserves speed', tr.kinds[0] === 'speed' && Math.hypot(h.vel.x, h.vel.z) > 9, `kinds=${tr.kinds} v=${Math.hypot(h.vel.x, h.vel.z).toFixed(1)}`);
  }
  // chest-high deep block: two-hand compact vault
  { const W = world(); box(W, 0, 0, 6, 4, 1.25, 1.1); const h = hero(W, name); startRun(h, 0, 0, 5);
    const tr = run(h, fwd(), 2.2);
    const plan = null;
    check(name + ': chest-high block -> two-hand vault, lands beyond', tr.kinds[0] === 'vault2' && h.pos.z > 7.2 && h.state === S.GROUND, `kinds=${tr.kinds} z=${h.pos.z.toFixed(2)} st=${h.state}`);
    check(name + ': two-hand vault body clear of the block', maxPenetration(W, h, tr.path) < 0.02, 'pen=' + maxPenetration(W, h, tr.path).toFixed(3));
  }
  // rooftop HVAC unit (1.5 m, deep): mantle onto it
  { const W = world(); box(W, 0, 0, 6, 3.4, 1.5, 3.8, { src: 'rooftop' }); const h = hero(W, name); startRun(h, 0, 0, 4);
    const tr = run(h, fwd(), 2.5);
    const A = tr.after || { pos: h.pos, state: h.state };
    check(name + ': deep 1.5 m unit -> mantle onto its top', tr.kinds[0] === 'mantle' && Math.abs(A.pos.y - TL.C.FEET - 1.5) < 0.05 && A.state === S.GROUND, `kinds=${tr.kinds} y=${A.pos.y.toFixed(2)} st=${A.state}`);
    check(name + ': mantle body clear of the unit', maxPenetration(W, h, tr.path) < 0.02, 'pen=' + maxPenetration(W, h, tr.path).toFixed(3));
  }
}
// parapet at a roof edge: walking stops at it, a deliberate run carries over into the air
{ const mk = () => { const W = world(); W.groundFn = () => 0; box(W, 0, 0, -10, 20, 30, 40); box(W, 0, 30, 9.81, 20, 0.5, 0.38); return W; };
  const W1 = mk(), h1 = hero(W1); h1.teleport(0, 30 + TL.C.FEET + 0.01, 4); h1.vel.set(0, 0, 3); h1.grounded = true; h1.fsm.set(S.GROUND);
  const t1 = run(h1, fwd(), 3);
  check('walking into a roof-edge parapet stops on the roof (no step onto it, no vault off the building)', !t1.states.has(S.VAULT) && h1.pos.y > 30 && h1.pos.z < 9.7, `states=${[...t1.states]} y=${h1.pos.y.toFixed(1)} z=${h1.pos.z.toFixed(2)}`);
  const W2 = mk(), h2 = hero(W2); h2.teleport(0, 30 + TL.C.FEET + 0.01, 2); h2.vel.set(0, 0, 9); h2.grounded = true; h2.fsm.set(S.GROUND);
  const t2 = run(h2, fwd({ sprint: true }), 1.2);
  check('a running vault carries over the parapet into the air', t2.states.has(S.VAULT) && h2.state === S.AIR && h2.pos.z > 10.2, `kinds=${t2.kinds} st=${h2.state} z=${h2.pos.z.toFixed(2)}`);
}
// tall wall at speed: no vault classification, no tunnelling, at 30/60/120 Hz
for (const hz of [30, 60, 120]) {
  const W = world(); box(W, 0, 0, 6, 6, 3.2, 0.2, { climb: false }); const h = hero(W); startRun(h, 0, 0, 16);
  const tr = run(h, fwd({ sprint: true }), 1.5, 1 / hz);
  check('16 m/s into a thin 3.2 m wall at ' + hz + ' Hz: no vault, no tunnelling', !tr.states.has(S.VAULT) && tr.path.every((p) => p.z < 5.9), `maxz=${Math.max(...tr.path.map((p) => p.z)).toFixed(2)}`);
}
// variable frame time: the vault completes identically enough
{ const W = world(); box(W, 0, 0, 6, 4, 0.92, 0.3); const h = hero(W); startRun(h, 0, 0, 6.5);
  const it = fwd(); const tr = { states: new Set(), path: [] }; let i = 0;
  while (i++ < 400) { const dt = [1 / 30, 1 / 144, 1 / 60, 1 / 90][i % 4]; h.step(dt, it); tr.states.add(h.state); const q = h.pos.clone(); q.shape = h.shape; tr.path.push(q); }
  check('variable frame-time steps: vault completes and stays clear', tr.states.has(S.VAULT) && h.pos.z > 8 && maxPenetration(W, h, tr.path) < 0.02, `z=${h.pos.z.toFixed(2)}`);
}
// jump buffered during the committed vault fires at the exit; a web can cancel after the release
{ const W = world(); box(W, 0, 0, 6, 4, 0.92, 0.3); const h = hero(W); startRun(h, 0, 0, 6.5);
  const it = fwd(); let jumped = false;
  run(h, it, 1.6, 1 / 120, (h, i) => { if (h.action && h.action.u > 0.3 && h.action.u < 0.5 && !h.action.jump) { it.jump = true; } if (h.state === S.AIR && h.fsm.log[h.fsm.log.length - 1].reason === 'vault-jump') jumped = true; });
  check('jump pressed mid-vault is buffered and fires on the exit', jumped, '');
}

// ------------------------------------------------------------------ roof-edge climb and corner transfer
{ const W = world(); const b = box(W, 0, 0, 10, 20, 20, 12); box(W, 0, 20, 4.19, 20, 0.5, 0.38);   // building with a parapet on its near edge
  const h = hero(W); h.teleport(0, 16, 3.62); h.vel.set(0, 2, 0); h.wallN.set(0, 0, -1); h.wallCol = b; h.fsm.set(S.CRAWL);
  const tr = run(h, intent({ move: new THREE.Vector3(0, 0, 1), moveLocal: { x: 0, y: 1 } }), 4.0);
  const A = tr.after || { pos: h.pos, state: h.state };
  check('crawl to the roof edge -> climb over the parapet lip onto the roof', tr.kinds.includes('climb') && A.pos.y > 20.8 && A.pos.z > 4.4 && (A.state === S.GROUND || A.state === S.PERCH), `kinds=${tr.kinds} st=${A.state} y=${A.pos.y.toFixed(2)} z=${A.pos.z.toFixed(2)}`);
  check('climb-over body clear of building and parapet', maxPenetration(W, h, tr.path) < 0.02, 'pen=' + maxPenetration(W, h, tr.path).toFixed(3));
}
{ const W = world(); const b = box(W, 0, 0, 0, 8, 40, 8);
  const h = hero(W); h.teleport(-2, 20, -4 - TL.C.CAP_R - 0.02); h.vel.set(6, 0, 0); h.wallN.set(0, 0, -1); h.wallCol = b; h.wallMode = 'side'; h.fsm.set(S.WALL);
  const it = intent({ move: new THREE.Vector3(1, 0, 0), moveLocal: { x: 0, y: 1 }, camFwd: new THREE.Vector3(0, 0, 1) });
  let maxTurn = 0, prevN = h.wallN.clone(), minEdge = Infinity, maxEdge = 0, cornerSeen = false;
  run(h, it, 1.6, 1 / 120, (h) => {
    maxTurn = Math.max(maxTurn, prevN.angleTo(h.wallN)); prevN.copy(h.wallN);
    if (h.corner) { cornerSeen = true; const d = Math.hypot(h.pos.x - 4, h.pos.z + 4); minEdge = Math.min(minEdge, d); maxEdge = Math.max(maxEdge, d); }
  });
  check('outer corner: smooth arc around the edge (no 90 degree snap), contact kept', cornerSeen && maxTurn < 0.36 && minEdge > TL.C.CAP_R - 0.02 && maxEdge < TL.C.CAP_R + 0.12 && Math.abs(h.wallN.x - 1) < 0.05,
    `seen=${cornerSeen} maxTurnPerStep=${maxTurn.toFixed(3)} edge=${minEdge.toFixed(2)}..${maxEdge.toFixed(2)} n=${h.wallN.x.toFixed(2)},${h.wallN.z.toFixed(2)} st=${h.state}`);
}
// Constant-speed turns cover up to .36 rad per 120Hz frame at this accelerated test speed.
// normal building wall run still works (sprint into a wall -> wall run up)
{ const W = world(); box(W, 0, 0, 12, 30, 40, 4); const h = hero(W); startRun(h, 0, 0, 12);
  const tr = run(h, fwd({ sprint: true }), 2.0);
  check('sprinting into a tall building still starts a wall run', tr.states.has(S.WALL), `states=${[...tr.states]}`);
}

// ------------------------------------------------------------------ contextual landings
/* drop until the first landing, then a little longer; returns the trace and the landing record */
function drop(W, h, x, y, z, v, it, after) {
  h.teleport(x, y, z); h.vel.copy(v); h.events.length = 0; h.landing = null;
  const tr = { path: [], states: new Set() }; let k = 0, landedAt = -1;
  while (k++ < 2400) {
    h.step(1 / 120, it || intent()); tr.path.push(h.pos.clone()); tr.states.add(h.state);
    if (h.landing && landedAt < 0) landedAt = k;
    if (landedAt >= 0 && k - landedAt > (after || 0.05) * 120) break;
  }
  tr.landing = h.landing; return tr;
}
const nLand = (h) => h.events.filter((e) => e[0] === 'land' || e[0] === 'hardland').length;
{ const W = world(); const h = hero(W);
  let tr = drop(W, h, 0, 3.2, 0, new THREE.Vector3(0, 0, 0), intent(), 2.0);
  check('small drop, no input -> gentle/crouch landing, exactly one event over 2 s standing', nLand(h) === 1 && ['gentle', 'crouch'].includes(tr.landing.kind), `n=${nLand(h)} kind=${tr.landing && tr.landing.kind} impact=${tr.landing.impact.toFixed(1)}`);
  tr = drop(W, h, 0, 3.2, 0, new THREE.Vector3(0, 0, 7), fwd(), 0.4);
  check('moving landing -> run landing, keeps running', tr.landing.kind === 'run' && h.state === S.GROUND && Math.hypot(h.vel.x, h.vel.z) > 5, `kind=${tr.landing.kind} v=${Math.hypot(h.vel.x, h.vel.z).toFixed(1)}`);
  tr = drop(W, h, 0, 9, 0, new THREE.Vector3(0, 0, 0), intent(), 0.1);
  check('medium drop, no input -> crouch', tr.landing.kind === 'crouch', `kind=${tr.landing.kind} impact=${tr.landing.impact.toFixed(1)}`);
  tr = drop(W, h, 0, 90, 0, new THREE.Vector3(0, 0, 0), intent(), 1.0);
  check('high drop, no momentum -> heavy landing, one hardland event, recovers', nLand(h) === 1 && tr.landing.kind === 'heavy' && h.state === S.GROUND, `kind=${tr.landing.kind} impact=${tr.landing.impact.toFixed(1)} st=${h.state}`);
  tr = drop(W, h, 0, 14, 0, new THREE.Vector3(0, 0, 13), fwd(), 0.8);
  check('fast forward landing with open space -> roll, emerges moving along travel', tr.landing.kind === 'roll' && tr.states.has(S.RECOVER) && h.vel.z > 4 && Math.abs(h.vel.x) < 0.5, `kind=${tr.landing.kind} impact=${tr.landing.impact.toFixed(1)} hs=${tr.landing.hs.toFixed(1)} v=${h.vel.z.toFixed(1)}`);
}
{ // a roll never carries the body through a wall or off an edge
  const W = world(); const wall = box(W, 0, 0, 0, 10, 4, 1, { climb: false }); const h = hero(W);
  // position the wall about 2.5 m beyond the landing point
  const probeH = hero(world()); const t0 = drop(probeH.world, probeH, 0, 14, -20, new THREE.Vector3(0, 0, 13), intent(), 0); const landZ = t0.path[t0.path.length - 1].z;
  wall.cz = landZ + 3.0; W.removeStatic(wall); const w2 = box(W, 0, 0, landZ + 3.0, 10, 4, 1, { climb: false });
  const tr = drop(W, h, 0, 14, -20, new THREE.Vector3(0, 0, 13), fwd(), 1.0);
  const face = landZ + 3.0 - 0.5;
  check('wall 2.5 m past the landing -> no roll, never through the wall', tr.landing.kind !== 'roll' && tr.path.every((p) => p.z < face - TL.C.CAP_R + 0.05), `kind=${tr.landing.kind} maxz=${Math.max(...tr.path.map((p) => p.z)).toFixed(2)} face=${face.toFixed(2)}`);
  // roof that ends 2.2 m past the landing (60 m drop beyond): no roll off it
  const W2 = world(); W2.groundFn = () => -60; box(W2, 0, -60, landZ + 2.2 - 50, 30, 60, 100);
  const h2 = hero(W2); const tr2 = drop(W2, h2, 0, 14, -20, new THREE.Vector3(0, 0, 13), intent(), 1.0);
  check('roof edge just ahead -> no roll off it', tr2.landing && tr2.landing.kind !== 'roll' && tr2.states.has(S.GROUND), `kind=${tr2.landing && tr2.landing.kind} z=${h2.pos.z.toFixed(2)} edge=${(landZ + 2.2).toFixed(2)}`);
  // roll started with room, edge appears inside the roll distance: the roll brakes before it
  const W3 = world(); W3.groundFn = () => -60; box(W3, 0, -60, landZ + 4.1 - 50, 30, 60, 100);
  const h3 = hero(W3); const tr3 = drop(W3, h3, 0, 14, -20, new THREE.Vector3(0, 0, 13), intent(), 1.2);
  check('edge at the end of the roll -> braked on the roof', tr3.path.every((p) => p.y > -50) && h3.pos.z < landZ + 4.1, `kind=${tr3.landing && tr3.landing.kind} z=${h3.pos.z.toFixed(2)} edge=${(landZ + 4.1).toFixed(2)}`);
}
{ // narrow support: landing on a parapet top settles into a perch along it
  const W = world(); box(W, 0, 0, -10, 20, 20, 20); const par = box(W, 0, 20, 0.19, 20, 0.5, 0.38);
  const h = hero(W); h.teleport(0.5, 23, 0.19); h.vel.set(0, -1, 0.0);
  run(h, intent(), 1.5);
  check('narrow parapet top -> narrow-support perch on it', h.landing && h.landing.kind === 'narrow' && h.state === S.PERCH && Math.abs(h.perchPoint.z - 0.19) < 0.03, `kind=${h.landing && h.landing.kind} st=${h.state} pz=${h.perchPoint.z.toFixed(2)}`);
}

// ------------------------------------------------------------------ airborne clearance tuck
{ // 1.45 m slot between a lower and an upper block: the tucked body (1.19 m) fits, the standing one (1.75 m) does not
  const W = world(); box(W, 0, 0, 10, 10, 9.0, 2, { climb: false }); box(W, 0, 10.45, 10, 10, 6, 2, { climb: false });
  const h = hero(W); h.teleport(0, 9.75, 6); h.vel.set(0, 1, 22);
  let tucked = false; const tr = run(h, intent(), 0.6, 1 / 120, (h) => { if (h.tuck) tucked = true; });
  check('narrow opening the tucked body fits: tuck, pass through, untuck after', tucked && h.pos.z > 11.5 && h.shape === TL.BodyShapes.stand, `tucked=${tucked} z=${h.pos.z.toFixed(2)} shape=${h.shape.name}`);
  check('tucked pass never intersects the blocks', maxPenetration(W, h, tr.path) < 0.02, 'pen=' + maxPenetration(W, h, tr.path).toFixed(3));
  const W2 = world(); box(W2, 0, 0, 10, 10, 9.0, 2, { climb: false }); box(W2, 0, 10.12, 10, 10, 6, 2, { climb: false });
  const h2 = hero(W2); h2.teleport(0, 9.6, 6); h2.vel.set(0, 1, 22);
  let t2 = false; run(h2, intent(), 0.6, 1 / 120, (h) => { if (h.tuck) t2 = true; });
  check('opening smaller than the tucked body: no tuck, no pass-through', !t2 && h2.pos.z < 9.2, `tucked=${t2} z=${h2.pos.z.toFixed(2)}`);
}
// ------------------------------------------------------------------ regressions found in the city runs
{ // jumping into a thin lamp pole: grip it, never catapult up (stacked wall-run boosts on probe flicker)
  const W = world(); W.addStatic(0, 4.5, 3, 0.13, 4.6, 0.13, 0, { kind: 'pole', climb: true, anchor: true });
  const h = hero(W); h.teleport(0, TL.C.FEET + 0.01, 0); h.vel.set(0, 0, 6); h.grounded = true; h.fsm.set(S.GROUND);
  let maxY = 0, gripped = false; const it = fwd(); it.jump = true;
  run(h, it, 0.5, 1 / 120, (h) => { maxY = Math.max(maxY, h.pos.y); });
  run(h, intent(), 2.5, 1 / 120, (h) => { maxY = Math.max(maxY, h.pos.y); if (h.state === S.CRAWL && TL.isClimbPole(h.wallCol)) gripped = true; });
  check('jumping into a lamp pole grips it and never catapults the hero', gripped && maxY < 9.5, `gripped=${gripped} maxY=${maxY.toFixed(1)} st=${h.state}`);
}
{ // launching upward off a ledge the feet still touch is not a landing (no landing record / effects)
  const W = world(); box(W, 0, 0, 0, 6, 10, 6); const h = hero(W);
  h.teleport(0, 10 + TL.C.FEET + 0.01, 0); h.fsm.set(S.AIR); h.vel.set(0, 12.5, 20); const id0 = h.landing ? h.landing.id : 0;
  run(h, intent(), 0.1);
  check('upward launch from a ledge creates no landing', (h.landing ? h.landing.id : 0) === id0 && h.state === S.AIR, `state=${h.state}`);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exitCode = 1;
