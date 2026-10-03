'use strict';
const {launch,start}=require('./graphics_bench/lib'),fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{const {browser,page}=await launch({headless:true,w:1000,h:750}),out=path.join(__dirname,'../evidence/construction/zip_revision');fs.mkdirSync(out,{recursive:true});try{
 await start(page,path.join(__dirname,'../THREADLINE.html'),'high');
 // Acceptance always exercises the shipped HTML; source injection is forbidden here.
 await page.evaluate(()=>{const g=TL.game;g.settings.autoFollow=0;g.settings.gameSpeed=1;g.cityLife.incidentT=Infinity;g.state='play';window.ZIPTEST={};});
 const results=[];
 for(const name of ['WEAVER','PULSE'])for(const speed of [15,35,60])for(const sign of [-1,1]){
  await page.evaluate(({name,speed,sign})=>{const g=TL.game;g.setActiveHero(name,true);g.ui.buildHUD();g.switching=false;g.physAcc=0;g.hitStop=0;const h=g.hero.ctrl,gate=g.streamer.constructionState.sites[0].gates.find(x=>x.type==='pipe'),axis=gate.axis.clone().multiplyScalar(sign),right=new THREE.Vector3(axis.z,0,-axis.x);
   h.teleport(...gate.center.clone().addScaledVector(axis,-gate.length*.5-10).addScaledVector(right,.65).toArray());h.grounded=false;h.facing=Math.atan2(axis.x,axis.z);h.vel.copy(axis).multiplyScalar(.78).addScaledVector(right,-.28);h.vel.y=.48;h.vel.normalize().multiplyScalar(speed);h.fsm.set(TL.TS.SWING);
   const aim=gate.center.clone().sub(h.pos).normalize();g.rig.yaw=Math.atan2(-aim.x,-aim.z);g.rig.pitch=Math.asin(aim.y);g.rig.fwd.copy(aim);g.rig.moveFwd=axis.clone();g.camera.position.copy(h.pos).addScaledVector(axis,-5);g.camera.lookAt(gate.center);g.camera.updateMatrixWorld();
   const hit=h.tether.findSwingAnchor(h,{camFwd:axis,camRight:right,moveLocal:{x:0,y:0}},h.stats,100);if(!hit)throw Error('No actual incoming swing anchor');const r=h.tether.main;r.kind='swing';r.active=r.attached=true;r.attachTo(hit,g.world);r.L=r.targetL=h.pos.distanceTo(r.anchor);
   g.hero.anim.arms?.setRetracted(speed===15,true);g.hero.anim.passageSpin=0;g.input.keys.clear();g.input.pressed.clear();g.input.intent.tether=false;g.input.intent.cornerTether=false;g.input.intent.swingPressed=false;g.input.keys.add('ShiftLeft');g.input.keys.add('KeyW');
   Object.assign(ZIPTEST,{gate,axis,right,start:h.pos.clone(),speed,name,sign,rows:[],elapsed:0,travelled:0,previous:h.pos.clone(),captured:new Set(),oldCol:r.col.id});
  },{name,speed,sign});
  await page.keyboard.down('e');
  const entry=await page.evaluate(()=>{const g=TL.game;g.tick(1/60);g.input.endFrame();return{kind:g.hero.ctrl.reference?.action?.kind,speed:g.hero.ctrl.vel.length(),col:g.hero.ctrl.tether.main.col?.id};});await page.keyboard.up('e');assert.equal(entry.kind,'pass_through','actual E must select gate instead of reeling');assert(entry.speed>=speed*.995);
  for(let frame=0;frame<200;frame++){
   const row=await page.evaluate(frame=>{const g=TL.game,h=g.hero.ctrl,z=ZIPTEST;if(frame){g.tick(1/60);g.input.endFrame();}z.elapsed+=1/60;z.travelled+=h.pos.distanceTo(z.previous);z.previous.copy(h.pos);const along=h.pos.clone().sub(z.gate.center).dot(z.axis),sample=TL.ReferenceMotion.sample(h),spin=sample?.spin||0,stage=along< -z.gate.length*.5?'approach':along<=z.gate.length*.5?'bore':'exit',row={t:z.elapsed,speed:h.vel.length(),along,spin,kind:h.reference?.action?.kind,stage,pos:h.pos.toArray()};z.rows.push(row);
    let capture=null;for(const [label,value]of [['quarter',Math.PI*.5],['half',Math.PI],['threequarter',Math.PI*1.5]])if(stage==='bore'&&spin>=value&&!z.captured.has(label)){z.captured.add(label);capture=label;break;}
    if(capture){const cam=z.gate.center.clone().addScaledVector(z.axis,-z.gate.length*.5-4.2).add(new THREE.Vector3(0,.1,0));BENCH.pose={cam:cam.toArray(),at:h.pos.toArray(),fov:40};BENCH.render();}
    return{...row,capture};},frame);
   if(row.capture&&speed!==60)await page.screenshot({path:path.join(out,[name,speed,sign,row.capture].join('_')+'.png')});
   assert(row.speed>speed*.985,'actual game tick lost full swing velocity '+JSON.stringify(row));if(row.kind!=='pass_through'){assert(row.stage==='exit');break;}
  }
  const result=await page.evaluate(()=>({name:ZIPTEST.name,speed:ZIPTEST.speed,sign:ZIPTEST.sign,travelled:ZIPTEST.travelled,elapsed:ZIPTEST.elapsed,trace:ZIPTEST.rows,errors:TL.errors.slice()}));assert(result.trace.some(x=>x.spin>5.2),'full visible corkscrew');assert.deepEqual(result.errors,[]);results.push(result);
 }
 assert.deepEqual(page.errors,[]);fs.writeFileSync(path.join(out,'actual_game_tick_metrics.json'),JSON.stringify(results,null,2));console.log('PASS12 realgame E-key swinging entries15/35/60m/s, bothcharacters/directions, actualspeedtrace+corkscrewframes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
