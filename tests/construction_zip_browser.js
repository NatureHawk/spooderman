'use strict';
const fs=require('fs'),path=require('path'),Module=require('module');
const prefix=fs.readFileSync(path.join(__dirname,'motion_browser.js'),'utf8').split('    if(process.env.TL_PREVIEW_FLOW_ONLY){')[0]
 .replace("headless:true,pipe:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']","headless:'new',timeout:120000,protocolTimeout:180000,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']")
 .replace('await page.goto(','page.setDefaultTimeout(120000);await page.goto(')
 .replace("const out=path.join(__dirname,process.env.TL_PREVIEW_MULTI?'runtime_motion/multi':'runtime_motion');","const out=path.join(__dirname,'../evidence/construction/zip');");
const cases=String.raw`
 await page.setViewport({width:800,height:650});
 await page.evaluate(()=>{
  const {g}=probe;g.renderer.setSize(800,650);g.camera.aspect=800/650;g.camera.far=300;g.camera.fov=46;g.camera.updateProjectionMatrix();
  probe.world={scene:g.scene,world:new TL.CollisionWorld()};probe.world.world.groundFn=()=>-100;
  probe.site=TL.Construction.buildSite(probe.world,{x:0,z:0,baseY:100,yaw:.63,stories:3},0);
  probe.tick=function(dt=1/60){this.h.prevPos.copy(this.h.pos);this.g.hero.renderUpdate(dt,1);};
  probe.prepare=function(name,mechanical,type,sign){
   const {g}=this;for(const hero of Object.values(g.heroes))hero.setVisible(false);g.setActiveHero(name,true);this.h=g.hero.ctrl;
   const hero=g.hero;g.scene.add(hero.sk.mesh,hero.anim.membranes.mesh);if(hero.anim.arms)g.scene.add(hero.anim.arms.group);for(const web of hero.ropes)g.scene.add(web.mesh);hero.setVisible(true);
   const h=this.h;h.world=this.world.world;h.tether.world=h.world;h.onEvent=()=>{};h.wind=null;h.grounded=false;h.feedback=null;hero.anim.rel=null;hero.anim.trick=null;hero.anim.arms?.setRetracted(!mechanical,true);
   this.gate=this.site.gates.find(x=>x.type===type);this.axis=this.gate.axis.clone().multiplyScalar(sign);this.it={move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:this.axis,camRight:new THREE.Vector3(-this.axis.z,0,this.axis.x)};
   h.teleport(...this.gate.center.clone().addScaledVector(this.axis,-this.gate.length*.5-7).toArray());h.fsm.set(TL.TS.AIR);h.vel.copy(this.axis).multiplyScalar(26);h.facing=Math.atan2(this.axis.x,this.axis.z);
   for(let i=0;i<80;i++)this.tick(1/120);TL.ReferenceTraversal.tick(h,0,{...this.it,tether:true});if(h.reference.action?.kind!=='pass_through')throw Error('Authored gate not selected');this.frame=0;
  };
  probe.advance=function(stage){const {h,gate,axis,it}=this;for(let i=0;i<300;i++){h.step(1/120,it);this.tick(1/120);this.frame++;const along=h.pos.clone().sub(gate.center).dot(axis),a=h.reference.action;if(stage==='reach'&&this.frame>=5||stage==='entry'&&along>=-gate.length*.5-.5||stage==='bore'&&along>=0||stage==='exit'&&a?.kind==='pass_release'||stage==='open'&&a?.kind==='pass_release'&&a.t>.25)return; }throw Error('Stage failed '+stage);};
  probe.picture=function(label,stage){const {g,h,gate,axis}=this,right=this.it.camRight;
   if(stage==='bore'){g.camera.position.copy(gate.center).addScaledVector(axis,-gate.length*.5-4.3).add(new THREE.Vector3(0,.1,0));g.camera.lookAt(h.pos);}
   else{g.camera.position.copy(h.pos).addScaledVector(axis,-4.8).addScaledVector(right,3.2).add(new THREE.Vector3(0,1.4,0));g.camera.lookAt(h.pos);}
   this.label.textContent=label;g.renderer.render(g.scene,g.camera);
  };
 });
 const metrics=[];
 for(const name of ['WEAVER','PULSE'])for(const mechanical of name==='WEAVER'?[false,true]:[false])for(const type of ['pipe','water_tower'])for(const sign of [-1,1]){
  await page.evaluate(args=>probe.prepare(...args),[name,mechanical,type,sign]);
  for(const stage of ['reach','entry','bore','exit','open']){
   const row=await page.evaluate(({name,mechanical,type,sign,stage})=>{probe.advance(stage);probe.picture(name+' '+type+' '+stage+' '+(mechanical?'mechanical':'human')+' '+sign,stage);const h=probe.h,a=probe.g.hero.anim;if(Object.values(a.rig.cur).some(v=>!TL.finite3(v)))throw Error('Invalid pose');return{name,mechanical,type,sign,stage,frame:probe.frame,action:h.reference.action?.kind,phase:TL.ReferenceMotion.sample(h)?.phase,speed:h.vel.length(),pos:h.pos.toArray(),armsMode:a.arms?.mode,retracted:a.arms?.retracted,errors:TL.errors};},{name,mechanical,type,sign,stage});
   const file=[name,type,mechanical?'legs':'human',sign,stage].join('_')+'.png';await page.screenshot({path:path.join(out,file)});metrics.push(row);
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(metrics,null,2));console.log('PASS60 real textured-character frames through exact construction geometry, both rigs/directions and mechanical toggles');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
`;
const preview=new Module(__filename,module);preview.filename=__filename;preview.paths=module.paths;preview._compile(prefix+cases,__filename);
