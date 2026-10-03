'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {launch,start,setScene}=require('./graphics_bench/lib');
(async()=>{
 const out=path.join(__dirname,'encounter_evidence');fs.mkdirSync(out,{recursive:true});
 const {browser,page}=await launch({headless:true,w:1280,h:720});
 try{
  await start(page,'THREADLINE.html','medium');await setScene(page,'roof');
  await page.evaluate(()=>{const g=TL.game;if(g.cityLife)g.cityLife.cleanupIncident('abandoned');g.missions.endCrime(false,true);g.missions.crimeT=1e6;g.routes.exit();g.encounters.cancel(true);document.getElementById('hud').style.display='block';});
  const results=[];
  for(const type of ['rooftop','rescue','runaway']){
   const setup=await page.evaluate(type=>{
    const g=TL.game,e=g.encounters,h=g.hero.ctrl;e.cancel(true);if(g.cityLife)g.cityLife.cleanupIncident('abandoned');
    if(!e.start(type))return {ok:false,reason:g.ui.objective||'no spawn'};
    const a=e.active,p=a.target.clone();e.update(1/60);
    if(a.actor&&a.actor.anim)a.actor.anim.update(1/60,p,0,0,'idle');
    if(a.victim)g.crowd.renderVictim(a.victim,1/60);
    if(a.veh)g.traffic.render(a.veh,0);
    const at=p.clone().add(new THREE.Vector3(0,1.2,0));let cam=null,best=0;
    for(let k=0;k<12;k++){const ang=k*Math.PI/6,dir=new THREE.Vector3(Math.cos(ang)*9,6,Math.sin(ang)*9),len=dir.length();dir.normalize();const hit=g.world.raycast(at.x,at.y,at.z,dir.x,dir.y,dir.z,len,c=>c.solid&&!c.dynamic,null,{noGround:true});const clear=hit?Math.max(1,hit.t-.8):len;if(clear>best){best=clear;cam=at.clone().addScaledVector(dir,clear);}}
    BENCH.pose={cam:cam.toArray(),at:at.toArray(),fov:65};BENCH.render();
    window.__encStart={pos:h.pos.clone(),scene:g.scene.children.length};
    return {ok:true,type,target:p.toArray(),safe:a.safe&&a.safe.toArray(),path:a.path&&a.path.map(p=>p.toArray()),actor:!!(a.actor&&a.actor.sk||a.victim&&a.victim.sk||a.veh&&a.veh.batch)};
   },type);
   assert(setup.ok,JSON.stringify(setup));assert(setup.actor,'existing model missing for '+type);
   await new Promise(r=>setTimeout(r,3000));await page.screenshot({path:path.join(out,type+'.png')});
   const result=await page.evaluate(type=>{
    const g=TL.game,e=g.encounters,h=g.hero.ctrl,a=e.active,xp=g.progress.xp;
    const walk=(to,speed)=>{const from=h.pos.clone(),n=Math.max(1,Math.ceil(from.distanceTo(to)/(speed/60)));h.vel.copy(to).sub(from).normalize().multiplyScalar(speed);for(let i=1;i<=n&&e.active;i++){h.pos.lerpVectors(from,to,i/n);e.update(1/60);}};
    const interact=()=>{if(!e.canInteract())throw Error('not actionable '+type+' '+a.phase);e.interact();e.update(1/60);};
    if(type==='rooftop'){
     walk(a.target.clone().add(new THREE.Vector3(0,TL.C.FEET,0)),24);
     for(let i=0;i<700&&e.active;i++){h.vel.copy(a.target).sub(h.pos);h.vel.y=0;h.vel.normalize().multiplyScalar(10);h.pos.addScaledVector(h.vel,1/60);h.pos.y=a.target.y+TL.C.FEET;h.grounded=true;h.groundCol=a.col;e.update(1/60);if(e.active&&e.canInteract())interact();}
    }else if(type==='rescue'){
     walk(a.target.clone().add(new THREE.Vector3(0,TL.C.FEET,0)),24);h.grounded=true;h.vel.set(0,0,0);interact();
     walk(a.safe.clone().add(new THREE.Vector3(0,TL.C.FEET,0)),20);h.grounded=true;h.vel.set(0,0,0);interact();
    }else{
     const v=a.veh;for(let i=0;i<30;i++){g.traffic.drive(v,1/60,0);e.update(1/60);}
     h.pos.copy(v.pos);h.pos.y=v.col.top+TL.C.FEET;h.grounded=true;h.groundCol=v.col;h.vel.set(0,0,v.speed);interact();
     for(let i=0;i<400&&e.active;i++){g.traffic.drive(v,1/60,0);h.pos.copy(v.pos);h.pos.y=v.col.top+TL.C.FEET;h.grounded=true;h.groundCol=v.col;e.update(1/60);}
    }
    return {type,result:e.lastResult,reward:g.progress.xp-xp,active:!!e.active,errors:TL.errors.slice()};
   },type);
   assert(result.result&&result.result.success,JSON.stringify(result));assert.equal(result.reward,180);assert(!result.active);assert.deepEqual(result.errors,[]);results.push({...setup,...result});
  }
  const gates=await page.evaluate(()=>{const g=TL.game,r=g.routes;r.begin(r.defs.find(d=>d.id==='street_canyon'));const a=r.active;return {alternatives:Object.keys(a.alternatives),values:Object.values(a.alternatives),samples:a.samples.length};});assert(gates.alternatives.length>0,'scan geometry must offer at least one clear high gate');
  await page.evaluate(()=>{const g=TL.game,r=g.routes,a=r.active,c=Object.values(a.alternatives)[0];a.k=+Object.keys(a.alternatives)[0];r.refreshMarkers();r.refreshAlternates();r.drawHud();BENCH.pose={cam:[c.x+15,c.y+6,c.z-22],at:[c.x,c.y-6,c.z],fov:70};BENCH.render();});
  await new Promise(r=>setTimeout(r,3000));await page.screenshot({path:path.join(out,'alternate_gates.png')});
  const ghost=await page.evaluate(()=>{
   const g=TL.game,r=g.routes,h=g.hero.ctrl;r.restart();r.update(3.1);
   for(const c of r.active.def.cps){const n=new THREE.Vector3(c.n[0],0,c.n[1]);h.pos.set(c.x-n.x*8,c.y,c.z-n.z*8);r.active.prev.copy(h.pos);h.vel.copy(n).multiplyScalar(30);for(let i=0;i<20&&r.active.phase==='run';i++){h.pos.addScaledVector(n,.8);r.update(1/30);}}
   const best=r.best.street_canyon;if(!best||!best.replay)throw Error('PB replay not recorded');
   const saved=JSON.parse(JSON.stringify(r.serialize()));r.deserialize(saved);if(g.ui.modal)g.ui.closeModal(true);g.state='play';r.restart();r.update(3.1);r.update(.7);r.updateGhost();
   const p=r.ghost.position.clone();let cam=null,bestClear=0;
   for(let k=0;k<24;k++){const angle=k*Math.PI/12,dir=new THREE.Vector3(Math.cos(angle)*5,1.5,Math.sin(angle)*5),len=dir.length();dir.normalize();const hit=g.world.raycast(p.x,p.y,p.z,dir.x,dir.y,dir.z,len,c=>c.solid&&!c.dynamic,null,{noGround:true});const clear=hit?Math.max(.6,hit.t-.5):len;if(clear>bestClear){bestClear=clear;cam=p.clone().addScaledVector(dir,clear);}}
   BENCH.pose={cam:cam.toArray(),at:p.toArray(),fov:50};r.drawHud();BENCH.render();
   return {samples:best.replay.samples.length,parts:r.ghost.children.length,splits:best.replay.splits.length};
  });assert(ghost.samples>2&&ghost.splits===8);await new Promise(r=>setTimeout(r,3000));await page.screenshot({path:path.join(out,'pb_ghost.png')});
  assert.deepEqual(page.errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,gates,ghost,errors:page.errors},null,2));console.log(JSON.stringify({results,gates,ghost,errors:page.errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
