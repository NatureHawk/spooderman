/* THREADLINE physics validation (Node, headless). Run: node tests/physics_test.js
   Loads the real game physics sources (00_core, 02_collision, 04_physics) and checks:
   anchor validity, rope constraint (pull-only, bounded stretch), momentum on release, 5-swing chain,
   timestep robustness (no NaN / infinite force / explosive jitter), anti-tunneling at high speed,
   moving anchors, wall run/crawl/crest, glide aerodynamics, full traversal chain. */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const HARN = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE = require(path.join(HARN, 'node_modules/three/build/three.cjs'));
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['00_core.js', '02_collision.js', '04_physics.js', '04b_contact.js', '04c_reference.js']) vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
TL.V.init();

let pass = 0, fail = 0;
const results = [];
function check(name, cond, info) { (cond ? pass++ : fail++); results.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  — ' + info : '')); }

// ------------------------------------------------------------------ test arena
function makeWorld() {
  const W = new TL.CollisionWorld();
  W.groundFn = () => 0;
  W.waterFn = (x, z) => x > 300 && x < 400;
  const B = (x, z, w, d, h, props) => W.addStatic(x, h / 2, z, w / 2, h / 2, d / 2, 0, Object.assign({ kind: 'building' }, props || {}));
  // avenue of towers along +z on both sides of x=0 street (street width 20)
  for (let i = 0; i < 12; i++) {
    B(-25, i * 60, 30, 40, 60 + (i % 3) * 30);
    B(25, i * 60 + 30, 30, 40, 70 + (i % 4) * 25);
  }
  B(0, -60, 60, 20, 45);                                          // wall at the south end for wall-run tests
  const pole = W.addStatic(0, 4, 100, 0.15, 4, 0.15, 0, { kind: 'prop' });   // thin pole (anti-tunneling)
  W.addStatic(0, 30, 200, 10, 1, 10, 0, { kind: 'building' });   // overhang slab (ceiling) at y 29..31 on stilts
  // moving vehicle (dynamic) driving along +z at 14 m/s
  const car = W.addDynamic(-5, 1.2, 20, 1.0, 1.2, 2.4, 0, { kind: 'vehicle', mass: 9000 });
  // rotating crane jib high above
  const jib = W.addDynamic(40, 70, 300, 25, 1.2, 1.2, 0, { kind: 'crane', mass: Infinity });
  return { W, pole, car, jib };
}
function intent(o) {
  return Object.assign({
    move: new THREE.Vector3(), moveLocal: { x: 0, y: 0 }, camFwd: new THREE.Vector3(0, 0, 1), camRight: new THREE.Vector3(-1, 0, 0),
    jump: false, jumpHeld: false, swing: false, swingPressed: false, dive: false, glideToggle: false, sling: false, slingPressed: false,
    reelIn: 0, reelOut: 0, tether: false, launchTarget: null, sprint: false,
  }, o || {});
}
function hero(W, name) { const h = new TL.HeroController(W, TL.HERO_STATS[name || 'PULSE']); h.wind = new TL.WindField(); h.wind.base.set(0, 0, 0); return h; }
function onSurface(col, p, tol) {
  const L = col.toLocal(p.x, p.y, p.z, { x: 0, y: 0, z: 0 });
  const inside = Math.abs(L.x) <= col.hx + tol && Math.abs(L.y) <= col.hy + tol && Math.abs(L.z) <= col.hz + tol;
  const onFace = Math.abs(Math.abs(L.x) - col.hx) < tol || Math.abs(Math.abs(L.y) - col.hy) < tol || Math.abs(Math.abs(L.z) - col.hz) < tol;
  return inside && onFace;
}

// ------------------------------------------------------------------ 1) anchor selection uses real geometry
{
  const { W } = makeWorld(); const h = hero(W);
  h.teleport(0, 20, 30); h.vel.set(0, 0, 20);
  const it = intent({ swingPressed: true, swing: true });
  let valid = 0, total = 0, sky = 0;
  for (let k = 0; k < 40; k++) {
    h.teleport(TL.lerp(-6, 6, (k % 7) / 6), 15 + (k % 5) * 6, k * 12); h.vel.set(0, -2, 18);
    const a = h.tether.findSwingAnchor(h, it, h.stats, 60);
    total++;
    if (!a) continue;
    if (!a.col) sky++;
    else if (onSurface(a.col, a, 0.05) && a.y > h.pos.y + 3) valid++;
  }
  check('anchors attach only to visible collider surfaces above the hero', valid >= 30 && sky === 0, `${valid}/${total} valid, sky=${sky}`);
  const allCands = h.tether.candidates.every((c) => c.col && onSurface(c.col, c, 0.05));
  check('every candidate ray hit is on real geometry (none in the sky)', allCands, h.tether.candidates.length + ' candidates');
}

// ------------------------------------------------------------------ 2+3) pendulum constraint: pull-only, bounded, NaN-free
function runSwing(dt, seconds, variable) {
  const { W } = makeWorld(); const h = hero(W);
  h.teleport(0, 30, 40); h.vel.set(0, 0, 22);
  let it = intent({ swingPressed: true, swing: true });
  let maxStretch = 0, minT = 0, maxT = 0, nan = false, pushes = 0, maxSpeed = 0, t = 0, steps = 0;
  let attached = false;
  while (t < seconds) {
    const d = variable ? dt * (0.5 + ((steps * 7919) % 100) / 100) : dt;
    const before = h.vel.clone();
    h.step(d, it);
    it = intent({ swing: true });
    t += d; steps++;
    const r = h.tether.main;
    if (r.attached) {
      attached = true;
      const dist = h.pos.distanceTo(r.pivot());
      maxStretch = Math.max(maxStretch, (dist - r.freeLen()) / r.freeLen());
      minT = Math.min(minT, r.tension); maxT = Math.max(maxT, r.tension);
    }
    if (!TL.finite3(h.pos) || !TL.finite3(h.vel)) nan = true;
    maxSpeed = Math.max(maxSpeed, h.vel.length());
    void before;
  }
  return { h, attached, maxStretch, minT, maxT, nan, maxSpeed, pushes };
}
for (const [label, dt, varr] of [['1/30', 1 / 30, false], ['1/60', 1 / 60, false], ['1/120', 1 / 120, false], ['1/240', 1 / 240, false], ['variable', 1 / 60, true]]) {
  const r = runSwing(dt, 6, varr);
  check(`swing @${label}: attached, no NaN, stretch<6%, tension>=0 and bounded`,
    r.attached && !r.nan && r.maxStretch < 0.06 && r.minT >= 0 && r.maxT <= 14 * TL.C.G + 1e-6 && r.maxSpeed < 90,
    `stretch=${(r.maxStretch * 100).toFixed(2)}% T=[${r.minT.toFixed(1)},${r.maxT.toFixed(1)}] vmax=${r.maxSpeed.toFixed(1)} nanResets=${r.h.nanResets}`);
}
// rope never pushes: when slack (d < L) the constraint must not change velocity
{
  const { W } = makeWorld(); const h = hero(W);
  h.teleport(0, 30, 40); h.vel.set(0, 0, 0);
  const r = h.tether.main; r.active = true; r.attached = true; r.kind = 'swing';
  r.attachTo({ x: 0, y: 50, z: 40, col: null }); r.L = 30; r.maxL = 80;     // player 20 m below: slack rope
  h.fsm.set(TL.TS.SWING);
  const v0 = h.vel.clone();
  const T = h.tether.constrain(r, h, 1 / 120);
  check('slack rope applies zero force (never pushes)', T === 0 && h.vel.equals(v0), 'T=' + T);
  // stretched rope pulls toward anchor only
  h.pos.set(0, 50 - 31, 40); h.vel.set(0, -5, 0);
  const T2 = h.tether.constrain(r, h, 1 / 120);
  check('stretched rope pulls toward the anchor', T2 > 0 && h.vel.y > -5, 'T=' + T2.toFixed(1) + ' vy=' + h.vel.y.toFixed(3));
}

// ------------------------------------------------------------------ momentum preserved exactly on release
{
  const { W } = makeWorld(); const h = hero(W);
  h.teleport(0, 30, 40); h.vel.set(0, 0, 24);
  let it = intent({ swingPressed: true, swing: true });
  for (let i = 0; i < 180; i++) { h.step(1 / 120, it); it = intent({ swing: true }); }
  const vBefore = h.vel.clone();
  h.releaseSwing(false, intent());
  check('release keeps the actual physical velocity (no scripted vector)', h.vel.equals(vBefore) && h.state === TL.TS.AIR, `v=${vBefore.length().toFixed(2)} m/s`);
}

// ------------------------------------------------------------------ energy behaviour of an ideal pendulum (no drag, no input)
{
  const { W } = makeWorld(); const h = hero(W);
  h.stats = Object.assign({}, h.stats, { dragMul: 0 }); h.assist = 0;
  const r = h.tether.main; r.active = true; r.attached = true; r.kind = 'swing';
  r.attachTo({ x: 0, y: 200, z: 500, col: null }); r.L = 40; r.targetL = 40; r.maxL = 80;
  h.teleport(0, 200 - 40 * Math.cos(0.9), 500 + 40 * Math.sin(0.9)); h.vel.set(0, 0, 0);
  h.tether.ropes[0].active = true; h.tether.ropes[0].attached = true; h.fsm.set(TL.TS.SWING);
  const E = () => 0.5 * h.vel.lengthSq() + TL.C.G * h.pos.y;
  const E0 = E(); let minE = E0, maxE = E0;
  const it = intent({ swing: true });
  for (let i = 0; i < 120 * 8; i++) { h.step(1 / 120, it); const e = E(); minE = Math.min(minE, e); maxE = Math.max(maxE, e); }
  const loss = (E0 - E()) / (E0 - TL.C.G * 160);
  check('ideal pendulum conserves energy (no gain, small damper loss)', maxE <= E0 * 1.002 && loss < 0.12, `gain=${((maxE / E0 - 1) * 100).toFixed(3)}% loss/8s=${(loss * 100).toFixed(1)}%`);
}

// ------------------------------------------------------------------ chain five swings with preserved release momentum
{
  const { W } = makeWorld(); const h = hero(W);
  h.teleport(0, 35, 10); h.vel.set(0, 0, 20);
  let swings = 0, releases = [], t = 0, attachedOnce = false, pressedAt = -1;
  let it = intent({ swingPressed: true, swing: true, moveLocal: { x: 0, y: 1 } });
  let holding = true, lastState = '';
  while (t < 30 && swings < 5) {
    h.step(1 / 120, it); t += 1 / 120;
    const st = h.state;
    if (st === TL.TS.SWING && lastState !== TL.TS.SWING) { attachedOnce = true; }
    it = intent({ swing: holding, moveLocal: { x: 0, y: 1 } });
    if (st === TL.TS.SWING && holding && h.vel.y > 2 && h.tether.main.tension > 0 && h.fsm.t > 0.6) {
      const v0 = h.vel.clone(); h.step(1 / 120, intent({ swing: false })); t += 1 / 120;
      releases.push(v0.distanceTo(h.vel)); swings++; holding = false; pressedAt = t;
    }
    if (!holding && t - pressedAt > 0.35 && (h.state === TL.TS.AIR || h.state === TL.TS.DIVE || h.state === TL.TS.WALL || h.state === TL.TS.CRAWL)) { holding = true; it = intent({ swingPressed: true, swing: true, moveLocal: { x: 0, y: 1 } }); }
    lastState = st;
    if (h.state === TL.TS.GROUND) break;
  }
  const dz = h.pos.z - 10;
  check('chain five swings without landing', swings >= 5, `swings=${swings} traveled=${dz.toFixed(0)} m, state=${h.state}`);
  check('each release preserves momentum (Δv only from 1 substep of gravity/drag)', releases.every((d) => d < 0.6), releases.map((d) => d.toFixed(2)).join(','));
}

// ------------------------------------------------------------------ anti-tunneling at high speed
for (const speed of [60, 100, 140]) {
  const { W } = makeWorld(); const h = hero(W);
  h.teleport(0, 4, 90); h.vel.set(0, 0, speed);                       // aimed straight at the 0.3 m pole at z=100
  for (let i = 0; i < 60; i++) h.step(1 / 120, intent());
  check(`no tunneling through a 0.3 m pole at ${speed} m/s`, h.pos.z < 100 - 0.2 + 0.001 || Math.abs(h.pos.x) > 0.3, `z=${h.pos.z.toFixed(2)} x=${h.pos.x.toFixed(2)}`);
  const h2 = hero(W); h2.teleport(0, 20, -20); h2.vel.set(0, 0, -speed);     // into the 45 m wall at z=-60 (face z=-50)
  for (let i = 0; i < 90; i++) h2.step(1 / 120, intent());
  check(`no tunneling into a building at ${speed} m/s`, h2.pos.z > -50 - 0.01, `z=${h2.pos.z.toFixed(2)} state=${h2.state}`);
}

// ------------------------------------------------------------------ moving anchors: rotating crane jib + flying drone
{
  const { W, jib } = makeWorld(); const h = hero(W);
  const drone = W.addDynamic(0, 45, 420, 0.6, 0.3, 0.6, 0, { kind: 'drone', mass: 12, owner: { v: [0, 0, 0], applyImpulse(x, y, z) { this.v[0] += x; this.v[1] += y; this.v[2] += z; } } });
  for (const [label, col, start] of [['crane jib', jib, [55, 50, 300]], ['drone', drone, [0, 30, 405]]]) {
    h.teleport(...start); h.vel.set(0, 0, 8);
    const r = h.tether.main; r.release(); r.active = true; r.attached = true; r.kind = 'swing';
    const hp = col.toWorld(col === jib ? 15 : 0, -col.hy, 0, { x: 0, y: 0, z: 0 });
    r.attachTo({ x: hp.x, y: hp.y, z: hp.z, col }); r.L = h.pos.distanceTo(r.anchor); r.maxL = 80; h.fsm.set(TL.TS.SWING);
    let maxErr = 0, ok = true, maxStretch = 0;
    for (let i = 0; i < 360; i++) {
      if (col === jib) W.moveDynamic(jib, jib.cx, jib.cy, jib.cz, jib.yaw + 0.25 / 120, 1 / 120);
      else W.moveDynamic(drone, drone.cx + drone.owner.v[0] / 120 + 6 / 120, drone.cy + drone.owner.v[1] / 120, drone.cz + drone.owner.v[2] / 120, 0, 1 / 120);
      h.step(1 / 120, intent({ swing: true }));
      if (!r.attached) break;
      const e = col.toWorld(r.local.x, r.local.y, r.local.z, { x: 0, y: 0, z: 0 });
      maxErr = Math.max(maxErr, Math.hypot(e.x - r.anchor.x, e.y - r.anchor.y, e.z - r.anchor.z));
      maxStretch = Math.max(maxStretch, h.pos.distanceTo(r.anchor) - r.freeLen());
      if (!TL.finite3(h.pos)) ok = false;
    }
    check('moving anchor (' + label + ') tracked in target-local space every step', maxErr < 1e-6 && ok && maxStretch < 2.5,
      'maxErr=' + maxErr.toExponential(1) + ' stretch=' + maxStretch.toFixed(2) + ' anchorVel=' + r.anchorVel.length().toFixed(1) + ' m/s');
  }
  check('light anchors receive mass-aware reaction impulses (drone pulled)', Math.hypot(...drone.owner.v) > 0.5, 'drone dv=' + Math.hypot(...drone.owner.v).toFixed(2));
}

// ------------------------------------------------------------------ wall run -> crawl -> crest, ceiling transition
{
  const { W } = makeWorld(); const h = hero(W);
  h.teleport(0, 1.0, -30); h.vel.set(0, 0, -16);
  const it = intent({ move: new THREE.Vector3(0, 0, -1), moveLocal: { x: 0, y: 1 }, camFwd: new THREE.Vector3(0, 0, -1), sprint: true });
  const seen = new Set();
  for (let i = 0; i < 120 * 12; i++) { h.step(1 / 120, it); seen.add(h.state); if (h.pos.y > 45.5 && h.state === TL.TS.GROUND) break; }
  check('sprint into wall -> wall run -> crawl -> crest onto roof', seen.has(TL.TS.WALL) && seen.has(TL.TS.CRAWL) && h.pos.y > 44, `states=${[...seen].join('>')} y=${h.pos.y.toFixed(1)} final=${h.state}`);
}

// ------------------------------------------------------------------ glide aerodynamics
{
  const { W } = makeWorld(); const h = hero(W);
  h.teleport(-200, 300, -200); h.vel.set(0, -2, 30);
  h.startGlide();
  const y0 = h.pos.y, p0 = h.pos.clone();
  for (let i = 0; i < 120 * 15; i++) h.step(1 / 120, intent());
  const drop = y0 - h.pos.y, dist = Math.hypot(h.pos.x - p0.x, h.pos.z - p0.z);
  check('glide produces lift (glide ratio > 2.5), no free flight', dist / Math.max(drop, 1) > 2.5 && drop > 20, `ratio=${(dist / drop).toFixed(2)} drop=${drop.toFixed(0)}m speed=${h.vel.length().toFixed(1)}`);
  // pull-up trades speed for altitude and can stall
  h.vel.set(0, 0, 40); h.glide.pitch = 0; let maxY = h.pos.y; const yS = h.pos.y; let stalled = false;
  for (let i = 0; i < 120 * 8; i++) { h.step(1 / 120, intent({ moveLocal: { x: 0, y: -1 } })); maxY = Math.max(maxY, h.pos.y); if (h.glide.stall) stalled = true; }
  check('glide pull-up converts speed to altitude and stalls', maxY > yS + 3 && stalled, `gain=${(maxY - yS).toFixed(1)}m stall=${stalled}`);
}

// ------------------------------------------------------------------ full traversal chain (state-reactive bot, no stuck state)
{
  const W = new TL.CollisionWorld(); W.groundFn = () => 0;
  const B = (x, z, w, d, hh) => W.addStatic(x, hh / 2, z, w / 2, hh / 2, d / 2, 0, { kind: 'building' });
  // course along +z: tower pairs for swings, open field for glide/dive, a ledge for point launch,
  // a tall face for the wall run, and poles for the slingshot
  for (let i = 0; i < 6; i++) { B(-22, 60 + i * 70, 20, 30, 110); B(22, 95 + i * 70, 20, 30, 110); }
  for (let i = 0; i < 6; i++) { B(-22, 480 + i * 60, 20, 30, 80); B(22, 510 + i * 60, 20, 30, 80); }
  B(0, 900, 60, 20, 32);                        // ledge / wall face (south face at z = 890)
  B(-15, 838, 8, 8, 25); B(15, 838, 8, 8, 25);
  const h = hero(W, 'PULSE');
  h.teleport(0, 55, 0); h.vel.set(0, 0, 24);
  const milestones = ['swing', 'trick', 'glide', 'dive', 'swing2', 'launch', 'wallrun', 'slingshot'];
  let m = 0, t = 0, stuck = 0; const lastPos = h.pos.clone();
  const done = [];
  let holdSwing = false, swingT = 0, slingT = 0;
  const swingBot = (it, st) => {
    if (st !== TL.TS.SWING && !holdSwing) { it.swingPressed = true; it.swing = true; holdSwing = true; swingT = 0; return false; }
    if (holdSwing) { it.swing = true; swingT += 1 / 120; }
    if (st === TL.TS.SWING && swingT > 1.0 && h.vel.y > 0) { it.swing = false; holdSwing = false; return true; }
    if (holdSwing && st !== TL.TS.SWING && swingT > 1.2) holdSwing = false;
    return false;
  };
  while (t < 90 && m < milestones.length) {
    const goal = milestones[m];
    const it = intent({ camFwd: new THREE.Vector3(TL.clamp(-h.pos.x * 0.04, -0.6, 0.6), 0, 1).normalize(), moveLocal: { x: 0, y: 1 } });
    const st = h.state;
    if (goal === 'swing' || goal === 'swing2') { if (swingBot(it, st)) { done.push(goal); m++; } }
    else if (goal === 'trick') { h.trick = 'corkscrew'; done.push('trick'); m++; }
    else if (goal === 'glide') { it.moveLocal = { x: 0, y: 0 }; if (st !== TL.TS.GLIDE) it.glideToggle = true; else if (h.fsm.t > 1.0) { done.push('glide'); m++; } }
    else if (goal === 'dive') { if (st === TL.TS.GLIDE) it.glideToggle = true; it.dive = true; if (st === TL.TS.DIVE && h.fsm.t > 0.4) { done.push('dive'); m++; } }
    else if (goal === 'launch') {
      if (h.pos.z < 800) { swingBot(it, st); }
      else if (st !== TL.TS.LAUNCH && !h.fsm.log.some((e) => e.to === TL.TS.LAUNCH)) {
        if (st === TL.TS.SWING) { it.swing = false; holdSwing = false; }
        const lt = h.tether.findLaunchPoint(h, h.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), new THREE.Vector3(0, 0.3, 1).normalize(), 90);
        if (lt) { it.tether = true; it.launchTarget = lt; }
      } else if (st === TL.TS.LAUNCH) { it.jumpHeld = true; if (h.launch && h.launch.window) it.jump = true; }
      if (h.fsm.log.some((e) => e.to === TL.TS.LAUNCH) && st !== TL.TS.LAUNCH) { done.push('launch'); m++; }
    } else if (goal === 'wallrun') {
      if (st === TL.TS.WALL || st === TL.TS.CRAWL) { done.push('wallrun'); m++; }
      else if (h.pos.y > 30) { h.teleport(0, 1, 860); h.vel.set(0, 0, 14); }       // step off the roof back to the street
      else { it.move.set(0, 0, 1); it.sprint = true; }
    } else if (goal === 'slingshot') {
      const aim = new THREE.Vector3(-h.pos.x, 0, 838 - h.pos.z).normalize();
      it.camFwd = { x: 0, y: 0, z: -1, set(x, y, z) { this.x = aim.x; this.y = 0; this.z = aim.z; return this; } };
      it.camFwd.set();
      if (st === TL.TS.WALL || st === TL.TS.CRAWL) { it.jump = true; it.camFwd.set(0, 0, -1); }
      else if (st !== TL.TS.SLING && slingT === 0) { it.slingPressed = true; it.sling = true; it.camFwd.set(0, 0, -1); slingT = 1e-6; }
      else if (st === TL.TS.SLING) { it.sling = true; it.camFwd.set(0, 0, -1); slingT += 1 / 120; if (slingT > 0.8) { it.sling = false; done.push('slingshot'); m++; } }
      else if (slingT > 0 && st !== TL.TS.SLING) slingT = 0;
    }
    h.step(1 / 120, it); t += 1 / 120;
    if (process.env.TLDBG && Math.round(t * 120) % 30 === 0) console.log(t.toFixed(2), goal, st, 'pos', h.pos.x.toFixed(1), h.pos.y.toFixed(1), h.pos.z.toFixed(1), 'v', h.vel.length().toFixed(1), 'hold', holdSwing, swingT.toFixed(2), 'press', !!it.swingPressed);
    if (h.pos.distanceTo(lastPos) < 1e-4 && st !== TL.TS.PERCH) stuck += 1 / 120; else stuck = 0;
    lastPos.copy(h.pos);
    if (stuck > 2.0) break;
  }
  check('swing → trick → glide → dive → swing → point launch → wall run → slingshot, never stuck',
    done.length === milestones.length && stuck < 2.0 && h.nanResets === 0,
    'done=' + done.join(' > ') + ' | t=' + t.toFixed(1) + 's stuck=' + stuck.toFixed(2) + ' final=' + h.state + ' z=' + h.pos.z.toFixed(0) + ' y=' + h.pos.y.toFixed(0));
}

