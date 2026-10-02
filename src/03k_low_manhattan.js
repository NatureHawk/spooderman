/* Quality-scaled, predictive Manhattan render chunks. Never changes physics.
   Only Low substitutes character meshes; all presets keep original facades.
   All temporary visibility/material/geometry/fog changes are restored after rendering. */
'use strict';
TL.LowManhattan = {
  budgets:{low:{range:280,detail:150,seconds:1.5,lead:160,warm:1},medium:{range:480,detail:300,seconds:2,lead:240,warm:1},high:{range:640,detail:460,seconds:2.5,lead:320,warm:2},ultra:{range:900,detail:700,seconds:3,lead:420,warm:2}},
  policy(quality,requested,velocity){
    const b=this.budgets[quality]||this.budgets.high,lead=velocity.clone().multiplyScalar(b.seconds);
    lead.clampLength(0,b.lead);
    return {...b,maxLead:b.lead,range:Math.min(b.range,Math.max(160,requested||b.range)),lead};
  },
  // Distance to a swept camera position (capsule): fast travel expands only
  // toward velocity, while the base radius still covers sudden camera turns.
  distance(sphere,origin,lead){
    const delta=sphere.center.clone().sub(origin),n=lead.lengthSq();
    if(n>1e-6)delta.addScaledVector(lead,-TL.clamp(delta.dot(lead)/n,0,1));
    return Math.max(0,delta.length()-sphere.radius);
  },
  variant(w,m){return [!!m.isInstancedMesh,!!m.receiveShadow,!!w.game.renderer.shadowMap.enabled].join(':');},
  readyFor(w,L,m){
    const geo=m.geometry,key=this.variant(w,m),materials=[].concat(m.material);
    return (!geo.index||L.ready.has(geo.index))&&Object.values(geo.attributes).every(a=>L.ready.has(a))&&materials.every(mat=>L.materialReady.get(mat)?.has(key+':'+mat.version));
  },
  noteReady(w,L,m){
    if(m.geometry.index)L.ready.add(m.geometry.index);for(const a of Object.values(m.geometry.attributes))L.ready.add(a);
    const key=this.variant(w,m);for(const mat of [].concat(m.material)){let keys=L.materialReady.get(mat);if(!keys)L.materialReady.set(mat,keys=new Set());keys.add(key+':'+mat.version);}
  },
  prepare(w,velocity,dt){
    const g=w.game;if(!g.scanMode||!g.hero||!g.renderer)return;
    const L=w.lowRender||(w.lowRender=this.build(w)),camera=g.camera;
    const p=this.policy(g.quality,g.settings.renderDist,velocity);
    // Extend immediately when accelerating; ease back so nearby ready chunks
    // are not dropped during a brake, release or direction reversal.
    if(p.lead.lengthSq()>L.lead.lengthSq())L.lead.copy(p.lead);
    else L.lead.lerp(p.lead,1-Math.exp(-Math.max(0,dt)*3));
    L.policy=p;L.preparedThisFrame=0;
    L.scanT=(L.scanT||0)+Math.max(0,dt);
    if(!L.queue||L.scanT>=.15||L.queueQuality!==g.quality||L.queueRange!==p.range||L.queueOrigin.distanceToSquared(camera.position)>900||L.queueLead.distanceToSquared(L.lead)>1600){
      const candidates=[],destination=camera.position.clone().add(L.lead);
      for(const m of L.warmMeshes){
        if(this.readyFor(w,L,m))continue;
        const s=L.sphere.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
        const d=this.distance(s,camera.position,L.lead);
        if(d<p.range+100)candidates.push({m,score:s.center.distanceToSquared(destination)});
      }
      candidates.sort((a,b)=>a.score-b.score);L.queue=candidates;L.queueIndex=0;L.scanT=0;
      L.queueQuality=g.quality;L.queueRange=p.range;L.queueOrigin=camera.position.clone();L.queueLead=L.lead.clone();
    }
    const start=performance.now();
    while(L.queueIndex<L.queue.length){
      const {m}=L.queue[L.queueIndex++];
      if(this.readyFor(w,L,m))continue;
      this.warm(w,L,m);L.preparedThisFrame++;
      if(L.preparedThisFrame>=p.warm||performance.now()-start>1.5)break;
    }
    L.pending=L.queue.length-L.queueIndex;
  },
  warm(w,L,m){
    const r=w.game.renderer;
    if(!L.warmScene){
      L.warmScene=new THREE.Scene();L.warmCamera=new THREE.PerspectiveCamera(60,1,.1,2);
      L.warmLights=[];
      for(const source of w.scene.children)if(source.isLight){const light=source.clone();if(source.shadow)light.shadow=source.shadow;L.warmScene.add(light);L.warmLights.push([source,light]);}
    }
    const scene=L.warmScene;scene.environment=w.scene.environment;scene.fog=w.scene.fog;
    for(const [source,light]of L.warmLights){light.color.copy(source.color);light.intensity=source.intensity;light.position.copy(source.position);if(light.groundColor)light.groundColor.copy(source.groundColor);light.castShadow=source.castShadow;}
    const mesh=m.isInstancedMesh?new THREE.InstancedMesh(m.geometry,m.material,0):new THREE.Mesh(m.geometry,m.material);
    if(m.isInstancedMesh){mesh.instanceMatrix=m.instanceMatrix;mesh.instanceColor=m.instanceColor;mesh.count=m.count;}
    mesh.frustumCulled=false;mesh.receiveShadow=m.receiveShadow;mesh.matrixAutoUpdate=false;mesh.matrix.copy(m.matrixWorld);scene.add(mesh);
    const viewport=r.getViewport(new THREE.Vector4()),scissor=r.getScissor(new THREE.Vector4()),scissorTest=r.getScissorTest(),target=r.getRenderTarget(),auto=r.shadowMap.autoUpdate,shadowDirty=r.shadowMap.needsUpdate,clear=r.autoClear;
    try{
      // Same framebuffer encoding and lights as the real pass, but a one-pixel
      // scissor. This uploads geometry/textures and warms the real shader variant
      // before the chunk is visible. The normal game render follows immediately.
      r.shadowMap.autoUpdate=false;r.shadowMap.needsUpdate=false;r.autoClear=false;r.setRenderTarget(null);r.setScissor(0,0,1,1);r.setScissorTest(true);
      r.render(scene,L.warmCamera);this.noteReady(w,L,m);
    }finally{
      // Do not dispose an instanced proxy: its GPU attributes belong to the
      // real chunk and must remain resident after warming.
      scene.remove(mesh);
      r.setRenderTarget(target);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(scissorTest);r.shadowMap.autoUpdate=auto;r.shadowMap.needsUpdate=shadowDirty;r.autoClear=clear;
    }
  },
  skinCache:new WeakMap(),
  instanceCache:new WeakMap(),
  trimInstances(mesh,camera,range,change){
    const source=mesh.instanceMatrix,count=mesh.count;if(!count)return;
    let cache=this.instanceCache.get(mesh);
    if(!cache||cache.matrix.array.length<source.array.length){cache={matrix:new THREE.InstancedBufferAttribute(new Float32Array(source.array.length),16),color:mesh.instanceColor?new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceColor.array.length),3):null};this.instanceCache.set(mesh,cache);}
    if(cache.source===source&&cache.version===source.version&&cache.count===count&&cache.range===range&&cache.pos.distanceToSquared(camera.position)<.25){
      if(cache.n!==count){change(mesh,'instanceMatrix',cache.matrix);change(mesh,'count',cache.n);if(cache.color&&mesh.instanceColor)change(mesh,'instanceColor',cache.color);}return;
    }
    cache.source=source;cache.version=source.version;cache.count=count;cache.range=range;(cache.pos||(cache.pos=new THREE.Vector3())).copy(camera.position);
    const p=new THREE.Vector3(),a=source.array,dst=cache.matrix.array;let n=0;
    for(let i=0;i<count;i++){
      p.set(a[i*16+12],a[i*16+13],a[i*16+14]).applyMatrix4(mesh.matrixWorld);
      // Keep a margin for tree crowns / long props. Existing frustum culling
      // handles visibility; this removes instances beyond the Low detail range.
      if(p.distanceToSquared(camera.position)>(range+35)*(range+35))continue;
      dst.set(a.subarray(i*16,i*16+16),n*16);
      if(cache.color&&mesh.instanceColor)cache.color.array.set(mesh.instanceColor.array.subarray(i*3,i*3+3),n*3);
      n++;
    }
    cache.n=n;if(n===count)return;
    cache.matrix.needsUpdate=true;change(mesh,'instanceMatrix',cache.matrix);change(mesh,'count',n);
    if(cache.color&&mesh.instanceColor){cache.color.needsUpdate=true;change(mesh,'instanceColor',cache.color);}
  },
  // Small spatial clusters retain UV seams and bone influences. The original
  // skeleton, skin indices and animation state are never replaced.
  skinGeometry(g){
    if(this.skinCache.has(g))return this.skinCache.get(g);
    if(!g.index){this.skinCache.set(g,g);return g;}
    const attrs=g.attributes,p=attrs.position,uv=attrs.uv,si=attrs.skinIndex,sw=attrs.skinWeight;
    const clusters=new Map(),members=[],remap=new Uint32Array(p.count);
    for(let i=0;i<p.count;i++){
      const key=[Math.round(p.getX(i)/.022),Math.round(p.getY(i)/.022),Math.round(p.getZ(i)/.022),
        ...(uv?[Math.round(uv.getX(i)*32),Math.round(uv.getY(i)*32)]:[]),
        ...(si?Array.from({length:4},(_,j)=>si.array[i*4+j]):[]),...(sw?Array.from({length:4},(_,j)=>Math.round(sw.array[i*4+j]*4)):[]),
        ...(!si&&attrs.normal?[Math.round(attrs.normal.getX(i)*3),Math.round(attrs.normal.getY(i)*3),Math.round(attrs.normal.getZ(i)*3)]:[]),
        attrs.aSlot?attrs.aSlot.getX(i):0].join(',');
      let id=clusters.get(key);if(id===undefined){id=members.length;clusters.set(key,id);members.push([]);}members[id].push(i);remap[i]=id;
    }
    const out=new THREE.BufferGeometry();
    for(const [name,a]of Object.entries(attrs)){
      const data=new a.array.constructor(members.length*a.itemSize);
      for(let i=0;i<members.length;i++)for(let k=0;k<a.itemSize;k++){
        let value=0;if(name==='skinIndex'||name==='aSlot')value=a.array[members[i][0]*a.itemSize+k];
        else {for(const j of members[i])value+=a.array[j*a.itemSize+k];value/=members[i].length;}
        data[i*a.itemSize+k]=value;
      }
      out.setAttribute(name,new THREE.BufferAttribute(data,a.itemSize,a.normalized));
    }
    const index=[],groups=g.groups.length?g.groups:[{start:0,count:g.index.count,materialIndex:0}];
    for(const group of groups){const start=index.length;for(let i=group.start;i<group.start+group.count;i+=3){
      const a=remap[g.index.array[i]],b=remap[g.index.array[i+1]],c=remap[g.index.array[i+2]];if(a!==b&&b!==c&&a!==c)index.push(a,b,c);
    }out.addGroup(start,index.length-start,group.materialIndex);}
    out.setIndex(index);out.normalizeNormals();out.boundingSphere=g.boundingSphere?.clone()||null;out.boundingBox=g.boundingBox?.clone()||null;out.userData=g.userData;
    this.skinCache.set(g,out);return out;
  },
  // Merge connected coplanar triangles by their boundary. Preserve non-rectangular
  // outlines; ambiguous boundaries and holes keep the original triangulation.
  flatten(P,UV) {
    const groups=new Map(),out=[],uvout=[];
    const key=(x,y,z)=>[x,y,z].map(v=>Math.round(v*10000)).join(',');
    for(let t=0;t<P.length;t+=9){
      const a=new THREE.Vector3().fromArray(P,t),b=new THREE.Vector3().fromArray(P,t+3),c=new THREE.Vector3().fromArray(P,t+6);
      const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const k=[n.x,n.y,n.z,n.dot(a)].map(v=>Math.round(v*1000)).join(',');
      let g=groups.get(k);if(!g)groups.set(k,g={n,tris:[],edges:new Map(),verts:new Map()});
      g.tris.push(t);
      const ids=[];
      for(let i=0;i<3;i++){const j=t+i*3,id=key(P[j],P[j+1],P[j+2]);ids.push(id);g.verts.set(id,{p:[P[j],P[j+1],P[j+2]],uv:UV?[UV[j/3*2],UV[j/3*2+1]]:[0,0]});}
      for(let i=0;i<3;i++){const a=ids[i],b=ids[(i+1)%3],rev=b+'|'+a;if(g.edges.has(rev))g.edges.delete(rev);else g.edges.set(a+'|'+b,[a,b]);}
    }
    const emit=v=>{out.push(...v.p);uvout.push(...v.uv);};
    for(const g of groups.values()){
      const next=new Map();let valid=true;
      for(const [a,b]of g.edges.values()){if(next.has(a))valid=false;next.set(a,b);}
      const loop=[],start=next.keys().next().value;let id=start;
      if(valid&&start)do{loop.push(g.verts.get(id));id=next.get(id);}while(id&&id!==start&&loop.length<=next.size);
      valid=valid&&id===start&&loop.length===next.size&&loop.length>=3;
      if(valid){
        let changed=true;while(changed&&loop.length>3){changed=false;for(let i=0;i<loop.length;i++){
          const a=new THREE.Vector3(...loop[(i+loop.length-1)%loop.length].p),b=new THREE.Vector3(...loop[i].p),c=new THREE.Vector3(...loop[(i+1)%loop.length].p);
          const ab=b.clone().sub(a),bc=c.clone().sub(b);
          if(ab.clone().cross(bc).length()<1e-5*Math.max(1,ab.length()+bc.length())&&ab.dot(bc)>=0){loop.splice(i,1);changed=true;break;}
        }}
        const n=g.n,axis=Math.abs(n.y)>.7?1:Math.abs(n.x)>Math.abs(n.z)?0:2;
        const points=loop.map(v=>new THREE.Vector2(v.p[(axis+1)%3],v.p[(axis+2)%3]));
        const tris=THREE.ShapeUtils.triangulateShape(points,[]);
        if(tris.length&&tris.length<g.tris.length){for(const tri of tris){
          const a=loop[tri[0]],b=loop[tri[1]],c=loop[tri[2]];
          const norm=new THREE.Vector3(...b.p).sub(new THREE.Vector3(...a.p)).cross(new THREE.Vector3(...c.p).sub(new THREE.Vector3(...a.p)));
          emit(a);if(norm.dot(n)>=0){emit(b);emit(c);}else{emit(c);emit(b);}
        }continue;}
      }
      for(const t of g.tris)for(let i=0;i<3;i++){const j=t+i*3;emit({p:[P[j],P[j+1],P[j+2]],uv:UV?[UV[j/3*2],UV[j/3*2+1]]:[0,0]});}
    }
    return {p:out,uv:uvout};
  },
  build(w){
    const scene=w.scene,group=new THREE.Group();group.name='Manhattan render chunks';group.visible=false;
    // Preserve the actual facade material, UVs, window-layout records and trim
    // attributes. Partition the existing flat walls into smaller culling cells;
    // do not invent a replacement window pattern or flatten texture seams.
    let before=0,after=0;
    for(const source of w.nycMeshes||[]){
      const geo=source.geometry,P=geo.attributes.position,index=geo.index;
      const cells=new Map(),count=index?index.count:P.count;
      before+=count/3;
      for(let i=0;i<count;i+=3){
        const ids=[0,1,2].map(j=>index?index.array[i+j]:i+j);
        const x=ids.reduce((s,j)=>s+P.getX(j),0)/3,z=ids.reduce((s,j)=>s+P.getZ(j),0)/3;
        const k=Math.floor(x/80)+','+Math.floor(z/80);let cell=cells.get(k);
        if(!cell)cells.set(k,cell=[]);cell.push(...ids);
      }
      for(const ids of cells.values()){
        const geoLow=new THREE.BufferGeometry();
        for(const [name,a]of Object.entries(geo.attributes)){
          const data=new a.array.constructor(ids.length*a.itemSize);
          for(let i=0;i<ids.length;i++)for(let j=0;j<a.itemSize;j++)data[i*a.itemSize+j]=a.array[ids[i]*a.itemSize+j];
          geoLow.setAttribute(name,new THREE.BufferAttribute(data,a.itemSize,a.normalized));
        }
        geoLow.computeBoundingSphere();
        const mesh=new THREE.Mesh(geoLow,source.material);mesh.name='Low original facade';mesh.matrixAutoUpdate=false;
        mesh.matrix.copy(source.matrix);group.add(mesh);after+=ids.length/3;
        mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;
      }
    }
    // Detailed replacement buildings keep their own models and textures too.
    // Split their instance batches spatially instead of replacing them by boxes.
    for(const source of TL.Replace.meshes||[]){
      const proxy=source.clone();proxy.geometry=source.geometry.clone();
      proxy.geometry.computeBoundingSphere();proxy.updateMatrixWorld(true);
      for(const mesh of TL.CellInstancing.split(proxy,80))group.add(mesh);
      proxy.geometry.dispose();
    }
    scene.add(group);group.updateMatrixWorld(true);
    const hidden=[...(w.nycMeshes||[]),...(TL.Replace.meshes||[])];
    const details=[...(w.roofState?.meshes||[])];
    const shells=group.children;
    const landmarks=scene.children.filter(m=>m.name?.startsWith('LM_'));
    // Only static scenery belongs here. Webs and other deforming effects opt
    // out of frustum culling because their vertices move without static bounds.
    const other=[];scene.traverse(m=>{if(m.isMesh&&m.matrixAutoUpdate===false&&m.frustumCulled!==false&&!m.isSkinnedMesh&&!m.isInstancedMesh&&m.geometry&&m!==w.ground&&!shells.includes(m)&&!hidden.includes(m)&&!details.includes(m)&&!landmarks.includes(m)&&m.material?.fog!==false)other.push(m);});
    const ready=new WeakSet(),materialReady=new WeakMap(),warmMeshes=[...shells,...details,...landmarks,...other];
    for(const m of warmMeshes){if(!m.geometry.boundingSphere)m.geometry.computeBoundingSphere();const prior=m.onAfterRender;m.onAfterRender=function(...args){TL.LowManhattan.noteReady(w,{ready,materialReady},m);prior.apply(this,args);};}
    return {group,hidden,details,shells,landmarks,other,before,after,ready,materialReady,warmMeshes,lead:new THREE.Vector3(),hold:new WeakMap(),cheap:new Map(),changes:[],frustum:new THREE.Frustum(),shadow:new THREE.Frustum(),matrix:new THREE.Matrix4(),sphere:new THREE.Sphere()};
  },
  enter(w,camera){
    const g=w.game;if(!g.scanMode)return;
    const L=w.lowRender||(w.lowRender=this.build(w));
    const change=(o,k,v)=>{L.changes.push([o,k,o[k]]);o[k]=v;};
    const budget=this.policy(g.quality,g.settings.renderDist,g.hero?.ctrl.vel||new THREE.Vector3()),range=budget.range,isLow=g.quality==='low';
    L.lead.clampLength(0,budget.maxLead);
    const sun=g.env?.sun;let shadows=false;
    if(sun?.castShadow&&g.renderer.shadowMap.enabled){sun.updateMatrixWorld();sun.target.updateMatrixWorld();sun.shadow.updateMatrices(sun);L.shadow.copy(sun.shadow.getFrustum());shadows=true;}
    L.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);L.frustum.setFromProjectionMatrix(L.matrix);
    const visible=(m,d)=>{
      const geo=m.geometry;if(!geo.boundingSphere)geo.computeBoundingSphere();
      L.sphere.copy(geo.boundingSphere).applyMatrix4(m.matrixWorld);
      const shadow=shadows&&m.castShadow&&L.shadow.intersectsSphere(L.sphere);
      if(shadow)return true;
      if(!L.frustum.intersectsSphere(L.sphere))return false;
      const distance=this.distance(L.sphere,camera.position,L.lead),now=g.time||0;
      if(distance<d){L.hold.set(m,now+1);return true;}
      return distance<d+80&&(L.hold.get(m)||0)>now;
    };
    change(L.group,'visible',true);
    for(const m of L.hidden)change(m,'visible',false);
    for(const m of L.shells)change(m,'visible',visible(m,range));
    for(const m of L.details)if(m.visible)change(m,'visible',visible(m,m.name==='Manhattan roof surfaces'?range:Math.min(range,budget.detail)));
    for(const m of L.other)if(m.visible&&m.frustumCulled!==false)change(m,'visible',visible(m,range));
    for(const m of L.landmarks)if(m.visible){change(m,'visible',visible(m,range));
      if(isLow&&m.visible){let mat=L.cheap.get(m.material);if(!mat){mat=new THREE.MeshLambertMaterial({map:m.material.map,color:m.material.color,side:m.material.side,alphaTest:m.material.alphaTest});L.cheap.set(m.material,mat);}change(m,'material',mat);}
    }
    const heroes=new Set(Object.values(g.heroes||{}));if(g.net)for(const r of g.net.remotes.values())if(r.hero)heroes.add(r.hero);
    for(const hero of heroes){const m=hero?.sk?.mesh;if(isLow&&m&&m.visible){change(m,'geometry',this.skinGeometry(m.geometry));
      hero.anim?.arms?.group.traverse(part=>{if(part.isMesh&&part.geometry)change(part,'geometry',this.skinGeometry(part.geometry));});
    }}
    if(isLow)w.scene.traverse(m=>{if(m.isInstancedMesh&&m.visible)this.trimInstances(m,camera,m.name?.startsWith('TREE_')?140:Math.min(range,180),change);});
    if(isLow&&w.scene.fog){change(w.scene.fog,'near',range*.3);change(w.scene.fog,'far',range*.9);}
  },
  exit(w){const L=w.lowRender;if(!L)return;for(let i=L.changes.length-1;i>=0;i--){const [o,k,v]=L.changes[i];o[k]=v;}L.changes.length=0;}
};
if(TL.ScanHooks)TL.ScanHooks.build.push(w=>{
  const before=w.scene.onBeforeRender,after=w.scene.onAfterRender;
  w.scene.onBeforeRender=function(r,s,c,...rest){before.call(this,r,s,c,...rest);TL.LowManhattan.enter(w,c);};
  w.scene.onAfterRender=function(...args){TL.LowManhattan.exit(w);after.call(this,...args);};
});
if(TL.ScanHooks)TL.ScanHooks.update.push((w,focus,velocity,dt)=>TL.LowManhattan.prepare(w,velocity,dt));
