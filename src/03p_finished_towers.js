/* Water tanks belong on completed roofs. Construction courses may visit a nearby
   finished-roof opening, but never manufacture a tank on an unfinished floor. */
'use strict';
TL.FinishedTowers={
  point(t,p){const c=Math.cos(t.yaw),s=Math.sin(t.yaw);return new THREE.Vector3(t.x+p[0]*c+p[2]*s,t.y+p[1],t.z-p[0]*s+p[2]*c);},
  validate(world,t){
    const W=world.world,unfinished=new Set((world.constructionState?.sites||[]).map(s=>s.roofBid));
    if(unfinished.has(t.roofBid)||world.replaced?.has(t.roofBid)||!t.model?.legs||t.model.legs.length!==4)return false;
    for(const i of t.model.legs){const b=t.model.solids[i],p=this.point(t,[b.x,b.y-b.hy,b.z]);for(const [dx,dz]of[[0,0],[-.14,0],[.14,0],[0,-.14],[0,.14]]){
      const hit=W.raycast(p.x+dx,p.y+.3,p.z+dz,0,-1,0,.7,c=>c.solid&&!c.dynamic&&c.bid===t.roofBid,null,{noGround:true});
      if(!hit||hit.ny<.9||Math.abs(hit.y-p.y)>.12)return false;
    }}
    const cands=[];W.query(t.x-6,t.z-6,t.x+6,t.z+6,cands);
    for(const b of t.model.solids){const p=this.point(t,[b.x,b.y,b.z]),a={x:p.x,y:p.y,z:p.z,hx:b.hx,hy:b.hy,hz:b.hz,yaw:t.yaw};if(cands.some(c=>c.solid&&TL.Construction.overlap(a,c)))return false;}
    const gate=t.model.gate,center=this.point(t,gate.center),axis=this.point({...t,x:0,y:0,z:0},gate.axis);
    const right=new THREE.Vector3(axis.z,0,-axis.x);
    for(let d=-gate.length/2-10;d<=gate.length/2+10;d+=.3)for(const lateral of [-.8,0,.8]){const p=center.clone().addScaledVector(axis,d).addScaledVector(right,lateral);W.query(p.x-1,p.z-1,p.x+1,p.z+1,cands);if(TL.Contact.overlap(W,cands,p.x,p.y,p.z,TL.BodyShapes.stand,.02))return false;}
    return true;
  },
  geometry(asset,materials){
    if(asset.meshes)return asset.meshes.map(p=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p.position||p.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(p.normal||p.normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));g.computeBoundingSphere();return new THREE.Mesh(g,materials[p.mat]);});
    // Used by the source geometry tests before Blender export is available.
    return asset.model.parts.map(p=>{let g;if(p.shape==='box')g=new THREE.BoxGeometry(p.hx*2,p.hy*2,p.hz*2).translate(p.x,p.y,p.z);
      else if(p.shape==='beam'){const a=new THREE.Vector3(...p.a),b=new THREE.Vector3(...p.b),d=b.clone().sub(a);g=new THREE.CylinderGeometry(p.r,p.r,d.length(),6).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize())).translate(...a.add(b).multiplyScalar(.5).toArray());}
      else if(p.shape==='hoop')g=new THREE.TorusGeometry(p.radius,p.r,5,32).rotateX(Math.PI/2).translate(p.x,p.y,p.z);
      else g=new THREE.CylinderGeometry(p.shape==='cap'?0:p.radius,p.radius,p.height,24).translate(p.x,p.y,p.z);
      return new THREE.Mesh(g,materials[p.mat]);});
  },
  spawn(world,t,state){
    if(!this.validate(world,t))return null;
    const cols=t.model.solids.map(b=>{const p=this.point(t,[b.x,b.y,b.z]);return world.world.addStatic(p.x,p.y,p.z,b.hx,b.hy,b.hz,t.yaw,{kind:'building',src:'finished_tower',bid:t.roofBid,climb:true,anchor:true,perch:true,finishedTowerId:t.id});});
    const meshes=this.geometry(t,state.materials);for(const m of meshes){m.position.set(t.x,t.y,t.z);m.rotation.y=t.yaw;m.name='Finished roof tank '+t.roofBid;m.castShadow=m.receiveShadow=true;world.scene.add(m);state.meshes.push(m);}state.colliders.push(...cols);
    const G=t.model.gate,gate={id:t.id,type:'water_tower',roofBid:t.roofBid,center:this.point(t,G.center),axis:this.point({...t,x:0,y:0,z:0},G.axis),length:G.length,radius:G.radius,height:G.height,anchorsBySide:{},anchors:[]};
    for(const [key,sign]of[['positive',-1],['negative',1]])gate.anchorsBySide[key]=[0,1].map(i=>{const leg=(i===0?0:2)+(sign>0?1:0),col=cols[t.model.legs[leg]],b=t.model.solids[t.model.legs[leg]],p=this.point(t,[b.x,G.center[1],b.z+sign*b.hz]);return{x:p.x,y:p.y,z:p.z,col};});
    gate.anchors=gate.anchorsBySide.positive;(world.world.referenceGates||(world.world.referenceGates=[])).push(gate);state.gates.push(gate);return gate;
  },
  bind(world,site,gate){
    if(!gate)return false;
    const point={center:gate.center.clone(),axis:gate.axis.clone(),radius:Math.min(1.8,gate.radius||1.15),kind:'water_tower',length:gate.length,gate,label:'Finished roof tank'};
    if(TL.WorksiteRuns&&!TL.WorksiteRuns.checkpoint(world.world,point))return false;
    site.routePoints=site.routePoints.filter(p=>p.kind!=='water_tower');site.routePoints.splice(Math.max(0,site.routePoints.length-1),0,point);site.gates.push(gate);site.landmarks.tower=gate.center.clone();site.finishedTowerRoof=gate.roofBid??gate.anchors[0]?.col?.bid;return true;
  },
  build(world){
    if(world.finishedTowerState)return world.finishedTowerState;
    const asset=TL.Construction.finishedTowerAsset||{towers:[],siteLinks:[]},S=world.finishedTowerState={meshes:[],colliders:[],gates:[],skipped:[],materials:TL.Construction.materials()},byId=new Map();
    for(const t of asset.towers.slice(0,20)){const gate=this.spawn(world,t,S);if(gate)byId.set(t.id,gate);else S.skipped.push(t.id);}
    const sites=world.constructionState?.sites||[],unfinished=new Set(sites.map(s=>s.roofBid));
    for(const link of asset.siteLinks.slice(0,20)){const site=sites.find(s=>s.id===link.siteId);if(!site)continue;let gate=byId.get(link.towerId);
      if(!gate&&link.existingCenter)gate=(world.world.referenceGates||[]).find(g=>g.type==='water_tower'&&g.center.distanceTo(new THREE.Vector3(...link.existingCenter))<.2&&!unfinished.has(g.anchors[0]?.col?.bid));
      if(!this.bind(world,site,gate))S.skipped.push('route:'+link.siteId);
    }return S;
  },
  dispose(world){const S=world.finishedTowerState;if(!S)return;for(const m of S.meshes){world.scene.remove(m);m.geometry.dispose();}for(const c of S.colliders)world.world.removeStatic(c);world.world.referenceGates=(world.world.referenceGates||[]).filter(g=>!S.gates.includes(g));for(const m of Object.values(S.materials))m.dispose();world.finishedTowerState=null;}
};
if(TL.ScanHooks)TL.ScanHooks.build.push(w=>TL.FinishedTowers.build(w));
