/* Traversal poses are visual only. Ropes, velocity and collision remain authoritative.
   Reference: BlueGalaxy, rQVxkz7azJA. Timings identify observed movement families,
   not extracted/proprietary animation assets. */
'use strict';
TL.MotionClips = {};
// Carry the rendered silhouette across interrupted aerial states. Directions are
// captured in world space so a turning torso does not drag the old pose with it.
// Loaded wrists and pendulum legs remain controlled by their contact solvers.
TL.AerialFlow = class {
  constructor() { this.pose={};this.t=1;this.duration=.18;this.lastPos=null;this.blocked=false; }
  begin(anim,h,dt) {
    const S=TL.TS,allowed=s=>[S.AIR,S.SWING,S.DIVE,S.GLIDE].includes(s);
    const blocked=!!h.reference?.action || !!anim.action || h.grounded;
    const jumped=this.lastPos && this.lastPos.distanceToSquared(h.pos)>100;
    if(blocked || this.blocked || jumped || !allowed(h.state))this.t=1;
    else if(h.state!==anim.prevSt && allowed(anim.prevSt)) {
      this.pose={};
      for(const [n,d] of Object.entries(anim.rig.cur))this.pose[n]=d.clone().applyQuaternion(anim.rootQ);
      this.duration=h.state===S.SWING?.12:h.state===S.GLIDE?.22:.18;
      this.t=0;
    }
    this.blocked=blocked;
    (this.lastPos||(this.lastPos=new THREE.Vector3())).copy(h.pos);
    this.t+=dt;
  }
  apply(anim,h,sets,iks) {
    if(this.t>=this.duration)return;
    const w=1-TL.smooth(0,this.duration,this.t), inv=anim.rootQ.clone().invert();
    const protectedHands=new Set(iks.map(k=>k.hand));
    for(const [n,target]of Object.entries(sets)) {
      if(!this.pose[n] || /^(spine|chest|neck|head|clav)/.test(n))continue;
      if(/^(uarm|farm|hand)/.test(n)&&protectedHands.has(n.slice(-1)))continue;
      if(h.state===TL.TS.SWING&&/^(thigh|shin|foot)/.test(n))continue;
      const from=this.pose[n].clone().applyQuaternion(inv);
      // Quaternion interpolation also handles exactly opposing directions.
      const q=new THREE.Quaternion().setFromUnitVectors(target,from);
      q.slerp(new THREE.Quaternion(),1-w);
      target.applyQuaternion(q).normalize();
    }
  }
};
TL.SwingStyle = {
  sample(anim,h,dt) {
    const r=h.tether.main;
    if(!r.attached)return null;
    anim.styleClock=(anim.styleClock||0)-dt;
    if(anim.styleClock<=0) {
      const hit=h.world.raycast(h.pos.x,h.pos.y,h.pos.z,0,-1,0,12,c=>c.solid);
      anim.swingClearance=hit?hit.t:12;anim.styleClock=.15;
    }
    const p=r.pivot(),dx=p.x-h.pos.x,dz=p.z-h.pos.z,len=Math.max(1,Math.hypot(dx,p.y-h.pos.y,dz));
    const lateral=(dx*Math.cos(h.facing)-dz*Math.sin(h.facing))/len;
    const cross=lateral*(r.hand==='L'?1:-1)<-.18;
    const low=1-TL.smooth(3,10,anim.swingClearance),fast=TL.smooth(12,35,h.vel.length());
    return {low,fast,cross,lateral,high:(1-low)*TL.smooth(15,40,len)};
  },
  release(h,n,style) {
    const speed=h.vel.length(),alt=h.pos.y-h.world.ground(h.pos.x,h.pos.z);
    const safe=alt>9&&(h.vel.y>0||alt/Math.max(1,-h.vel.y)>1.6)&&!(style&&style.low>.65);
    if(!safe||speed<8)return 'sail';
    const family=style?.cross?['scissor_twist','side_roll','reverse_corkscrew','side_layout']:
      h.vel.y>7?(speed>28?['pike','layout','overhead','inverted']:['flip','backflip','cannonball']):
      h.vel.y>2?['corkscrew','side_roll','scissor_twist','side_layout']:['sail','hurdle','star'];
    return family[n%family.length];
  }
};
(() => {
  const add = (name,duration,keys,opts) => TL.MotionClips[name]=Object.assign({name,duration,keys,weight:.7},opts);
  add('wall_latch_absorb', .38, [[.3,.7,.2,.8,.5,.2,.05],[1.1,1.8,.7,1.4,.4,.15,.25],[.65,1.15,.35,.85,.4,0,.12]]);
  add('wall_climb_drive', .85, [[1.1,1.6,.25,.75,.35,-.1,.1],[.25,.75,1.1,1.6,.4,0,.18],[1.1,1.6,.25,.75,.35,-.1,.1]], {loop:true});
  add('wall_descend', 1.05, [[.3,.8,.95,1.5,.5,.1,.15],[.95,1.5,.3,.8,.45,0,.08],[.3,.8,.95,1.5,.5,.1,.15]], {loop:true});
  add('wall_lateral_step', .85, [[.75,1.2,.25,.8,.45,.1,.08],[.25,.8,.75,1.2,.55,.15,.16],[.75,1.2,.25,.8,.45,.1,.08]], {loop:true, legSpread:.35});
  add('wall_rest_hang', 1.8, [[.4,.8,.7,1.2,.3,-.1,.05],[.45,.85,.75,1.25,.35,0,.08],[.4,.8,.7,1.2,.3,-.1,.05]], {loop:true});
  add('idle_weight_shift', 3.0, [[.04,.15,.08,.2,.25,-.1,.01],[.12,.25,.02,.12,.32,-.08,.03],[.04,.15,.08,.2,.25,-.1,.01]], {loop:true,weight:.45});
})();
TL.TraversalMotion = class {
  constructor() { this.name='';this.time=0;this.weight=0;this.out={};this.root={pitch:0,roll:0,twist:0,hips:0}; }
  play(name) { if(this.name!==name){this.name=name;this.time=0;} }
  update(dt,h,anim) {
    const S=TL.TS,st=h.state,wall=st===S.WALL||st===S.CRAWL,speed=h.vel.length();
    if(!wall && !(st===S.GROUND&&speed<.25)) {this.name='';this.weight=0;return this;}
    const next=wall ? speed<.3?'wall_rest_hang':Math.abs(h.vel.y)<speed*.35?'wall_lateral_step':h.vel.y<0?'wall_descend':'wall_climb_drive' : 'idle_weight_shift';
    this.play(next);
    // Climbing cycles advance with distance; they stop when the character stops.
    this.time+=dt*(wall&&speed>.3?Math.min(2.4,speed):1);
    const c=TL.MotionClips[this.name],u=(this.time/c.duration)%1,i=u<.5?0:1,f=TL.smooth(0,1,u*2-i);
    const k=c.keys[i].map((v,j)=>TL.lerp(v,c.keys[i+1][j],f));
    this.weight=anim.action||anim.trick?0:c.weight;
    for(const [side,o,s] of [['L',0,1],['R',2,-1]]) {
      this.out['thigh'+side]=new THREE.Vector3(s*(c.legSpread||.12),-Math.cos(k[o]),Math.sin(k[o])).normalize();
      this.out['shin'+side]=new THREE.Vector3(s*.035,-Math.cos(k[o]-k[o+1]),Math.sin(k[o]-k[o+1])).normalize();
      this.out['foot'+side]=new THREE.Vector3(s*.035,-.35,1).normalize();
    }
    this.lean=k[6];return this;
  }
};
TL.PendulumMotion = {
  sample(hero) {
    const r = hero.tether.main, pivot = r.pivot(), p = hero.pos, v = hero.vel;
    const hs = Math.hypot(v.x,v.z);
    const fx = hs > 1 ? v.x/hs : Math.sin(hero.facing), fz = hs > 1 ? v.z/hs : Math.cos(hero.facing);
    const angle = Math.atan2((p.x-pivot.x)*fx+(p.z-pivot.z)*fz,Math.max(.01,pivot.y-p.y));
    const u = TL.clamp(angle/1.05,-1,1);
    // Back: extend hips behind the torso, heels slightly drawn back. Bottom:
    // almost straight legs already passing forward. Rise: lift from the hips,
    // keeping long legs instead of bringing the knees up into the chest.
    // Drive out of the bottom, reaching the raised position early in the ascent
    // (24 degrees past vertical), rather than waiting until the front apex.
    const drive=TL.smooth(0,.42,angle);
    const hip = u < 0 ? TL.lerp(-.7,.12,TL.smooth(-1,0,u)) : TL.lerp(.12,1.25,drive);
    const knee = u < 0 ? TL.lerp(.5,.18,TL.smooth(-1,0,u)) : TL.lerp(.18,.24,drive);
    return {angle,hip,knee,drive,asymmetry:.035*(r.hand === 'L' ? 1 : -1)};
  }
};

