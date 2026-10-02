/* Local city activity. Budgets: 12 queued events, 4 reactions/event, 8 scheduled
   reactions, 4 roof workers and one rescue. All clocks use simulation time. */
'use strict';
TL.CityLife = class {
  constructor(game) {
    this.game=game;this.t=0;this.events=[];this.serial=0;this.cool=new Map();
    this.workers=[];this.scanT=0;this.presenceT=0;this.incident=null;this.incidentT=18;this.nextKind=0;
  }
  visible(a,b) {
    const d=b.clone().sub(a),len=d.length();if(len<.05)return true;d.divideScalar(len);
    return !this.game.world.raycast(a.x,a.y,a.z,d.x,d.y,d.z,Math.max(0,len-.15),c=>c.solid,{}, {noGround:true});
  }
  emit(kind,pos,intensity=1,key=kind) {
    if((this.cool.get(key)||0)>this.t)return;
    this.cool.set(key,this.t+(kind==='pass'?3:kind==='presence'?16:2));
    if(this.cool.size>64)for(const [k,v]of this.cool)if(v<this.t)this.cool.delete(k);
    if(this.events.length<12)this.events.push({id:++this.serial,kind,pos:pos.clone(),intensity:TL.clamp(intensity,0,1),expires:this.t+1});
  }
  dispatch() {
    const crowd=this.game.crowd;let scheduled=crowd.peds.filter(p=>p.notice).length;
    for(const e of this.events){
      if(e.expires<this.t)continue;let budget=4;
      const radius=e.kind==='presence'?10:e.kind==='pass'?19:28;
      for(const p of [...crowd.peds,...this.workers]){
        if(!budget||scheduled>=8)break;
        if(!p.alive||p.fear>.3||p.notice||p.react>0||p.mode==='wait'||p.cross)continue;
        const d=p.pos.distanceTo(e.pos);if(d>radius||d<.5)continue;
        const chance=(1-d/radius)*(.35+e.intensity*.5);
        if(crowd.rng.next()>chance||!this.visible(p.pos.clone().add(new THREE.Vector3(0,1.55,0)),e.pos))continue;
        p.notice={event:e,delay:crowd.rng.range(.12,.85)};p.react=crowd.rng.range(12,22);budget--;scheduled++;
      }
    }
    this.events.length=0;
  }
  react(p,dt) {
    if(p.fear>.3){p.notice=null;p.lookAt=null;return;}
    if(p.notice){p.notice.delay-=dt;if(p.notice.delay<=0){
      const e=p.notice.event;p.notice=null;
      if(!this.visible(p.pos.clone().add(new THREE.Vector3(0,1.55,0)),e.pos))return;
      p.lookAt=e.pos.clone();p.mode=e.kind==='pass'?'look':e.kind==='land'&&e.intensity>.7?'cower':this.game.crowd.rng.pick(['wave','photo','look']);p.modeT=2+this.game.crowd.rng.next()*2;
    }}
    if(p.lookAt&&p.modeT>0)p.yaw=TL.dampAngle(p.yaw,Math.atan2(p.lookAt.x-p.pos.x,p.lookAt.z-p.pos.z),5,dt);
    else p.lookAt=null;
  }
  roofSites() {
    const R=this.game.streamer.roofState;if(!R)return [];
    if(this.sites&&this.siteRevision===R.revision)return this.sites;this.siteRevision=R.revision;
    const sites=[];
    for(const p of R.placements){
      if(p.type!=='hvac')continue;
      const A=R.analyses.find(a=>a.b.id===p.bid);if(!A)continue;
      const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
      const at=(x,z)=>new THREE.Vector3(p.x+x*c+z*s,p.y,p.z-x*s+z*c);
      const a=at(0,-3.1),b=at(2.6,-3.1);
      const clear=q=>TL.Rooftops.fits(A,q.x,q.z,q.y,.65,.65,p.yaw,1.5)&&
        !R.placements.some(o=>o!==p&&Math.abs(o.y-q.y)<2&&Math.hypot(q.x-o.x,q.z-o.z)<Math.hypot(o.hx,o.hz)+.8)&&
        !this.game.world.raycast(q.x,q.y+.15,q.z,0,1,0,2,c=>c.solid,{}, {noGround:true});
      if(clear(a)&&clear(b)&&this.visible(a.clone().add(new THREE.Vector3(0,1,0)),b.clone().add(new THREE.Vector3(0,1,0))))sites.push({a,b,equipment:p,A});
    }
    return this.sites=sites;
  }
  worker(site) {
    const p=new TL.Ped();p.pos.copy(site.a);p.site=site;p.phase=0;p.workT=0;p.variant='m';
    p.colors={skin:0xb9876a,shirt:0xd89c37,pants:0x36434b};p.hat=false;p.speed=.75;
    p.skin=this.game.crowd.getSkin('m');if(!p.skin)return null;
    p.skin.owner=p;p.skin.sk.mesh.visible=true;TL.Assets.setSlots(p.skin.mat,{6:p.colors.skin,7:p.colors.shirt,2:p.colors.pants});
    if(p.skin.extra.hat)p.skin.extra.hat.visible=false;
    this.workers.push(p);return p;
  }
  removeWorker(p) {if(p.skin){p.skin.owner=null;p.skin.sk.mesh.visible=false;p.skin=null;}this.workers=this.workers.filter(w=>w!==p);p.alive=false;}
  updateWorkers(dt) {
    const g=this.game,focus=g.hero.ctrl.pos;
    this.scanT-=dt;
    if(this.scanT<=0){this.scanT=3;
      for(const p of [...this.workers])if((p.pos.distanceTo(focus)>200||!g.streamer.roofState?.analyses.includes(p.site.A))&&(!this.incident||this.incident.worker!==p))this.removeWorker(p);
      for(const site of this.roofSites())if(this.workers.length<4&&site.a.distanceTo(focus)<130&&site.a.distanceTo(focus)>15&&!this.workers.some(w=>w.site.a.distanceTo(site.a)<2))this.worker(site);
    }
    for(const p of this.workers){
      p.react=Math.max(0,p.react-dt);p.modeT-=dt;this.react(p,dt);
      if(this.incident&&this.incident.worker===p)continue;
      if(!p.lookAt){p.workT+=dt;const t=p.workT%22;
        if(t<5){p.pos.lerpVectors(p.site.a,p.site.b,t/5);p.mode='walk';p.yaw=Math.atan2(p.site.b.x-p.site.a.x,p.site.b.z-p.site.a.z);}
        else if(t<11){p.mode=t<8?'phone':'inspect';p.yaw=p.site.equipment.yaw;}
        else if(t<16){p.pos.lerpVectors(p.site.b,p.site.a,(t-11)/5);p.mode='walk';p.yaw=Math.atan2(p.site.a.x-p.site.b.x,p.site.a.z-p.site.b.z);}
        else {p.mode='idle';p.yaw=p.site.equipment.yaw;}
      }
      g.crowd.render(p,dt,false);
    }
  }
  social() {
    // Two people already standing in a broad straight sidewalk section; no route relocation.
    const C=this.game.crowd,stationary=C.peds.filter(p=>['idle','phone'].includes(p.mode)&&!p.lookAt&&!p.notice&&p.fear<.1);
    if(stationary.some(p=>p.socialUntil>this.t))return;
    for(const a of stationary)for(const b of stationary){
      if(a===b||a.i!==b.i||a.j!==b.j||a.pos.distanceTo(b.pos)>2.5||a.pos.distanceTo(b.pos)<1.2)continue;
      const mid=a.pos.clone().add(b.pos).multiplyScalar(.5);
      if(Math.floor(a.t)!==Math.floor(b.t)||C.peds.some(p=>p!==a&&p!==b&&p.mode==='walk'&&p.pos.distanceTo(mid)<5))continue;
      // Conversation only in an open pocket, never squeezed against a facade.
      const nearby=this.game.world.query(mid.x-1.6,mid.z-1.6,mid.x+1.6,mid.z+1.6,[]);
      if(nearby.some(c=>c.solid&&this.game.world.closest(c,mid.x,mid.y+1,mid.z,new THREE.Vector3()).distanceTo(mid.clone().add(new THREE.Vector3(0,1,0)))<1.4))continue;
      if(!this.visible(a.pos.clone().add(new THREE.Vector3(0,1,0)),b.pos.clone().add(new THREE.Vector3(0,1,0))))continue;
      for(const [p,q]of [[a,b],[b,a]]){p.mode='talk';p.modeT=4;p.react=12;p.lookAt=q.pos.clone();p.socialUntil=this.t+18;}return;
    }
  }
  startIncident(kind) {
    const g=this.game,h=g.hero.ctrl;if(this.incident||g.missions.active||g.missions.crime||g.ai.inCombat)return false;
    let I={kind,state:'available',t:0,progress:0,announced:false};
    if(kind==='street'){
      const v=g.traffic.vehicles.find(v=>!v.runaway&&!v.incident&&v.speed<4&&v.s>Math.min(6,v.seg.len*.2)&&v.s<v.seg.len-Math.min(6,v.seg.len*.2)&&v.pos.distanceTo(h.pos)>25&&v.pos.distanceTo(h.pos)<140);
      if(!v)return false;I.vehicle=v;I.vehicleId=v.col.id;I.pos=v.pos.clone();v.incident=true;
      I.target=I.pos.clone().add(new THREE.Vector3(0,1,0));I.title='Stalled vehicle';I.prompt='[E] Web-start the stalled vehicle';
    }else{
      const p=this.workers.find(w=>w.pos.distanceTo(h.pos)>18&&w.pos.distanceTo(h.pos)<140&&w.alive);
      if(!p)return false;I.worker=p;I.start=p.pos.clone();I.safe=p.site.a.clone();
      if(kind==='ledge'){
        // Pick a real parapet and a verified inward rescue path on this worker's roof.
        const R=g.streamer.roofState;let edge=null;
        for(const c of R.colliders){
          if(c.bid!==p.site.equipment.bid||c.hy>.3||c.hx<2||Math.abs(c.top-p.pos.y-.5)>.15)continue;
          for(const side of [-1,1]){
            const a=c.toWorld(0,c.hy,0,new THREE.Vector3()),safe=c.toWorld(0,0,side*2.2,new THREE.Vector3());safe.y=p.pos.y;
            if(!TL.Rooftops.fits(p.site.A,safe.x,safe.z,safe.y,.65,.65,c.yaw,1))continue;
            const hit=g.world.raycast(safe.x,safe.y+.1,safe.z,0,1,0,2,x=>x.solid,{}, {noGround:true});
            if(!hit&&a.distanceTo(h.pos)>18){edge={a,safe};break;}
          }if(edge)break;
        }
        if(!edge&&!g.scanMode){
          for(const f of p.site.A.faces){const v=f.p;
            for(let j=0;j<3;j++){const k=(j+1)%3,dx=v[k*3]-v[j*3],dz=v[k*3+2]-v[j*3+2],len=Math.hypot(dx,dz);if(len<5||Math.abs(v[1]-p.pos.y)>.15)continue;
              const x=(v[j*3]+v[k*3])*.5,z=(v[j*3+2]+v[k*3+2])*.5;
              for(const sign of [-1,1]){const nx=-dz/len*sign,nz=dx/len*sign,a=new THREE.Vector3(x+nx*.3,p.pos.y,z+nz*.3),safe=new THREE.Vector3(x+nx*2.5,p.pos.y,z+nz*2.5);
                if(TL.Rooftops.topAt(p.site.A,x-nx*.5,z-nz*.5)>=p.pos.y-.5||!TL.Rooftops.fits(p.site.A,safe.x,safe.z,safe.y,.6,.6,0,1))continue;
                if(this.visible(a.clone().add(new THREE.Vector3(0,1,0)),safe.clone().add(new THREE.Vector3(0,1,0)))){edge={a,safe};break;}
              }if(edge)break;
            }if(edge)break;
          }
        }
        if(!edge)return false;I.start.copy(edge.a);I.safe.copy(edge.safe);p.pos.copy(I.start);
      }
      I.pos=p.pos.clone();I.target=I.pos.clone().add(new THREE.Vector3(0,.9,0));
      I.title=kind==='ledge'?'Ledge rescue':'Rooftop assistance';
      I.prompt=kind==='ledge'?'[E] Web the worker to safety':'[E] Secure the loose service panel';
      if(kind==='roof'){
        const e=p.site.equipment;I.target.set(e.x,e.y+.85,e.z);
        const panel=new THREE.Mesh(new THREE.BoxGeometry(1,.8,.055),new THREE.MeshStandardMaterial({color:0xc79636,roughness:.7}));
        panel.position.copy(I.target);panel.position.x+=Math.sin(e.yaw)*-1.27;panel.position.z+=Math.cos(e.yaw)*-1.27;panel.rotation.set(.25,e.yaw,.12);I.target.copy(panel.position);g.scene.add(panel);I.prop=panel;
        if(!g.scanMode){
          const from=p.pos.clone().add(new THREE.Vector3(0,.85,0)),dir=new THREE.Vector3(e.x,e.y+.85,e.z).sub(from),len=dir.length();dir.normalize();
          const hit=g.world.raycast(from.x,from.y,from.z,dir.x,dir.y,dir.z,len,c=>c.solid,{}, {noGround:true});
          if(hit){I.target.set(hit.x+hit.nx*.05,hit.y,hit.z+hit.nz*.05);panel.position.copy(I.target);panel.rotation.y=Math.atan2(hit.nx,hit.nz);}
        }
      }
    }
    I.web=new TL.RopeRenderer(g.scene,0xeeeeee,20,4);I.web.hide();
    this.incident=I;return true;
  }
  canAssist() {
    const I=this.incident,h=this.game.hero.ctrl;
    return !!I&&I.state==='available'&&h.pos.distanceTo(I.target)<7&&h.vel.length()<3&&
      (h.grounded||[TL.TS.GROUND,TL.TS.PERCH].includes(h.state))&&this.visible(h.pos,I.target);
  }
  cleanupIncident(reason='abandoned') {
    const I=this.incident;if(!I)return;
    if(I.state==='success')reason='success';
    const g=this.game;I.state=reason;
    if(I.action&&g.hero.anim?.action===I.action)g.hero.anim.action=null;
    if(I.vehicle&&I.vehicle.col&&I.vehicle.col.id===I.vehicleId)I.vehicle.incident=false;
    if(I.worker&&I.worker.alive){I.worker.pos.copy(I.safe);I.worker.workT=16;I.worker.mode='idle';if(I.kind==='ledge'||reason==='unavailable')this.removeWorker(I.worker);}
    if(I.prop){g.scene.remove(I.prop);I.prop.geometry.dispose();I.prop.material.dispose();}
    if(I.web){g.scene.remove(I.web.mesh);I.web.mesh.geometry.dispose();I.web.mat.dispose();}
    this.lastIncident={kind:I.kind,state:reason};this.incident=null;this.incidentT=reason==='success'?70:35;
  }
  updateIncident(dt) {
    const g=this.game,h=g.hero.ctrl;let I=this.incident;
    if(!I){this.incidentT-=dt;if(this.incidentT<=0){const kinds=['roof','street','ledge'];
      for(let k=0;k<3;k++){const n=(this.nextKind+k)%3;if(this.startIncident(kinds[n])){this.nextKind=(n+1)%3;break;}}
      this.incidentT=12;}return;}
    I.t+=dt;
    if(g.missions.active||g.missions.crime||g.ai.inCombat||I.t>110||h.pos.distanceTo(I.pos)>210){this.cleanupIncident('abandoned');return;}
    if(I.worker&&(!I.worker.alive||!I.worker.skin||!g.streamer.roofState?.analyses.includes(I.worker.site.A))||I.vehicle&&(!I.vehicle.active||!I.vehicle.col||I.vehicle.col.id!==I.vehicleId)){this.cleanupIncident('unavailable');return;}
    if(I.state==='success'){if(I.worker)g.crowd.render(I.worker,dt,false);if(I.t>5)this.cleanupIncident('success');return;}
    if(I.vehicle){
      // The web reaches the visible body panel, never the centre inside the car.
      g.world.closest(I.vehicle.col,h.pos.x,h.pos.y,h.pos.z,I.target);
      const normal=h.pos.clone().sub(I.target).normalize();I.target.addScaledVector(normal,.04);
    }
    const d=h.pos.distanceTo(I.target),seen=d<32&&this.visible(h.pos,I.target);
    if(seen&&!I.announced){I.announced=true;g.ui.caption(I.kind==='street'?'Driver: "It stalled. Could you give it a web-assisted start?"':I.kind==='ledge'?'Worker: "I lost my footing! Pull me back onto the roof!"':'Worker: "That service panel is loose. Can you web it down?"','City');g.missions.pushFeed(I.title,'activity');}
    if(I.worker){I.worker.mode=I.kind==='ledge'?'cower':'wave';I.worker.yaw=Math.atan2(h.pos.x-I.pos.x,h.pos.z-I.pos.z);g.crowd.render(I.worker,dt,false);}
    if(I.prop)I.prop.rotation.z=.12+Math.sin(I.t*4)*.035;
    if(I.state==='available'&&d<7&&seen&&(h.grounded||[TL.TS.GROUND,TL.TS.PERCH].includes(h.state))&&h.vel.length()<3){
      g.ui.prompt(I.prompt);
      if(g.input.consume('interact')){
        if(I.kind==='ledge'&&Math.hypot(h.pos.x-I.safe.x,h.pos.z-I.safe.z)<1.5){
          const base=I.safe.clone(),dx=I.safe.x-I.start.x,dz=I.safe.z-I.start.z,len=Math.hypot(dx,dz)||1;
          let safe=null;for(const sign of [-1,1]){const q=base.clone().add(new THREE.Vector3(-dz/len*sign*1.8,0,dx/len*sign*1.8));
            if(TL.Rooftops.fits(I.worker.site.A,q.x,q.z,q.y,.6,.6,0,.8)&&this.visible(I.start.clone().add(new THREE.Vector3(0,1,0)),q.clone().add(new THREE.Vector3(0,1,0)))){safe=q;break;}}
          if(!safe){g.ui.caption('Worker: "Give me a little room to get back up."','Worker');return;}I.safe.copy(safe);
        }
        I.state='active';I.origin=h.pos.clone();I.progress=0;g.hero.anim.startAction('pull',2.1,I.target,-1);I.action=g.hero.anim.action;g.audio.sfx('thwip',.65,{pan:.2});
      }
    }
    if(I.state==='active'){
      // Player stays in control: moving/jumping away cancels immediately and safely.
      if(d>9||h.pos.distanceTo(I.origin)>2.5||!seen){this.cleanupIncident('abandoned');return;}
      I.progress+=dt;const u=TL.smooth(.2,1.6,I.progress);
      if(I.kind==='ledge'){
        I.worker.pos.lerpVectors(I.start,I.safe,u);I.worker.pos.y+=Math.sin(u*Math.PI)*.55;
        I.target.copy(I.worker.pos).y+=.8;
      }
      if(I.prop)I.prop.rotation.z=.12*(1-u);
      if(g.hero.anim.action===I.action)I.action.target.copy(I.target);
      const from=g.hero.anim.handWorld.R||h.pos;
      const rope={active:true,attached:true,shotT:I.progress,anchor:I.target,bends:[],tension:65,freeLen:()=>from.distanceTo(I.target)};
      I.web.update(dt,from,rope,Math.min(1,I.progress*8));
      if(I.progress>=1.8){
        I.state='success';I.t=0;I.web.hide();if(I.vehicle)I.vehicle.incident=false;
        if(I.worker){I.worker.pos.copy(I.safe);I.worker.mode='wave';I.worker.modeT=3;I.worker.lookAt=h.pos.clone();}
        g.progress.addXP(65,I.title);g.progress.changeTrust(g.layout.district(I.pos.x,I.pos.z),2);
        g.ui.toast(I.title+' — safe');g.audio.sfx('reward');this.emit('rescue',I.safe||I.pos,1);g.missions.pushFeed(I.title+' resolved','activity');
      }
    }
  }
  update(dt) {
    if(dt<=0)return;this.t+=dt;this.updateWorkers(dt);this.updateIncident(dt);
    this.presenceT-=dt;
    if(this.presenceT<=0){this.presenceT=2;const h=this.game.hero.ctrl;
      if(h.vel.length()<2)this.emit('presence',h.pos,.45);
      else if(h.vel.length()>22)this.emit('pass',h.pos,.8);
      this.social();
    }
    this.dispatch();
  }
};
