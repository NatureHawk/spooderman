'use strict';
// Shared by the complete-scan CPU fixture and final built-HTML browser QA.
function checkCityPassages(world,sites,expected=20){
 const fail=(ok,msg)=>{if(!ok)throw Error(msg);};
 fail(sites.length===expected,'Expected '+expected+' actual sites, found '+sites.length);
 fail(new Set(sites.map(s=>s.id)).size===expected,'Each worksite has a unique identity');
 fail(new Set(sites.map(s=>s.variant)).size===expected,'Each worksite uses its own authored variant');
 const rows=[],unfinished=new Set(sites.map(s=>s.roofBid));
 for(const site of sites){
  fail(site.gates.filter(g=>g.type==='pipe').length===1,site.id+' needs its real pipe opening');
  for(const gate of site.gates.filter(g=>g.type==='water_tower')){
   const roof=gate.roofBid??gate.anchors[0]?.col?.bid;
   fail(!unfinished.has(roof),site.id+' tank must stand on a separate finished roof');
   fail(roof===site.finishedTowerRoof,site.id+' course records the finished tank roof');
  }
  for(const gate of site.gates)for(const name of ['PULSE','WEAVER'])for(const speed of [15,35,60])for(const sign of [-1,1]){
   const label=[site.id,gate.type,name,speed,sign].join(' '),axis=gate.axis.clone().multiplyScalar(sign),right=new THREE.Vector3(axis.z,0,-axis.x),h=new TL.HeroController(world,TL.HERO_STATS[name]);
   h.teleport(...gate.center.clone().addScaledVector(axis,-gate.length*.5-10).addScaledVector(right,.65).toArray());h.fsm.set(TL.TS.SWING);h.grounded=false;
   h.vel.copy(axis).multiplyScalar(.78).addScaledVector(right,-.28);h.vel.y=.48;h.vel.normalize().multiplyScalar(speed);
   const it={move:axis.clone(),moveLocal:{x:0,y:1},camFwd:gate.center.clone().sub(h.pos).normalize(),camRight:right,swing:true,tether:true};
   const selected=TL.ReferenceTraversal.passage(h,it);fail(selected&&selected.gate===gate,label+' actual opening selectable from off-axis approach');
   fail(selected.anchors.every(a=>TL.ReferenceTraversal.anchorOnGeometry(a)),label+' both webs attach to actual solid faces');
   const start=h.pos.clone(),incoming=h.vel.clone();TL.ReferenceTraversal.tick(h,0,it);fail(h.reference.action?.kind==='pass_through',label+' begins passage');fail(h.pos.equals(start)&&h.vel.equals(incoming),label+' activation cannot teleport or discard velocity');
   const pathLength=h.reference.action.path.total,dt=1/60,trace=[];let distance=0,elapsed=0,exited=false,minSpeed=Infinity,maxSpeed=0;
   for(let frame=0;frame<240;frame++){
    const before=h.pos.clone();h.step(dt,it);elapsed+=dt;const displacement=h.pos.distanceTo(before),actual=h.vel.length(),along=h.pos.clone().sub(gate.center).dot(axis);distance+=displacement;minSpeed=Math.min(minSpeed,actual);maxSpeed=Math.max(maxSpeed,actual);
    fail(displacement<=speed*dt*1.015,label+' normal bounded displacement');fail(actual>=speed*.988,label+' full incoming speed retained, got '+actual);fail(actual<=speed*1.012,label+' no hidden boost');
    const candidates=[];world.query(h.pos.x-2,h.pos.z-2,h.pos.x+2,h.pos.z+2,candidates);fail(!TL.Contact.overlap(world,candidates,h.pos.x,h.pos.y,h.pos.z,h.shape,.005),label+' actual city collider clearance at '+along);
    trace.push({time:elapsed,speed:actual,along,pos:h.pos.toArray()});
    if(h.reference.action?.kind!=='pass_through'){fail(along>gate.length*.5+1,label+' releases beyond physical opening (along '+along.toFixed(3)+', elapsed '+elapsed.toFixed(3)+', state '+h.state+')');exited=true;break;}
   }
   fail(exited,label+' completes');fail(elapsed<=pathLength/speed+dt*2.1,label+' arrival time uses full entry speed');fail(distance>pathLength-.6,label+' covers real curve distance');fail(h.tether.ropes.every(r=>!r.active),label+' exit webs released');
   rows.push({site:site.id,variant:site.variant,type:gate.type,name,speed,sign,pathLength,distance,elapsed,minSpeed,maxSpeed,trace});
  }
 }
 return{sites:sites.length,gates:sites.reduce((n,s)=>n+s.gates.length,0),cases:rows.length,rows};
}
async function checkBuiltCityPassages(page,expected=20){return page.evaluate(({source,expected})=>{const run=new Function('return ('+source+')')();return run(TL.game.world,TL.game.streamer.constructionState.sites,expected);},{source:checkCityPassages.toString(),expected});}
module.exports={checkCityPassages,checkBuiltCityPassages};
