/* Small, hollow traversal props. Unlike a painted vent opening, every opening
   has matching collision walls and a tested exit. The city's surface materials
   and post processing are not changed here. */
'use strict';
TL.TraversalSupports={
  build(world){
    const R=world.roofState,RT=TL.Rooftops;if(!R?.analyses)return;
    const W=world.world,gates=W.referenceGates=[];
    const used=[...(R.placements||[]),...(R.obstacles||[])];
    const buckets={duct:[],pipe:[]},spec={duct:[],pipe:[]};
    const box=(type,x,y,z,hx,hy,hz,mat)=>spec[type].push({x,y,z,hx,hy,hz,mat});
    // Open-ended sheet metal duct, with two supporting feet and raised seams.
    box('duct',-1.18,1.35,0,.08,1.15,1.6,0);box('duct',1.18,1.35,0,.08,1.15,1.6,0);
    box('duct',0,2.42,0,1.18,.08,1.6,0);box('duct',0,.28,0,1.18,.08,1.6,0);
    for(const z of [-1.25,1.25])box('duct',0,.12,z,1.3,.12,.12,1);
    // Hoisted pipe on a rooftop construction gantry. Four conservative collision
    // walls leave the centre lane open inside the circular visible bore.
    box('pipe',-1.18,1.6,0,.13,1.18,1.6,2);box('pipe',1.18,1.6,0,.13,1.18,1.6,2);
    box('pipe',0,2.78,0,1.18,.13,1.6,2);box('pipe',0,.42,0,1.18,.13,1.6,2);
    for(const x of [-1.9,1.9]){box('pipe',x,2.3,0,.13,2.3,.18,3);box('pipe',x,.09,0,.45,.09,1.2,1);}
    box('pipe',0,4.5,0,2.03,.14,.18,3);
    for(const z of [-.85,.85])box('pipe',0,3.65,z,.025,.7,.025,1);
    let count=0;
    for(const A of R.analyses){
      if(count>=24)break;
      for(const L of A.levels){
        if(L.area<280||L.y<15)continue;
        const x=(L.minX+L.maxX)*.5,z=(L.minZ+L.maxZ)*.5,y=L.y+.015,yaw=A.yaw;
        if(!RT.fits(A,x,z,y-.015,2.5,4.8,yaw,.6))continue;
        if(used.some(p=>Math.abs(p.y-y)<3&&Math.hypot(x-p.x,z-p.z)<Math.hypot(p.hx||1,p.hz||1)+4.7))continue;
        const type=count%2?'pipe':'duct',sy=Math.sin(yaw),cy=Math.cos(yaw),cols=[];
        for(const b of spec[type]){
          const c=W.addStatic(x+b.x*cy+b.z*sy,y+b.y,z-b.x*sy+b.z*cy,b.hx,b.hy,b.hz,yaw,{kind:'building',src:'rooftop',bid:A.b.id,climb:true,anchor:true,perch:true});
          R.colliders.push(c);cols.push(c);
        }
        const center=new THREE.Vector3(x,y+(type==='pipe'?1.6:1.28),z),axis=new THREE.Vector3(sy,0,cy);
        gates.push({type,center,axis,length:3.2,anchors:[0,1].map(i=>{const c=cols[i];return{x:c.cx,y:center.y,z:c.cz,col:c};})});
        // Attachment points are the inner wall surfaces, not the box centres.
        gates[gates.length-1].anchors.forEach((p,i)=>{p.x+=(i?-1:1)*cols[i].hx*cy;p.z-=(i?-1:1)*cols[i].hx*sy;});
        buckets[type].push(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(1,1,1)));
        used.push({x,y,z,hx:2.5,hz:4.8});count++;break;
      }
    }
    // Existing wooden water towers have an open space between their four legs.
    for(const p of R.placements||[])if(p.type==='tank'){
      const cy=Math.cos(p.yaw),sy=Math.sin(p.yaw),anchors=[];
      for(const side of [-1,1]){
        // Cross-braces and the ladder occupy local +/-Z. Traverse along local X,
        // through the genuinely open sides, rather than through those braces.
        const x=p.x-1.2*cy+side*1.2*sy,z=p.z+1.2*sy+side*1.2*cy;
        const col=R.colliders.find(c=>Math.hypot(c.cx-x,c.cz-z)<.16&&c.hy>1&&c.hy<1.3);
        if(col)anchors.push({x:col.cx-.09*cy,y:p.y+1.15,z:col.cz+.09*sy,col});
      }
      if(anchors.length===2)gates.push({type:'water_tower',center:new THREE.Vector3(p.x,p.y+1.15,p.z),axis:new THREE.Vector3(cy,0,-sy),length:2.4,anchors});
    }
    const mats=[new THREE.MeshStandardMaterial({color:0x9ba6aa,roughness:.6,metalness:.6}),new THREE.MeshStandardMaterial({color:0x333a3d,roughness:.8}),null,new THREE.MeshStandardMaterial({color:0xb79843,roughness:.65,metalness:.45})];
    for(const type of ['duct','pipe']){
      const transforms=buckets[type];if(!transforms.length)continue;
      const parts=spec[type].filter(b=>b.mat!==2).map(b=>({geo:new THREE.BoxGeometry(b.hx*2,b.hy*2,b.hz*2).translate(b.x,b.y,b.z),mat:b.mat}));
      if(type==='pipe'){
        const profile=[new THREE.Vector2(1.08,-1.6),new THREE.Vector2(1.31,-1.6),new THREE.Vector2(1.31,1.6),new THREE.Vector2(1.08,1.6),new THREE.Vector2(1.08,-1.6)];
        const geo=new THREE.LatheGeometry(profile,20).rotateX(Math.PI/2).translate(0,1.6,0);parts.push({geo,mat:0});
      }
      // Merge each kit by material, then instance: at most six draw calls total.
      for(const mat of [0,1,3]){
        const selected=parts.filter(p=>p.mat===mat);if(!selected.length)continue;
        const data={position:[],normal:[],uv:[]};
        for(const p of selected){const g=p.geo.toNonIndexed();for(const k in data)data[k].push(...g.attributes[k].array);g.dispose();p.geo.dispose();}
        const geo=new THREE.BufferGeometry();for(const k in data)geo.setAttribute(k,new THREE.Float32BufferAttribute(data[k],k==='uv'?2:3));geo.computeBoundingSphere();
        const m=new THREE.InstancedMesh(geo,mats[mat],transforms.length);transforms.forEach((t,i)=>m.setMatrixAt(i,t));m.frustumCulled=false;m.castShadow=m.receiveShadow=true;m.name='Traversal '+type;world.scene.add(m);R.meshes.push(m);
      }
    }
    const wind=world.game?.wind;
    if(wind){
      // Rooftop thermals and a few unobstructed high-level cross-city currents.
      for(const p of (R.placements||[]).filter(p=>p.type==='hvac').filter((p,i)=>i%18===0))wind.add(p.x,p.z,8,p.y+2,p.y+55,19,'roof-thermal');
      const points=R.analyses.filter(a=>a.levels[0]?.y>35).map(a=>{const l=a.levels[0];return new THREE.Vector3((l.minX+l.maxX)/2,l.y+22,(l.minZ+l.maxZ)/2);});
      for(let i=0;i<points.length&&(wind.tunnels||[]).length<8;i+=5){
        const start=points[i],end=points.find((p,j)=>j>i&&p.distanceTo(start)>95&&p.distanceTo(start)<170&&Math.abs(p.y-start.y)<12);if(!end)continue;
        const d=end.clone().sub(start),length=d.length();d.normalize();let blocked=false;
        for(const off of [new THREE.Vector3(),new THREE.Vector3(6,0,0),new THREE.Vector3(-6,0,0),new THREE.Vector3(0,-5,0)]){const p=start.clone().add(off);if(W.raycast(p.x,p.y,p.z,d.x,d.y,d.z,length,c=>c.solid,null,{noGround:true})){blocked=true;break;}}
        if(!blocked)wind.addTunnel(start,end,7);
      }
    }
  }
};
if(TL.ScanHooks)TL.ScanHooks.build.push(world=>TL.TraversalSupports.build(world));
