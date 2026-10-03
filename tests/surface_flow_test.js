'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE=require(path.join(harness,'node_modules/three/build/three.cjs'));
for(const f of ['00_core.js','02_collision.js','04_physics.js','04b_contact.js','04c_reference.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});TL.V.init();
function intent(o={}){return Object.assign({move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:new THREE.Vector3(0,0,1),camRight:new THREE.Vector3(-1,0,0),swing:false,swingPressed:false,jump:false,dive:false},o);}
function arena(name='PULSE',yaw=0,speed=16){const w=new TL.CollisionWorld();w.groundFn=()=>-100;const b=w.addStatic(0,20,0,4,20,4,yaw,{kind:'building'}),h=new TL.HeroController(w,TL.HERO_STATS[name]);h.teleport(...b.toWorld(3.7,0,-4.4,new THREE.Vector3()).toArray());h.wallCol=b;b.dirToWorld(0,0,-1,h.wallN);b.dirToWorld(speed,0,0,h.vel);h.wallMode='side';h.fsm.set(TL.TS.WALL);const it=intent({camFwd:b.dirToWorld(0,0,1,new THREE.Vector3())});return{w,b,h,it};}
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
for(const hero of ['PULSE','WEAVER'])for(const yaw of [0,.63])for(const dt of [1/30,1/60,1/120])check(hero+' convex arc '+yaw+' @'+1/dt,()=>{
 const {w,b,h,it}=arena(hero,yaw);const initial=h.vel.length();let seen=false,minSpeed=Infinity,maxSpeed=0;
 for(let t=0;t<.25;t+=dt){h.step(dt,it);seen ||=!!h.corner;maxSpeed=Math.max(maxSpeed,h.vel.length());if(h.corner)minSpeed=Math.min(minSpeed,Math.hypot(h.vel.x,h.vel.z));assert(!TL.Contact.overlap(w,[b],h.pos.x,h.pos.y,h.pos.z,TL.BodyShapes.stand,.03));}
 assert(seen||h.events.some(e=>e.type==='corner'));const local=b.toLocal(h.pos.x,h.pos.y,h.pos.z,new THREE.Vector3());assert(local.x>4.3&&local.z>-3.7);assert(minSpeed>initial*.94);assert(maxSpeed<initial+.2);
});
check('blocked adjacent geometry rejects the entire corner path',()=>{const {w,h,it}=arena();w.addStatic(4.65,20,-3.8,.32,3,.7,0,{kind:'building'});assert.equal(TL.SurfaceFlow.corner(h,.04,it),false);assert(!h.corner);});
check('thin pole cannot create a convex building transition',()=>{const {h,it}=arena();h.wallCol.hx=.15;assert.equal(TL.SurfaceFlow.corner(h,.04,it),false);});
for(const name of ['PULSE','WEAVER'])check(name+' tether retains anchor and actual speed through convex corner',()=>{const {h,it}=arena(name);const r=h.tether.main;r.active=r.attached=true;r.kind='swing';r.anchor.set(-8,80,-10);r.L=r.targetL=100;r.maxL=150;h.fsm.set(TL.TS.SWING);h.swingWall=true;it.swing=true;const anchor=r.anchor.clone();let seen=false;for(let i=0;i<30;i++){h.step(1/120,it);seen ||=!!h.corner;}assert(seen);assert(r.active&&r.attached&&r.anchor.equals(anchor));assert.equal(h.state,TL.TS.SWING);assert(h.vel.length()>14&&h.vel.length()<17);});
for(const name of ['PULSE','WEAVER'])for(const parapet of [false,true])check(name+' fast roof carry '+(parapet?'parapet':'plain')+' and immediate real catch',()=>{
 const {w,b,h}=arena(name,0);h.teleport(0,38.85,-4.4);h.vel.set(0,14,0);h.wallMode='up';h.fsm.set(TL.TS.WALL);if(parapet)w.addStatic(0,40.22,-3.8,4,.22,.2,0,{kind:'roof'});
 const it=intent({move:new THREE.Vector3(0,0,1),moveLocal:{x:0,y:1}});let carry=false,crest=false;
 for(let i=0;i<100;i++){h.step(1/120,it);carry ||=!!h.roofFlow;crest ||=h.fsm.log.some(e=>e.reason==='wall-crest');assert(h.vel.length()<14.3);if(crest&&h.vel.z>9)break;}
 assert(carry&&crest);assert(h.pos.y>40.9);assert(h.vel.z>9);assert(!h.action);
 // A genuine nearby tower supplies the new anchor; no airborne synthetic point.
 w.addStatic(-10,65,12,3,12,3,0,{kind:'building'});it.swingPressed=true;it.swing=true;h.step(1/120,it);assert(h.tether.main.active&&h.tether.main.col);it.swingPressed=false;
 for(let i=0;i<45;i++)h.step(1/120,it);assert(h.tether.main.attached&&h.state===TL.TS.SWING);
});
check('low roof bulkhead rejects fast carry',()=>{const {w,h,it}=arena();h.teleport(0,38.85,-4.4);h.vel.set(0,14,0);h.wallMode='up';h.fsm.set(TL.TS.WALL);w.addStatic(0,41,-3.4,3,1,.65,0,{kind:'building'});assert.equal(TL.SurfaceFlow.roof(h,it),false);});
for(const name of ['PULSE','WEAVER'])for(const yaw of [0,.63])for(const dt of [1/30,1/120])check(name+' real ceiling handoff '+yaw+' @'+1/dt,()=>{
 const {w,b,h,it}=arena(name,yaw),center=b.toWorld(0,5,-6,new THREE.Vector3());w.addStatic(center.x,center.y,center.z,4,.3,2,yaw,{kind:'building'});
 h.teleport(...b.toWorld(0,3.88,-4.4,new THREE.Vector3()).toArray());h.vel.set(0,10,0);h.wallMode='up';h.fsm.set(TL.TS.WALL);let seen=false;
 for(let t=0;t<.22;t+=dt){h.step(dt,it);seen ||=h.state===TL.TS.CEIL;assert(h.vel.length()<10.1);}assert(seen);assert(h.vel.dot(h.wallN)>3);assert(h.ceilCol);
});
for(const name of ['PULSE','WEAVER'])check(name+' ceiling-to-wall carries into downward run',()=>{
 const {w,h,it}=arena(name);h.ceilCol=w.addStatic(0,25,-6,4,.3,2,0,{kind:'building'});h.teleport(0,23.88,-4.8);h.vel.set(0,0,8);h.fsm.set(TL.TS.CEIL);it.move.set(0,0,1);
 let transferred=false;for(let i=0;i<20;i++){h.step(1/120,it);if(h.state===TL.TS.WALL){transferred=true;assert(h.vel.y< -4);assert(h.vel.length()<8.1);break;}}assert(transferred);
});
check('wall-corner-roof sequence immediately catches a new real web',()=>{
 const {w,h,it}=arena();h.pos.y=37.9;h.vel.set(12,12,0);let corner=false,roof=false;
 for(let i=0;i<180;i++){h.step(1/120,it);corner ||=!!h.corner;roof ||=!!h.roofFlow;if(h.fsm.log.some(e=>e.reason==='wall-crest')&&h.vel.x< -4)break;}
 assert(corner&&roof);assert(h.state===TL.TS.AIR);w.addStatic(-9,65,4,3,12,3,0,{kind:'building'});it.camFwd.set(-1,.2,0).normalize();it.swing=it.swingPressed=true;h.step(1/120,it);assert(h.tether.main.col);it.swingPressed=false;
 for(let i=0;i<50;i++)h.step(1/120,it);assert(h.tether.main.attached&&h.state===TL.TS.SWING);
});
check('release halfway around a tethered corner keeps actual velocity and cancels arc',()=>{
 const {h,it}=arena();h.pos.x=3.95;h.swingWall=true;h.fsm.set(TL.TS.SWING);const r=h.tether.main;r.active=r.attached=true;r.kind='swing';r.anchor.set(-8,80,-10);r.L=r.targetL=100;r.maxL=150;it.swing=true;
 h.step(1/120,it);assert(h.corner);const v=h.vel.clone();h.releaseSwing(false,it);assert(!h.corner&&!r.active);assert(h.vel.equals(v));
});
console.log(count+' surface flow checks passed');