// ------------------------------------------------------------------ slingshot converts stored elastic energy into a launch
{
  const W = new TL.CollisionWorld(); W.groundFn = () => 0;
  W.addStatic(-14, 15, 40, 4, 15, 4, 0, { kind: 'building' }); W.addStatic(14, 15, 40, 4, 15, 4, 0, { kind: 'building' });
  const h = hero(W, 'WEAVER'); h.teleport(0, 0.95, 20); h.fsm.set(TL.TS.GROUND);
  const fwd = new THREE.Vector3(0, 0, 1);
  h.step(1 / 120, intent({ slingPressed: true, sling: true, camFwd: fwd }));
  const st0 = h.state;
  let pull = 0;
  for (let i = 0; i < 150; i++) { h.step(1 / 120, intent({ sling: true, camFwd: fwd })); pull = Math.max(pull, h.sling ? h.sling.pull : 0); }
  h.step(1 / 120, intent({ sling: false, camFwd: fwd }));
  let vmax = 0, vzmax = 0, ymax = 0;
  for (let i = 0; i < 240; i++) { h.step(1 / 120, intent({ camFwd: fwd })); vmax = Math.max(vmax, h.vel.length()); vzmax = Math.max(vzmax, h.vel.z); ymax = Math.max(ymax, h.pos.y); }
  check('slingshot: pull back stores tension, release launches toward the anchors', st0 === TL.TS.SLING && pull > 4 && vzmax > 22 && ymax > 5,
    'pull=' + pull.toFixed(1) + 'm vmax=' + vmax.toFixed(1) + ' vz=' + vzmax.toFixed(1) + ' peakY=' + ymax.toFixed(1));
}

