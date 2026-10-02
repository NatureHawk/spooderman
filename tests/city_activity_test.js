'use strict';
require('./hand_swing_test.js');
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
for(const file of ['05_camera.js','07_vfx.js','10_crowd.js','10b_citylife.js','11_traffic.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'));
function game(){const world=new TL.CollisionWorld(),h=new TL.HeroController(world,TL.HERO_STATS.WEAVER);return {world,hero:{ctrl:h},rig:{right:new THREE.Vector3(1,0,0)},audio:{sfx(){}},crowd:{peds:[],rng:new TL.RNG(12)},scene:new THREE.Scene()};}
{
 const g=game(),life=g.cityLife=new TL.CityLife(g),p=new TL.Ped();p.pos.set(0,0,0);g.crowd.peds.push(p);
 const wall=g.world.addStatic(0,3,3,8,3,.2,0);assert(!life.visible(new THREE.Vector3(0,1.5,0),new THREE.Vector3(0,2,6)));
 for(let i=0;i<30;i++){life.t+=3;life.emit('land',new THREE.Vector3(0,2,6),1);life.dispatch();assert(!p.notice);}
 g.world.removeStatic(wall);life.cool.clear();
 for(let i=0;i<30&&!p.notice;i++){life.t+=3;life.emit('land',new THREE.Vector3(0,2,6),1);life.dispatch();}
 assert(p.notice);for(let i=0;i<90;i++)life.react(p,1/60);assert(!p.notice);assert(p.lookAt);assert(Math.abs(p.yaw)<.1);
 p.modeT=0;life.react(p,.1);assert(!p.lookAt);p.fear=1;p.notice={delay:0};life.react(p,.1);assert(!p.notice);
 life.cool.clear();for(let i=0;i<30;i++)life.emit('pass',new THREE.Vector3(),1);assert.equal(life.events.length,1);
 console.log('PASS visibility, event deduplication, delayed turns, reaction release and safety interruption');
}
const results=[];
for(const fps of [30,60,120]){
 const g=game(),h=g.hero.ctrl;g.cityLife={emit(){}};let whooshes=0;g.audio.sfx=()=>whooshes++;
 const wall=g.world.addStatic(0,10,0,.3,10,100,0);h.pos.set(2,10,0);h.vel.set(0,0,35);h.fsm.set(TL.TS.AIR);
 const m=new TL.MotionFeedback(g);
 for(let i=0;i<fps*3;i++)m.update(1/fps);assert.equal(whooshes,1,'one wall pass');assert(m.energy>0&&m.energy<=1);
 results.push(m.energy);h.vel.set(0,0,0);h.fsm.set(TL.TS.PERCH);for(let i=0;i<fps*3;i++)m.update(1/fps);assert(m.energy<.001);
 assert.equal(wall.id,m.surface);assert.equal(h.vel.length(),0);
}
assert(Math.max(...results)-Math.min(...results)<.002);console.log('PASS motion at 30/60/120 fps, wall-pass hysteresis, stationary wind decay, no momentum changes');
for(const fps of [30,60,120]){
 const g=game();g.hero.ctrl.pos.set(200,50,0);g.ai={enemies:[]};g.audio={sfx(){}};
 const t=Object.create(TL.TrafficManager.prototype);t.game=g;t.vehicles=[];t.laneOff=[2.1,5.6];t.t=0;
 const seg=t.makeSeg(0,0,0,250);seg.sig=false;
 for(const s of [15,45]){const v=new TL.Vehicle();v.active=true;v.type='car';v.seg=seg;v.s=s;v.speed=12;v.target=12;v.lane=0;t.segPos(seg,s,0,v.pos);v.col=g.world.addDynamic(v.pos.x,.75,v.pos.z,.975,.75,2.425,0);t.vehicles.push(v);}
 t.vehicles[1].incident=true;
 for(let i=0;i<fps*10;i++){for(const v of [...t.vehicles].reverse())t.drive(v,1/fps,0);assert(t.vehicles[1].s-t.vehicles[0].s>=4.85+1.49);}
 assert(t.vehicles[0].speed<.1);const old=t.vehicles[0].s;t.vehicles[1].incident=false;
 for(let i=0;i<fps*5;i++)for(const v of [...t.vehicles].reverse())t.drive(v,1/fps,0);
 assert(t.vehicles[0].s>old+15);assert.equal(t.vehicles[0].lane,0);
}
console.log('PASS traffic braking, queue spacing and recovery at 30/60/120 fps');
for(const name of ['WEAVER','PULSE'])for(const [hx,hz,type]of [[2,.16,'rail'],[.65,.65,'cap'],[3,2,'platform'],[2,.6,'ledge'],[.42,.42,'rounded']]){
 const g=game(),h=g.hero.ctrl,c=g.world.addStatic(0,5,0,hx,.5,hz,.4,{perch:true});
 if(type==='rounded'){c.supportType='rounded';c.supportRadius=.42;}
 assert(TL.PerchSupport.enter(h,c,new THREE.Vector3(.1,5.5,0),.8));h.fsm.set(TL.TS.PERCH);
 assert.equal(h.perchSupport.type,type);
 for(const x of [-.34,.34])for(const z of [-.035,.12]){const p=TL.PerchSupport.contact(h.perchSupport,x,.055,z),q=c.toLocal(p.x,p.y,p.z,new THREE.Vector3());assert(Math.abs(q.x)<hx&&Math.abs(q.z)<hz);}
 const sk=TL.Assets.skinned(name,'mid',TL.Assets.material()),scene=new THREE.Scene();scene.add(sk.mesh);const anim=new TL.HeroAnimator(sk,name,scene,TL.Assets.material(),'high');
 if(anim.arms)anim.arms.setRetracted(true,true);
 for(let i=0;i<120;i++)anim.update(1/60,h,h.pos,{fwd:new THREE.Vector3(0,0,1)});
 assert(sk.list.every(b=>b.quaternion.toArray().every(Number.isFinite)));if(anim.arms)assert(anim.arms.retracted);
 for(const side of ['L','R']){const p=anim.handWorld[side],q=c.toLocal(p.x,p.y,p.z,new THREE.Vector3());assert(Math.abs(q.x)<hx+.08&&Math.abs(q.z)<hz+.08,'actual wrist on '+type);}
 for(const side of ['L','R']){const p=anim.rig.bones['foot'+side].getWorldPosition(new THREE.Vector3()),q=c.toLocal(p.x,p.y,p.z,new THREE.Vector3());assert(Math.abs(q.x)<hx+.06&&Math.abs(q.z)<hz+.06,'actual ankle on '+type);if(type==='rounded')assert(Math.hypot(q.x,q.z)<.42);}
 h.jumpBuffer=.1;h.transitions(1/120,{camFwd:new THREE.Vector3(0,0,1),move:new THREE.Vector3()});assert.equal(h.state,TL.TS.AIR);
}
console.log('PASS both rigs: bounded perch contacts, finite poses, immediate jump, retracted arms preserved');
{
 const g=game(),L=g.cityLife=new TL.CityLife(g);g.scene=new THREE.Scene();g.streamer={roofState:{analyses:[]}};g.missions={active:null,crime:null};g.ai={inCombat:false};
 for(const reason of ['success','abandoned','unavailable']){
  const v={active:true,incident:true,col:{id:17}},web=new TL.RopeRenderer(g.scene,0xffffff,8,4),prop=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());g.scene.add(prop);
  L.incident={kind:'street',vehicle:v,vehicleId:17,web,prop};L.cleanupIncident(reason);
  assert(!v.incident);assert(!L.incident);assert(!g.scene.children.includes(prop));assert(!g.scene.children.includes(web.mesh));assert(L.incidentT>=35);
 }
 const v={incident:true,col:{id:19}};L.incident={kind:'street',vehicle:v,vehicleId:17};L.cleanupIncident();assert(v.incident,'do not modify a recycled actor owned by a different incident');
 L.incident={kind:'street',state:'available',t:0,pos:new THREE.Vector3(400,0,0),vehicle:{active:true,col:{id:2},incident:true},vehicleId:2};
 L.updateIncident(.1);assert(!L.incident);assert.equal(L.lastIncident.state,'abandoned');
 console.log('PASS rescue cleanup, cooldown, leaving, prop disposal and recycled actor ownership');
}
