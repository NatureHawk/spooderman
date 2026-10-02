// Autopilot for browser tests: drives only player inputs (move, sprint, jump, E when the launch marker shows, swing, camera aim) through the real game loop.
// Autopilot for the real game loop (used by city.js scripts). Drives only the player's inputs:
// move direction, sprint (Shift on ground), jump, E (point launch / zip), swing hold, camera aim.
window.BOT = {
  start(plan, opts) { const h = G.g.hero.ctrl; this.S = { plan, opts: opts || {}, i: 0, t: 0, phase: 'go', zipT: 0, jumpCool: 0, lastState: h.state, lastKind: null, lastLand: h.landing ? h.landing.id : 0, stuck: 0, lastP: h.pos.clone(), log: [], trace: [] }; },
  tick(secs) { const S = this.S, stopAt = S.t + secs; const r = this.run(S.plan, Object.assign({}, S.opts, { maxT: Math.min(stopAt, S.opts.maxT || 90), resume: S })); return r; },
  run(plan, opts) {
    opts = opts || {};
    const g = G.g, h = g.hero.ctrl, R = opts.resume || { i: 0, t: 0, phase: 'go', zipT: 0, jumpCool: 0, lastState: h.state, lastKind: null, lastLand: h.landing ? h.landing.id : 0, stuck: 0, lastP: h.pos.clone(), log: [], trace: [] };
    let { i, t, phase, zipT, jumpCool, lastState, lastKind, lastLand, stuck, lastP } = R; const log = R.log, trace = R.trace;
    const DTS = [1 / 30, 1 / 144, 1 / 60, 1 / 90, 1 / 45]; let dk = 0; const dtOf = () => opts.dt === 'var' ? DTS[dk++ % DTS.length] : (opts.dt || 1 / 60); let dt = dtOf(); const maxT = opts.maxT || 60;
    const aim = (p) => { const d = new THREE.Vector3(p.x - g.camera.position.x, p.y - g.camera.position.y, p.z - g.camera.position.z); g.rig.yaw = Math.atan2(-d.x, -d.z); g.rig.pitch = TL.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -1.3, 1.0); g.rig.idleT = 0; };
    while (t < maxT && (opts.follow || i < plan.length)) {
      if (opts.follow) {
        // follow the route's own next marker like a player (loops back after a miss)
        const A = g.routes.active; if (!A || A.phase !== 'run') break;
        const c = A.def.cps[A.k]; plan = [Object.assign({ x: c.x, z: c.z, y: c.y, r: 0.5 }, opts.follow === 'swing' ? { swing: true } : {})]; i = 0;
        if (opts.prefix && A.k < opts.prefix.length && opts.prefix[A.k]) plan = [opts.prefix[A.k]];
      }
      const w = plan[i], P = h.pos;
      const dx = w.x - P.x, dz = w.z - P.z, dxz = Math.hypot(dx, dz);
      const it = { sprint: !!w.sprint || opts.sprint, swing: false };
      G.moveWorld = dxz > 0.3 ? new THREE.Vector3(dx / dxz, 0, dz / dxz) : new THREE.Vector3();
      if (w.swing) {
        // swing toward the waypoint: fire on the fall, release (with a jump) on the rise past the anchor
        const yaw = Math.atan2(dx, dz); g.rig.yaw = yaw + Math.PI; g.rig.pitch = TL.clamp(-0.12 + (P.y - (w.y || P.y)) * 0.01, -0.5, 0.3); g.rig.idleT = 0;
        const lat = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(dxz, 1);
        it.moveLocal = { x: 0, y: 1 }; G.moveWorld = new THREE.Vector3(dx / dxz, 0, dz / dxz);
        const r = h.tether.main, S = TL.TS;
        if (h.state === S.GROUND || h.state === S.PERCH || h.state === S.WALL || h.state === S.CRAWL) { if (jumpCool <= 0) { G.edge = { jump: true }; jumpCool = 0.5; } }
        else if (h.state === S.SWING && r.attached) {
          const pv = r.pivot(), hv = Math.hypot(h.vel.x, h.vel.z) || 1, past = ((P.x - pv.x) * h.vel.x + (P.z - pv.z) * h.vel.z) / hv;
          it.swing = true;
          const low = w.y !== undefined && P.y < w.y - 4;
          if (h.vel.y > (low ? 6 : 2) && past > r.L * (low ? 0.45 : 0.3)) { it.swing = false; G.edge = { jump: true }; }
        } else if (h.state === S.AIR || h.state === S.DIVE) {
          const falling = h.vel.y < (w.y !== undefined && P.y < w.y ? 4 : 1);
          const high = w.y !== undefined && P.y > w.y + 7;
          it.dive = high && h.vel.y < 0;                        // drop toward a low gate before firing
          if (!r.active && falling && !high && phase !== 'fired') { G.edge = { swingPressed: true }; it.swing = true; phase = 'fired'; }
          else if (r.active) it.swing = true;
          if (!r.active && h.vel.y > 2) phase = 'go';
        }
        if (h.state !== S.SWING && !r.active && phase === 'fired' && h.vel.y < -1) phase = 'go';
        if (dxz < (w.r || 8)) { i++; phase = 'go'; }
      } else if (w.zip) {
        // point launch: get airborne, aim at the ledge, press E; jump on arrival for the boosted launch
        if (phase === 'go') { if (h.state === TL.TS.GROUND || h.state === TL.TS.PERCH) { G.edge = { jump: true }; } phase = 'air'; zipT = 0; }
        else if (phase === 'air') { zipT += dt; aim(w.zip); if (zipT > 0.18 && h.state !== TL.TS.LAUNCH && g._lt) { G.edge = { tether: true }; } if (h.state === TL.TS.LAUNCH) phase = 'zip'; if (zipT > 2.5) { log.push('zip failed (no target)'); i++; phase = 'go'; } }
        else if (phase === 'zip') {
          aim(w.zip); G.moveWorld = new THREE.Vector3();
          if (!w.perch && h.launch && (h.launch.window || h.launch.arrived)) { G.edge = { jump: true }; it.jumpHeld = true; }
          if (h.state === TL.TS.AIR) { phase = w.trick ? 'trick' : 'go'; zipT = 0; if (!w.trick) i++; }
          else if (!w.perch && (h.state === TL.TS.PERCH || h.state === TL.TS.GROUND)) { phase = 'go'; log.push(t.toFixed(2) + ' (bot: zip ended on a ledge, re-launching)'); }
          if (w.perch && h.state === TL.TS.PERCH) {
            const off = Math.hypot(P.x - w.zip.x, P.z - w.zip.z, P.y - TL.C.FEET - w.zip.y);
            if (off < 4) { phase = 'go'; i++; } else { phase = 'go'; log.push(t.toFixed(2) + ' (bot: wrong ledge, re-aiming)'); }
          }
        }
        else if (phase === 'trick') { zipT += dt; if (zipT > 0.15 && !g.hero.anim.trick) { g.combat.trick(Object.assign({}, g.input.intent, { moveLocal: { x: 0, y: 1 } })); log.push(t.toFixed(2) + ' TRICK'); phase = 'go'; i++; } }
      } else if (dxz < (w.r || 1.6) && (w.y === undefined || Math.abs(P.y - TL.C.FEET - w.y) < 2.5)) { i++; continue; }
      if (w.jumpAt && phase === 'go' && h.state === TL.TS.GROUND && dxz < w.jumpAt && jumpCool <= 0) { G.edge = { jump: true }; jumpCool = 0.6; }
      jumpCool -= dt;
      G.setIntent(Object.assign(it, { jumpHeld: !!it.jumpHeld }));
      G.frame(dt); t += dt; dt = dtOf();
      if (h.state !== lastState) { log.push(t.toFixed(2) + ' ' + lastState + '>' + h.state + ' ' + (h.fsm.log[h.fsm.log.length - 1] || {}).reason); lastState = h.state; }
      if (h.action && h.action.plan.kind !== lastKind) { lastKind = h.action.plan.kind; log.push(t.toFixed(2) + ' MOVE ' + lastKind); } else if (!h.action) lastKind = null;
      if (h.landing && h.landing.id !== lastLand) { lastLand = h.landing.id; log.push(t.toFixed(2) + ' LAND ' + h.landing.kind + ' ' + h.landing.impact.toFixed(1) + ' from=' + h.landing.from + ' air=' + (h.landing.airTime || 0).toFixed(3) + ' fsm=' + h.fsm.log.slice(-3).map((e) => e.from + '>' + e.to + ':' + e.reason).join(',')); }
      trace.push([+t.toFixed(3), +P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(2), h.state]);
      if (P.distanceTo(lastP) < 0.02 && h.state === TL.TS.GROUND) stuck += dt; else stuck = 0; lastP.copy(P);
      if (stuck > 0.5 && jumpCool <= 0) { G.edge = { jump: true }; jumpCool = 0.8; log.push(t.toFixed(2) + ' (bot jumps: blocked)'); }
      if (stuck > 3) { log.push(t.toFixed(2) + ' STUCK at wp ' + i); stuck = 99; break; }
      if (opts.onFrame) opts.onFrame(t, i);
    }
    Object.assign(R, { i, t, phase, zipT, jumpCool, lastState, lastKind, lastLand, stuck, lastP });
    return { done: opts.follow ? !!(g.routes.active && g.routes.active.phase === 'done') : i >= plan.length, i, t: +t.toFixed(2), log, trace, stuck: stuck > 3 };
  },
};
