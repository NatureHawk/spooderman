/* Verify generated route promises against the complete shipped scan collision data. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE=require(path.join(harness,'node_modules/three/build/three.cjs'));
for(const f of ['00_core.js','01_assets.js','02_collision.js','04_physics.js','04b_contact.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'));
TL.ScanHooks={build:[],preNYC:[],update:[],nycTile:null};
for(const f of ['03g_rooftops.js','03h_roofobstacles.js','03i_traversal_supports.js','03n_construction.js','03p_finished_towers.js','03o_construction_cranes.js','12d_worksites.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'));
const nyc=require('../build/nyc.json'),bin=fs.readFileSync(path.join(__dirname,'../build/nyc.bin'));
const streamer={scene:new THREE.Scene(),world:new TL.CollisionWorld(),mats:{uniforms:{uWet:{value:0}}}},world=streamer.world;
streamer.spawnPoint=()=>require('../build/scan.json').spawn;
const manifest=require('../evidence/construction/building_manifest.json'),finalPath=path.join(__dirname,'../evidence/construction/structural_blueprints_20.json'),blueprints=fs.existsSync(finalPath)?JSON.parse(fs.readFileSync(finalPath)).sites:[...require('../evidence/construction/blueprints_0_9.json'),...require('../evidence/construction/blueprints_10_19.json').sites],{splitTower}=require('../tools/construction_tower_tools');
if(process.env.TL_CONSTRUCTION_PROOF){const proof=require('../evidence/construction/structural_proof_117.json'),i=blueprints.findIndex(b=>b.bid===proof.bid);blueprints[i]=proof;}
TL.Construction.authored=new Map(manifest.sites.map(p=>{const b=blueprints.find(b=>b.bid===p.roofBid),model=splitTower(b.model).siteModel;assert(!model.tower&&!model.parts.some(p=>p.shape==='tank'),'Unfinished architecture has no tank assembly');return[p.roofBid,{...p,name:b.name,model}];}));
TL.Construction.finishedTowerAsset=require('../evidence/construction/relocated_towers.json');
streamer.data={nyc,nycBin:bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)};streamer.replaced=new Set();TL.Construction.prepare(streamer);
const B=nyc.boxes;
for(let k=0;k<B.n;k++){const a=[];for(let j=0;j<B.stride;j++)a.push(bin.readFloatLE(B.o+(k*B.stride+j)*4));a[1]=Math.min(a[1],streamer.constructionCuts.get(a[6])?.cutY??Infinity);world.addStatic(a[0],(a[1]-1)/2,a[2],a[3],(a[1]+1)/2,a[4],a[5],{kind:'building',src:'nyc',bid:a[6],climb:true});}
for(const original of nyc.buildings){const b=streamer.constructionCuts.get(original.id)?.cut||original,P=b._P||new Float32Array(b.n*9);if(!b._P)for(let i=0;i<P.length;i++)P[i]=bin.readFloatLE(b.o+i*4);const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(P,3));geo.computeVertexNormals();TL.Rooftops.tile(streamer,geo,[b]);geo.dispose();}
TL.Rooftops.build(streamer);TL.RoofObstacles.build(streamer);TL.TraversalSupports.build(streamer);TL.Construction.build(streamer);TL.FinishedTowers.build(streamer);
TL.Assets.man=require('../build/assets.json');const ab=fs.readFileSync(path.join(__dirname,'../build/assets.bin'));TL.Assets.bin=ab.buffer.slice(ab.byteOffset,ab.byteOffset+ab.byteLength);
const cranes=TL.ConstructionCranes.build(streamer);assert.equal(cranes.cranes.length,20,'Each authored site needs a supported moving crane');assert.deepEqual(cranes.skipped,[]);
const defs=TL.WorksiteRuns.build({world,streamer,scanMode:true});
assert.deepEqual(TL.WorksiteRuns.diagnostics,[],'Every authored start and opening must be usable');
assert.equal(defs.length,20,'Each sparse site supplies one route');
for(const d of defs){
 assert.deepEqual(d.cps.map(c=>c.feature),['frame','pipe','water_tower','deck'],d.id);
 assert(TL.WorksiteRuns.validateStart(world,d.start));
 const pipe=d.cps[1];assert(pipe.approach>=4,'Pipe route checks both ends and exterior approach');
 assert.equal(d.reward,180);assert(/^[a-z0-9_]+$/.test(d.id),'Stable save-compatible route identifier');
}
console.log('PASS twenty actual scan routes, eighty clear checkpoints, twenty moving cranes, real start supports and full pipe approaches');


