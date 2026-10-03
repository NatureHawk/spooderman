'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {launch,start,setScene}=require('./graphics_bench/lib');
async function checkInteractions(page){
 const setup=await page.evaluate(()=>{
  const g=TL.game;g.encounters.cancel(true);g.missions.endCrime(false,true);g.missions.crimeT=1e6;if(g.cityLife)g.cityLife.cleanupIncident('abandoned');
  const defs=g.routes.defs.filter(d=>d.kind==='worksite');if(defs.length<3)throw Error('Need at least3 actual geometry-validated worksite runs: '+JSON.stringify(TL.WorksiteRuns.diagnostics));
  const d=defs[0],s=d.start,h=g.hero.ctrl;
  for(const def of defs){delete g.routes.best[def.id];g.routes.worksiteRewards.delete(def.id);}
  h.teleport(s.x,s.y+TL.C.FEET+.02,s.z);h.vel.set(0,0,0);g.state='play';g.input.endFrame();
  document.getElementById('hud').style.display='block';
  return {ids:defs.map(d=>d.id),checkpoints:defs.map(d=>d.cps.length),diagnostics:TL.WorksiteRuns.diagnostics,first:d.id};
 });
 await page.keyboard.down('e');
 const input=await page.evaluate(()=>{const g=TL.game;g.tick(1/60);g.input.endFrame();return {active:g.routes.active&&g.routes.active.def.id,phase:g.routes.active&&g.routes.active.phase,frozen:g.hero.ctrl.frozen,launch:!!g.hero.ctrl.launch,encounter:!!g.encounters.active};});
 await page.keyboard.up('e');assert.equal(input.active,setup.first);assert.equal(input.phase,'countdown');assert(input.frozen&&!input.launch&&!input.encounter);
 const result=await page.evaluate(()=>{
  const g=TL.game,r=g.routes,h=g.hero.ctrl,defs=r.defs.filter(d=>d.kind==='worksite'),runs=[];
  r.exit();
  function finish(d,scale){r.begin(d);r.update(3.1);for(const c of d.cps){const n=c.n?new THREE.Vector3(c.n[0],0,c.n[1]):new THREE.Vector3(0,0,1);h.pos.set(c.x-n.x*2,c.y,c.z-n.z*2);r.active.prev.copy(h.pos);h.vel.copy(n).multiplyScalar(12);for(let i=0;i<10&&r.active.phase==='run';i++){h.pos.addScaledVector(n,.4);r.update(.05*scale);}}if(r.active.phase!=='done')throw Error('Incomplete '+d.id);if(g.ui.modal)g.ui.closeModal(true);g.state='play';}
  for(const d of defs){const xp=g.progress.xp;finish(d,1);const first=r.best[d.id],replay=JSON.stringify(first.replay);finish(d,2);if(g.progress.xp-xp!==180)throw Error('Repeated reward '+d.id);if(JSON.stringify(r.best[d.id].replay)!==replay)throw Error('Slower PB replaced '+d.id);runs.push({id:d.id,checkpoints:d.cps.length,time:first.time,samples:first.replay.samples.length,reward:g.progress.xp-xp,rewarded:r.best[d.id].rewarded});r.exit();}
  const saved=JSON.parse(JSON.stringify(r.serialize()));r.deserialize(saved);for(const d of defs)if(!r.best[d.id].rewarded)throw Error('Lost reward persistence');
  r.exit();if(g.ui.modal)g.ui.closeModal(true);g.state='play';g.input.endFrame();
  return {runs,errors:TL.errors.slice()};
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(page.errors||[],[]);return {setup,input,...result};
}
module.exports={checkInteractions};
if(require.main===module)(async()=>{const out=path.join(__dirname,'worksite_evidence');fs.mkdirSync(out,{recursive:true});const {browser,page}=await launch({headless:true,w:1280,h:720});try{
 await start(page,'THREADLINE.html','medium');await setScene(page,'roof');const result=await checkInteractions(page);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
