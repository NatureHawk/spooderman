/* Repeatable Chrome/D3D11 graphics matrix and synchronized frame measurements.
   node tests/graphics_upgrade_browser.js [--quick] [--procedural-only]
   Full run: every quality x day/night/rain in both city modes, LOD views, resources.
   Timing is a fixed 960x540 scene with GPU readback, not a promised gameplay FPS. */
'use strict';
const fs=require('fs'),assert=require('assert');
const {launch,start,setScene}=require('./graphics_bench/lib');
const out='evidence/upgrade_graphics';fs.mkdirSync(out,{recursive:true});
const quick=process.argv.includes('--quick'),proceduralOnly=process.argv.includes('--procedural-only');
(async()=>{
 const report={modes:[],limits:'Hardware Chrome at 960x540, fixed camera, synchronized GPU readback. Full city play, higher resolutions and other hardware can differ.'};
 for(const mode of proceduralOnly?['procedural']:quick?['scan']:['scan','procedural']){
  const {browser,page}=await launch({headless:true,w:960,h:540});
  try{
   if(mode==='procedural')await page.evaluateOnNewDocument(()=>{window.__preStart=()=>{const original=TL.Game.prototype.startGame;TL.Game.prototype.startGame=function(opts){return original.call(this,Object.assign({},opts,{seed:12345}));};};});
   console.log('BOOT',mode);await start(page,'THREADLINE.html','high');
   if(mode==='scan')await setScene(page,'street',{settle:1});
   else await page.evaluate(()=>{const g=TL.game,p=g.hero.ctrl.pos;BENCH.pose={cam:[p.x+5,p.y+8,p.z-10],at:[p.x,p.y+2,p.z+30]};BENCH.applyPose();g.env.hour=14;g.env.forced='clear';g.env.rain=g.env.rainTarget=g.env.wet=0;g.env.update(0,p);});
   const result={mode,matrix:[]};
   // Same warmup/sample counts and camera as the pre-upgrade baseline.
   result.timing=await page.evaluate(()=>{const g=TL.game,R=TL.Render;let faces=0,filters=0;const capture=R.captureFace,blur=R.blurCube;R.captureFace=function(...a){faces++;return capture.apply(this,a)};R.blurCube=function(...a){filters++;return blur.apply(this,a)};
    for(let i=0;i<18;i++){BENCH.render();BENCH.sync();}faces=filters=0;const ms=[];for(let i=0;i<96;i++){const t=performance.now();BENCH.render();BENCH.sync();ms.push(performance.now()-t);}R.captureFace=capture;R.blurCube=blur;return {quality:g.quality,viewport:[960,540],stationary:BENCH.stats(ms),faces,filters,resources:{...g.renderer.info.memory,programs:g.renderer.info.programs.length},gpu:TL.Perf.gpu||null};});
   console.log('TIMING',mode,JSON.stringify(result.timing));
   if(quick) result.schedulerAB=await page.evaluate(()=>{
    const g=TL.game,R=TL.Render,modern=R.update,capture=R.captureFace,blur=R.blurCube;
    const runs={recurring:{ms:[],faces:0,filters:0},paced:{ms:[],faces:0,filters:0}};let active;
    R.captureFace=function(...a){active.faces++;return capture.apply(this,a)};R.blurCube=function(...a){active.filters++;return blur.apply(this,a)};
    // Reproduce the former periodic policy on the same upgraded scene/materials,
    // alternated with the new policy to separate scheduling cost from other changes.
    const recurring=function(r,scene,camera){this.build(r);this.frame++;if(this.frame%this.cfg.period)return;if(this.face===0)this._center.copy(camera.position);this.captureFace(r,scene,camera,this.face);this.face=(this.face+1)%6;if(this.face===0)this.publish(r,scene);};
    for(let round=0;round<3;round++)for(const name of round%2?['paced','recurring']:['recurring','paced']){
      active=runs[name];R.face=0;R._cycle=false;R._pendingFilter=false;
      R._center.copy(g.camera.position);R._publishedCenter.copy(g.camera.position);R._publishedAt=performance.now();
      R.update=name==='paced'?modern:recurring;
      for(let i=0;i<96;i++){const t=performance.now();BENCH.render();BENCH.sync();active.ms.push(performance.now()-t);}
    }
    R.update=modern;R.captureFace=capture;R.blurCube=blur;R.face=0;R._cycle=false;R._pendingFilter=false;
    return Object.fromEntries(Object.entries(runs).map(([name,r])=>[name,{frames:BENCH.stats(r.ms),faces:r.faces,filters:r.filters}]));
   });
   if(quick)console.log('SCHEDULER_AB',JSON.stringify(result.schedulerAB));
   for(const quality of quick?['high']:['high','medium','low','ultra']){
    await page.evaluate(q=>{const g=TL.game;g.applyQuality(q);if(g.streamer.trees)g.streamer.trees.setQuality(q);},quality);
    for(const weather of quick?['day']:['day','night','rain']){
     const check=await page.evaluate(({weather})=>{const g=TL.game,e=g.env;e.hour=weather==='night'?21.5:14;e.forced=weather==='rain'?'rain':'clear';e.weather=e.forced;e.rain=e.rainTarget=weather==='rain'?1:0;e.wet=e.rain;e.dayLen=1e12;e.weatherT=1e9;BENCH.applyPose();e.update(0,g.hero.ctrl.pos);
      if(g.streamer.trees)g.streamer.trees.update(g.camera,1/60,{sunDir:e.skyU.uSunDir.value,sunColor:e.sun.color.clone().multiplyScalar(e.sun.intensity),rain:e.rain});
      for(let i=0;i<44;i++){BENCH.render();BENCH.sync();}
      const gl=BENCH.gl,pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];
      return {mean:sum/(pixels.length/4)/3,glError:gl.getError(),lost:gl.isContextLost(),errors:TL.errors.slice(),tree:g.streamer.trees&&g.streamer.trees.stats,resources:{...g.renderer.info.memory,programs:g.renderer.info.programs.length},probeBuffers:!!TL.Render.captureProbe};
     },{weather});
     assert.equal(check.glError,0,`${mode}/${quality}/${weather} GL`);assert(!check.lost);assert(check.mean>2,`${mode}/${quality}/${weather} black`);assert.deepEqual(check.errors,[]);
     result.matrix.push({quality,weather,...check});console.log('OK',mode,quality,weather);
     if(quality==='high'||quality==='ultra'&&weather==='rain'||quality==='low'&&weather==='day')await page.screenshot({path:`${out}/${mode}_${quality}_${weather}.png`});
    }
   }
   if(mode==='scan'){
    await page.evaluate(()=>{
     const g=TL.game, original=g.streamer.trees;
     // Isolate a real asset so nearby city geometry cannot hide the transition.
     const md=original.data.models[original.list[0].m], copy=Object.assign({},md,{lods:md.lods.map(l=>({bark:l.bark&&l.bark.clone(),leaf:l.leaf&&l.leaf.clone()}))});
     const data=Object.assign({},original.data,{models:[copy]});
     const scene=new THREE.Scene();scene.background=new THREE.Color(0x829aaf);scene.add(new THREE.HemisphereLight(0xffffff,0x667755,.9));
     const sun=new THREE.DirectionalLight(0xfff0dd,2);sun.position.set(20,50,25);scene.add(sun);
     const field=new TL.TreeField(scene,g.renderer,data,[{x:0,z:0,m:0,s:1}],{quality:'high',impostors:false});
     const camera=new THREE.PerspectiveCamera(38,960/540,.1,1000);
     window.__treeView={scene,field,camera,data};
    });
    for(const offset of [-5,0,5]){
     await page.evaluate(offset=>{const {scene,field,camera}=window.__treeView;camera.position.set(0,field.bs[1],field.d0+field.bs[3]+offset);camera.lookAt(0,field.bs[1],0);camera.updateMatrixWorld();field.update(camera,1/60,{sunDir:new THREE.Vector3(.4,.8,.4).normalize(),sunColor:new THREE.Color(2,1.9,1.7)});TL.game.renderer.setRenderTarget(null);TL.game.renderer.render(scene,camera);BENCH.sync();},offset);
     await page.screenshot({path:`${out}/tree_transition_${offset}.png`});
    }
    await page.evaluate(()=>{const t=window.__treeView;t.field.dispose();for(const l of t.data.models[0].lods)for(const geo of Object.values(l))if(geo)geo.dispose();delete window.__treeView;BENCH.render();BENCH.sync();});
   }
   result.stability=await page.evaluate(()=>{const g=TL.game;for(let i=0;i<54;i++){BENCH.render();BENCH.sync();}const before={...g.renderer.info.memory,programs:g.renderer.info.programs.length};for(let i=0;i<180;i++){BENCH.render();BENCH.sync();}return {before,after:{...g.renderer.info.memory,programs:g.renderer.info.programs.length},errors:TL.errors.slice()};});
   assert.deepEqual(result.stability.after,result.stability.before,'resources grow during repeated updates');
   assert.deepEqual(page.errors,[],'browser console errors');report.modes.push(result);
   fs.writeFileSync(`${out}/after${quick?'_quick':proceduralOnly?'_procedural':''}.json`,JSON.stringify(report,null,2));
  }finally{await browser.close();}
 }
 console.log('PASS graphics quality/weather/mode matrix, screenshots, timing and stable repeated-update resources');
})().catch(e=>{console.error(e);process.exitCode=1;});