// Whole-body moves: entry -> compression/extension -> silhouette -> open reach.
// [left hip, left knee, right hip, right knee, leg spread, arm spread,
//  arm angle from down, elbow bend, spine lean]. Knees bend backwards only.
TL.AerialClips = {};
(() => {
  const entry=[.65,.45,.25,.4,.10,.6,1.8,.25,.05];
  const reach=[.65,.32,-.35,.42,.12,.85,2.05,.35,-.1];
  const add=(name,duration,turn,a,b,ref)=>TL.AerialClips[name]={name,duration,turn,keys:[entry,a,b,reach],ref};
  add('flip',.86,[1,0,0],[1.9,2.35,1.8,2.2,.14,.25,.8,1.3,.65],[1.35,1.6,1.2,1.4,.12,.35,1.4,.8,.35],'0:20–0:22');
  add('backflip',.96,[-1,0,0],[1.7,2.1,1.8,2.25,.12,.35,2.5,.5,.4],[.9,.8,.75,.6,.1,.8,2.8,.25,-.15],'0:36–0:39');
  add('pike',1.02,[1,0,0],[1.7,.2,1.6,.25,.08,.25,1.5,.2,.48],[1.45,.18,1.35,.2,.06,.6,2.6,.2,.3],'1:18–1:21');
  add('layout',1.12,[-1,0,0],[-.2,.18,-.3,.2,.06,.4,3,.15,-.22],[-.1,.15,-.15,.2,.08,.9,2.2,.2,-.18],'0:50–0:56');
  add('corkscrew',1.02,[0,0,1],[.3,.45,-.2,.25,.05,.3,.6,1.3,-.1],[.5,.7,.1,.4,.08,.3,2.7,.5,-.1],'1:09–1:11');
  add('reverse_corkscrew',1.06,[0,0,-1],[.2,.3,.65,1.2,.1,.25,2.6,.9,.1],[.9,1.1,-.3,.25,.18,.7,2.5,.3,-.1],'1:30–1:34');
  add('side_roll',.92,[0,1,0],[1.3,1.9,.5,1.2,.2,.3,.7,1.2,.35],[.7,.6,-.2,.35,.25,1,2,.3,.05],'1:50–1:53');
  add('scissor_twist',1.05,[0,0,1],[1.2,.2,-.7,.3,.2,.95,1.5,.25,-.1],[-.4,.4,1.05,.2,.22,.7,2.4,.3,.05],'1:06–1:08');
  add('star',1.02,[0,0,0],[.15,.2,-.15,.25,.6,1.3,1.9,.15,-.2],[.3,.35,-.3,.45,.5,1.2,2.1,.3,-.15],'1:24–1:29');
  add('sail',.9,[0,0,0],[.85,.3,-.55,.45,.13,.95,2.15,.35,-.15],[.5,.65,-.35,.3,.1,.8,2.5,.25,-.1],'0:30–0:35');
  add('overhead',1.08,[-1,0,0],[.1,.2,.25,.3,.08,.4,3,.6,-.12],[-.15,.2,.35,.55,.15,.25,3.1,.85,-.18],'0:50–0:53');
  add('hurdle',.94,[0,0,0],[1.35,.2,.8,2.1,.28,.85,1.8,.45,.15],[.7,.35,-.35,.4,.2,1,2.2,.25,-.1],'0:21–0:23');
  add('cannonball',.92,[1,0,0],[2.1,2.45,2.05,2.4,.13,.2,.75,1.5,.7],[1.7,2.1,1.65,2.05,.1,.25,.9,1.3,.5],'1:01–1:04');
  add('seated',1.35,[0,0,0],[1.5,1.25,1.4,1.3,-.18,.18,1.25,.7,.15],[1.5,1.35,1.55,1.3,-.16,.15,1.2,.8,.12],'0:10–0:14; 2:42–2:44');
  add('inverted',1.25,[1,0,0],[-.1,.15,-.05,.2,.04,.25,3.1,.6,-.12],[.05,.18,.15,.2,.05,.6,2.8,.35,-.1],'0:26–0:28');
  add('side_layout',1.12,[0,-1,0],[-.2,.2,.25,.35,.3,1.1,2,.15,-.12],[.2,.25,-.3,.3,.35,.9,2.3,.3,-.15],'0:53–0:56');
  add('wall_kick',.72,[0,0,0],[1.3,1.8,-.3,.25,.18,1,2.2,.4,.2],[.4,.6,-.5,.3,.25,1.1,2,.3,-.18],'3:23–3:28');
  add('wall_vault',.8,[.0,0,0],[1.6,.5,.85,1.5,.2,.8,.6,.4,.55],[.8,.25,-.4,.35,.15,1,2.2,.25,-.1],'4:06–4:20');
  add('water_launch',.8,[0,0,0],[1.1,1.6,.6,1.1,.18,1,2.3,.3,.25],[.4,.35,-.3,.4,.15,.9,2.6,.2,-.15],'2:05–2:09');
  add('perch_launch',.88,[0,0,0],[1.2,1.8,1,1.6,.25,1,2.6,.25,.25],[.7,.45,-.5,.35,.2,1,2.1,.35,-.15],'0:04–0:08; 6:23–6:26');
  add('point_launch',.95,[0,0,0],[],[],'S95XpzMkbDM, 10.6–11.4: edge tuck, overhead punch, long extension, split recovery');
  Object.assign(TL.AerialClips.point_launch,{stops:[0,.18,.4,.68,1],keys:[
    [1.5,2.5,1.5,2.5,.22,.3,.12,.12,.5],
    [-.08,.16,-.08,.16,.05,.08,3.06,.08,-.18],
    [.15,.25,-.15,.25,.1,.14,3.0,.16,-.12],
    [1.1,1.35,-.5,.65,.28,1.1,2.05,.2,-.12],
    [.5,.55,-.3,.65,.2,.85,1.95,.3,-.08]
  ]});
  TL.AerialClips.sling_launch=Object.assign({},TL.AerialClips.point_launch,{name:'sling_launch',duration:1.05});
  // Point launch is a forward handspring, distinct from the upright slingshot.
  // Supplied sequence: inverted palm plant -> long inverted push -> fold over
  // the shoulders -> open arms and split legs as the torso returns upright.
  Object.assign(TL.AerialClips.point_launch,{duration:.82,ref:'User sequence, S95XpzMkbDM 0:00–0:02',stops:[0,.16,.44,.72,1],keys:[
    [.02,.12,.02,.12,.06,.08,3.03,.12,-.04],
    [.08,.18,.08,.18,.06,.2,2.85,.22,-.05],
    [1.15,1.3,1.05,1.25,.12,.85,2.0,.22,.24],
    [.65,1.05,-.2,.5,.2,1.15,1.75,.15,-.08],
    [.45,.6,-.3,.65,.18,.85,1.95,.3,-.08]
  ]});
})();

