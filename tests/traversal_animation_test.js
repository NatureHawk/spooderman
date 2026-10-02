'use strict';
require('./hand_swing_test.js');
const assert = require('assert'), fs = require('fs'), path = require('path');
function makeHero(name) {
  const world = new TL.CollisionWorld(); world.groundFn = () => 0;
  world.addStatic(0,30,1.2,20,30,.5,0,{kind:'building'});
  const hero = new TL.HeroController(world,TL.HERO_STATS[name]); hero.teleport(0,20,0);
  hero.wallN.set(0,0,-1); hero.singleHandSwing = true;
  const mat = TL.Assets.material(), scene = new THREE.Scene(), sk = TL.Assets.skinned(name,'mid',mat);
  scene.add(sk.mesh);
  return {hero,sk,scene,anim:new TL.HeroAnimator(sk,name,scene,mat,'high')};
}
const cam = {fwd:new THREE.Vector3(0,0,1)};
function tick(o,dt=1/60) { o.anim.update(dt,o.hero,o.hero.pos,cam); }
const names = Object.keys(TL.AerialClips);
assert(names.length >= 20);
// Exercise actual airborne moves, including entry, opening and recovery on both rigs.
for (const name of ['WEAVER','PULSE']) for (const clipName of names) {
  const o = makeHero(name), c = TL.AerialClips[clipName], h = o.hero;
  h.fsm.set(TL.TS.AIR); h.grounded=false;h.vel.set(0,6,20);
  tick(o);o.anim.playAerial(clipName);
  const pos = h.pos.clone(), vel = h.vel.clone();
  let angle=0,last=o.anim.rootQ.clone();
  for (let i=0;i<90;i++) {
    tick(o,c.duration*1.3/90);
    angle+=last.angleTo(o.anim.rootQ);last.copy(o.anim.rootQ);
    assert(o.sk.list.every(b=>b.quaternion.toArray().every(Number.isFinite)),clipName+' finite joints');
    assert(Object.values(o.anim.handWorld).every(TL.finite3),clipName+' finite wrists');
  }
  assert.equal(h.pos.distanceTo(pos),0); assert.equal(h.vel.distanceTo(vel),0);
  assert.equal(o.anim.rel,null,clipName+' completes');
  assert.equal(o.anim.motion.weight,0,clipName+' no conflicting timed leg override');
  if(c.turn.some(x=>Math.abs(x)>=1)) assert(angle>4.5,clipName+' rotates the whole body');
  o.anim.dispose(o.scene);
}
console.log('PASS 20 complete aerial moves on both rigs; whole-body rotation; physics unchanged');
for(const heroName of ['WEAVER','PULSE']) {
  for(const kind of ['flip','backflip','layout','cannonball','side_roll','side_layout']) {
    const o=makeHero(heroName);o.hero.grounded=false;o.hero.fsm.set(TL.TS.AIR);o.hero.vel.set(0,8,24);tick(o);
    o.anim.playAerial(kind);const duration=TL.AerialClips[kind].duration;
    for(let i=0;i<36;i++)tick(o,duration*.5/36);
    for(const side of ['L','R']) {
      const cur=o.anim.rig.cur,elbow=cur['uarm'+side].angleTo(cur['farm'+side]);
      if(kind.startsWith('side_'))assert(elbow<.15,kind+' straight arm through side flip');
      else {
        assert(cur['thigh'+side].y>.55,kind+' knees pulled toward chest');
        assert(cur['thigh'+side].angleTo(cur['shin'+side])>2.3,kind+' heels tucked in');
        assert(elbow>1.7,kind+' folded elbows');
      }
    }
  }
  for(const fallSpeed of [-5,-12,-25]) {
  const o=makeHero(heroName);o.hero.grounded=false;o.hero.fsm.set(TL.TS.AIR);o.hero.vel.set(0,fallSpeed,0);
  o.hero.world=new TL.CollisionWorld();o.hero.world.groundFn=()=>-200;
  for(let i=0;i<180;i++)tick(o);
  for(const side of ['L','R']) {
    const cur=o.anim.rig.cur,bend=cur['thigh'+side].angleTo(cur['shin'+side]);
    assert(bend>.8&&bend<1.35,'open-arm and fast freefall both draw the heels back');
  }
  }
}
console.log('PASS both rigs: fetal flip tuck, straight side-flip arms, softly bent freefall knees');
const idle = makeHero('WEAVER'); idle.hero.fsm.set(TL.TS.GROUND); idle.hero.vel.set(0,0,0); idle.hero.grounded=true;
for(let i=0;i<110;i++) tick(idle);
assert.equal(idle.anim.arms.fold,0,'no premature folding');
for(let i=0;i<110;i++) tick(idle);
assert(idle.anim.arms.fold>.98,'fully folded after delay');
idle.hero.vel.z=4; for(let i=0;i<20;i++) tick(idle);
assert(idle.anim.arms.fold<.1,'unfold promptly on movement');
console.log('PASS two-second idle delay, folding, movement deployment');
const wall = makeHero('WEAVER'); wall.hero.fsm.set(TL.TS.CRAWL); wall.hero.vel.set(0,0,0);
for(let i=0;i<120;i++) tick(wall);
const planted = wall.anim.arms.arms.filter(a=>a.planted);
assert(planted.length>=3,'at least three claws find actual wall contacts; got '+planted.length);
for(const a of planted) {
  assert(Math.abs(a.contact.z-.675)<.04,'contact lies on wall face');
  assert(a.world.distanceTo(a.contact)<.035,'IK reaches planted contact');
}
const contacts = planted.map(a=>a.contact.clone());
wall.hero.pos.y+=.03; tick(wall);
planted.forEach((a,i)=>assert(a.contact.distanceTo(contacts[i])<1e-8,'planted claw does not slide with body'));
wall.hero.vel.y=1;
let steps = new Set();
for(let i=0;i<180;i++) {wall.hero.pos.y+=1/60; tick(wall); wall.anim.arms.arms.forEach((a,j)=>{if(a.step)steps.add(j);});}
assert(steps.size>=3,'claws alternate steps while climbing');
console.log('PASS wall raycasts, planted IK, stable contacts and alternating climb steps');
const h=wall.hero,m=wall.anim.motion;
h.fsm.set(TL.TS.SWING); h.vel.set(0,-12,20); h.tether.main.hand='L'; tick(wall);
assert.equal(m.weight,0,'timed accents must not override swinging');
for(let i=0;i<30;i++) tick(wall);
assert.equal(m.weight,0);
h.vel.set(0,0,25); h.motionInput={x:0,y:1}; for(let i=0;i<30;i++) tick(wall);
assert.equal(m.weight,0);
h.vel.y=8;h.fsm.set(TL.TS.AIR,'release-jump'); tick(wall); assert.equal(wall.anim.rel.kind,'flip');
assert.equal(m.weight,0,'airborne squat override must be absent');
console.log('PASS restored release flip and no timed swing/freefall override');
for(const angle of [-.9,0,.3,.9]) {
  h.pos.set(0,50-20*Math.cos(angle),20*Math.sin(angle));h.vel.set(0,20*Math.sin(angle),20*Math.cos(angle));
  h.tether.main.anchor.set(0,50,0);h.tether.main.bends=[];
  const p=TL.PendulumMotion.sample(h);
  if(angle<0)assert(p.hip<-.5);
  if(angle===0)assert(p.hip>.05 && p.hip<.2 && p.knee<.25);
  if(angle>0)assert(p.hip>.75 && p.knee<.3);
  if(angle===.3)assert(p.hip>1,'leg drive is already high in the early ascent');
}
console.log('PASS pendulum legs: behind at rear, long at bottom, forward at front');

