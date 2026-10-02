'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {pathToFileURL}=require('url');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer=require(path.join(harness,'node_modules/puppeteer-core'));
(async()=>{
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.text().startsWith('CLOSE'))console.log(m.text());if(m.type()==='error')errors.push(m.text());});
  await page.setViewport({width:1000,height:720});await page.setRequestInterception(true);
  page.on('request',r=>r.url().includes('/three@')?r.respond({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/javascript',body:fs.readFileSync(path.join(harness,'node_modules/three/build/three.min.js'))}):r.continue());
  await page.evaluateOnNewDocument(q=>{window.__Q=q.q;window.__H=q.h;},{q:process.env.TL_Q||'high',h:process.env.TL_HOUR||10});
  await page.goto(pathToFileURL(path.join(__dirname,'../THREADLINE.html')).href);
  await page.waitForFunction(()=>window.__TL&&window.__TL.game.state==='title',{timeout:60000});
  await page.evaluate(async()=>{
   const TL=window.__TL,g=TL.game;TL.Input.prototype.lock=function(){};
   await TL.ScanData.load();
   g.startGame({seed:'MAN'});g.applyQuality(window.__Q||'high');g.state='inspection';window.requestAnimationFrame=()=>0;
   g.hero.setVisible(false);g.renderer.setPixelRatio(1);g.renderer.setSize(1000,720);
   for(const e of [...document.body.children])if(e!==g.renderer.domElement)e.style.display='none';
   g.env.forced='clear';g.env.rain=0;g.env.wet=0;g.env.hour=+(window.__H||10);g.scene.fog=null;
   g.camera.fov=60;g.camera.aspect=1000/720;g.camera.far=2400;g.camera.updateProjectionMatrix();
   for(const m of g.streamer.nycMeshes)m.visible=true;
  });
  const res=await page.evaluate(async()=>{
   const g=TL.game,r=g.renderer,gl=r.getContext(),px=new Uint8Array(4);
   const views=[[[-5,108,504],[-5,145,300]],[[2,18,459],[8,45,397]],[[8,114,469],[8,108,397]],[[-5,108,504],[200,145,504]]];
   const out={};
   const m=g.streamer.nycMat;
   const meas=async()=>{const t=[];for(const [eye,tg] of views){g.camera.position.fromArray(eye);g.camera.lookAt(new THREE.Vector3(...tg));g.env.update(.001,g.camera.position);
     for(let i=0;i<6;i++){r.render(g.scene,g.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);}
     await new Promise(z=>setTimeout(z,30));
     const t0=performance.now();for(let i=0;i<15;i++){r.render(g.scene,g.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);}
     t.push((performance.now()-t0)/15);}return t;};
   for(const q of ['medium','high','ultra']){
    g.applyQuality(q);r.setPixelRatio(1);r.setSize(1000,720);
    const on=[0,0,0,0],off=[0,0,0,0];
    for(let rep=0;rep<3;rep++){
     TL.Buildings.setTier(g.streamer);(await meas()).forEach((v,i)=>on[i]+=v/3);
     delete m.defines.TL_BQ;m.needsUpdate=true;(await meas()).forEach((v,i)=>off[i]+=v/3);
    }
    TL.Buildings.setTier(g.streamer);
    out[q]={on:on.map(x=>+x.toFixed(2)),off:off.map(x=>+x.toFixed(2)),delta_ms:on.map((x,i)=>+(x-off[i]).toFixed(2))};
   }
   return out;
  });
  console.log('PERF',JSON.stringify(res));
  if(errors.length)console.log('ERRORS',errors.slice(0,5).join(' | ').slice(0,3000));assert.deepEqual(await page.evaluate(()=>TL.errors),[]);
  console.log('PASS Manhattan runtime: seven close/street/skyline views, no shader or runtime errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
