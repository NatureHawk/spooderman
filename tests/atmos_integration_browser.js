'use strict';
const {launch,start,setScene}=require('./graphics_bench/lib');
const assert=require('assert');
(async()=>{const {browser,page}=await launch({headless:true,w:960,h:540});try{
 await start(page,'THREADLINE.html','low');await setScene(page,'roof');
 const result=await page.evaluate(()=>{
  const g=TL.game,A=TL.Atmos,oldSky=g.env.sky.material.fragmentShader,oldWater=g.waterMat.fragmentShader;
  const checks=[];
  for(const quality of ['ultra','medium','low']){
   g.applyQuality(quality);g.env.update(0,g.hero.ctrl.pos);BENCH.render();
   if(quality==='low'&&(g.env.sky.material.fragmentShader!==oldSky||g.waterMat.fragmentShader!==oldWater||A.hz.p.x!==0))throw Error('Low atmosphere not restored');
   checks.push(quality);
  }
  g.applyQuality('ultra');g.env.update(0,g.hero.ctrl.pos);
  const original=TL.Shafts.render;let calls=0;TL.Shafts.render=function(...args){calls++;return original.apply(this,args);};
  for(const style of [1,2]){BENCH.setFilter(style,1);BENCH.render();}
  TL.Shafts.render=original;
  if(calls)throw Error('Shafts unexpectedly rendered over comic filter');
  return {checks,filterShaftCalls:calls,errors:TL.errors};
 });assert.deepEqual(result.errors,[]);assert.deepEqual(page.errors,[]);console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
