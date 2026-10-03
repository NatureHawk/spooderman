/* Real-physics regression: a wall is a contact overlay on a live swing. */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm'), assert = require('assert');
const HARN = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE = require(path.join(HARN, 'node_modules/three/build/three.cjs'));
for (const f of ['00_core.js', '02_collision.js', '04_physics.js', '04b_contact.js', '04c_reference.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), { filename: f });
TL.V.init();
function setup(end = 160) {
  const w = new TL.CollisionWorld(); w.groundFn = () => 0;
  const wall = w.addStatic(5, 80, (end - 20) / 2, 5, 80, (end + 20) / 2, 0, { kind: 'building', climb: true });
  const h = new TL.HeroController(w, TL.HERO_STATS.PULSE); h.assist = 0;
  h.teleport(-0.6, 70, 0); h.vel.set(8, 0, 26);
  const r = h.tether.main; r.active = r.attached = true; r.kind = 'swing';
  r.anchor.set(-0.6, 120, 0); r.L = r.targetL = 90; r.minL = 2; r.maxL = 200;
  h.fsm.set(TL.TS.SWING);
  const it = { move: new THREE.Vector3(), moveLocal: { x: 0, y: 0 }, camFwd: new THREE.Vector3(0, 0, 1),
    camRight: new THREE.Vector3(-1, 0, 0), swing: true, swingPressed: false, jump: false, dive: false };
  return { h, r, it, wall };
}
let passed = 0;
function check(name, fn) { fn(); console.log('PASS ' + name); passed++; }
check('glancing impact keeps rope, state and wall-tangent velocity', () => {
  const { h, r, it } = setup();
  for (let i = 0; i < 10 && !h.swingWall; i++) h.step(1 / 120, it);
  assert(h.swingWall); assert.equal(h.state, TL.TS.SWING); assert(r.active && r.attached);
  assert(h.vel.z > 25.7 && h.vel.z <= 26); assert(Math.abs(h.vel.x) < 0.1);
});
check('wall contact lasts beyond normal wall-run timer without crawl or speed reset', () => {
  const { h, r, it } = setup(); r.L = r.targetL = 150;
  for (let i = 0; i < 270; i++) h.step(1 / 120, it);
  assert(h.swingWall); assert.equal(h.state, TL.TS.SWING); assert(r.active && r.attached);
  assert(h.wallTime > h.stats.wallTime); assert(h.vel.z > 19); assert(h.pos.x <= -TL.C.CAP_R + 0.02);
});
check('edge exit resumes the same swing and anchor', () => {
  const { h, r, it } = setup(6), anchor = r.anchor.clone(); let touched = false;
  for (let i = 0; i < 65; i++) { h.step(1 / 120, it); touched ||= h.swingWall; }
  assert(touched && !h.swingWall); assert.equal(h.state, TL.TS.SWING); assert(r.active && r.attached);
  assert(r.anchor.equals(anchor)); assert(h.vel.z > 23);
});
check('jump releases the web and pushes away with tangent momentum', () => {
  const { h, r, it } = setup();
  for (let i = 0; i < 10; i++) h.step(1 / 120, it);
  assert(h.swingWall); const vz = h.vel.z; it.jump = true; h.step(1 / 120, it);
  assert(!h.swingWall && !r.active); assert.equal(h.state, TL.TS.AIR); assert(h.vel.x < -4); assert(h.vel.z >= vz);
});
check('button release has no artificial velocity impulse', () => {
  const { h, r, it } = setup();
  for (let i = 0; i < 10; i++) h.step(1 / 120, it);
  const v = h.vel.clone(); h.releaseSwing(false, it);
  assert(!h.swingWall && !r.active); assert(h.vel.equals(v));
});
check('rope tension and bounded extension remain active during wall run', () => {
  const { h, r, it } = setup(); r.L = r.targetL = 50;
  let maxRatio = 0, maxTension = 0, touched = false;
  for (let i = 0; i < 180; i++) {
    h.step(1 / 120, it); touched ||= h.swingWall;
    maxRatio = Math.max(maxRatio, h.pos.distanceTo(r.pivot()) / r.freeLen());
    maxTension = Math.max(maxTension, r.tension);
  }
  assert(touched && r.active); assert(maxTension > 0); assert(maxRatio < 1.06); assert.equal(h.nanResets, 0);
});
check('outward rope pull leaves wall contact without detaching the web', () => {
  const { h, r, it } = setup();
  for (let i = 0; i < 10; i++) h.step(1 / 120, it);
  assert(h.swingWall); h.vel.x = -5; h.step(1 / 120, it);
  assert(!h.swingWall); assert(r.active && r.attached); assert.equal(h.state, TL.TS.SWING);
});
check('wall swing remains finite and constrained at 30/60/120/240 Hz and variable steps', () => {
  const distances = [];
  for (const dt of [1 / 30, 1 / 60, 1 / 120, 1 / 240, null]) {
    const { h, r, it } = setup(); r.L = r.targetL = 50;
    let elapsed = 0, i = 0, touched = false, maxRatio = 0;
    while (elapsed < 1.2 - 1e-8) {
      const step = Math.min(dt || [1 / 30, 1 / 120, 1 / 60, 1 / 90][i++ % 4], 1.2 - elapsed);
      h.step(step, it); elapsed += step; touched ||= h.swingWall;
      assert(TL.finite3(h.pos) && TL.finite3(h.vel));
      assert(h.pos.x <= -TL.C.CAP_R + 0.025);
      maxRatio = Math.max(maxRatio, h.pos.distanceTo(r.pivot()) / r.freeLen());
    }
    assert(touched && r.active && r.attached); assert.equal(h.state, TL.TS.SWING);
    assert(maxRatio < 1.06); assert.equal(h.nanResets, 0); distances.push(h.pos.z);
  }
  assert(Math.max(...distances) - Math.min(...distances) < 0.6);
});
check('head-on high speed impact stops the normal component without dropping the web or launching upward', () => {
  const { h, r, it } = setup(); h.vel.set(100, 12, 0);
  h.step(1 / 120, it);
  assert(h.swingWall); assert.equal(h.state, TL.TS.SWING); assert(r.active && r.attached);
  assert(Math.abs(h.vel.x) < 0.1 && Math.abs(h.vel.z) < 0.1);
  assert(h.vel.y > 11.5 && h.vel.y <= 12);
  for (let i = 0; i < 120; i++) {
    h.step(1 / 120, it);
    assert(TL.finite3(h.pos) && TL.finite3(h.vel));
    assert(h.pos.x <= -TL.C.CAP_R + 0.025 && h.vel.length() < 15);
  }
  assert(h.swingWall && r.active && r.attached); assert.equal(h.state, TL.TS.SWING); assert.equal(h.nanResets, 0);
});
console.log(`${passed} swing-wall checks passed`);
