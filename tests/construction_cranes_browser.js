/* Call after the normal game boot. Renderer screenshots are captured by worksite_browser. */
'use strict';
const assert=require('assert');
async function checkCraneMotion(page){
 const result=await page.evaluate(()=>{
  const g=TL.game,S=g.streamer.constructionCraneState;
  if(!S||!S.cranes.length)throw Error('No working Manhattan cranes');
  const before=S.cranes.map(c=>({yaw:c.yaw,phase:c.phase,hook:c.hookPos.clone()}));
  const ropes=S.cranes.map(c=>{const col=c.parts[0].col,p=col.toWorld(18,col.hy,0,new THREE.Vector3()),r=new TL.Rope();r.attachTo({x:p.x,y:p.y,z:p.z,col},g.world);return r;});
  g.state='play';g.input.endFrame();for(let i=0;i<90;i++)g.tick(1/60);
  return {count:S.cranes.length,skipped:S.skipped,cranes:S.cranes.map((c,i)=>{
   const rope=ropes[i];rope.updateAnchor(1/60);const part=c.parts[0],p=TL.ConstructionCranes.point(c,...part.local.slice(0,3));
   const candidates=[];g.world.query(rope.anchor.x-.1,rope.anchor.z-.1,rope.anchor.x+.1,rope.anchor.z+.1,candidates);
   return {site:c.siteId,yawDelta:c.yaw-before[i].yaw,elapsed:(c.phase-before[i].phase)/c.rate,hookTravel:c.hookPos.distanceTo(before[i].hook),meshYaw:c.jib.rotation.y,colliderYaw:part.col.yaw,positionError:Math.hypot(p.x-part.col.cx,p.y-part.col.cy,p.z-part.col.cz),anchorSpeed:rope.anchorVel.length(),broadphase:candidates.includes(part.col),baseY:c.baseY,topY:c.topY};
  }),errors:TL.errors.slice()};
 });
 assert.equal(result.skipped.length,0,'Authored worksite cranes must all be safely placeable');
 for(const c of result.cranes){assert(Math.abs(c.yawDelta)>.001);assert(c.elapsed>0&&c.elapsed<=1.52,'Crane must advance once per simulated frame');assert(c.hookTravel>.01);assert.equal(c.meshYaw,c.colliderYaw);assert(c.positionError<1e-7);assert(c.anchorSpeed>.01&&Number.isFinite(c.anchorSpeed));assert(c.broadphase);assert(c.topY>c.baseY+20);}
 assert.deepEqual(result.errors,[]);return result;
}
module.exports={checkCraneMotion};
