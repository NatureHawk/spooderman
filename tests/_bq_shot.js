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
  const out=path.join(__dirname,'runtime_facade');fs.mkdirSync(out,{recursive:true});
  const views=[
   ['north',[-5,108,504],[-5,145,300]],['south',[-5,108,504],[-5,145,700]],
   ['east',[-5,108,504],[200,145,504]],['west',[-5,108,504],[-210,145,504]],
   ['setback',[8,114,469],[8,108,397]],['street',[2,18,459],[8,45,397]],
  ];
  for(const [name,eye,target]of views){
   await page.evaluate(({eye,target})=>{const g=TL.game;g.camera.position.fromArray(eye);g.camera.lookAt(new THREE.Vector3(...target));g.env.update(.001,g.camera.position);g.scene.fog=null;g.renderer.render(g.scene,g.camera);},{eye,target});
   await page.screenshot({path:path.join(out,(process.env.TL_FACADE_LABEL||'current')+'_'+name+'.png')});
  }
  await page.evaluate(()=>{
   const g=TL.game,eye=new THREE.Vector3(8,114,469),target=new THREE.Vector3(8,108,397);
   g.scene.updateMatrixWorld(true);
   const ray=new THREE.Raycaster(eye,target.clone().sub(eye).normalize());
   const hit=ray.intersectObjects(g.streamer.nycMeshes)[0];
   if(!hit)throw Error('Close-up facade missing');
   if (TL.Buildings) { const N=TL.ScanData.nyc, B=TL.Buildings; let best=null,bd=1e9; for(const b of N.buildings){const d=Math.hypot(b.x-hit.point.x,b.z-hit.point.z); if(d<bd){bd=d;best=b;}}
     const i=B.idx.get(best), r=B.recTex.image.data.slice(i*16,i*16+16); console.log('CLOSE BLD', best.id, B.meta.mats[r[0]].id, JSON.stringify(Array.from(r).map(v=>+v.toFixed(3)))); }
   g.camera.position.copy(hit.point).addScaledVector(eye.clone().sub(hit.point).normalize(),7);
   g.camera.lookAt(hit.point);g.env.update(.001,g.camera.position);g.scene.fog=null;
   g.renderer.render(g.scene,g.camera);
  });
  await page.screenshot({path:path.join(out,(process.env.TL_FACADE_LABEL||'current')+'_close.png')});
  if(errors.length)console.log('ERRORS',errors.slice(0,5).join(' | ').slice(0,3000));assert.deepEqual(await page.evaluate(()=>TL.errors),[]);
  console.log('PASS Manhattan runtime: seven close/street/skyline views, no shader or runtime errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
