/* Run with the same TL_HARNESS used by physics_test.js. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const harness = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE = require(path.join(harness, 'node_modules/three/build/three.cjs'));
for (const file of ['00_core.js', '01_assets.js', '02_collision.js', '04_physics.js', '04b_contact.js', '06b_motion.js', '06_anim.js', '06d_contact_anim.js', '16_game.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { filename: file });
}
TL.V.init();
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function arena(left = true, right = true) {
  const w = new TL.CollisionWorld(); w.groundFn = () => 0;
  // Camera looks +Z, so screen right is -X (the game's actual camera convention).
  if (left) w.addStatic(24, 45, 22, 7, 45, 35, 0, { kind: 'building' });
  if (right) w.addStatic(-24, 45, 22, 7, 45, 35, 0, { kind: 'building' });
  const h = new TL.HeroController(w, TL.HERO_STATS.PULSE); h.teleport(0, 20, 0);
  return h;
}
function intent(hand) {
  return { move: new THREE.Vector3(), moveLocal: { x: 0, y: 0 }, camFwd: new THREE.Vector3(0, 0, 1),
    camRight: new THREE.Vector3(-1, 0, 0), swing: true, swingPressed: true, singleHand: true, swingHand: hand };
}
for (const hand of ['L', 'R']) {
  test(hand + ' chooses its own side and keeps the requested wrist', () => {
    const h = arena(); h.handleInputEdges(intent(hand), 1 / 120);
    assert(h.tether.main.active); assert.equal(h.tether.main.hand, hand);
    assert(hand === 'L' ? h.tether.main.anchor.x > 0 : h.tether.main.anchor.x < 0);
  });
  test(hand + ' falls back across the body without changing wrist', () => {
    const h = arena(hand !== 'L', hand !== 'R'); h.handleInputEdges(intent(hand), 1 / 120);
    assert(h.tether.main.active); assert.equal(h.tether.main.hand, hand);
    assert(hand === 'L' ? h.tether.main.anchor.x < 0 : h.tether.main.anchor.x > 0);
  });
}
test('empty sky never creates a web', () => {
  const h = arena(false, false); h.handleInputEdges(intent('L'), 1 / 120); assert(!h.tether.main.active);
});
test('preferred side survives an attractive opposite-side cone hit', () => {
  const h = arena(false, true);
  h.world.addStatic(28, 45, -10, 3, 45, 5, 0, { kind: 'building' });
  h.handleInputEdges(intent('L'), 1 / 120); assert(h.tether.main.anchor.x > 0);
});
test('hand transfer has one web and preserves instantaneous momentum', () => {
  const h = arena(); const it = intent('L'); h.handleInputEdges(it, 1 / 120);
  h.tether.main.attached = true; h.fsm.set(TL.TS.SWING); h.vel.set(3, 4, 20);
  const before = h.vel.clone(); h.handleInputEdges(intent('R'), 1 / 120);
  assert.equal(h.tether.ropes.filter(r => r.active).length, 1);
  assert.equal(h.tether.main.hand, 'R'); assert.equal(h.vel.distanceTo(before), 0);
  assert.equal(h.state, TL.TS.AIR);
});
test('release Shift cancels a travelling web before attachment', () => {
  const h = arena(); h.handleInputEdges(intent('L'), 1 / 120);
  h.handleInputEdges({ ...intent(null), swing: false, swingPressed: false }, 1 / 120);
  assert(!h.tether.main.active);
});
test('single hand swing stays finite through repeated left/right transfers', () => {
  const h = arena(); h.vel.z = 18; let it = intent('L');
  for (let i = 0; i < 600; i++) {
    it.swingPressed = i % 90 === 0; it.swingHand = i % 180 === 0 ? 'L' : 'R';
    h.step(1 / 120, it); assert(TL.finite3(h.pos) && TL.finite3(h.vel));
    assert(h.tether.ropes.filter(r => r.active).length <= 1);
  }
  assert.equal(h.nanResets, 0);
});
function input(mode) {
  const i = Object.create(TL.Input.prototype);
  Object.assign(i, { game: { settings: { ...TL.defaultSettings(), swingMode: mode }, hero: { ctrl: { state: TL.TS.AIR } } },
    keys: new Set(), mouse: { buttons: new Set() }, pressed: new Set(), released: new Set(), toggles: {},
    bindings: TL.Input.defaults(), intent: { move: new THREE.Vector3(), camFwd: new THREE.Vector3(), camRight: new THREE.Vector3(), moveLocal: {} } });
  i.padDown = () => false; i.padState = () => null;
  return i;
}
const rig = { fwd: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(-1, 0, 0), moveFwd: new THREE.Vector3(0, 0, 1) };
test('single mode Shift alone does not fire; each mouse button chooses its hand', () => {
  const i = input('single'); i.keys.add('ShiftLeft'); i.pressedCode('ShiftLeft');
  i.latchEdges(i.buildIntent(rig)); assert(!i.intent.swingPressed);
  for (const [button, hand] of [['Mouse0', 'L'], ['Mouse2', 'R']]) {
    i.pressedCode(button); i.latchEdges(i.buildIntent(rig));
    assert(i.intent.swingPressed); assert.equal(i.intent.swingHand, hand);
    assert(!i.peek('attack')); assert(!i.down('aim'));
    i.clearEdges(i.intent); i.latchEdges(i.buildIntent(rig)); assert(!i.intent.swingPressed);
  }
});
test('ordinary clicks still attack and aim without Shift', () => {
  const i = input('single'); i.pressedCode('Mouse0'); assert(i.consume('attack'));
  i.mouse.buttons.add('Mouse2'); assert(i.down('aim'));
});
test('multi mode keeps the original Shift-only input and toggle option', () => {
  const i = input('multi'); i.keys.add('ShiftLeft'); i.pressedCode('ShiftLeft');
  i.latchEdges(i.buildIntent(rig)); assert(i.intent.swingPressed && i.intent.swing && !i.intent.singleHand);
  i.clearEdges(i.intent); i.game.settings.holdToggle.swing = 'toggle'; i.pressedCode('ShiftLeft');
  i.buildIntent(rig); i.pressed.clear(); i.keys.clear(); assert(i.buildIntent(rig).swing);
});
test('hand-transfer animation does not trigger a release flip', () => {
  const h = arena(); h.fsm.set(TL.TS.SWING); h.fsm.set(TL.TS.AIR, 'hand-transfer'); h.vel.set(0, 8, 30);
  const anim = Object.create(TL.HeroAnimator.prototype); anim.startRelease(h); assert.equal(anim.rel, null);
  const r = h.tether.main; r.hand = 'L'; anim.startWebShot(r); assert.equal(anim.webShot.hand, 'L');
  r.hand = 'R'; anim.startWebShot(r); assert.equal(anim.webShot.hand, 'R');
});
test('both actual hero skeletons animate both hands and cross-body attachments without invalid transforms', () => {
  const build = path.join(__dirname, '../build');
  const buffer = f => { const b = fs.readFileSync(path.join(build, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  TL.Assets.man = JSON.parse(fs.readFileSync(path.join(build, 'assets.json'))); TL.Assets.bin = buffer('assets.bin');
  if (fs.existsSync(path.join(build, 'heroes.json'))) {
    Object.assign(TL.Assets.man.assets, JSON.parse(fs.readFileSync(path.join(build, 'heroes.json'))).assets);
    TL.Assets.hbin = buffer('heroes.bin');
    TL.Assets.packs=TL.Assets.packs||{};TL.Assets.packs[1]=TL.Assets.hbin;
  }
  for (const name of ['WEAVER', 'PULSE']) {
    const mat = TL.Assets.material(), scene = new THREE.Scene();
    const sk = TL.Assets.skinned(name, 'hi', mat);
    const anim = new TL.HeroAnimator(sk, name, scene, mat, 'high');
    const h = arena(); h.singleHandSwing = true; h.vel.set(0, -4, 20);
    for (const hand of ['L', 'R']) for (const x of [-24, 24]) {
      const r = h.tether.main; r.active = true; r.attached = false; r.hand = hand; r.anchor.set(x, 45, 25);
      anim.startWebShot(r); h.fsm.set(TL.TS.AIR, 'hand-transfer');
      for (let k = 0; k < 60; k++) {
        if (k === 12) { r.attached = true; r.tension = 50; h.fsm.set(TL.TS.SWING); }
        anim.update(1 / 60, h, h.pos, rig);
        assert(Object.values(anim.handWorld).every(TL.finite3));
        assert(sk.list.every(b => b.quaternion.toArray().every(Number.isFinite)));
      }
    }
  }
});
console.log('\n' + passed + ' passed');
