'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),{pathToFileURL}=require('url');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer=require(path.join(harness,'node_modules/puppeteer-core'));
(async()=>{const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setViewport({width:1100,height:800});await page.setRequestInterception(true);
  page.on('request',r=>r.url().includes('/three@')?r.respond({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/javascript',body:fs.readFileSync(path.join(harness,'node_modules/three/build/three.min.js'))}):r.continue());
  await page.goto(pathToFileURL(path.join(__dirname,'../THREADLINE.html')).href);await page.waitForFunction(()=>window.__TL&&TL.game.state==='title',{timeout:60000});
  const stats=await page.evaluate(async()=>{
   const g=TL.game;await TL.ScanData.load();TL.Input.prototype.lock=function(){};g.startGame({seed:'MAN'});g.state='inspection';window.requestAnimationFrame=()=>0;g.hero.setVisible(false);
   g.renderer.setPixelRatio(1);g.renderer.setSize(1100,800);g.camera.aspect=1100/800;g.camera.fov=55;g.camera.far=2400;g.camera.updateProjectionMatrix();
   for(const e of [...document.body.children])if(e!==g.renderer.domElement)e.style.display='none';g.env.forced='clear';g.env.hour=11;g.env.rain=g.env.wet=0;
   const r=g.streamer.roofState;return {surfaces:r.roofTriangles,props:r.placements.length,colliders:r.colliders.length,types:r.placements.reduce((a,p)=>(a[p.type]=(a[p.type]||0)+1,a),{})};
  });console.log('Runtime rooftops',stats);
  const out=path.join(__dirname,'runtime_rooftops');fs.mkdirSync(out,{recursive:true});
  for(const name of (process.env.TL_PREVIEW_ANTENNA_ONLY?['antenna']:['setback','roof153','roof354','hvac','tank','copper','rain'])){
   await page.evaluate(name=>{
    const g=TL.game,R=g.streamer.roofState;g.env.hour=11;g.env.rain=g.env.wet=name==='rain'?.8:0;g.env.forced=name==='rain'?'rain':'clear';
    let p,d;
    if(name.startsWith('roof')||name==='setback'){
     const bid=name==='setback'?480:+name.slice(4),a=R.analyses.find(a=>a.b.id===bid),L=a.levels[0];p=new THREE.Vector3((L.minX+L.maxX)/2,L.y,(L.minZ+L.maxZ)/2);const size=Math.max(L.maxX-L.minX,L.maxZ-L.minZ);d=new THREE.Vector3(size*.75,size*.9,size*.8);
    }else if(name==='copper'){
     const a=R.analyses.find(a=>a.faces.some(f=>f.kind===2&&f.area>80)),f=a.faces.find(f=>f.kind===2&&f.area>80);p=new THREE.Vector3((f.p[0]+f.p[3]+f.p[6])/3,f.y,(f.p[2]+f.p[5]+f.p[8])/3);d=new THREE.Vector3(15,18,20);
    }else{
     const type=name==='antenna'?'antenna':name==='tank'?'tank':'hvac',v=R.placements.find(p=>p.type===type&&p.y>40)||R.placements.find(p=>p.type===type);p=new THREE.Vector3(v.x,v.y+(type==='antenna'?3.5:type==='tank'?2.5:.7),v.z);d=type==='antenna'?new THREE.Vector3(10,7,12):type==='tank'?new THREE.Vector3(9,7,11):new THREE.Vector3(5.5,4.7,6);
    }
    g.camera.position.copy(p).add(d);g.camera.lookAt(p);g.env.update(.001,p);g.scene.fog=null;g.renderer.render(g.scene,g.camera);
   },name);
   await page.screenshot({path:path.join(out,name+'.png')});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);console.log('PASS roof, HVAC, water tank, copper crown and wet material render without shader/runtime errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
