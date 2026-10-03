/* Local reference: video/traversal_reference/index.json (5Nob1JXTww0).
   Additional traversal commands use the ordinary collision integrator. Never
   teleport the body, bypass a collider, or alter a graphics/filter setting. */
'use strict';
TL.WindField.prototype.addTunnel=function(start,end,radius=7){
  const delta=end.clone().sub(start),field={start:start.clone(),end:end.clone(),axis:delta.clone().normalize(),length:delta.length(),radius};
  (this.tunnels||(this.tunnels=[])).push(field);return field;
};
TL.WindField.prototype.tunnelAt=function(p){
  for(const field of this.tunnels||[]){
    const d=p.clone().sub(field.start),u=d.dot(field.axis);if(u<0||u>field.length)continue;
    const radius=d.addScaledVector(field.axis,-u).length();if(radius>=field.radius)continue;
    return{field,weight:(1-radius/field.radius)*TL.smooth(0,8,u)*TL.smooth(0,8,field.length-u)};
  }return null;
};
TL.ReferenceTraversal={
  state(h){return h.reference||(h.reference={action:null,clock:0,jumpReady:0,dashReady:0,zipReady:0,dodgeReady:0,loop:null});},
  begin(h,kind,duration,dir=1){const r=this.state(h);r.action={kind,t:0,duration,dir,fired:false};return r.action;},
  gateCandidates(world,p){
    const gates=world.referenceGates||[];let index=world._referenceGateIndex;
    // Gates are static level geometry. Index once; key by array/count so rebuilds
    // invalidate without adding an unbounded scan to a gameplay frame.
    if(!index||index.gates!==gates||index.count!==gates.length){
      index=world._referenceGateIndex={gates,count:gates.length,cells:new Map()};
      for(const g of gates){const k=Math.floor(g.center.x/32)+","+Math.floor(g.center.z/32);let cell=index.cells.get(k);if(!cell)index.cells.set(k,cell=[]);cell.push(g);}
    }
    const out=[],cx=Math.floor(p.x/32),cz=Math.floor(p.z/32);
    scan: for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const g of index.cells.get(x+","+z)||[]){out.push(g);if(out.length>=64)break scan;}
    return out;
  },
  anchorOnGeometry(hit){
    const c=hit?.col;if(!c||!c.solid||c.anchor===false)return false;
    const p=c.toLocal(hit.x,hit.y,hit.z,new THREE.Vector3()),d=[Math.abs(p.x)-c.hx,Math.abs(p.y)-c.hy,Math.abs(p.z)-c.hz];
    return d.every(v=>v<=.035)&&d.some(v=>Math.abs(v)<.035);
  },
  approachPath(h,entry,exit,axis){
    const start=h.pos.clone(),delta=entry.clone().sub(start),distance=delta.length();
    const incoming=h.vel.lengthSq()>1?h.vel.clone().normalize():delta.clone().normalize();
    if(distance>.1&&incoming.dot(delta.clone().normalize())<.15)return null;
    const c1=start.clone().addScaledVector(incoming,Math.min(distance*.32,6));
    const c2=entry.clone().addScaledVector(axis,-Math.min(distance*.28,5));
    const points=[start],lengths=[0],curve=new THREE.CubicBezierCurve3(start,c1,c2,entry);
    const n=TL.clamp(Math.ceil(distance/.12),8,256);
    for(let i=1;i<=n;i++)points.push(curve.getPoint(i/n));
    const endN=Math.ceil(entry.distanceTo(exit)/.2);for(let i=1;i<=endN;i++)points.push(entry.clone().lerp(exit,i/endN));
    const cands=[],xs=points.map(p=>p.x),zs=points.map(p=>p.z);
    h.world.query(Math.min(...xs)-1,Math.min(...zs)-1,Math.max(...xs)+1,Math.max(...zs)+1,cands);
    for(let i=0;i<points.length;i++){const p=points[i];if(TL.Contact.overlap(h.world,cands,p.x,p.y,p.z,TL.BodyShapes.tuck,.04))return null;if(i)lengths.push(lengths[i-1]+p.distanceTo(points[i-1]));}
    return{points,lengths,total:lengths[lengths.length-1]};
  },
  advancePassage(h,dt){
    const R=this.state(h),a=R.action;if(a?.kind!=='pass_through'||!a.path)return false;
    // A collision is allowed to remove energy. Never restore the entry speed
    // after contact or push through a newly blocked route.
    if(a.travel>0&&h.vel.length()<a.speed-.01){R.action=null;h.tether.releaseAll();return false;}
    const path=a.path,d=Math.min(path.total,(a.travel||0)+a.speed*dt);let i=a.pathIndex||1;
    while(i<path.lengths.length-1&&path.lengths[i]<d)i++;
    const u=(d-path.lengths[i-1])/Math.max(.0001,path.lengths[i]-path.lengths[i-1]);
    const target=path.points[i-1].clone().lerp(path.points[i],TL.clamp(u,0,1));
    const direction=d>=path.total?a.axis.clone():target.sub(h.pos);if(direction.lengthSq()<1e-8)direction.copy(a.axis);
    h.vel.copy(direction.normalize()).multiplyScalar(a.speed);a.travel=d;a.pathIndex=i;
    // Only steer velocity; normal substep integration and solid collisions own position.
    h.facing=Math.atan2(h.vel.x,h.vel.z);return true;
  },
  remainingPassageClear(h,a){
    if(!a.path)return false;
    const points=a.path.points,start=Math.max(1,a.pathIndex||1),cands=[];
    let minX=h.pos.x,maxX=h.pos.x,minZ=h.pos.z,maxZ=h.pos.z;
    for(let i=start;i<points.length;i++){const p=points[i];minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
    h.world.query(minX-1,minZ-1,maxX+1,maxZ+1,cands);
    if(TL.Contact.overlap(h.world,cands,h.pos.x,h.pos.y,h.pos.z,TL.BodyShapes.tuck,.03))return false;
    // Revalidate the authored curved approach, not its chord: a clear bend may
    // legitimately pass around a column that blocks a straight line to the rim.
    // Cached samples are <=.2m apart; new dynamic blockers still abort immediately.
    for(let i=start;i<points.length;i++){const p=points[i];if(TL.Contact.overlap(h.world,cands,p.x,p.y,p.z,TL.BodyShapes.tuck,.03))return false;}
    return true;
  },
  passage(h,it){
    if(!TL.Contact||!h.world.referenceGates)return null;
    let best=null,score=Infinity;
    for(const g of this.gateCandidates(h.world,h.pos)){
      const delta=g.center.clone().sub(h.pos),d=delta.length();
      if(d<2||d>32||delta.normalize().dot(it.camFwd)<.94)continue;
      const sign=g.axis.dot(delta)>0?1:-1,axis=g.axis.clone().multiplyScalar(sign);
      const speed=Math.max(8,h.vel.length()),exitClearance=Math.max(2,Math.min(10,speed*.12));
      const entry=g.center.clone().addScaledVector(axis,-g.length*.5-1),exit=g.center.clone().addScaledVector(axis,g.length*.5+exitClearance);
      if(h.pos.clone().sub(entry).dot(axis)>1||axis.dot(delta)<.7)continue;
      if(!this.clearPath(h,entry,exit))continue;
      const path=this.approachPath(h,entry,exit,axis);if(!path)continue;
      const anchors=g.anchorsBySide?.[sign>0?"positive":"negative"]||g.anchors;
      if(!anchors||anchors.length!==2||anchors.some(p=>!this.anchorOnGeometry(p)))continue;
      if(d<score){score=d;best={gate:g,entry,exit,axis,anchors,speed,path};}
    }
    return best;
  },
  clearPath(h,from,to){
    const c=[],pad=1;h.world.query(Math.min(from.x,to.x)-pad,Math.min(from.z,to.z)-pad,Math.max(from.x,to.x)+pad,Math.max(from.z,to.z)+pad,c);
    const n=Math.ceil(from.distanceTo(to)/.25),p=new THREE.Vector3();
    for(let i=0;i<=n;i++){p.lerpVectors(from,to,n?i/n:0);if(TL.Contact.overlap(h.world,c,p.x,p.y,p.z,TL.BodyShapes.tuck,.03))return false;}
    return true;
  },
  tick(h,dt,it){
    const R=this.state(h),S=TL.TS;R.clock+=dt;
    if(it.jump&&h.state===S.RECOVER&&h.fsm.t>.05&&h.fsm.t<.38&&h.grounded&&h.landing?.kind==='roll'){
      h.jumpBuffer=0;h.recoverT=0;h.vel.y=h.stats.jump;h.grounded=false;h.fsm.set(S.AIR,'quick-recovery');h.emit('jump');
    }
    const a=R.action;
    if(a){
      a.t+=dt;
      const allowed=a.kind==='wing_dodge'?h.state===S.GLIDE:[S.AIR,S.DIVE,S.SWING].includes(h.state);
      if(!allowed||a.t>a.duration||it.swingPressed){
        if(a.kind==='air_zip'||a.kind==='pass_through')for(const rope of h.tether.ropes)if(rope.kind==='airzip')rope.release();
        R.action=null;
      }else if(!a.fired&&a.t>=.16){
        a.fired=true;
        if(a.kind==='spider_jump'){h.vel.y=Math.max(h.vel.y,0)+19;h.emit('referenceboost','jump');}
        if(a.kind==='spider_dash'||a.kind==='air_zip'){
          const gain=a.kind==='air_zip'?12:23,forward=h.vel.dot(a.heading);
          h.vel.addScaledVector(a.heading,Math.max(0,Math.min(gain,62-forward)));
          h.vel.y=Math.max(h.vel.y,a.kind==='air_zip'?-2:0);h.emit('zippull');
          if(a.kind==='spider_dash')h.emit('referenceboost','dash');
        }
      }
      if(a.kind==='air_zip'&&a.t>.38)for(const rope of h.tether.ropes)if(rope.kind==='airzip')rope.release();
      if(a.kind==='pass_through'&&R.action===a){
        h.shape=TL.BodyShapes.tuck;h.tuckHold=.2;h.tuck=1;
        const along=h.pos.clone().sub(a.entry).dot(a.axis);
        if(along>-.45)a.entered=true;
        // Complete before steering: at high entry speed a frame can cross the
        // endpoint. Never turn the character back into the rim to hit a point.
        if(h.pos.clone().sub(a.exit).dot(a.axis)>-.5){
          const release=this.begin(h,'pass_release',.46);release.heading=a.axis.clone();release.spin=a.gate?.type==='pipe'?Math.PI*2:0;h.tuckHold=.18;for(const rope of h.tether.ropes)if(rope.kind==='airzip')rope.release();h.emit('zippull');
        }else{
          const target=a.entered?a.exit:a.entry;
          if(!(a.entered?this.clearPath(h,h.pos,target):this.remainingPassageClear(h,a))){R.action=null;h.tether.releaseAll();}
          else{
            if(a.entered)for(const rope of h.tether.ropes)if(rope.kind==='airzip')rope.release();
          }
        }
      }
    }
    // A loop is a held, energy-dependent reel, not a canned circular flight path.
    const rope=h.tether.main;
    if(h.state===S.SWING&&rope.attached&&it.dive&&h.vel.length()>20){
      if(!R.loop){const f=h.vel.clone();f.y=0;if(f.lengthSq()<1)f.set(Math.sin(h.facing),0,Math.cos(h.facing));f.normalize();R.loop={forward:f,angle:0,travel:0,prev:null,initial:rope.L};}
      const L=R.loop,d=h.pos.clone().sub(rope.pivot()),angle=Math.atan2(d.dot(L.forward),-d.y);
      if(L.prev!==null){let da=angle-L.prev;if(da>Math.PI)da-=Math.PI*2;if(da<-Math.PI)da+=Math.PI*2;L.travel+=da;}
      L.prev=angle;L.angle=angle;
      rope.targetL=Math.max(rope.minL,L.initial*.68);rope.L=Math.max(rope.targetL,rope.L-9*dt);
      if(Math.abs(L.travel)>Math.PI*1.9&&!L.awarded){L.awarded=true;h.emit('referenceboost','loop');}
    }else R.loop=null;
    if(it.cornerTether&&h.state===S.SWING){
      const direction=it.camFwd.clone(),right=it.camRight||new THREE.Vector3(1,0,0),side=Math.sign(it.moveLocal?.x)||1;
      direction.multiplyScalar(.45).addScaledVector(right,side).normalize();
      const test={...it,camFwd:direction,swingHand:side>0?'R':'L',singleHand:true};
      const anchor=h.tether.findSwingAnchor(h,test,h.stats,h.assist,test.swingHand);
      if(anchor){h.tryStartSwing(test);this.begin(h,'corner_tether',.7,side);}
    }
    const aerial=[S.AIR,S.DIVE,S.GLIDE].includes(h.state);
    if(it.jump&&(h.state===S.WATER||(h.inWater&&h.pos.y<TL.C.WATER_Y+1.4))){
      h.jumpBuffer=0;h.inWater=false;h.waterTime=0;h.vel.y=12;
      h.fsm.set(S.AIR,'water-jump');this.begin(h,'water_jump',.72);h.emit('skim',h.vel.length());
    }
    if(it.glideToggle&&h.state===S.GLIDE)this.begin(h,'wing_close',.42);
    const passage=(aerial||h.state===S.SWING)&&it.tether?this.passage(h,it):null;
    if(passage){
      h.tether.releaseAll();h.corner=null;h.roofFlow=null;h.swingWall=false;h.fsm.set(S.AIR,'pass-through');
      const a=this.begin(h,'pass_through',passage.path.total/passage.speed+.6);Object.assign(a,passage);a.approachDistance=Math.max(.1,h.pos.distanceTo(a.entry));a.travel=0;a.pathIndex=1;
      h.shape=TL.BodyShapes.tuck;h.tuckHold=.2;h.tuck=1;it.tether=false;
      passage.anchors.forEach((hit,i)=>{const rope=h.tether.ropes[i];rope.active=true;rope.attached=false;rope.kind='airzip';rope.hand=i?'R':'L';rope.attachTo(hit);rope.shotT=0;rope.shotDur=.08;});
      h.emit('pointlaunch');
    }else if(it.wingDodge&&h.state===S.GLIDE&&R.clock>=R.dodgeReady){
      R.dodgeReady=R.clock+.85;const side=Math.sign(it.moveLocal?.x)||1;
      this.begin(h,'wing_dodge',.62,side);
      h.vel.add(new THREE.Vector3(Math.cos(h.glide.yaw),0,-Math.sin(h.glide.yaw)).multiplyScalar(-side*4));
      h.emit('referenceboost','dodge');
    }else if(aerial&&it.spiderJump&&R.clock>=R.jumpReady){
      R.jumpReady=R.clock+6;h.tether.releaseAll();h.fsm.set(S.AIR,'spider-jump');this.begin(h,'spider_jump',.82);
    }else if(aerial&&it.spiderDash&&R.clock>=R.dashReady){
      R.dashReady=R.clock+6;h.tether.releaseAll();h.fsm.set(S.AIR,'spider-dash');
      const a=this.begin(h,'spider_dash',.72);a.heading=it.camFwd.clone();a.heading.y=TL.clamp(a.heading.y,-.25,.25);a.heading.normalize();
    }else if(aerial&&it.tether&&!it.launchTarget&&R.clock>=R.zipReady){
      const anchors=h.tether.findSlingAnchors(h,it.camFwd);
      if(anchors){
        h.tether.releaseAll();R.zipReady=R.clock+.75;h.fsm.set(S.AIR,'air-zip');
        const a=this.begin(h,'air_zip',.6);a.heading=it.camFwd.clone().normalize();
        anchors.forEach((hit,i)=>{const r=h.tether.ropes[i];r.active=true;r.attached=false;r.kind='airzip';r.hand=i?'R':'L';r.attachTo(hit);r.L=h.pos.distanceTo(r.anchor);r.maxL=r.L+10;r.shotT=0;r.shotDur=.1;r.elastic=false;});
        h.emit('pointlaunch');
      }
    }
  }
};
