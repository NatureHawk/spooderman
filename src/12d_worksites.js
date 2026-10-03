/* Construction routes adapt the site's real opening metadata to the existing route system.
   No extra input consumer, actor manager, or collision geometry is introduced here. */
'use strict';
TL.WorksiteRuns = {
  diagnostics: [],
  clear(world, p) {
    const cands = [];
    world.query(p.x - 1, p.z - 1, p.x + 1, p.z + 1, cands);
    return !TL.Contact.overlap(world, cands, p.x, p.y, p.z, TL.BodyShapes.stand, 0.02);
  },
  support(world, p) {
    for (const [x, z] of [[0,0],[-0.35,0],[0.35,0],[0,-0.35],[0,0.35]]) {
      const hit = world.raycast(p.x+x,p.y+0.3,p.z+z,0,-1,0,0.65,c=>c.solid&&!c.dynamic,null);
      if (!hit || hit.ny < 0.9 || Math.abs(hit.y-p.y) > 0.12) return false;
    }
    return true;
  },
  validateStart(world, s) {
    if (!s || ![s.x,s.y,s.z,s.yaw].every(Number.isFinite)) return false;
    const feet = new THREE.Vector3(s.x,s.y,s.z), body = feet.clone().add(new THREE.Vector3(0,TL.C.FEET+0.05,0));
    return this.support(world,feet) && this.clear(world,body);
  },
  checkpoint(world, p) {
    const c = p.center, axis = p.axis;
    if (!c || ![c.x,c.y,c.z,p.radius].every(Number.isFinite)) return null;
    const label = p.label || {frame:'Open floor',pipe:'Through the pipe',water_tower:'Between tower legs',crane:'Crane approach'}[p.kind] || 'Site checkpoint';
    if (p.kind === 'zone' || p.surface !== undefined) {
      const surface = Number.isFinite(p.surface) ? p.surface : c.y-TL.C.FEET;
      const feet = new THREE.Vector3(c.x,surface,c.z);
      if (!this.support(world,feet) || !this.clear(world,c)) return null;
      return {kind:'zone',x:c.x,y:c.y,z:c.z,r:TL.clamp(p.radius,1.3,3),surface,label,feature:p.feature||p.kind};
    }
    if (!axis || Math.hypot(axis.x,axis.z)<0.5 || Math.abs(axis.y||0)>0.2 || p.radius<1.1) return null;
    const n = new THREE.Vector3(axis.x,0,axis.z).normalize(), approach=TL.clamp(p.approach||Math.max(2.5,(p.length||0)/2+1),1.5,12);
    // Capsule sweep through the complete central lane, in both directions. A disc never promises
    // a passage through an intact floor, diagonal brace, pipe wall, or tower cross-member.
    const steps = Math.ceil(approach*2/0.35);
    for(let i=0;i<=steps;i++){
      const q = c.clone().addScaledVector(n,-approach+2*approach*i/steps);
      if(!this.clear(world,q))return null;
    }
    return {kind:'gate',x:c.x,y:c.y,z:c.z,r:TL.clamp(p.radius,1.1,5),n:[n.x,n.z],label,feature:p.kind,approach};
  },
  build(game) {
    this.diagnostics=[];
    const state=game.streamer&&game.streamer.constructionState||game.world&&game.world.constructionState;
    if(!game.scanMode||!state||!TL.Contact)return [];
    const defs=[];
    for(const site of (state.sites||[]).slice(0,20)){
      if(!this.validateStart(game.world,site.start)){this.diagnostics.push({id:site.id,reason:'blocked or unsupported start'});continue;}
      const points=(site.routePoints||[]).slice(0,5),cps=[];
      for(let k=0;k<points.length;k++){
        const c=this.checkpoint(game.world,points[k]);
        if(c)cps.push(c);else this.diagnostics.push({id:site.id,checkpoint:k,reason:'opening lane blocked or unsupported'});
      }
      if(cps.length<3){this.diagnostics.push({id:site.id,reason:'fewer than three clear checkpoint approaches'});continue;}
      let distance=0,last=new THREE.Vector3(site.start.x,site.start.y+TL.C.FEET,site.start.z),climb=0;
      for(const c of cps){const p=new THREE.Vector3(c.x,c.y,c.z);distance+=last.distanceTo(p);climb+=Math.max(0,p.y-last.y);last=p;}
      const gold=Math.max(18,Math.ceil(distance/8+climb/5+4));
      const id='worksite_'+String(site.id).replace(/[^a-z0-9_]/gi,'_').slice(0,35);
      if(defs.some(d=>d.id===id)){this.diagnostics.push({id:site.id,reason:'duplicate stable route id'});continue;}
      let hash=2166136261;const layout=[site.start.x,site.start.y,site.start.z,...cps.flatMap(c=>[c.x,c.y,c.z,c.r,...(c.n||[])])].map(v=>v.toFixed(2)).join(',');
      for(let k=0;k<layout.length;k++)hash=Math.imul(hash^layout.charCodeAt(k),16777619);
      defs.push({id,kind:'worksite',course:(hash>>>0).toString(16),siteId:site.id,name:site.name+' Run',
        blurb:'Follow the numbered openings: '+cps.map(c=>c.label.toLowerCase()).join(' → ')+'. Keep your flow; first completion earns 180 XP, replays chase your best.',
        start:{...site.start},cps,medals:{gold,silver:Math.ceil(gold*1.5),bronze:Math.ceil(gold*2.2)},reward:180});
    }
    return defs;
  }
};
