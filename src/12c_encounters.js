/* Traversal encounters. Rules use live colliders; render actors never move the player.
   One owned objective at a time, bounded searches, explicit cleanup, no save-format dependency. */
'use strict';
TL.ENCOUNTER_DEFS = [
  { id: 'rooftop', name: 'Rooftop courier chase', blurb: 'Reach a nearby roof, chase the courier, and press E within reach to intercept.' },
  { id: 'runaway', name: 'Runaway interception', blurb: 'Catch the moving car. Land on its roof and press E to brake, or hold a tensioned web on it.' },
  { id: 'rescue', name: 'Elevated rescue', blurb: 'Reach the stranded civilian, press E to carry them, then deliver them safely to the green marker.' }
];
TL.TraversalEncounters = class {
  constructor(game) {
    this.game = game; this.active = null; this.completed = {}; this.lastResult = null;
    this.defs = TL.ENCOUNTER_DEFS; this.discovery = null; this.discoveryT = 0; this.discoveryK = 0;
    this._cands = []; this._queue = false;
  }
  available() { return this.defs.slice(); }
  busy() {
    const g = this.game, m = g.missions;
    return !!(g.routes && g.routes.active || m && (m.active || m.crime || m.activeActivity));
  }
  serialize() { return { completed: Object.assign({}, this.completed) }; }
  deserialize(d) {
    this.cancel(true); this.completed = {};
    for (const def of this.defs) this.completed[def.id] = TL.clamp(Math.floor(Number(d && d.completed && d.completed[def.id]) || 0), 0, 9999);
  }
  // Full standing clearance, including live vehicles and rooftop furniture.
  clearAt(p, radius = 1) {
    const w = this.game.world;
    w.query(p.x - radius, p.z - radius, p.x + radius, p.z + radius, this._cands);
    return !TL.Contact.overlap(w, this._cands, p.x, p.y + TL.C.FEET + 0.05, p.z, TL.BodyShapes.stand, 0.02);
  }
  surface(x, z, from = 180) {
    const w = this.game.world;
    const hit = w.raycast(x, from, z, 0, -1, 0, from + 20, c => c.solid && !c.dynamic, null);
    if (!hit || hit.ny < 0.9 || w.waterFn && w.waterFn(x, z)) return null;
    const p = new THREE.Vector3(hit.x, hit.y, hit.z);
    if (!this.clearAt(p)) return null;
    return { p, col: hit.col, id: hit.col && hit.col.id };
  }
  roofPlan(type) {
    const h = this.game.hero.ctrl, w = this.game.world, candidates = [];
    w.query(h.pos.x - 220, h.pos.z - 220, h.pos.x + 220, h.pos.z + 220, candidates);
    const roofs = candidates.filter(c => c.solid && !c.dynamic && c.walkTop && c.climb && c.hx > 9 && c.hz > 9 && c.top > 9 && c.top < 145)
      .sort((a,b) => Math.hypot(a.cx-h.pos.x,a.cz-h.pos.z) - Math.hypot(b.cx-h.pos.x,b.cz-h.pos.z)).slice(0,24);
    for (const col of roofs) {
      const rx = Math.min(col.hx - 3, 22), rz = Math.min(col.hz - 3, 22);
      const path = [[-rx,-rz], [rx,-rz], [rx,rz], [-rx,rz], [-rx,-rz]].map(([x,z]) => col.toWorld(x, col.hy + 0.03, z, new THREE.Vector3()));
      let valid = true;
      for (let k = 0; k < path.length - 1 && valid; k++) {
        const count = Math.ceil(path[k].distanceTo(path[k+1]) / 2);
        for (let i = 0; i <= count; i++) {
          const p = new THREE.Vector3().lerpVectors(path[k], path[k+1], i / count), s = this.surface(p.x,p.z,col.top+3);
          if (!s || s.col !== col || Math.abs(s.p.y-col.top) > 0.1) { valid = false; break; }
        }
      }
      if (!valid) continue;
      // Start nearest the hero, then leave a real running approach around the roof perimeter.
      const corners = path.slice(0,4), start = corners.reduce((a,p,i) => p.distanceTo(h.pos)<corners[a].distanceTo(h.pos)?i:a,0);
      const ordered = [0,1,2,3,4].map(i => corners[(start+i)%4].clone());
      const plan = { type, col, colId: col.id, path: ordered, target: ordered[0].clone() };
      if (type === 'rescue') {
        const safe = this.safeBelow(plan.target, col.top);
        if (!safe) continue; plan.safe = safe.p; plan.safeCol = safe.col; plan.safeId = safe.id;
      }
      return plan;
    }
    return null;
  }
  safeBelow(origin, roofY) {
    for (const d of [28, 48, 72, 96]) for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6, s = this.surface(origin.x + Math.cos(a)*d, origin.z + Math.sin(a)*d, roofY + 2);
      if (!s || s.p.y > roofY - 7) continue;
      // A standing zone needs support under its entire footprint, not just the centre ray.
      if ([[-1.5,0],[1.5,0],[0,-1.5],[0,1.5]].every(([x,z]) => { const q=this.surface(s.p.x+x,s.p.z+z,s.p.y+2); return q && Math.abs(q.p.y-s.p.y)<0.15; })) return s;
    }
    return null;
  }
  marker(p, color) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1.7,0.07,6,28),new THREE.MeshBasicMaterial({color, transparent:true,opacity:0.7,depthWrite:false}));
    mesh.rotation.x = Math.PI/2; mesh.position.copy(p); mesh.position.y += 0.12; this.game.scene.add(mesh); return mesh;
  }
  removeMarker(m) { if (!m) return; this.game.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  clearDiscovery() { if(this.discovery) this.removeMarker(this.discovery.marker); this.discovery=null; }
  start(type) {
    if (this.active || this.busy()) { this.game.ui.hint('Finish or cancel your current objective first.'); return false; }
    const def=this.defs.find(d=>d.id===type); if(!def)return false;
    const g=this.game, plan=type==='runaway'?{type}:this.roofPlan(type);
    if(!plan){g.ui.hint('No clear nearby roof for this encounter. Move toward a larger building and retry.');return false;}
    const a={...plan,def,type,phase:type==='rooftop'?'approach':type==='rescue'?'pickup':'intercept',t:0,limit:type==='rescue'?150:110,rewarded:false,travel:0,prev:g.hero.ctrl.pos.clone()};
    if(type==='runaway') {
      const v=g.traffic.spawnRunaway('car',g.hero.ctrl.pos,true);
      // Traffic's fallback object means no free lane. Never interpret it as a completed encounter.
      if(!v || !v.active || !v.col || !v.seg){g.ui.hint('No free traffic lane nearby. Try again near an avenue.');return false;}
      if(!this.clearVehicle(v)){g.traffic.despawn(v);g.ui.hint('The nearby lane is obstructed. Move to another street.');return false;}
      a.veh=v; a.target=v.pos; a.engaged=false; a.braking=false;
    } else if(type==='rescue') {
      a.victim=g.crowd.spawnVictim(a.target); a.safeMarker=this.marker(a.safe,0x74f0a6);
    } else {
      a.target=a.path[0].clone(); a.pathK=1; a.actor=this.courier(a.target);
    }
    // Ambient incidents have no cancel UI; an explicit, successfully validated response owns the objective.
    if(g.cityLife&&g.cityLife.incident)g.cityLife.cleanupIncident('abandoned');
    this.clearDiscovery(); this._queue=false; this.active=a; a.marker=this.marker(a.target,0xffcf66);
    g.ui.setWaypoint(a.target);g.ui.toast(def.name);g.audio.sfx('alert');
    if(g.missions&&g.missions.pushFeed)g.missions.pushFeed('Traversal encounter: '+def.name,'activity');
    return true;
  }
  clearVehicle(v) {
    const w=this.game.world, c=v.col, list=[]; w.query(c.cx-c.rxz-1,c.cz-c.rxz-1,c.cx+c.rxz+1,c.cz+c.rxz+1,list);
    return !list.some(o=>o!==c&&o.solid&&TL.Contact.sphereIn(o,c.cx,c.cy,c.cz,Math.min(c.hx,c.hy)*0.9));
  }
  courier(p) {
    const mat=TL.Assets.material({slots:{6:0xc69a79,7:0xf0b44a,2:0x24354d}}),sk=TL.Assets.skinned('PED_m','mid',mat);
    if(sk)this.game.scene.add(sk.mesh);
    return {sk,mat,anim:sk?new TL.NPCAnimator(sk):null,pos:p.clone(),yaw:0};
  }
  canInteract() {
    const h=this.game.hero.ctrl,a=this.active;
    if(!a)return !this.busy()&&!!this.discovery&&h.pos.distanceTo(this.discovery.plan.target)<4.5;
    if(a.type==='runaway')return !!a.veh.active&&h.grounded&&h.groundCol===a.veh.col&&!a.braking;
    if(a.type==='rooftop')return a.phase==='chase'&&h.pos.distanceTo(a.target)<3.2&&h.vel.length()>2&&a.travel>7;
    if(a.phase==='pickup')return h.pos.distanceTo(a.target)<3.1&&(h.grounded||h.state===TL.TS.PERCH);
    return a.phase==='carry'&&h.pos.distanceTo(a.safe)<4&&(h.grounded||h.state===TL.TS.PERCH)&&h.vel.length()<7&&a.travel>12;
  }
  interact() { if(this.canInteract()){this._queue=true;return true;}return false; }
  takeInteraction() {const yes=this._queue||(this.game.input&&this.game.input.consume('interact'));this._queue=false;return yes;}
  update(dt) {
    if(!this.game.hero || !(dt>0))return;
    const g=this.game,h=g.hero.ctrl;
    if(!this.active){
      if(this.busy()||g.cityLife&&g.cityLife.incident){this.clearDiscovery();return;}
      this.discoveryT-=dt;
      if(this.discoveryT<=0){
        this.discoveryT=12;this.clearDiscovery();
        const type=this.discoveryK++%2?'rescue':'rooftop',plan=this.roofPlan(type);
        if(plan){this.discovery={plan,marker:this.marker(plan.target,0xffcf66)};}
      }
      if(this.canInteract()){g.ui.prompt('[E] '+this.defs.find(d=>d.id===this.discovery.plan.type).name);if(this.takeInteraction())this.start(this.discovery.plan.type);}
      return;
    }
    const a=this.active;a.t+=dt;
    if(!this.canInteract())this._queue=false;
    if(this.busy()){this.finish(false,'Another objective started',true);return;}
    if(a.col&&(a.col.id!==a.colId||!a.col.cells)||a.safeCol&&(a.safeCol.id!==a.safeId||!a.safeCol.cells)){this.finish(false,'The objective area unloaded');return;}
    const move=h.pos.distanceTo(a.prev);if(move<Math.max(4,h.vel.length()*dt*2+1))a.travel+=move;a.prev.copy(h.pos);
    if(a.t>a.limit||h.health<=1||h.pos.distanceTo(a.target)>600){this.finish(false,a.t>a.limit?'Time expired':'Lost the encounter');return;}
    if(a.type==='rooftop')this.updateChase(a,dt);
    else if(a.type==='runaway')this.updateRunaway(a,dt);
    else this.updateRescue(a,dt);
    if(this.active!==a)return;
    a.marker.position.set(a.target.x,a.target.y+0.15,a.target.z);
    g.ui.setWaypoint(a.phase==='carry'?a.safe:a.target);
  }
  updateChase(a,dt) {
    const g=this.game,h=g.hero.ctrl;
    if(a.phase==='approach'&&h.pos.distanceTo(a.target)<21&&Math.abs(h.pos.y-a.target.y)<5){a.phase='chase';a.limit=a.t+36;}
    if(a.phase==='chase'){
      const goal=a.path[a.pathK],d=goal.clone().sub(a.target),L=d.length(),step=Math.min(L,4.6*dt);
      if(L>0.001){a.target.addScaledVector(d,step/L);a.actor.yaw=Math.atan2(d.x,d.z);}
      if(L<=step+0.01){a.pathK++;if(a.pathK>=a.path.length){this.finish(false,'The courier escaped');return;}}
    }
    if(a.actor.anim)a.actor.anim.update(dt,a.target,a.actor.yaw,a.phase==='chase'?4.6:0,a.phase==='chase'?'run':'idle');
    g.ui.setObjective(a.phase==='approach'?'Reach the rooftop courier · '+Math.ceil(a.limit-a.t)+'s':'Chase the courier · [E] intercept within reach · '+Math.ceil(a.limit-a.t)+'s');
    if(this.canInteract()){g.ui.prompt('[E] Intercept courier');if(this.takeInteraction())this.finish(true,'Courier intercepted');}
  }
  updateRunaway(a,dt) {
    const g=this.game,h=g.hero.ctrl,v=a.veh;
    if(!v.active||v.crashed){this.finish(false,'Vehicle lost');return;}
    if(h.tether.ropes.some(r=>r.active&&r.attached&&r.col===v.col&&r.tension>1))a.engaged=true;
    if(this.canInteract()){g.ui.prompt('[E] Brace and brake the vehicle');if(this.takeInteraction()){a.braking=true;a.engaged=true;}}
    if(a.braking){
      if(h.grounded&&h.groundCol===v.col)v.brake+=dt*11;
      else a.braking=false;
    }
    g.ui.setObjective('Runaway · '+Math.round(v.speed*3.6)+' km/h · '+(a.braking?'Stay on the roof to brake':'Land on its roof + [E], or tether and hold')+' · '+Math.ceil(a.limit-a.t)+'s');
    if(v.stopped&&a.engaged)this.finish(true,'Runaway stopped');
  }
  updateRescue(a,dt) {
    const g=this.game,h=g.hero.ctrl,v=a.victim;
    if(v.hurt){this.finish(false,'Civilian injured');return;}
    if(a.phase==='pickup'){
      g.ui.setObjective('Reach the stranded civilian · [E] pick up · '+Math.ceil(a.limit-a.t)+'s');
      if(this.canInteract()){g.ui.prompt('[E] Pick up civilian');if(this.takeInteraction()){a.phase='carry';a.travel=0;v.carried=true;g.audio.sfx('ui');}}
    }else{
      v.pos.copy(h.pos);v.pos.y+=0.25;
      g.ui.setObjective('Carry the civilian to GREEN · land, slow down, [E] deliver · '+Math.ceil(a.limit-a.t)+'s');
      if(this.canInteract()){g.ui.prompt('[E] Deliver civilian safely');if(this.takeInteraction()){v.carried=false;g.crowd.victimSaved(v,a.safe);this.finish(true,'Civilian delivered');}}
    }
  }
  finish(success,reason,silent=false) {
    const a=this.active;if(!a)return false;
    this.active=null;this._queue=false;this.lastResult={type:a.type,success,reason,time:a.t};this.discoveryT=20;
    const g=this.game;
    this.removeMarker(a.marker);this.removeMarker(a.safeMarker);
    if(a.actor){if(a.actor.sk){g.scene.remove(a.actor.sk.mesh);if(a.actor.sk.mesh.skeleton&&a.actor.sk.mesh.skeleton.boneTexture)a.actor.sk.mesh.skeleton.boneTexture.dispose();}for(const m of [].concat(a.actor.mat||[]))m.dispose();}
    if(a.victim){
      const v=a.victim;g.crowd.removeVictim(v);if(v.beacon){v.beacon.geometry.dispose();v.beacon.material.dispose();}
      if(v.sk){if(!v.sk.mesh.geometry.userData.tex)for(const m of [].concat(v.sk.mesh.material||[]))m.dispose();if(v.sk.mesh.skeleton&&v.sk.mesh.skeleton.boneTexture)v.sk.mesh.skeleton.boneTexture.dispose();}
    }
    if(a.veh&&a.veh.active){const h=g.hero.ctrl;for(const r of h.tether.ropes)if(r.col===a.veh.col){if(r===h.tether.main&&r.kind==='swing'&&r.active)h.releaseSwing(false);else r.release();}g.traffic.despawn(a.veh);}
    g.ui.setWaypoint(null);g.ui.setObjective('');
    if(success&&!a.rewarded){a.rewarded=true;this.completed[a.type]=(this.completed[a.type]||0)+1;g.progress.addXP(180,a.def.name);g.audio.sfx('reward');if(g.save)g.save.save(true);}
    else if(!silent)g.audio.sfx('fail');
    if(!silent)g.ui.toast((success?'Complete: ':'Encounter ended: ')+reason+' · retry from CITYLINK');
    return true;
  }
  cancel(silent=false) {this.clearDiscovery();return this.finish(false,'Cancelled',silent);}
  retry() {const type=this.active?this.active.type:this.lastResult&&this.lastResult.type;if(!type)return false;this.cancel(true);return this.start(type);}
  dispose() {this.cancel(true);}
};
