/* JS snippet for shoot.js --js: put the camera 6 m off the nearest road vehicle of the hero, looking at it, low and from the front-left */
(() => {
  const g = TL.game, p = g.hero.ctrl.pos; let best = null, bd = 1e9;
  for (const v of g.traffic.vehicles) { if (!v.active || (v.type !== 'car' && v.type !== 'taxi' && v.type !== 'police')) continue; const d = v.pos.distanceTo(p); if (d < bd && d > 3) { bd = d; best = v; } }
  if (!best) return 'no vehicle';
  const c = best.pos, yaw = best.yaw || 0, fx = Math.sin(yaw), fz = Math.cos(yaw);
  BENCH.pose = { cam: [c.x + fx * 4.5 - fz * 3.5, c.y + 1.3, c.z + fz * 4.5 + fx * 3.5], at: [c.x, c.y + 0.7, c.z], fov: 55 };
  return best.type + ' @ ' + c.x.toFixed(0) + ',' + c.z.toFixed(0);
})()
