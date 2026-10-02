/* =====================================================================================
   CameraRig — third-person orbit camera: mouse/stick look, collision avoidance (spherecast-ish ray),
   velocity look-ahead, speed FOV, subtle bank roll, auto-follow/recentering, wall orientation,
   combat framing, shake (settings-scaled), photo-mode free/orbit camera. Never flips (pitch clamped,
   yaw continuous, smoothed).
   ===================================================================================== */
'use strict';

/* One presentation signal. Never writes velocity, rope length or arm deployment. */
TL.MotionFeedback = class {
  constructor(game){this.game=game;this.speed=0;this.accel=0;this.energy=0;this.near=0;this.load=0;this.t=0;this.sampleT=0;this.cool=0;this.surface=null;this.clearT=0;this.previous=null;}
  update(dt){
    const g=this.game,h=g.hero.ctrl;if(dt<=0)return;this.t+=dt;
    const raw=h.vel.length(),jump=this.previous&&this.previous.distanceTo(h.pos)>Math.max(15,raw*dt*3);
    const derivative=jump||!this.previous?0:(raw-this.speed)/Math.max(dt,.001);
    this.accel=TL.damp(this.accel,TL.clamp(derivative/90,-1,1),4,dt);
    this.speed=TL.damp(this.speed,raw,8,dt);this.previous=h.pos.clone();
    const rope=h.tether.main,oldLoad=this.load;this.load=TL.damp(this.load,rope&&rope.attached?TL.clamp(rope.tension/100,0,1):0,9,dt);
    if(oldLoad<.65&&this.load>=.65&&raw>20&&this.t>(this.catchUntil||0)){g.rig.shake?.(.065,.12);this.catchUntil=this.t+1.5;}
    this.sampleT-=dt;this.cool-=dt;
    if(this.sampleT<=0){this.sampleT=.08;let nearest=null,dist=5.5,normal=null;
      const list=g.world.query(h.pos.x-6,h.pos.z-6,h.pos.x+6,h.pos.z+6,[]);
      for(const c of list){if(!c.solid)continue;const p=g.world.closest(c,h.pos.x,h.pos.y,h.pos.z,new THREE.Vector3()),d=p.distanceTo(h.pos);
        if(d<dist&&d>.1){dist=d;nearest=c;normal=p.sub(h.pos).normalize();}}
      this.near=TL.clamp(1-dist/5.5,0,1);
      const rel=nearest?h.vel.clone().sub(nearest.pointVel(h.pos.x,h.pos.z,new THREE.Vector3())):h.vel;
      const tangent=normal?Math.sqrt(Math.max(0,rel.lengthSq()-rel.dot(normal)**2)):0;
      if(dist<2.5&&tangent>23&&nearest&&this.surface!==nearest.id&&this.cool<=0&&h.state!==TL.TS.GROUND&&h.state!==TL.TS.PERCH){
        this.surface=nearest.id;this.cool=1.4;this.clearT=0;
        const pan=normal.dot(g.rig.right);g.audio.sfx('nearmiss',this.energy,{pan});
        g.cityLife.emit('pass',h.pos,Math.min(1,raw/45));
      }
      if(dist>4){this.clearT+=.08;if(this.clearT>.6)this.surface=null;}else this.clearT=0;
    }
    const moving=![TL.TS.PERCH,TL.TS.CRAWL,TL.TS.CEIL].includes(h.state);
    const target=moving?TL.clamp((this.speed-7)/55,0,1)*(1+this.near*.12+Math.max(0,this.accel)*.08+this.load*.04):0;
    this.energy=TL.damp(this.energy,TL.clamp(target,0,1),target>this.energy?4:5,dt);h.feedback=this;
  }
};