// ------------------------------------------------------------------ anchor fallback: nothing in the intent cone, towers off to the side
{
  const { W } = makeWorld(); const h = hero(W);
  // past the north end of the avenue looking further north (empty cone); the last towers are behind / beside
  h.teleport(0, 50, 740); h.vel.set(0, 0, 3);
  const it = intent({ swingPressed: true, swing: true, camFwd: new THREE.Vector3(0, -0.1, 1).normalize() });
  const a = h.tether.findSwingAnchor(h, it, h.stats, 50);
  check('anchor search falls back to a hemisphere sweep when the cone is empty', !!a && a.score < -20 && a.y - h.pos.y > 2.5 && onSurface(a.col, a, 0.05),
    a ? 'score ' + a.score.toFixed(0) + ' anchor ' + a.x.toFixed(0) + ',' + a.y.toFixed(0) + ',' + a.z.toFixed(0) + ' d=' + a.d.toFixed(0) : 'none');
  // fast: an anchor far behind would yank the hero backwards -> rejected
  h.vel.set(0, 0, 30);
  const b = h.tether.findSwingAnchor(h, it, h.stats, 50);
  check('fast fallback never picks an anchor well behind the hero', !b || (b.z - h.pos.z) / b.d > -0.36, b ? 'fwd=' + ((b.z - h.pos.z) / b.d).toFixed(2) : 'none');
}

