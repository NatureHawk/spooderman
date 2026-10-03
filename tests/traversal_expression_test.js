'use strict';
require('./hand_swing_test.js');const assert=require('assert');
function make(name){const w=new TL.CollisionWorld();w.groundFn=()=>-100;const h=new TL.HeroController(w,TL.HERO_STATS[name]);h.teleport(0,20,0);h.grounded=false;const mat=TL.Assets.material(),scene=new THREE.Scene(),sk=TL.Assets.skinned(name,'mid',mat);scene.add(sk.mesh);return{h,w,an:new TL.HeroAnimator(sk,name,scene,mat,'high')};}
function tick(o){o.an.update(1/60,o.h,o.h.pos,{fwd:new THREE.Vector3(0,0,1)});assert(Object.values(o.an.rig.cur).every(TL.finite3));}
for(const name of ['PULSE','WEAVER'])for(const hand of ['L','R']){
 const o=make(name),{h,an,w}=o,free=hand==='L'?'R':'L',sg=free==='L'?1:-1,r=h.tether.main;
 h.fsm.set(TL.TS.SWING);h.singleHandSwing=true;h.vel.set(0,0,18);r.active=r.attached=true;r.hand=hand;r.anchor.set(0,50,0);r.L=30;r.tension=30;
 for(let i=0;i<100;i++)tick(o);
 const shoulder=an.rig.P['uarm'+free].clone().applyQuaternion(an.rootQ).add(an.meshPos),face=shoulder.x+sg*.28;
 const col=w.addStatic(face+sg*.3,20,0,.3,5,10,0,{kind:'building'});
 h.feedback={near:.95,clearance:Math.abs(face),nearNormal:new THREE.Vector3(sg,0,0),nearPoint:new THREE.Vector3(face,20,0),nearCollider:col,load:.4,energy:.4};
 let saw=false,exact=false;const P=h.pos.clone(),V=h.vel.clone();
 for(let i=0;i<22;i++){tick(o);if(an.skim){saw=true;assert.equal(an.skim.side,free);if(an.skim.w>.99){exact=true;assert(an.handWorld[free].distanceTo(an.skim.p)<.025);}}}
 assert(saw&&exact,'free hand makes a real reachable skim');assert(!an.skim&&an.skimCool>0,'skim ends rather than dragging forever');assert(h.pos.equals(P)&&h.vel.equals(V));
 h.feedback.clearance=4;for(let i=0;i<10;i++)tick(o);assert(!an.skim);
 console.log('PASS '+name+' '+hand+': real free-palm skim, loaded wrist protected, timed release, physics unchanged');
}
for(const name of ['PULSE','WEAVER']){
 const o=make(name),{h,w,an}=o;h.ceilCol=w.addStatic(0,21.1,0,5,.3,5,0,{kind:'building'});h.fsm.set(TL.TS.CEIL);h.vel.set(0,0,0);
 for(let i=0;i<120;i++)tick(o);
 const valid=Object.entries(an.wallContacts||{}).filter(([key,c])=>c?.planted);assert.equal(valid.length,4,'four human ceiling contacts');
 for(const [key,c]of valid){assert(an.rig.P[key].clone().applyQuaternion(an.rootQ).add(an.meshPos).distanceTo(c.p)<.025);assert(c.p.y<20.8);}
 if(an.arms){assert.equal(an.arms.mode,'ceiling');assert(an.arms.arms.filter(a=>a.planted).length>=2);an.arms.retracted=true;for(let i=0;i<40;i++)tick(o);assert.equal(an.arms.deployment,0);}
 h.vel.set(4,0,0);const oldSteps=an.steps;for(let i=0;i<60;i++)tick(o);assert(an.steps>oldSteps);
 console.log('PASS '+name+': ceiling palms/feet meet real underside, mechanical support and manual retraction');
}
for(const name of ['PULSE','WEAVER']){
 const o=make(name),{h,an}=o;h.fsm.set(TL.TS.AIR);h.vel.set(0,5,20);for(let i=0;i<60;i++)tick(o);const p=h.pos.clone(),v=h.vel.clone();
 for(let i=0;i<30;i++){const a=i*.015;h.vel.set(Math.sin(a)*20,5,Math.cos(a)*20);tick(o);}assert(Math.abs(an.expressionTurn)>.4);assert(Math.abs(an.rig.twist.chest)>.015);assert(h.pos.equals(p));
 h.fsm.set(TL.TS.DIVE);h.vel.set(0,-45,4);for(let i=0;i<90;i++)tick(o);for(const side of ['L','R'])assert(an.rig.cur['thigh'+side].angleTo(an.rig.cur['shin'+side])<.35);
 console.log('PASS '+name+': directional turn weight shift and fast streamlined dive silhouette');
}

for(const name of ['PULSE','WEAVER'])for(const hand of ['L','R']){const o=make(name),r=o.h.tether.main;r.active=true;r.attached=false;r.hand=hand;r.anchor.set(hand==='L'?7:-7,35,8);r.shotDur=.7;o.an.startWebShot(r);for(let i=0;i<30;i++)tick(o);assert(o.an.webShot,'reach survives long web flight');const shoulder=o.an.rig.P['uarm'+hand].clone().applyQuaternion(o.an.rootQ).add(o.an.meshPos);assert(o.an.handWorld[hand].clone().sub(shoulder).normalize().dot(r.anchor.clone().sub(shoulder).normalize())>.93);console.log('PASS '+name+' '+hand+': anticipatory reach follows actual anchor through long shot');}
