'use strict';
const {traverse,check,intent}=require('./construction_traversal_test.js');
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');for(const f of ['01_assets.js','03n_construction.js','03o_construction_cranes.js'])vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),{filename:f});
TL.Assets.man=JSON.parse(fs.readFileSync(path.join(__dirname,'../build/assets.json')));const assetBuffer=fs.readFileSync(path.join(__dirname,'../build/assets.bin'));TL.Assets.bin=assetBuffer.buffer.slice(assetBuffer.byteOffset,assetBuffer.byteOffset+assetBuffer.byteLength);
function build(yaw=0){const world={world:new TL.CollisionWorld(),scene:new THREE.Scene()};world.world.groundFn=()=>-100;const site=TL.Construction.buildSite(world,{x:43,z:-61,baseY:100,yaw,stories:3},0);return{world,site};}
for(const yaw of [0,.63]){const {world,site}=build(yaw);for(const gate of site.gates)for(const hero of ['PULSE','WEAVER'])for(const sign of [-1,1])for(const speed of [10,32,65,110])for(const dt of [1/30,1/120])check('AUTHORED '+gate.type+' '+hero+' yaw='+yaw+' direction='+sign+' speed='+speed+' @'+1/dt,()=>{traverse(world.world,gate,hero,speed,sign,dt);});
 for(const hero of ['PULSE','WEAVER'])check('AUTHORED crane real swing and pointzip '+hero+' yaw='+yaw,()=>{
  world.quality='low';const crane=site.movingCrane||TL.ConstructionCranes.spawn(world,site,0);assert(crane,'real authored dynamic crane created');const h=new TL.HeroController(world.world,TL.HERO_STATS[hero]),target=TL.ConstructionCranes.point(crane,25,5.3,0),axis=new THREE.Vector3(Math.sin(crane.yaw),0,Math.cos(crane.yaw));
  for(const sign of [-1,1]){
   const origin=target.clone().addScaledVector(axis,sign*12).add(new THREE.Vector3(0,-12,0));h.teleport(...origin.toArray());h.vel.copy(axis).multiplyScalar(-sign*12);const direction=target.clone().sub(h.pos).normalize(),it=intent(direction);
   const swing=h.tether.findSwingAnchor(h,it,h.stats,75);assert(swing&&swing.col.siteId===site.id,'crane selectable by ordinary swing search');assert(TL.ReferenceTraversal.anchorOnGeometry(swing),'swing attaches to actual member');
   const zip=h.tether.findLaunchPoint(h,h.pos,direction,60);assert(zip&&zip.col.siteId===site.id,'crane selectable by ordinary pointzip');assert(zip.col.climb&&zip.col.solid);assert(zip.point.distanceTo(h.pos)<60);
  }
 });TL.Construction.dispose(world);
}
console.log('PASS exact construction kit:128 full pipe/tower traversals plus real crane swing/pointzip both directions');
module.exports={build};
