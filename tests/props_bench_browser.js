'use strict';
const {launch,start,setScene}=require('./graphics_bench/lib');const fs=require('fs'),assert=require('assert');
(async()=>{const out=[],base=!!process.env.PROP_BASE;for(const quality of ['low','medium','high','ultra']){const {browser,page}=await launch({headless:true,w:1280,h:720});try{
 await start(page,base?'evidence/BASELINE.html':'THREADLINE.html',quality);
 for(const scene of ['street','roof']){await setScene(page,scene);await page.evaluate(()=>{BENCH.setFilter('off',0);for(let i=0;i<25;i++)BENCH.render();BENCH.sync();});
 const r=await page.evaluate(async()=>{const g=TL.game,a=[];for(let k=0;k<5;k++){const t=performance.now();for(let i=0;i<24;i++){g.tick(1/60);BENCH.render();}BENCH.sync();a.push((performance.now()-t)/24);await new Promise(r=>setTimeout(r,0));}a.sort((a,b)=>a-b);return {ms:a[2],fps:1000/a[2],samples:a,renderer:BENCH.info(),people:(TL.Assets.people||[]).length,roofProps:g.streamer.roofState?.placements.length,street:g.streamer.streets?.stats};});
 await page.screenshot({path:`evidence/props/${base?'before':'after'}_${quality}_${scene}.png`});out.push({quality,scene,...r});console.log(JSON.stringify(out[out.length-1]));}
 assert.deepEqual(page.errors,[]);
 if(!base&&quality==='medium'){
 const results=await page.evaluate(()=>{const g=TL.game;window.propScene=new THREE.Scene();propScene.background=new THREE.Color(0x919ca4);propScene.environment=g.scene.environment;propScene.add(new THREE.HemisphereLight(0xffffff,0x343d4c,.9));const sun=new THREE.DirectionalLight(0xfff5e8,1.4);sun.position.set(4,7,5);propScene.add(sun);return Object.keys(TL.Assets.man.assets).filter(n=>n.startsWith('P_')&&TL.Assets.entry(n,'mid')?.hb===4);});
 for(const name of results){await page.evaluate(name=>{if(window.propModel)propScene.remove(propModel);const geo=TL.Assets.geo(name,'mid');window.propModel=new THREE.Mesh(geo,TL.Assets.texMats(geo));propScene.add(propModel);const b=geo.boundingBox,c=b.getCenter(new THREE.Vector3()),s=b.getSize(new THREE.Vector3()),r=Math.max(s.x,s.y,s.z);const g=TL.game;g.camera.position.copy(c).add(new THREE.Vector3(1.05,.65,1.45).multiplyScalar(r));g.camera.lookAt(c);g.camera.fov=40;g.camera.updateProjectionMatrix();g.renderer.setRenderTarget(null);g.renderer.render(propScene,g.camera);},name);await page.screenshot({path:`evidence/props/runtime_${name}.png`});}
 }
 }finally{await browser.close();}}
 fs.writeFileSync(`evidence/props/${base?'before':'after'}_performance.json`,JSON.stringify(out,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
