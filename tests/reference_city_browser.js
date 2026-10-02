'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),{pathToFileURL}=require('url');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer=require(path.join(harness,'node_modules/puppeteer-core'));
(async()=>{const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:900,height:650});await page.setRequestInterception(true);
 page.on('request',r=>r.url().includes('/three@')?r.respond({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/javascript',body:fs.readFileSync(path.join(harness,'node_modules/three/build/three.min.js'))}):r.continue());
 await page.goto(pathToFileURL(path.join(__dirname,'../THREADLINE.html')).href);await page.waitForFunction(()=>window.__TL&&TL.game.state==='title',{timeout:60000});
 console.log(await page.evaluate(async()=>{await TL.ScanData.load();const g=TL.game;TL.Input.prototype.lock=function(){};g.startGame({seed:'MAN'});g.state='inspection';window.requestAnimationFrame=()=>0;
 g.renderer.setPixelRatio(1);g.renderer.setSize(900,650);g.camera.aspect=900/650;g.camera.fov=50;g.camera.updateProjectionMatrix();for(const el of [...document.body.children])if(el!==g.renderer.domElement)el.style.display='none';g.env.hour=11;g.env.forced='clear';g.env.rain=0;
 return{gates:g.world.referenceGates.map(x=>x.type).reduce((o,k)=>(o[k]=(o[k]||0)+1,o),{}),tunnels:g.wind.tunnels?.length,thermals:g.wind.updrafts.length};}));
 const out=path.join(__dirname,'runtime_motion');
 for(const type of ['duct','pipe','water_tower']){
  console.log(type,await page.evaluate(type=>{
   const g=TL.game,h=g.hero.ctrl;const gates=g.world.referenceGates.filter(x=>x.type===type);let selected=null;
   for(const gate of gates){h.teleport(...gate.center.clone().addScaledVector(gate.axis,-8).toArray());h.grounded=false;h.fsm.set(TL.TS.AIR);h.vel.copy(gate.axis).multiplyScalar(14);h.reference=null;
    const it={move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:gate.axis.clone(),camRight:new THREE.Vector3(-gate.axis.z,0,gate.axis.x),tether:true};
    if(TL.ReferenceTraversal.passage(h,it)){selected={gate,it};break;}
   }
   if(!selected)throw Error('No usable '+type+' opening');
   window.passProbe=selected;window.passProbe.frames=0;h.step(1/120,selected.it);selected.it.tether=false;
   if(h.reference.action?.kind!=='pass_through')throw Error('Pass did not start');return{at:selected.gate.center.toArray()};
  },type));
  for(const n of [15,35,60,100]){
   const result=await page.evaluate(n=>{
    const g=TL.game,h=g.hero.ctrl,p=window.passProbe;for(;p.frames<n;p.frames++){h.step(1/120,p.it);g.hero.renderUpdate(1/120,1);}
    const side=new THREE.Vector3(p.gate.axis.z,0,-p.gate.axis.x);g.camera.position.copy(p.gate.center).addScaledVector(side,7).addScaledVector(p.gate.axis,-5);g.camera.position.y+=3;g.camera.lookAt(p.gate.center);g.env.update(.001,h.pos);g.renderer.render(g.scene,g.camera);
    return{state:h.state,action:h.reference.action?.kind,along:h.pos.clone().sub(p.gate.center).dot(p.gate.axis)};
   },n);console.log(n,result);await page.screenshot({path:path.join(out,'pass_'+type+'_'+n+'.png')});
  }
  const along=await page.evaluate(()=>{const h=TL.game.hero.ctrl,p=window.passProbe;for(let i=0;i<100;i++)h.step(1/120,p.it);return h.pos.clone().sub(p.gate.center).dot(p.gate.axis);});assert(along>3,type+' exits physical passage');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);console.log('PASS Manhattan hollow ducts, hoisted pipes and water tower openings are reachable and traversable');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
