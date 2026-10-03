'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE=require(path.join(harness,'node_modules/three/build/three.cjs'));
for(const f of ['00_core.js','02_collision.js','04_physics.js','04b_contact.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'));
TL.ScanHooks={build:[],preNYC:[],nycTile:null};
for(const f of ['03g_rooftops.js','03h_roofobstacles.js','03i_traversal_supports.js','03n_construction.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'));
const nyc=require('../build/nyc.json'),bin=fs.readFileSync(path.join(__dirname,'../build/nyc.bin'));
const world={scene:new THREE.Scene(),world:new TL.CollisionWorld(),mats:{uniforms:{uWet:{value:0}}}};
world.spawnPoint=()=>require('../build/scan.json').spawn;
const manifest=require('../evidence/construction/building_manifest.json'),blueprints=require('../evidence/construction/structural_blueprints_20.json').sites;TL.Construction.authored=new Map(manifest.sites.map(p=>{const b=blueprints.find(b=>b.bid===p.roofBid);return[p.roofBid,{...p,name:b.name,model:b.model}];}));
world.data={nyc,nycBin:bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)};world.replaced=new Set();TL.Construction.prepare(world);
for(const p of world.constructionPlans){const b=nyc.buildings.find(b=>b.id===p.roofBid);assert(p.originalTop-p.cutY>=8.39,'At least two original finished floors removed');assert.strictEqual(p.cut._source,b);assert(p.cut._triSource.every(i=>i>=0&&i<b.n));assert(p.cut._UV.every(Number.isFinite));for(let i=1;i<p.cut._P.length;i+=3)assert(p.cut._P[i]<=p.cutY+.0001,'Original facade remains above cut');assert.equal(p.cut.n,p.cut._triSource.length);}
console.log('PASS twenty original facade clips, matching UV provenance and source identity');
const B=nyc.boxes;
for(let k=0;k<B.n;k++){const a=[];for(let j=0;j<B.stride;j++)a.push(bin.readFloatLE(B.o+(k*B.stride+j)*4));a[1]=Math.min(a[1],world.constructionCuts.get(a[6])?.cutY??Infinity);world.world.addStatic(a[0],(a[1]-1)/2,a[2],a[3],(a[1]+1)/2,a[4],a[5],{kind:'building',src:'nyc',bid:a[6],climb:true});}
for(const original of nyc.buildings){const b=world.constructionCuts.get(original.id)?.cut||original,P=b._P||new Float32Array(b.n*9);if(!b._P)for(let i=0;i<P.length;i++)P[i]=bin.readFloatLE(b.o+i*4);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(P,3));g.computeVertexNormals();TL.Rooftops.tile(world,g,[b]);g.dispose();}
TL.Rooftops.build(world);TL.RoofObstacles.build(world);TL.TraversalSupports.build(world);
const start=performance.now(),S=TL.Construction.build(world);
console.log('Placement',JSON.stringify(S.stats),'ms',Math.round(performance.now()-start));

assert.equal(S.sites.length,20,'Must place exactly twenty sparse supported sites');
for(const s of S.sites){for(const t of S.sites)if(s!==t)assert(s.center.clone().setY(0).distanceTo(t.center.clone().setY(0))>=90);for(const m of s.meshes)for(const a of Object.values(m.geometry.attributes))assert(a.array.every(Number.isFinite));for(const c of s.colliders)assert(c.solid&&c.climb&&c.anchor&&c.hx>0&&c.hy>0&&c.hz>0);}
for(const site of S.sites){
 const start=site.start,candidates=[];world.world.query(start.x-2,start.z-2,start.x+2,start.z+2,candidates);
 assert(!TL.Contact.overlap(world.world,candidates,start.x,start.y+TL.C.FEET+.05,start.z,TL.BodyShapes.stand,.02),'Start body blocked');
 for(const [dx,dz] of [[0,0],[-.35,0],[.35,0],[0,-.35],[0,.35]]){const hit=world.world.raycast(start.x+dx,start.y+.3,start.z+dz,0,-1,0,.65,c=>c.solid&&!c.dynamic,null);assert(hit&&Math.abs(hit.y-start.y)<.12,'Start lacks broad slab support');}
 const gate=site.routePoints[0];for(let t=-gate.approach;t<=gate.approach;t+=.25){const p=gate.center.clone().addScaledVector(gate.axis,t),c=[];world.world.query(p.x-1,p.z-1,p.x+1,p.z+1,c);assert(!TL.Contact.overlap(world.world,c,p.x,p.y,p.z,TL.BodyShapes.stand,.02),'Frame passage blocked');}
}
console.log('PASS starts supported on authored decks and frame lanes clear standing capsule');
let laneSamples=0;
for(const site of S.sites)for(const gate of site.gates){
 for(let t=-gate.length/2-10;t<=gate.length/2+10;t+=.25){const p=gate.center.clone().addScaledVector(gate.axis,t),candidates=[];world.world.query(p.x-2,p.z-2,p.x+2,p.z+2,candidates);assert(!TL.Contact.overlap(world.world,candidates,p.x,p.y,p.z,TL.BodyShapes.tuck,.03),'Gate lane blocked '+gate.id+' '+t);laneSamples++;}
 for(const hits of Object.values(gate.anchorsBySide))for(const hit of hits){const q=hit.col.toLocal(hit.x,hit.y,hit.z,{}),e=[hit.col.hx,hit.col.hy,hit.col.hz],v=[q.x,q.y,q.z];assert(v.every((x,i)=>Math.abs(x)<=e[i]+.035));assert(v.some((x,i)=>Math.abs(Math.abs(x)-e[i])<.035),'Anchor must touch a real member face');}
}
console.log('PASS actual scan gate sweep samples',laneSamples,'and exact-face web anchors');
const gates=world.world.referenceGates.length,children=world.scene.children.length;TL.Construction.dispose(world);assert(!world.constructionState);assert.equal(world.world.referenceGates.length,gates-S.gates.length);assert.equal(world.scene.children.length,children-S.meshes.length);
console.log('PASS actual scan support, sparse density, finite meshes, traversal members and cleanup');



