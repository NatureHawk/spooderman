'use strict';
require('./hand_swing_test.js');const assert=require('assert');
for(const name of ['WEAVER','PULSE'])for(const dt of [1/60,1/120]){
 const w=new TL.CollisionWorld();w.groundFn=()=>-100;const wall=w.addStatic(0,120,0,4,20,4,0,{kind:'building'}),ceil=w.addStatic(0,125,-6,4,.3,2,0,{kind:'building'});
 const h=new TL.HeroController(w,TL.HERO_STATS[name]);h.teleport(0,123.88,-4.4);h.wallCol=wall;h.ceilCol=ceil;h.wallN.set(0,0,-1);h.vel.set(0,10,0);h.wallMode='up';h.fsm.set(TL.TS.WALL);
 const mat=TL.Assets.material(),scene=new THREE.Scene(),sk=TL.Assets.skinned(name,'hi',mat),a=new TL.HeroAnimator(sk,name,scene,mat,'high');const cam={fwd:new THREE.Vector3(0,0,1)},it={move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:cam.fwd,camRight:new THREE.Vector3(-1,0,0)};
 for(let i=0;i<80;i++)a.update(1/120,h,h.pos,cam);let max=0,worst=null;const v=new THREE.Vector3(),l=new THREE.Vector3();
 for(let k=0;k<Math.ceil(.53/dt);k++){
  h.step(dt,it);const physical=h.pos.clone(),velocity=h.vel.clone();a.update(dt,h,h.pos,cam);assert(h.pos.equals(physical)&&h.vel.equals(velocity));if(h.state!==TL.TS.CEIL)continue;
  const mesh=sk.mesh;mesh.updateMatrixWorld(true);mesh.skeleton.update();const attr=mesh.geometry.attributes;
  for(let i=0;i<attr.position.count;i++){v.fromBufferAttribute(attr.position,i);mesh.boneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);ceil.toLocal(v.x,v.y,v.z,l);const d=Math.min(ceil.hx-Math.abs(l.x),ceil.hy-Math.abs(l.y),ceil.hz-Math.abs(l.z));if(d>max){max=d;worst={frame:k,point:v.toArray(),bone:mesh.skeleton.bones[attr.skinIndex.array[i*4]].name};}}
 }
 console.log(name+' @'+1/dt+' maximum actual mesh penetration '+max.toFixed(6)+'m',worst);assert(max<.00001,'ceiling mesh clear through handoff, gait, and edge departure');
}