TL.CameraRig = class {
  constructor(camera, world) {
    this.cam = camera; this.world = world;
    this.yaw = 0; this.pitch = -0.18;
    this.dist = 5.2; this.curDist = 5.2;
    this.target = new THREE.Vector3(); this.smoothT = new THREE.Vector3();
    this.lookAhead = new THREE.Vector3();
    this.fov = 68; this.roll = 0;
    this.shakeT = 0; this.shakeAmp = 0;
    this.launchKick = 0;
    this.combatFocus = null;
    this.settings = null;
    this.mode = 'follow';      // follow | photo | overview
    this.photo = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 60, roll: 0, orbit: true, dist: 6 };
    this.idleT = 0;
    this._hit = {}; this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1); this.right = new THREE.Vector3(-1, 0, 0);
    this.overview = null;
    this.glideLat = 0; this.glideDist = 0; this.prevSpeed = 0; this.accel = 0; this.windT = 0;
  }
  look(dx, dy) {
    if(!dx&&!dy)return;
    const s = this.settings || TL.defaultSettings();
    dx = TL.clamp(dx, -400, 400); dy = TL.clamp(dy, -400, 400);
    this.yaw -= dx * 0.0022 * s.sensitivity;
    this.pitch -= dy * 0.0022 * s.sensitivity * (s.invertY ? -1 : 1);
    this.pitch = TL.clamp(this.pitch, -1.35, 1.1);
    this.idleT = 0;
  }
  shake(amount, dur) {
    const s = this.settings || TL.defaultSettings();
    if (s.reducedMotion) amount *= 0.3;
    this.shakeAmp = Math.max(this.shakeAmp, amount * s.shake); this.shakeT = Math.max(this.shakeT, dur || 0.3);
  }
  kickLaunch(perfect) { this.launchKick = perfect ? 1 : .75; this.shake(.24,.16); }
  kickCatch(k) { const s = this.settings || TL.defaultSettings(); this.catchKick = Math.max(this.catchKick || 0, TL.clamp(k, 0, 0.6) * (s.reducedMotion ? 0.3 : 1)); }
  /* hero: {pos (interpolated), vel, state, facing, wallN}. dt: real frame time */
  update(dt, hero) {
    const s = this.settings || TL.defaultSettings();
    if (this.mode === 'overview' && this.overview) return this.updateOverview(dt);
    if (this.mode === 'photo') return this.updatePhoto(dt, hero);
    const V = hero.vel, speed = V.length();
    const st = hero.state, S = TL.TS;
    const feedback=hero.feedback,energy=feedback?feedback.energy:TL.clamp((speed-7)/55,0,1);
    this.launchKick *= Math.exp(-4*dt);
    const launchFx=s.reducedMotion?0:this.launchKick;
    this.idleT += dt;
    // auto-follow: gently recentre behind travel direction when the player isn't looking around
    const hs = Math.hypot(V.x, V.z);
    const gl = st === S.GLIDE;
    if (gl && hs > 4 && this.idleT > 0.35 && s.autoFollow>0) {      // gliding: the camera swings round with the heading (with a lag, so the hero drifts off-centre in turns)
      const tYaw = Math.atan2(-V.x, -V.z);
      this.yaw = TL.dampAngle(this.yaw, tYaw, 1.7, dt);
      this.pitch = TL.damp(this.pitch, TL.clamp(-0.2 + Math.atan2(V.y,Math.max(hs,1))*.35, -0.55, 0.15), 0.9*s.autoFollow, dt);
    } else if (s.autoFollow > 0 && this.idleT > 0.8 && hs > 6 && st !== S.WALL && st !== S.CRAWL && st !== S.CEIL) {
      const tYaw = Math.atan2(-V.x, -V.z);
      this.yaw = TL.dampAngle(this.yaw, tYaw, 0.8 * s.autoFollow * TL.clamp(hs / 25, 0.3, 1.5), dt);
      const tPitch = TL.clamp(-0.12 + Math.atan2(V.y,Math.max(hs,1)) * (st===S.DIVE?.62:.35), -.95, .3);
      this.pitch = TL.damp(this.pitch, tPitch, 0.6 * s.autoFollow, dt);
    }
    // distance by state and speed
    let want = 5.2;
    if (st === S.SWING) want = 6.5 + energy * 2.1 * s.swingCam;
    else if (st === S.GLIDE || st === S.DIVE) {
      // detached chase camera: sits further back the faster you go, drops back when accelerating (diving) and closes in when slowing
      this.accel = TL.damp(this.accel, (speed - this.prevSpeed) / Math.max(dt, 1e-3), 3, dt);
      want = 7.5 + energy * 3.0 * s.swingCam;
    }
    else if (st === S.WALL || st === S.CRAWL || st === S.CEIL) want = 5.8;
    else if (st === S.GROUND && hs < 1) want = 4.4;
    if (this.combatFocus) want = 7.5;
    if(st===S.LAUNCH&&hero.launch&&hero.launch.arrived&&!s.reducedMotion)want=4.6;
    if(!s.reducedMotion&&hero.reference?.action&&['air_zip','spider_dash','spider_jump'].includes(hero.reference.action.kind))want+=.8*s.swingCam;
    want+=launchFx*1.8;
    this.catchKick = (this.catchKick || 0) * Math.exp(-5 * dt); want += this.catchKick * 0.9;   // the boom gives a little as the line bites
    this.prevSpeed = speed;
    this.dist = TL.damp(this.dist, want, st === S.GLIDE || st === S.DIVE ? 1.3 : 2.5, dt);
    // target = hero + shoulder offset + velocity look-ahead (smoothed)
    this.lookAhead.set(V.x, V.y * (st===S.DIVE?.65:.35), V.z).multiplyScalar((st===S.SWING?.045:.06) * s.swingCam);
    if (this.lookAhead.length() > 4) this.lookAhead.setLength(4);
    this.target.copy(hero.pos).add(this.lookAhead); this.target.y += 0.9;
    // glide: the hero slides off-centre toward the turn (target shifts the other way); returns to centre when flying straight
    this.glideLat = TL.damp(this.glideLat, gl && !s.reducedMotion ? -(hero.glide ? hero.glide.roll : 0) * 2.6 : 0, 2.2, dt);
    if (Math.abs(this.glideLat) > 1e-3) this.target.addScaledVector(this.right, this.glideLat);
    if (this.combatFocus) this.target.lerp(this.combatFocus, 0.25);
    const lam = st === S.SWING || st === S.GLIDE ? 9 : 14;
    this.smoothT.x = TL.damp(this.smoothT.x, this.target.x, lam, dt);
    this.smoothT.y = TL.damp(this.smoothT.y, this.target.y, lam * 0.7, dt);
    this.smoothT.z = TL.damp(this.smoothT.z, this.target.z, lam, dt);
    if (this.smoothT.distanceTo(this.target) > 25) this.smoothT.copy(this.target);
    // desired camera position on the orbit
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = this._v.set(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp);   // from target to camera
    // collision avoidance: pull the camera in front of geometry between target and camera
    const h = this.world.raycast(this.smoothT.x, this.smoothT.y, this.smoothT.z, dir.x, dir.y, dir.z, this.dist + 0.4, (c) => c.solid && c.kind !== 'prop', this._hit);
    let d = this.dist;
    if (h) d = Math.max(0.05, h.t - 0.4);
    this.curDist = d < this.curDist ? d : TL.damp(this.curDist, d, 4, dt);
    const pos = this._v2.copy(this.smoothT).addScaledVector(dir, this.curDist);
    const gy = this.world.ground(pos.x, pos.z);
    if (pos.y < gy + 0.4) pos.y = gy + 0.4;
    // The smoothed look target can cross a corner before the body does. Check
    // the final camera path from the actual shoulder too, including its radius.
    const shoulder=hero.pos.clone().add(new THREE.Vector3(0,.65,0)),path=pos.clone().sub(shoulder),length=path.length();
    if(length>.05){path.divideScalar(length);let safe=length;
      for(const off of [[0,0],[.2,0],[-.2,0],[0,.2],[0,-.2]]){
        const hit=this.world.raycast(shoulder.x+off[0],shoulder.y+off[1],shoulder.z,path.x,path.y,path.z,length+.25,c=>c.solid&&c.kind!=='prop',{}, {noGround:true});
        if(hit)safe=Math.min(safe,Math.max(.05,hit.t-.3));
      }
      if(safe<length)pos.copy(shoulder).addScaledVector(path,safe);
    }
    this.cam.position.copy(pos);
    this.cam.lookAt(this.smoothT);
    // speed FOV and subtle bank roll (both scaled by settings, reduced motion respected)
    const fovE = s.reducedMotion ? 0 : s.fovEffect;
    const wantFov = s.baseFov + (energy*12+launchFx*6) * fovE;
    this.fov = TL.damp(this.fov, wantFov, launchFx>.1?12:3, dt);
    let wantRoll = 0;
    if ((st === S.SWING || st === S.GLIDE) && !s.reducedMotion) {
      const lat = V.x * Math.cos(this.yaw) - V.z * Math.sin(this.yaw);
      wantRoll = TL.clamp(-lat * 0.0015, -0.035, 0.035) * s.swingCam;
      if (st === S.GLIDE) wantRoll = -hero.glide.roll * 0.08;
    }
    this.roll = TL.damp(this.roll, wantRoll, 3, dt);
    this.cam.rotateZ(this.roll);
    // shake
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 3;
      this.cam.rotateX((Math.random() - 0.5) * a * 0.05); this.cam.rotateY((Math.random() - 0.5) * a * 0.05);
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    if (this.cam.fov !== this.fov) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
    this.updateBasis();
  }
  updateBasis() {
    this.cam.getWorldDirection(this.fwd);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // movement basis: forward along the horizontal view direction
    this.moveFwd = this.moveFwd || new THREE.Vector3();
    this.moveFwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  /* hero switch: rise to an overview, fly across the city, descend to the other hero (~3 s) */
  startOverview(from, to, onArrive) {
    this.mode = 'overview';
    this.overview = { t: 0, t0: TL.now(), dur: 3.0, a: this.cam.position.clone(), from: from.clone(), to: to.clone(), onArrive, done: false };
  }
  updateOverview(dt) {
    const o = this.overview; o.t = (TL.now() - o.t0) / 1000;      // wall-clock: ~3 s regardless of frame rate
    const u = TL.clamp(o.t / o.dur, 0, 1);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const alt = 180;
    const mid = new THREE.Vector3().lerpVectors(o.from, o.to, e);
    const hgt = Math.sin(u * Math.PI) * alt;
    const pos = mid.clone().add(new THREE.Vector3(0, hgt + 6, 0));
    if (u < 0.15) pos.lerpVectors(o.a, pos, u / 0.15);
    this.cam.position.copy(pos);
    const look = new THREE.Vector3().lerpVectors(o.from, o.to, Math.min(1, e + 0.15));
    this.cam.lookAt(look);
    if (u >= 1 && !o.done) { o.done = true; this.mode = 'follow'; this.smoothT.copy(o.to); if (o.onArrive) o.onArrive(); }
    this.updateBasis();
  }
  enterPhoto(hero) {
    this.mode = 'photo';
    const p = this.photo; p.pos.copy(this.cam.position); p.yaw = this.yaw; p.pitch = this.pitch; p.fov = this.cam.fov; p.roll = 0; p.center = hero.pos.clone();
  }
  updatePhoto(dt, hero) {
    const p = this.photo;
    if (p.orbit) {
      const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
      this.cam.position.set(p.center.x + Math.sin(p.yaw) * cp * p.dist, p.center.y + 1 - sp * p.dist, p.center.z + Math.cos(p.yaw) * cp * p.dist);
      this.cam.lookAt(p.center.x, p.center.y + 1, p.center.z);
    } else {
      this.cam.position.copy(p.pos);
      this.cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    }
    this.cam.rotateZ(p.roll);
    if (this.cam.fov !== p.fov) { this.cam.fov = p.fov; this.cam.updateProjectionMatrix(); }
    this.updateBasis();
  }
};