// Attachment cancels every release immediately; a travelling web has its own wrist pose.
for(const kind of names) {
  const o=makeHero('WEAVER'),h=o.hero;h.fsm.set(TL.TS.AIR);h.vel.set(0,8,22);tick(o);
  o.anim.playAerial(kind);tick(o);
  h.tether.main.anchor.set(0,40,10);h.tether.main.active=h.tether.main.attached=true;
  h.fsm.set(TL.TS.SWING);tick(o);assert.equal(o.anim.rel,null,kind+' interrupted by catch');
  assert.equal(o.anim.motion.weight,0);
}
const low=makeHero('PULSE');low.hero.pos.y=2;low.hero.vel.set(0,-8,25);
low.anim.startRelease(low.hero);assert.equal(low.anim.rel.kind,'sail','no automatic somersault close to ground');
const rotating=makeHero('WEAVER');rotating.hero.fsm.set(TL.TS.AIR);rotating.hero.vel.set(0,8,24);tick(rotating);
rotating.anim.playAerial('layout');for(let i=0;i<30;i++)tick(rotating);
assert.equal(rotating.anim.arms.mode,'packed');assert(rotating.anim.arms.compact>.95);
assert(rotating.anim.arms.arms.every(a=>a.seg1.scale.y<.65),'mechanical links retract during rotation');
console.log('PASS all catches interrupt, low releases stay open, mechanical links retract during tricks');
for(const name of ['WEAVER','PULSE'])for(const hand of ['L','R']) {
  const poses=[];
  for(const single of [true,false]) {
    const o=makeHero(name),h=o.hero,r=h.tether.main,s=hand==='L'?1:-1;
    h.grounded=false;h.singleHandSwing=single;h.fsm.set(TL.TS.SWING);h.vel.set(0,0,24);
    r.active=r.attached=true;r.hand=hand;r.anchor.set(6*s,40,0);r.L=20;r.tension=45;
    for(let i=0;i<90;i++)tick(o);
    if(single) {
      const up=new THREE.Vector3(0,1,0).applyQuaternion(o.anim.rootQ);
      assert(up.x*s>.4,'torso leans into the loaded shoulder instead of cancelling the rope angle');
      assert(o.anim.rig.hipsOff.x*s<0,'hips counterbalance the loaded shoulder');
    }
    poses.push(o.anim.rig.target.thighL.clone());
  }
  assert(poses[0].distanceTo(poses[1])<1e-8,'single-hand torso adjustment preserves the leg animation');
}
console.log('PASS both hands/rigs: shoulder lean, hip counterbalance, preserved leg targets');
for(const name of ['WEAVER','PULSE']) {
  const o=makeHero(name);o.hero.fsm.set(TL.TS.GROUND);o.hero.grounded=true;o.hero.vel.set(0,0,0);
  for(const x of [-.8,.8]) {
    const camera={fwd:new THREE.Vector3(x,0,.6)};
    for(let i=0;i<60;i++)o.anim.update(1/60,o.hero,o.hero.pos,camera);
    assert(Math.abs(o.anim.rig.cur.head.x)<.01,'idle head stays upright when camera turns');
    assert(o.anim.rig.twist.head*x>.3,'head follows camera with yaw');
  }
}
console.log('PASS idle camera tracking turns the head without sideways neck tilt');

