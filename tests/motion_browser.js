'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {pathToFileURL}=require('url');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer=require(path.join(harness,'node_modules/puppeteer-core'));
(async()=>{
  const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:480,height:480});await page.setRequestInterception(true);
    page.on('request',r=>r.url().includes('/three@')?r.respond({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/javascript',body:fs.readFileSync(path.join(harness,'node_modules/three/build/three.min.js'))}):r.continue());
    await page.goto(pathToFileURL(process.env.TL_PREVIEW_HTML?path.resolve(process.env.TL_PREVIEW_HTML):path.join(__dirname,'../THREADLINE.html')).href);
    try {await page.waitForFunction(()=>window.__TL&&window.__TL.game.state==='title');}
    catch(e){console.log('Boot diagnostics',await page.evaluate(()=>({state:window.__TL?.game?.state,errors:window.__TL?.errors,fatal:document.querySelector('#fatal .msg')?.textContent})),errors);throw e;}
    await page.evaluate(()=>{
      const TL=window.__TL,g=TL.game;TL.Input.prototype.lock=function(){};
      g.startGame({seed:12345});g.state='inspection';window.requestAnimationFrame=()=>0;
      const h=g.hero.ctrl;h.teleport(0,100,0);h.grounded=false;h.singleHandSwing=true;
      // Use the game's textured hero, runtime animator and rope renderer in a controlled lit scene.
      const scene=new THREE.Scene();scene.background=new THREE.Color(0x263444);
      scene.add(new THREE.HemisphereLight(0xe3f2ff,0x69707a,2.2));
      const light=new THREE.DirectionalLight(0xffffff,2.4);light.position.set(4,106,4);scene.add(light);
      scene.add(g.hero.sk.mesh);
      if(g.hero.anim.arms)scene.add(g.hero.anim.arms.group);
      scene.add(g.hero.anim.membranes.mesh);
      scene.add(g.particles.points,g.launchFX.mesh);
      const camera=new THREE.PerspectiveCamera(36,1,.1,100);
      g.scene=scene;g.camera=camera;g.renderer.setSize(480,480);g.renderer.setPixelRatio(1);
      for(const el of [...document.body.children])if(el!==g.renderer.domElement)el.style.display='none';
      const label=document.createElement('div');label.style='position:fixed;left:12px;top:12px;color:white;font:16px monospace;z-index:9999';document.body.append(label);
      window.probe={g,h,label,frame:0,
        tick(dt=1/60){h.prevPos.copy(h.pos);g.hero.renderUpdate(dt,1);g.particles.update(dt);g.launchFX.update(dt,g.hero);},
        render(text){label.textContent=text;camera.position.copy(h.pos).add(new THREE.Vector3(5.8,.6,2.0));camera.lookAt(h.pos.clone().add(new THREE.Vector3(0,0,-.25)));g.renderer.render(scene,camera);},
        reset(){h.tether.releaseAll();h.pos.set(0,100,0);h.vel.set(0,8,24);h.facing=0;h.fsm.set(TL.TS.AIR);g.hero.anim.rel=null;g.hero.anim.trick=null;g.hero.anim.airT=0;g.hero.anim.fall=0;for(let i=0;i<45;i++)this.tick();}
      };
    });
    const out=path.join(__dirname,process.env.TL_PREVIEW_MULTI?'runtime_motion/multi':'runtime_motion');fs.mkdirSync(out,{recursive:true});
    if(process.env.TL_PREVIEW_FLOW_ONLY){
      await page.evaluate(()=>{
        probe.reset();const h=probe.h;h.world=new TL.CollisionWorld();h.world.groundFn=()=>0;
        probe.g.hero.anim.arms.setRetracted(true,true);probe.maxStep=0;probe.prevRoot=probe.g.hero.anim.rootQ.clone();
      });
      if(process.env.TL_PREVIEW_MULTI)await page.evaluate(()=>{
        const g=probe.g;if(!g.net)throw Error('Missing multiplayer module');
        probe.remote=new TL.RemotePlayer(g.net,'animation-test','Animation test');
        probe.remoteStates=new Set();probe.remoteSamples=0;
      });
      for(let frame=0;frame<100;frame++) {
        await page.evaluate(frame=>{
          const h=probe.h,a=probe.g.hero.anim,r=h.tether.main;
          for(let j=0;j<3;j++) {
            const t=(frame*3+j)/60;
            if(t<1.2 || t>=3.8) {
              const phase=t<1.2?-1+t*1.35:-.7+(t-3.8)*1.1;
              h.fsm.set(TL.TS.SWING);r.active=r.attached=true;r.hand=t<1.2?'L':'R';r.L=24;r.tension=45;
              r.anchor.set(t<1.2?10:14,100+24*Math.cos(phase),-24*Math.sin(phase));
              h.vel.set(0,26*Math.sin(phase),26*Math.cos(phase));
            }else if(t<1.95){r.release();h.fsm.set(TL.TS.AIR,'release');h.vel.set(0,9,24);}
            else if(t<3){h.fsm.set(TL.TS.GLIDE);h.glide.t=t-1.95;h.glide.pitch=0;h.glide.roll=0;h.vel.set(0,-2,30);}
            else {h.fsm.set(TL.TS.DIVE);h.vel.set(0,-22,23);}
            probe.tick();
            if(probe.remote){
              const now=TL.now(),packet=probe.g.net.snapshot();packet.id='animation-test';packet.ts=now-TL.NET.DELAY_MS;
              probe.remote.buf.length=0;probe.remote.off=0;probe.remote.push(packet);probe.remote.off=0;
              probe.remote.update(1/60);probe.remoteSamples++;
              const remote=probe.remote.hero;
              if(!remote||probe.remote.errs)throw Error('Remote animation failed');
              probe.remoteStates.add(remote.ctrl.state);
              for(const d of Object.values(remote.anim.rig.cur))if(!d.toArray().every(Number.isFinite))throw Error('Invalid remote pose');
              remote.setVisible(false);
            }
            probe.maxStep=Math.max(probe.maxStep,probe.prevRoot.angleTo(a.rootQ));probe.prevRoot.copy(a.rootQ);
            for(const d of Object.values(a.rig.cur))if(!d.toArray().every(Number.isFinite))throw Error('Invalid direction');
          }
          probe.render(h.state+' / '+(frame*.05).toFixed(2)+'s');
        },frame);
        await page.screenshot({path:path.join(out,'flow_'+String(frame).padStart(3,'0')+'.png')});
      }
      const metrics=await page.evaluate(()=>({maxRootStep:probe.maxStep,errors:TL.errors,remoteSamples:probe.remoteSamples||0,remoteStates:probe.remoteStates?[...probe.remoteStates]:[]}));
      if(process.env.TL_PREVIEW_MULTI){assert.equal(metrics.remoteSamples,300);assert.equal(metrics.remoteStates.length,4);}
      assert(metrics.maxRootStep<.7);assert.deepEqual(errors,[]);assert.deepEqual(metrics.errors,[]);
      fs.writeFileSync(path.join(out,'flow_metrics.json'),JSON.stringify(metrics,null,2));
      console.log('PASS rendered swing → release → wings → dive → opposite-hand catch',metrics);return;
    }
    if(process.env.TL_PREVIEW_REFERENCE_ONLY){
      for(const kind of ['air_zip','spider_jump','spider_dash','wing_dodge','water_jump','wing_close']){
        await page.evaluate(kind=>{probe.reset();const h=probe.h;h.reference=null;h.glide.t=2;h.glide.pitch=0;h.glide.roll=0;h.fsm.set(kind==='wing_dodge'?TL.TS.GLIDE:TL.TS.AIR);TL.ReferenceTraversal.begin(h,kind,.8);probe.g.hero.anim.arms.setRetracted(true,true);},kind);
        for(const phase of [.08,.2,.4,.6,.8]){
          await page.evaluate(({kind,phase})=>{const h=probe.h;h.reference.action.t=phase;for(let i=0;i<8;i++)probe.tick(1/120);probe.render(kind+' / '+phase.toFixed(2));}, {kind,phase});
          await page.screenshot({path:path.join(out,'ref_'+kind+'_'+phase+'.png')});
        }
      }
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);console.log('PASS reference clips render on the actual textured hero without runtime errors');return;
    }
    if(process.env.TL_PREVIEW_POLE_ONLY){
      await page.evaluate(()=>{
        probe.reset();const h=probe.h,g=probe.g;
        h.world=new TL.CollisionWorld();h.world.groundFn=()=>0;
        h.wallCol=h.world.addStatic(0,101,.6,.2,4,.2,0,{kind:'building',climb:true});
        h.wallN.set(0,0,-1);h.wallMode='side';h.vel.set(0,0,0);h.grounded=false;h.fsm.set(TL.TS.WALL);
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,8,24),new THREE.MeshStandardMaterial({color:0x59676a,metalness:.65,roughness:.35}));pole.position.set(0,101,.6);g.scene.add(pole);
        g.hero.anim.arms.setRetracted(true,true);
        const it={move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:new THREE.Vector3(0,0,1),camRight:new THREE.Vector3(-1,0,0)};
        for(let i=0;i<180;i++){h.step(1/60,it);probe.tick();}
        if(h.state!==TL.TS.CRAWL)throw Error('Pole did not settle into stable grip: '+h.state);
        if(new THREE.Vector3(0,1,0).applyQuaternion(g.hero.anim.rootQ).y<.98)throw Error('Pole grip still leans sideways');
      });
      for(const side of ['front','side']){
        await page.evaluate(side=>{const g=probe.g,p=probe.h.pos;g.camera.position.copy(p).add(new THREE.Vector3(side==='front'?-3:3,.9,2.6));g.camera.lookAt(p);probe.label.textContent='Pole grip / '+side;g.renderer.render(g.scene,g.camera);},side);
        await page.screenshot({path:path.join(out,'pole_'+side+'.png')});
      }
      console.log(await page.evaluate(()=>({state:probe.h.state,position:probe.h.pos.toArray(),hand:probe.g.hero.anim.handWorld.L.toArray(),feet:['L','R'].map(s=>probe.g.hero.anim.rig.bones['foot'+s].getWorldPosition(new THREE.Vector3()).toArray())})));
      await page.evaluate(()=>{
        const h=probe.h,a=probe.g.hero.anim;
        if(Math.abs(a.handWorld.L.z-.375)>.035)throw Error('Raised hand lost shaft contact');
        const knee=a.rig.bones.shinL.getWorldPosition(new THREE.Vector3()),hip=a.rig.bones.thighL.getWorldPosition(new THREE.Vector3());
        if(knee.y<hip.y+.15)throw Error('Pole pose needs a raised knee');
        const it={move:new THREE.Vector3(0,0,1),moveLocal:{x:0,y:1},camFwd:new THREE.Vector3(0,0,1),camRight:new THREE.Vector3(-1,0,0)};
        const y=h.pos.y;for(let i=0;i<30;i++){h.step(1/60,it);probe.tick();}
        if(h.pos.y<y+.2)throw Error('Pole pose blocked climbing');
        h.step(1/60,{...it,jump:true});if(h.state!==TL.TS.AIR)throw Error('Cannot leap off pole');
      });
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);console.log('PASS stationary pole grip stays upright and attached');return;
    }
    if(process.env.TL_PREVIEW_ARMS_ONLY){
      await page.evaluate(()=>{probe.reset();probe.h.vel.set(0,0,0);probe.h.grounded=true;probe.h.fsm.set(TL.TS.GROUND);});
      for(const phase of ['deployed','recalling','stowed','returning','restored']){
        if(phase==='recalling'||phase==='returning'){
          await page.keyboard.down('j');await page.evaluate(()=>probe.g.handleGlobalKeys());
          const target=await page.evaluate(()=>probe.g.hero.anim.arms.retracted);
          await page.keyboard.down('j');await page.evaluate(()=>probe.g.handleGlobalKeys());
          assert.equal(await page.evaluate(()=>probe.g.hero.anim.arms.retracted),target,'held key does not toggle repeatedly');await page.keyboard.up('j');
        }
        await page.evaluate(phase=>{
          for(let i=0;i<(phase==='recalling'||phase==='returning'?14:50);i++)probe.tick();
          const g=probe.g;g.camera.position.set(1.5,101.0,-3.1);g.camera.lookAt(0,100.25,0);probe.label.textContent='Iron Spider / '+phase;g.renderer.render(g.scene,g.camera);
        },phase);
        await page.screenshot({path:path.join(out,'arms_'+phase+'.png')});
        if(phase==='stowed'||phase==='restored'){
          const result=await page.evaluate(()=>{const a=probe.g.hero.anim.arms;return{deployment:a.deployment,emblem:a.emblem.visible,visible:a.arms.every(x=>[x.seg1,x.seg2,x.claw].every(m=>m.visible)),state:probe.g.state};});
          assert.equal(result.deployment,phase==='stowed'?0:1);assert.equal(result.emblem,phase==='stowed');assert.equal(result.visible,phase==='restored');assert.equal(result.state,'inspection');
        }
      }
      await page.evaluate(()=>{
        const g=probe.g;g.hero.anim.arms.setRetracted(true,true);g.hero.buildVisual();
        if(!g.hero.anim.arms.retracted||g.hero.anim.arms.deployment!==0)throw Error('Visual rebuild lost arm toggle');
      });
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);console.log('PASS J recall/deploy, held key, hidden arms, emblem, rebuild state and runtime rendering');return;
    }
    if(process.env.TL_PREVIEW_PERCH_ONLY){
      await page.evaluate(()=>{
        probe.reset();const h=probe.h,g=probe.g;h.pos.set(0,100.95,0);h.perchPoint.copy(h.pos);h.perchFacing=0;h.vel.set(0,0,0);h.grounded=true;h.fsm.set(TL.TS.PERCH);g.hero.anim.rel=null;
        const ledge=new THREE.Mesh(new THREE.BoxGeometry(2.0,1,.4),new THREE.MeshStandardMaterial({color:0x8b8e90}));ledge.position.set(0,99.5,0);g.scene.add(ledge);
      });
      for(const t of [.2,1.5,5.8,9.5]){
        await page.evaluate(t=>{const h=probe.h;for(let i=0;i<90;i++){h.fsm.t=t;probe.tick();}probe.g.camera.position.set(2.6,101.7,3.6);probe.g.camera.lookAt(0,100.55,0);probe.label.textContent='Perch / '+t+'s';probe.g.renderer.render(probe.g.scene,probe.g.camera);},t);
        await page.screenshot({path:path.join(out,'perch_'+t+'.png')});
      }
      console.log(await page.evaluate(()=>({hands:Object.fromEntries(Object.entries(probe.g.hero.anim.handWorld).map(([k,v])=>[k,v.toArray()])),feet:['L','R'].map(s=>probe.g.hero.anim.rig.bones['foot'+s].getWorldPosition(new THREE.Vector3()).toArray())})));
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);console.log('PASS perch renders at entry, settled, weight shift and recovery');return;
    }
    if(process.env.TL_PREVIEW_WEB_ONLY) {
      await page.evaluate(()=>{
        probe.reset();const h=probe.h,g=probe.g,r=h.tether.ropes[0];
        g.hero.ropes.forEach(web=>g.scene.add(web.mesh));
        h.fsm.set(TL.TS.SWING);h.vel.set(0,0,14);r.active=true;r.attached=false;r.hand='L';r.kind='swing';r.anchor.set(0,107,9);r.L=11.5;r.shotDur=.18;
        const wall=new THREE.Mesh(new THREE.BoxGeometry(5,8,.3),new THREE.MeshStandardMaterial({color:0x555e69}));wall.position.set(0,107,9.15);g.scene.add(wall);
      });
      for(const phase of ['shot','catch','loaded','close']) {
        await page.evaluate(phase=>{
          const h=probe.h,g=probe.g,r=h.tether.ropes[0];r.attached=phase!=='shot';r.shotT=phase==='shot'?.12:.18;r.tension=100;
          const count=phase==='loaded'?60:1;for(let i=0;i<count;i++)probe.tick();
          probe.label.textContent='Web / '+phase;g.camera.position.set(8,104,12);g.camera.lookAt(0,103.5,4);
          if(phase==='close'){g.camera.position.set(1.5,104.5,5);g.camera.lookAt(0,104.3,5.2);}
          g.renderer.render(g.scene,g.camera);
        },phase);
        await page.screenshot({path:path.join(out,'web_'+phase+'.png')});
      }
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);console.log('PASS actual web meshes rendered for firing, catch, loaded line, and close detail');return;
    }
    if(process.env.TL_PREVIEW_SLING_ONLY) {
      await page.evaluate(()=>{
        probe.reset();const h=probe.h;h.world=new TL.CollisionWorld();h.tether.world=h.world;h.world.groundFn=()=>100;
        h.world.addStatic(-14,115,40,4,15,4,0,{kind:'building'});h.world.addStatic(14,115,40,4,15,4,0,{kind:'building'});
        h.teleport(0,100.95,20);h.fsm.set(TL.TS.GROUND);h.grounded=true;
        probe.slingIntent={move:new THREE.Vector3(),camFwd:new THREE.Vector3(0,0,1),sling:true};h.startSling(probe.slingIntent);
        if(h.state!==TL.TS.SLING)throw Error('Slingshot did not acquire anchors');
        const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0x777f88}));floor.rotation.x=-Math.PI/2;floor.position.y=100;probe.g.scene.add(floor);
        probe.slingLines=[0,1].map(()=>{const l=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff}));probe.g.scene.add(l);return l;});
      });
      for(let i=0;i<48;i++) {
        await page.evaluate(i=>{
          const h=probe.h,g=probe.g;probe.slingIntent.sling=i<26;
          for(let j=0;j<3;j++){h.step(1/60,probe.slingIntent);probe.tick();}
          h.tether.ropes.forEach((r,j)=>{const l=probe.slingLines[j];l.visible=r.active;l.geometry.dispose();l.geometry=new THREE.BufferGeometry().setFromPoints([g.hero.anim.handWorld[r.hand],r.anchor]);});
          if(i===25&&h.state!==TL.TS.SLING)throw Error('Lost charge');
          if(i===27&&g.hero.anim.rel?.kind!=='sling_launch')throw Error('Missing slingshot release animation');
          probe.render(h.state+' '+((i+1)*.05).toFixed(2));
        },i);
        await page.screenshot({path:path.join(out,'sling_'+String(i).padStart(2,'0')+'.png')});
      }
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);
      console.log('PASS rendered slingshot windup and release');return;
    }
    if(process.env.TL_CHECK_LAUNCH_AUDIO) {
      const result=await page.evaluate(async()=>{
        const reports=[];
        for(const name of ['thwip','zippull','pointcatch','pointpush']) {
          const Native=window.AudioContext,ctx=new OfflineAudioContext(2,88200,44100);
          window.AudioContext=function(){return ctx;};
          const game={settings:{vol:{master:.8,sfx:.8,music:0,ambience:0,ui:0}},ui:{caption(){}}};
          const sound=new TL.AudioManager(game);sound.init();window.AudioContext=Native;
          sound.sfx(name,1,{perfect:name==='pointpush'});
          const b=await ctx.startRendering(),pcm=b.getChannelData(0);let sum=0,peak=0;
          for(const x of pcm){if(!Number.isFinite(x))throw Error('Invalid audio');sum+=x*x;peak=Math.max(peak,Math.abs(x));}
          reports.push({name,peak,rms:Math.sqrt(sum/pcm.length),samples:Array.from(pcm)});
        }
        return reports;
      });
      for(const r of result) {
        assert(r.peak>.02&&r.peak<1,'audible, unclipped '+r.name);assert(r.rms>.001);
        const b=Buffer.alloc(44+r.samples.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(88200,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);r.samples.forEach((x,i)=>b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,x))*32767),44+i*2));
        fs.writeFileSync(path.join(out,r.name+'.wav'),b);console.log('PASS synthesized '+r.name+' peak='+r.peak.toFixed(3)+' RMS='+r.rms.toFixed(3));
      }
      assert.deepEqual(errors,[]);return;
    }
    if(process.env.TL_PREVIEW_ZIP_ONLY) {
      for(const boost of [false,true]) {
        await page.evaluate(boost=>{
          probe.reset();const h=probe.h;h.world=new TL.CollisionWorld();h.world.groundFn=()=>0;
          const ledge=h.world.addStatic(0,111,42,3,1,2,0,{kind:'building'});
          if(!probe.ledge){probe.ledge=new THREE.Mesh(new THREE.BoxGeometry(6,2,4),new THREE.MeshStandardMaterial({color:0x777f88}));probe.ledge.position.set(0,111,42);probe.g.scene.add(probe.ledge);}
          h.vel.set(0,0,0);h.startPointLaunch({point:new THREE.Vector3(0,112,40),col:ledge});
          probe.zipBoost=boost;probe.zipPressed=false;
          probe.zipIntent={move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:new THREE.Vector3(0,0,1),camRight:new THREE.Vector3(-1,0,0),jumpHeld:false};
          if(!probe.zipLines)probe.zipLines=[0,1].map(()=>{const l=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff}));probe.g.scene.add(l);return l;});
        },boost);
        for(let i=0;i<44;i++) {
          await page.evaluate(i=>{
            const h=probe.h,g=probe.g;
            for(let n=0;n<3;n++){
              probe.zipIntent.jump=!!(probe.zipBoost&&!probe.zipPressed&&h.launch&&h.launch.window);
              if(probe.zipIntent.jump)probe.zipPressed=true;
              h.step(1/60,probe.zipIntent);probe.tick();
            }
            h.tether.ropes.forEach((r,j)=>{const line=probe.zipLines[j];line.visible=r.active;
              const start=g.hero.anim.handWorld[r.hand],end=start.clone().lerp(r.anchor,r.attached?1:Math.min(1,r.shotT/r.shotDur));
              line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints([start,end]);});
            probe.render(h.state+' '+((i+1)*.05).toFixed(2));
          },i);
          await page.screenshot({path:path.join(out,'zip_'+(boost?'boost':'perch')+'_'+String(i).padStart(2,'0')+'.png')});
        }
      }
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);
      console.log('PASS actual physics/rendered zip into perch and timed point launch');return;
    }
    if(process.env.TL_PREVIEW_HEAD_ONLY) {
      for(const x of [-.8,0,.8]) {
        await page.evaluate(x=>{
          probe.reset();const h=probe.h,g=probe.g;h.fsm.set(TL.TS.GROUND);h.grounded=true;h.vel.set(0,0,0);
          g.rig.fwd.set(x,0,.6).normalize();for(let n=0;n<180;n++)probe.tick();
          probe.label.textContent='Idle head / camera '+x;
          g.camera.position.copy(h.pos).add(new THREE.Vector3(1.5,1,4.5));g.camera.lookAt(h.pos);g.renderer.render(g.scene,g.camera);
        },x);
        await page.screenshot({path:path.join(out,'head_'+x+'.png')});
      }
      assert.deepEqual(errors,[]);console.log('PASS idle head rendered with left, neutral and right camera directions');return;
    }
    if(process.env.TL_PREVIEW_SINGLE_ONLY) {
      for(const hand of ['L','R'])for(const angle of [-.6,0,.45])for(const view of ['rear','side']) {
        await page.evaluate(({hand,angle,view})=>{
          probe.reset();const h=probe.h,r=h.tether.main;
          h.singleHandSwing=true;h.fsm.set(TL.TS.SWING);r.active=r.attached=true;r.hand=hand;
          r.anchor.set(hand==='L'?6:-6,120,0);r.L=20;r.tension=45;
          h.pos.set(0,120-20*Math.cos(angle),20*Math.sin(angle));h.vel.set(0,24*Math.sin(angle),24*Math.cos(angle));
          for(let n=0;n<60;n++)probe.tick();
          const g=probe.g;
          if(!probe.line){probe.line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff}));g.scene.add(probe.line);}
          probe.line.geometry.dispose();probe.line.geometry=new THREE.BufferGeometry().setFromPoints([g.hero.anim.handWorld[hand],r.anchor]);
          probe.render('Single '+hand+' / '+angle+' / '+view);
          if(view==='rear'){g.camera.position.copy(h.pos).add(new THREE.Vector3(0,2,-6));g.camera.lookAt(h.pos);g.renderer.render(g.scene,g.camera);}
        },{hand,angle,view});
        await page.screenshot({path:path.join(out,'single_'+hand+'_'+angle+'_'+view+'.png')});
      }
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);
      console.log('PASS left/right single-hand poses on descent, bottom and ascent, from rear and side');return;
    }
    if(process.env.TL_PREVIEW_FALL_ONLY) {
      for(const vy of [-5,-12,-25])for(const view of ['side','rear']) {
        await page.evaluate(({vy,view})=>{
          probe.reset();const h=probe.h;h.world=new TL.CollisionWorld();h.world.groundFn=()=>0;
          h.vel.set(0,vy,24);for(let n=0;n<180;n++)probe.tick();
          probe.render('Freefall '+vy+' / '+view);
          if(view==='rear') {
            const g=probe.g;g.camera.position.copy(h.pos).add(new THREE.Vector3(0,3.5,-5));
            g.camera.lookAt(h.pos);g.renderer.render(g.scene,g.camera);
          }
        },{vy,view});
        await page.screenshot({path:path.join(out,'fall_'+Math.abs(vy)+'_'+view+'.png')});
      }
      assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);
      console.log('PASS normal and fast freefall rendered from side and rear gameplay angles');return;
    }
    let clips=await page.evaluate(()=>Object.keys(TL.AerialClips));
    if(process.env.TL_PREVIEW_CLIPS)clips=process.env.TL_PREVIEW_CLIPS.split(',');
    for(const kind of clips){
      await page.evaluate(kind=>{probe.reset();probe.g.hero.anim.playAerial(kind);},kind);
      for(let i=0;i<6;i++){
        await page.evaluate(({kind,i})=>{const dt=TL.AerialClips[kind].duration/60;for(let n=0;n<12;n++)probe.tick(dt);probe.render(kind+' '+((i+1)*.2).toFixed(1));},{kind,i});
        await page.screenshot({path:path.join(out,kind+'_'+i+'.png')});
      }
      console.log('Rendered',kind);
    }
    await page.evaluate(()=>{probe.reset();const h=probe.h,r=h.tether.main;r.active=r.attached=true;r.hand='L';r.anchor.set(0,120,0);r.L=20;h.fsm.set(TL.TS.SWING);});
    for(let i=0;i<18;i++){
      await page.evaluate(i=>{const h=probe.h;for(let k=0;k<6;k++){const a=-.95+1.8*(i*6+k)/107;h.pos.set(0,120-20*Math.cos(a),20*Math.sin(a));h.vel.set(0,24*Math.sin(a),24*Math.cos(a));probe.tick();}probe.render('Pendulum '+i);},i);
      await page.screenshot({path:path.join(out,'swing_'+String(i).padStart(2,'0')+'.png')});
    }
    await page.evaluate(()=>{probe.h.tether.releaseAll();probe.h.fsm.set(TL.TS.AIR,'release-jump');});
    for(let i=0;i<16;i++){
      await page.evaluate(i=>{const h=probe.h;for(let k=0;k<6;k++){h.vel.y-=TL.C.G/60;h.pos.addScaledVector(h.vel,1/60);probe.tick();}probe.render('Release '+(i*.1).toFixed(1));},i);
      await page.screenshot({path:path.join(out,'release_'+String(i).padStart(2,'0')+'.png')});
    }
    for(const state of ['ground','wallcrawl','glide','perch','air']){
      await page.evaluate(state=>{
        probe.reset();const h=probe.h;h.world=new TL.CollisionWorld();h.world.groundFn=()=>0;
        if(state==='wallcrawl')h.world.addStatic(0,100,1.2,20,30,.5,0,{kind:'building'});
        h.wallN.set(0,0,-1);h.fsm.set(state);h.grounded=state==='ground';h.vel.set(0,state==='air'?-25:0,state==='glide'||state==='air'?24:0);
        for(let n=0;n<240;n++)probe.tick();probe.render(state);
      },state);
      await page.screenshot({path:path.join(out,'context_'+state+'.png')});
    }
    const gameErrors=await page.evaluate(()=>TL.errors);assert.deepEqual(errors,[]);assert.deepEqual(gameErrors,[]);
    console.log('PASS actual game renderer: '+clips.length+' aerial sequences, pendulum arc, release recovery and context poses; no runtime errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
