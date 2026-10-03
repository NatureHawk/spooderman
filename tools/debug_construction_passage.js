'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const test=path.join(__dirname,'../tests/construction_worksites_test.js'),fixture=new Function('require','__dirname',fs.readFileSync(test,'utf8')+'\nreturn {streamer,world};')(require,path.dirname(test));
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src/04c_reference.js'),'utf8'));TL.V.init();
const site=fixture.streamer.constructionState.sites[12],gate=site.gates.find(g=>g.type==='pipe'),axis=gate.axis.clone().negate(),world=fixture.world,h=new TL.HeroController(world,TL.HERO_STATS.PULSE),right=new THREE.Vector3(axis.z,0,-axis.x);
h.teleport(...gate.center.clone().addScaledVector(axis,-gate.length/2-10).addScaledVector(right,.65).toArray());h.fsm.set(TL.TS.SWING);h.grounded=false;h.vel.copy(axis).multiplyScalar(.78).addScaledVector(right,-.28);h.vel.y=.48;h.vel.normalize().multiplyScalar(60);
const entry=gate.center.clone().addScaledVector(axis,-gate.length/2-1),exit=gate.center.clone().addScaledVector(axis,gate.length/2+7.2),cands=[];world.query(gate.center.x-25,gate.center.z-25,gate.center.x+25,gate.center.z+25,cands);
console.log({bid:site.roofBid,site:site.center.toArray(),yaw:site.yaw,gate:gate.center.toArray(),axis:axis.toArray(),entry:entry.toArray(),exit:exit.toArray()});
for(let d=-gate.length/2-1;d<=gate.length/2+7.2;d+=.1){const p=gate.center.clone().addScaledVector(axis,d),hit=TL.Contact.overlap(world,cands,p.x,p.y,p.z,TL.BodyShapes.tuck,.03);if(hit){console.log('HIT',d,p.toArray(),hit);break;}}
console.log('curve',!!TL.ReferenceTraversal.approachPath(h,entry,exit,axis),'straight',TL.ReferenceTraversal.clearPath(h,entry,exit));
const failures=[];
for(const s of fixture.streamer.constructionState.sites)for(const g of s.gates)for(const speed of [15,35,60])for(const sign of [-1,1]){
 const axis=g.axis.clone().multiplyScalar(sign),right=new THREE.Vector3(axis.z,0,-axis.x),hero=new TL.HeroController(world,TL.HERO_STATS.PULSE);
 hero.teleport(...g.center.clone().addScaledVector(axis,-g.length/2-10).addScaledVector(right,.65).toArray());hero.fsm.set(TL.TS.SWING);hero.grounded=false;hero.vel.copy(axis).multiplyScalar(.78).addScaledVector(right,-.28);hero.vel.y=.48;hero.vel.normalize().multiplyScalar(speed);
 const it={tether:true,camFwd:g.center.clone().sub(hero.pos).normalize()};if(TL.ReferenceTraversal.passage(hero,it)?.gate!==g)failures.push({bid:s.roofBid,gate:g.type,speed,sign});
}
console.log('ALL_SELECTION_FAILURES',JSON.stringify(failures));
