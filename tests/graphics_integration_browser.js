'use strict';
const {launch,start,setScene,SCENES}=require('./graphics_bench/lib');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const {browser,page}=await launch({headless:true,w:1600,h:900});
 const out=path.join(__dirname,'integration-results');fs.mkdirSync(out,{recursive:true});
 try{
  await start(page,path.join(__dirname,'../THREADLINE.html'));
  const results=[];
  for(const scene of Object.keys(SCENES)){
   await setScene(page,scene);
   const result=await page.evaluate(()=>{
    const g=TL.game,cells=g.streamer.roofState.meshes.filter(m=>m.isInstancedMesh&&m.frustumCulled),batches=[...g.scene.userData.__instanceCull];
    BENCH.setFilter(0,0);BENCH.render();
    // Toggle only the two newly integrated culling paths. Disabling THREE's
    // global frustum test also changes unrelated city / particle / light draws.
    const originals=batches.map(b=>b.cull);let A;
    try{for(const m of cells)m.frustumCulled=false;batches.forEach((b,i)=>b.cull=function(F,S){originals[i].call(this,{intersectsSphere:()=>true},S);});A=BENCH.grab().a;}
    finally{for(const m of cells)m.frustumCulled=true;batches.forEach((b,i)=>b.cull=originals[i]);}
    const B=BENCH.grab().a;let pixels=0,max=0;for(let i=0;i<A.length;i+=4){const d=Math.max(Math.abs(A[i]-B[i]),Math.abs(A[i+1]-B[i+1]),Math.abs(A[i+2]-B[i+2]));if(d){pixels++;max=Math.max(max,d);}}
    return{pixels,max,cells:g.streamer.roofState.meshes.length,passages:g.world.referenceGates.length,live:[...g.scene.userData.__instanceCull].reduce((n,b)=>n+b.n,0),visible:[...g.scene.userData.__instanceCull].reduce((n,b)=>n+b.mesh.count,0)};
   });
   results.push({scene,...result});console.log(scene,result);assert.equal(result.pixels,0,'culling changed '+scene);assert(result.passages>=34);
   if(['street','rain','night'].includes(scene)){await page.evaluate(()=>{BENCH.setFilter(2,3);BENCH.render();});await page.screenshot({path:path.join(out,scene+'-ultimate.png')});}
  }
  const memory=await page.evaluate(()=>{
   const g=TL.game,gl=g.renderer.getContext();BENCH.setFilter(0,0);
   for(let i=0;i<3;i++){g.env.updateEnv();BENCH.render();}BENCH.sync();
   const before=g.renderer.info.programs.length,net={textures:0,framebuffers:0,renderbuffers:0},saved={};
   for(const [noun,key]of [['Texture','textures'],['Framebuffer','framebuffers'],['Renderbuffer','renderbuffers']])for(const [verb,d]of [['create',1],['delete',-1]]){const name=verb+noun;saved[name]=gl[name];gl[name]=function(...args){net[key]+=d;return saved[name].apply(this,args);};}
   try{for(let i=0;i<10;i++){g.env.updateEnv();BENCH.render();}BENCH.sync();}finally{for(const name in saved)gl[name]=saved[name];}
   return{...net,programsBefore:before,programsAfter:g.renderer.info.programs.length};
  });console.log('Environment resource balance',memory);assert.equal(memory.textures,0);assert.equal(memory.framebuffers,0);assert.equal(memory.renderbuffers,0);assert.equal(memory.programsBefore,memory.programsAfter);
  assert.deepEqual(page.errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);
  fs.writeFileSync(path.join(out,'graphics-runtime.json'),JSON.stringify({scenes:results,memory,errors:page.errors},null,2));
  console.log('PASS culling preserves pixels, traversal props survive, environment resources and shaders remain stable');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
