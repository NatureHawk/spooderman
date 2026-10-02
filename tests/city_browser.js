'use strict';
const fs=require('fs'),path=require('path');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer=require(path.join(harness,'node_modules/puppeteer-core'));
(async()=>{
 const label=process.argv[2]||'after',out=path.resolve(__dirname,'../evidence/city-activity');fs.mkdirSync(out,{recursive:true});
 const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
 try {
 const p=await b.newPage();await p.setViewport({width:1280,height:720});p.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await p.goto('file:///'+path.resolve(__dirname,'../THREADLINE.html').replaceAll('\\','/'),{timeout:180000});
 await p.waitForFunction(()=>window.TL&&TL.game&&TL.game.state==='title',{timeout:180000});
 await p.evaluate(label=>{document.getElementById('qSel').value='high';if(label.includes('MAN'))document.getElementById('seedIn').value='MAN';[...document.querySelectorAll('#titleMenu button')].find(x=>x.textContent.startsWith('New Game')).click();},label);
 await p.waitForFunction(()=>['play','paused'].includes(TL.game.state),{timeout:180000});
 await p.evaluate(()=>{const g=TL.game;if(g.ui.modal)g.ui.closeModal(true);g.state='play';g.settings.autoFollow=0;g.env.hour=14;g.missions.crimeT=9999;g.input.lock=()=>{};clearTimeout(g.input._lockT);g.ui.showResume(false);});
 const results=[];
 for(const [name,pos] of [['street',[-52,1,-217]],['roof',[-212,80,-280]]]){
  await p.evaluate(pos=>{const g=TL.game;g.hero.ctrl.teleport(...pos);g.rig.yaw=-2.2;g.rig.pitch=.15;g.streamer.forceLoadAround(g.hero.ctrl.pos,90);},pos);
  await new Promise(r=>setTimeout(r,4000));
  results.push(await p.evaluate(async name=>{const g=TL.game,samples=[];let prev=performance.now();for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);const t=performance.now();samples.push(t-prev);prev=t;}samples.sort((a,b)=>a-b);return {name,medianMs:samples[60],p95Ms:samples[114],drawCalls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,peds:g.crowd.count,vehicles:g.traffic.count,position:g.hero.ctrl.pos.toArray(),errors:TL.errors};},name));
  await p.screenshot({path:path.join(out,label+'-'+name+'.png')});
 }
 fs.writeFileSync(path.join(out,label+'-performance.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 if(label==='afterMAN'||label==='afterFull'){
  const setup=await p.evaluate(()=>{const g=TL.game;g.cityLife.cleanupIncident();g.cityLife.incidentT=9999;
    return {sites:g.cityLife.roofSites().length,workers:g.cityLife.workers.length,supports:g.streamer.roofState.colliders.filter(c=>c.supportType).length};});console.log('SETUP',setup);
  const shots=[];
  for(const type of ['rail','cap','platform','rounded']){
   const sample=await p.evaluate(type=>{const g=TL.game,h=g.hero.ctrl,c=g.streamer.roofState.colliders.find(c=>c.supportType===type&&(type==='rounded'||c.hx>.5));if(!c)return {type,missing:true};
    g.cityLife.cleanupIncident();h.teleport(c.cx,c.top+1,c.cz);TL.PerchSupport.enter(h,c,h.pos,c.yaw);h.fsm.set(TL.TS.PERCH,'qa');h.prevPos.copy(h.pos);
    g.hero.anim.arms?.setRetracted(true,true);g.rig.yaw=c.yaw+.7;g.rig.pitch=.1;g.rig.smoothT.copy(h.pos);g.rig.dist=4.5;g.rig.curDist=4.5;
    g.streamer.forceLoadAround(h.pos,90);return {type,position:h.pos.toArray(),support:{width:c.hx*2,depth:c.hz*2}};},type);
   if(sample.missing)continue;
   await new Promise(r=>setTimeout(r,1200));
   sample.contacts=await p.evaluate(()=>{const g=TL.game,a=g.hero.anim;return {hands:Object.fromEntries(Object.entries(a.handWorld).map(([s,v])=>[s,v.toArray()])),feet:['L','R'].map(s=>a.rig.bones['foot'+s].getWorldPosition(new THREE.Vector3()).toArray()),state:g.hero.ctrl.state,retracted:a.arms?.retracted};});shots.push(sample);
   await p.screenshot({path:path.join(out,'perch-'+type+'.png')});
  }
  for(const kind of ['roof','ledge','street']){
   const created=await p.evaluate(kind=>{const g=TL.game,L=g.cityLife;L.cleanupIncident();L.incidentT=9999;
    if(kind==='street'){
      g.hero.ctrl.teleport(-52,1,-217);for(let i=0;i<60;i++)g.traffic.spawnVehicle(g.hero.ctrl.pos);const v=g.traffic.vehicles.find(v=>v.s>Math.min(6,v.seg.len*.2)&&v.s<v.seg.len-Math.min(6,v.seg.len*.2));if(!v)return {error:'no vehicle'};
      v.speed=0;g.hero.ctrl.teleport(v.pos.x+30,1,v.pos.z);g.traffic.render(v,30);
    }else {
      const site=L.roofSites().find(s=>!L.workers.some(w=>w.site===s));if(!site)return {error:'no site'};
      for(const w of [...L.workers])L.removeWorker(w);
      // Release nearby street skin slots before allocating this deterministic worker.
      for(const ped of g.crowd.peds)if(ped.skin){ped.skin.owner=null;ped.skin.sk.mesh.visible=false;ped.skin=null;}
      const w=L.worker(site);if(!w)return {error:'no worker skin'};g.hero.ctrl.teleport(site.a.x+24,site.a.y+1,site.a.z);
    }
    if(!L.startIncident(kind))return {error:'ineligible '+kind};
    const I=L.incident,h=g.hero.ctrl;
    if(kind==='street')h.teleport(I.pos.x-Math.cos(I.vehicle.yaw)*4,1,I.pos.z+Math.sin(I.vehicle.yaw)*4);
    else h.teleport(I.safe.x,I.safe.y+TL.C.FEET+.02,I.safe.z);
    h.grounded=true;h.vel.set(0,0,0);h.fsm.set(TL.TS.GROUND);h.prevPos.copy(h.pos);
    g.rig.smoothT.copy(h.pos);g.rig.yaw=.7;g.rig.pitch=.05;g.streamer.forceLoadAround(h.pos,90);
    return {kind,position:I.pos.toArray(),safe:I.safe?.toArray()};},kind);
   console.log('INCIDENT',created);if(created.error)continue;
   await new Promise(r=>setTimeout(r,500));await p.screenshot({path:path.join(out,kind+'-before.png')});
   const status=await p.evaluate(()=>{const g=TL.game,I=g.cityLife.incident;if(!I)return 'missing';g.input.pressed.add('interact');g.cityLife.updateIncident(1/60);return {state:I.state,heroState:g.hero.ctrl.state,grounded:g.hero.ctrl.grounded,speed:g.hero.ctrl.vel.length(),distance:g.hero.ctrl.pos.distanceTo(I.target),visible:g.cityLife.visible(g.hero.ctrl.pos,I.target)};});console.log('ACTIVATED',status);
   for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,650));await p.screenshot({path:path.join(out,kind+'-sequence-'+i+'.png')});}
   const final=await p.evaluate(()=>{const L=TL.game.cityLife;return {state:L.incident?.state,last:L.lastIncident,errors:TL.errors};});console.log('RESULT',kind,final);shots.push({kind,...final});
  }
  const checks=await p.evaluate(async()=>{const g=TL.game;g.cityLife.cleanupIncident();g.settings.windLevel=.37;g.settings.speedEffects=0;g.settings.fovEffect=0;g.save.saveSettings();g.settings.windLevel=.8;g.save.loadSettings();
    const persisted=g.settings.windLevel===.37&&g.settings.speedEffects===0;g.state='paused';const t=g.cityLife.t,pos=g.traffic.vehicles[0]?.pos.clone();await new Promise(r=>setTimeout(r,350));
    const paused=g.cityLife.t===t&&(!pos||pos.distanceTo(g.traffic.vehicles[0].pos)===0);g.audio.init();g.audio.update(.1);await new Promise(r=>setTimeout(r,400));const windPaused=g.audio.wind.g.gain.value;
    g.settings.vol.master=0;g.audio.applyVolumes();await new Promise(r=>setTimeout(r,400));const muted=g.audio.master.gain.value;await g.audio.ctx.suspend();await g.audio.resume();g.state='play';return {persisted,paused,windPaused,muted,audioState:g.audio.ctx.state,errors:TL.errors};});
  console.log('CHECKS',checks);fs.writeFileSync(path.join(out,label+'-gameplay-checks.json'),JSON.stringify({setup,shots,checks},null,2));
  if(label==='afterFull'){
   const motion=[];
   console.log('SWING START',await p.evaluate(()=>{const g=TL.game,h=g.hero.ctrl;g.cityLife.cleanupIncident();g.cityLife.incidentT=9999;g.settings.fovEffect=1;g.settings.speedEffects=.25;g.settings.windLevel=.7;g.hero.anim.arms?.setRetracted(true,true);
    h.teleport(0,38,-160);h.vel.set(0,-5,24);g.streamer.forceLoadAround(h.pos,100);g.input.keys.add('ShiftLeft');g.rig.yaw=Math.PI;g.rig.pitch=-.15;g.rig.smoothT.copy(h.pos);
    return h.tryStartSwing({camFwd:new THREE.Vector3(0,0,1),camRight:new THREE.Vector3(-1,0,0),move:new THREE.Vector3(),singleHand:true,swingHand:'L'});
   }));
   for(const phase of ['swing','dive','stop']){
    if(phase==='dive')await p.evaluate(()=>{const g=TL.game;g.input.keys.delete('ShiftLeft');g.input.keys.add('ControlLeft');g.hero.ctrl.teleport(0,120,0);g.hero.ctrl.vel.set(0,-20,8);g.rig.smoothT.copy(g.hero.ctrl.pos);});
    if(phase==='stop')await p.evaluate(()=>{const g=TL.game;g.input.keys.clear();g.hero.ctrl.teleport(-52,1,-217);});
    for(let frame=0;frame<4;frame++){
     await new Promise(r=>setTimeout(r,450));
     motion.push(await p.evaluate(({phase,frame})=>{const g=TL.game,h=g.hero.ctrl,C=g.camera.position,inside=g.world.query(C.x-.3,C.z-.3,C.x+.3,C.z+.3,[]).filter(c=>c.solid&&c.kind!=='prop'&&g.world.closest(c,C.x,C.y,C.z,new THREE.Vector3()).distanceTo(C)<.04);
      return {phase,frame,state:h.state,speed:h.vel.length(),energy:h.feedback.energy,fov:g.camera.fov,wind:g.audio.wind.g.gain.value,cameraInside:inside.length,retracted:g.hero.anim.arms?.retracted,errors:TL.errors};},{phase,frame}));
     await p.screenshot({path:path.join(out,'motion-'+phase+'-'+frame+'.png')});
    }
   }
   fs.writeFileSync(path.join(out,'motion-gameplay.json'),JSON.stringify(motion,null,2));console.log('MOTION',JSON.stringify(motion));
  }
 }
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
