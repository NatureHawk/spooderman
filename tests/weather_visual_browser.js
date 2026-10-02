'use strict';
const {launch,start,setScene}=require('./graphics_bench/lib');
const fs=require('fs'),assert=require('assert');
(async()=>{const {browser,page}=await launch({headless:true,w:1280,h:720});try{
 await start(page,process.env.TL_WEATHER_HTML||'THREADLINE.html','high');await setScene(page,'roof',{hour:21});
 const out=process.env.TL_WEATHER_HTML?'tests/runtime_weather_multi':'tests/runtime_weather';
 fs.mkdirSync(out,{recursive:true});
 for(const weather of ['snow','rain','clear']){
  const result=await page.evaluate(weather=>{
   const g=TL.game,r=g.rain;g.env.weather=weather;
   for(let i=0;i<60;i++)r.update(1/60,g.camera.position,g.wind.base,weather==='rain'?0.8:0);
   BENCH.setFilter(2,3);BENCH.render();
   return {snow:r.snow.visible,rain:r.mesh.visible,snowCount:r.snow.geometry.drawRange.count,
    depth:r.mesh.material.depthWrite||r.snow.material.depthWrite,
    finite:Array.from(r.snowPos).every(Number.isFinite),errors:TL.errors};
  },weather);
  assert.equal(result.snow,weather==='snow');assert.equal(result.rain,weather==='rain');
  assert.equal(result.depth,false);assert.equal(result.finite,true);assert.deepEqual(result.errors,[]);
  await page.screenshot({path:out+'/'+weather+'.png'});console.log(weather,result);
 }assert.deepEqual(page.errors,[]);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