// ------------------------------------------------------------------ release boost follows momentum, not straight up
{
  const { W } = makeWorld(); const h = hero(W);
  const boostFrom = (v, camFwd) => {
    h.teleport(0, 30, 100); h.vel.copy(v);
    const r = h.tether.main; r.active = true; r.attached = true; r.kind = 'swing'; r.attachTo({ x: 0, y: 55, z: 110 }); r.L = 26;
    h.fsm.set(TL.TS.SWING, 'test');
    const v0 = h.vel.clone(); h.releaseSwing(true, intent({ camFwd })); return h.vel.clone().sub(v0);
  };
  const d1 = boostFrom(new THREE.Vector3(6, 2, 24), new THREE.Vector3(0, 0, 1));
  const hd = Math.hypot(d1.x, d1.z), dirOk = (d1.x * 6 + d1.z * 24) / (hd * Math.hypot(6, 24)) > 0.99;
  check('release boost adds speed along the travel heading, more forward than up', dirOk && hd > d1.y && hd > 3, 'dH=' + hd.toFixed(1) + ' dVy=' + d1.y.toFixed(1));
  const d2 = boostFrom(new THREE.Vector3(0, 1, 0.5), new THREE.Vector3(1, 0, 0));
  check('slow release boost goes where the camera looks', d2.x > 2 && Math.abs(d2.z) < d2.x * 0.3, 'dVx=' + d2.x.toFixed(1) + ' dVz=' + d2.z.toFixed(1));
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
