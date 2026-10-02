'use strict';
require('./hand_swing_test.js');
const assert=require('assert');
for(const name of ['WEAVER','PULSE'])for(const boost of [false,true])for(const hz of [30,120]) {
  const world=new TL.CollisionWorld();world.groundFn=()=>0;
  const h=new TL.HeroController(world,TL.HERO_STATS[name]);h.teleport(0,60,0);h.grounded=false;
  const scene=new THREE.Scene(),mat=TL.Assets.material(),sk=TL.Assets.skinned(name,'mid',mat);
  scene.add(sk.mesh);const anim=new TL.HeroAnimator(sk,name,scene,mat,'high');
  const it={move:new THREE.Vector3(),moveLocal:{x:0,y:0},camFwd:new THREE.Vector3(0,0,1),camRight:new THREE.Vector3(-1,0,0),jumpHeld:boost};
  const ledge=world.addStatic(0,71,42,3,1,2,0,{kind:'building'});
  h.startPointLaunch({point:new THREE.Vector3(0,72,40),col:ledge});
  assert(h.tether.ropes.every(r=>r.active&&!r.attached),'webs travel before pulling');
  let elapsed=0,extended=0,folded=0,arrival=false,plantFrames=0,catchBend=0,pushBend=3;
  while(h.state===TL.TS.LAUNCH&&elapsed<3.1) {
    h.step(1/hz,it);anim.update(1/hz,h,h.pos,{fwd:it.camFwd});elapsed+=1/hz;
    assert(TL.finite3(h.pos)&&TL.finite3(h.vel));
    const elbow=anim.rig.cur.uarmL.angleTo(anim.rig.cur.farmL);
    if(elapsed<.18)extended=Math.max(extended,Math.cos(elbow));
    if(elapsed>.35&&h.launch&&!h.launch.arrived)folded=Math.max(folded,elbow);
    if(h.launch&&TL.ZipMotion.sample(h).arrive>.6)arrival=true;
    if(h.launch&&h.launch.arrived) {
      plantFrames++;
      for(const [side,sign] of [['L',1],['R',-1]]) {
        const palm=h.launch.point.clone().add(new THREE.Vector3(sign*.3,.035,0));
        assert(anim.handWorld[side].distanceTo(palm)<.025,name+' '+side+' palm stays on the ledge');
      }
      if(h.launch.plantT<.08)catchBend=Math.max(catchBend,elbow);
      if(h.launch.plantT>.20)pushBend=Math.min(pushBend,elbow);
      if(boost&&h.launch.plantT>.05&&h.launch.plantT<.12) {
        assert(anim.rig.cur.chest.z>.55,'chest curls during the loaded catch');
        assert(anim.rig.cur.thighL.angleTo(anim.rig.cur.shinL)>2,'knees fold tightly during absorption');
      }
      if(boost&&h.launch.plantT>.1) {
        const head=anim.rig.bones.head.getWorldPosition(new THREE.Vector3());
        assert(head.y>h.launch.point.y+.1,'head stays clear of the ledge');
        for(const side of ['L','R']) {
          const foot=anim.rig.bones['foot'+side].getWorldPosition(new THREE.Vector3());
          assert(foot.y>head.y+.25,name+' folded feet remain above the head at palm contact');
        }
      }
    }
  }
  assert(elapsed<2.8,'arrives by travelling, not timeout');
  assert(extended>.7,'shoot reaches forward');assert(folded>1.0,'web pull bends elbows before the ledge catch');assert(arrival,'arrival compresses');
  assert.equal(h.state,boost?TL.TS.AIR:TL.TS.PERCH);
  assert(h.tether.ropes.every(r=>!r.active),'arrival releases both lines');
  assert(plantFrames>=6&&catchBend>(boost?1.1:1.5)&&pushBend<.9,'arms absorb the catch, then extend against the ledge');
  if(!boost){
    // A completed zip must settle onto the ledge, not remain in a seated pose.
    for(const time of [1.5,5.8,9.5]){
      for(let i=0;i<hz;i++){h.step(1/hz,it);h.fsm.t=time;anim.update(1/hz,h,h.pos,{fwd:it.camFwd});}
      const plane=h.perchPoint.clone();plane.y-=TL.C.FEET;
      for(const [side,sign] of [['L',1],['R',-1]]){
        const foot=anim.rig.bones['foot'+side].getWorldPosition(new THREE.Vector3());
        const target=new THREE.Vector3(sign*.34,.095,-.035).applyQuaternion(anim.rootQ).add(plane);
        assert(foot.distanceTo(target)<.025,name+' perch foot remains planted');
        assert(anim.rig.cur.thighL.angleTo(anim.rig.cur.shinL)>1.7,'perch keeps a deep knee fold');
        if(side==='L'||time!==5.8){
          const wrist=new THREE.Vector3(sign*.16,.055,.12).applyQuaternion(anim.rootQ).add(plane);
          assert(anim.handWorld[side].distanceTo(wrist)<.08,name+' '+time+' '+side+' supporting hand stays at ledge: '+anim.handWorld[side].distanceTo(wrist));
        }else assert(anim.handWorld.R.y>plane.y+.3,'idle shifts to one-hand support');
      }
    }
    h.step(1/hz,{...it,jump:true});
    assert.notEqual(h.state,TL.TS.PERCH,'jump exits perch');
    assert(h.vel.y>0,'perch jump lifts off');
  }
  if(boost){
    assert.equal(anim.rel.kind,'point_launch','timed jump uses dedicated departure');
    const up=new THREE.Vector3(0,1,0).applyQuaternion(anim.rootQ);
    assert(up.y<-.85,'push-off starts inverted');
    let angle=0,previous=anim.rootQ.clone();
    for(let i=0;i<Math.ceil(.88*hz);i++){
      h.step(1/hz,it);anim.update(1/hz,h,h.pos,{fwd:it.camFwd});
      angle+=previous.angleTo(anim.rootQ);previous.copy(anim.rootQ);
    }
    assert(angle>2.8,'handspring continues rotating through the release');
    assert(new THREE.Vector3(0,1,0).applyQuaternion(anim.rootQ).y>.6,'recovers upright for next swing');
  }
  anim.dispose(scene);
}
console.log('PASS zip shoot/pull/arrival, perch and timed launch on both rigs at 30/120 Hz');
function launchSpeed(mode) {
  const w=new TL.CollisionWorld();w.groundFn=()=>0;
  const h=new TL.HeroController(w,TL.HERO_STATS.WEAVER);h.teleport(0,60,0);
  const col=w.addStatic(0,71,42,3,1,2,0,{kind:'building'});
  h.startPointLaunch({point:new THREE.Vector3(0,72,40),col});
  const events=[];h.onEvent=(e,a)=>events.push([e,a]);let pressed=false;
  for(let i=0;i<300&&h.state===TL.TS.LAUNCH;i++) {
    const jump=mode==='perfect'&&!pressed&&h.launch.window;
    pressed=pressed||jump;
    h.step(1/120,{move:new THREE.Vector3(),camFwd:new THREE.Vector3(0,0,1),jump,jumpHeld:mode==='held'});
  }
  const boost=events.filter(e=>e[0]==='launchboost');
  assert.equal(boost.length,1);assert.equal(boost[0][1].perfect,mode==='perfect');
  for(const name of ['zipgrip','zippull','pointcatch'])assert.equal(events.filter(e=>e[0]===name).length,1);
  return h.vel.length();
}
assert(launchSpeed('perfect')>launchSpeed('held')*1.15,'a timed press earns a real momentum bonus');
console.log('PASS precise timing bonus and once-only catch/pull/release events');
