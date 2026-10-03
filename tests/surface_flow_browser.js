'use strict';
const fs=require('fs'),path=require('path'),Module=require('module');
const prefix=fs.readFileSync(path.join(__dirname,'motion_browser.js'),'utf8').split('    if(process.env.TL_PREVIEW_FLOW_ONLY){')[0]
 .replace("headless:true,pipe:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']","headless:'new',timeout:120000,protocolTimeout:180000,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']")
 .replace('await page.goto(','page.setDefaultTimeout(120000);await page.goto(')
 .replace("const out=path.join(__dirname,process.env.TL_PREVIEW_MULTI?'runtime_motion/multi':'runtime_motion');","const out=path.join(__dirname,'../evidence/upgrade/traversal');");
const cases=String.raw`
 await page.evaluate(()=>{
  probe.tick=function(dt=1/60){this.h.prevPos.copy(this.h.pos);this.g.hero.renderUpdate(dt,1);};
  probe.prepare=function(name,mechanical){const {g}=this;for(const hero of Object.values(g.heroes))hero.setVisible(false);g.setActiveHero(name,true);this.h=g.hero.ctrl;
   const hero=g.hero;g.scene.add(hero.sk.mesh,hero.anim.membranes.mesh);if(hero.anim.arms)g.scene.add(hero.anim.arms.group);for(const web of hero.ropes)g.scene.add(web.mesh);hero.setVisible(true);
   for(const m of this.geometry||[]){g.scene.remove(m);m.geometry.dispose();m.material.dispose();}this.geometry=[];
   const h=this.h;h.world=new TL.CollisionWorld();h.world.groundFn=()=>-100;h.onEvent=()=>{};h.wind=null;h.teleport(0,100,0);h.grounded=false;h.singleHandSwing=true;h.feedback=null;hero.anim.skimTime=0;hero.anim.skimCool=0;hero.anim.expressionHeading=undefined;hero.anim.wallContacts=null;hero.anim.rel=null;hero.anim.trick=null;hero.anim.arms?.setRetracted(!mechanical,true);
   this.it={move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:new THREE.Vector3(0,0,1),camRight:new THREE.Vector3(-1,0,0),swing:false,swingPressed:false,jump:false,dive:false};
  };
  probe.box=function(x,y,z,hx,hy,hz,color=0x596b78){const c=this.h.world.addStatic(x,y,z,hx,hy,hz,0,{kind:'building'});const m=new THREE.Mesh(new THREE.BoxGeometry(hx*2,hy*2,hz*2),new THREE.MeshStandardMaterial({color,roughness:.82}));m.position.set(x,y,z);this.geometry.push(m);this.g.scene.add(m);return c;};
  probe.picture=function(label,offset=[3,1,-4]){const {g,h}=this;g.camera.position.copy(h.pos).add(new THREE.Vector3(...offset));g.camera.lookAt(h.pos);this.label.textContent=label;g.renderer.render(g.scene,g.camera);};
 });
 const samples=process.env.TL_EXPRESSION_ONLY||process.env.TL_CEILING_ONLY?JSON.parse(fs.readFileSync(path.join(out,'metrics.json'),'utf8')).filter(x=>process.env.TL_CEILING_ONLY?x.kind!=='ceiling':!['skim','shot'].includes(x.kind)):[];
 for(const name of (process.env.TL_EXPRESSION_ONLY?[]:['WEAVER','PULSE']))for(const mechanical of (name==='WEAVER'?[false,true]:[false]))for(const kind of (process.env.TL_CEILING_ONLY?['ceiling']:['corner','roof','ceiling'])){
  await page.evaluate(({name,mechanical,kind})=>{probe.prepare(name,mechanical);const h=probe.h,a=probe.g.hero.anim;
   h.wallCol=probe.box(0,100,0,4,20,4);h.wallN.set(0,0,-1);h.wallMode=kind==='corner'?'side':'up';
   h.pos.set(kind==='corner'?3.7:0,kind==='roof'?118.85:kind==='ceiling'?123.88:108, -4.4);h.prevPos.copy(h.pos);h.vel.set(kind==='corner'?16:0,kind==='corner'?0:kind==='roof'?14:10,0);h.fsm.set(TL.TS.WALL);
   if(kind==='ceiling'){h.wallCol=probe.box(0,120,0,4,20,4);h.ceilCol=probe.box(0,125,-6,4,.3,2,0x7e868d);}
   for(let i=0;i<80;i++)probe.tick(1/120);
  },{name,mechanical,kind});
  for(let frame=0;frame<=32;frame++){
   const result=await page.evaluate(({frame,kind,name,mechanical})=>{const h=probe.h,a=probe.g.hero.anim;if(frame>0)for(let j=0;j<2;j++){h.step(1/120,probe.it);probe.tick(1/120);}
    for(const d of Object.values(a.rig.cur))if(!TL.finite3(d))throw Error('Invalid bone');
    if([0,4,12,22,32].includes(frame))probe.picture(name+' '+kind+' '+(mechanical?'legs':'human')+' '+frame,kind==='ceiling'?[3,-2,-4]:[3,1.2,-4.5]);
    let meshPen=0;if(kind==='ceiling'&&h.state===TL.TS.CEIL&&[0,4,12,22,32].includes(frame)){const mesh=probe.g.hero.sk.mesh,c=h.ceilCol,v=new THREE.Vector3(),local=new THREE.Vector3();mesh.updateMatrixWorld(true);mesh.skeleton.update();const attr=mesh.geometry.attributes.position;for(let i=0;i<attr.count;i++){v.fromBufferAttribute(attr,i);mesh.boneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);c.toLocal(v.x,v.y,v.z,local);const d=Math.min(c.hx-Math.abs(local.x),c.hy-Math.abs(local.y),c.hz-Math.abs(local.z));if(d>meshPen)meshPen=d;}}
    return{name,kind,mechanical,frame,meshPen,state:h.state,pos:h.pos.toArray(),speed:h.vel.length(),corner:!!h.corner,roof:!!h.roofFlow,contacts:Object.keys(a.wallContacts||{}).filter(k=>a.wallContacts[k]?.planted),errors:TL.errors};
   },{frame,kind,name,mechanical});
   if([0,4,12,22,32].includes(frame)){await page.screenshot({path:path.join(out,name+'_'+kind+'_'+(mechanical?'legs':'human')+'_'+String(frame).padStart(2,'0')+'.png')});samples.push(result);}
  }
 }
 for(const name of (process.env.TL_CEILING_ONLY?[]:['WEAVER','PULSE']))for(const hand of ['L','R'])for(const kind of ['skim','shot']){
  await page.evaluate(({name,hand,kind})=>{probe.prepare(name,false);const {h,g}=probe,a=g.hero.anim,r=h.tether.main;h.vel.set(0,0,18);h.fsm.set(kind==='skim'?TL.TS.SWING:TL.TS.AIR);r.active=true;r.attached=kind==='skim';r.kind='swing';r.hand=hand;r.anchor.set(0,130,0);r.L=30;r.tension=40;r.shotDur=.7;r.shotT=0;
   probe.box(0,131,0,2,1,2,0x8095a6);if(kind==='shot')a.startWebShot(r);
   for(let i=0;i<100;i++)probe.tick(1/120);
   if(kind==='shot'){a.startWebShot(r);r.shotT=0;}
   else{const free=hand==='L'?'R':'L',sg=free==='L'?1:-1,sh=a.rig.P['uarm'+free].clone().applyQuaternion(a.rootQ).add(a.meshPos),face=sh.x+sg*.28;
    const col=probe.box(face+sg*.3,100,0,.3,5,10,0x647d89);h.feedback={near:.95,clearance:Math.abs(face),nearNormal:new THREE.Vector3(sg,0,0),nearPoint:new THREE.Vector3(face,100,0),nearCollider:col,load:.4,energy:.4};}
  },{name,hand,kind});
  for(const frame of [6,12,24]){const result=await page.evaluate(({name,hand,kind,frame})=>{const {h,g}=probe;for(let i=0;i<6;i++){h.tether.main.shotT+=1/120;probe.tick(1/120);}probe.picture(name+' '+hand+' '+kind+' '+frame,[hand==='L'?2.5:-2.5,.8,-4.5]);return{name,hand,kind,frame,skim:g.hero.anim.skim?{side:g.hero.anim.skim.side,w:g.hero.anim.skim.w,error:g.hero.anim.handWorld[g.hero.anim.skim.side].distanceTo(g.hero.anim.skim.p)}:null,errors:TL.errors};},{name,hand,kind,frame});
   await page.screenshot({path:path.join(out,name+'_'+kind+'_'+hand+'_'+frame+'.png')});samples.push(result);}
 }
 for(const name of (process.env.TL_CEILING_ONLY?[]:['WEAVER','PULSE'])){await page.evaluate(name=>{probe.prepare(name,false);probe.h.fsm.set(TL.TS.DIVE);probe.h.vel.set(0,-45,4);for(let i=0;i<120;i++)probe.tick(1/120);probe.picture(name+' fast dive',[3,-.5,-4]);},name);await page.screenshot({path:path.join(out,name+'_dive.png')});}
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>TL.errors),[]);for(const s of samples){assert.deepEqual(s.errors,[]);if(s.kind==='ceiling'&&s.meshPen!==undefined)assert(s.meshPen<.00001,'Actual skin intersects ceiling: '+JSON.stringify(s));}
 fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(samples,null,2));console.log('PASS rendered 71 actual-character surface/expression frames, both rigs, mechanical toggles, no runtime errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
`;
const preview=new Module(__filename,module);preview.filename=__filename;preview.paths=module.paths;preview._compile(prefix+cases,__filename);
