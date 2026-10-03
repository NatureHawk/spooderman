'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE=require(path.join(harness,'node_modules/three/build/three.cjs'));
for(const f of ['00_core.js','02_collision.js','04_physics.js','04b_contact.js','04c_reference.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});TL.V.init();
let count=0;function check(name,fn){fn();count++;console.log('PASS '+name);}
const intent=axis=>({move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:axis.clone(),camRight:new THREE.Vector3(-axis.z,0,axis.x)});
function fixture(yaw=0){
 const w=new TL.CollisionWorld();w.groundFn=()=>-100;
 const transform=(x,y,z)=>new THREE.Vector3(x*Math.cos(yaw)+z*Math.sin(yaw),100+y,-x*Math.sin(yaw)+z*Math.cos(yaw));
 const cols=[];for(const [x,y,z,hx,hy,hz] of [[-2,0,0,.15,2,5],[2,0,0,.15,2,5],[0,2,0,2,.15,5],[0,-2,0,2,.15,5]]){const p=transform(x,y,z);cols.push(w.addStatic(p.x,p.y,p.z,hx,hy,hz,yaw,{kind:'construction',anchor:true,climb:true}));}
 const gate={center:transform(0,-.12,0),axis:new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)),length:10,anchorsBySide:{}};
 for(const [key,side]of [['positive',-1],['negative',1]])gate.anchorsBySide[key]=[-1,1].map((sign,i)=>{const p=transform(sign*2,0,side*5);return{x:p.x,y:p.y,z:p.z,col:cols[i]};});
 gate.anchors=gate.anchorsBySide.positive;w.referenceGates=[gate];return{w,gate,cols};
}
function traverse(w,gate,name,speed,sign,dt){
 const axis=gate.axis.clone().multiplyScalar(sign),h=new TL.HeroController(w,TL.HERO_STATS[name]);h.teleport(...gate.center.clone().addScaledVector(axis,-gate.length*.5-7).toArray());h.fsm.set(TL.TS.AIR);h.grounded=false;h.vel.copy(axis).multiplyScalar(speed);const it=intent(axis),initial=h.pos.clone();
 const selected=TL.ReferenceTraversal.passage(h,it);assert(selected,'gate selectable '+gate.type);assert(selected.anchors[0].col.solid);
 TL.ReferenceTraversal.tick(h,0,{...it,tether:true});assert(h.pos.equals(initial),'activation never teleports');assert.equal(h.reference.action.kind,'pass_through');
 if(gate.anchorsBySide)assert.equal(h.tether.main.col,gate.anchorsBySide[sign>0?'positive':'negative'][0].col,'correct approach anchors');
 let entered=false,exited=false,minForward=Infinity;const cands=[];
 for(let i=0;i<Math.ceil(5/dt);i++){
  const prev=h.pos.clone();h.step(dt,it);const along=h.pos.clone().sub(gate.center).dot(axis);entered ||= along>0;
  const delta=h.pos.distanceTo(prev);assert(delta<Math.max(speed,23)*dt+0.12,'ordinary bounded physics integration');
  w.query(h.pos.x-2,h.pos.z-2,h.pos.x+2,h.pos.z+2,cands);assert(!TL.Contact.overlap(w,cands,h.pos.x,h.pos.y,h.pos.z,h.shape,.005),'no solid shell/body intersection');
  if(entered)minForward=Math.min(minForward,h.vel.dot(axis));
  if(entered&&h.reference.action?.kind!=='pass_through'){assert(along>gate.length*.5+1,'complete beyond far physical rim');exited=true;break;}
 }
 assert(exited,'crosses entire actual collider lane');assert(h.tether.ropes.every(r=>!r.active),'webs release at exit');assert(minForward>Math.min(speed,19)*.8,'fast passage preserves momentum');assert(h.nanResets===0);
 return h;
}
for(const name of ['PULSE','WEAVER'])for(const yaw of [0,.63])for(const sign of [-1,1])for(const speed of [10,32,65,110])for(const dt of [1/30,1/120])check(name+' hollow collider lane yaw='+yaw+' side='+sign+' speed='+speed+' @'+1/dt,()=>{const {w,gate}=fixture(yaw);traverse(w,gate,name,speed,sign,dt);});
check('fast blocked exit rejects selection from both sides',()=>{for(const sign of [-1,1]){const {w,gate}=fixture(.4),axis=gate.axis.clone().multiplyScalar(sign),p=gate.center.clone().addScaledVector(axis,gate.length*.5+5);w.addStatic(p.x,p.y,p.z,2,2,.2,.4,{kind:'building'});const h=new TL.HeroController(w,TL.HERO_STATS.PULSE);h.teleport(...gate.center.clone().addScaledVector(axis,-12).toArray());h.vel.copy(axis).multiplyScalar(65);assert.equal(TL.ReferenceTraversal.passage(h,intent(axis)),null);}});
check('new obstacle aborts active passage without moving the controller',()=>{const {w,gate}=fixture(),h=new TL.HeroController(w,TL.HERO_STATS.WEAVER);h.teleport(0,gate.center.y,-12);h.fsm.set(TL.TS.AIR);const it=intent(gate.axis);TL.ReferenceTraversal.tick(h,0,{...it,tether:true});w.addStatic(0,100,-7,3,3,.2,0,{kind:'barrier'});const before=h.pos.clone();TL.ReferenceTraversal.tick(h,.01,it);assert.equal(h.reference.action,null);assert(h.pos.equals(before));assert(h.tether.ropes.every(r=>!r.active));});
check('E hands an active swing to actual gate webs without losing speed',()=>{const {w,gate}=fixture(),h=new TL.HeroController(w,TL.HERO_STATS.WEAVER);h.teleport(0,gate.center.y,-12);h.vel.set(0,0,65);h.fsm.set(TL.TS.SWING);const old=w.addStatic(0,130,-12,2,.5,2,0,{kind:'building'}),r=h.tether.main;r.active=r.attached=true;r.kind='swing';r.attachTo({x:0,y:129.5,z:-12,col:old});h.corner={flow:true};h.roofFlow={age:0};h.swingWall=true;const before=h.pos.clone(),velocity=h.vel.clone(),it={...intent(gate.axis),tether:true,swing:true};TL.ReferenceTraversal.tick(h,0,it);assert.equal(h.reference.action.kind,'pass_through');assert.equal(h.state,TL.TS.AIR);assert(!h.corner&&!h.roofFlow&&!h.swingWall,'old traversal constraints cannot steal zip momentum');assert(h.pos.equals(before)&&h.vel.equals(velocity));assert(h.tether.ropes.every(p=>p.kind==='airzip'&&p.col!==old));assert.equal(it.tether,false);});
check('blocked and empty gate commands preserve attached swing rope and momentum',()=>{for(const blocked of [false,true]){const {w,gate}=fixture(),h=new TL.HeroController(w,TL.HERO_STATS.PULSE);h.teleport(0,gate.center.y,-12);h.vel.set(0,0,32);h.fsm.set(TL.TS.SWING);const old=w.addStatic(0,130,-12,2,.5,2,0,{kind:'building'}),r=h.tether.main;r.active=r.attached=true;r.kind='swing';r.attachTo({x:0,y:129.5,z:-12,col:old});if(blocked)w.addStatic(0,100,8,3,3,.2,0,{kind:'barrier'});else w.referenceGates=[];const p=h.pos.clone(),v=h.vel.clone();TL.ReferenceTraversal.tick(h,0,{...intent(gate.axis),tether:true,swing:true});assert.equal(h.reference.action,null);assert.equal(h.state,TL.TS.SWING);assert(r.active&&r.attached&&r.col===old);assert(h.pos.equals(p)&&h.vel.equals(v));}});
check('floating synthetic anchors cannot register a playable gate',()=>{const {w,gate}=fixture(),h=new TL.HeroController(w,TL.HERO_STATS.PULSE);h.teleport(0,gate.center.y,-12);gate.anchorsBySide.positive[0].x=0;assert.equal(TL.ReferenceTraversal.passage(h,intent(gate.axis)),null);});
check('near gate scan bounded and registration changes invalidate index',()=>{const {w,gate}=fixture();w.referenceGates=Array.from({length:1000},(_,i)=>({...gate,center:new THREE.Vector3(i<100?0:10000,100,0)}));assert.equal(TL.ReferenceTraversal.gateCandidates(w,gate.center).length,64);w.referenceGates=[gate];assert.equal(TL.ReferenceTraversal.gateCandidates(w,gate.center).length,1);});
console.log(count+' passage physics checks passed');
module.exports={traverse,intent,check};
