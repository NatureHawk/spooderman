/* Contact animation validation on the real hero skeletons (Node). Run: node tests/contact_anim_test.js
   Planted hands on the real support, no limb inside the obstacle, 30/60/120 Hz + variable frame time,
   web catch hand / slack / replay / root continuity / pendulum timing, J arm state, pole grip. */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
const HARN = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE = require(path.join(HARN, 'node_modules/three/build/three.cjs'));
for (const f of ['00_core.js', '01_assets.js', '02_collision.js', '04_physics.js', '04b_contact.js', '04c_reference.js', '06b_motion.js', '06_anim.js', '06d_contact_anim.js', '06e_reference_anim.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), { filename: f });
TL.V.init();
const build = path.join(__dirname, '../build');
const buffer = (f) => { const b = fs.readFileSync(path.join(build, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
TL.Assets.man = JSON.parse(fs.readFileSync(path.join(build, 'assets.json'))); TL.Assets.bin = buffer('assets.bin');
Object.assign(TL.Assets.man.assets, JSON.parse(fs.readFileSync(path.join(build, 'heroes.json'))).assets);
TL.Assets.hbin = buffer('heroes.bin'); TL.Assets.packs = { 1: TL.Assets.hbin };
const S = TL.TS;
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '  — ' + e.message); } };
const world = () => { const W = new TL.CollisionWorld(); W.groundFn = () => 0; return W; };
const box = (W, x, y0, z, w, h, d, p) => W.addStatic(x, y0 + h / 2, z, w / 2, h / 2, d / 2, 0, Object.assign({ kind: 'building', climb: true }, p || {}));
const intent = (o) => Object.assign({ move: new THREE.Vector3(), moveLocal: { x: 0, y: 0 }, camFwd: new THREE.Vector3(0, 0, 1), camRight: new THREE.Vector3(-1, 0, 0), jump: false, swing: false, swingPressed: false, sprint: false }, o || {});
const fwd = (o) => intent(Object.assign({ move: new THREE.Vector3(0, 0, 1), moveLocal: { x: 0, y: 1 } }, o || {}));
const cam = { fwd: new THREE.Vector3(0, 0, 1) };
function make(name, W) {
  const scene = new THREE.Scene(), mat = TL.Assets.material(), sk = TL.Assets.skinned(name, 'hi', mat); scene.add(sk.mesh);
  const hero = new TL.HeroController(W, TL.HERO_STATS[name]); hero.wind = new TL.WindField(); hero.wind.base.set(0, 0, 0);
  const anim = new TL.HeroAnimator(sk, name, scene, mat, 'high');
  return { hero, anim, sk, bone: (n) => anim.rig.bones[n].getWorldPosition(new THREE.Vector3()), tick: (dt) => anim.update(dt, hero, hero.pos, cam) };
}
/* run physics at 120 Hz, animate at the given frame times */
function play(o, it, frames, onFrame) {
  for (const dt of frames) {
    const n = Math.max(1, Math.round(dt * 120)); for (let i = 0; i < n; i++) { o.hero.step(1 / 120, it); it.jump = false; it.swingPressed = false; }
    o.tick(dt); if (onFrame && onFrame(dt) === false) break;
  }
}
const frames = (hz, secs) => Array.from({ length: Math.round(secs * hz) }, () => 1 / hz);
const variable = (secs) => { const a = []; let t = 0, k = 0; while (t < secs) { const dt = [1 / 30, 1 / 144, 1 / 60, 1 / 90, 1 / 45][k++ % 5]; a.push(dt); t += dt; } return a; };
const KINDS = { vault1: [0.92, 0.3, 6.5, false], speed: [0.95, 0.35, 12, true], vault2: [1.25, 1.1, 5, false], stepover: [0.38, 0.3, 6, false] };

for (const name of ['WEAVER', 'PULSE']) for (const [kind, [ht, dp, sp, sprint]] of Object.entries(KINDS)) for (const [label, fr] of [['30Hz', frames(30, 2)], ['60Hz', frames(60, 2)], ['120Hz', frames(120, 2)], ['variable', variable(2)]]) {
  test(`${name} ${kind} @${label}: support hand on the real top, no limb inside the obstacle, run resumes`, () => {
    const W = world(), rail = box(W, 0, 0, 7, 3, ht, dp), o = make(name, W), h = o.hero;
    h.teleport(0, TL.C.FEET + 0.01, 0); h.vel.set(0, 0, sp); h.grounded = true; h.fsm.set(S.GROUND);
    let seen = false, worstHand = 0, worstPen = 0;
    play(o, fwd({ sprint }), fr, () => {
      const A = h.action; if (!A) return;
      seen = A.plan.kind === kind;
      const P = A.plan, sup = A.u > P.contact + 0.06 && A.u < P.release - 0.06;
      if (sup) for (const s of ['L', 'R']) if (P.hands[s]) worstHand = Math.max(worstHand, o.anim.handWorld[s].distanceTo(P.hands[s].clone().setY(P.hands[s].y + 0.05)));
      for (const b of ['footL', 'footR', 'shinL', 'shinR', 'hips']) {
        const q = o.bone(b), L = rail.toLocal(q.x, q.y, q.z, {});
        const m = Math.max(Math.abs(L.x) - rail.hx, Math.abs(L.y) - rail.hy, Math.abs(L.z) - rail.hz);
        if (m < 0) worstPen = Math.max(worstPen, -m);
      }
    });
    assert(seen, kind + ' was performed');
    assert(worstHand < 0.08, 'planted hand stays on the support (worst ' + worstHand.toFixed(3) + ')');
    assert(worstPen < 0.03, 'no foot / knee / hip inside the obstacle (worst ' + worstPen.toFixed(3) + ')');
    assert.equal(h.state, S.GROUND); assert(h.pos.z > 8);
    assert(o.sk.list.every((b) => b.quaternion.toArray().every(Number.isFinite)));
  });
}
// ------------------------------------------------------------------ web catch
function catchRig(name, hand, v, anchor) {
  const W = world(); box(W, anchor[0] + 2 * Math.sign(anchor[0] || 1), 0, anchor[2], 2, 62, 2);
  const o = make(name, W), h = o.hero; h.teleport(0, 40, 0); h.vel.set(...v); h.singleHandSwing = true; h.facing = 0;
  const r = h.tether.main; r.release(); r.active = true; r.attached = false; r.kind = 'swing'; r.hand = hand; r.anchor.set(...anchor);
  r.L = h.pos.distanceTo(r.anchor) * 0.97; r.maxL = 80; r.targetL = r.L; r.shotT = 0; r.shotDur = 0.03; h.fsm.set(S.AIR);
  o.anim.startWebShot(r); o.tick(1 / 60);
  return o;
}
for (const name of ['WEAVER', 'PULSE']) for (const hand of ['L', 'R']) {
  test(`${name} ${hand}-hand catch: the selected wrist holds the line, the free arm balances (not raised), root turns smoothly`, () => {
    const s = hand === 'L' ? 1 : -1, o = catchRig(name, hand, [0, -18, 14], [6 * s, 58, 18]), h = o.hero, r = h.tether.main;
    const loads = []; const off = TL.bus.on('hero:catchload', (c, k) => { if (c === h) loads.push(k); });
    let maxTurn = 0, prev = o.anim.rootQ.clone(), worstLine = 0, freeHigh = 0;
    play(o, intent({ swing: true, singleHand: true }), frames(60, 1.2), () => {
      maxTurn = Math.max(maxTurn, prev.angleTo(o.anim.rootQ)); prev.copy(o.anim.rootQ);
      if (h.state !== S.SWING || !o.anim.catchS || o.anim.catchS.t < 0.12) return;   // the wrist reaches the line within ~70 ms of the bite
      const wrist = o.anim.handWorld[hand], dir = r.pivot().clone().sub(wrist).normalize(), sh = o.bone('uarm' + hand), arm = wrist.clone().sub(sh).normalize();
      worstLine = Math.max(worstLine, arm.angleTo(dir));
      const F = hand === 'L' ? 'R' : 'L', up = new THREE.Vector3(0, 1, 0).applyQuaternion(o.anim.rootQ);
      freeHigh = Math.max(freeHigh, o.anim.handWorld[F].clone().sub(o.bone('uarm' + F)).dot(up));
    });
    off();
    assert.equal(r.hand, hand);
    assert(worstLine < 0.6, 'rope arm points along the line (worst ' + worstLine.toFixed(2) + ' rad)');
    assert(freeHigh < 0.25, 'free hand never raised overhead with the rope hand (' + freeHigh.toFixed(2) + ')');
    assert(maxTurn < 0.25, 'no sudden root rotation on attach (max ' + maxTurn.toFixed(3) + ' rad/frame)');
    assert(loads.length <= 1, 'strong catch signalled at most once');
    assert(o.anim.catchS.peak > 0.2, 'hard catch gives at the elbow / shoulder (peak ' + o.anim.catchS.peak.toFixed(2) + ')');
  });
}
test('slack attached web: no load response, no catch signal, no jerk', () => {
  const o = catchRig('PULSE', 'L', [0, 1, 9], [4, 56, 14]), h = o.hero; let n = 0;
  const off = TL.bus.on('hero:catchload', (c) => { if (c === h) n++; });
  play(o, intent({ swing: true, singleHand: true }), frames(60, 0.5)); off();
  assert(h.tether.main.attached && h.tether.main.stretch < 0, 'line is attached but slack');
  assert.equal(n, 0); assert(o.anim.catchS.peak < 0.02 && o.anim.catchS.load < 0.05);
});
test('a line that keeps loading and unloading never replays the catch', () => {
  const o = catchRig('WEAVER', 'R', [0, -20, 4], [-3, 60, 3]), h = o.hero; let n = 0;
  const off = TL.bus.on('hero:catchload', (c) => { if (c === h) n++; });
  play(o, intent({ swing: true, singleHand: true }), frames(60, 2.5)); off();
  assert(n <= 1 && o.anim.catchS.budget >= 0);
});
test('pendulum leg drive keeps its timing once the catch has blended (early ascent legs already forward)', () => {
  const o = catchRig('PULSE', 'L', [0, -18, 14], [6, 58, 18]), h = o.hero, r = h.tether.main;
  play(o, intent({ swing: true, singleHand: true }), frames(60, 0.4));
  // pin the hero at 0.3 rad past the bottom on the rising side and let the pose settle
  const L = 20; r.anchor.set(0, 60, 0); r.bends.length = 0; r.L = L; r.tension = 40; r.stretch = 0;
  for (let i = 0; i < 40; i++) { h.pos.set(0, 60 - L * Math.cos(0.3), L * Math.sin(0.3)); h.vel.set(0, 22 * Math.sin(0.3), 22 * Math.cos(0.3)); o.tick(1 / 60); }
  const p = TL.PendulumMotion.sample(h);
  assert(p.hip > 1 && o.anim.rig.target.thighL.z > 0.7, 'legs forward-up early in the ascent (thigh z ' + o.anim.rig.target.thighL.z.toFixed(2) + ')');
});
// ------------------------------------------------------------------ J state, rolls, landings, pole
test('J (retracted Iron Spider arms) survives vaults, rolls, landings and catches', () => {
  const W = world(); box(W, 0, 0, 7, 3, 0.92, 0.3);
  const o = make('WEAVER', W), h = o.hero; o.anim.arms.setRetracted(true, true);
  h.teleport(0, TL.C.FEET + 0.01, 0); h.vel.set(0, 0, 6.5); h.grounded = true; h.fsm.set(S.GROUND);
  play(o, fwd(), frames(60, 2));
  h.teleport(0, 14, 20); h.vel.set(0, 0, 13); play(o, fwd(), frames(60, 2.5));
  assert(o.anim.arms.retracted && o.anim.arms.deployment === 0, 'arms stay stowed');
  assert(h.landing && (h.landing.kind === 'roll' || h.landing.kind === 'crouch'));
});
test('landing animation starts once per physical landing (standing still does not re-trigger)', () => {
  const W = world(), o = make('PULSE', W), h = o.hero; h.teleport(0, 6, 0);
  const ids = new Set(); play(o, intent(), frames(60, 3), () => { if (o.anim.landRec) ids.add(o.anim.landRec.L.id); });
  assert.equal(ids.size, 1);
});
test('roll: curled body touches down (no floating), emerges upright moving along travel', () => {
  const W = world(), o = make('PULSE', W), h = o.hero; h.teleport(0, 14, -20); h.vel.set(0, 0, 13);
  let lowest = Infinity, rolled = false;
  play(o, fwd(), frames(60, 2.4), () => { if (h.state === S.RECOVER && h.landing.kind === 'roll') { rolled = true; let m = Infinity; for (const b of ['head', 'chest', 'hips', 'footL', 'footR', 'handL', 'handR']) m = Math.min(m, o.bone(b).y); lowest = Math.min(lowest, m); } });
  assert(rolled); assert(lowest < 0.25 && lowest > -0.15, 'some body part reaches the ground during the roll (lowest ' + lowest.toFixed(2) + ')');
  assert(new THREE.Vector3(0, 1, 0).applyQuaternion(o.anim.rootQ).y > 0.95 && h.vel.z > 4);
});
test('pole cling stays its own upright grip (not wall-run, not a rooftop perch)', () => {
  const W = world(); const pole = W.addStatic(0, 4, 0.6, 0.2, 4, 0.2, 0, { kind: 'building', climb: true });
  const o = make('PULSE', W), h = o.hero; h.teleport(0, 4, 0); h.wallCol = pole; h.wallN.set(0, 0, -1); h.wallMode = 'side'; h.vel.set(0, 0, 0); h.fsm.set(S.WALL);
  play(o, intent(), frames(60, 3));
  assert.equal(h.state, S.CRAWL); assert(o.anim.poleGrip > 0.9, 'pole grip pose');
  assert(new THREE.Vector3(0, 1, 0).applyQuaternion(o.anim.rootQ).y > 0.98, 'upright');
});
console.log('\n' + passed + ' passed');
