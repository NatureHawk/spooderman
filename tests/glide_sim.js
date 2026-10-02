/* Glide trajectory printout (Node): node tests/glide_sim.js [speed] [vy] [hero] */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const HARN = process.env.TL_HARNESS || path.join(process.env.LOCALAPPDATA || '', 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE = require(path.join(HARN, 'node_modules/three/build/three.cjs'));
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['00_core.js', '02_collision.js', '04_physics.js', '04b_contact.js']) vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
TL.V.init();
const W = new TL.CollisionWorld(); W.groundFn = () => 0; W.waterFn = () => false;
const h = new TL.HeroController(W, TL.HERO_STATS[process.argv[4] || 'PULSE']); h.wind = new TL.WindField(); h.wind.base.set(0, 0, 0);
const it = (o) => Object.assign({ move: new THREE.Vector3(), moveLocal: { x: 0, y: 0 }, camFwd: new THREE.Vector3(0, 0, 1), camRight: new THREE.Vector3(-1, 0, 0), jump: false, jumpHeld: false, swing: false, swingPressed: false, dive: false, glideToggle: false, sling: false, slingPressed: false, reelIn: 0, reelOut: 0, tether: false, launchTarget: null, sprint: false }, o || {});
h.teleport(0, 400, 0); h.vel.set(0, +(process.argv[3] || 2), +(process.argv[2] || 26)); h.fsm.set(TL.TS.AIR);
// one tick in the air, then toggle the glide exactly as the game does
h.step(1 / 120, it());
h.step(1 / 120, it({ glideToggle: true }));
const y0 = h.pos.y; let t = 0, out = [];
for (let i = 0; i < 120 * 14; i++) {
  h.step(1 / 120, it()); t += 1 / 120;
  if (i % 60 === 0) out.push(`${t.toFixed(1)}s state=${h.state} spd=${h.vel.length().toFixed(1)} hs=${Math.hypot(h.vel.x, h.vel.z).toFixed(1)} vy=${h.vel.y.toFixed(1)} dy=${(h.pos.y - y0).toFixed(1)} pitch=${h.glide.pitch.toFixed(2)} aoa=${(h.glide.aoa || 0).toFixed(2)}`);
}
console.log(out.join('\n'));
