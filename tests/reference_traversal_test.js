'use strict';
require('./hand_swing_test.js');
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
for(const f of ['04c_reference.js','06e_reference_anim.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});
function make(){const w=new TL.CollisionWorld();w.groundFn=()=>0;const h=new TL.HeroController(w,TL.HERO_STATS.WEAVER);h.teleport(0,100,0);h.fsm.set(TL.TS.AIR);h.grounded=false;h.vel.set(0,0,20);h.wind=new TL.WindField();h.events=[];h.onEvent=(k)=>h.events.push(k);return h;}
const it=(more={})=>({move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:new THREE.Vector3(0,0,1),camRight:new THREE.Vector3(-1,0,0),...more});
function frames(h,n,opts={}){for(let i=0;i<n;i++)h.step(1/120,it(opts));}
for(const kind of ['spiderJump','spiderDash']){
 const h=make();h.step(1/120,it({[kind]:true}));const v=h.vel.clone();frames(h,12);
 assert.equal(h.events.filter(k=>k==='referenceboost').length,0,'impulse waits for anticipation');frames(h,10);
 assert.equal(h.events.filter(k=>k==='referenceboost').length,1,'one impulse');
 assert(kind==='spiderJump'?h.vel.y>12:h.vel.z>35,'effective directional boost');
 frames(h,120);h.step(1/120,it({[kind]:true}));assert.equal(h.reference.action,null,'cooldown');
 assert(h.pos.toArray().every(Number.isFinite));
}
{
 const h=make();h.step(1/120,it({tether:true}));assert.equal(h.reference.action,null,'empty sky cannot air zip');
 for(const x of [-20,20])h.world.addStatic(x,110,25,4,25,30,0,{kind:'building'});
 h.step(1/120,it({tether:true}));assert.equal(h.reference.action.kind,'air_zip');
 assert.equal(h.tether.ropes.filter(r=>r.active&&r.col).length,2,'both webs on real geometry');
 frames(h,30);assert(h.vel.z>28,'zip pulls forward');frames(h,40);assert(h.tether.ropes.every(r=>!r.active),'zip releases automatically');
}
{
 const h=make();h.fsm.set(TL.TS.GLIDE);h.glide.yaw=0;h.glide.t=1;h.step(1/120,it({wingDodge:true}));assert.equal(h.reference.action.kind,'wing_dodge');frames(h,100);assert.equal(h.reference.action,null);
 const w=make();w.pos.y=TL.C.WATER_Y+.7;w.world.groundFn=()=>TL.C.WATER_Y-20;w.fsm.set(TL.TS.WATER);w.inWater=true;w.step(1/120,it({jump:true}));assert(w.vel.y>10);assert.equal(w.state,TL.TS.AIR);
}
for(const [kind,c]of Object.entries(TL.ReferenceMotion.clips)){
 const h=make();const a=TL.ReferenceTraversal.begin(h,kind,.8);for(let i=0;i<=100;i++){a.t=i*.008;const p=TL.ReferenceMotion.sample(h);assert(Object.values(p.pose).every(v=>v.toArray().every(Number.isFinite)));assert(Number.isFinite(p.pitch+p.roll));}
}
// New boost still collides with an obstacle in its flight path.
{const h=make();h.world.addStatic(0,100,8,10,15,.15,0,{kind:'building'});h.step(1/120,it({spiderDash:true}));frames(h,120);assert(h.pos.z<8,'dash cannot tunnel through solid wall');}
console.log('PASS reference anticipation, one-shot impulses, cooldowns, real zip anchors, empty sky, release, wing dodge, water jump, finite poses and dash collision');
// A full loop must move the body around the anchor, and a slow entry must not
// receive a hidden velocity boost merely for holding the loop input.
for(const speed of [12,52]){
 const h=make();h.fsm.set(TL.TS.SWING);h.assist=0;h.vel.set(0,0,speed);const r=h.tether.main;r.active=r.attached=true;r.kind='swing';r.anchor.set(0,120,0);r.L=r.targetL=20;r.maxL=80;
 let above=false;for(let i=0;i<300;i++){h.step(1/120,it({swing:true,dive:true}));above ||= h.pos.y>r.anchor.y+10;}
 if(speed===52){assert(above);assert(h.reference.loop.travel>Math.PI*2);assert.equal(h.events.filter(k=>k==='referenceboost').length,1);}
 else assert(!above,'slow swing must not invent enough energy to loop');
}
{
 const h=make();const col=h.world.addStatic(3,100,0,.1,3,3,0,{kind:'building'});
 const g={center:new THREE.Vector3(0,100,0),axis:new THREE.Vector3(0,0,1),length:3,anchors:[{x:2.9,y:100,z:0,col},{x:2.9,y:100,z:0,col}]};
 h.world.referenceGates=[g];h.pos.set(0,100,-8);assert(TL.ReferenceTraversal.passage(h,it()),'clear passage accepted');
 h.world.addStatic(0,100,3,2,2,.1,0,{kind:'building'});assert.equal(TL.ReferenceTraversal.passage(h,it()),null,'blocked exit rejected');
}
{
 const h=make();const w=h.wind;w.addTunnel(new THREE.Vector3(0,100,0),new THREE.Vector3(0,100,100),7);
 assert.equal(w.tunnelAt(new THREE.Vector3(8,100,30)),null);assert.equal(w.tunnelAt(new THREE.Vector3(0,100,101)),null);assert(w.tunnelAt(new THREE.Vector3(0,100,30)).weight>.9);
 h.pos.set(0,100,20);h.startGlide();frames(h,60);assert(h.glide.tunnel>0);assert(h.vel.length()<TL.C.MAX_SPEED);assert(TL.finite3(h.pos));
}
{const h=make();h.grounded=true;h.fsm.set(TL.TS.RECOVER);h.fsm.t=.15;h.landing={kind:'roll'};h.step(1/120,it({jump:true}));assert.equal(h.state,TL.TS.AIR);assert(h.vel.y>5);}
{const h=make();TL.ReferenceTraversal.begin(h,'spider_jump',1);h.teleport(0,100,0);frames(h,30);assert.equal(h.reference.action,null);assert(!h.events.includes('referenceboost'));}
console.log('PASS real full loop, insufficient-energy rejection, blocked passage exit, bounded wind corridor, timed recovery and teleport cancellation');
