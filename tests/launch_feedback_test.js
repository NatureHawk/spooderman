'use strict';
require('./hand_swing_test.js');
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
for(const f of ['05_camera.js','07_vfx.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});
const world=new TL.CollisionWorld();world.groundFn=()=>0;
const hero={pos:new THREE.Vector3(0,50,0),vel:new THREE.Vector3(0,12,30),state:TL.TS.AIR,facing:0};
function fov(kick,reduced){const c=new THREE.PerspectiveCamera(),rig=new TL.CameraRig(c,world);rig.settings=TL.defaultSettings();rig.settings.reducedMotion=reduced;if(kick)rig.kickLaunch(true);for(let i=0;i<10;i++)rig.update(1/60,hero);assert(Number.isFinite(c.fov));return c.fov;}
assert(fov(true,false)>fov(false,false)+2,'release gives a short FOV kick');
assert.equal(fov(true,true),fov(false,true),'reduced motion suppresses launch FOV kick');
const scene=new THREE.Scene(),fx=new TL.LaunchFX(scene),particles=new TL.ParticleSystem(scene,200);
const origin=new THREE.Vector3(0,49,0),v=new THREE.Vector3(0,12,30);
particles.launchBurst(origin,v,1.2);assert(particles.life.some(x=>x>0));
const actor={ctrl:hero,anim:{handWorld:{L:new THREE.Vector3(.3,51,2),R:new THREE.Vector3(-.3,51,2)}}};
fx.fire(origin,v,false);fx.update(.1,actor);assert(fx.mesh.visible);assert(Array.from(fx.positions).every(Number.isFinite));
fx.update(.5,actor);assert(!fx.mesh.visible,'loose web strands expire');
for(let i=0;i<120;i++)particles.update(1/60);assert(particles.life.every(x=>x<=0),'pressure puff expires');
console.log('PASS launch camera kick, reduced-motion setting, finite/expiring filaments and pressure puff');
