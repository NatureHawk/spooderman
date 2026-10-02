'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {launch,start,setScene}=require('./graphics_bench/lib');
(async()=>{
 const {browser,page}=await launch({headless:true,w:1280,h:720});
 const out=path.join(__dirname,process.env.TL_LOW_MULTI?'runtime_low/multi':'runtime_low');fs.mkdirSync(out,{recursive:true});
 try{
  await start(page,process.env.TL_LOW_HTML||'THREADLINE.html','high');
  const results=[];
  for(const scene of process.env.TL_LOW_MULTI?['roof']:['street','roof','skyline']){
   await setScene(page,scene);await page.evaluate(()=>BENCH.setFilter(0,0));
   const result=await page.evaluate(()=>{
    const g=TL.game,w=g.streamer,low=TL.LowManhattan;
    g.applyQuality('high');
    const physics=JSON.stringify({p:g.hero.ctrl.pos,v:g.hero.ctrl.vel,n:g.world.count,roof:w.roofState?.colliders.length});
    // Warm the high and low shader variants before comparing exact pixels.
    g.applyQuality('low');BENCH.render();g.applyQuality('high');BENCH.render();
    const before=BENCH.grab();
    const measure=()=>{BENCH.render();return {...BENCH.info(),ms:BENCH.throughput(15)};};
    const high=measure();g.applyQuality('low');
    // A/B uses identical resolution, simulation and camera; only the Low proxy differs.
    TL.LowManhattan=undefined;
    let baseline;
    if(low){const enter=low.enter;low.enter=()=>{};TL.LowManhattan=low;baseline=measure();low.enter=enter;}else baseline=measure();
    TL.LowManhattan=low;const lighter=measure();
    if(low){const originals=new Set(w.nycMeshes.map(m=>m.material));
      for(const m of w.lowRender.shells)if(m.name==='Low original facade'){
        if(!originals.has(m.material)||!m.geometry.attributes.aFacRec)throw Error('Building-specific facade was lost');
      }
      if(w.lowRender.before!==w.lowRender.after)throw Error('Original wall triangles changed');
    }
    const draws=[],undo=[];g.scene.traverse(m=>{if(!m.isMesh)return;const old=m.onBeforeRender;undo.push(()=>m.onBeforeRender=old);m.onBeforeRender=function(...args){old.apply(this,args);const gr=args[5];draws.push({name:m.name||m.parent?.name||m.type,asset:m.geometry.userData.name,parent:m.parent?.name,scan:w.group.children.includes(m),ground:m===w.ground,tris:(gr?gr.count:m.geometry.index?.count||m.geometry.attributes.position.count)/3*(m.isInstancedMesh?m.count:1)});};});
    BENCH.render();for(const fn of undo)fn();draws.sort((a,b)=>b.tris-a.tris);
    const changed=JSON.stringify({p:g.hero.ctrl.pos,v:g.hero.ctrl.vel,n:g.world.count,roof:w.roofState?.colliders.length})!==physics;
    g.applyQuality('high');const after=BENCH.grab();let pixels=0;for(let i=0;i<before.a.length;i++)if(before.a[i]!==after.a[i])pixels++;
    g.applyQuality('low');BENCH.render();
    const skin=g.hero.sk.mesh.geometry,reduced=low?.skinGeometry(skin);
    return {high,baseline,low:lighter,changed,pixels,draws:draws.slice(0,12),skin:reduced?{before:skin.index.count/3,after:reduced.index.count/3}:null,shellTriangles:w.lowRender?{before:w.lowRender.before,after:w.lowRender.after}:null,errors:TL.errors};
   });
   assert.equal(result.changed,false);assert.equal(result.pixels,0,'High must be byte-identical after Low');assert.deepEqual(result.errors,[]);
   results.push({scene,...result});console.log(scene,JSON.stringify(result));
   await page.screenshot({path:path.join(out,scene+'.png')});
  }
  await setScene(page,'street',{hour:22});
  await page.evaluate(()=>{TL.game.applyQuality('low');BENCH.render();});
  await page.screenshot({path:path.join(out,'night.png')});
  const invariants=await page.evaluate(()=>{
    const g=TL.game,w=g.streamer,cols=[...new Set([...g.world.hash.values()].flat())];
    const signature=()=>JSON.stringify(cols.map(c=>[c.id,c.cx,c.cy,c.cz,c.hx,c.hy,c.hz,c.yaw,c.solid,c.climb]));
    const initial=signature(),result={};
    for(const q of ['medium','high','ultra']){
      g.applyQuality(q);BENCH.render();const before=BENCH.grab();g.applyQuality('low');BENCH.render();g.applyQuality(q);const after=BENCH.grab();
      let max=0,diff=0;for(let i=0;i<before.a.length;i++){const d=Math.abs(before.a[i]-after.a[i]);if(d)diff++;max=Math.max(max,d);}result[q]={diff,max};
    }
    if(signature()!==initial)throw Error('Collider data changed');
    if(w.lowRender.group.visible||w.lowRender.changes.length)throw Error('Low render changes leaked');
    return {presets:result,colliders:cols.length,errors:TL.errors};
  });
  for(const [q,r]of Object.entries(invariants.presets))assert.equal(r.diff,0,q+' restored exactly');assert.deepEqual(invariants.errors,[]);console.log('invariants',JSON.stringify(invariants));
  // Inspect the reduced suit in a bent-leg pose at close range, using the actual
  // Manhattan render hook rather than replacing its mesh in the test.
  await page.evaluate(()=>{
    const g=TL.game,h=g.hero.ctrl;g.applyQuality('low');h.teleport(0,200,0);h.grounded=false;h.fsm.set(TL.TS.AIR);h.vel.set(0,-10,10);g.hero.anim.arms.setRetracted(true,true);
    for(let i=0;i<60;i++)g.hero.renderUpdate(1/60,1);
    BENCH.pose={cam:[3,200.5,2.6],at:[0,200,0],fov:35};BENCH.render();
  });
  await page.screenshot({path:path.join(out,'suit.png')});
  await page.evaluate(()=>{const save=TL.LowManhattan.enter;TL.LowManhattan.enter=()=>{};BENCH.render();TL.LowManhattan.enter=save;});
  await page.screenshot({path:path.join(out,'suit-original.png')});
  assert.deepEqual(page.errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
