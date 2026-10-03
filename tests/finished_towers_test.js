'use strict';
const assert=require('assert'),{setup}=require('../tools/relocate_construction_towers');
const asset=require('../evidence/construction/relocated_towers.json'),world=setup(),W=world.world;
const unfinished=new Set(world.constructionState.sites.map(s=>s.roofBid));
assert.equal(asset.towers.length,20);assert.equal(new Set(asset.towers.map(t=>t.roofBid)).size,20);
for(const t of asset.towers){assert(!unfinished.has(t.roofBid));assert(TL.FinishedTowers.validate(world,t),t.id+' must stand on a clear completed roof');}
console.log('PASS twenty relocated assemblies have separate finished roofs, supported feet, clear bodies and clear approaches');
const original=asset.towers[0];assert(!TL.FinishedTowers.validate(world,{...original,roofBid:[...unfinished][0]}));assert(!TL.FinishedTowers.validate(world,{...original,y:original.y+2}));
console.log('PASS unfinished building and floating-roof placements are rejected');
const before={count:W.count,gates:W.referenceGates.length,children:world.scene.children.length};TL.Construction.finishedTowerAsset=asset;const state=TL.FinishedTowers.build(world);assert.equal(state.gates.length,20);assert.deepEqual(state.skipped,[]);
for(const site of world.constructionState.sites){const point=site.routePoints.find(p=>p.kind==='water_tower');assert(point);assert(!unfinished.has(site.finishedTowerRoof));assert.equal(point.gate.type,'water_tower');assert(point.center.distanceTo(site.center)>15);assert(TL.WorksiteRuns.checkpoint(W,point));
 for(const side of Object.values(point.gate.anchorsBySide))for(const a of side){assert.equal(a.col.src,'finished_tower');const p=a.col.toLocal(a.x,a.y,a.z,{});assert(Math.abs(p.z)<=a.col.hz+.001);assert(Math.abs(Math.abs(p.z)-a.col.hz)<.001);}
}
console.log('PASS all twenty route links point to real finished-roof gates with actual leg-face anchors');
TL.FinishedTowers.dispose(world);assert.equal(W.count,before.count);assert.equal(W.referenceGates.length,before.gates);assert.equal(world.scene.children.length,before.children);
console.log('PASS disposal removes only added finished-roof meshes, colliders and gates');
