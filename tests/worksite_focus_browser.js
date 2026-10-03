/* Focused built-game exterior review. Rays sample the whole crown, not only its center. */
'use strict';
const fs=require('fs'),assert=require('assert'),{launch,start}=require('./graphics_bench/lib');
const out='evidence/construction/focused';fs.mkdirSync(out,{recursive:true});
(async()=>{const{browser,page}=await launch({headless:true,w:1600,h:1000});try{
 await start(page,'THREADLINE.html','high');
 await page.evaluate(()=>{const g=TL.game,e=g.env;e.hour=14;e.forced=e.weather='clear';e.rain=e.rainTarget=e.wet=0;e.dayLen=1e12;e.weatherT=1e9;e.update(0,g.hero.ctrl.pos);});
 const report=[];
 for(const bid of [169,499,205,92,425,472,242,130,118]){
  const row=await page.evaluate(bid=>{
   const g=TL.game,q=g.streamer.constructionState.sites.find(q=>q.roofBid===bid),b=new THREE.Box3();for(const m of q.meshes){m.updateMatrixWorld(true);b.expandByObject(m);}
   const size=b.getSize(new THREE.Vector3()),at=b.getCenter(new THREE.Vector3()),distance=Math.max(28,size.length()*.5/Math.sin(58*Math.PI/360)*1.05),samples=[];
   for(const x of [.12,.5,.88])for(const z of [.12,.5,.88])samples.push(new THREE.Vector3(b.min.x+size.x*x,b.max.y-.6,b.min.z+size.z*z));
   let best=null;
   for(const elevation of [.6,1.2,2,3.5,6])for(let j=0;j<24;j++){
    const a=j*Math.PI/12,dir=new THREE.Vector3(Math.cos(a),elevation,Math.sin(a)).normalize(),cam=at.clone().addScaledVector(dir,distance);let clear=0;
    for(const target of samples){const ray=target.clone().sub(cam),len=ray.length();ray.normalize();const hit=g.world.raycast(cam.x,cam.y,cam.z,ray.x,ray.y,ray.z,len-.5,c=>c.solid&&c.siteId!==q.id&&c.bid!==bid,null,{noGround:true});if(!hit)clear++;}
    const score=clear-elevation*.025;if(!best||score>best.score)best={cam,score,clear,elevation};
   }
   BENCH.pose={cam:best.cam.toArray(),at:at.toArray(),fov:58};BENCH.applyPose();g.hero.ctrl.teleport(q.start.x,q.start.y+TL.C.FEET+.02,q.start.z);g.streamer.update(g.camera.position,new THREE.Vector3(),1/60);for(let i=0;i<6;i++){BENCH.render();BENCH.sync();}
   return{type:'crown',bid,clearSamples:best.clear,totalSamples:samples.length,elevation:best.elevation,pose:BENCH.pose};
  },bid);report.push(row);await page.screenshot({path:`${out}/crown_${bid}.png`});console.log('CROWN',JSON.stringify(row));
 }
 for(const bid of [169,499,92,425,472,242,535,389]){
  const row=await page.evaluate(bid=>{
   const g=TL.game,m=g.streamer.facadeRepairState.meshes.find(m=>m.userData.facadeRepairBid===bid);if(!m)return{type:'facade',bid,skip:'no repaired face'};
   const p=m.geometry.attributes.position.array,tri=[];
   for(let i=0;i<p.length;i+=9){const a=new THREE.Vector3(...p.slice(i,i+3)),b=new THREE.Vector3(...p.slice(i+3,i+6)),c=new THREE.Vector3(...p.slice(i+6,i+9)),normal=b.clone().sub(a).cross(c.clone().sub(a)),area=normal.length()*.5;normal.normalize();tri.push({at:a.add(b).add(c).multiplyScalar(1/3),normal,area});}tri.sort((a,b)=>b.area-a.area);
   let best=null;for(const t of tri.slice(0,24)){
    const dir=t.normal.clone().add(new THREE.Vector3(0,.22,0)).normalize(),desired=Math.min(40,Math.max(13,Math.sqrt(t.area)*.6)),start=t.at.clone().addScaledVector(t.normal,.3);
    const hit=g.world.raycast(start.x,start.y,start.z,dir.x,dir.y,dir.z,desired,c=>c.solid&&c.bid!==bid,null,{noGround:true}),dist=hit?Math.max(.5,hit.t-1):desired,score=Math.min(1,dist/desired)*Math.sqrt(t.area);if(!best||score>best.score)best={...t,dist,score,cam:start.addScaledVector(dir,dist)};
   }
   BENCH.pose={cam:best.cam.toArray(),at:best.at.toArray(),fov:62};BENCH.applyPose();g.streamer.update(g.camera.position,new THREE.Vector3(),1/60);for(let i=0;i<6;i++){BENCH.render();BENCH.sync();}
   return{type:'facade',bid,area:best.area,distance:best.dist,pose:BENCH.pose};
  },bid);report.push(row);if(!row.skip)await page.screenshot({path:`${out}/facade_${bid}.png`});console.log('FACADE',JSON.stringify(row));
 }
 const errors=await page.evaluate(()=>({errors:TL.errors.slice(),gl:BENCH.gl.getError()}));assert.deepEqual(errors,{errors:[],gl:0});assert.deepEqual(page.errors,[]);fs.writeFileSync(`${out}/report.json`,JSON.stringify({captures:report,errors},null,2));console.log('PASS focused captures; human visual inspection required');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