TL.ZipMotion={
  sample(hero) {
    const launch=hero.launch,t=launch?launch.t:hero.fsm.t;
    const distance=launch?hero.pos.distanceTo(launch.point):100;
    const grip=TL.smooth(.09,.19,t),pull=TL.smooth(.18,.36,t);
    const arrive=TL.smooth(8,1.6,distance)*TL.smooth(.2,.4,t);
    const braced=!!(launch&&launch.arrived);
    const push=braced?TL.smooth(.09,.24,launch.plantT):0;
    const handspring=!!(launch&&!launch.narrow&&(launch.boosted||launch.anticipateBoost));
    // Keep the body coiled during absorption; unfold only during the final
    // arm drive, rather than holding a straight handstand throughout contact.
    const coil=handspring?(braced?1-TL.smooth(.13,.24,launch.plantT):TL.smooth(.5,1,arrive)):0;
    return {t,grip,pull,arrive,braced,handspring,coil,reach:TL.lerp(.97,.38,pull),
      hip:handspring?(braced?TL.lerp(.02,1.9,coil):TL.lerp(-.25,1.9,arrive)):braced?1.5:TL.lerp(-.25,1.5,arrive),
      knee:handspring?(braced?TL.lerp(.12,2.5,coil):TL.lerp(.6,2.5,arrive)):braced?TL.lerp(2.7,2.5,push):TL.lerp(.6,2.7,arrive),
      pitch:braced?(handspring?Math.PI:.38):TL.lerp(TL.lerp(.2,1.22,pull),handspring?Math.PI:.38,arrive)};
  }
};

