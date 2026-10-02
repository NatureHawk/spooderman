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
  const out=path.join(__dirname,'runtime_buildings');fs.mkdirSync(out,{recursive:true});
  const picks=await page.evaluate(()=>{
   const g=TL.game,B=TL.Buildings,F=TL.Facade,N=TL.ScanData.nyc,st={plain:0,blank:0,win:0};
   for(const m of g.streamer.nycMeshes){const ga=m.geometry.attributes;if(!ga.aWallSpan)continue;const r=ga.aFacRec.array,sp=ga.aWallSpan.array;
    for(let v=0;v<r.length;v+=3){if(r[v]>0)continue;const w=sp[v*4+1]-sp[v*4];if(sp[v*4]===0&&sp[v*4+1]===0&&sp[v*4+2]===0)st.plain++;else if(w<=0)st.blank++;else st.win++;}}
   const res=[];let s=0;
   for(const b of N.buildings){const tr=F.triRec.subarray(s,s+b.n);s+=b.n;
    if(tr.some(x=>x>0))continue;const i=B.idx.get(b);const style=B.recTex.image.data[i*16+3];
    if(!(style<=1)||b.h<12||b.h>40)continue;
    // a direction with open air 30 m out
    let best=null;for(let a=0;a<16;a++){const an=a*Math.PI/8,x=b.x+Math.cos(an)*30,z=b.z+Math.sin(an)*30,
      ii=Math.floor((x-B.fp.x0)/B.fp.C),jj=Math.floor((z-B.fp.z0)/B.fp.C);if(!B.fp.grid[jj*B.fp.nx+ii]){best=an;break;}}
    if(best!==null)res.push({id:b.id,x:b.x,z:b.z,h:b.h,a:best,style});}
   return {st,res:res.filter((_,k)=>k%Math.max(1,Math.floor(res.length/6))===0).slice(0,6)};
  });
  console.log('RULE WALLS',JSON.stringify(picks.st),'candidates shown',picks.res.length);
  for(const [k,p] of picks.res.entries()){
   await page.evaluate((p)=>{const g=TL.game;g.camera.position.set(p.x+Math.cos(p.a)*30,p.h*0.5+6,p.z+Math.sin(p.a)*30);g.camera.lookAt(new THREE.Vector3(p.x,p.h*0.45,p.z));g.env.update(.001,g.camera.position);g.scene.fog=null;g.renderer.render(g.scene,g.camera);},p);
   await page.screenshot({path:path.join(out,(process.env.TL_FACADE_LABEL||'cur')+'_walkup'+k+'.png')});
  }
  if(errors.length)console.log('ERRORS',errors.slice(0,5).join(' | ').slice(0,3000));assert.deepEqual(await page.evaluate(()=>TL.errors),[]);
  console.log('PASS Manhattan runtime: seven close/street/skyline views, no shader or runtime errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
