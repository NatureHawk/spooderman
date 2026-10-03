/* Real encounter/traffic/crowd rules with a headless scene adapter. No mocked success flags. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE=require(path.join(harness,'node_modules/three/build/three.cjs'));
for(const f of ['00_core.js','02_collision.js','04_physics.js','04b_contact.js','10_crowd.js','11_traffic.js','12_missions.js','12c_encounters.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});
TL.V.init();
// Asset rendering is replaced by a disposable mesh; objective, civilian, traffic and collision logic are real.
TL.Assets={material:()=>new THREE.MeshBasicMaterial(),skinned:(id,lod,mat)=>({mesh:new THREE.Mesh(new THREE.BufferGeometry(),mat)}),geo:()=>null,pickLod:()=> 'mid'};
TL.NPCAnimator=class{constructor(sk){this.sk=sk;}update(dt,p,yaw){this.sk.mesh.position.copy(p);this.sk.mesh.rotation.y=yaw;}};
function game(yaw=0){
 const world=new TL.CollisionWorld();world.groundFn=()=>0;world.waterFn=()=>false;
 const roof=world.addStatic(0,12,0,24,12,24,yaw,{kind:'building'});
 const ctrl=new TL.HeroController(world,TL.HERO_STATS.PULSE);ctrl.teleport(-38,TL.C.FEET,0);
 const keys=new Set(),messages=[];
 const g={world,scene:new THREE.Scene(),hero:{ctrl},seed:23,quality:'medium',settings:{},state:'play',fps:60,env:{rain:0},streamer:{},
  layout:{district:()=> 'core',segOK:()=>true},ai:{enemies:[]},routes:{active:null},missions:{active:null,crime:null,activeActivity:null,pushFeed(){}},
  ui:{hint:t=>messages.push(t),toast:t=>messages.push(t),setObjective(t){g.objective=t;},setWaypoint(p){g.waypoint=p;},prompt(t){g.prompt=t;},caption(){}},
  audio:{sfx(){}},progress:{addXP(n){g.xp+=n;}},xp:0,save:{save(){g.saves++;}},saves:0,input:{consume:k=>keys.delete(k)}};
 g.crowd=Object.create(TL.CrowdManager.prototype);g.crowd.game=g;g.crowd.victims=[];g.crowd.peds=[];
 g.traffic=new TL.TrafficManager(g);g.encounters=new TL.TraversalEncounters(g);
 return {g,h:ctrl,e:g.encounters,roof,keys,messages};
}
function move(G,to,speed=10){const {h,e}=G;const start=h.pos.clone(),d=start.distanceTo(to),n=Math.max(1,Math.ceil(d/(speed/60)));h.vel.copy(to).sub(start).normalize().multiplyScalar(speed);for(let i=1;i<=n;i++){h.pos.lerpVectors(start,to,i/n);e.update(1/60);if(!e.active)break;}}
function press(G){assert(G.e.canInteract(),'expected actual actionable target');assert(G.e.interact());G.e.update(1/60);}
let passed=0;function test(n,f){f();passed++;console.log('PASS '+n);}
for(const yaw of [0,.61])test('courier chase completes by reach/run/interact on '+(yaw?'rotated':'cardinal')+' roof',()=>{
 const G=game(yaw),{e,h,g}=G;assert(e.start('rooftop'));const a=e.active;
 move(G,a.target.clone().add(new THREE.Vector3(0,TL.C.FEET,0)),20);
 // Close the moving gap at a real running speed rather than setting the success state.
 for(let i=0;i<500&&e.active;i++){h.vel.copy(a.target).sub(h.pos);h.vel.y=0;h.vel.normalize().multiplyScalar(9);h.pos.addScaledVector(h.vel,1/60);h.pos.y=a.target.y+TL.C.FEET;h.grounded=true;h.groundCol=a.col;e.update(1/60);if(e.active&&e.canInteract())press(G);}
 assert(e.lastResult.success);assert.equal(g.xp,180);assert.equal(g.scene.children.length,0);assert.equal(g.crowd.victims.length,0);
 assert(!e.finish(true,'again'));assert.equal(g.xp,180);
});
test('rescue pickup, carried traversal and grounded delivery; no remote interaction',()=>{
 const G=game(),{e,h,g}=G;assert(e.start('rescue'));const a=e.active;assert(!e.canInteract());
 move(G,a.target.clone().add(new THREE.Vector3(0,TL.C.FEET,0)),20);h.grounded=true;h.vel.set(0,0,0);press(G);assert.equal(a.phase,'carry');assert(a.victim.carried);
 move(G,a.safe.clone().add(new THREE.Vector3(0,TL.C.FEET,0)),18);h.grounded=false;h.vel.set(0,0,0);assert(!e.canInteract());
 h.grounded=true;press(G);assert(e.lastResult.success);assert.equal(g.xp,180);assert.equal(g.crowd.victims.length,0);assert.equal(g.scene.children.length,0);
});
test('runaway uses a real spawned moving collider and brakes only while standing on it',()=>{
 const G=game(),{e,h,g}=G;assert(e.start('runaway'));const a=e.active,v=a.veh,start=v.pos.clone();
 for(let i=0;i<30;i++){g.traffic.drive(v,1/60,0);e.update(1/60);}assert(v.pos.distanceTo(start)>3);assert(!e.canInteract());
 h.pos.copy(v.pos);h.pos.y=v.col.top+TL.C.FEET;h.grounded=true;h.groundCol=v.col;h.vel.set(0,0,v.speed);press(G);
 for(let i=0;i<400&&e.active;i++){g.traffic.drive(v,1/60,0);h.pos.copy(v.pos);h.pos.y=v.col.top+TL.C.FEET;h.grounded=true;h.groundCol=v.col;e.update(1/60);}
 assert(e.lastResult.success);assert.equal(g.xp,180);assert.equal(g.traffic.vehicles.length,0);assert.equal(g.world.dynamics.length,0);
});
test('failure/cancel/retry dispose owned actors and do not reward',()=>{
 for(const type of ['rooftop','rescue','runaway']){
  const G=game(),{e,g}=G;assert(e.start(type));e.update(151);assert(!e.active);assert(!e.lastResult.success);assert.equal(g.xp,0);
  assert.equal(g.crowd.victims.length,0);assert.equal(g.traffic.vehicles.length,0);assert.equal(g.scene.children.length,0);assert(e.retry());e.cancel();assert(!e.active);assert.equal(g.xp,0);assert.equal(g.scene.children.length,0);
 }
});
test('main missions, activities and routes reject conflicting encounters',()=>{
 const {g,e}=game();g.routes.active={};assert(!e.start('rescue'));g.routes.active=null;g.missions.active={};assert(!e.start('rooftop'));g.missions.active=null;g.missions.crime={};assert(!e.start('runaway'));
});
test('explicit response replaces ambient incident only after a valid encounter exists',()=>{
 const G=game();let cleared=0;G.g.cityLife={incident:{},cleanupIncident(){this.incident=null;cleared++;}};
 G.g.world.addStatic(0,25.3,0,25,1,25,0,{climb:false});assert(!G.e.start('rooftop'));assert.equal(cleared,0);assert(G.g.cityLife.incident);
 assert(G.e.start('runaway'));assert.equal(cleared,1);assert(!G.g.cityLife.incident);G.e.cancel(true);
});
test('blocked roofs reject spawn; disappearing geometry fails safely',()=>{
 const G=game();G.g.world.addStatic(0,25.3,0,25,1,25,0,{climb:false});assert(!G.e.start('rooftop'));assert.equal(G.g.scene.children.length,0);
 const B=game();assert(B.e.start('rescue'));B.g.world.removeStatic(B.roof);B.e.update(.01);assert(!B.e.active);assert.equal(B.g.xp,0);assert.equal(B.g.scene.children.length,0);
});
test('save/load preserves completion counts, clears active actors, and bounds hostile data',()=>{
 const {e,g}=game();e.completed={rooftop:3,rescue:2,runaway:1};const d=JSON.parse(JSON.stringify(e.serialize()));assert(e.start('rescue'));e.deserialize(d);assert(!e.active);assert.equal(e.completed.rescue,2);assert.equal(g.scene.children.length,0);e.deserialize({completed:{rescue:Infinity,runaway:-1}});assert.equal(e.completed.runaway,0);assert(Number.isFinite(e.completed.rescue));
});
test('repeated starts/cancels keep scene objects, traffic colliders and victims bounded',()=>{
 const {e,g}=game();for(let i=0;i<30;i++){assert(e.start(['rooftop','rescue','runaway'][i%3]));e.cancel(true);assert.equal(g.scene.children.length,0);assert.equal(g.world.dynamics.length,0);assert.equal(g.crowd.victims.length,0);}assert.equal(g.xp,0);
});
console.log(passed+' encounter checks passed');
