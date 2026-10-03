'use strict';
require('./hand_swing_test.js');
const assert=require('assert');
const camera={fwd:new THREE.Vector3(0,0,1)};
function make(name,retracted=false){
  const world=new TL.CollisionWorld();world.groundFn=()=>-100;
  const col=world.addStatic(0,50,1.2,100,100,.5,0,{kind:'building'});
  const h=new TL.HeroController(world,TL.HERO_STATS[name]);h.teleport(0,20,.30);h.grounded=false;
  h.wallN.set(0,0,-1);h.wallCol=col;h.fsm.set(TL.TS.CRAWL);h.vel.set(0,0,0);
  const mat=TL.Assets.material(),scene=new THREE.Scene(),sk=TL.Assets.skinned(name,'mid',mat);
  scene.add(sk.mesh);const an=new TL.HeroAnimator(sk,name,scene,mat,'high');
  if(an.arms)an.arms.retracted=retracted;
  return{h,an,scene};
}
function tick(o){o.an.update(1/60,o.h,o.h.pos,camera);}
function finite(o){assert(Object.values(o.an.rig.cur).every(TL.finite3));assert(o.an.rootQ.toArray().every(Number.isFinite));}
for(const [name,retracted]of [['PULSE',false],['WEAVER',false],['WEAVER',true]]){
  const o=make(name,retracted),h=o.h,an=o.an;
  for(let i=0;i<90;i++)tick(o);
  const contacts=Object.entries(an.wallContacts).filter(([k,c])=>c&&c.planted);
  assert.equal(contacts.length,4,name+' four human contacts with claws '+!retracted);
  for(const [key,c]of contacts){
    const actual=an.rig.P[key].clone().applyQuaternion(an.rootQ).add(an.meshPos);
    assert(actual.distanceTo(c.p)<.015,key+' reaches the facade');
  }
  const locked=contacts.map(([key,c])=>[key,c.p.clone()]);
  h.pos.y+=.025;tick(o);
  for(const [key,p]of locked)assert(an.wallContacts[key].p.distanceTo(p)<1e-8,key+' stays planted as torso shifts');
  const before=h.pos.clone(),velocity=h.vel.clone();tick(o);
  assert(h.pos.equals(before)&&h.vel.equals(velocity),'visual solver does not move physical body');
  h.vel.set(1,.8,0);const lifted=new Set();
  for(let i=0;i<160;i++){
    h.pos.addScaledVector(h.vel,1/60);tick(o);finite(o);
    for(const [key,c]of Object.entries(an.wallContacts))if(c&&!c.planted)lifted.add(key);
  }
  assert.equal(lifted.size,4,'each hand and foot has a recovery stroke');
  if(an.arms&&!retracted)assert.equal(an.arms.mode,'wall');
  console.log('PASS '+name+(retracted?' retracted':'')+': facade contacts, no sliding, four-limb gait, physical state unchanged');
}
for(const name of ['PULSE','WEAVER'])for(const hand of ['L','R']){
  const o=make(name),h=o.h,an=o.an,r=h.tether.main;
  h.fsm.set(TL.TS.SWING);h.swingWall=true;h.singleHandSwing=true;h.vel.set(24,4,0);
  r.active=r.attached=true;r.hand=hand;r.anchor.set(0,60,-15);r.L=45;r.tension=50;
  for(let i=0;i<100;i++)tick(o);
  finite(o);
  assert(!an.wallContacts['hand'+hand],'rope wrist excluded from facade solver');
  const up=new THREE.Vector3(0,1,0).applyQuaternion(an.rootQ);
  assert(up.dot(h.vel.clone().normalize())>.98,'root follows wall travel');
  const shoulder=an.rig.P['uarm'+hand].clone().applyQuaternion(an.rootQ).add(an.meshPos);
  const wrist=an.handWorld[hand],toAnchor=r.anchor.clone().sub(shoulder).normalize();
  assert(wrist.clone().sub(shoulder).normalize().dot(toAnchor)>.94,'loaded hand keeps pointing at real anchor');
  assert(r.attached&&h.state===TL.TS.SWING);
  assert(Object.keys(an.wallContacts).some(k=>k.startsWith('foot')&&an.wallContacts[k]),'wall stride solves facade feet');
  h.swingWall=false;tick(o);assert.equal(an.wallContacts,null,'contact caches released after peeling off');
  if(an.arms)assert.equal(an.arms.mode,'swing');
  console.log('PASS '+name+' '+hand+': tethered wall stride, rope wrist, travel orientation, clean peel-off');
}
