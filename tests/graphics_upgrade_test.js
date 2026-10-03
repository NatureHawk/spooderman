'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
global.THREE = require('C:/Users/PRIYAN~1/AppData/Local/Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness/node_modules/three/build/three.cjs');
global.TL = { clamp: (x,a,b)=>Math.max(a,Math.min(b,x)), Game: function(){}, Environment:function(){}, Post:{apply(){},TIER:{high:2}}, Atmos:{}, bus:{on(){}}, Assets:{setSlots(){}} };
TL.Game.prototype.applyQuality=function(){}; TL.Environment.prototype.updateEnv=function(){};
const source=f=>fs.readFileSync('src/'+f,'utf8');
vm.runInThisContext(source('03j_render_cull.js').split('if (TL.ScanHooks)')[0]);
for(const f of ['03c_trees.js','03k_low_manhattan.js','10_crowd.js','21b_reflect.js','22_perf.js'])vm.runInThisContext(source(f));
// Real tree bins: complementary pairs through every quality-scaled transition.
const geo = new THREE.BoxGeometry(2,8,2); geo.setAttribute('aW',new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count*4).fill(.5),4));
const data={imgs:{},meta:{atlas:{file:'none'},species:['a'],bark:{a:['a','b']}},models:[{name:'tree',sp:'a',H:8,R:2,lods:[0,1,2].map(()=>({bark:geo,leaf:null}))}]};
const scene=new THREE.Scene(), renderer={capabilities:{getMaxAnisotropy:()=>1}};
const field=new TL.TreeField(scene,renderer,data,[{x:0,z:0,m:0,s:1}],{impostors:false});
const camera=new THREE.PerspectiveCamera(65,1,.1,2000);
for(const quality of ['low','medium','high','ultra']){
 field.setQuality(quality);
 for(const distance of [field.d0-7,field.d0,field.d0+7,field.d1,field.d1+25]){
  camera.position.set(0,field.bs[1],distance+field.bs[3]);camera.lookAt(0,field.bs[1],0);camera.updateMatrixWorld(true);
  field.update(camera,1/60,null);
  const bins=field.groups[0].filter(g=>g.n);assert(bins.length<=2);assert(bins.length>=1);
  if(bins.length===2){assert.equal(bins[0].fade.array[1],-1);assert.equal(bins[1].fade.array[1],1);assert.equal(bins[0].fade.array[0],bins[1].fade.array[0]);}
  for(const g of bins)assert(g.n<=g.im.count,'bounded instance capacity');
 }
}
// Low's compacted matrices and per-instance tree/impostor attributes stay aligned and restore.
const geom=new THREE.BoxGeometry();geom.setAttribute('aTreeLod',new THREE.InstancedBufferAttribute(new Float32Array([.1,-1,.6,1,.9,1]),2));
const mesh=new THREE.InstancedMesh(geom,new THREE.MeshBasicMaterial(),3), matrix=new THREE.Matrix4();
[500,20,40].forEach((x,i)=>mesh.setMatrixAt(i,matrix.makeTranslation(x,0,0)));mesh.updateMatrixWorld();
const changes=[],change=(o,k,v)=>{changes.push([o,k,o[k]]);o[k]=v;};camera.position.set(0,0,0);
TL.LowManhattan.trimInstances(mesh,camera,80,change);assert.equal(mesh.count,2);assert(Math.abs(mesh.geometry.attributes.aTreeLod.array[0]-.6)<1e-6);assert.equal(mesh.instanceMatrix.array[12],20);
for(const [o,k,v]of changes.reverse())o[k]=v;assert.equal(mesh.count,3);assert.equal(mesh.instanceMatrix.array[12],500);
// Scheduling: static views skip work, moving views finish cubes, filters never share a capture frame.
let now=100, captures=[],publishes=[];const realPerf=global.performance;global.performance={now:()=>now};
const env={skyU:{uSunDir:{value:new THREE.Vector3(0,1,0)}},rain:0};TL.game={env};
const R=TL.Render;R.cfg={mode:'scene',period:4};R.build=()=>{};R.captureFace=()=>captures.push(R.frame);R.blurCube=()=>({texture:{}});R.pmrem={fromCubemap:()=>({texture:{}})};R.probe={texture:{}};R.captureProbe={texture:{}};R.cc={};
const originalPublish=R.publish;R.publish=function(...a){publishes.push(this.frame);return originalPublish.apply(this,a)};
R._center.set(0,0,0);R.publish({},scene);camera.position.set(0,0,0);
for(let i=0;i<120;i++){now+=10;R.update({},scene,camera)}assert.equal(captures.length,0,'stationary probe idle');
camera.position.x=25;for(let i=0;i<40;i++){now+=10;R.update({},scene,camera)}assert.equal(captures.length,6);assert.equal(publishes.length,2);assert(!captures.includes(publishes[1]),'filtering has its own frame');
const displayed=R.U.tlProbe.value;assert.equal(displayed,R.probe.texture);assert.notEqual(displayed,R.captureProbe.texture);
// Even perpetual shader streaming cannot starve the probe; work remains staged.
TL.game.streamer={lowRender:{preparedThisFrame:1}};camera.position.x=60;
const previousCaptures=captures.length,previousPublishes=publishes.length;
for(let i=0;i<120;i++){now+=10;R.update({},scene,camera)}
assert.equal(captures.length-previousCaptures,6);assert.equal(publishes.length-previousPublishes,1);
assert(!captures.includes(publishes.at(-1)));delete TL.game.streamer;
// Frame pacing ignores pauses, requires sustained load, and recovers slowly.
TL.Perf.secondaryScale=1;TL.Perf.frameMs=16.7;TL.Perf.observeFrame(10);assert.equal(TL.Perf.secondaryScale,1);
for(let i=0;i<110;i++)TL.Perf.observeFrame(.05);assert.equal(TL.Perf.secondaryScale,3);
for(let i=0;i<450;i++)TL.Perf.observeFrame(.016);assert.equal(TL.Perf.secondaryScale,1);
global.performance=realPerf;
// Street rigs: entry/exit hysteresis and a bounded promotion batch.
const manager=Object.create(TL.CrowdManager.prototype);camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.updateMatrixWorld();manager.game={camera};manager.nearMax=6;manager.peds=[];
manager.getSkin=()=>({sk:{mesh:{visible:false}},mat:{},extra:{}});
for(let i=0;i<6;i++)manager.peds.push({alive:true,pos:new THREE.Vector3(0,0,-20-i),variant:'m',colors:{},skin:null});
manager.assignSkins();assert.equal(manager.peds.filter(p=>p.skin).length,2);manager.assignSkins();assert.equal(manager.peds.filter(p=>p.skin).length,4);
const held=manager.peds[0];held.pos.z=-75;manager.assignSkins();assert(held.skin,'incumbent retained through exit band');held.pos.z=-83;manager.assignSkins();assert(!held.skin);
console.log('PASS tree LOD bands at every tier, complementary coverage and bounded bins, Low attribute restoration, coherent reflection buffers, separate filtering frame, stationary skip, pacing hysteresis, pedestrian detail hysteresis and bounded promotions');

