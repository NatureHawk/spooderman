/* Traversal route logic (Node). Run: node tests/routes_test.js
   Swept checkpoints (no tunnelling at any speed), order / direction rules, missed-gate recovery,
   perch finish, restart clears state, timer only advances while updated, PB persistence, bounded
   diminishing bonuses, near-miss rules, and the three shipped routes' data sanity. */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
const HARN = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE = require(path.join(HARN, 'node_modules/three/build/three.cjs'));
for (const f of ['00_core.js', '02_collision.js', '04_physics.js', '04b_contact.js', '12b_routes.js', '15_save.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), { filename: f });
TL.V.init();
const S = TL.TS;
let passed = 0, failed = 0;
const test = (n, f) => { try { f(); passed++; console.log('PASS ' + n); } catch (e) { failed++; console.log('FAIL ' + n + '  — ' + e.message); } };

/* minimal game around the real RouteChallenges + HeroController */
function game(defs) {
  const world = new TL.CollisionWorld(); world.groundFn = () => 0;
  const ctrl = new TL.HeroController(world, TL.HERO_STATS.PULSE); ctrl.wind = new TL.WindField(); ctrl.wind.base.set(0, 0, 0);
  const scene = { add() {}, remove() {} }, hints = [], prompts = [], pressed = new Set(), sfx = [];
  const g = {
    scanMode: true, scene, world, state: 'play',
    hero: { ctrl, anim: { trick: null, rel: null, landRec: null } },
    rig: { yaw: 0, pitch: 0, smoothT: new THREE.Vector3() },
    ui: { hint: (t) => hints.push(t), prompt: (t) => prompts.push(t), setWaypoint() {}, openModal: (t, b) => { g.modal = t; }, el() { return {}; }, btn() { return {}; }, closeModal() {} },
    input: { consume: (a) => pressed.delete(a), press: (a) => pressed.add(a) },
    audio: { sfx: (n) => sfx.push(n) }, progress: { addXP() {}, serialize: () => null }, save: { save() { g.saved = (g.saved || 0) + 1; } },
    missions: { active: null, crime: null, activeActivity: null, serialize: () => null }, pause() {},
    combat: { serialize: () => null }, env: { hour: 12, weather: 'clear' },
  };
  const saved = TL.ROUTE_DEFS.slice(); TL.ROUTE_DEFS.length = 0; TL.ROUTE_DEFS.push(...defs);
  g.routes = new TL.RouteChallenges(g);
  TL.ROUTE_DEFS.length = 0; TL.ROUTE_DEFS.push(...saved);
  return { g, ctrl, hints, prompts, sfx };
}
const DEF = {
  id: 't', name: 'Test', blurb: '', start: { x: 0, y: 0, z: 0, yaw: 0 }, medals: { gold: 5, silver: 8, bronze: 12 },
  cps: [{ kind: 'gate', x: 0, y: 5, z: 20, r: 3, n: [0, 1] }, { kind: 'zone', x: 0, y: 5, z: 40, r: 2 }, { kind: 'perch', x: 0, y: 1, z: 60, r: 2, surface: 0 }],
};
function running(G) { const { g, ctrl } = G; g.routes.begin(g.routes.defs[0]); for (let i = 0; i < 200; i++) g.routes.update(1 / 60); assert.equal(g.routes.active.phase, 'run'); assert(!ctrl.frozen); return g.routes.active; }
/* move the hero along a polyline in fixed frames (no physics), calling the route update each frame */
function travel(G, pts, frameDist) {
  const { g, ctrl } = G;
  ctrl.pos.copy(pts[0]); if (g.routes.active) g.routes.active.prev.copy(pts[0]);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = a.distanceTo(b), n = Math.max(1, Math.ceil(L / frameDist));
    for (let i = 1; i <= n; i++) { ctrl.pos.lerpVectors(a, b, i / n); g.routes.update(1 / 60); if (!g.routes.active || g.routes.active.phase === 'done') return; }
  }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('countdown holds the hero frozen, GO releases it', () => {
  const G = game([DEF]); G.g.routes.begin(G.g.routes.defs[0]);
  assert(G.ctrl.frozen); for (let i = 0; i < 120; i++) G.g.routes.update(1 / 60); assert(G.ctrl.frozen && G.g.routes.active.time === 0);
  for (let i = 0; i < 80; i++) G.g.routes.update(1 / 60); assert(!G.ctrl.frozen && G.g.routes.active.phase === 'run');
});
for (const speed of [8, 60, 140]) test(`fast movement cannot skip a gate (${speed} m/s per frame-step of ${(speed / 60).toFixed(2)} m)`, () => {
  const G = game([DEF]), A = running(G);
  travel(G, [V(0, 5, 0), V(0, 5, 30)], speed / 60);
  assert.equal(A.k, 1, 'gate counted exactly once');
});
test('one huge frame step straight through the gate still counts (swept segment)', () => {
  const G = game([DEF]), A = running(G); G.ctrl.pos.set(0, 5, 0); G.g.routes.update(1 / 60); A.prev.set(0, 5, 0);
  G.ctrl.pos.set(0, 5, 35); G.g.routes.update(1 / 60); assert.equal(A.k, 1);
});
test('backward crossing is rejected', () => {
  const G = game([DEF]), A = running(G);
  travel(G, [V(0, 5, 30), V(0, 5, 0)], 0.5); assert.equal(A.k, 0);
});
test('crossing beside the ring is a miss with a readable recovery hint, then passing through counts', () => {
  const G = game([DEF]), A = running(G);
  travel(G, [V(7, 5, 0), V(7, 5, 30)], 0.5); assert.equal(A.k, 0);
  assert(G.hints.some((h) => /Missed checkpoint 1/.test(h)));
  travel(G, [V(7, 5, 30), V(0, 5, 10), V(0, 5, 25)], 0.5); assert.equal(A.k, 1);
});
test('a later checkpoint never counts before the current one', () => {
  const G = game([DEF]), A = running(G);
  travel(G, [V(0, 5, 35), V(0, 5, 45)], 0.5); assert.equal(A.k, 0);
  assert(G.hints.some((h) => /Checkpoint 1 first/.test(h)));
});
test('perch finish needs a real perch, not a fly-through', () => {
  const G = game([DEF]), A = running(G);
  travel(G, [V(0, 5, 0), V(0, 5, 30), V(0, 5, 41), V(0, 1, 60), V(0, 1, 70)], 0.5);
  assert.equal(A.k, 2, 'flying through the perch zone does not finish');
  G.ctrl.pos.set(0, 1, 60); G.ctrl.fsm.set(S.PERCH); G.g.routes.update(1 / 60);
  assert.equal(A.phase, 'done'); assert(G.g.routes.lastResult);
});
test('restart clears timer, checkpoints, bonuses, markers, freeze and overlays', () => {
  const G = game([DEF]), A = running(G);
  travel(G, [V(0, 5, 0), V(0, 5, 30)], 0.5); A.score.add('launch', 200, 'x'); A.score.pendingTrick = 'flip';
  G.g.routes.restart(); const B = G.g.routes.active;
  assert(B !== A && B.k === 0 && B.time === 0 && B.splits.length === 0 && B.score.bonus === 0 && !B.score.pendingTrick && B.phase === 'countdown');
  assert.equal(G.g.routes.marks.length, DEF.cps.length, 'old markers removed, one fresh set');
  assert(G.ctrl.frozen, 'countdown freeze');
  G.g.routes.exit(); assert(!G.g.routes.active && !G.ctrl.frozen && G.g.routes.marks.length === 0);
});
test('timer advances only by the frames it is updated (pause = not updated: no time passes)', () => {
  const G = game([DEF]), A = running(G);
  const t0 = A.time;
  for (let i = 0; i < 60; i++) G.g.routes.update(1 / 60);
  const t = A.time; /* the game loop stops calling update while paused; resuming continues from t */
  for (let i = 0; i < 30; i++) G.g.routes.update(1 / 60);
  assert(Math.abs(t - t0 - 1) < 1e-6 && Math.abs(A.time - t0 - 1.5) < 1e-6);
});
test('medals by time, score dominated by time, PB kept and saved', () => {
  const G = game([DEF]), r = G.g.routes, A = running(G);
  A.time = 4.5; A.k = 3; r.finish();
  const R = r.lastResult; assert.equal(R.medal, 'gold'); assert(R.timeScore > R.bonus);
  assert(G.g.saved >= 1, 'saved through the save system');
  const A2 = (r.begin(r.defs[0]), r.active); A2.phase = 'run'; A2.time = 9; r.finish();
  assert.equal(r.best.t.time, 4.5, 'slower run does not replace the PB'); assert.equal(r.best.t.medal, 'gold');
  const copy = new TL.RouteChallenges(Object.assign({}, G.g, { scanMode: true })); copy.deserialize(JSON.parse(JSON.stringify(r.serialize())));
  assert.deepEqual(copy.best, r.best);
});
test('save snapshot / apply round-trips route bests', () => {
  const G = game([DEF]); G.g.routes.best = { t: { time: 3.2, score: 9000, medal: 'gold' } };
  const SM = Object.create(TL.SaveManager.prototype); SM.game = Object.assign(G.g, { seed: 'MAN', heroName: 'WEAVER', heroes: { WEAVER: { ctrl: G.ctrl, outfit: 0, palette: 0 }, PULSE: { ctrl: G.ctrl, outfit: 0, palette: 0 } }, settings: {} });
  const snap = JSON.parse(JSON.stringify(SM.snapshot()));
  const G2 = game([DEF]); const SM2 = Object.create(TL.SaveManager.prototype);
  SM2.game = Object.assign(G2.g, { heroes: { WEAVER: { ctrl: G2.ctrl, setOutfit() {} }, PULSE: { ctrl: G2.ctrl, setOutfit() {} } }, heroName: 'WEAVER', setActiveHero() {} });
  SM2.apply(snap); assert.deepEqual(G2.g.routes.best, G.g.routes.best);
});
test('bonuses: capped per kind, repeats diminish, trick only after a controlled recovery', () => {
  const sc = new TL.RouteScore(); const got = [];
  for (let i = 0; i < 8; i++) got.push(sc.add('launch', 200, 'l'));
  assert(got[1] < got[0] && got[2] < got[1], 'diminishing'); assert(sc.cat.launch <= sc.CAP.launch);
  const G = game([DEF]), A = running(G), r = G.g.routes;
  A.score.pendingTrick = 'flip'; r.onHeroEvent(G.g.hero, 'hardland', 40, { kind: 'heavy' }); assert.equal(A.score.cat.trick, 0, 'no credit for a heavy / uncontrolled landing');
  A.score.pendingTrick = 'flip'; r.onHeroEvent(G.g.hero, 'attach', {}); assert(A.score.cat.trick > 0, 'credited on a web catch recovery');
  const once = A.score.cat.trick; A.score.pendingTrick = 'flip'; r.onHeroEvent(G.g.hero, 'land', 5, { kind: 'run' });
  assert(A.score.cat.trick - once < once, 'the same trick again earns less');
});
test('near misses: need speed and clearance, never contact, once per object (no farming)', () => {
  const G = game([DEF]), A = running(G), { g, ctrl } = G;
  const pillar = g.world.addStatic(1.6, 5, 0, 0.5, 5, 0.5, 0, { kind: 'building' });
  ctrl.fsm.set(S.AIR); ctrl.vel.set(0, 0, 25);
  const pass = () => { for (let z = -8; z <= 8; z += 0.4) { ctrl.pos.set(0, 5, z); ctrl.nContacts = 0; A.score.nearCool = 0; g.routes.scoreFrame(1 / 60, ctrl); } };
  pass(); assert.equal(A.score.count.near, 1, 'one genuine near miss');
  for (let k = 0; k < 5; k++) pass(); assert.equal(A.score.count.near, 1, 'same object cannot be farmed');
  // slow pass past a new object: no credit
  const p2 = g.world.addStatic(-1.6, 5, 30, 0.5, 5, 0.5, 0, { kind: 'building' }); ctrl.vel.set(0, 0, 6);
  for (let z = 22; z <= 38; z += 0.4) { ctrl.pos.set(0, 5, z); g.routes.scoreFrame(1 / 60, ctrl); } assert.equal(A.score.count.near, 1);
  // touching an object disqualifies it
  const p3 = g.world.addStatic(1.6, 5, 60, 0.5, 5, 0.5, 0, { kind: 'building' }); ctrl.vel.set(0, 0, 25);
  ctrl.contacts[0].col = p3; for (let z = 52; z <= 68; z += 0.4) { ctrl.pos.set(0, 5, z); ctrl.nContacts = z < 58 ? 1 : 0; g.routes.scoreFrame(1 / 60, ctrl); }
  assert.equal(A.score.count.near, 1, 'contact = no near-miss credit');
});
test('shipped routes: three, ordered checkpoints, sane radii, medal order, gate normals unit length', () => {
  assert.equal(TL.ROUTE_DEFS.length, 3);
  for (const d of TL.ROUTE_DEFS) {
    assert(d.cps.length >= 4 && d.medals.gold < d.medals.silver && d.medals.silver < d.medals.bronze);
    for (const c of d.cps) { assert(c.r >= 2 && c.r <= 8); if (c.kind === 'gate') assert(Math.abs(Math.hypot(c.n[0], c.n[1]) - 1) < 0.01); }
  }
  const kinds = TL.ROUTE_DEFS.map((d) => d.cps[d.cps.length - 1].kind);
  assert(kinds.includes('perch'), 'one route finishes on a perch');
});
test('free roam untouched without an active route (no markers, no freeze, no HUD time)', () => {
  const G = game([DEF]); for (let i = 0; i < 100; i++) G.g.routes.update(1 / 60);
  assert(!G.g.routes.active && !G.ctrl.frozen && G.g.routes.marks.length === 0);
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
