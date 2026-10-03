'use strict';
require('./hand_swing_test.js');
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
for(const f of ['04c_reference.js','06e_reference_anim.js','03n_construction.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});
let count=0;const results=[];
for(const name of ['WEAVER','PULSE'])for(const mechanical of name==='WEAVER'?[false,true]:[false])for(const sign of [-1,1])for(const type of ['pipe','water_tower'])for(const speed of [19,65]){
 const scene=new THREE.Scene(),world={world:new TL.CollisionWorld(),scene};world.world.groundFn=()=>-100;const site=TL.Construction.buildSite(world,{x:0,z:0,baseY:100,yaw:.63,stories:3},0),gate=site.gates.find(g=>g.type===type),axis=gate.axis.clone().multiplyScalar(sign);
 const h=new TL.HeroController(world.world,TL.HERO_STATS[name]);h.teleport(...gate.center.clone().addScaledVector(axis,-gate.length*.5-7).toArray());h.fsm.set(TL.TS.AIR);h.grounded=false;h.vel.copy(axis).multiplyScalar(speed);h.facing=Math.atan2(axis.x,axis.z);
 const mat=TL.Assets.material(),sk=TL.Assets.skinned(name,'hi',mat),a=new TL.HeroAnimator(sk,name,scene,mat,'high');scene.add(sk.mesh);a.arms?.setRetracted(!mechanical,true);
 const cam={fwd:axis},it={move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:axis,camRight:new THREE.Vector3(-axis.z,0,axis.x)};
 for(let i=0;i<80;i++)a.update(1/120,h,h.pos,cam);TL.ReferenceTraversal.tick(h,0,{...it,tether:true});assert.equal(h.reference.action.kind,'pass_through');
 let max=0,worst=null,seen=false;const v=new THREE.Vector3(),l=new THREE.Vector3(),cands=[];
 for(let frame=0;frame<240;frame++){
  h.step(1/60,it);a.update(1/60,h,h.pos,cam);const along=h.pos.clone().sub(gate.center).dot(axis);
  world.world.query(h.pos.x-3,h.pos.z-3,h.pos.x+3,h.pos.z+3,cands);const nearby=cands.filter(c=>Math.abs(c.cy-h.pos.y)<c.hy+3);
  const inspect=(mesh,isSkin,label)=>{if(!mesh||!mesh.visible)return;mesh.updateMatrixWorld(true);if(isSkin)mesh.skeleton.update();const attrs=mesh.geometry.attributes,attr=attrs.position;if(!mesh._zipVertexSample){const unique=new Map();for(let j=0;j<attr.count;j++){const key=Array.from(attr.array.subarray(j*3,j*3+3)).join(',')+(isSkin?'|'+Array.from(attrs.skinIndex.array.subarray(j*4,j*4+4)).join(',')+'|'+Array.from(attrs.skinWeight.array.subarray(j*4,j*4+4)).join(','):'');if(!unique.has(key))unique.set(key,j);}mesh._zipVertexSample=[...unique.values()];}for(const i of mesh._zipVertexSample){v.fromBufferAttribute(attr,i);if(isSkin)mesh.boneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);for(const c of nearby){c.toLocal(v.x,v.y,v.z,l);const d=Math.min(c.hx-Math.abs(l.x),c.hy-Math.abs(l.y),c.hz-Math.abs(l.z));if(d>max){max=d;worst={frame,along,point:v.toArray(),kind:c.constructionMember,label,phase:TL.ReferenceMotion.sample(h)?.phase};}}}};
  inspect(sk.mesh,true,'skin');if(mechanical&&a.arms)for(const arm of a.arms.arms)for(const mesh of [arm.seg1,arm.seg2,arm.claw])inspect(mesh,false,'mechanical');
  seen ||=along>0;if(seen&&h.reference.action?.kind!=='pass_through'&&along>gate.length*.5+3)break;
 }
 const result={name,mechanical,sign,type,speed,max,worst};results.push(result);console.log(JSON.stringify(result));assert(seen);assert(max<.001,'Actual character mesh intersects authored gate');TL.Construction.dispose(world);count++;
}
fs.mkdirSync(path.join(__dirname,'../evidence/construction'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../evidence/construction/zip_mesh_metrics.json'),JSON.stringify(results,null,2));console.log(count+' real skinned/mechanical gate sequences clear');
