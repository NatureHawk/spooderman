'use strict';
require('./hand_swing_test.js');
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
for(const f of ['04c_reference.js','06e_reference_anim.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
function make(name,mechanical){const w=new TL.CollisionWorld();w.groundFn=()=>-100;const h=new TL.HeroController(w,TL.HERO_STATS[name]);h.teleport(0,100,-10);h.fsm.set(TL.TS.AIR);h.grounded=false;h.vel.set(0,0,40);h.tuck=1;h.shape=TL.BodyShapes.tuck;const mat=TL.Assets.material(),scene=new THREE.Scene(),sk=TL.Assets.skinned(name,'mid',mat);scene.add(sk.mesh);const an=new TL.HeroAnimator(sk,name,scene,mat,'high');an.arms?.setRetracted(!mechanical,true);return{h,an};}
for(const name of ['WEAVER','PULSE'])for(const mechanical of name==='WEAVER'?[false,true]:[false])for(const sign of [-1,1])check(name+' passage→release mechanical='+mechanical+' direction='+sign,()=>{
 const {h,an}=make(name,mechanical),axis=new THREE.Vector3(0,0,sign);h.vel.copy(axis).multiplyScalar(40);h.facing=sign===1?0:Math.PI;
 const a=TL.ReferenceTraversal.begin(h,'pass_through',3);Object.assign(a,{entry:axis.clone().multiplyScalar(-4).add(new THREE.Vector3(0,100,0)),exit:axis.clone().multiplyScalar(7).add(new THREE.Vector3(0,100,0)),axis,approachDistance:6});
 for(const along of [-5,-2,0,4,9,11]){
  h.pos.copy(a.entry).addScaledVector(axis,along);a.t=.3;const expected=h.pos.clone(),velocity=h.vel.clone();
  const one=TL.ReferenceMotion.sample(h);a.duration=30;const two=TL.ReferenceMotion.sample(h);assert.equal(one.phase,two.phase,'phase follows position rather than timeout');
  for(let i=0;i<20;i++)an.update(1/120,h,h.pos,{fwd:axis});
  assert(Object.values(an.rig.cur).every(TL.finite3));assert(h.pos.equals(expected)&&h.vel.equals(velocity),'animation does not move physics');
  if(along>=0){assert(one.weight>.99,'compact pose held throughout bore');assert(an.rig.cur.thighL.angleTo(an.rig.cur.shinL)>1.7,'knees visibly folded');}
  if(an.arms){assert.equal(an.arms.mode,'packed');assert.equal(an.arms.retracted,!mechanical);assert.equal(an.arms.deployment,mechanical?1:0);if(mechanical)assert(an.arms.compact>.8);}
 }
 const last=TL.ReferenceMotion.sample(h);TL.ReferenceTraversal.begin(h,'pass_release',.46);const first=TL.ReferenceMotion.sample(h);assert(last.pose.thighL.distanceTo(first.pose.thighL)<1e-8,'release begins at compact pose without discontinuity');
 const before=h.vel.clone();h.reference.action.t=.25;const open=TL.ReferenceMotion.sample(h);assert(open.pose.uarmL.x>last.pose.uarmL.x+.35,'arms spread after exit');assert(open.pose.thighL.angleTo(open.pose.shinL)<last.pose.thighL.angleTo(last.pose.shinL)-.6,'legs extend after exit');
 for(let i=0;i<45;i++)an.update(1/120,h,h.pos,{fwd:axis});assert(h.vel.equals(before));h.reference.action=null;for(let i=0;i<60;i++)an.update(1/120,h,h.pos,{fwd:axis});if(an.arms)assert.equal(an.arms.mode,'swing');
});
console.log(count+' zip animation sequences passed');
