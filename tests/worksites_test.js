/* Real route/collision adapter tests. Construction mesh geometry is validated separately in construction_test. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const H=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE=require(path.join(H,'node_modules/three/build/three.cjs'));
for(const f of ['00_core.js','02_collision.js','04_physics.js','04b_contact.js','12b_routes.js','12d_worksites.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});
TL.V.init();let pass=0;function test(n,f){f();pass++;console.log('PASS '+n);}
function game(yaw=0){
 const world=new TL.CollisionWorld();world.groundFn=()=>0;
 const h=new TL.HeroController(world,TL.HERO_STATS.PULSE),pressed=new Set();
 const g={world,scanMode:true,scene:new THREE.Scene(),hero:{ctrl:h,anim:{}},rig:{smoothT:new THREE.Vector3()},audio:{sfx(){}},ui:{setWaypoint(){},hint(){},prompt(){},openModal(){}},progress:{addXP(n){g.xp+=n;}},save:{save(){}},xp:0,input:{consume:k=>pressed.delete(k)},missions:{}};
 const roof=world.addStatic(0,15,0,38,15,38,yaw,{kind:'building'}),point=(x,y,z)=>roof.toWorld(x,y-roof.cy,z,new THREE.Vector3()),axis=roof.dirToWorld(0,0,1,new THREE.Vector3());
 const start=point(-20,30,-20),ps=[point(-20,32,-10),point(-20,34,4),point(-8,32,18),point(5,30+TL.C.FEET,24)];
 const site={id:'construction-0',name:'Test Works',start:{x:start.x,y:start.y,z:start.z,yaw},routePoints:ps.map((center,i)=>({center,axis,radius:2,kind:i===3?'zone':['frame','pipe','water_tower'][i],surface:i===3?30:undefined}))};
 g.streamer={constructionState:{sites:[site]}};g.routes=new TL.RouteChallenges(g);return {g,h,world,roof,site,point,axis,pressed};
}
function complete(G,timeScale=1){const {g,h}=G,r=g.routes,d=r.defs.find(d=>d.kind==='worksite');assert(r.begin(d));r.update(3.1);
 for(const c of d.cps){const n=c.n?new THREE.Vector3(c.n[0],0,c.n[1]):new THREE.Vector3(0,0,1);h.pos.set(c.x-n.x*4,c.y,c.z-n.z*4);r.active.prev.copy(h.pos);h.vel.copy(n).multiplyScalar(12);for(let i=0;i<16&&r.active.phase==='run';i++){h.pos.addScaledVector(n,.5);r.update(.05*timeScale);}}
 assert.equal(r.active.phase,'done');return r.best[d.id];}
for(const yaw of [0,.6,Math.PI/2])test('real supported route starts and directional opening gates at yaw '+yaw,()=>{const G=game(yaw),d=G.g.routes.defs.find(x=>x.kind==='worksite');assert(d&&d.cps.length===4);assert(TL.WorksiteRuns.validateStart(G.world,d.start));for(const c of d.cps)assert(TL.WorksiteRuns.clear(G.world,new THREE.Vector3(c.x,c.y,c.z)));const b=complete(G);assert(b.replay.samples.length>2&&b.replay.splits.length===4);assert.equal(G.g.xp,180);});
test('site reward is granted once and survives faster PB replacement, restart, save and reload',()=>{
 const G=game(),r=G.g.routes,first=complete(G),time=first.time,replay=JSON.stringify(first.replay);assert(first.rewarded);complete(G,2);assert.equal(G.g.xp,180);assert.equal(r.best.worksite_construction_0.time,time);assert.equal(JSON.stringify(r.best.worksite_construction_0.replay),replay);
 const saved=JSON.parse(JSON.stringify(r.serialize()));r.deserialize(saved);const faster=complete(G,.5);assert(faster.time<time);assert(faster.rewarded);assert.equal(G.g.xp,180);assert.equal(r.lastResult.xpReward,0);
});
test('legacy base-route bests remain unchanged and site reward can be claimed if not previously saved',()=>{
 const G=game(),g=G.g,r=g.routes;r.deserialize({best:{rooftop_flow:{time:25,score:6000,medal:'silver'},worksite_construction_0:{time:100,score:10,medal:null}}});assert.deepEqual(r.best.rooftop_flow,{time:25,score:6000,medal:'silver'});assert(!r.best.worksite_construction_0);complete(G);assert.equal(g.xp,180);assert(r.best.worksite_construction_0.rewarded);
});
test('changed course clears obsolete ghost and PB while preserving earned reward across reloads',()=>{
 const G=game(),r=G.g.routes;complete(G);const saved=JSON.parse(JSON.stringify(r.serialize())),d=r.defs.find(d=>d.kind==='worksite');d.course='changed';r.deserialize(saved);assert(!r.best[d.id]);assert(r.worksiteRewards.has(d.id));r.deserialize(JSON.parse(JSON.stringify(r.serialize())));complete(G);assert.equal(G.g.xp,180);assert.equal(r.best[d.id].course,'changed');assert(r.best[d.id].replay);
});
test('blocked opening is omitted; fewer than three usable checkpoints refuses a fake course',()=>{
 const G=game();for(const p of G.site.routePoints.slice(0,2)){G.world.addStatic(p.center.x,p.center.y,p.center.z,2,2,2,0,{kind:'prop'});}const defs=TL.WorksiteRuns.build(G.g);assert.equal(defs.length,0);assert(TL.WorksiteRuns.diagnostics.some(x=>/fewer/.test(x.reason)));
});
test('solid start, nonexistent start support and duplicate ids are rejected',()=>{
 const G=game(),s=G.site.start;G.world.addStatic(s.x,s.y+1,s.z,1,1,1,0,{kind:'prop'});assert.equal(TL.WorksiteRuns.build(G.g).length,0);
 const B=game();B.site.start.x=200;assert.equal(TL.WorksiteRuns.build(B.g).length,0);
 const C=game();C.g.streamer.constructionState.sites.push(C.site);assert.equal(TL.WorksiteRuns.build(C.g).length,1);
});
test('abort never grants site reward, and existing mission/encounter conflicts block start',()=>{
 const G=game(),r=G.g.routes,d=r.defs.find(x=>x.kind==='worksite');r.begin(d);r.update(3.1);r.exit();assert.equal(G.g.xp,0);assert(!r.best[d.id]);G.g.encounters={active:{}};assert.equal(r.begin(d),false);
});
test('near-start interaction checks elevation, pause/modal state and objective conflicts',()=>{
 const G=game(),r=G.g.routes,d=r.defs.find(x=>x.kind==='worksite');G.h.pos.set(d.start.x,d.start.y+TL.C.FEET,d.start.z);assert.equal(r.nearStart(),d);
 G.g.state='pause';assert.equal(r.nearStart(),null);G.g.state='play';G.g.ui.modal={};assert.equal(r.nearStart(),null);G.g.ui.modal=null;G.h.pos.y+=4;assert.equal(r.nearStart(),null);G.h.pos.y-=4;G.g.encounters={active:{}};assert.equal(r.nearStart(),null);
});
test('procedural mode remains unchanged and generated worksite definitions are bounded',()=>{
 const G=game();G.g.scanMode=false;assert.equal(TL.WorksiteRuns.build(G.g).length,0);G.g.scanMode=true;G.g.streamer.constructionState.sites=Array.from({length:40},(_,i)=>({...G.site,id:'construction-'+i}));assert.equal(TL.WorksiteRuns.build(G.g).length,20);
});
test('twenty worksite bests and original three route saves survive the bounded import',()=>{
 const G=game(),r=G.g.routes;G.g.streamer.constructionState.sites=Array.from({length:20},(_,i)=>({...G.site,id:'construction-'+i}));r.defs=TL.ROUTE_DEFS.concat(TL.WorksiteRuns.build(G.g));const best={};for(const d of r.defs)best[d.id]={time:30,score:200,medal:'silver',course:d.course,rewarded:d.kind==='worksite'};
 r.deserialize({best});assert.equal(Object.keys(r.best).length,23);assert.equal(r.worksiteRewards.size,20);r.deserialize(JSON.parse(JSON.stringify(r.serialize())));assert.equal(Object.keys(r.best).length,23);assert.equal(r.worksiteRewards.size,20);
 const oversized={best:Object.fromEntries(Array.from({length:100},(_,i)=>['unknown_'+i,{time:1}]))};r.deserialize(oversized);assert.equal(Object.keys(r.best).length,32);complete(G);const saved=r.serialize();assert.equal(Object.keys(saved.best).length,32);assert(saved.best.worksite_construction_0,'Known courses must survive over-cap stale imports');
});
test('worksite beams stay low and only appear nearby or when selected as waypoint',()=>{
 const G=game(),r=G.g.routes,mark=r.startMarks.find(x=>x.def.kind==='worksite');assert.equal(mark.g.children[0].geometry.parameters.height,4);
 G.h.pos.set(1000,40,1000);r.refreshStartMarkers();assert(!mark.g.visible);const s=mark.def.start;G.g.ui.waypoint=new THREE.Vector3(s.x,s.y,s.z);r.refreshStartMarkers();assert(mark.g.visible);G.g.ui.waypoint=null;G.h.pos.set(s.x,s.y+TL.C.FEET,s.z);r.refreshStartMarkers();assert(mark.g.visible);r.begin(mark.def);r.refreshStartMarkers();assert(!mark.g.visible);
});
console.log(pass+' worksite checks passed');
