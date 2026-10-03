'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
global.THREE=require(path.join(harness,'node_modules/three/build/three.cjs'));
for(const f of ['00_core.js','02_collision.js','04_physics.js','05_camera.js','14_audio.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});
const w=new TL.CollisionWorld();w.groundFn=()=>0;
const wall=w.addStatic(2,30,0,1,30,100,0,{kind:'building',surface:'glass'});
const h={pos:new THREE.Vector3(0,30,0),vel:new THREE.Vector3(0,0,35),state:TL.TS.SWING,tether:{main:{attached:true,tension:90,L:30}},wallCol:wall,swingWall:false};
const sounds=[],kicks=[];
const game={hero:{ctrl:h},world:w,settings:TL.defaultSettings(),state:'play',rig:{right:new THREE.Vector3(1,0,0),shake(){},kickNear:(p,k)=>kicks.push([p,k])},audio:{sfx:(...a)=>sounds.push(a)},cityLife:{emit(){}}};
const feedback=new TL.MotionFeedback(game),p=h.pos.clone(),v=h.vel.clone();
for(let i=0;i<120;i++)feedback.update(1/60);
assert(h.pos.equals(p)&&h.vel.equals(v),'presentation cannot alter physics');
assert.equal(sounds.filter(s=>s[0]==='nearmiss').length,1,'same surface must not spam whooshes');
assert.equal(kicks.length,1);assert(kicks[0][0]>.9);assert(feedback.nearNormal.x>.9);assert(Math.abs(feedback.clearance-1)<.01);assert(Math.abs(feedback.accel)<.001);
h.pos.set(1000,30,0);feedback.update(1/60);assert.equal(feedback.near,0);assert.equal(feedback.accel,0);
game.hero.ctrl={...h,pos:new THREE.Vector3(0,30,0),vel:new THREE.Vector3(0,0,0)};feedback.update(1/60);assert.equal(feedback.energy,0);assert.equal(feedback.accel,0);
console.log('PASS directional proximity, cooldown, teleport/hero-switch reset; feedback leaves physics unchanged');
assert.equal(TL.TraversalSound.surface(game,h,'wall'),'glass');wall.surface='brick';assert.equal(TL.TraversalSound.surface(game,h,'wall'),'brick');wall.surface='metal';assert.equal(TL.TraversalSound.surface(game,h,'wall'),'metal');
delete wall.surface;wall.bid=42;TL.Buildings={surfaceByBuilding:new Map([[42,'glass']])};assert.equal(TL.TraversalSound.surface(game,h,'wall'),'glass');assert.equal(TL.TraversalSound.surface(game,h,'ground'),'concrete');
for(const paused of [true,false])for(const speed of [0,5,25,80,140])for(const tension of [0,60,400]){
  h.vel.z=speed;h.tether.main.tension=tension;
  const m=TL.TraversalSound.mix(h,{energy:Math.min(1,speed/55),near:1,nearPan:-1,accel:1,loadRate:3},paused,.7);
  for(const n of ['wind','air','strain','scrape'])assert(m[n]>=0&&m[n]<.3&&(!paused||m[n]===0),n+' bounded and silent when paused');
  assert.equal(m.pan,-1);
}
h.tether.main.attached=false;assert.equal(TL.TraversalSound.mix(h,{loadRate:2},false,.7).strain,0);
assert.equal(TL.TraversalSound.mix(h,{energy:1,near:1},false,0).air,0);
const a=new TL.AudioManager(game),values={};a.ok=true;a.ctx={currentTime:0};game.settings.vol.sfx=0;game.settings.vol.ambience=0;
a.ch={sfx:{gain:{setTargetAtTime(v){values.sfx=v;}}},ambience:{gain:{setTargetAtTime(v){values.ambience=v;}}}};
a.duck(true);assert.equal(values.sfx,0);assert.equal(values.ambience,0);a.duck(false);assert.equal(values.sfx,0);
console.log('PASS material contact selection, bounded wind/rope mix, muted channels remain muted in menus');
function camera(reduced,kick){const c=new THREE.PerspectiveCamera(),rig=new TL.CameraRig(c,w);rig.settings=TL.defaultSettings();rig.settings.reducedMotion=reduced;const actor={pos:new THREE.Vector3(-20,40,0),vel:new THREE.Vector3(0,0,35),state:TL.TS.SWING,facing:0};if(kick)rig.kickNear(1,1);rig.update(1/60,actor);assert(c.position.toArray().every(Number.isFinite));return {position:c.position.clone(),roll:rig.roll};}
const base=camera(true,false),quiet=camera(true,true),normal=camera(false,true);assert(base.position.equals(quiet.position)&&base.roll===quiet.roll);assert(Math.abs(normal.roll)<.04);
console.log('PASS near-wall camera response bounded; reduced motion suppresses added displacement and bank');
