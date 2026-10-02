'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE=require(path.join(harness,'node_modules/three/build/three.cjs'));
for(const f of ['00_core.js','02_collision.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'));
TL.ScanHooks={build:[],nycTile:null};
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src/03g_rooftops.js'),'utf8'));
const nyc=require('../build/nyc.json'),bin=fs.readFileSync(path.join(__dirname,'../build/nyc.bin'));
const world={scene:new THREE.Scene(),world:new TL.CollisionWorld(),mats:{uniforms:{uWet:{value:0}}}};
let all=0,wall=0;
for(const b of nyc.buildings){
 const P=new Float32Array(b.n*9);for(let i=0;i<P.length;i++)P[i]=bin.readFloatLE(b.o+i*4);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(P,3));g.computeVertexNormals();
 TL.Rooftops.tile(world,g,[b]);all+=b.n;wall+=g.index.count/3;
 assert(new Set(g.index.array).size===g.index.count,'Duplicate wall vertices');
}
const R=world.roofState;assert.equal(wall+R.roofTriangles,all,'Roof partition lost triangles');assert(R.roofTriangles>1000);assert(R.pitchedTriangles>20);
TL.Rooftops.build(world);
assert(R.placements.length>150,'Missing rooftop equipment');
const counts={};for(const p of R.placements){counts[p.type]=(counts[p.type]||0)+1;const a=R.analyses.find(a=>a.b.id===p.bid);assert(TL.Rooftops.fits(a,p.x,p.z,p.y,p.hx,p.hz,p.yaw,1),'Equipment overhangs roof or intersects upper bulkhead');}
for(const c of R.colliders)assert([c.cx,c.cy,c.cz,c.hx,c.hy,c.hz].every(Number.isFinite)&&c.hx>0&&c.hy>0&&c.hz>0);
for(const m of R.meshes){for(const a of Object.values(m.geometry.attributes))assert(a.array.every(Number.isFinite),'Non-finite geometry');}
const drawCalls=Object.entries(R.kits).reduce((n,[name,parts])=>n+(R.buckets.has(name)?parts.length:0),0);
let triangles=0;for(const m of R.meshes)if(m.isInstancedMesh)triangles+=m.geometry.attributes.position.count/3*m.count;
console.log('PASS roof/wall partition:',R.roofTriangles,'roof triangles,',R.pitchedTriangles,'pitched');
console.log('PASS actual-city supported placements',JSON.stringify(counts),'colliders',R.colliders.length,'prop draws',drawCalls,'prop triangles',triangles);
// A roof with a courtyard must not accept a box spanning its hole.
const q=(x0,z0,x1,z1)=>[{p:[x0,10,z0,x1,10,z0,x1,10,z1]},{p:[x0,10,z0,x1,10,z1,x0,10,z1]}];
const courtyard={faces:[...q(-10,-10,-2,10),...q(2,-10,10,10),...q(-2,-10,2,-2),...q(-2,2,2,10)]};
assert.equal(TL.Rooftops.topAt(courtyard,0,0),-Infinity);assert(!TL.Rooftops.fits(courtyard,0,0,10,3,3,0));assert(TL.Rooftops.fits(courtyard,-6,0,10,1,1,0));
console.log('PASS courtyard and unsupported equipment rejection');
for(const p of R.placements.filter(p=>p.type==='hvac').slice(0,50)){
 const hit=world.world.raycast(p.x,p.y+5,p.z,0,-1,0,7,c=>c.bid===p.bid,{}, {noGround:true});
 assert(hit&&hit.col.src==='rooftop'&&hit.col.anchor&&hit.col.walkTop);
 assert(Math.abs(hit.y-(p.y+1.5))<.025,'HVAC landing collision does not match the visible unit');
}
console.log('PASS roof equipment supports landing and web-anchor raycasts');
