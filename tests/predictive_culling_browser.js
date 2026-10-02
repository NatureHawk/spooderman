'use strict';
const {launch,start,setScene}=require('./graphics_bench/lib');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{const {browser,page}=await launch({headless:true,w:960,h:540});const out=path.join(__dirname,'runtime_predictive');fs.mkdirSync(out,{recursive:true});
try{
 await start(page,process.env.TL_PREDICT_HTML||'THREADLINE.html','high');await setScene(page,'roof');
 const result=await page.evaluate(()=>{
  const g=TL.game,w=g.streamer,C=TL.LowManhattan,h=g.hero.ctrl,L=w.lowRender;
  const results=[],pos=h.pos.clone(),velocity=h.vel.clone(),colliders=g.world.count;
  g.settings.renderDist=900;
  for(const quality of ['low','medium','high','ultra']){
   g.applyQuality(quality);L.lead.set(0,0,0);
   let maxWarm=0,forward=0;
   for(let i=0;i<20;i++){C.prepare(w,new THREE.Vector3(80,0,0),1/60);maxWarm=Math.max(maxWarm,L.preparedThisFrame);BENCH.render();}
   forward=L.lead.x;if(!Number.isFinite(forward)||forward<=0)throw Error('Invalid predicted position');
   if(maxWarm>C.budgets[quality].warm)throw Error('Exceeded per-frame warm-up budget');
   const warm=L.warmScene.children.filter(m=>m.isMesh).length;if(warm)throw Error('Warm proxy leaked');
   if(g.renderer.getScissorTest())throw Error('Scissor state leaked');
   if(L.changes.length||L.group.visible)throw Error('Visibility state leaked');
   for(let i=0;i<120;i++)C.prepare(w,new THREE.Vector3(-80,-10,0),1/60);
   if(L.lead.x>=0||L.lead.y>=0)throw Error('Prediction did not follow reversal/dive');
   // A fast camera turn must show ready in-range chunks immediately.
   const oldPose=BENCH.pose;BENCH.pose={cam:[-38,50,126],at:[120,70,126]};BENCH.render();BENCH.pose=oldPose;BENCH.render();
   results.push({quality,range:L.policy.range,forward,maxWarm,pending:L.pending,render:BENCH.info()});
  }
  if(h.pos.distanceTo(pos)||h.vel.distanceTo(velocity)||g.world.count!==colliders)throw Error('Render preparation changed physics');
  return {results,colliders,errors:TL.errors};
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(page.errors,[]);console.log(JSON.stringify(result));
 await page.screenshot({path:path.join(out,'ultra.png')});fs.writeFileSync(path.join(out,process.env.TL_PREDICT_HTML?'multi.json':'single.json'),JSON.stringify(result,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
