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
  passage(h,it){
    if(!TL.Contact||!h.world.referenceGates)return null;
    let best=null,score=Infinity;
    for(const g of h.world.referenceGates){
      const delta=g.center.clone().sub(h.pos),d=delta.length();
      if(d<2||d>32||delta.normalize().dot(it.camFwd)<.94)continue;
      const sign=g.axis.dot(delta)>0?1:-1,axis=g.axis.clone().multiplyScalar(sign);
      const entry=g.center.clone().addScaledVector(axis,-g.length*.5-1),exit=g.center.clone().addScaledVector(axis,g.length*.5+2);
      if(h.pos.clone().sub(entry).dot(axis)>1||axis.dot(delta)<.7)continue;
      if(!this.clearPath(h,h.pos,entry)||!this.clearPath(h,entry,exit))continue;
      if(d<score){score=d;best={gate:g,entry,exit,axis};}
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
        const target=a.entered?a.exit:a.entry;
        if(!this.clearPath(h,h.pos,target)){R.action=null;h.tether.releaseAll();}
        else{
          const desired=target.clone().sub(h.pos).normalize().multiplyScalar(19);
          desired.y+=.9;const dv=desired.sub(h.vel);dv.clampLength(0,65*dt);h.vel.add(dv);
          h.facing=Math.atan2(a.axis.x,a.axis.z);
          if(a.entered)for(const rope of h.tether.ropes)if(rope.kind==='airzip')rope.release();
          if(h.pos.clone().sub(a.exit).dot(a.axis)>-.5){R.action=null;h.tuckHold=.12;h.emit('zippull');}
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
    const passage=aerial&&it.tether?this.passage(h,it):null;
    if(passage){
      h.tether.releaseAll();h.fsm.set(S.AIR,'pass-through');
      const a=this.begin(h,'pass_through',h.pos.distanceTo(passage.exit)/12+1.2);Object.assign(a,passage);
      h.shape=TL.BodyShapes.tuck;h.tuckHold=.2;h.tuck=1;it.tether=false;
      passage.gate.anchors.forEach((hit,i)=>{const rope=h.tether.ropes[i];rope.active=true;rope.attached=false;rope.kind='airzip';rope.hand=i?'R':'L';rope.attachTo(hit);rope.shotT=0;rope.shotDur=.08;});
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
