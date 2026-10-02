/* Authored from video/traversal_reference (5Nob1JXTww0). Model-space
   hip/knee/arm curves; these poses never move the physical body. */
'use strict';
TL.ReferenceMotion={
  // hip L, knee L, hip R, knee R, leg spread, arm spread, arm angle,
  // elbow bend, torso lean, root pitch.
  clips:{
    pass_through:{stops:[0,.16,.4,.8,1],keys:[
      [1.1,1.9,.8,1.5,.05,.25,2.5,.15,.3,.6],
      [1.3,2.1,1.3,2.1,.04,.15,.7,1.5,.4,1.5],
      [1.2,2.0,1.2,2.0,.04,.12,.5,1.7,.45,1.5],
      [1.2,2.0,1.2,2.0,.04,.12,.5,1.7,.45,1.5],
      [.5,.7,-.25,.6,.15,.8,1.7,.25,0,.9]]},
    water_jump:{stops:[0,.2,.45,.72,1],keys:[
      [1.2,2.0,.65,1.5,.25,.8,1.8,.3,.25,.2],
      [.25,.45,-.35,.7,.16,.85,1.6,.2,.05,.3],
      [.75,1.3,-.25,.6,.2,.7,1.9,.3,-.05,.5],
      [.55,.8,-.3,.65,.2,.8,1.8,.3,0,.7],
      [.5,.7,-.25,.6,.2,.8,1.7,.25,0,.75]]},
    wing_close:{stops:[0,.2,.5,.8,1],keys:[
      [-.1,.3,-.1,.3,.1,1,1.6,.12,0,1.35],
      [.4,.8,.1,.6,.15,.6,1.2,.6,.12,1.2],
      [.7,1.2,.35,.8,.17,.25,.5,1.3,.25,1.0],
      [.55,.8,-.2,.6,.2,.65,1.5,.4,.1,.9],
      [.5,.7,-.25,.6,.2,.8,1.7,.25,0,.8]]},
    air_zip:{stops:[0,.16,.38,.65,1],keys:[
      [.8,1.6,.35,.7,.12,.45,2.45,.1,.08,.3],
      [1.15,1.8,.55,1.1,.18,.45,2.4,.18,.1,.5],
      [.7,1.2,-.2,.6,.15,.18,.5,1.45,.08,1.15],
      [.2,.55,-.45,.7,.2,.65,1.4,.4,-.06,1.05],
      [.5,.7,-.25,.6,.2,.8,1.7,.25,0,.75]]},
    spider_jump:{stops:[0,.2,.42,.7,1],keys:[
      [1.6,2.2,1.4,2.1,.18,.25,.4,1.2,.5,.25],
      [1.8,2.4,1.6,2.3,.18,.2,.3,1.5,.65,.25],
      [.15,.4,-.2,.5,.1,.7,2.7,.18,-.1,-.12],
      [.5,.8,-.3,.65,.2,.9,2.2,.3,-.1,.3],
      [.6,.8,-.25,.65,.2,.7,1.8,.3,0,.65]]},
    spider_dash:{stops:[0,.2,.42,.76,1],keys:[
      [1.4,2.1,1.15,1.9,.12,.4,2.2,.5,.4,.3],
      [1.8,2.4,1.4,2.1,.12,.25,1.9,1.2,.55,.6],
      [-.1,.25,-.2,.4,.06,.12,.05,.15,-.1,1.45],
      [.15,.5,-.25,.7,.15,.5,.6,.4,0,1.35],
      [.5,.7,-.35,.65,.2,.8,1.7,.3,0,.9]]},
    wing_dodge:{stops:[0,.2,.55,.8,1],keys:[
      [.15,.35,-.1,.3,.1,1,1.6,.12,0,1.4],
      [.9,1.5,.45,.9,.13,.3,.8,1.1,.25,1.4],
      [.8,1.4,.2,.7,.14,.25,.9,1.05,.25,1.4],
      [.15,.4,-.1,.35,.1,.8,1.5,.15,0,1.4],
      [-.1,.25,-.1,.25,.08,1,1.6,.1,0,1.4]]}
  },
  sample(h){
    const a=h.reference?.action;
    if(a?.kind==='corner_tether'){
      const t=a.t/a.duration,w=TL.smooth(0,.15,t)*(1-TL.smooth(.6,1,t)),pose={};
      for(const [side,s]of [['L',1],['R',-1]]){const inside=s===-a.dir,hip=inside?1.25:.1,knee=inside?1.8:.65;pose['thigh'+side]=TL.dirv(s*.25,-Math.cos(hip),Math.sin(hip));pose['shin'+side]=TL.dirv(s*.08,-Math.cos(hip-knee),Math.sin(hip-knee));}
      return{pose,weight:w*.7,keepRoot:true,kind:a.kind};
    }
    const c=a&&this.clips[a.kind];if(!c)return null;
    const t=TL.clamp(a.t/a.duration,0,1);let i=0;while(i<c.stops.length-2&&t>c.stops[i+1])i++;
    const f=TL.smooth(c.stops[i],c.stops[i+1],t),k=c.keys[i].map((v,j)=>TL.lerp(v,c.keys[i+1][j],f)),pose={};
    for(const [side,s,o]of [['L',1,a.dir>0?0:2],['R',-1,a.dir>0?2:0]]){
      const hip=k[o],knee=k[o+1];
      pose['thigh'+side]=TL.dirv(s*k[4],-Math.cos(hip),Math.sin(hip));
      pose['shin'+side]=TL.dirv(s*.035,-Math.cos(hip-knee),Math.sin(hip-knee));
      pose['foot'+side]=TL.dirv(s*.025,-.65,.6);
      pose['uarm'+side]=TL.dirv(s*k[5],-Math.cos(k[6]),Math.sin(k[6]));
      pose['farm'+side]=TL.dirv(s*k[5]*.4,-Math.cos(k[6]+k[7]),Math.sin(k[6]+k[7]));
    }
    pose.spine=TL.dirv(0,1,k[8]*.6);pose.chest=TL.dirv(0,1,k[8]);
    return{pose,pitch:k[9],roll:a.kind==='wing_dodge'?a.dir*Math.PI*2*TL.smooth(.06,.9,t):0,
      weight:TL.smooth(0,.08,t)*(1-TL.smooth(.83,1,t)),kind:a.kind};
  }
};
TL.ReferenceMotion.grip=function(an,h,p){
  const a=h.reference?.action;if(!a||!p||!['air_zip','pass_through'].includes(a.kind))return;
  const ropes=h.tether.ropes.filter(r=>r.active&&r.kind==='airzip');if(!ropes.length)return;
  const rig=an.rig,inv=an.rootQ.clone().invert(),pull=TL.smooth(.09,.3,a.t),w=p.weight;
  for(const n of rig.order)rig.target[n].copy(rig.cur[n]);rig.hipsOffT.copy(rig.hipsOff);rig.hipsQT.copy(rig.hipsQ);
  for(const rope of ropes){
    const s=rope.hand,sg=s==='L'?1:-1,root=rig.P['uarm'+s],reach=rig.upperArm+rig.foreArm;
    const direction=rope.anchor.clone().sub(an.meshPos).applyQuaternion(inv).sub(root).normalize();
    const target=root.clone().addScaledVector(direction,reach*.97).lerp(root.clone().add(new THREE.Vector3(sg*.08,-.35,.22)),pull);
    const upper=new THREE.Vector3(),lower=new THREE.Vector3();rig.ik2(root,target,rig.upperArm,rig.foreArm,TL.dirv(sg*.7,-.7,-.3),upper,lower);
    rig.set('uarm'+s,rig.cur['uarm'+s].clone().lerp(upper,w).normalize());rig.set('farm'+s,rig.cur['farm'+s].clone().lerp(lower,w).normalize());rig.set('hand'+s,lower);
  }rig.apply(0);
};
// 0:02.6–0:05.8: crouch, elbows beside ribs, rapid leg extension.
// Slingshot does NOT reuse the inverted point-launch handspring.
Object.assign(TL.AerialClips.sling_launch,{duration:.78,stops:[0,.16,.38,.7,1],keys:[
  [1.5,2.6,1.45,2.5,.23,.22,.6,1.35,.35],
  [.25,.45,.2,.4,.08,.12,.2,.3,.08],
  [-.08,.22,-.15,.3,.06,.14,.15,.15,-.12],
  [.2,.5,-.3,.6,.15,.6,1.3,.3,-.08],
  [.5,.7,-.3,.65,.18,.9,1.85,.3,-.08]
]});
TL.AerialClips.pole_vault={name:'pole_vault',duration:.8,turn:[0,0,0],stops:[0,.2,.5,.78,1],keys:[
  [1.5,2.4,1.2,2.1,.15,.15,2.8,.25,.4],
  [.35,.55,.2,.5,.1,.2,2.6,.15,-.1],
  [1.2,1.6,.5,1.1,.18,.8,2.0,.25,.1],
  [.65,1.1,-.25,.65,.2,1,1.9,.15,-.1],
  [.5,.7,-.3,.65,.18,.85,1.95,.3,-.08]
]};
TL.AerialClips.quick_recovery={name:'quick_recovery',duration:.66,turn:[1,0,0],stops:[0,.22,.55,.8,1],keys:[
  [1.6,2.4,1.6,2.4,.15,.2,.7,1.3,.6],
  [2.2,2.6,2.2,2.6,.1,.2,.4,1.8,.8],
  [2.2,2.6,2.2,2.6,.1,.2,.4,1.8,.8],
  [.65,1.1,.3,.8,.2,.8,1.7,.35,.12],
  [.5,.7,-.25,.65,.18,.8,1.8,.3,0]
]};
// 6:51–6:53: outward sweep and folded legs, then trail as the wing loads.
const referenceGlideBase=TL.glidePose;
TL.glidePose=function(an,h,put,D,flut){
  const result=referenceGlideBase(an,h,put,D,flut),g=h.glide,t=g.t;
  const open=TL.smooth(.04,.38,t),settle=TL.smooth(.25,.7,t),wind=h.wind?h.wind.sample(h.pos,new THREE.Vector3()):new THREE.Vector3();
  const lift=TL.clamp((wind.y-4)/18,0,1);
  for(const [side,s]of [['L',1],['R',-1]]){
    if(t<.7){
      const bank=g.roll*s*.25;
      put('uarm'+side,D(s*TL.lerp(.28,1,open),TL.lerp(.65,.04+bank,open),TL.lerp(.55,-.13,open)));
      put('farm'+side,D(s*TL.lerp(.12,1,open),TL.lerp(.75,.02+bank*.7,open),TL.lerp(.55,-.2,open)));
      const hip=TL.lerp(.9,-.1,settle),knee=TL.lerp(1.7,.22,settle);
      put('thigh'+side,D(s*.1,-Math.cos(hip),Math.sin(hip)));
      put('shin'+side,D(s*.03,-Math.cos(hip-knee),Math.sin(hip-knee)));
    }
    if(lift>.1){put('thigh'+side,D(s*.13,-1,.08));put('shin'+side,D(s*.035,-1,-.35-lift*.3));}
  }
  result.headBack=TL.lerp(.1,.35,settle);return result;
};
