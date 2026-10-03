/* Sparse, geometry-supported construction landmarks for the Manhattan scan.
   Selected upper floors are cut away before these frames are built. Every traversable member has a narrow collider;
   pipe bores, slab shafts and tower lanes never receive enclosing collision boxes. */
'use strict';
TL.Construction = {
  MAX_SITES:20, SPACING:90,
  names:['Dockside Steelworks','Civic Courtyard','Mercer Stepworks','Hudson Split Decks','East River Crown','Tribeca L-Frame','Canal Stagger','Bowery Gallery'],
  transform(p,v){const c=Math.cos(p.yaw),s=Math.sin(p.yaw);return new THREE.Vector3(p.x+v[0]*c+v[2]*s,p.baseY+v[1],p.z-v[0]*s+v[2]*c);},
  async load(data){
    this.authored=null;this.finishedTowerAsset=null;if(!data.nyc||!TL.Extra?.has('construction_authored.json.gz'))return;
    const asset=await TL.Extra.json('construction_authored.json.gz');
    if(!asset||!Array.isArray(asset.sites)||asset.sites.length!==20)throw Error('Construction asset must contain twenty authored buildings');
    this.authored=new Map(asset.sites.map(p=>[p.roofBid??p.bid,p]));
    this.finishedTowerAsset={towers:asset.towers||[],siteLinks:asset.siteLinks||[]};
  },
  model(stories=3,plan={}){
    const parts=[],solids=[],hx=plan.hx||15,hz=plan.hz||12,variant=plan.variant||0,top=stories*4.2;
    const box=(mat,x,y,z,xx,yy,zz,solid=true,kind='beam')=>{parts.push({shape:'box',mat,x,y,z,hx:xx,hy:yy,hz:zz});if(solid)solids.push({x,y,z,hx:xx,hy:yy,hz:zz,kind,mat});};
    const beam=(mat,a,b,r=.09,solid=true)=>{parts.push({shape:'beam',mat,a,b,r});if(!solid)return;const len=Math.hypot(...a.map((v,i)=>b[i]-v)),axes=a.filter((v,i)=>Math.abs(b[i]-v)>.001).length,n=axes<2?1:Math.ceil(len/.8);for(let k=0;k<n;k++){const lo=a.map((v,i)=>v+(b[i]-v)*k/n),hi=a.map((v,i)=>v+(b[i]-v)*(k+1)/n);solids.push({x:(lo[0]+hi[0])/2,y:(lo[1]+hi[1])/2,z:(lo[2]+hi[2])/2,hx:Math.abs(hi[0]-lo[0])/2+r,hy:Math.abs(hi[1]-lo[1])/2+r,hz:Math.abs(hi[2]-lo[2])/2+r,kind:'brace',mat});}};
    // Eight authored structural plans: twin wings, courtyard, stepped west, split decks,
    // setback crown, L-frame, staggered floorplates and an east cantilever gallery.
    const layouts=[
      [[-1,0],[1,0],[0,-1]], [[-1,0],[1,0],[0,-1],[0,1]],
      [[-1,0],[1,-1],[0,-1]], [[-1,-1],[1,1],[0,-1]],
      [[-1,0],[1,0],[0,1]], [[-1,0],[0,-1],[1,-1]],
      [[-1,1],[1,-1],[0,-1]], [[-1,0],[1,0],[0,-1]]
    ];
    const wingW=(hx-2.5)/2,wingX=2.5+wingW;
    const decks=[];
    // This slab is the exposed cut through the original building, not a new rooftop.
    box('concrete',0,-.2,0,hx,.2,hz,true,'platform');
    if(plan.capPositions){parts.pop();parts.push({shape:'footprint',mat:'concrete',positions:plan.capPositions});}
    for(let l=0;l<stories;l++){
      const y=(l+1)*4.2,stepped=l===stories-1,sideDepth=hz-(stepped?1.6+(variant%3):0);
      for(const [sx,sz]of layouts[variant%8]){
        if(stepped&&((variant===2&&sx>0)||(variant===5&&sx>0)||(variant===6&&sx<0)))continue;
        let x,z,xx,zz;
        if(sx){x=sx*wingX;xx=wingW;z=sz*sideDepth*.43;zz=sz?sideDepth*.52:sideDepth;}
        else{x=0;xx=2.5;z=sz*(sideDepth-1.5);zz=1.5;}
        box('concrete',x,y,z,xx,.2,zz,true,'platform');decks.push({x,y,z,hx:xx,hz:zz,l});
        // Plywood edge shutters and exposed tie plates break up broad white slab edges.
        if((l+variant)%2===0)box('timber',x,y-.04,z+zz,xx,.29,.065,false);
        for(const dx of [-xx+.45,xx-.45]){
          const X=x+dx,Z=z-zz+.45;box('concrete',X,y-2.1,Z,.29,1.9,.29,true,'column');
          if(l===stories-1)for(const u of [-.14,.14])for(const v of [-.14,.14])beam('rust',[X+u,y+.18,Z+v],[X+u,y+1.3+(variant%3)*.18,Z+v],.024,false);
        }
        // Long perimeter beams make the unfinished volumes continuous with the old facade.
        box('concrete',x,y-.32,z-zz+.18,xx,.17,.22,true,'beam');
      }
      // Scaffold rails only along outer sides. Open centre and front/rear traversal lanes.
      for(const side of [-1,1]){
        const x=side*(hx+.15),a=-sideDepth,b=sideDepth;
        beam('rust',[x,.1,a],[x,y+1.15,a],.065);beam('rust',[x,.1,b],[x,y+1.15,b],.065);
        beam('steel',[x,y+.65,a],[x,y+.65,b],.035);beam('steel',[x,y+1.12,a],[x,y+1.12,b],.04);
        if((variant+l+side)%3!==0)box('net',x,y+.48,(a+b)/2,.015,.44,(b-a)*.43,false);
        if(l===0||l===stories-1)box('timber',x,y+.08,0,.58,.06,sideDepth,true,'platform');
      }
    }
    // Distinct formwork and staging arrangements, kept outside the central route lane.
    const stagingX=-wingX,stagingZ=(variant%2?1:-1)*(hz-3),stageY=4.2;
    for(let i=0;i<5;i++)box('timber',stagingX,stageY+.32+i*.11,stagingZ,Math.min(2,wingW-.4),.045,.65,true,'cargo');
    for(const dz of [-.5,.5])box('steel',stagingX,stageY+.57,stagingZ+dz,Math.min(2.05,wingW-.35),.31,.025,false);
    for(let i=0;i<7;i++){const X=wingX+(i%3-1)*.66,Z=-hz+2.2+Math.floor(i/3)*.52;box(i%3?'concrete':'timber',X,.15+(i%2)*.12,Z,.25+(i%2)*.14,.14,.22,false);}
    for(let i=0;i<3;i++)box('timber',-wingX,top+.3+i*.12,-hz+3,wingW*.67,.05,.75,false);
    // Blue weather tarps on a few formwork walls; never an enclosing solid cage.
    const tarpSide=variant%2?1:-1;
    box('tarp',tarpSide*(hx-.12),Math.min(top-1.5,6.2),hz*.28,.035,1.65,Math.min(3.5,hz*.35),false);
    for(const z of [hz*.28-3,hz*.28+3])beam('steel',[tarpSide*(hx-.2),3.5,z],[tarpSide*(hx-.2),8,z],.045,false);
    // Pipe gantry is a separate lifting station, leaving the crane free to slew.
    const pipe=[wingX,top+3.4,0],inner=1.9,radius=2.12,half=3.5,pipeSolids=[];
    parts.push({shape:'pipe',mat:'concrete',x:pipe[0],y:pipe[1],z:0,inner,radius,half});
    for(let i=0;i<20;i++){const a=(i-.5)*Math.PI/10,b=(i+.5)*Math.PI/10,pts=[];for(const r of [inner,radius])for(const q of [a,(a+b)/2,b])pts.push([Math.cos(q)*r,Math.sin(q)*r]);const xs=pts.map(v=>v[0]),ys=pts.map(v=>v[1]),lx=Math.min(...xs),ux=Math.max(...xs),ly=Math.min(...ys),uy=Math.max(...ys);pipeSolids.push(solids.length);solids.push({x:pipe[0]+(lx+ux)/2,y:pipe[1]+(ly+uy)/2,z:0,hx:(ux-lx)/2,hy:(uy-ly)/2,hz:half,kind:'pipe',mat:'concrete'});}
    for(const z of [-2.6,2.6]){parts.push({shape:'ring',mat:'steel',x:pipe[0],y:pipe[1],z,radius:2.16,r:.05});for(const sign of [-1,1]){box('orange',pipe[0]+sign*2.7,top+3.5,z,.12,3.3,.12,true,'column');beam('steel',[pipe[0]+sign*1.7,pipe[1]+1.2,z],[pipe[0],top+6.8,z],.035,false);}box('orange',pipe[0],top+6.9,z,2.85,.14,.14,true,'beam');}
    for(const x of [-hx+1,hx-1]){box('orange',x,.55,-hz+.6,.16,.55,.16,true,'column');box('lamp',x,1.13,-hz+.6,.23,.07,.23,false);}
    // Per-layout top landing stays static; cranes have independent moving colliders.
    const finishDeck=decks.find(d=>d.l===0&&d.x>0)||decks.find(d=>d.l===0);const finish=[finishDeck.x,finishDeck.y+.2,finishDeck.z];
    const tower=null,legs=[];
    return {parts,solids,stories,top,hx,hz,variant,pipe,pipeSolids,pipeHalf:half,pipeInner:inner,tower,legs,finish,decks};
  },
  materials(){
    const defs={concrete:[0x69665e,.96,.02],timber:[0x836648,.94,.02],rust:[0x784c30,.8,.35],net:[0x425953,.95,.02],tarp:[0x294c69,.86,.02],orange:[0xb97228,.58,.45],steel:[0x465057,.65,.6],teal:[0x426c68,.96,.02],wood:[0x70563d,.9,.02],glass:[0x294751,.24,.35],lamp:[0xffb94f,.4,.1]},out={};
    for(const [key,[color,roughness,metalness]] of Object.entries(defs)){
      const m=out[key]=new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide});
      if(key==='lamp'){m.emissive.set(0xff820d);m.emissiveIntensity=.8;}
      m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vBuildP;').replace('#include <begin_vertex>','#include <begin_vertex>\nvBuildP=position;');sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vBuildP;').replace('#include <color_fragment>',`#include <color_fragment>
        float g=fract(sin(dot(floor(vBuildP*9.0),vec3(12.9898,78.233,37.719)))*43758.5453);
        float f=1.0-smoothstep(.015,.12,length(fwidth(vBuildP)));
        diffuseColor.rgb*=.94+(g-.5)*.15*f;
        ${key==='concrete'?'float seam=abs(fract(vBuildP.y*.72)-.5);diffuseColor.rgb*=1.0-.075*smoothstep(.475,.5,seam);':''}
        ${key==='wood'?'diffuseColor.rgb*=.88+.14*fract(sin(floor(atan(vBuildP.z,vBuildP.x)*26.0)*71.3)*312.4);':''}`);};m.customProgramCacheKey=()=> 'construction-'+key;
    }return out;
  },
  kit(state,stories,plan={}){
    const key=plan.key||[stories,plan.variant||0,plan.hx||15,plan.hz||12].join(':');
    if(state.kits.has(key))return state.kits.get(key);
    const authored=this.authored?.get(plan.roofBid),model=authored?.model||this.model(stories,plan),buckets={};
    if(authored?.meshes){const meshes=authored.meshes.map(p=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p.position||p.positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(p.normal||p.normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));geometry.computeBoundingSphere();return{geometry,material:state.materials[p.mat]};});const kit={model,meshes};state.kits.set(key,kit);return kit;}
    for(const p of model.parts){let g;
      if(p.shape==='footprint'){g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p.positions,3));g.computeVertexNormals();g.setAttribute('uv',new THREE.Float32BufferAttribute(p.positions.flatMap((v,i)=>i%3===1?[]:[v*.08]),2));}
      else if(p.shape==='box')g=new THREE.BoxGeometry(p.hx*2,p.hy*2,p.hz*2).translate(p.x,p.y,p.z);
      else if(p.shape==='beam'){const a=new THREE.Vector3(...p.a),b=new THREE.Vector3(...p.b),d=b.clone().sub(a);g=new THREE.CylinderGeometry(p.r,p.r,d.length(),6).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize())).translate(...a.add(b).multiplyScalar(.5).toArray());}
      else if(p.shape==='pipe')g=new THREE.LatheGeometry([new THREE.Vector2(p.inner,-p.half),new THREE.Vector2(p.radius,-p.half),new THREE.Vector2(p.radius,p.half),new THREE.Vector2(p.inner,p.half),new THREE.Vector2(p.inner,-p.half)],32).rotateX(Math.PI/2).translate(p.x,p.y,p.z);
      else if(p.shape==='ring'||p.shape==='hoop'){g=new THREE.TorusGeometry(p.radius,p.r,5,32);if(p.shape==='hoop')g.rotateX(Math.PI/2);g.translate(p.x,p.y,p.z);}
      else g=new THREE.CylinderGeometry(p.shape==='cap'?0:p.radius,p.radius,p.height,24).translate(p.x,p.y,p.z);
      const n=g.index?g.toNonIndexed():g,entry=buckets[p.mat]||(buckets[p.mat]={position:[],normal:[],uv:[]});
      for(const key of Object.keys(entry))for(const v of n.attributes[key].array)entry[key].push(v);if(n!==g)n.dispose();g.dispose();
    }
    const meshes=[];for(const [mat,attributes]of Object.entries(buckets)){const geometry=new THREE.BufferGeometry();for(const [key,a]of Object.entries(attributes))geometry.setAttribute(key,new THREE.Float32BufferAttribute(a,key==='uv'?2:3));geometry.computeBoundingSphere();meshes.push({geometry,material:state.materials[mat]});}
    const kit={model,meshes};state.kits.set(key,kit);return kit;
  },
  state(world){return world.constructionState||(world.constructionState={sites:[],meshes:[],colliders:[],gates:[],kits:new Map(),materials:this.materials(),dispose:()=>this.dispose(world)});},
  buildSite(world,p,index=0){
    const S=this.state(world),W=world.world,kit=this.kit(S,p.stories||3,p),M=kit.model,id='construction-'+index;
    const site={id,name:this.authored?.get(p.roofBid)?.name||this.names[index%this.names.length],center:new THREE.Vector3(p.x,p.baseY,p.z),yaw:p.yaw,baseY:p.baseY,roofBid:p.roofBid,stories:M.stories,footprint:{hx:M.hx,hz:M.hz,bounds:M.bounds},variant:M.variant,cutY:p.baseY,originalTop:p.originalTop,landmarks:{},gates:[],routePoints:[],colliders:[],meshes:[]};
    for(const part of kit.meshes){const m=new THREE.Mesh(part.geometry,part.material);m.position.copy(site.center);m.rotation.y=p.yaw;m.updateMatrix();m.matrixAutoUpdate=false;m.castShadow=m.receiveShadow=true;m.name='Construction '+site.name;world.scene.add(m);site.meshes.push(m);S.meshes.push(m);}
    for(const b of M.solids){const v=this.transform(p,[b.x,b.y,b.z]),c=W.addStatic(v.x,v.y,v.z,b.hx,b.hy,b.hz,p.yaw+(b.yaw||0),{kind:'building',src:'construction',bid:p.roofBid,siteId:id,climb:true,anchor:true,perch:true,supportType:/platform|rail|cap/.test(b.kind)?b.kind:undefined,surface:b.mat,constructionMember:b.kind});site.colliders.push(c);S.colliders.push(c);}
    const axis=this.transform({...p,x:0,z:0,baseY:0},[0,0,1]),ref=(v)=>this.transform(p,v);
    const makeGate=(type,center,length,anchors,radius,height)=>{
      const gate={id:id+'-'+type,type,center:ref(center),axis:axis.clone(),length,radius,height,anchors:[],anchorsBySide:{},siteId:id};
      for(const [key,sign]of [['positive',-1],['negative',1]])gate.anchorsBySide[key]=anchors(sign).map(a=>({x:a.p.x,y:a.p.y,z:a.p.z,col:a.col}));
      gate.anchors=gate.anchorsBySide.positive;site.gates.push(gate);S.gates.push(gate);(W.referenceGates||(W.referenceGates=[])).push(gate);return gate;
    };
    const pipe=makeGate('pipe',[M.pipe[0],M.pipe[1]-.12,M.pipe[2]],M.pipeHalf*2,sign=>[0,10].map(i=>{const col=site.colliders[M.pipeSolids[i]],local=M.solids[M.pipeSolids[i]];return{col,p:ref([local.x,M.pipe[1],M.pipe[2]+sign*M.pipeHalf])};}),M.pipeInner,M.pipeInner*2);
    const tower=M.tower&&M.legs?.length===4?makeGate('water_tower',[M.tower[0],M.tower[1]+1.65,M.tower[2]],4.8,sign=>[0,1].map(i=>{const leg=(i===0?0:2)+(sign>0?1:0),col=site.colliders[M.legs[leg]],b=M.solids[M.legs[leg]];return{col,p:ref([b.x,M.tower[1]+1.65,b.z+sign*b.hz])};}),2.05,3.65):null;
    site.landmarks.pipe=pipe.center.clone();if(tower)site.landmarks.tower=tower.center.clone();site.landmarks.craneTop=ref(M.finish);
    const start=ref(M.start||[2.5+(M.hx-2.5)/2,.025,-M.hz+2]);site.start={x:start.x,y:start.y,z:start.z,yaw:p.yaw};
    site.routePoints=[{center:ref([0,6.35,0]),axis:axis.clone(),radius:1.7,kind:'frame',approach:Math.min(5,M.hz-4)},{center:pipe.center.clone(),axis:axis.clone(),radius:1.5,kind:'pipe',length:M.pipeHalf*2,gate:pipe},tower?{center:tower.center.clone(),axis:axis.clone(),radius:1.8,kind:'water_tower',length:4.8,gate:tower}:null,{center:site.landmarks.craneTop.clone().add(new THREE.Vector3(0,1,0)),axis:axis.clone(),radius:1.5,kind:'zone',feature:'deck',label:'Staging deck',surface:site.landmarks.craneTop.y}].filter(Boolean);
    const crane=ref([M.craneLocal?M.craneLocal[0]:-M.hx-3,0,M.craneLocal?M.craneLocal[1]:-M.hz+3]);site.crane={x:crane.x,z:crane.z,baseY:Math.max(0,p.baseY-12),topY:p.baseY+M.top+14,yaw:p.yaw,range:.22};
    S.sites.push(site);return site;
  },
  overlap(a,b){
    if(a.y+a.hy<=b.cy-b.hy+.02||a.y-a.hy>=b.cy+b.hy-.02)return false;
    const ac=Math.cos(a.yaw),as=Math.sin(a.yaw),bc=b.c,bs=b.s,dx=b.cx-a.x,dz=b.cz-a.z;
    for(const [x,z]of [[ac,-as],[as,ac],[bc,-bs],[bs,bc]]){
      const ra=a.hx*Math.abs(x*ac-z*as)+a.hz*Math.abs(x*as+z*ac),rb=b.hx*Math.abs(x*bc-z*bs)+b.hz*Math.abs(x*bs+z*bc);
      if(Math.abs(dx*x+dz*z)>=ra+rb-.035)return false;
    }return true;
  },
  clearPlacement(world,p,model){
    const W=world.world,candidates=[];W.query(p.x-55,p.z-55,p.x+55,p.z+55,candidates);
    for(const b of model.solids){const v=this.transform(p,[b.x,b.y,b.z]),a={x:v.x,y:v.y,z:v.z,hx:b.hx,hy:b.hy,hz:b.hz,yaw:p.yaw};
      if(candidates.some(c=>c.solid&&this.overlap(a,c)))return false;}
    // Test all gate lanes, including fast-entry and fast-exit space, before committing.
    for(const lane of [[model.pipe[0],model.pipe[1]-.12,model.pipe[2],13],[0,model.top+1.85,0,12.4],[0,6.35,0,5]])for(let z=-lane[3];z<=lane[3];z+=.8){
      const v=this.transform(p,[lane[0],lane[1],lane[2]+z]),a={x:v.x,y:v.y,z:v.z,hx:.6,hy:.8,hz:.6,yaw:p.yaw};if(candidates.some(c=>c.solid&&this.overlap(a,c)))return false;}
    return true;
  },
  clipBuilding(b,buffer,cutY){
    const P=new Float32Array(buffer,b.o,b.n*9),U=b.uo!==undefined?new Float32Array(buffer,b.uo,b.n*6):null,positions=[],uvs=[],sources=[];
    for(let k=0;k<b.n;k++){
      let poly=[0,1,2].map(j=>[P[k*9+j*3],P[k*9+j*3+1],P[k*9+j*3+2],U?U[k*6+j*2]:0,U?U[k*6+j*2+1]:0]),out=[];
      for(let i=0;i<poly.length;i++){const a=poly[i],z=poly[(i+1)%poly.length],ai=a[1]<=cutY+.00001,zi=z[1]<=cutY+.00001;if(ai)out.push(a);if(ai!==zi){const t=(cutY-a[1])/(z[1]-a[1]);out.push(a.map((v,j)=>v+(z[j]-v)*t));}}
      for(let j=1;j<out.length-1;j++){for(const v of [out[0],out[j],out[j+1]]){positions.push(...v.slice(0,3));uvs.push(...v.slice(3));}sources.push(k);}
    }
    return {...b,n:sources.length,_source:b,_triSource:sources,_constructionCut:cutY,_P:new Float32Array(positions),_UV:new Float32Array(uvs)};
  },
  prepare(world){
    if(world.constructionPlans||!world.data?.nyc||!TL.Rooftops)return;
    if(this.authored){
      const plans=[];for(const [bid,asset]of this.authored){const b=world.data.nyc.buildings.find(b=>b.id===bid);if(!b||world.replaced.has(bid))continue;const p={...asset,roofBid:bid,baseY:asset.cutY??asset.baseY,stories:asset.model.stories,hx:asset.model.hx,hz:asset.model.hz,key:'blender-'+bid};p.cutY=p.baseY;p.cut=this.clipBuilding(b,world.data.nycBin,p.cutY);plans.push(p);}
      world.constructionPlans=plans;world.constructionCuts=new Map(plans.map(p=>[p.roofBid,p]));return;
    }
    const N=world.data.nyc,B=world.data.nycBin,spawn=world.spawnPoint?world.spawnPoint():{x:32,z:-29},candidates=[];
    for(const b of N.buildings){
      if(world.replaced.has(b.id)||b.h<22||b.h>300)continue;
      const A=TL.Rooftops.analyze(b,new Float32Array(B,b.o,b.n*9));
      let best=null;
      for(const L of A.levels.filter(l=>l.area>320&&l.y>20))for(const [dx,dz] of [[0,0],[-6,0],[6,0],[0,-6],[0,6]])for(const yaw of [A.yaw,A.yaw+Math.PI/2]){
        const x=(L.minX+L.maxX)/2+dx,z=(L.minZ+L.maxZ)/2+dz;
        if(!TL.Rooftops.fits(A,x,z,L.y,9,8.5,yaw,0))continue;
        let hx=9,hz=8.5;
        for(let k=0;k<14;k++){let grew=false;if(hx<24&&TL.Rooftops.fits(A,x,z,L.y,hx+.75,hz,yaw,.1)){hx+=.75;grew=true;}if(hz<23&&TL.Rooftops.fits(A,x,z,L.y,hx,hz+.75,yaw,.1)){hz+=.75;grew=true;}if(!grew)break;}
        if(!best||hx*hz>best.hx*best.hz)best={x,z,yaw,hx,hz,roofBid:b.id,originalTop:L.y,b,A,L,distance:Math.hypot(x-spawn.x,z-spawn.z)};
      }
      if(best)candidates.push(best);
    }
    candidates.sort((a,b)=>a.distance-b.distance);const plans=[];
    for(const p of candidates){if(plans.length>=this.MAX_SITES)break;if(plans.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<this.SPACING))continue;
      const variant=plans.length,stories=[4,3,5,3,4,2,4,3,5,3,4,2,5,4,3,4,2,5,3,4][variant];p.stories=Math.min(stories,Math.max(2,Math.floor((p.originalTop-8)/4.2)));p.variant=variant;p.key='authored-'+variant;p.baseY=p.originalTop-p.stories*4.2;p.cutY=p.baseY;p.cut=this.clipBuilding(p.b,B,p.cutY);
      const c=Math.cos(p.yaw),s=Math.sin(p.yaw);p.capPositions=[];for(const f of p.A.faces)if(f.flat&&f.y>=p.cutY)for(let i=0;i<9;i+=3){const x=f.p[i]-p.x,z=f.p[i+2]-p.z;p.capPositions.push(x*c-z*s,0,x*s+z*c);}
      plans.push(p);
    }
    world.constructionPlans=plans;world.constructionCuts=new Map(plans.map(p=>[p.roofBid,p]));
  },
  build(world){
    if(world.constructionState)return world.constructionState;
    if(!world.constructionPlans)this.prepare(world);
    const S=this.state(world);for(const p of world.constructionPlans||[])this.buildSite(world,p,S.sites.length);
    S.stats={sites:S.sites.length,colliders:S.colliders.length,draws:S.meshes.length,triangles:S.meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),replacedUpperFloors:true};return S;
  },
  dispose(world){const S=world.constructionState;if(!S)return;for(const m of S.meshes)world.scene.remove(m);for(const c of S.colliders)world.world.removeStatic(c);world.world.referenceGates=(world.world.referenceGates||[]).filter(g=>!S.gates.includes(g));for(const kit of S.kits.values())for(const part of kit.meshes)part.geometry.dispose();for(const m of Object.values(S.materials))m.dispose();world.constructionState=null;}
};
if(TL.ScanHooks){(TL.ScanHooks.load||(TL.ScanHooks.load=[])).push(data=>TL.Construction.load(data));TL.ScanHooks.preNYC.push(world=>TL.Construction.prepare(world));TL.ScanHooks.build.push(world=>TL.Construction.build(world));}







