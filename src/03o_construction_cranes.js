/* Manhattan uses the same authored crane assets as procedural city construction.
   Slew limits are collision-checked before creation; ropes attach in collider-local space. */
'use strict';
TL.ConstructionCranes={
  // Asset-local collision bounds from the procedural crane's authored structural pieces.
  bounds:[[25,4.1,0,25,1.2,1.1],[-7,3.2,0,7,.6,1.3],[-11.8,2.4,0,2,1.3,1.4],[0,1.6,0,1.6,1.6,1.6],[0,7.5,0,.3,4.5,.3]],
  point(c,x,y,z,yaw=c.yaw){return new THREE.Vector3(c.x+x*Math.cos(yaw)+z*Math.sin(yaw),c.topY+y,c.z-x*Math.sin(yaw)+z*Math.cos(yaw));},
  overlap(a,b){
    if(a.cy+a.hy<=b.cy-b.hy||a.cy-a.hy>=b.cy+b.hy)return false;
    const ac=Math.cos(a.yaw),as=Math.sin(a.yaw),bc=b.c,bs=b.s,dx=b.cx-a.cx,dz=b.cz-a.cz;
    for(const [x,z]of[[ac,-as],[as,ac],[bc,-bs],[bs,bc]])if(Math.abs(dx*x+dz*z)>=a.hx*Math.abs(x*ac-z*as)+a.hz*Math.abs(x*as+z*ac)+b.hx*Math.abs(x*bc-z*bs)+b.hz*Math.abs(x*bs+z*bc))return false;
    return true;
  },
  clearPose(rec,yaw,candidates,margin=.3){
    const boxes=this.bounds.concat([[40,2.4-rec.drop/2,0,1.8,rec.drop/2+1.5,1.8]]);
    for(const b of boxes){const p=this.point(rec,b[0],b[1],b[2],yaw),a={cx:p.x,cy:p.y,cz:p.z,hx:b[3]+margin,hy:b[4]+margin,hz:b[5]+margin,yaw};
      if(candidates.some(c=>c.solid&&this.overlap(a,c)))return false;
    }return true;
  },
  plan(world,site){
    if(!site.crane)return null;
    let result=this.planAt(world,site);if(result)return result;
    const p=site.crane,yaw=Number.isFinite(p.yaw)?p.yaw:site.yaw||0,c=Math.cos(yaw),s=Math.sin(yaw),reasons=new Set([this.lastFailure]);
    // Nearby real footings handle stepped roofs without inventing a floating mast base.
    for(const [dx,dz]of[[4,0],[-4,0],[0,4],[0,-4],[4,4],[4,-4],[-4,4],[-4,-4],[8,0],[-8,0],[0,8],[0,-8],[8,8],[8,-8],[-8,8],[-8,-8],[12,0],[-12,0],[0,12],[0,-12],[16,0],[-16,0],[0,16],[0,-16]]){
      result=this.planAt(world,{...site,crane:{...p,x:p.x+dx*c+dz*s,z:p.z-dx*s+dz*c}});if(result)return result;reasons.add(this.lastFailure);
    }
    // Full-footprint reconstructions can extend far beyond the old roof kit.
    // Place a mast outside the actual outline bounds, on a checked street or
    // completed-roof footing, instead of forcing it through unfinished floors.
    const B=site.footprint?.bounds,bounds=Array.isArray(B)?B:B?[B.minX,B.minZ,B.maxX,B.maxZ]:null;
    if(Array.isArray(bounds)&&bounds.length===4){
      const [x0,z0,x1,z1]=bounds,cy=Math.cos(site.yaw||0),sy=Math.sin(site.yaw||0),points=[];
      for(const pad of [4,7,11]){
        for(let x=x0;x<=x1+.01;x+=Math.max(6,(x1-x0)/8))for(const z of [z0-pad,z1+pad])points.push([x,z]);
        for(let z=z0;z<=z1+.01;z+=Math.max(6,(z1-z0)/8))for(const x of [x0-pad,x1+pad])points.push([x,z]);
      }
      const candidates=points.map(([x,z])=>({x:site.center.x+x*cy+z*sy,z:site.center.z-x*sy+z*cy})).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));
      for(const candidate of candidates){result=this.planAt(world,{...site,crane:{...p,...candidate}});if(result)return result;reasons.add(this.lastFailure);}
    }
    this.lastFailure=[...reasons].join('; ');return null;
  },
  planAt(world,site){
    this.lastFailure=null;const fail=reason=>{this.lastFailure=reason;return null;};
    const p=site.crane;if(!p||![p.x,p.z,p.baseY].every(Number.isFinite))return null;
    const initialYaw=Number.isFinite(p.yaw)?p.yaw:site.yaw||0;
    const baseHit=world.raycast(p.x,Math.max(p.baseY,site.baseY||p.baseY)+.4,p.z,0,-1,0,1000,c=>c.solid&&!c.dynamic,null);
    if(!baseHit||baseHit.ny<.9)return fail('no mast support');
    const baseY=baseHit.y;
    const rec={x:p.x,z:p.z,baseY,topY:Math.max(baseY+24,p.topY||baseY+63),yaw:initialYaw,drop:TL.clamp(p.drop||16,5,24)};
    for(const [dx,dz]of[[0,0],[-2.6,0],[2.6,0],[0,-2.6],[0,2.6]]){
      const hit=world.raycast(rec.x+dx,rec.baseY+.3,rec.z+dz,0,-1,0,.7,c=>c.solid&&!c.dynamic,null);
      if(!hit||hit.ny<.9||Math.abs(hit.y-rec.baseY)>.12)return fail('uneven mast pedestal support');
    }
    const nearby=[];world.query(rec.x-56,rec.z-56,rec.x+56,rec.z+56,nearby);
    // Keep authored squeeze-through lanes open for the full motion, including the hook.
    for(const gate of world.referenceGates||[]){if(Math.hypot(gate.center.x-rec.x,gate.center.z-rec.z)>65)continue;const yaw=Math.atan2(gate.axis.x,gate.axis.z);nearby.push({cx:gate.center.x,cy:gate.center.y,cz:gate.center.z,hx:.75,hy:1.1,hz:gate.length/2+2,yaw,c:Math.cos(yaw),s:Math.sin(yaw),solid:true,routeLane:true});}
    for(const point of site.routePoints||[]){
      if(point.kind==='pipe'||point.kind==='water_tower')continue;
      const axis=point.axis||new THREE.Vector3(0,0,1),yaw=Math.atan2(axis.x,axis.z),reach=point.kind==='frame'?(point.approach||5)+1.2:Math.max(2,point.radius||1.5);
      nearby.push({cx:point.center.x,cy:point.center.y,cz:point.center.z,hx:.95,hy:1.25,hz:reach,yaw,c:Math.cos(yaw),s:Math.sin(yaw),solid:true,routeLane:true});
    }
    // Vertical mast must have a real unobstructed footprint above its intended support.
    const mast={cx:rec.x,cy:(rec.baseY+rec.topY)/2,cz:rec.z,hx:1.3,hy:(rec.topY-rec.baseY)/2-.05,hz:1.3,yaw:0};
    if(nearby.some(c=>c.solid&&this.overlap(mast,c)))return fail('mast intersects building or passage');
    const initial=rec.topY;
    for(const lift of [0,8,16,24]){rec.topY=initial+lift;
      mast.cy=(rec.baseY+rec.topY)/2;mast.hy=(rec.topY-rec.baseY)/2-.05;
      if(nearby.some(c=>c.solid&&this.overlap(mast,c)))continue;
      for(const amp of [.5,.3,.14])for(let j=0;j<16;j++){
        const yaw=initialYaw+j*Math.PI/8;let clear=true;
        const steps=Math.ceil(amp*2/.009);
        for(let k=0;k<=steps;k++)if(!this.clearPose(rec,yaw-amp+amp*2*k/steps,nearby)){clear=false;break;}
        if(clear)return {...rec,yaw,midYaw:yaw,amplitude:amp};
      }
    }return fail('no clear slew interval');
  },
  spawn(world,site,index=0){
    const rec=this.plan(world.world,site);if(!rec)return null;
    const A=TL.Assets,q=world.quality||'medium',mesh=(name)=>A.mesh(q==='low'?name:'S_'+name,q==='low'?'lo':A.pickLod('S_'+name,q),A.shared('world'));
    const mast=mesh('crane_mast'),jib=mesh('crane_jib'),hook=mesh('crane_hook');if(!mast||!jib||!hook)return null;
    Object.assign(rec,{siteId:site.id,phase:0,rate:.13+(index%3)*.018,mast,jib,hook,parts:[],hookVel:new THREE.Vector3(),meshes:[mast,jib,hook]});
    mast.position.set(rec.x,rec.baseY,rec.z);mast.scale.y=(rec.topY-rec.baseY)/63;jib.position.set(rec.x,rec.topY,rec.z);jib.rotation.y=rec.yaw;
    const W=world.world,props={kind:'crane',src:'construction_crane',siteId:site.id,anchor:true,climb:true,perch:false,mass:Infinity};
    rec.mastCol=W.addStatic(rec.x,(rec.baseY+rec.topY)/2,rec.z,1.3,(rec.topY-rec.baseY)/2,1.3,0,props);
    for(const b of this.bounds){const p=this.point(rec,b[0],b[1],b[2]);rec.parts.push({local:b,col:W.addDynamic(p.x,p.y,p.z,b[3],b[4],b[5],rec.yaw,props)});}
    const tp=this.point(rec,40,2.4,0);rec.hookPos=tp.clone().add(new THREE.Vector3(0,-rec.drop,0));
    rec.hookCol=W.addDynamic(rec.hookPos.x,rec.hookPos.y,rec.hookPos.z,.55,.9,.4,0,{...props,climb:false,mass:800});
    rec.hookCol.owner={applyImpulse:(x,y,z)=>{rec.hookVel.add(new THREE.Vector3(x,y,z));rec.hookVel.clampLength(0,6);}};
    hook.position.copy(rec.hookPos).y-=.7;
    rec.cable=new THREE.Line(new THREE.BufferGeometry().setFromPoints([tp,rec.hookPos]),new THREE.LineBasicMaterial({color:0x30343a}));rec.cable.frustumCulled=false;rec.meshes.push(rec.cable);
    for(const m of rec.meshes){m.name='Moving crane '+site.name;world.scene.add(m);}
    site.movingCrane=rec;return rec;
  },
  build(world){
    if(world.constructionCraneState)return world.constructionCraneState;
    const state=world.constructionCraneState={cranes:[],skipped:[],dispose:()=>this.dispose(world)};
    if(!TL.Assets)return state;
    for(const [i,s]of (world.constructionState?.sites||[]).entries()){if(!s.crane)continue;const rec=this.spawn(world,s,i);if(rec)state.cranes.push(rec);else state.skipped.push(s.id);}
    return state;
  },
  update(world,dt){
    if(!(dt>0)||!world.constructionCraneState)return;dt=Math.min(dt,.1);
    const W=world.world;
    for(const c of world.constructionCraneState.cranes){
      c.phase+=dt*c.rate;c.yaw=c.midYaw+Math.sin(c.phase)*c.amplitude;c.jib.rotation.y=c.yaw;
      for(const part of c.parts){const b=part.local,p=this.point(c,b[0],b[1],b[2]);W.moveDynamic(part.col,p.x,p.y,p.z,c.yaw,dt);}
      const trolley=this.point(c,40,2.4,0),hp=c.hookPos,hv=c.hookVel;
      // Damped pendulum in short substeps, with a conservative checked cable envelope.
      const steps=Math.ceil(dt/(1/120)),h=dt/steps;
      for(let k=0;k<steps;k++){
        hv.y-=TL.C.G*h;hv.multiplyScalar(Math.exp(-.65*h));hp.addScaledVector(hv,h);
        const d=hp.clone().sub(trolley),length=d.length();if(length>c.drop){d.multiplyScalar(1/length);hp.copy(trolley).addScaledVector(d,c.drop);const radial=hv.dot(d);if(radial>0)hv.addScaledVector(d,-radial);}
        const dx=hp.x-trolley.x,dz=hp.z-trolley.z,r=Math.hypot(dx,dz);
        if(r>1.2){hp.x=trolley.x+dx/r*1.2;hp.z=trolley.z+dz/r*1.2;hv.x*=.5;hv.z*=.5;}
      }
      c.hook.position.copy(hp).y-=.7;W.moveDynamic(c.hookCol,hp.x,hp.y,hp.z,0,dt);
      const a=c.cable.geometry.attributes.position;a.setXYZ(0,trolley.x,trolley.y,trolley.z);a.setXYZ(1,hp.x,hp.y,hp.z);a.needsUpdate=true;
    }
  },
  dispose(world){const S=world.constructionCraneState;if(!S)return;for(const c of S.cranes){for(const m of c.meshes)world.scene.remove(m);world.world.removeStatic(c.mastCol);for(const p of c.parts)world.world.removeDynamic(p.col);world.world.removeDynamic(c.hookCol);c.cable.geometry.dispose();c.cable.material.dispose();}for(const site of world.constructionState?.sites||[])delete site.movingCrane;world.constructionCraneState=null;}
};
if(TL.ScanHooks){TL.ScanHooks.build.push(w=>TL.ConstructionCranes.build(w));TL.ScanHooks.update.push((w,p,v,dt)=>{if(!w.constructionCraneState?.physicsDriven)TL.ConstructionCranes.update(w,dt);});}