TL.AerialMotion = {
  aliases:{roll:'side_roll'},
  clip(name) {return TL.AerialClips[this.aliases[name]||name]||TL.AerialClips.sail;},
  sample(name,u,dir=1) {
    const c=this.clip(name),t=TL.clamp(u,0,1);
    const stops=c.stops||[0,.25,.58,1];let i=0;while(i<c.keys.length-2&&t>stops[i+1])i++;
    const f=TL.smooth(stops[i],stops[i+1],t),k=c.keys[i].map((v,j)=>TL.lerp(v,c.keys[i+1][j],f));
    const pose={};
    for(const [side,o,s] of [['L',dir>0?0:2,1],['R',dir>0?2:0,-1]]) {
      const hip=k[o],knee=k[o+1];
      pose['thigh'+side]=new THREE.Vector3(s*k[4],-Math.cos(hip),Math.sin(hip)).normalize();
      pose['shin'+side]=new THREE.Vector3(s*.025,-Math.cos(hip-knee),Math.sin(hip-knee)).normalize();
      pose['foot'+side]=new THREE.Vector3(s*.03,-.7,.65).normalize();
      const arm=k[6]+(s===dir?.15:-.15);
      pose['uarm'+side]=new THREE.Vector3(s*k[5],-Math.cos(arm),Math.sin(arm)).normalize();
      pose['farm'+side]=new THREE.Vector3(s*k[5]*.35,-Math.cos(arm+k[7]),Math.sin(arm+k[7])).normalize();
    }
    // Compress before the fast part of a somersault and hold the ball through
    // inversion. The entry/exit silhouettes still distinguish the variations.
    const tuck=c.turn[0]!==0 ? TL.smooth(.06,.23,t)*(1-TL.smooth(.68,.9,t)) : 0;
    const sideFlip=c.turn[1]!==0 ? TL.smooth(.03,.16,t)*(1-TL.smooth(.86,1,t)) : 0;
    for(const [side,s] of [['L',1],['R',-1]]) {
      if(tuck>0) {
        const hip=2.35,knee=2.65;
        const ball={
          thigh:new THREE.Vector3(s*.1,-Math.cos(hip),Math.sin(hip)),
          shin:new THREE.Vector3(s*.025,-Math.cos(hip-knee),Math.sin(hip-knee)),
          foot:new THREE.Vector3(s*.02,-.8,-.3),
          uarm:new THREE.Vector3(s*.16,-.8,.6),
          farm:new THREE.Vector3(-s*.25,.8,.45)
        };
        for(const bone in ball)pose[bone+side].lerp(ball[bone].normalize(),tuck).normalize();
      }
      if(sideFlip>0) {
        const extended=new THREE.Vector3(s,.12,.08).normalize();
        pose['uarm'+side].lerp(extended,sideFlip).normalize();
        pose['farm'+side].lerp(extended,sideFlip).normalize();
      }
    }
    const e=TL.smooth(.04,.94,t),turn=c.turn,q=new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(turn[0]*e*Math.PI*2,turn[2]*dir*e*Math.PI*2,turn[1]*dir*e*Math.PI*2,'XYZ'));
    // Twists travel through a reclining layout; open poses bank without a full spin.
    const arch=Math.sin(Math.PI*t);
    if(!turn[0])q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((name==='seated'?-.45:.4)*arch,0,.18*dir*arch)));
    const launch=name==='point_launch'||name==='sling_launch';
    if(launch)q.identity();
    return {pose,root:q,tuck,lean:TL.lerp(k[8],.85,tuck),
      pitch:name==='point_launch'?Math.PI*(1+TL.smooth(.08,.82,t))+.65*TL.smooth(.82,1,t):launch?TL.lerp(-.12,.85,TL.smooth(.4,1,t)):undefined,
      hips:name==='sling_launch'?-.56*(1-TL.smooth(0,.18,t)):0,
      weight:(launch?1:TL.smooth(0,.12,t))*(1-TL.smooth(.87,1.2,u))};
  }
};

