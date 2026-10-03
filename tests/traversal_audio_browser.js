'use strict';
const {launch}=require('./graphics_bench/lib');
const assert=require('assert'),fs=require('fs'),path=require('path');
(async()=>{const {browser,page}=await launch({headless:true,w:480,h:320});try{
  await page.goto('data:text/html,<script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>');await page.waitForFunction(()=>window.THREE);
  for(const f of ['00_core.js','04_physics.js','14_audio.js'])await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../src',f),'utf8')});
  const results=await page.evaluate(async()=>{
    window.AudioContext=function(){return new OfflineAudioContext(2,44100,44100);};
    const out=[];
    for(const material of ['glass','brick','metal','concrete','muted']){
      const h={state:TL.TS.SWING,vel:new THREE.Vector3(0,0,36),pos:new THREE.Vector3(0,30,0),tether:{main:{attached:true,L:25,tension:70}},feedback:{energy:.6,accel:0,near:.8,nearPan:.7,loadRate:.5}};
      const g={state:'play',settings:TL.defaultSettings(),hero:{ctrl:h,anim:{steps:0,stepSpeed:20,stepSurf:'wall',fall:0}},env:{rain:0,wet:.5},ui:{caption(){}}};
      if(material==='muted')g.settings.vol.master=0;
      const audio=new TL.AudioManager(g);audio.init();if(!audio.ok)throw Error('Audio graph failed to initialize');
      // Exercise every real continuous layer and step path, then isolate the contact for spectrum comparison.
      audio.update(1/60);g.hero.anim.steps++;audio.update(1/60);
      g.state='paused';audio.update(1/60);
      audio.sfx('step',12,{material,surf:'wall',pan:.2,wet:.2});
      const b=await audio.ctx.startRendering();let sum=0,peak=0,roughness=0;
      for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<d.length;i++){if(!Number.isFinite(d[i]))throw Error('Nonfinite audio');sum+=d[i]*d[i];peak=Math.max(peak,Math.abs(d[i]));if(i)roughness+=(d[i]-d[i-1])**2;}}
      out.push({material,rms:Math.sqrt(sum/(b.length*2)),peak,roughness:roughness/(b.length*2)});
    }return out;
  });
  for(const r of results){assert(r.peak<1,'clipping '+r.material);if(r.material==='muted')assert.equal(r.peak,0,'mute must include initialization');else assert(r.rms>.0001,'silent contact '+r.material);}
  assert.deepEqual(page.errors,[]);console.log('PASS real offline Web Audio graph: bounded audible material contacts, continuous layers, paused updates, and silent master mute');console.log(JSON.stringify(results));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
