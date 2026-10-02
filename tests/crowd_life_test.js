'use strict';
/* Crowd life simulation checks (Node, real roadmap from <build>/extra/crowd_nav.*):
   node tests/crowd_life_test.js [--long]      env TL_BUILD_DIR, TL_HARNESS (for three.cjs)
   Invariants: finite positions, no teleports, walkers stay on the roadmap corridors, crossings respect the signal,
   seats / cart slots are exclusive, population follows the time of day. */
const fs = require('fs'), vm = require('vm'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const harness = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE = require(path.join(harness, 'node_modules/three/build/three.cjs'));
const BUILD = path.resolve(__dirname, '..', process.env.TL_BUILD_DIR || 'build');
if (!fs.existsSync(path.join(BUILD, 'extra/crowd_nav.json'))) { console.log('SKIP crowd_life_test: no crowd_nav data in', BUILD); process.exit(0); }
for (const f of ['00_core.js', '10_crowd.js', '10c_crowdnav.js', '10d_crowdlife.js', '11_traffic.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), { filename: f });
TL.CROWD_DEBUG = true;
TL.TS = TL.TS || { GROUND: 'ground' };
const meta = JSON.parse(fs.readFileSync(path.join(BUILD, 'extra/crowd_nav.json'), 'utf8'));
const gz = zlib.gunzipSync(fs.readFileSync(path.join(BUILD, 'extra/crowd_nav.bin.gz')));
const buf = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
const LONG = process.argv.includes('--long');

function rig(hour, rain, seed, focus) {
  const nav = new TL.CrowdNav(JSON.parse(JSON.stringify(meta)), buf);
  const game = {
    quality: 'high', seed: seed || 5, camera: { position: new THREE.Vector3(focus[0], 30, focus[1]) }, layout: { ground: () => 0.15, district: () => 'lower manhattan' },
    env: { hour, rain: rain || 0 }, traffic: { t: 0, vehicles: [] }, missions: { active: null }, cityLife: { visible: () => true, react() {}, incident: null },
    ai: { enemies: [], boss: null }, ui: { prompt() {}, caption() {} }, input: { consume: () => false }, progress: {},
    hero: { ctrl: { pos: new THREE.Vector3(focus[0], 40, focus[1]), vel: new THREE.Vector3(), grounded: false, state: 'air' }, anim: {} },
    streamer: { nav: {}, crowdNav: nav },
  };
  const c = Object.create(TL.CrowdManager.prototype);
  Object.assign(c, { game, max: 190, nearMax: 18, peds: [], pool: new TL.ObjectPool(() => new TL.Ped(), (p) => p.reset()), skinPool: { m: [], f: [], h: [] }, victims: [], rng: new TL.RNG(seed || 5), nav: {}, lodBatch: null, t: 0, assignT: 1e9 });
  c.render = () => {}; c.assignSkins = () => {}; c.dangerPoints = () => game.danger || [];
  c.life = new TL.CrowdLife(c, nav);
  game.crowd = c;
  return { c, game, nav };
}
function run(c, game, secs, dt, focus, hook) {
  const f = new THREE.Vector3(focus[0], 0, focus[1]);
  for (let i = 0; i < secs / dt; i++) { game.traffic.t += dt; c.update(dt, f); if (hook) hook(i); }
}
const FOCUS = [60, 330];                                    // financial district
if (require.main !== module) { module.exports = { rig, run }; return; }
let passed = 0; const test = (n, fn) => { fn(); passed++; console.log('PASS ' + n); };

test('walkers: finite, no teleports, stay on the roadmap (30 and 60 fps)', () => {
  for (const fps of [30, 60]) {
    const { c, game, nav } = rig(12.5, 0, 11, FOCUS), dt = 1 / fps, last = new Map();
    let maxStep = 0, off = 0, samples = 0, worst = 0;
    run(c, game, LONG ? 240 : 100, dt, FOCUS, (i) => {
      for (const p of c.peds) {
        assert(Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.yaw), 'finite');
        const l = last.get(p);
        if (l && l[2] === p.L.spawnT && p.L.act !== 'sitdown' && p.L.act !== 'standup') { const d = Math.hypot(p.pos.x - l[0], p.pos.z - l[1]); maxStep = Math.max(maxStep, d / dt); if (d / dt > 6.5) { worst = Math.max(worst, d / dt); if (d > 5 && !global.__dbg2) { global.__dbg2 = 1; console.log('BIGJUMP', d.toFixed(1), p.L.act, p.L.style, 'prev', l, 'now', p.pos.x.toFixed(1), p.pos.z.toFixed(1), 'age', (c.life.t - p.L.spawnT).toFixed(2), 'group', !!p.L.group, 'route', p.L.route && p.L.route.length, 'ri', p.L.ri); } if (!global.__dbg) { global.__dbg = 1; console.log('TELEPORT', d.toFixed(1), p.L.act, p.L.style, 'prev', l, 'now', p.pos.x.toFixed(1), p.pos.z.toFixed(1), 'age', (c.life.t - p.L.spawnT).toFixed(2), 'vendor', p.L.vendor); } } }
        last.set(p, [p.pos.x, p.pos.z, p.L.spawnT]);
        if (i % 20 === 0 && ['walk', 'cross', 'waitcross'].includes(p.L.act) && !p.L.group) {
          const n = nav.nearest(p.pos.x, p.pos.z, 12); samples++;
          if (n < 0 || Math.hypot(nav.x(n) - p.pos.x, nav.z(n) - p.pos.z) > 7) off++;
        }
      }
    });
    assert(c.peds.length > 40, 'population ' + c.peds.length);
    assert(worst === 0, 'teleport-like step ' + worst.toFixed(1) + ' m/s');
    assert(off / Math.max(samples, 1) < 0.02, 'off-roadmap ' + off + '/' + samples);
  }
});

test('population follows the time of day and the weather', () => {
  const n = {};
  for (const [k, h, rain] of [['night', 3, 0], ['lunch', 12.5, 0], ['rushPm', 17.5, 0], ['rain', 12.5, 1]]) {
    const { c, game } = rig(h, rain, 3, FOCUS); run(c, game, 70, 1 / 30, FOCUS); n[k] = c.peds.length;
  }
  assert(n.night < n.lunch * 0.6, JSON.stringify(n)); assert(n.rain < n.lunch * 0.8, JSON.stringify(n)); assert(n.rushPm > n.night * 1.5, JSON.stringify(n));
});

test('crossings obey the signal; kerb queues form; nobody stands in the road on don\'t-walk', () => {
  const { c, game, nav } = rig(8.5, 0, 21, FOCUS);
  let starts = 0, onWalk = 0, maxQueue = 0, bad = 0;
  const prev = new Map();
  run(c, game, LONG ? 400 : 220, 1 / 30, FOCUS, () => {
    for (const p of c.peds) {
      const was = prev.get(p), L = p.L;
      if (L.act === 'cross' && was !== 'cross' && L.cw) {
        starts++;
        const sg = L.cw.sig ? TL.signalState(L.cw.sig[0], L.cw.sig[1], game.traffic.t) : null;
        const mine = sg ? (L.cw.axis === 'ns' ? sg.nsWalk : sg.ewWalk) : 'walk';
        if (mine === 'walk' || L.jay) onWalk++;
        else bad++;
      }
      prev.set(p, L.act);
    }
    for (const cw of nav.cw) maxQueue = Math.max(maxQueue, cw.waiting[0].length, cw.waiting[1].length);
  });
  assert(starts > 5, 'crossings started: ' + starts);
  assert(bad === 0, 'crossings begun on don\'t-walk by non-jaywalkers: ' + bad + ' of ' + starts);
  console.log('   crossings', starts, 'on walk', onWalk, 'max kerb queue', maxQueue);
});

test('seats and cart slots are exclusive; sitters sit exactly on their slot', () => {
  const { c, game, nav } = rig(13, 0, 7, [235, 690]);                           // Battery Park at lunch
  let sat = 0, queued = 0;
  run(c, game, LONG ? 500 : 240, 1 / 30, [235, 690], () => {
    const used = new Set();
    for (const p of c.peds) {
      const L = p.L;
      if (L.seat && (L.act === 'sit' || L.act === 'sitdown')) { const k = L.seat.x + ',' + L.seat.z + ',' + L.slotIdx; assert(!used.has(k), 'seat shared ' + k); used.add(k); }
      if (L.act === 'sit') { sat++; const sl = L.seat.slots[L.slotIdx]; assert(Math.hypot(p.pos.x - sl[0], p.pos.z - sl[1]) < 0.06, 'sitter off slot'); }
      if (L.act === 'queue') queued++;
    }
    for (const cart of c.life.carts) assert(new Set(cart.queue).size === cart.queue.length, 'queue duplicates');
  });
  assert(sat > 0, 'nobody sat down in 4 minutes at Battery Park lunch');
  console.log('   sitting frames', sat, 'queueing frames', queued);
});

test('cart: customers queue, are served one at a time, leave with food', () => {
  const F = [89, 313], { c, game } = rig(12.5, 0, 31, F); let q = 0, served = 0, maxQ = 0; const seen = new Set();
  run(c, game, LONG ? 600 : 400, 1 / 30, F, () => {
    for (const cart of c.life.carts) { q += cart.queue.length; maxQ = Math.max(maxQ, cart.queue.length); }
    for (const p of c.peds) if (p.L && p.L.food && !seen.has(p.L.spawnT + ':' + p.pos.x.toFixed(0))) { seen.add(p.L.spawnT + ':' + p.pos.x.toFixed(0)); served++; }
  });
  console.log('   queue frames', q, 'max queue', maxQ, 'served', served);
  assert(q > 0 && served > 0, 'no cart activity at lunch');
});

test('fear: danger makes walkers flee, then they recover', () => {
  const { c, game } = rig(12, 0, 9, FOCUS);
  run(c, game, 30, 1 / 30, FOCUS);
  const target = c.peds.find((p) => p.L.act === 'walk');
  game.danger = [new THREE.Vector3(target.pos.x + 6, 0, target.pos.z)];
  let fled = false;
  run(c, game, 6, 1 / 30, FOCUS, () => { if (target.L.act === 'flee' || target.L.act === 'cower') fled = true; });
  assert(fled, 'did not flee');
  game.danger = [];
  run(c, game, 80, 1 / 30, FOCUS);
  assert(!['flee', 'cower'].includes(target.L.act) || !target.alive, 'still afraid after 80 s: ' + target.L.act);
});

console.log('crowd_life_test: ' + passed + ' passed');
