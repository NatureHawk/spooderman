'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {launch,start,setScene}=require('./graphics_bench/lib');
(async()=>{const {browser,page}=await launch({headless:true,w:1280,h:720});try{
 await start(page,'THREADLINE.html','medium');await setScene(page,'roof');
 const result=await page.evaluate(()=>{
  const g=TL.game,r=g.routes,h=g.hero.ctrl;if(g.cityLife)g.cityLife.cleanupIncident('abandoned');g.missions.endCrime(false,true);g.encounters.cancel(true);g.missions.crimeT=1e6;
  r.begin(r.defs.find(d=>d.id==='street_canyon'));r.update(3.1);
  for(const c of r.active.def.cps){const n=new THREE.Vector3(c.n[0],0,c.n[1]);h.pos.set(c.x-n.x*8,c.y,c.z-n.z*8);r.active.prev.copy(h.pos);h.vel.copy(n).multiplyScalar(30);for(let i=0;i<20&&r.active.phase==='run';i++){h.pos.addScaledVector(n,.8);r.update(1/30);}}
  const best=r.best.street_canyon;if(!best||!best.replay)throw Error('PB replay not recorded');
  const saved=JSON.parse(JSON.stringify(r.serialize()));r.deserialize(saved);if(g.ui.modal)g.ui.closeModal(true);g.state='play';r.restart();r.update(3.1);r.update(.7);r.updateGhost();
  const p=r.ghost.position.clone();let cam=null,bestClear=0;
  for(let k=0;k<24;k++){
   const angle=k*Math.PI/12,dir=new THREE.Vector3(Math.cos(angle)*5,1.5,Math.sin(angle)*5),len=dir.length();dir.normalize();
   const hit=g.world.raycast(p.x,p.y,p.z,dir.x,dir.y,dir.z,len,c=>c.solid&&!c.dynamic,null,{noGround:true});
   const clear=hit?Math.max(.6,hit.t-.5):len;if(clear>bestClear){bestClear=clear;cam=p.clone().addScaledVector(dir,clear);}
  }
  if(bestClear<3)throw Error('No clear ghost camera');
  BENCH.pose={cam:cam.toArray(),at:p.toArray(),fov:50};document.getElementById('hud').style.display='block';r.drawHud();BENCH.render();
  return {samples:best.replay.samples.length,splits:best.replay.splits.length,parts:r.ghost.children.length,visible:r.ghost.visible,clearance:bestClear,ghost:p.toArray(),camera:cam.toArray(),errors:TL.errors.slice()};
 });
 assert(result.visible&&result.parts===6&&result.splits===8);assert.deepEqual(result.errors,[]);assert.deepEqual(page.errors,[]);
 await new Promise(r=>setTimeout(r,4500));await page.screenshot({path:path.join(__dirname,'encounter_evidence','pb_ghost.png')});
 fs.writeFileSync(path.join(__dirname,'encounter_evidence','pb_ghost_result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
