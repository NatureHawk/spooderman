/* Built-game map, route discovery, site visibility and resource checks. */
'use strict';
const fs=require('fs'),assert=require('assert');
const {launch,start}=require('./graphics_bench/lib');
const {checkInteractions}=require('./worksites_browser');
const {checkCraneMotion}=require('./construction_cranes_browser');
const {checkBuiltCityPassages}=require('./construction_city_passages');
const out='evidence/construction';
const shotOnly=process.argv.includes('--shot-only');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {browser,page}=await launch({headless:true,w:1280,h:720});
 try {
  console.log('BOOT construction build');await start(page,'THREADLINE.html','high');
  const report=await page.evaluate(()=>{
   const g=TL.game,s=g.streamer.constructionState,defs=g.ui.worksiteRoutes();
   const sites=s.sites.map(q=>({id:q.id,name:q.name,center:q.center,baseY:q.baseY,yaw:q.yaw,start:q.start,landmarks:q.landmarks,roofBid:q.roofBid,variant:q.variant,footprint:q.footprint,finishedTowerRoof:q.finishedTowerRoof,gates:q.gates.map(t=>({id:t.id,type:t.type,roofBid:t.roofBid,src:t.src}))}));
   let separation=Infinity;for(let i=0;i<sites.length;i++)for(let j=i+1;j<sites.length;j++)separation=Math.min(separation,Math.hypot(sites[i].center.x-sites[j].center.x,sites[i].center.z-sites[j].center.z));
   const checks=defs.map(d=>({id:d.id,snaps:g.ui.worksiteAtMapPoint(d.start.x+.1,d.start.z+.1,5)===d,valid:TL.WorksiteRuns.validateStart(g.world,d.start)}));
   g.ui.mapFilters.worksites=false;const filterOff=defs.every(d=>g.ui.worksiteAtMapPoint(d.start.x,d.start.z,5)===null);g.ui.mapFilters.worksites=true;
   const env=g.env;env.hour=14;env.forced='clear';env.rain=env.rainTarget=env.wet=0;env.dayLen=1e12;env.weatherT=1e9;env.update(0,g.hero.ctrl.pos);
   return {seed:g.seed,sites,separation,spacing:TL.Construction.SPACING,finishedTowers:{count:g.streamer.finishedTowerState?.gates.length||0,skipped:g.streamer.finishedTowerState?.skipped||[]},checks,filterOff,routes:defs.map(d=>({id:d.id,start:d.start,cps:d.cps})),diagnostics:TL.WorksiteRuns.diagnostics,baseRoutes:g.routes.defs.filter(d=>d.kind!=='worksite').length,meshes:s.meshes.length,colliders:s.colliders.length};
  });
  console.log('SITES',JSON.stringify({count:report.sites.length,separation:report.separation,routes:report.routes.length,towers:report.finishedTowers}));
  if(!shotOnly)fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  assert.equal(report.sites.length,20,'twenty individually authored construction buildings');assert.equal(new Set(report.sites.map(s=>s.roofBid)).size,20,'twenty distinct existing footprints');assert.equal(new Set(report.sites.map(s=>s.variant)).size,20,'twenty authored variants');assert(report.separation>=report.spacing-.01,'authored site spacing');assert.deepEqual(report.diagnostics,[]);assert(report.finishedTowers.count>0,'finished-roof tanks are present');const constructionRoofs=new Set(report.sites.map(s=>s.roofBid));for(const site of report.sites)for(const gate of site.gates.filter(t=>t.type==='water_tower'))assert(!constructionRoofs.has(gate.roofBid),'water tower stands on a separate finished building');assert.equal(report.routes.length,report.sites.length,'one valid route per site');assert.equal(report.baseRoutes,3);assert(report.filterOff);assert(report.checks.every(c=>c.valid&&c.snaps));
  if(!shotOnly){
   report.interactions=await checkInteractions(page);console.log('INPUT_AND_REWARDS',report.interactions.runs.length);
   report.cranes=await checkCraneMotion(page);assert.equal(report.cranes.count,20,'all twenty construction cranes move');console.log('MOVING_CRANES',report.cranes.count);
   const passages=await checkBuiltCityPassages(page,20);fs.writeFileSync(`${out}/built_city_passages.json`,JSON.stringify(passages,null,2));
   report.passages={sites:passages.sites,gates:passages.gates,cases:passages.cases,minRetention:Math.min(...passages.rows.map(p=>p.minSpeed/p.speed))};console.log('FULL_CITY_PASSAGES',JSON.stringify(report.passages));
  }
  report.captures=[];
  for(let i=0;i<report.sites.length;i++){
   if(shotOnly&&i!==2)continue;
   const capture=await page.evaluate(i=>{
    const g=TL.game,q=g.streamer.constructionState.sites[i],bounds=new THREE.Box3();
    // Frame the full authored footprint, including contour wings and rooftop work.
    // A fixed 65m orbit cropped large individual buildings in the earlier harness.
    for(const mesh of q.meshes){mesh.updateMatrixWorld(true);bounds.expandByObject(mesh);}
    const size=bounds.getSize(new THREE.Vector3()),at=bounds.getCenter(new THREE.Vector3()),radius=size.length()*.5,fov=58;
    const required=Math.max(28,radius/Math.sin(fov*Math.PI/360)*1.10);let camera=null,best=-Infinity;
    for(const elevation of [.48,.8,1.2,1.8])for(let j=0;j<24;j++){
     const angle=(q.yaw||0)+j*Math.PI/12,dir=new THREE.Vector3(Math.cos(angle),elevation,Math.sin(angle)).normalize();
     const hit=g.world.raycast(at.x,at.y,at.z,dir.x,dir.y,dir.z,required,c=>c.solid&&c.siteId!==q.id&&c.bid!==q.roofBid,null,{noGround:true});
     const clear=hit?Math.max(2,hit.t-2):required,score=clear/required-.02*elevation;
     if(score>best){best=score;camera=at.clone().addScaledVector(dir,clear);}
    }
    BENCH.pose={cam:camera.toArray(),at:at.toArray(),fov};BENCH.applyPose();
    g.hero.ctrl.teleport(q.start.x,q.start.y+TL.C.FEET+.02,q.start.z);g.env.update(0,g.hero.ctrl.pos);g.streamer.update(g.camera.position,new THREE.Vector3(),1/60);
    for(let n=0;n<6;n++){BENCH.render();BENCH.sync();}
    return{id:q.id,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},camera:BENCH.pose,distance:camera.distanceTo(at),required,fullFrame:camera.distanceTo(at)>=required*.98};
   },i);
   report.captures.push(capture);
   await page.screenshot({path:`${out}/site_${i+1}.png`});
  }
  if(!shotOnly){
   report.towerCaptures=[];
   for(const index of [0,9,19]){
    const tower=await page.evaluate(index=>{
     const g=TL.game,site=g.streamer.constructionState.sites[index],gate=site.gates.find(t=>t.type==='water_tower');if(!gate)return null;
     const at=gate.center.clone().add(new THREE.Vector3(0,2.5,0));let camera=null,best=-1;
     for(let j=0;j<16;j++){
      const a=j*Math.PI/8,dir=new THREE.Vector3(Math.cos(a),.58,Math.sin(a)).normalize();
      const hit=g.world.raycast(at.x,at.y,at.z,dir.x,dir.y,dir.z,25,c=>c.solid&&c.bid!==gate.roofBid,null,{noGround:true}),clear=hit?Math.max(2,hit.t-1):25;
      if(clear>best){best=clear;camera=at.clone().addScaledVector(dir,clear);}
     }
     BENCH.pose={cam:camera.toArray(),at:at.toArray(),fov:58};BENCH.applyPose();g.streamer.update(g.camera.position,new THREE.Vector3(),1/60);for(let n=0;n<6;n++){BENCH.render();BENCH.sync();}
     return{site:site.id,constructionRoof:site.roofBid,finishedRoof:gate.roofBid,center:gate.center.toArray(),camera:BENCH.pose};
    },index);
    if(tower){report.towerCaptures.push(tower);await page.screenshot({path:`${out}/finished_tower_${index+1}.png`});}
   }
   // Restore the last construction camera before measuring construction render cost.
   await page.evaluate(pose=>{BENCH.pose=pose;BENCH.applyPose();TL.game.streamer.update(TL.game.camera.position,new THREE.Vector3(),1/60);},report.captures.at(-1).camera);
  }
  if(shotOnly){console.log('PASS replacement exterior capture');return;}
  report.ui=await page.evaluate(()=>{
   // The graphics boot helper hides top-level DOM; restore the menu layer for real map clicks.
   const g=TL.game,u=g.ui;document.getElementById('modals').style.display='block';u.openCityLink();const text=u.modal.el.textContent;
   const found=u.worksiteRoutes().every(d=>text.includes(d.name));const headings=text.includes('Worksite runs')&&text.includes('Traversal routes');
   u.closeModal(true);u.openMap();const cv=u.modal.el.querySelector('canvas'),d=u.worksiteRoutes()[0],r=cv.getBoundingClientRect(),E=u.mapExtent();
   cv.onclick({clientX:r.left+(d.start.x+E/2)/E*r.width,clientY:r.top+(d.start.z+E/2)/E*r.height});
   const exact=u.waypoint.distanceTo(new THREE.Vector3(d.start.x,d.start.y,d.start.z))<1e-6;
   return {found,headings,exact,mapSize:[r.width,r.height],waypoint:u.waypoint};
  });
  console.log('UI',JSON.stringify(report.ui));fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  assert(report.ui.found&&report.ui.headings&&report.ui.exact,'UI discovery and real-height map waypoint');
  await page.screenshot({path:`${out}/map.png`});
  await page.evaluate(()=>{TL.game.ui.closeModal(true);TL.game.state='play';});
  report.stability=await page.evaluate(()=>{
   const g=TL.game;for(let i=0;i<24;i++){BENCH.render();BENCH.sync();}const before={...g.renderer.info.memory,programs:g.renderer.info.programs.length};
   const times=[];for(let i=0;i<90;i++){const t=performance.now();BENCH.render();BENCH.sync();times.push(performance.now()-t);}
   return {before,after:{...g.renderer.info.memory,programs:g.renderer.info.programs.length},frames:BENCH.stats(times),errors:TL.errors.slice(),glError:BENCH.gl.getError()};
  });
  assert.deepEqual(report.stability.before,report.stability.after);assert.deepEqual(report.stability.errors,[]);assert.equal(report.stability.glError,0);assert.deepEqual(page.errors,[]);
  report.siteRenderCost=await page.evaluate(()=>{
   const g=TL.game,meshes=g.streamer.constructionState.meshes,visible=meshes.map(m=>m.visible),runs={on:[],off:[]};
   for(let round=0;round<2;round++)for(const mode of round?['off','on']:['on','off']){
    meshes.forEach((m,i)=>m.visible=mode==='on'?visible[i]:false);
    for(let i=0;i<8;i++){BENCH.render();BENCH.sync();}
    for(let i=0;i<36;i++){const t=performance.now();BENCH.render();BENCH.sync();runs[mode].push(performance.now()-t);}
   }
   meshes.forEach((m,i)=>m.visible=visible[i]);
   return {on:BENCH.stats(runs.on),off:BENCH.stats(runs.off),note:'Same fixed camera, 1280x720 High, synchronized renders. Measures visible construction meshes only; not overall gameplay FPS.'};
  });
  fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  console.log('PASS twenty authored buildings, real routes and passage physics, separate finished-roof towers, moving cranes, map/CityLink discovery, adaptive captures and stable resources');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
