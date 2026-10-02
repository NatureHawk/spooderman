'use strict';
const {launch,start}=require('./graphics_bench/lib');
const assert=require('assert'),fs=require('fs'),path=require('path');
(async()=>{
 const {browser,page}=await launch({headless:true,w:800,h:600});
 const out=path.join(__dirname,'runtime_low_web');fs.mkdirSync(out,{recursive:true});
 try{for(const [label,file]of [['single','THREADLINE.html'],['multi','hosting/threadline_multi/THREADLINE_multi.html']]){
  await start(page,file,'low');
  const result=await page.evaluate(()=>{
   const g=TL.game,w=g.streamer,h=g.hero.ctrl,web=g.hero.ropes[0],r=h.tether.main;
   BENCH.setFilter(0,0);BENCH.render();
   if(w.lowRender.other.includes(web.mesh))throw Error('Dynamic web registered as static scenery');
   const old=web.mesh.onBeforeRender;let draws=0;web.mesh.onBeforeRender=function(...args){draws++;old.apply(this,args);};
   const results=[];
   for(const x of [0,700])for(const attached of [false,true]){
    const from=new THREE.Vector3(x,600,0);r.active=true;r.attached=attached;r.hand='L';r.anchor.set(x+10,616,8);r.bends.length=0;r.L=22;r.tension=60;r.shotT=.1;
    web.update(1/60,from,r,attached?1:.65);
    // Deliberately wrong static bounds must never hide a deforming rope.
    web.mesh.geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(-10000,0,-10000),1);
    BENCH.pose={cam:[x+18,608,28],at:[x+5,608,4],fov:45};BENCH.applyPose();g.env.hour=22;g.env.update(0,from);
    draws=0;const shown=BENCH.grab();if(draws===0)throw Error('Active web not drawn');
    web.hide();const hidden=BENCH.grab();let pixels=0;for(let i=0;i<shown.a.length;i+=4)if(shown.a[i]!==hidden.a[i]||shown.a[i+1]!==hidden.a[i+1]||shown.a[i+2]!==hidden.a[i+2])pixels++;
    if(pixels<10)throw Error('Web has no visible pixels');
    web.mesh.visible=true;BENCH.render();results.push({x,attached,pixels});
   }
   web.mesh.onBeforeRender=old;return {results,errors:TL.errors};
  });
  assert.deepEqual(result.errors,[]);console.log(label,JSON.stringify(result));
  await page.screenshot({path:path.join(out,label+'.png')});
 }assert.deepEqual(page.errors,[]);}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