if(process.argv.includes('--export-preview') || process.argv.includes('--export-sequence')) {
  const out=[];
  function capture(o,label) {
    const meshes=[o.sk.mesh]; if(o.anim.arms) for(const a of o.anim.arms.arms) meshes.push(a.seg1,a.seg2,a.claw);
    const result=[];
    for(const mesh of meshes.filter(Boolean)) {
      mesh.updateMatrixWorld(true); if(mesh.skeleton) mesh.skeleton.update();
      const geo=mesh.geometry,p=geo.attributes.position,v=new THREE.Vector3(),verts=[];
      for(let i=0;i<p.count;i++) { v.fromBufferAttribute(p,i);if(mesh.isSkinnedMesh)mesh.boneTransform(i,v);v.applyMatrix4(mesh.matrixWorld).sub(o.hero.pos);verts.push([v.x,v.y,v.z]); }
      const idx=geo.index?Array.from(geo.index.array):Array.from({length:p.count},(_,i)=>i);
      result.push({vertices:verts,indices:idx,mechanical:!mesh.isSkinnedMesh});
    }
    out.push({label,meshes:result});
  }
  if(process.argv.includes('--export-sequence')) {
    const o=makeHero('WEAVER'),h=o.hero,r=h.tether.main;
    h.grounded=false;h.singleHandSwing=true;h.fsm.set(TL.TS.SWING);r.active=r.attached=true;r.hand='L';r.anchor.set(0,50,0);r.L=20;
    for(let frame=0;frame<=150;frame++) {
      const angle=-.95+1.8*frame/150;
      h.pos.set(0,50-20*Math.cos(angle),20*Math.sin(angle));
      h.vel.set(0,24*Math.sin(angle),24*Math.cos(angle));
      tick(o);
      if(frame%15===0)capture(o,'swing '+angle.toFixed(2));
    }
    r.release();h.fsm.set(TL.TS.AIR,'release-jump');
    for(let frame=0;frame<72;frame++) {
      h.vel.y-=TL.C.G/60;h.pos.addScaledVector(h.vel,1/60);tick(o);
      if(frame%6===0)capture(o,'release '+(frame/60).toFixed(2));
    }
    fs.writeFileSync(path.join(__dirname,'sequence_poses.json'),JSON.stringify(out));
    console.log('Exported swing and release sequence');
    process.exit(0);
  }
  const o=makeHero('WEAVER');o.hero.fsm.set(TL.TS.GROUND);o.hero.grounded=true;
  for(let i=0;i<240;i++)tick(o);capture(o,'Idle folded');
  o.hero.grounded=false;o.hero.fsm.set(TL.TS.CRAWL);for(let i=0;i<120;i++)tick(o);capture(o,'Wall planted');
  for(const [clip,label] of [['sail','Release stride'],['pike','Pike flip'],['flip','Boost tuck'],['scissor_twist','Scissor twist']]) {
    o.hero.fsm.set(TL.TS.AIR);o.hero.vel.set(0,4,20);o.anim.motion.prevState=o.hero.state;
    o.anim.playAerial(clip);
    const c=TL.AerialClips[clip];
    for(let i=0;i<30;i++)tick(o,c.duration*.48/30);capture(o,label);
  }
  fs.writeFileSync(path.join(__dirname,'animation_preview.json'),JSON.stringify(out));
  console.log('Exported six posed meshes for Blender inspection');
}
