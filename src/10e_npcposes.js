/* =====================================================================================
   NPC POSES — extra pedestrian animation modes layered on TL.NPCAnimator without touching 06_anim.js.
   A mode names a base pose of the animator (walk / idle / sit) plus an arm / torso override applied just before the rig
   solves, so gait phase, springs and root placement stay the animator's own.
     walkphone walkeat   walking with a phone at the ear / food at the mouth
     film point order serve   filming the hero, pointing up, ordering at a cart, serving from a cart
     sit sitphone siteat sitread sitrelax   seated on a bench or a step
     sitground           on the lawn (hips on the grass, legs out, hands behind)
   Model space: +Z forward, +Y up, +X the character's left (right arm = -X).
   ===================================================================================== */
'use strict';

TL.NPC_PHONE_MODES = new Set(['phone', 'photo', 'film', 'walkphone', 'sitphone']);

TL.NPCPoses = (function () {
  const D = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
  const P = {};
  P.walkphone = { base: 'walk', f(r, t) {
    r.set('uarmR', D(-0.38, -0.6, 0.38)); r.set('farmR', D(0.6, 0.95, 0.12)); r.set('head', D(0.1, 1, 0.08));
  } };
  P.walkeat = { base: 'walk', f(r, t) {
    const b = 0.5 + 0.5 * Math.sin(t * 1.6);
    r.set('uarmR', D(-0.2, -0.55, 0.6)); r.set('farmR', D(0.1, 0.35 + b * 0.8, 0.6 - b * 0.15));
  } };
  P.film = { base: 'idle', f(r, t) {
    const w = Math.sin(t * 1.3) * 0.04;
    r.set('uarmR', D(-0.3, 0.3, 0.9)); r.set('farmR', D(0.3 + w, 0.75, 0.7)); r.set('uarmL', D(0.3, 0.3, 0.9)); r.set('farmL', D(-0.3 - w, 0.75, 0.7));
    r.set('head', D(0, 1, 0.08));
  } };
  P.point = { base: 'idle', f(r, t) {
    const w = Math.sin(t * 5) * 0.03;
    r.set('uarmR', D(-0.45, 0.78 + w, 0.55)); r.set('farmR', D(-0.4, 0.85, 0.5)); r.set('head', D(0, 1, -0.45));
    r.set('chest', D(0.05, 1, -0.12)); r.set('uarmL', D(0.2, -1, 0.05));
  } };
  P.order = { base: 'idle', f(r, t) {
    const w = Math.sin(t * 2.2) * 0.12;
    r.set('spine', D(0, 1, 0.22)); r.set('chest', D(0, 1, 0.3));
    r.set('uarmR', D(-0.25, -0.15, 0.95)); r.set('farmR', D(0.05 + w, 0.1, 1)); r.set('uarmL', D(0.25, -0.9, 0.2)); r.set('head', D(0, 1, 0.12));
  } };
  P.serve = { base: 'idle', f(r, t) {
    const a = Math.sin(t * 2.6), b = Math.sin(t * 2.6 + 2.2);
    r.set('spine', D(0, 1, 0.2)); r.set('chest', D(0, 1, 0.26));
    r.set('uarmR', D(-0.32, -0.55, 0.72)); r.set('farmR', D(0.05 + a * 0.18, -0.15 + b * 0.1, 1));
    r.set('uarmL', D(0.32, -0.5, 0.74)); r.set('farmL', D(-0.05 - b * 0.18, -0.12 + a * 0.1, 1)); r.set('head', D(0, 1, 0.1));
  } };
  P.sit = { base: 'sit', f(r, t) {
    r.set('uarmL', D(0.18, -0.75, 0.45)); r.set('farmL', D(-0.1, -0.25, 1)); r.set('uarmR', D(-0.18, -0.75, 0.45)); r.set('farmR', D(0.1, -0.25, 1));
    r.set('head', D(Math.sin(t * 0.3) * 0.12, 1, 0.04));
  } };
  P.sitphone = { base: 'sit', f(r, t) {
    r.set('spine', D(0, 1, 0.22)); r.set('chest', D(0, 1, 0.34)); r.set('head', D(0, 0.8, 0.6));
    r.set('uarmR', D(-0.25, -0.5, 0.75)); r.set('farmR', D(0.2, 0.55, 0.85)); r.set('uarmL', D(0.18, -0.75, 0.45)); r.set('farmL', D(-0.1, -0.25, 1));
  } };
  P.siteat = { base: 'sit', f(r, t) {
    const b = 0.5 + 0.5 * Math.sin(t * 1.3);
    r.set('spine', D(0, 1, 0.1)); r.set('uarmR', D(-0.2, -0.5, 0.65)); r.set('farmR', D(0.1, 0.3 + b * 0.85, 0.6 - b * 0.2));
    r.set('uarmL', D(0.18, -0.75, 0.45)); r.set('farmL', D(-0.1, -0.25, 1));
  } };
  P.sitread = { base: 'sit', f(r, t) {
    r.set('spine', D(0, 1, 0.16)); r.set('chest', D(0, 1, 0.24)); r.set('head', D(0, 0.85, 0.55));
    r.set('uarmR', D(-0.22, -0.65, 0.6)); r.set('farmR', D(0.3, 0.1, 1)); r.set('uarmL', D(0.22, -0.65, 0.6)); r.set('farmL', D(-0.3, 0.1, 1));
  } };
  P.sitrelax = { base: 'sit', f(r, t) {
    r.set('spine', D(0, 1, -0.1)); r.set('chest', D(0, 1, -0.16)); r.set('head', D(0.05 * Math.sin(t * 0.4), 1, -0.08));
    r.set('uarmR', D(-0.95, -0.15, -0.35)); r.set('farmR', D(-0.9, 0.05, -0.45)); r.set('uarmL', D(0.18, -0.8, 0.4)); r.set('farmL', D(-0.2, -0.3, 1));
    r.set('shinL', D(0.25, -1, 0.5));
  } };
  P.sitground = { base: 'sit', f(r, t) {
    r.hipsOffT.set(0, -0.84, 0);
    r.set('spine', D(0, 1, -0.2)); r.set('chest', D(0, 1, -0.26)); r.set('head', D(0.04 * Math.sin(t * 0.4), 1, 0.0));
    r.set('thighL', D(0.22, -0.04, 1)); r.set('thighR', D(-0.22, -0.04, 1)); r.set('shinL', D(0.1, -0.3, 1)); r.set('shinR', D(-0.1, -0.3, 1));
    r.set('uarmL', D(0.55, -0.8, -0.35)); r.set('farmL', D(0.35, -1, -0.15)); r.set('uarmR', D(-0.55, -0.8, -0.35)); r.set('farmR', D(-0.35, -1, -0.15));
  } };

  if (TL.NPCAnimator) {
    const base = TL.NPCAnimator.prototype.update;
    TL.NPCAnimator.prototype.update = function (dt, pos, yaw, speed, mode, extra) {
      const pose = P[mode];
      if (!pose) return base.call(this, dt, pos, yaw, speed, mode, extra);
      const rig = this.rig, proto = Object.getPrototypeOf(rig).apply, t = this.t;
      rig.apply = function (d) { delete rig.apply; pose.f(rig, t); proto.call(rig, d); };       // runs once, inside the base update, before the solve
      try { base.call(this, dt, pos, yaw, speed, pose.base, extra); } finally { if (Object.prototype.hasOwnProperty.call(rig, 'apply')) delete rig.apply; }
    };
  }
  return P;
})();
