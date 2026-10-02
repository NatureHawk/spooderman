'use strict';
require('./hand_swing_test.js');
const assert=require('assert');
const S=TL.TS,cam={fwd:new THREE.Vector3(0,0,1)};
function make(name) {
  const world=new TL.CollisionWorld();world.groundFn=()=>0;
  const h=new TL.HeroController(world,TL.HERO_STATS[name]);h.teleport(0,50,0);h.grounded=false;h.vel.set(0,8,25);
  const mat=TL.Assets.material(),scene=new THREE.Scene(),sk=TL.Assets.skinned(name,'mid',mat);scene.add(sk.mesh);
  const a=new TL.HeroAnimator(sk,name,scene,mat,'high');
  return {h,a,scene,tick(dt){a.update(dt,h,h.pos,cam);}};
}
// Rapid interruptions on both real skeletons, with no physical momentum changes.
for(const name of ['WEAVER','PULSE'])for(const hz of [30,60,120]) {
  const o=make(name),{h,a}=o,r=h.tether.main;
  h.fsm.set(S.AIR);for(let i=0;i<hz;i++)o.tick(1/hz);
  a.playAerial('flip');for(let i=0;i<hz*.3;i++)o.tick(1/hz);
  for(const state of [S.DIVE,S.AIR,S.SWING,S.AIR,S.DIVE,S.SWING]) {
    r.active=r.attached=state===S.SWING;r.anchor.set(8,72,12);r.L=25;r.tension=40;r.hand='L';h.fsm.set(state);
    const p=h.pos.clone(),v=h.vel.clone();
    for(let i=0;i<Math.ceil(hz*.09);i++) {
      o.tick(1/hz);
      for(const d of Object.values(a.rig.cur)){assert(d.toArray().every(Number.isFinite));assert(Math.abs(d.length()-1)<1e-5);}
    }
    assert.equal(h.pos.distanceTo(p),0);assert.equal(h.vel.distanceTo(v),0);
    if(state===S.SWING)assert.equal(a.rel,null);
  }
  h.fsm.set(S.AIR);o.tick(1/hz);assert(a.aerialFlow.t<.18);
  h.pos.x+=100;o.tick(1/hz);assert(a.aerialFlow.t>=a.aerialFlow.duration,'teleport cancels pose carry');
  a.dispose(o.scene);
}
console.log('PASS rapid aerial interruptions at 30/60/120Hz on both rigs; finite poses, catches cancel flips, physics unchanged');
const o=make('PULSE'),{h,a}=o,r=h.tether.main;r.active=r.attached=true;r.anchor.set(8,78,4);r.hand='L';
let style=TL.SwingStyle.sample(a,h,1);assert(style.high>.5&&!style.cross);
r.anchor.x=-20;style=TL.SwingStyle.sample(a,h,1);assert(style.cross);
const cross=TL.SwingStyle.release(h,0,style);assert.equal(cross,'scissor_twist');
h.world.addStatic(0,46,0,10,1,10,0,{kind:'building'});
style=TL.SwingStyle.sample(a,h,1);assert(style.low>.8,'nearby roof counts as low clearance even high above street');
assert.equal(TL.SwingStyle.release(h,0,style),'sail');
assert.notEqual(TL.SwingStyle.release(h,0,{low:0,cross:false}),cross);
console.log('PASS roof clearance, high arc and cross-body release families depend on geometry and speed');
// The carry actually reduces the first-frame direction jump, including 180-degree poses.
const flow=new TL.AerialFlow(),fake={rig:{cur:{thighL:new THREE.Vector3(0,-1,0)}},rootQ:new THREE.Quaternion(),prevSt:S.AIR};
h.fsm.set(S.DIVE);flow.begin(fake,h,1/60);
const sets={thighL:new THREE.Vector3(0,1,0)};flow.apply(fake,h,sets,[]);
assert(sets.thighL.angleTo(fake.rig.cur.thighL)<.1);
console.log('PASS opposite limb directions blend continuously instead of collapsing');
